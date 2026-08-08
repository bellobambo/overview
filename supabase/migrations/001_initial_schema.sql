-- ============================================
-- Overview Backend — Full Supabase Migration
-- Run this in: Supabase Dashboard → SQL Editor
-- ============================================

-- 1. Profiles (extends Supabase Auth users)
CREATE TABLE IF NOT EXISTS profiles (
    id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name   TEXT,
    role        TEXT CHECK (role IN ('teacher', 'student', 'admin')),
    class_ids   UUID[] DEFAULT '{}',
    school_id   UUID,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- 2. Classes
CREATE TABLE IF NOT EXISTS classes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- 3. Class Members (join table)
CREATE TABLE IF NOT EXISTS class_members (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id    UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    joined_at   TIMESTAMPTZ DEFAULT now(),
    UNIQUE (class_id, user_id)
);

-- 4. Assignments
CREATE TABLE IF NOT EXISTS assignments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    class_id    UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT,
    due_date    TIMESTAMPTZ,
    word_limit  INTEGER,
    ai_policy   TEXT CHECK (ai_policy IN ('allowed', 'restricted', 'forbidden')),
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- 5. Submissions
CREATE TABLE IF NOT EXISTS submissions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    assignment_id  UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    final_text     TEXT,
    final_html     TEXT,
    status         TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'graded')),
    created_at     TIMESTAMPTZ DEFAULT now(),
    updated_at     TIMESTAMPTZ DEFAULT now()
);

-- 6. Keystroke Logs
CREATE TABLE IF NOT EXISTS keystroke_logs (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id  UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    events         JSONB NOT NULL DEFAULT '[]',
    created_at     TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- Enable Row Level Security on all tables
-- ============================================
ALTER TABLE profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE classes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystroke_logs ENABLE ROW LEVEL SECURITY;

-- ============================================
-- Basic RLS Policies (allow service_role full access)
-- Your backend uses the service_role key, so these
-- ensure it can read/write everything. Add more
-- granular policies later for client-side access.
-- ============================================
CREATE POLICY "Service role full access" ON profiles       FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON classes        FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON class_members  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON assignments    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON submissions    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON keystroke_logs FOR ALL USING (true) WITH CHECK (true);
