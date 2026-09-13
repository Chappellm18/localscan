//! One module-per-source, matching the sources decided on in DESIGN.md §4.
//! Kept separate so each can be rate-limited, retried, and (if you revisit
//! the Facebook/Instagram decision per the concerns in §4) swapped out or
//! disabled independently without touching the discovery worker's plumbing.

use crate::extract::RawCandidate;
use anyhow::Result;
use common::job::DiscoveryJob;

pub async fn discover_businesses(job: &DiscoveryJob) -> Result<Vec<RawCandidate>> {
    let mut candidates = Vec::new();

    candidates.extend(crawl_business_websites(job).await?);
    candidates.extend(crawl_facebook(job).await?);
    candidates.extend(crawl_instagram(job).await?);

    Ok(candidates)
}

/// Lowest-risk source (DESIGN.md §4) — general web crawl seeded from
/// search/directory pages, using `spider` for the actual crawl frontier
/// (concurrency, politeness/robots.txt, rate limiting are handled by the
/// crate). Fill in seed URLs / extraction selectors for your chosen
/// starting points (local directories, chamber-of-commerce listings, etc).
async fn crawl_business_websites(job: &DiscoveryJob) -> Result<Vec<RawCandidate>> {
    tracing::debug!(zip = %job.zip, "crawl_business_websites: not yet implemented");
    // Example shape of what this will look like with `spider`:
    //
    // let mut website = spider::website::Website::new(&seed_url);
    // website.crawl().await;
    // for page in website.get_pages() { /* extract via `scraper` selectors */ }
    Ok(Vec::new())
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
