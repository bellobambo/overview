-- ============================================
-- Migration 004: Add is_archived to classes and assignments
-- Run this in: Supabase Dashboard → SQL Editor
-- ============================================

-- 1. Add is_archived to classes (default false so all existing rows remain active).
ALTER TABLE classes
    ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;

-- 2. Add is_archived to assignments (default false so all existing rows remain active).
ALTER TABLE assignments
    ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;
