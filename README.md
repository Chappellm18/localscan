# LocalScan

ZIP-code business discovery + web accessibility scoring. See `DESIGN.md` for
the full design doc (architecture, data model, job queue contract, scoring
rubric, legal notes) — this README is just setup/run instructions.

## Layout

```
localscan/
├── DESIGN.md              # full design doc — read this first
├── docker-compose.yml     # local Redis + Postgres
├── db/migrations/         # SQL schema (§8)
├── apps/web/               # Next.js frontend + API routes (Node)
│   └── src/app/api/jobs/   # enqueue + SSE status endpoints (§7)
└── workers/                # Rust workspace
    └── crates/
        ├── common/         # shared job schemas + Redis helpers (§7)
        ├── discovery/       # ZIP → business list worker (§4)
        └── scoring/         # website → accessibility score worker (§5, §6a)
```

## Prerequisites

- Node 20+ and a package manager (npm/pnpm/yarn)
- Rust (stable) via [rustup](https://rustup.rs)
- Docker (for local Redis + Postgres)
- A downloaded axe-core release — see
  `workers/crates/scoring/assets/axe.min.js` for the placeholder and
  download instructions (§6a)

## First-time setup

```bash
cp .env.example .env          # fill in as needed
docker compose up -d          # starts redis + postgres

# apply the schema
psql "$DATABASE_URL" -f db/migrations/001_init.sql
psql "$DATABASE_URL" -f db/migrations/002_add_discovery_job_id.sql

# frontend deps
cd apps/web && npm install && cd ../..

# rust build (also validates the workspace compiles)
cd workers && cargo build && cd ..
```

## Running everything locally

On Windows, the boot script starts the web app, workers, and dependency log
stream as hidden processes and opens a single-screen dashboard at
`http://localhost:3000/boot`. The dashboard shows live service status and
recent output, so no separate command windows are required:

```powershell
.\start-localscan.ps1 -ProjectRoot "C:\path\to\localscan"
```

The launcher pins Next.js to port `3000`, so the dashboard at
`http://localhost:3000/boot` and the main site at `http://localhost:3000/`
always use the same server. If another process already owns port 3000, stop
that process before starting LocalScan.

The individual commands can still be run manually when needed:

```bash
# 1. dependencies (if not already running)
docker compose up

# 2. frontend + API
cd apps/web && npm run dev

# 3. discovery worker
cd workers && REDIS_URL=$REDIS_URL DATABASE_URL=$DATABASE_URL cargo run --bin discovery-worker

# 4. scoring worker
cd workers && REDIS_URL=$REDIS_URL DATABASE_URL=$DATABASE_URL cargo run --bin scoring-worker
```

Then `POST /api/jobs/discover` with `{ "zip": "10940" }` to kick off a run,
and open an SSE connection to `/api/jobs/{jobId}/stream` to watch progress.

## What's scaffolded vs. what's a stub

This is a working skeleton, not a finished product. Wired up end-to-end:
queue contract, status reporting, SSE streaming, Postgres schema, worker
process structure, axe-core injection mechanics.

**Explicitly stubbed / needs real implementation:**
- `workers/crates/discovery/src/sources.rs` — the actual crawl logic per
  source (business websites, Facebook, Instagram). See DESIGN.md §4 for
  the source decision and the concerns flagged on each.
- `workers/crates/discovery/src/extract.rs` — field normalization/dedup
  across sources.
- `workers/crates/scoring/src/rubric.rs` — performance and SEO scoring are
  placeholder/neutral values; only accessibility (via axe-core) and basics
  are real. The "modernity" scoring category from DESIGN.md §5 isn't
  implemented yet.
- Auth/billing (`apps/web` has no auth wired up yet — Phase 1 per §9 is
  single-user, no login).
- The SSE route's incremental per-business result streaming (marked as a
  TODO in `stream/route.ts`) — currently only forwards job status, not
  individual scored businesses as they land.

## Next steps

Pick one thread from DESIGN.md §10 (open questions) or the stub list above
— probably `sources.rs` first, since nothing else can be tested end-to-end
without at least one real data source working.
