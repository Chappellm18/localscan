-- Complete the DESIGN.md scoring rubric's fifth category.
ALTER TABLE site_scores
    ADD COLUMN IF NOT EXISTS modernity_score REAL NOT NULL DEFAULT 0;
