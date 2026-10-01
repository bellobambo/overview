-- Overview production hardening migration
-- Safe to run in the Supabase SQL editor. The transaction aborts before making
-- any changes if duplicate student/assignment submissions already exist.

BEGIN;

-- Preflight: the application expects exactly one submission per student and
-- assignment. Do not silently delete or merge existing student work.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.submissions
        GROUP BY student_id, assignment_id
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION
            'Migration stopped safely: duplicate submissions exist. Run the duplicate preflight query and resolve them before retrying.';
    END IF;
END
$$;

-- Bring the database state machine in line with the API and UI.
ALTER TABLE public.submissions
    DROP CONSTRAINT IF EXISTS submissions_status_check;

ALTER TABLE public.submissions
    ADD CONSTRAINT submissions_status_check
    CHECK (status IN ('draft', 'submitted', 'graded', 'revision_requested', 'flagged'));

-- Submission lifecycle and analysis-cache metadata.
ALTER TABLE public.submissions
    ADD COLUMN IF NOT EXISTS submission_version INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS is_late BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS teacher_feedback TEXT,
    ADD COLUMN IF NOT EXISTS analysis_revision INTEGER,
    ADD COLUMN IF NOT EXISTS analysis_model_version TEXT,
    ADD COLUMN IF NOT EXISTS analysis_generated_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS submissions_student_assignment_unique
    ON public.submissions (student_id, assignment_id);

-- Persist chunk identity outside the JSON payload so retries are idempotent.
ALTER TABLE public.keystroke_logs
    ADD COLUMN IF NOT EXISTS chunk_seq INTEGER,
    ADD COLUMN IF NOT EXISTS client_batch_id TEXT,
    ADD COLUMN IF NOT EXISTS event_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS server_received_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS keystroke_logs_submission_chunk_unique
    ON public.keystroke_logs (submission_id, chunk_seq);

CREATE UNIQUE INDEX IF NOT EXISTS keystroke_logs_client_batch_unique
    ON public.keystroke_logs (submission_id, client_batch_id);

CREATE INDEX IF NOT EXISTS idx_class_members_user_id
    ON public.class_members (user_id);
CREATE INDEX IF NOT EXISTS idx_assignments_class_id
    ON public.assignments (class_id);
CREATE INDEX IF NOT EXISTS idx_assignments_teacher_id
    ON public.assignments (teacher_id);
CREATE INDEX IF NOT EXISTS idx_submissions_assignment_id
    ON public.submissions (assignment_id);
CREATE INDEX IF NOT EXISTS idx_submissions_student_id
    ON public.submissions (student_id);
CREATE INDEX IF NOT EXISTS idx_keystroke_logs_submission_id
    ON public.keystroke_logs (submission_id);

-- Keep updated_at accurate for sorting, cache invalidation, and audit history.
CREATE OR REPLACE FUNCTION public.overview_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;
CREATE TRIGGER profiles_set_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.overview_set_updated_at();

DROP TRIGGER IF EXISTS classes_set_updated_at ON public.classes;
CREATE TRIGGER classes_set_updated_at
    BEFORE UPDATE ON public.classes
    FOR EACH ROW EXECUTE FUNCTION public.overview_set_updated_at();

DROP TRIGGER IF EXISTS assignments_set_updated_at ON public.assignments;
CREATE TRIGGER assignments_set_updated_at
    BEFORE UPDATE ON public.assignments
    FOR EACH ROW EXECUTE FUNCTION public.overview_set_updated_at();

DROP TRIGGER IF EXISTS submissions_set_updated_at ON public.submissions;
CREATE TRIGGER submissions_set_updated_at
    BEFORE UPDATE ON public.submissions
    FOR EACH ROW
    WHEN (OLD.final_text IS DISTINCT FROM NEW.final_text
       OR OLD.final_html IS DISTINCT FROM NEW.final_html
       OR OLD.status IS DISTINCT FROM NEW.status
       OR OLD.teacher_feedback IS DISTINCT FROM NEW.teacher_feedback)
    EXECUTE FUNCTION public.overview_set_updated_at();

-- Migration 001 accidentally granted every API role full access. The backend
-- uses the service-role client and continues to function because service_role
-- bypasses RLS. Browser clients are intentionally denied direct table access.
DROP POLICY IF EXISTS "Service role full access" ON public.profiles;
DROP POLICY IF EXISTS "Service role full access" ON public.classes;
DROP POLICY IF EXISTS "Service role full access" ON public.class_members;
DROP POLICY IF EXISTS "Service role full access" ON public.assignments;
DROP POLICY IF EXISTS "Service role full access" ON public.submissions;
DROP POLICY IF EXISTS "Service role full access" ON public.keystroke_logs;

REVOKE ALL ON TABLE public.profiles FROM anon, authenticated;
REVOKE ALL ON TABLE public.classes FROM anon, authenticated;
REVOKE ALL ON TABLE public.class_members FROM anon, authenticated;
REVOKE ALL ON TABLE public.assignments FROM anon, authenticated;
REVOKE ALL ON TABLE public.submissions FROM anon, authenticated;
REVOKE ALL ON TABLE public.keystroke_logs FROM anon, authenticated;
REVOKE ALL ON TABLE public.teacher_settings FROM anon, authenticated;
REVOKE ALL ON TABLE public.profiles, public.classes, public.class_members,
    public.assignments, public.submissions, public.keystroke_logs,
    public.teacher_settings FROM PUBLIC;

GRANT ALL ON TABLE public.profiles TO service_role;
GRANT ALL ON TABLE public.classes TO service_role;
GRANT ALL ON TABLE public.class_members TO service_role;
GRANT ALL ON TABLE public.assignments TO service_role;
GRANT ALL ON TABLE public.submissions TO service_role;
GRANT ALL ON TABLE public.keystroke_logs TO service_role;
GRANT ALL ON TABLE public.teacher_settings TO service_role;

COMMIT;

