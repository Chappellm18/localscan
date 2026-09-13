-- Initial schema, per DESIGN.md §8.
-- Run with: psql $DATABASE_URL -f db/migrations/001_init.sql
-- (or wire up via sqlx-cli / your migration tool of choice — this repo
-- doesn't pin one yet, see README.md)

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE businesses (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            TEXT NOT NULL,
    address         TEXT,
    zip             TEXT NOT NULL,
    lat             DOUBLE PRECISION,
    lng             DOUBLE PRECISION,
    category        TEXT,
    phone           TEXT,
    website_url     TEXT,
    source          TEXT NOT NULL, -- 'business_website' | 'facebook' | 'instagram'
    source_id       TEXT NOT NULL,
    last_fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (source, source_id)
);

CREATE INDEX idx_businesses_zip ON businesses (zip);

CREATE TABLE site_scores (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id          UUID NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
    overall_score        REAL NOT NULL,
    accessibility_score  REAL NOT NULL,
    performance_score    REAL NOT NULL,
    seo_score            REAL NOT NULL,
    basics_score         REAL NOT NULL,
    raw_report           JSONB NOT NULL,
    scanned_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_site_scores_business_id ON site_scores (business_id);

CREATE TABLE zip_lookups (
    zip               TEXT PRIMARY KEY,
    last_refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    business_count    INTEGER NOT NULL DEFAULT 0
);

-- Users/subscriptions: kept minimal for now — Phase 1 (DESIGN.md §9) has
-- no auth. Fill this in properly when Phase 2 adds multi-user support;
-- exact shape will depend on whether Clerk/Auth.js manages user records
-- itself (likely) vs. needing a full local `users` table.
CREATE TABLE users (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email             TEXT NOT NULL UNIQUE,
    stripe_customer_id TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
