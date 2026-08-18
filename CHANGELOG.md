# Backend Updates (Local -> Remote Sync)

Here is a comprehensive breakdown of the code changes applied locally since the last remote pull on `origin/master`. This details exactly what is different in the repository and why the changes were made, ensuring full context for the remote team before they pull.

## 1. Request Parsing (`src/index.ts`)
- **JSON Body Limit Bump**: Increased the `express.json` parser limit to `50mb` (`app.use(express.json({ limit: '50mb' }))`). This is required to ingest the large, batched keystroke arrays generated during long student writing sessions without throwing `Payload Too Large` errors.

## 2. Authentication & Middleware (`src/middleware/auth.ts` & `src/types/express.d.ts`)
- **Role Hydration**: Updated the core `authenticate` middleware to perform a Supabase lookup on the `profiles` table to fetch the user's role. 
- **Express Type Extension**: Extended the global `Express.User` type in `src/types/express.d.ts` to include `role?: UserRole` so the role propagates seamlessly through the `req.user` object.
- **RBAC Middleware**: Added new `requireTeacher` and `requireStudent` middleware functions to enforce role-based access control directly at the router level.

## 3. Database Type Updates (`src/types/database.ts`)
- **Status Enums**: Expanded the `SubmissionStatus` type to include `'revision_requested'` and `'flagged'` alongside the existing statuses.
- **Keystroke Interfaces**: Added the `StepEvent` and `KeystrokeEvent` interfaces to securely type the incoming rich-text ProseMirror/Tiptap formatting events.
- **Join Typings**: Extended the `Submission` interface to include `profiles?: { full_name: string | null }` to support our nested Supabase table joins.

## 4. Keystroke Ingestion & Retrieval (`src/routes/keystrokes.ts`)
- **POST Normalization**: The `POST /` ingestion route now safely normalizes event types (`event.type.toLowerCase()`) and forcibly injects `chunk_seq` and `server_received_at` timestamps to ensure tamper-proof chronological ordering.
- **GET Access Control**: Heavily hardened `GET /:submissionId`. Students can only fetch their own logs. Teachers can only fetch logs if they own the parent assignment.
- **Idempotency & Deduplication**: Added a custom `Map`-based deduplication filter in the `GET` route keyed on `${chunk_seq}_${timestamp}`. This ensures that if the frontend accidentally double-fires a payload (due to a flaky network or fast retries), the playback engine receives a perfectly clean, sorted array.

## 5. Submission Management & Grading (`src/routes/submissions.ts`)
- **Duplicate Submission Prevention**: Updated `POST /` to check if a submission already exists for the given `assignment_id` and `student_id`. If one exists, it safely returns the existing record instead of throwing a unique constraint error.
- **Grading Route**: Added a new `PATCH /:id/grade` endpoint specifically for teachers. It validates the new status enums (`graded`, `revision_requested`, `flagged`) and verifies teacher assignment ownership before applying the update.

## 6. Empty-State Query Safety (`src/routes/submissions.ts`, `assignments.ts`, `classes.ts`)
- **The Issue**: Supabase's PostgREST API throws a 500 Server Error if an empty array `[]` is passed into an `.in()` filter clause.
- **The Fix**: Added defensive early-return guards. If the mapped `classIds` or `assignmentIds` arrays are empty (`length === 0`), the routes immediately short-circuit the database call and return a clean `200 OK` with an empty array. This prevents dashboard crashes for new users who have zero classes or assignments.
