-- ============================================================================
-- Generated (cached) reports — Feature B.
-- Users can generate an Excel, save it to Supabase Storage, browse the list,
-- and either download / delete / email-now / attach-to-schedule. Auto-purge
-- after 7 days keeps the bucket bounded.
--
-- MANUAL STEP required in Supabase dashboard BEFORE running this migration:
--   Storage → New bucket
--     Name:   generated-reports
--     Public: OFF (we serve via signed URLs from the API)
--     Restrict file MIME types: OFF (or restrict to spreadsheet types if you want)
--
-- This migration:
--   1. Creates the `generated_reports` table (metadata + storage_path pointer).
--   2. Adds `generated_report_id` to `scheduled_reports` so a schedule can
--      email a pre-generated saved xlsx instead of regenerating on each fire.
--   3. Runs a NOTIFY so PostgREST picks up both changes without a restart.
-- Idempotent — safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.generated_reports (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id        uuid NOT NULL,
    created_by        uuid NOT NULL,
    filename          text NOT NULL,
    storage_path      text NOT NULL,           -- path within the `generated-reports` bucket
    job_ids           uuid[] DEFAULT '{}'::uuid[],
    job_types         text[] DEFAULT '{}'::text[],
    platforms         text[] DEFAULT '{}'::text[],
    file_size_bytes   bigint,
    expires_at        timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS generated_reports_project_idx
    ON public.generated_reports (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS generated_reports_expiry_idx
    ON public.generated_reports (expires_at)
    WHERE expires_at IS NOT NULL;

-- Bind a scheduled_report to a saved xlsx. When set, the worker downloads
-- and emails the saved file rather than regenerating from job_ids. Nullable —
-- existing filter/job-ids schedules keep working unchanged.
ALTER TABLE public.scheduled_reports
    ADD COLUMN IF NOT EXISTS generated_report_id uuid;

NOTIFY pgrst, 'reload schema';
