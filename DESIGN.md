# LocalScan — Design Document
*(working name — rename freely)*

## 1. Purpose

A web application that, given a ZIP code, discovers local businesses and produces a scored report of each business's online presence and web accessibility. Initial use case: lead generation for a web design studio (find businesses with weak/nonexistent/inaccessible websites). Longer-term: multi-tenant SaaS sold on subscription to other agencies, franchises, and local marketers.

## 2. Goals / Non-Goals

**Goals**
- Given a ZIP (or ZIP + radius, or city), return a list of local businesses with contact info, website URL (if any), and a composite "web health" score.
- Score should be defensible and explainable — each business gets a breakdown, not just a number, since this doubles as the sales pitch when the studio reaches out.
- Results are cached/stored so repeat lookups are fast and cheap.
- Architecture supports adding paying multi-tenant users later without a rewrite.

**Non-Goals (v1)**
- Not doing real-time scraping of every result on every request — this is a background job + cache model, not synchronous scraping per request.
- Not attempting to scrape Google Maps/Yelp HTML directly (ToS + fragility risk — see §4).
- Not building outreach/CRM tooling yet (contacting businesses) — v1 is discovery + scoring only.

## 3. High-Level Architecture

```
┌─────────────┐      ┌──────────────────┐      ┌─────────────────────┐
│   Frontend   │─────▶│   API / Backend   │─────▶│  Rust Worker(s)      │
│ (Next.js)    │◀─────│  (Node — auth,    │◀─────│  discovery crawl +   │
│              │      │   billing,        │      │  business scraping   │
│              │      │   results API)    │      │  (spider / reqwest)  │
└─────────────┘      └──────────────────┘      └─────────────────────┘
                              │                          │
                              ▼                          ▼
                        ┌──────────┐            ┌──────────────────┐
                        │ Postgres │            │ Accessibility scan │
                        │ (results,│            │ worker (Rust +    │
                        │  users,  │            │ chromiumoxide +   │
                        │  billing)│            │ injected axe-core) │
                        └──────────┘            └──────────────────┘
```

**Flow:**
1. User submits a ZIP code (and optional business-category filter).
2. Backend checks: do we have a fresh (< N days old) result set for this ZIP? If yes, serve from Postgres/cache immediately.
3. If stale/missing, enqueue a discovery job.
4. Worker scrapes business listings for that ZIP (business websites directly, Facebook Pages, Instagram profiles — see §4 for approach and risks) to build the raw business list.
5. For each business with a website, enqueue a site-scoring job.
6. Scoring worker crawls the site (respecting robots.txt), runs Lighthouse/axe-core, computes composite score, stores result.
7. Frontend polls or subscribes (websocket/SSE) for job completion and renders progressively as businesses get scored.

## 4. Business Discovery — Data Source Decision

**Decision: direct scraping of business websites, Facebook Pages, and Instagram profiles — no Yelp, no third-party aggregator API.**

This is the highest-risk part of the project from a legal/durability standpoint, so the concerns are laid out explicitly below rather than buried. None of this is a reason the project can't work — plenty of lead-gen tools do exactly this — but each one is a real operational risk you're accepting, not a hypothetical.

### ⚠️ Concerns specific to this approach

**Legal / ToS**
- **Facebook/Instagram (Meta) actively and repeatedly sues scrapers.** Meta has pursued litigation against scraping operations even when the data scraped was "public" (e.g. suits over data scraping tools, cease-and-desist campaigns against scraping-as-a-service companies). Being sued is a cost even if you'd ultimately win or the claims are weak — it's legal fees and distraction you don't want early in a bootstrapped product.
- **CFAA / breach-of-contract exposure**: courts have been inconsistent here. *hiQ v. LinkedIn* held that scraping purely public, logged-out data is not a CFAA violation — but that case is specifically about *public* pages with no login wall. Anything behind a login, or any scraping that violates a platform's ToS you agreed to (or that a bot implicitly "agrees to" by using the site), still exposes you to breach-of-contract and civil claims even where CFAA doesn't apply.
- **Meta's ToS explicitly prohibit automated scraping** of Facebook and Instagram, full stop — this isn't ambiguous. Violating it risks account/IP bans and potential legal action, independent of whether the underlying data was "public."
- **Reselling scraped data as a paid subscription product raises the stakes** — a personal-use internal tool for your own lead gen is a very different risk profile than a SaaS product where you're commercially profiting from scraped platform data at scale. This is the point where "gray area" tools most often get legal attention.

**Technical / durability**
- Facebook and Instagram have some of the most aggressive anti-bot detection in the industry (fingerprinting, rate-limiting, CAPTCHA challenges, IP reputation blocking). A scraper built against their current HTML/DOM structure will break frequently and require constant maintenance — this is an ongoing engineering cost, not a one-time build.
- Business websites themselves vary wildly (some block scrapers via robots.txt or Cloudflare bot protection) — expect a non-trivial failure/skip rate.
- IP bans on your scraping infrastructure can cascade — if you're running this from a small number of servers, one ban can take down discovery for all users.

**Data/privacy**
- If any personal data (not just business data) gets pulled in incidentally — e.g. a page owner's personal profile info, comments, customer reviews with names — that starts to touch GDPR/CCPA territory if you store and process it, especially once it's part of a paid product with users beyond yourself.

### Practical middle ground worth considering
- **Facebook Graph API** (official) does expose *public Page* data (name, category, address, website, some contact info) for Pages that haven't restricted it — this is Meta's sanctioned way to get Page data, no scraping risk, though it has its own access-approval process for certain permissions.
- **Business's own website** is by far the lowest-risk target — you're a normal visitor loading a public page, same as any browser. This is where the accessibility/performance scoring work (§5) already lives, so no change needed there.
- Scraping Instagram/Facebook profile pages directly (not via API) is the piece I'd flag as needing your explicit sign-off with eyes open, given the above — especially once it's a revenue-generating product with other people's money attached.

I'll build the design doc around your direct-scraping approach as requested — just wanted these risks on paper before agents start building against it, since "we already built it this way" makes the decision much stickier to revisit later.

## 5. Website Scoring — What "Accessibility Score" Means

Once a business's own website is identified, crawling *that* site directly (not a third-party index) is low legal risk — same as any visitor loading the page. Proposed scoring dimensions:

| Category | Signal source | Weight (starting point) |
|---|---|---|
| Existence/basics | Does a site resolve? HTTPS? Mobile viewport meta tag? | 15% |
| Accessibility (WCAG) | axe-core automated scan — contrast, alt text, ARIA, form labels | 30% |
| Performance | Lighthouse/PageSpeed Insights API — load time, Core Web Vitals | 20% |
| SEO basics | Title tags, meta description, structured data presence | 15% |
| Modernity/design signals | Last-modified headers, responsive breakpoints, broken links | 20% |

Each business report shows: overall score (A–F or 0–100), category breakdown, and a plain-English summary ("This site fails 12 WCAG contrast checks and takes 6.2s to load on mobile") — this becomes the actual sales copy for outreach.

**Tooling:** axe-core (open source, run headless via Puppeteer/Playwright) + Google PageSpeed Insights API (free, generous quota) covers most of this without building custom crawlers.

## 6. Tech Stack (proposed)

- **Frontend:** Next.js (React) — SSR for the marketing/public pages, client-rendered dashboard for results
- **Backend API:** Node.js (Next.js API routes, or a separate service) — handles auth, billing, results API, job orchestration
- **Scraping/crawling engine:** **Rust** — this is where the performance actually matters (thousands of concurrent HTTP fetches, HTML parsing, potential headless-browser rendering for JS-heavy pages like Instagram)
- **Job queue:** Redis-backed queue (BullMQ from Node side, or a Rust-native queue client) — acts as the handoff point between the Node backend and Rust workers
- **Database:** Postgres (business records, scores, users, subscriptions)
- **Auth + billing:** Clerk/Auth.js for auth, Stripe for subscription billing
- **Hosting:** Vercel (frontend) + Railway/Render/Fly.io (Rust workers + Redis + Postgres)

### 6a. Rust scraping engine — options

You have three real paths here, not mutually exclusive:

| Option | What it is | Fit |
|---|---|---|
| **spider** (spider-rs) | Full-featured open-source Rust web crawler — async, concurrent, respects robots.txt, has built-in rate limiting, proxy rotation support, and even Node/Python bindings if you ever want to call it from the JS side directly | **Best starting point** — actively maintained, built for exactly this kind of large-scale crawling, saves you from reinventing crawl-frontier/politeness logic |
| **reqwest + scraper** (build your own) | `reqwest` for HTTP, `scraper` (CSS-selector based, like BeautifulSoup) for HTML parsing | Good for simple static-HTML targets (most business websites for the accessibility scoring pass) — lighter weight than a full crawler framework |
| **headless_chrome** or **chromiumoxide** | Rust bindings to drive real headless Chrome | Needed for JS-rendered content — likely required for Instagram/Facebook since much of their content renders client-side, and for any business site that's a JS SPA |

**Recommended split:**
- Business website accessibility scans (§5) → `chromiumoxide`-driven headless Chrome with injected axe-core (see decision and implementation sketch below) — a real browser DOM is required for axe-core regardless of language, so this path always goes through headless Chrome rather than the lighter `reqwest`/`scraper` combo.
- ZIP-code business discovery (Facebook/Instagram/general web) → `spider` as the crawl engine, since it already handles concurrency, politeness/rate-limiting, and robots.txt — you'd layer your own extraction logic (CSS selectors or JS-rendered extraction via headless Chrome) on top.

**Decision: all-Rust pipeline, including accessibility scoring.** Drive headless Chrome from Rust and inject axe-core's JS directly into the page context — no separate Node/Playwright service.

**Recommended crate: `chromiumoxide`** — async, built on `tokio`, communicates with Chrome via the DevTools Protocol (CDP). (`headless_chrome` is a viable sync alternative if you prefer not to deal with async here, but since the rest of the pipeline — `spider`, `reqwest` — is async, `chromiumoxide` keeps everything on one runtime.)

**Implementation approach:**
1. Bundle a copy of `axe.min.js` (from the [axe-core releases](https://github.com/dequelabs/axe-core/releases)) as a static asset in the Rust worker — don't fetch it from a CDN at scan time, so scans don't depend on external uptime and don't leak the target URL to a third party per-request.
2. For each business website: launch a page via `chromiumoxide`, navigate to the URL, wait for network-idle/load event.
3. Inject axe-core into the page context via CDP's `Runtime.evaluate` (or `Page.addScriptToEvaluateOnNewDocument` if you want it present before page scripts run).
4. Execute `axe.run()` in-page (also via `Runtime.evaluate`, awaiting the JS Promise it returns) — this yields a JSON report of violations, passes, and incomplete checks.
5. Parse that JSON in Rust (`serde_json`) and map violations into your scoring rubric (§5) — e.g. count/weight violations by WCAG impact level (`critical`/`serious`/`moderate`/`minor`, which axe-core already tags each violation with).
6. Reuse the same Chrome instance/page pool for performance timing (Core Web Vitals via the `Performance` domain in CDP) and basic checks (viewport meta tag, HTTPS, title/meta description) — all gettable from the same loaded page without a second navigation.

**Sketch (illustrative, not final code):**
```rust
use chromiumoxide::{Browser, BrowserConfig};
use futures::StreamExt;

async fn scan_site(browser: &Browser, url: &str, axe_js: &str) -> serde_json::Value {
    let page = browser.new_page(url).await.unwrap();
    page.wait_for_navigation().await.unwrap();

    // Inject axe-core
    page.evaluate(axe_js).await.unwrap();

    // Run the audit and pull the JSON report back into Rust
    let report = page
        .evaluate("axe.run().then(r => JSON.stringify(r))")
        .await
        .unwrap()
        .into_value::<String>()
        .unwrap();

    serde_json::from_str(&report).unwrap()
}
```
This runs one scan per business sequentially per browser instance — for throughput, run a pool of Chrome instances/tabs concurrently (bounded by a semaphore, since headless Chrome is memory-hungry — each instance can be 100–300MB+, so pool size should be tuned against worker machine RAM rather than maxed out to match your HTTP-level concurrency).

**Trade-off worth knowing:** headless Chrome instances are far heavier than plain HTTP requests (`reqwest`/`spider`), both in memory and startup time. Plan for the accessibility-scoring worker to run at much lower concurrency than the discovery/crawling worker — they can be separate worker pools (both still Rust) so a memory-heavy scoring backlog doesn't starve discovery throughput.

## 7. Job Queue Contract (Node API ↔ Rust Workers)

This is the interface boundary between the two halves of the system, so it's worth pinning down precisely — agents building either side can work independently against this contract without needing to coordinate live.

### 7a. Queue choice

**Redis, using Redis Streams** rather than a plain list/pub-sub, or a Redis-backed library like `BullMQ` on the Node side. Streams give you: consumer groups (so you can run multiple Rust worker instances safely without double-processing a job), at-least-once delivery with explicit ack, and a persistent log you can replay/inspect for debugging. On the Rust side, use the `redis` crate directly (async, via `redis::aio`) rather than pulling in a full job-framework — the message contract below is simple enough not to need one.

Two streams (keep discovery and scoring separate so they can scale independently, per §6a's pooling note):
- `jobs:discovery` — ZIP → business list jobs
- `jobs:scoring` — business website → accessibility/performance score jobs

Plus one shared mechanism for status/results:
- `job_status:{job_id}` — a Redis hash, updated by the worker as it progresses, read by the API for polling
- Postgres remains the durable store for final results (§8) — Redis here is for job *coordination and live status*, not long-term storage

### 7b. Job payload schemas

**Enqueued to `jobs:discovery`** (Node → Rust):
```json
{
  "job_id": "uuid",
  "type": "discovery",
  "zip": "10940",
  "radius_miles": 5,
  "category_filter": null,
  "requested_by_user_id": "uuid",
  "enqueued_at": "2026-09-04T20:00:00Z"
}
```

**Worker progress updates** (Rust → `job_status:{job_id}` hash, polled or subscribed by Node):
```
status: "running" | "queued" | "completed" | "failed"
progress_current: 42
progress_total: 187          # e.g. businesses found so far / businesses to scan
stage: "crawling_sources" | "extracting_businesses" | "done"
error: null                  # populated only if status == "failed"
updated_at: "2026-09-04T20:03:12Z"
```

**On completion**, the Rust worker writes results to Postgres directly (not through Node) and sets `status: completed` on the status hash — Node's job is just to read status and results, never to be a pass-through for the payload itself. This avoids double-handling large result sets through Node unnecessarily.

**Enqueued to `jobs:scoring`** (triggered automatically once discovery finds a business with a website — either by the discovery worker enqueuing directly, or by a small "orchestrator" step in Node that watches discovery completion and fans out scoring jobs):
```json
{
  "job_id": "uuid",
  "type": "scoring",
  "business_id": "uuid",
  "website_url": "https://example.com",
  "parent_discovery_job_id": "uuid",
  "enqueued_at": "2026-09-04T20:03:15Z"
}
```

### 7c. Frontend progress reporting

Given discovery jobs can involve scanning many businesses and take anywhere from seconds to minutes, use **Server-Sent Events (SSE)** from the Node API rather than plain polling — simpler than WebSockets for this one-directional "push status updates" use case, and works fine through Vercel/most hosts without special infra.

Flow: frontend submits ZIP → Node enqueues discovery job, returns `job_id` immediately → frontend opens an SSE connection to `/api/jobs/{job_id}/stream` → Node subscribes to the `job_status:{job_id}` hash (via periodic read or Redis keyspace notifications) and forwards updates to the client → frontend renders a progress bar (`progress_current`/`progress_total`) and, ideally, streams in *individual business results* as their scoring jobs complete (query Postgres for newly-scored businesses tied to the parent discovery job, push those rows over the same SSE connection) — this is what makes the UI feel responsive rather than a single "please wait" spinner for a multi-minute job.

### 7d. Failure/retry behavior

- Redis Streams consumer groups give you automatic re-delivery of unacked messages (a worker that crashes mid-job doesn't lose the job — another worker instance picks it up after a claim-timeout).
- Distinguish **transient failures** (target site timed out, temporary block) — worth 2-3 automatic retries with backoff — from **permanent failures** (site doesn't exist, robots.txt disallows) — mark failed immediately, don't retry, surface to the user as "couldn't be scored" rather than silently dropping the business from results.
- Per-business scoring failures should never fail the parent discovery job — a business that can't be scored still shows up in the list with a "scan failed" state rather than disappearing.

## 8. Data Model (initial sketch)

```
businesses
  id, name, address, zip, lat, lng, category, phone, website_url,
  source (google_places | yelp | manual), source_id, last_fetched_at

site_scores
  id, business_id (fk), overall_score, accessibility_score,
  performance_score, seo_score, basics_score, raw_report (jsonb),
  scanned_at

zip_lookups
  zip, last_refreshed_at, business_count   -- cache freshness tracking

users / subscriptions
  standard auth + Stripe customer/subscription fields
```

## 9. Build Phases

**Phase 1 — Internal tool (your studio only)**
- Single ZIP lookup → business list → scores, no auth/billing, just for your own lead gen
- Validates the scoring rubric actually produces useful leads

**Phase 2 — Multi-user, still manual/invite**
- Add auth, save searches, maybe invite a few other agency friends to pressure-test

**Phase 3 — Public subscription product**
- Stripe billing, usage limits/tiers, self-serve signup, polished dashboard/report exports (PDF reports are a natural upsell — "send this to the business as a free audit")

## 10. Open Questions / Decisions Needed

1. Confirm scraping approach for Facebook/Instagram specifically vs. using the official Graph API for Page data (see §4 concerns) — this affects both legal exposure and how much ongoing scraper-maintenance work to budget for.
2. Refresh cadence — how "stale" can a ZIP's business list get before re-fetching? (cost vs. freshness tradeoff)
3. Do you want per-business PDF "audit reports" as a deliverable/upsell from day one, or add later?
4. Pricing model for the public version — per-search credits, monthly ZIP quota, or flat unlimited tiers?
5. How many businesses per ZIP realistically (dense urban ZIP could be 500+) — need pagination/limits on both discovery and scoring cost.

## 11. Legal/Compliance Notes

- Respect robots.txt when crawling individual business websites for scoring.
- Review ToS of whichever business-data API is chosen before reselling/caching results long-term — some restrict how long you can store data or require attribution.
- If eventually contacting businesses directly (outreach features), CAN-SPAM/TCPA considerations apply — out of scope for v1 but worth flagging now.
