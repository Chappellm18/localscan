use anyhow::Result;
use serde::{Deserialize, Serialize};

/// Raw, source-specific data pulled straight out of a crawl, before
/// normalization. Each source module in sources.rs produces these.
#[derive(Debug, Clone)]
pub struct RawCandidate {
    pub source: String,    // "business_website" | "facebook" | "instagram"
    pub source_id: String, // stable id/URL within that source
    pub raw_fields: serde_json::Value,
}

/// Normalized business record, ready to persist. Matches the `businesses`
/// table in DESIGN.md §8.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Business {
    pub name: String,
    pub address: Option<String>,
    pub category: Option<String>,
    pub phone: Option<String>,
    pub website_url: Option<String>,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub source: String,
    pub source_id: String,
}

/// Dedupe + normalize raw candidates from potentially multiple sources
/// into a single business list. Dedup strategy (name+address fuzzy match
/// vs. website-URL match) is deliberately left as a TODO — worth deciding
/// once you see how much overlap there actually is between sources.
pub fn normalize(candidates: Vec<RawCandidate>) -> Result<Vec<Business>> {
    let mut out = Vec::with_capacity(candidates.len());
    for c in candidates {
        // TODO: source-specific field mapping out of c.raw_fields.
        // Placeholder pass-through so the pipeline compiles/runs end to
        // end before extraction logic is filled in per source.
        out.push(Business {
            name: c
                .raw_fields
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string(),
            address: c.raw_fields.get("address").and_then(|v| v.as_str()).map(String::from),
            category: c.raw_fields.get("category").and_then(|v| v.as_str()).map(String::from),
            phone: c.raw_fields.get("phone").and_then(|v| v.as_str()).map(String::from),
            website_url: c.raw_fields.get("website_url").and_then(|v| v.as_str()).map(String::from),
            lat: c.raw_fields.get("lat").and_then(|v| v.as_f64()),
            lng: c.raw_fields.get("lng").and_then(|v| v.as_f64()),
            source: c.source,
            source_id: c.source_id,
        });
    }
    Ok(out)
}
