use anyhow::Result;
use chrono::Utc;
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Queued,
    Running,
    Completed,
    Failed,
}

/// Coarse progress stage, surfaced to the frontend so the UI can show
/// something more informative than a bare percentage. Extend as needed —
/// keep values snake_case since Node reads these directly.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobStage {
    CrawlingSources,
    ExtractingBusinesses,
    Scoring,
    Done,
}

pub struct JobStatusUpdate {
    pub status: JobStatus,
    pub stage: Option<JobStage>,
    pub progress_current: Option<u32>,
    pub progress_total: Option<u32>,
    pub error: Option<String>,
}

/// Writes/reads the `job_status:{job_id}` hash described in DESIGN.md §7b.
/// This is a thin wrapper — nothing here should encode business logic,
/// just the wire format for status reporting.
pub async fn write_status(
    conn: &mut redis::aio::MultiplexedConnection,
    job_id: Uuid,
    update: JobStatusUpdate,
) -> Result<()> {
    let key = format!("job_status:{job_id}");
    let mut pairs: Vec<(&str, String)> = vec![
        ("status", format!("{:?}", update.status).to_lowercase()),
        ("updated_at", Utc::now().to_rfc3339()),
    ];
    if let Some(stage) = update.stage {
        pairs.push(("stage", format!("{:?}", stage).to_lowercase()));
    }
    if let Some(c) = update.progress_current {
        pairs.push(("progress_current", c.to_string()));
    }
    if let Some(t) = update.progress_total {
        pairs.push(("progress_total", t.to_string()));
    }
    if let Some(e) = update.error {
        pairs.push(("error", e));
    }

    conn.hset_multiple::<_, _, _, ()>(&key, &pairs).await?;
    // Status hashes shouldn't live forever if a job is abandoned/orphaned.
    conn.expire::<_, ()>(&key, 60 * 60 * 24).await?; // 24h TTL
    Ok(())
}
