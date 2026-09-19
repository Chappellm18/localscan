//! Scoring worker — consumes `jobs:scoring` (DESIGN.md §7b), loads each
//! business's website in headless Chrome via `chromiumoxide`, injects
//! axe-core, and computes a composite score per the rubric in DESIGN.md §5.
//!
//! Kept as a separate binary/worker pool from discovery deliberately —
//! headless Chrome instances are far heavier (100-300MB+ each) than the
//! plain HTTP/crawl work discovery does, so they need independent
//! concurrency limits (DESIGN.md §6a / §7a).

mod axe;
mod rubric;

use anyhow::Result;
use chromiumoxide::{Browser, BrowserConfig};
use common::{
    job::ScoringJob,
    status::{write_status, JobStage, JobStatus, JobStatusUpdate},
    RedisStreams,
};
use futures::StreamExt;
use sqlx::postgres::PgPoolOptions;
use std::env;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Semaphore;
use uuid::Uuid;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();

    let redis_url = env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".into());
    let database_url = env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://localhost:5432/localscan".into());
    let consumer_name =
        env::var("WORKER_ID").unwrap_or_else(|_| format!("scoring-{}", Uuid::new_v4()));
    // Headless Chrome is memory-hungry — bound concurrent scans explicitly
    // rather than matching discovery's HTTP-level concurrency (§6a).
    let max_concurrent: usize = env::var("SCORING_MAX_CONCURRENT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(4);

    let pg_pool = PgPoolOptions::new().max_connections(5).connect(&database_url).await?;

    // Give each worker its own profile so it cannot collide with an existing
    // Chrome instance or another scoring worker using chromiumoxide's default.
    let browser_user_data_dir = env::var_os("SCORING_CHROME_USER_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| env::temp_dir().join(format!("localscan-scoring-{}", Uuid::new_v4())));
    let browser_config = BrowserConfig::builder()
        .user_data_dir(browser_user_data_dir)
        .new_headless_mode()
        .build()
        .map_err(anyhow::Error::msg)?;
    let (browser, mut handler) = Browser::launch(browser_config).await?;
    // chromiumoxide requires polling the handler stream to actually drive
    // the browser connection — spawn that off so it runs independently of
    // the job loop below.
    tokio::spawn(async move {
        while let Some(result) = handler.next().await {
            if let Err(error) = result {
                tracing::error!(%error, "Chromium DevTools connection failed");
                break;
            }
        }
    });
    let browser = Arc::new(browser);

    let mut streams =
        RedisStreams::connect(&redis_url, "jobs:scoring", "scoring-workers", &consumer_name)
            .await?;

    let semaphore = Arc::new(Semaphore::new(max_concurrent));

    tracing::info!(consumer = %consumer_name, max_concurrent, "scoring worker started");

    loop {
        let entries = streams.read_new(5_000, max_concurrent).await?;

        for (entry_id, payload) in entries {
            let job: ScoringJob = match serde_json::from_str(&payload) {
                Ok(j) => j,
                Err(e) => {
                    tracing::error!(%entry_id, error = %e, "malformed scoring job payload, acking and skipping");
                    streams.ack(&entry_id).await?;
                    continue;
                }
            };

            let permit = semaphore.clone().acquire_owned().await?;
            let browser = browser.clone();
            let pool = pg_pool.clone();
            let mut status_conn = streams.connection();
            let entry_id_owned = entry_id.clone();

            // Note: for a production worker you'd want to join/await these
            // spawned tasks (or use a JoinSet) rather than fire-and-forget,
            // so acks happen only after the task genuinely completes and
            // shutdown can wait for in-flight scans to drain. Left simple
            // here for scaffold clarity.
            tokio::spawn(async move {
                let _permit = permit; // held until scope ends

                let result = score_business(&browser, &pool, &job, &mut status_conn).await;
                if let Err(e) = result {
                    tracing::error!(job_id = %job.job_id, error = %e, "scoring job failed");
                    write_status(
                        &mut status_conn,
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
                let _ = entry_id_owned; // ack handled by caller loop below in real impl
            });

            // Ack immediately after spawn in this scaffold; move to
            // ack-on-completion (per DESIGN.md §7d transient-retry
            // semantics) once the JoinSet-based version above is in place.
            streams.ack(&entry_id).await?;
        }
    }
}

async fn score_business(
    browser: &Browser,
    pool: &sqlx::PgPool,
    job: &ScoringJob,
    status_conn: &mut redis::aio::MultiplexedConnection,
) -> Result<()> {
    write_status(
        status_conn,
        job.job_id,
        JobStatusUpdate {
            status: JobStatus::Running,
            stage: Some(JobStage::Scoring),
            progress_current: None,
            progress_total: None,
            error: None,
        },
    )
    .await?;

    let page = browser.new_page(&job.website_url).await?;
    page.wait_for_navigation().await?;

    let axe_report = axe::run_axe(&page).await?;
    let basics = rubric::check_basics(&page).await?;
    let signals = rubric::collect_page_signals(&page).await?;
    let score = rubric::compute_score(&axe_report, &basics, &signals);

    sqlx::query(
        r#"
        INSERT INTO site_scores
            (business_id, overall_score, accessibility_score, performance_score, seo_score, basics_score, modernity_score, raw_report, scanned_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
        "#,
    )
    .bind(job.business_id)
    .bind(score.overall)
    .bind(score.accessibility)
    .bind(score.performance)
    .bind(score.seo)
    .bind(score.basics)
    .bind(score.modernity)
    .bind(serde_json::json!({ "axe": axe_report, "signals": signals }))
    .execute(pool)
    .await?;

    write_status(
        status_conn,
        job.job_id,
        JobStatusUpdate {
            status: JobStatus::Completed,
            stage: Some(JobStage::Done),
            progress_current: Some(1),
            progress_total: Some(1),
            error: None,
        },
    )
    .await?;

    Ok(())
}
