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

#[cfg(test)]
mod tests {
    use super::{DiscoveryJob, ScoringJob};
    use chrono::{DateTime, Utc};
    use serde_json::json;
    use uuid::Uuid;

    fn test_time() -> DateTime<Utc> {
        "2026-01-02T03:04:05Z".parse().unwrap()
    }

    #[test]
    fn discovery_job_matches_the_api_wire_format() {
        let job = DiscoveryJob {
            job_id: Uuid::nil(),
            zip: "10940".to_string(),
            radius_miles: Some(5),
            category_filter: Some("restaurant".to_string()),
            requested_by_user_id: Uuid::nil(),
            enqueued_at: test_time(),
        };

        let serialized = serde_json::to_value(&job).unwrap();
        assert_eq!(
            serialized,
            json!({
                "job_id": "00000000-0000-0000-0000-000000000000",
                "zip": "10940",
                "radius_miles": 5,
                "category_filter": "restaurant",
                "requested_by_user_id": "00000000-0000-0000-0000-000000000000",
                "enqueued_at": "2026-01-02T03:04:05Z"
            })
        );
        assert_eq!(
            serde_json::from_value::<DiscoveryJob>(serialized)
                .unwrap()
                .zip,
            "10940"
        );
    }

    #[test]
    fn scoring_job_round_trips_through_json() {
        let job = ScoringJob {
            job_id: Uuid::nil(),
            business_id: Uuid::from_u128(1),
            website_url: "https://example.com".to_string(),
            parent_discovery_job_id: Uuid::from_u128(2),
            enqueued_at: test_time(),
        };

        let serialized = serde_json::to_value(&job).unwrap();
        let decoded: ScoringJob = serde_json::from_value(serialized).unwrap();
        assert_eq!(decoded.business_id, Uuid::from_u128(1));
        assert_eq!(decoded.parent_discovery_job_id, Uuid::from_u128(2));
        assert_eq!(decoded.website_url, "https://example.com");
    }
}
