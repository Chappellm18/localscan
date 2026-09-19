-- Add discovery job ownership to databases initialized before 001_init.sql
-- started defining the column.

ALTER TABLE businesses
    ADD COLUMN IF NOT EXISTS discovery_job_id UUID;

CREATE INDEX IF NOT EXISTS idx_businesses_discovery_job_id
    ON businesses (discovery_job_id);
