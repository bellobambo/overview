-- ============================================
-- Migration 003: Add join_code to classes
-- Run this in: Supabase Dashboard → SQL Editor
-- ============================================

-- 1. Add the column (nullable first so existing rows don't violate NOT NULL).
ALTER TABLE classes
    ADD COLUMN IF NOT EXISTS join_code TEXT;

-- 2. Back-fill any existing classes with a unique 8-character uppercase code.
UPDATE classes
SET join_code = upper(substr(md5(id::text || random()::text), 1, 8))
WHERE join_code IS NULL;

-- 3. Now enforce NOT NULL + UNIQUE.
ALTER TABLE classes
    ALTER COLUMN join_code SET NOT NULL;

ALTER TABLE classes
    ADD CONSTRAINT classes_join_code_unique UNIQUE (join_code);
