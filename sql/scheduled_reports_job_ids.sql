-- ============================================================================
-- Scheduled-report concrete-job binding — run ONCE in the Supabase SQL editor.
-- Adds a `job_ids uuid[]` column so a scheduled email is bound to the specific
-- jobs the user selected at schedule time, instead of the old filter-based
-- approach where the worker re-queried at send time and could pick up new
-- jobs the user never authorised.
--
-- The app is column-safe — it retries without job_ids if this migration hasn't
-- run yet — but existing schedules will keep behaving in the old filter mode
-- (worker falls back to the job_types + date_range filter). New schedules
-- created after this runs will bind to specific jobs.
-- ============================================================================

ALTER TABLE public.scheduled_reports
    ADD COLUMN IF NOT EXISTS job_ids uuid[] DEFAULT '{}'::uuid[];

NOTIFY pgrst, 'reload schema';
