//! Shared types and Redis helpers used by both the discovery and scoring
//! workers. Keeping this in one crate means both workers agree on the wire
//! format with the Node API by construction, not by convention.
//!
//! Stream/job contract lives in DESIGN.md §7 — keep that doc and this file
//! in sync when either changes.

pub mod job;
pub mod redis_client;
pub mod status;

pub use job::{DiscoveryJob, ScoringJob};
pub use redis_client::RedisStreams;
pub use status::{JobStage, JobStatus, JobStatusUpdate};
