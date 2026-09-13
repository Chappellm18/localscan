//! Discovery worker — consumes `jobs:discovery` (DESIGN.md §7b), crawls for
//! businesses in a ZIP code, writes results to Postgres, and enqueues a
//! `jobs:scoring` job for each business that has a website.
//!
//! This is a scaffold, not a finished crawler: the actual source-specific
//! extraction logic (business websites / Facebook Pages / Instagram —
//! DESIGN.md §4) still needs to be built out per source. The plumbing
//! around it (queue consumption, status reporting, fan-out to scoring,
//! retry/failure handling) is wired up and shouldn't need to change much
//! as sources are added.

mod extract;
mod sources;

use anyhow::Result;
use common::{
    job::{DiscoveryJob, ScoringJob},
    status::{write_status, JobStage, JobStatus, JobStatusUpdate},
    RedisStreams,
};
use sqlx::postgres::PgPoolOptions;
use std::env;
use uuid::Uuid;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();

    let redis_url = env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".into());
    let database_url = env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://localhost:5432/localscan".into());
    let consumer_name =
        env::var("WORKER_ID").unwrap_or_else(|_| format!("discovery-{}", Uuid::new_v4()));

    let pg_pool = PgPoolOptions::new().max_connections(5).connect(&database_url).await?;

    let mut streams = RedisStreams::connect(
        &redis_url,
        "jobs:discovery",
        "discovery-workers",
        &consumer_name,
    )
    .await?;

    tracing::info!(consumer = %consumer_name, "discovery worker started, waiting for jobs");

    loop {
        // Long-poll for new entries; block_ms=5000 keeps the loop from
        // spinning while still letting the process respond to shutdown
        // signals reasonably promptly. Tune as needed.
        let entries = streams.read_new(5_000, 10).await?;

        for (entry_id, payload) in entries {
            let job: DiscoveryJob = match serde_json::from_str(&payload) {
                Ok(j) => j,
                Err(e) => {
                    tracing::error!(%entry_id, error = %e, "malformed discovery job payload, acking and skipping");
                    streams.ack(&entry_id).await?;
                    continue;
                }
            };

            if let Err(e) = handle_job(&mut streams, &pg_pool, &redis_url, &job).await {
                tracing::error!(job_id = %job.job_id, error = %e, "discovery job failed");
                let mut conn = streams.connection();
                write_status(
                    &mut conn,
                    job.job_id,
                    JobStatusUpdate {
                        status: JobStatus::Failed,
                        stage: None,
                        progress_current: None,
                        progress_total: None,
                        error: Some(e.to_string()),
                    },
                )
                .await
                .ok();
            }

            // Ack regardless of success/failure at this level — permanent
            // failures shouldn't block the stream. Transient-failure retry
            // policy (DESIGN.md §7d) lives inside handle_job/extract, not
            // as stream-level redelivery, to keep control explicit.
            streams.ack(&entry_id).await?;
        }
    }
}

async fn handle_job(
    streams: &mut RedisStreams,
    pg_pool: &sqlx::PgPool,
    redis_url: &str,
    job: &DiscoveryJob,
) -> Result<()> {
    let mut status_conn = streams.connection();

    write_status(
        &mut status_conn,
        job.job_id,
        JobStatusUpdate {
            status: JobStatus::Running,
            stage: Some(JobStage::CrawlingSources),
            progress_current: Some(0),
            progress_total: None,
            error: None,
        },
    )
    .await?;

    // 1. Crawl configured sources for this ZIP. See sources.rs — each
    //    source (business-site crawl, Facebook Page, Instagram) is its own
    //    module so they can be enabled/disabled/rate-limited independently.
    let candidates = sources::discover_businesses(job).await?;

    write_status(
        &mut status_conn,
        job.job_id,
        JobStatusUpdate {
            status: JobStatus::Running,
            stage: Some(JobStage::ExtractingBusinesses),
            progress_current: Some(0),
            progress_total: Some(candidates.len() as u32),
            error: None,
        },
    )
    .await?;

    // 2. Normalize/extract structured fields (name, address, phone,
    //    website) from raw crawl results.
    let businesses = extract::normalize(candidates)?;

    // 3. Persist to Postgres and fan out scoring jobs for anything with a
    //    website. Writing directly to Postgres (not back through Node) per
    //    DESIGN.md §7b.
    let redis_client = redis::Client::open(redis_url)?;
    let mut scoring_conn = redis_client.get_multiplexed_tokio_connection().await?;

    for (i, biz) in businesses.iter().enumerate() {
        let business_id = db_upsert_business(pg_pool, job, biz).await?;

        if let Some(url) = &biz.website_url {
            let scoring_job = ScoringJob {
                job_id: Uuid::new_v4(),
                business_id,
                website_url: url.clone(),
                parent_discovery_job_id: job.job_id,
                enqueued_at: chrono::Utc::now(),
            };
            let payload = serde_json::to_string(&scoring_job)?;
            let _id: String = redis::cmd("XADD")
                .arg("jobs:scoring")
                .arg("*")
                .arg("payload")
                .arg(payload)
                .query_async(&mut scoring_conn)
                .await?;
        }

        write_status(
            &mut status_conn,
            job.job_id,
            JobStatusUpdate {
                status: JobStatus::Running,
                stage: Some(JobStage::ExtractingBusinesses),
                progress_current: Some((i + 1) as u32),
                progress_total: Some(businesses.len() as u32),
                error: None,
            },
        )
        .await?;
    }

    write_status(
        &mut status_conn,
        job.job_id,
        JobStatusUpdate {
            status: JobStatus::Completed,
            stage: Some(JobStage::Done),
            progress_current: Some(businesses.len() as u32),
            progress_total: Some(businesses.len() as u32),
            error: None,
        },
    )
    .await?;

    Ok(())
}

async fn db_upsert_business(
    pool: &sqlx::PgPool,
    job: &DiscoveryJob,
    biz: &extract::Business,
) -> Result<Uuid> {
    // Upsert on (source, source_id) so re-running discovery for a ZIP
    // updates existing rows rather than duplicating them.
    let rec = sqlx::query!(
        r#"
        INSERT INTO businesses (name, address, zip, category, phone, website_url, source, source_id, last_fetched_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
        ON CONFLICT (source, source_id)
        DO UPDATE SET
            name = EXCLUDED.name,
            address = EXCLUDED.address,
            website_url = EXCLUDED.website_url,
            last_fetched_at = now()
        RETURNING id
        "#,
        biz.name,
        biz.address,
        job.zip,
        biz.category,
        biz.phone,
        biz.website_url,
        biz.source,
        biz.source_id,
    )
    .fetch_one(pool)
    .await?;

    Ok(rec.id)
}
