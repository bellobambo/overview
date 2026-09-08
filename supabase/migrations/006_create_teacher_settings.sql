-- ============================================
-- Migration 006: Create teacher_settings table
-- Run this in: Supabase Dashboard -> SQL Editor
-- ============================================

CREATE TABLE IF NOT EXISTS teacher_settings (
    teacher_id      UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    flag_threshold  INTEGER NOT NULL DEFAULT 70 CHECK (flag_threshold IN (60, 70, 80)),
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE teacher_settings ENABLE ROW LEVEL SECURITY;

-- Policy: Teachers can view own settings
CREATE POLICY "Teachers can view own settings"
    ON teacher_settings FOR SELECT
    USING (auth.uid() = teacher_id);

-- Policy: Teachers can insert own settings
CREATE POLICY "Teachers can insert own settings"
    ON teacher_settings FOR INSERT
    WITH CHECK (auth.uid() = teacher_id);

-- Policy: Teachers can update own settings
CREATE POLICY "Teachers can update own settings"
    ON teacher_settings FOR UPDATE
    USING (auth.uid() = teacher_id)
    WITH CHECK (auth.uid() = teacher_id);
