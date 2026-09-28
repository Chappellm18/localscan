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

#[cfg(test)]
mod tests {
    use super::{normalize, RawCandidate};
    use serde_json::json;

    #[test]
    fn normalize_maps_business_fields_from_source_data() {
        let businesses = normalize(vec![RawCandidate {
            source: "business_website".to_string(),
            source_id: "osm:42".to_string(),
            raw_fields: json!({
                "name": "Example Cafe",
                "address": "1 Main St",
                "category": "cafe",
                "phone": "555-0100",
                "website_url": "https://example.com",
                "lat": 41.5,
                "lng": -73.5
            }),
        }])
        .unwrap();

        assert_eq!(businesses.len(), 1);
        let business = &businesses[0];
        assert_eq!(business.name, "Example Cafe");
        assert_eq!(business.address.as_deref(), Some("1 Main St"));
        assert_eq!(business.category.as_deref(), Some("cafe"));
        assert_eq!(business.phone.as_deref(), Some("555-0100"));
        assert_eq!(business.website_url.as_deref(), Some("https://example.com"));
        assert_eq!(business.lat, Some(41.5));
        assert_eq!(business.lng, Some(-73.5));
        assert_eq!(business.source, "business_website");
        assert_eq!(business.source_id, "osm:42");
    }

    #[test]
    fn normalize_preserves_the_existing_fallback_for_missing_values() {
        let businesses = normalize(vec![RawCandidate {
            source: "facebook".to_string(),
            source_id: "page:1".to_string(),
            raw_fields: json!({}),
        }])
        .unwrap();

        assert_eq!(businesses[0].name, "unknown");
        assert_eq!(businesses[0].address, None);
        assert_eq!(businesses[0].website_url, None);
    }
}
