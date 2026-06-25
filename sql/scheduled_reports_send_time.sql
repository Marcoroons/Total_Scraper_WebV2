-- ============================================================================
-- Scheduled-report send time — run ONCE in the Supabase SQL editor.
-- Adds the send_time column so scheduled email reports fire at a chosen time of
-- day (stored as HH:MM in Indochina Time, UTC+7). The app is column-safe and
-- defaults to 09:00 if this hasn't run yet, but run it so the chosen time sticks.
-- ============================================================================

ALTER TABLE public.scheduled_reports
    ADD COLUMN IF NOT EXISTS send_time text DEFAULT '09:00';

NOTIFY pgrst, 'reload schema';
