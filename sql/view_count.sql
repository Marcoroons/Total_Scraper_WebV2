-- Adds a separate view_count column to the profile-audit data tables so the
-- worker can store Instagram's videoViewCount (reach) distinctly from
-- videoPlayCount (total plays). The worker upsert is column-safe, so it keeps
-- working until this runs; afterwards the "View Count" metric in the Excel
-- builder reflects real values where Instagram provides them (it often merges
-- the two now, in which case view_count mirrors play_count).
ALTER TABLE public.ig_influencer_profiles     ADD COLUMN IF NOT EXISTS view_count bigint;
ALTER TABLE public.tiktok_influencer_profiles ADD COLUMN IF NOT EXISTS view_count bigint;
