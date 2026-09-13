//! Implements the inject-and-run approach decided in DESIGN.md §6a:
//! bundle axe-core as a static asset, inject it into the page context via
//! CDP, execute `axe.run()`, and pull the JSON report back into Rust.

use anyhow::Result;
use chromiumoxide::Page;
use once_cell::sync::Lazy;

/// Bundled at compile time — download the desired axe-core release from
/// https://github.com/dequelabs/axe-core/releases and place it at
/// `assets/axe.min.js` before building. Bundling (rather than fetching
/// from a CDN per-scan) avoids depending on external uptime and avoids
/// leaking each scanned URL to a third party — see DESIGN.md §6a.
static AXE_JS: Lazy<&str> = Lazy::new(|| include_str!("../assets/axe.min.js"));

pub async fn run_axe(page: &Page) -> Result<serde_json::Value> {
    // Inject axe-core into the current page context.
    page.evaluate(*AXE_JS).await?;

    // Run the audit; axe.run() returns a Promise, which chromiumoxide's
    // evaluate() awaits transparently when the expression resolves to one.
    let result = page
        .evaluate("axe.run().then(r => JSON.stringify(r))")
        .await?
        .into_value::<String>()?;

    Ok(serde_json::from_str(&result)?)
}
