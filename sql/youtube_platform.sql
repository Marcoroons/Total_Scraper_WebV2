-- ============================================================================
-- YouTube as a first-class scrape platform (Shorts + Video).
-- Run ONCE in the Supabase SQL editor. All statements are idempotent.
-- ----------------------------------------------------------------------------
-- Three GLOBAL data tables mirroring the IG / TikTok shapes — NO `project_id`,
-- matching the convention used by ig_/tiktok_campaign_videos|influencer_profiles|
-- comments. (Contrast: the existing `youtube_videos` table is project-scoped
-- and belongs to the gated "YouTube Intelligence" job type — that table is
-- deliberately untouched here.)
--
-- YouTube-specific columns on top of the mirrored shape:
--   view_count       — public view count (genuinely populated for YouTube)
--   subscribers      — YouTube's equivalent of followers (kept alongside
--                      `followers` so shared export code that reads `followers`
--                      still works)
--   duration_seconds — Shorts vs long-form distinction often hinges on this
--   is_short         — explicit Shorts flag (URL contains /shorts/ OR duration < ~60s)
--   video_id         — YouTube's 11-char video id
--   transcript       — downloaded subtitles/auto-captions (Whisper bypass)
--   hashtags         — actor returns these
-- ============================================================================

-- ── youtube_campaign_videos (one row per video, mirrors ig_/tiktok_campaign_videos)
CREATE TABLE IF NOT EXISTS public.youtube_campaign_videos (
    video_url           text PRIMARY KEY,
    username            text,                  -- channel handle / uploader
    play_count          bigint DEFAULT 0,
    view_count          bigint DEFAULT 0,      -- YouTube's real public view count
    likes               bigint DEFAULT 0,
    comments            bigint DEFAULT 0,
    shares              bigint DEFAULT 0,      -- nullable in payloads; YouTube actors don't expose shares
    duration_seconds    int,
    is_short            boolean,
    video_id            text,
    title               text,
    transcript          text,
    hashtags            text[],
    subscribers         bigint,
    followers           bigint,                -- alias for subscribers; shared export code reads this
    scraped_at          timestamptz NOT NULL DEFAULT now()
);

-- ── youtube_influencer_profiles (one row per scraped post for a channel)
CREATE TABLE IF NOT EXISTS public.youtube_influencer_profiles (
    post_url            text NOT NULL,
    username            text NOT NULL,
    caption             text,
    play_count          bigint DEFAULT 0,
    view_count          bigint DEFAULT 0,
    likes               bigint DEFAULT 0,
    comments            bigint DEFAULT 0,
    shares              bigint DEFAULT 0,
    post_date           text,
    content_type        text,                  -- 'Video' | 'Short'
    duration_seconds    int,
    is_short            boolean,
    video_id            text,
    title               text,
    transcript          text,
    hashtags            text[],
    subscribers         bigint,
    followers           bigint,                -- alias for subscribers
    scraped_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT youtube_influencer_profiles_unique UNIQUE (username, post_url)
);

CREATE INDEX IF NOT EXISTS youtube_influencer_profiles_username_idx
    ON public.youtube_influencer_profiles (username);

-- ── youtube_comments (one row per comment, mirrors ig_/tiktok_comments)
CREATE TABLE IF NOT EXISTS public.youtube_comments (
    video_url             text NOT NULL,
    influencer_username   text,
    commenter_username    text,
    comment_text          text,
    likes                 bigint,
    scraped_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT youtube_comments_unique
        UNIQUE (video_url, commenter_username, comment_text)
);

CREATE INDEX IF NOT EXISTS youtube_comments_video_idx
    ON public.youtube_comments (video_url);

-- ----------------------------------------------------------------------------
-- ADD COLUMN IF NOT EXISTS guards — safe to re-run after the initial create.
-- Mirrors the pattern used by follower_engagement.sql / view_count.sql so the
-- schema can be evolved incrementally without dropping the table.
-- ----------------------------------------------------------------------------
ALTER TABLE public.youtube_campaign_videos      ADD COLUMN IF NOT EXISTS transcript       text;
ALTER TABLE public.youtube_campaign_videos      ADD COLUMN IF NOT EXISTS hashtags         text[];
ALTER TABLE public.youtube_campaign_videos      ADD COLUMN IF NOT EXISTS duration_seconds int;
ALTER TABLE public.youtube_campaign_videos      ADD COLUMN IF NOT EXISTS is_short         boolean;
ALTER TABLE public.youtube_campaign_videos      ADD COLUMN IF NOT EXISTS video_id         text;
ALTER TABLE public.youtube_campaign_videos      ADD COLUMN IF NOT EXISTS subscribers      bigint;
ALTER TABLE public.youtube_campaign_videos      ADD COLUMN IF NOT EXISTS followers        bigint;

ALTER TABLE public.youtube_influencer_profiles  ADD COLUMN IF NOT EXISTS transcript       text;
ALTER TABLE public.youtube_influencer_profiles  ADD COLUMN IF NOT EXISTS hashtags         text[];
ALTER TABLE public.youtube_influencer_profiles  ADD COLUMN IF NOT EXISTS duration_seconds int;
ALTER TABLE public.youtube_influencer_profiles  ADD COLUMN IF NOT EXISTS is_short         boolean;
ALTER TABLE public.youtube_influencer_profiles  ADD COLUMN IF NOT EXISTS video_id         text;
ALTER TABLE public.youtube_influencer_profiles  ADD COLUMN IF NOT EXISTS title            text;
ALTER TABLE public.youtube_influencer_profiles  ADD COLUMN IF NOT EXISTS subscribers      bigint;
ALTER TABLE public.youtube_influencer_profiles  ADD COLUMN IF NOT EXISTS followers        bigint;

NOTIFY pgrst, 'reload schema';
