# Staging smoke test before production rollout

Use a separate Supabase staging project with migrations 001–007 applied. Do
not point this exercise at the production project or use real student work.

1. Create one teacher and two student test accounts. Confirm a student cannot
   call teacher-only class, assignment, review or settings endpoints.
2. Create a class and assignment; enroll only one student. Confirm the other
   student cannot create a submission for it or read its telemetry/analysis.
3. Type and revise a draft, disconnect the API briefly, keep writing, restore
   connectivity and reload. Confirm the local draft and every replay event are
   preserved without duplicates.
4. Submit once. Confirm `submitted_at`, `is_late`, `submission_version`,
   immutable content and no further keystroke writes. Try two simultaneous
   saves and confirm one receives a conflict rather than silently overwriting.
5. Open teacher review. Confirm the AI-use score has evidence-confidence and
   limitations; no telemetry shows `Not assessed` rather than a green/low score.
   Confirm the reconstructed document matches the submitted text or displays
   a mismatch warning.
6. Flag or request revision with specific feedback. Confirm the student sees
   it, can edit only after revision request, and can resubmit. Confirm a plain
   pasted student-authored essay is not automatically treated as proven AI use.
7. Check teacher roster and dashboard counts against enrolled students and
   submitted (not draft) work. Check the threshold setting persists after a
   reload and that an AI-allowed assignment is not recommended for misconduct
   review solely on score.
8. Test a missing, expired and wrong-role token; malformed event payload;
   repeated chunk upload; archived class; over-limit essay; and HTML/script
   in submitted content. None should expose another user's data or run script.

Only after these checks pass should the production migration and deployments
proceed in the order in `supabase/PRODUCTION_MIGRATION_GUIDE.md`.
