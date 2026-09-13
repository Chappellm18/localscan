use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Enqueued to the `jobs:discovery` Redis stream by the Node API.
/// See DESIGN.md §7b.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveryJob {
    pub job_id: Uuid,
    pub zip: String,
    pub radius_miles: Option<u32>,
    pub category_filter: Option<String>,
    pub requested_by_user_id: Uuid,
    pub enqueued_at: DateTime<Utc>,
}

/// Enqueued to the `jobs:scoring` Redis stream, either by the discovery
/// worker as it finds businesses with websites, or by a Node-side
/// orchestrator watching discovery completion. See DESIGN.md §7b.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScoringJob {
    pub job_id: Uuid,
    pub business_id: Uuid,
    pub website_url: String,
    pub parent_discovery_job_id: Uuid,
    pub enqueued_at: DateTime<Utc>,
}
