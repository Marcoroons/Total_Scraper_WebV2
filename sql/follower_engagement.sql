-- Follower-based engagement rate for image posts (which have no view count).
-- scrape_jobs.fetch_followers: set when the user ticks "Fetch follower count" on
--   the Profile Tracker (only offered for post-related Instagram scrapes).
-- *_influencer_profiles.followers: the creator's follower count captured by the
--   worker's extra details lookup, used as the engagement-rate denominator for
--   photos/carousels at export time. Both the jobs API insert and the worker
--   upsert are column-safe, so they keep working until this runs.
ALTER TABLE public.scrape_jobs               ADD COLUMN IF NOT EXISTS fetch_followers boolean DEFAULT false;
ALTER TABLE public.ig_influencer_profiles     ADD COLUMN IF NOT EXISTS followers bigint;
ALTER TABLE public.tiktok_influencer_profiles ADD COLUMN IF NOT EXISTS followers bigint;
