//! LocalScan is a lead-generation tool, so the site health signals are inverted
//! into a "sales opportunity" score: higher scores mean the business is more
//! likely to need a new website, a redesign, or digital tooling.

use anyhow::Result;
use chromiumoxide::Page;
use serde::{Deserialize, Serialize};

pub struct BasicsCheck {
    pub has_https: bool,
    pub has_viewport_meta: bool,
    pub has_title: bool,
    pub has_meta_description: bool,
}

#[derive(Debug, Default, Deserialize, Serialize)]
pub struct PageSignals {
    pub load_time_ms: Option<f32>,
    pub has_structured_data: bool,
    pub heading_count: u32,
    pub has_broken_links: bool,
    pub responsive_breakpoints: u32,
    pub has_modern_css: bool,
}

#[derive(Debug, Serialize)]
pub struct Score {
    pub overall: f32,
    pub accessibility: f32,
    pub performance: f32,
    pub seo: f32,
    pub basics: f32,
    pub modernity: f32,
}

const WEIGHT_BASICS: f32 = 0.15;
const WEIGHT_ACCESSIBILITY: f32 = 0.30;
const WEIGHT_PERFORMANCE: f32 = 0.20;
const WEIGHT_SEO: f32 = 0.15;
const WEIGHT_MODERNITY: f32 = 0.20;

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

fn performance_score(signals: &PageSignals) -> f32 {
    match signals.load_time_ms {
        Some(load_time) if load_time <= 1_500.0 => 100.0,
        Some(load_time) if load_time <= 3_000.0 => 80.0,
        Some(load_time) if load_time <= 5_000.0 => 60.0,
        Some(load_time) if load_time <= 8_000.0 => 35.0,
        Some(_) => 15.0,
        None => 50.0,
    }
}

fn seo_score(basics: &BasicsCheck, signals: &PageSignals) -> f32 {
    let mut score = 0.0;
    if basics.has_title { score += 35.0; }
    if basics.has_meta_description { score += 35.0; }
    if signals.has_structured_data { score += 20.0; }
    if signals.heading_count > 0 { score += 10.0; }
    score
}

fn modernity_score(signals: &PageSignals) -> f32 {
    let responsive = (signals.responsive_breakpoints.min(3) as f32 / 3.0) * 45.0;
    let css = if signals.has_modern_css { 25.0 } else { 0.0 };
    let links = if signals.has_broken_links { 0.0 } else { 30.0 };
    responsive + css + links
}

pub fn compute_score(
    axe_report: &serde_json::Value,
    basics: &BasicsCheck,
    signals: &PageSignals,
) -> Score {
    // LocalScan is built for lead generation, not website scoring. Higher values
    // represent a stronger sales opportunity: a business with a weak, outdated,
    // or inaccessible website is a better candidate to contact than a polished one.
    let accessibility = 100.0 - accessibility_score(axe_report);
    let performance = 100.0 - performance_score(signals);
    let seo = 100.0 - seo_score(basics, signals);
    let basics_s = 100.0 - basics_score(basics);
    let modernity = 100.0 - modernity_score(signals);

    let overall = accessibility * WEIGHT_ACCESSIBILITY
        + performance * WEIGHT_PERFORMANCE
        + seo * WEIGHT_SEO
        + basics_s * WEIGHT_BASICS
        + modernity * WEIGHT_MODERNITY;

    Score {
        overall,
        accessibility,
        performance,
        seo,
        basics: basics_s,
        modernity,
    }
}

pub async fn collect_page_signals(page: &Page) -> Result<PageSignals> {
    let script = r#"
      (() => {
        const links = [...document.querySelectorAll('a[href]')];
        const breakpoints = new Set([...document.styleSheets].flatMap(sheet => {
          try { return [...sheet.cssRules]; } catch (_) { return []; }
        }).filter(rule => rule.conditionText && rule.conditionText.includes('width')).map(rule => rule.conditionText)).size;
        return JSON.stringify({
          load_time_ms: performance.timing.loadEventEnd > 0
            ? performance.timing.loadEventEnd - performance.timing.navigationStart : null,
          has_structured_data: !!document.querySelector('script[type="application/ld+json"]'),
          heading_count: document.querySelectorAll('h1,h2,h3').length,
          has_broken_links: links.some(a => a.getAttribute('href') === '#' || a.getAttribute('href') === ''),
          responsive_breakpoints: breakpoints,
          has_modern_css: !!document.querySelector('main, header, nav, footer')
        });
      })()
    "#;
    let json = page.evaluate(script).await?.into_value::<String>()?;
    Ok(serde_json::from_str(&json)?)
}
