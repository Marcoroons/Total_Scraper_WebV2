-- ============================================================================
-- Capture the post's ACTUAL posted date on trend_discovery rows so KOL Finder
-- can filter "creators who posted in the last N days" instead of mixing fresh
-- content with stale finds. Run ONCE in the Supabase SQL editor.
--
-- The worker's upsert is column-safe — it falls back to a no-date payload if
-- this hasn't been applied yet, so this can run any time.
-- ============================================================================

ALTER TABLE public.trend_discovery
    ADD COLUMN IF NOT EXISTS posted_at timestamptz;

CREATE INDEX IF NOT EXISTS trend_discovery_posted_at_idx
    ON public.trend_discovery (posted_at DESC NULLS LAST);

NOTIFY pgrst, 'reload schema';
