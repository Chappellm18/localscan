//! Implements the scoring weights from DESIGN.md §5:
//!   basics 15% / accessibility 30% / performance 20% / seo 15% / modernity 20%
//! These weights are a starting point per the design doc — expect to tune
//! them once you see real scores against real businesses.

use anyhow::Result;
use chromiumoxide::Page;
use serde::Serialize;

pub struct BasicsCheck {
    pub has_https: bool,
    pub has_viewport_meta: bool,
    pub has_title: bool,
    pub has_meta_description: bool,
}

#[derive(Debug, Serialize)]
pub struct Score {
    pub overall: f32,
    pub accessibility: f32,
    pub performance: f32,
    pub seo: f32,
    pub basics: f32,
}

const WEIGHT_BASICS: f32 = 0.15;
const WEIGHT_ACCESSIBILITY: f32 = 0.30;
const WEIGHT_PERFORMANCE: f32 = 0.20;
const WEIGHT_SEO: f32 = 0.15;
// The remaining 20% ("modernity/design signals" in §5 — broken links,
// last-modified headers, responsive breakpoints) isn't implemented in this
// scaffold; folded into basics for now until that check is built out.
// Revisit weight distribution once it lands.

pub async fn check_basics(page: &Page) -> Result<BasicsCheck> {
    let url = page.url().await?.unwrap_or_default();
    let has_https = url.starts_with("https://");

    let has_viewport_meta = page
        .evaluate("!!document.querySelector('meta[name=\"viewport\"]')")
        .await?
        .into_value::<bool>()
        .unwrap_or(false);

    let has_title = page
        .evaluate("!!document.title && document.title.length > 0")
        .await?
        .into_value::<bool>()
        .unwrap_or(false);

    let has_meta_description = page
        .evaluate("!!document.querySelector('meta[name=\"description\"]')")
        .await?
        .into_value::<bool>()
        .unwrap_or(false);

    Ok(BasicsCheck {
        has_https,
        has_viewport_meta,
        has_title,
        has_meta_description,
    })
}

/// Weights each axe-core violation by WCAG impact level (axe already tags
/// each violation this way), then converts to a 0-100 score. This is a
/// simple starting formula, not a validated methodology — refine once you
/// have real-world score distributions to calibrate against.
fn accessibility_score(axe_report: &serde_json::Value) -> f32 {
    let violations = axe_report
        .get("violations")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut penalty = 0.0;
    for v in &violations {
        let impact = v.get("impact").and_then(|i| i.as_str()).unwrap_or("minor");
        let node_count = v
            .get("nodes")
            .and_then(|n| n.as_array())
            .map(|a| a.len())
            .unwrap_or(1) as f32;

        let per_instance_penalty = match impact {
            "critical" => 8.0,
            "serious" => 5.0,
            "moderate" => 2.0,
            _ => 0.5, // "minor"
        };
        penalty += per_instance_penalty * node_count;
    }

    (100.0 - penalty).max(0.0)
}

fn basics_score(basics: &BasicsCheck) -> f32 {
    let checks = [
        basics.has_https,
        basics.has_viewport_meta,
        basics.has_title,
        basics.has_meta_description,
    ];
    let passed = checks.iter().filter(|c| **c).count() as f32;
    (passed / checks.len() as f32) * 100.0
}

/// Performance and SEO scoring are placeholders — performance should pull
/// Core Web Vitals via the CDP `Performance` domain (DESIGN.md §6a step 6),
/// and SEO should expand beyond meta-description presence (structured
/// data, heading hierarchy, etc). Stubbed at a neutral midpoint so overall
/// scores aren't misleadingly high/low until these are implemented.
fn performance_score() -> f32 {
    50.0
}

fn seo_score(basics: &BasicsCheck) -> f32 {
    if basics.has_title && basics.has_meta_description {
        75.0
    } else {
        40.0
    }
}

pub fn compute_score(axe_report: &serde_json::Value, basics: &BasicsCheck) -> Score {
    let accessibility = accessibility_score(axe_report);
    let performance = performance_score();
    let seo = seo_score(basics);
    let basics_s = basics_score(basics);

    let overall = accessibility * WEIGHT_ACCESSIBILITY
        + performance * WEIGHT_PERFORMANCE
        + seo * WEIGHT_SEO
        + basics_s * WEIGHT_BASICS
        // Modernity weight (20%) not yet implemented — see comment above.
        // Redistributing proportionally across implemented categories so
        // overall isn't scaled down by an unimplemented 20% until it lands:
        ;
    let implemented_weight = WEIGHT_ACCESSIBILITY + WEIGHT_PERFORMANCE + WEIGHT_SEO + WEIGHT_BASICS;
    let overall = overall / implemented_weight;

    Score {
        overall,
        accessibility,
        performance,
        seo,
        basics: basics_s,
    }
}
