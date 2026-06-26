-- ============================================================================
-- Competitor Analysis Phase 1 — Shopee + Tokopedia listings.
-- Run ONCE in the Supabase SQL editor. Both statements are idempotent.
-- ----------------------------------------------------------------------------
-- Schema design notes:
--   * One row per product variation (a Shopee listing with flavour × size SKUs
--     becomes N rows). When the source has no variations, variation_id is ''
--     (empty string, not NULL) so the UNIQUE constraint behaves predictably —
--     PostgreSQL treats NULLs as distinct in unique constraints, which would
--     otherwise let the same listing be inserted multiple times.
--   * parse_confidence starts at 'raw' in Phase 1. Phase 2 (Bahasa enrichment)
--     will flip it to 'high' or 'needs_review' once bundle/volume/container
--     parsing runs and stores results in the enrichment columns.
--   * raw_payload preserves the actor's untouched response so Phase 2 can
--     re-parse without a fresh scrape.
--   * job_id is nullable (job rows can be deleted; listings should persist).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ecom_listings (
    listing_id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id            uuid NOT NULL,
    job_id                uuid,
    product_id            text NOT NULL,
    variation_id          text NOT NULL DEFAULT '',
    platform              text NOT NULL,                -- 'Shopee' | 'Tokopedia'
    shop_name             text,
    shop_url              text,
    is_official_store     boolean,
    brand_name            text,
    title                 text NOT NULL,
    description           text,
    listing_price_idr     numeric(14,2),

    -- Phase 2 enrichment columns (nullable until Bahasa parser writes them) --
    total_units           int,
    per_unit_price_idr    numeric(14,2),
    unit_volume           numeric(10,2),
    unit_volume_uom       text,                          -- 'ml' | 'g'
    price_per_100ml_or_g  numeric(14,4),
    container_type        text,                          -- can | box | bottle | pouch | other
    flavour               text,

    stock                 text,
    sold_count            int,
    rating                numeric(3,2),
    url                   text,
    scraped_at            timestamptz NOT NULL DEFAULT now(),
    parse_confidence      text NOT NULL DEFAULT 'raw',   -- 'raw' | 'high' | 'needs_review'
    raw_payload           jsonb,

    CONSTRAINT ecom_listings_unique_variation
        UNIQUE (project_id, product_id, variation_id, platform)
);

CREATE INDEX IF NOT EXISTS ecom_listings_project_idx
    ON public.ecom_listings (project_id, platform, scraped_at DESC);

CREATE INDEX IF NOT EXISTS ecom_listings_brand_idx
    ON public.ecom_listings (project_id, brand_name) WHERE brand_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS ecom_listings_review_idx
    ON public.ecom_listings (project_id, parse_confidence)
    WHERE parse_confidence = 'needs_review';

-- ----------------------------------------------------------------------------
-- scrape_jobs.ecom_config — jsonb config blob for an Ecom Listings job.
-- The job API insert is column-safe; this can run at any time without breaking
-- existing flows. Once added, the Competitor Analysis page writes the config
-- here and the worker reads it via job.get("ecom_config").
-- Shape:
--   {
--     "platforms":                 ["Shopee","Tokopedia"],
--     "search_mode":               "keyword" | "shop",
--     "keywords":                  [str, ...],
--     "shop_targets":              [str, ...],
--     "official_store_filter":     "all" | "official_only" | "non_official_only",
--     "brand_names":               [str, ...],
--     "max_listings_per_platform": 200
--   }
-- ----------------------------------------------------------------------------
ALTER TABLE public.scrape_jobs
    ADD COLUMN IF NOT EXISTS ecom_config jsonb;

NOTIFY pgrst, 'reload schema';
