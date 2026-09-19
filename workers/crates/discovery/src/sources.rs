//! One module-per-source, matching the sources decided on in DESIGN.md §4.
//! Kept separate so each can be rate-limited, retried, and (if you revisit
//! the Facebook/Instagram decision per the concerns in §4) swapped out or
//! disabled independently without touching the discovery worker's plumbing.

use crate::extract::RawCandidate;
use anyhow::Result;
use common::job::DiscoveryJob;
use serde::Deserialize;
use std::collections::HashMap;

pub async fn discover_businesses(job: &DiscoveryJob) -> Result<Vec<RawCandidate>> {
    let mut candidates = Vec::new();

    candidates.extend(crawl_business_websites(job).await?);
    candidates.extend(crawl_facebook(job).await?);
    candidates.extend(crawl_instagram(job).await?);

    Ok(candidates)
}

#[derive(Debug, Deserialize)]
struct NominatimResult {
    lat: String,
    lon: String,
    boundingbox: [String; 4],
}

#[derive(Debug, Deserialize)]
struct OverpassResponse {
    elements: Vec<OverpassElement>,
}

#[derive(Debug, Deserialize)]
struct OverpassElement {
    id: u64,
    lat: Option<f64>,
    lon: Option<f64>,
    center: Option<OverpassCenter>,
    tags: Option<HashMap<String, String>>,
}

#[derive(Debug, Deserialize)]
struct OverpassCenter {
    lat: f64,
    lon: f64,
}

fn build_address(tags: &HashMap<String, String>) -> Option<String> {
    let parts: Vec<&str> = [
        tags.get("addr:housenumber").map(String::as_str),
        tags.get("addr:street").map(String::as_str),
        tags.get("addr:city").map(String::as_str),
        tags.get("addr:state").map(String::as_str),
        tags.get("addr:postcode").map(String::as_str),
    ]
    .into_iter()
    .flatten()
    .collect();

    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" "))
    }
}

/// Lowest-risk source (DESIGN.md §4) — rather than scraping an arbitrary
/// directory site's HTML (fragile, and often blocked by robots.txt, which
/// `spider` respects anyway), this queries OpenStreetMap directly: Nominatim
/// geocodes the ZIP to a center point and bounding box, then Overpass returns
/// tagged businesses inside the full ZIP area (or within radius_miles when
/// explicitly requested). Both are free, keyless, and explicitly meant for
/// this kind of POI lookup.
///
/// Note: Nominatim's usage policy caps unauthenticated use at ~1 req/sec
/// and requires a descriptive User-Agent (set below) — fine for dev/low
/// volume, but if this needs to run at real job throughput later, look at
/// a self-hosted Nominatim/Overpass instance or a paid geocoding provider.
async fn crawl_business_websites(job: &DiscoveryJob) -> Result<Vec<RawCandidate>> {
    tracing::info!(zip = %job.zip, "querying OpenStreetMap for businesses");
    let client = reqwest::Client::builder()
        .user_agent("LocalScan/0.1 (local dev)")
        .build()?;

    let geo_resp: Vec<NominatimResult> = client
        .get("https://nominatim.openstreetmap.org/search")
        .query(&[
            ("postalcode", job.zip.as_str()),
            ("country", "US"),
            ("format", "json"),
            ("limit", "1"),
        ])
        .send()
        .await?
        .json()
        .await?;

    let Some(center) = geo_resp.into_iter().next() else {
        tracing::warn!(zip = %job.zip, "crawl_business_websites: could not geocode zip, skipping");
        return Ok(Vec::new());
    };
    let lat: f64 = center.lat.parse()?;
    let lon: f64 = center.lon.parse()?;
    let [south, north, west, east] = center.boundingbox;
    let radius_meters = (job.radius_miles.unwrap_or(0) as f64 * 1609.34) as u32;
    let area = if radius_meters > 0 {
        format!("(around:{radius_meters},{lat},{lon})")
    } else {
        format!("({south},{west},{north},{east})")
    };

    let query = if let Some(cat) = &job.category_filter {
        let cat = cat.replace('"', "");
        format!(
            r#"[out:json][timeout:60];
(
 nwr["shop"="{cat}"]{area};
 nwr["amenity"="{cat}"]{area};
);
out body center;"#
        )
    } else {
        format!(
            r#"[out:json][timeout:60];
(
 nwr["shop"]{area};
 nwr["amenity"]{area};
 nwr["office"]{area};
 nwr["craft"]{area};
 nwr["tourism"]{area};
 nwr["healthcare"]{area};
);
out body center;"#
        )
    };

    let overpass_resp: OverpassResponse = client
        .post("https://overpass-api.de/api/interpreter")
        .body(query)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    let candidates: Vec<RawCandidate> = overpass_resp
        .elements
        .into_iter()
        .filter_map(|el| {
            let tags = el.tags?;
            let name = tags.get("name")?.clone();
            if job.radius_miles.is_none()
                && tags
                    .get("addr:postcode")
                    .map(|postcode| postcode.chars().take(5).collect::<String>() != job.zip)
                    .unwrap_or(false)
            {
                return None;
            }
            let address = build_address(&tags);
            let category = tags.get("shop").or_else(|| tags.get("amenity")).cloned();
            let phone = tags
                .get("phone")
                .or_else(|| tags.get("contact:phone"))
                .cloned();
            let website_url = tags
                .get("website")
                .or_else(|| tags.get("contact:website"))
                .cloned();

            let latitude = el
                .lat
                .or_else(|| el.center.as_ref().map(|center| center.lat));
            let longitude = el
                .lon
                .or_else(|| el.center.as_ref().map(|center| center.lon));

            Some(RawCandidate {
                source: "business_website".to_string(),
                source_id: format!("osm:{}", el.id),
                raw_fields: serde_json::json!({
                    "name": name,
                    "address": address,
                    "category": category,
                    "phone": phone,
                    "website_url": website_url,
                    "lat": latitude,
                    "lng": longitude,
                }),
            })
        })
        .collect();

    tracing::info!(
        zip = %job.zip,
        candidates = candidates.len(),
        "OpenStreetMap returned named business candidates"
    );
    Ok(candidates)
}

/// Facebook Page scraping — see DESIGN.md §4 for the legal/ToS concerns
/// flagged on this source specifically. Implement against the Graph API
/// (sanctioned, public Page data) if you decide to de-risk this per the
/// "practical middle ground" note in §4, or direct scraping if you're
/// proceeding with the accepted-risk approach as discussed.
async fn crawl_facebook(job: &DiscoveryJob) -> Result<Vec<RawCandidate>> {
    tracing::debug!(zip = %job.zip, "crawl_facebook: not yet implemented");
    Ok(Vec::new())
}

/// Instagram profile scraping — same DESIGN.md §4 concerns apply, and
/// technically this will likely require headless-browser rendering
/// (`chromiumoxide`, same crate as the scoring worker) rather than plain
/// HTTP fetches, since most profile content renders client-side.
async fn crawl_instagram(job: &DiscoveryJob) -> Result<Vec<RawCandidate>> {
    tracing::debug!(zip = %job.zip, "crawl_instagram: not yet implemented");
    Ok(Vec::new())
}
