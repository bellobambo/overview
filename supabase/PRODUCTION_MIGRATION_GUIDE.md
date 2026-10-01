# Production migration 007

Migration `007_production_hardening.sql` is designed for the Supabase SQL editor.
It does not delete or rewrite student work. If duplicate submissions are present,
the entire transaction stops before applying any change.
Apply it only after migrations 001–006 exist. Keep the existing API deployment
running during the SQL change; deploy the new backend only after verification,
then deploy the new frontend. Do not paste service-role credentials into the
browser or the SQL editor.

## 1. Back up first

Create a Supabase database backup or point-in-time recovery checkpoint.

## 2. Run this preflight query

```sql
select
  student_id,
  assignment_id,
  count(*) as duplicate_count,
  array_agg(id order by updated_at desc nulls last, created_at desc) as submission_ids
from public.submissions
group by student_id, assignment_id
having count(*) > 1;
```

The expected result is zero rows. If rows are returned, do not delete them
blindly: decide which submission is canonical and preserve or merge its
keystroke logs first.

Confirm the current database already has the prerequisite tables and columns:

```sql
select to_regclass('public.teacher_settings') as teacher_settings,
       to_regclass('public.keystroke_logs') as keystroke_logs;

select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'submissions'
  and column_name in ('final_html', 'analysis_data', 'ai_score');
```

## 3. Apply the migration

Paste the complete contents of `supabase/migrations/007_production_hardening.sql`
into the Supabase SQL editor and run it once.

## 4. Verification queries

```sql
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.submissions'::regclass;

select schemaname, tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

select indexname
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'submissions_student_assignment_unique',
    'keystroke_logs_submission_chunk_unique',
    'keystroke_logs_client_batch_unique'
  );

select table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
  and table_name in ('profiles', 'classes', 'class_members', 'assignments',
                     'submissions', 'keystroke_logs', 'teacher_settings');

select role_name, table_name,
       has_table_privilege(role_name, 'public.' || table_name, 'SELECT') as can_select,
       has_table_privilege(role_name, 'public.' || table_name, 'INSERT') as can_insert,
       has_table_privilege(role_name, 'public.' || table_name, 'UPDATE') as can_update
from (values ('anon'), ('authenticated')) as roles(role_name)
cross join (values ('profiles'), ('classes'), ('class_members'), ('assignments'),
                   ('submissions'), ('keystroke_logs'), ('teacher_settings')) as tables(table_name);
```

The old `Service role full access` policies must be absent. The application
backend continues to use `service_role`; the browser uses Supabase only for
authentication and accesses application data through the Express API.
The grants query should return zero rows and every effective privilege should
be false for `anon` and `authenticated`. An empty
`teacher_settings` table is safe; the API will create settings on first use.
