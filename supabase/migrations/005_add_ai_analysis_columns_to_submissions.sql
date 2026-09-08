-- ============================================
-- Migration 005: Add ai_score and analysis_data to submissions
-- Run this in: Supabase Dashboard -> SQL Editor
-- ============================================

-- 1. Add ai_score column (0 to 100) to submissions for fast indexing and query filtering
ALTER TABLE submissions
    ADD COLUMN IF NOT EXISTS ai_score REAL;

-- 2. Add analysis_data JSONB column to cache full telemetry and segment forensic reports
ALTER TABLE submissions
    ADD COLUMN IF NOT EXISTS analysis_data JSONB;

-- 3. Create an index on ai_score to support instant sorting and filtering by risk level
CREATE INDEX IF NOT EXISTS idx_submissions_ai_score ON submissions(ai_score);
