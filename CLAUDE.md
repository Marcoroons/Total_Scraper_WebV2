# Total Scraper Web — project context

Social-media (Instagram / TikTok) scraping app for **Cimory** (Indonesian dairy brand). The
ultimate goal of every feature: **turn scraped social data into a workable Excel report.** Keep
that lens — don't over-engineer past it.

## Architecture — 3 deployables + Supabase

| Part | Tech | Deploys to | Notes |
|------|------|-----------|-------|
| Frontend + API routes (this repo root: `app/`, `components/`, `lib/`) | Next.js 14 App Router, dark theme, Tailwind, Recharts | **Vercel** | Pushing to `main` auto-deploys |
| `export-service/` | FastAPI (`main.py` wraps `utils.py` + `nlp_engine.py` + `database.py`) | **Railway** | Builds the Excel files (openpyxl) |
| `worker/` | Python (`worker.py` ~2000 lines + `database.py`) | **Railway** | The scraper: polls `scrape_jobs`, calls Apify, writes Supabase |
| Supabase | Postgres + Auth | — | Passwords bcrypt-hashed by Supabase; worker/export use the **service-role** key (bypasses RLS) |

**Data flow:** scrape config page → `POST /api/jobs` → `scrape_jobs` row → worker polls (every 3s) →
Apify actors → Supabase data tables → user exports via `export-service` → Excel.

## How to work here

- **Build the frontend:** `.\node_modules\.bin\next.cmd build` (from this dir, PowerShell). Always build before pushing.
- **Syntax-check Python:** `C:/Users/Acer/anaconda3/python.exe -m py_compile worker/worker.py` (or export-service files). You can also import `export-service/utils.py` with a `streamlit` stub to test Excel generation directly.
- **Working dir:** this is the `Total_Scraper_WebV2` clone (`Marcoroons/Total_Scraper_WebV2`, branch `main`).

## Workflow rules (IMPORTANT)

1. **Ask before every `git commit`/`git push`.** The user reviews diffs before they hit `main` (auto-deploys). Build/verify locally, summarize the diff, then wait for an explicit "push".
2. **Never rename** tabs, nav labels, headings, variables, functions, or files unless the user explicitly asks for that specific rename. Preserve existing identifiers when refactoring.
3. **Log every implemented change in the "Recent changes" section at the bottom of this file** (date + one-line summary, newest first) as part of the same commit. This file is the source of truth between sessions — if a change isn't here, the next session won't know about it. Also update the body sections (Feature notes, Schema quirks, SQL migrations, Pages) when behaviour or schema changes, not just the changelog.
4. Dark UI throughout: bg `#060c18`, card `#0d1829`, primary cyan `#00c9ff`, accent purple `#7c3aed`. Match the surrounding code's style. Use **`<CatSpinner />`** (animated task-loading cat, `components/CatSpinner.tsx`) instead of `<Loader2 className="animate-spin"/>` wherever a small inline loader is needed; `TaskLoader` plays the same video full-card for long waits.

## Critical gotchas

- **RLS is OFF** on most tables (the anon key is public). Must be enabled before public launch (SQL in `SECURITY.md`). The team tables (`teams`, `team_members`, `projects`, `project_members`) are intentionally RLS-off — access is enforced in the API routes.
- **Worker changes only take effect if this WebV2 `worker/` is the LIVE Railway scraper** (the old `Total_Scraper_web` worker must be disabled).
- **Secrets** live only in Vercel/Railway env vars; `.env.local` has placeholders.
- **Competitor Intelligence is gated OFF** by default via `ENABLE_INTELLIGENCE` (worker). It was a daily compiler that full-table-scanned data and could block scrapes; leave off until that feature ships. Set `ENABLE_INTELLIGENCE=true` in Railway to enable.

## Schema quirks (don't reintroduce fixed bugs)

- `teams` column is **`name`**, NOT `team_name` (API aliases `team_name:name`).
- **`team_members` has no `created_at`** — select only `user_id, role`.
- `scrape_jobs` optional columns added by migration: `max_retries`, `date_multiplier`, **`fetch_followers`** (API insert is column-safe).
- `scheduled_reports.send_time` (HH:MM, ICT) added by migration; column-safe, defaults `09:00`.
- `ig_/tiktok_influencer_profiles` optional columns added by migration: **`followers`** (denominator for image-post engagement rate) and **`view_count`** (Instagram `videoViewCount`, stored separately from `videoPlayCount`). Worker upsert is column-safe — keeps working until the SQL runs.
- `scrape_jobs` also has optional **`ecom_config`** (jsonb) for Ecom Listings jobs — API insert is column-safe.
- **`ecom_listings`** (new table, see `sql/ecom_listings.sql`): one row per product variation, project-scoped, unique on `(project_id, product_id, variation_id, platform)`. `variation_id` is `''` (empty string) not NULL for listings with no variations so the unique constraint actually fires.
- Global shared data tables have **no `project_id`**: `ig_/tiktok_influencer_profiles`, `_campaign_videos`, `_comments`, `trend_discovery`. `kol_snapshots` and `ecom_listings` ARE per-project.

## SQL migrations to run in Supabase (one-time)

Files in `sql/`:
- `team_collaboration.sql`
- `pending_invites.sql`
- `teams_fix.sql` (RLS-off + `team_invites`)
- `scheduled_reports_send_time.sql`
- `follower_engagement.sql` — adds `scrape_jobs.fetch_followers` + `*_influencer_profiles.followers`
- `view_count.sql` — adds `*_influencer_profiles.view_count`
- `ecom_listings.sql` — adds the `ecom_listings` table + `scrape_jobs.ecom_config jsonb` (Competitor Analysis Phase 1)

Plus:
```sql
ALTER TABLE public.scrape_jobs ADD COLUMN IF NOT EXISTS max_retries int DEFAULT 1;
ALTER TABLE public.scrape_jobs ADD COLUMN IF NOT EXISTS date_multiplier numeric DEFAULT 3;
```

## Pages (`app/`)

`/` (landing), `/login`, `/signup`, `/reset-password`, `/dashboard`, `/profile-tracker`,
`/url-stats`, `/comments`, `/competitor` (Competitor Analysis — Shopee / Tokopedia scraper),
`/hashtags` (Trend Discovery + Video Optimisation), `/kol-finder`,
`/queue` (Job Queue + Exporter), `/teams`, `/projects`, `/nlp-settings`, `/settings`, `/handbook`.

## Feature notes (current behaviour)

- **Metrics are chosen at EXPORT, not scrape.** The scraper captures all raw fields; the Exporter has the calc-metric + raw-column pickers. Metric set differs by platform — **VTR** and **View Count** are **Instagram only** (TikTok has no separate view-count number). **CPV** = rate ÷ play count, with per-KOL Rate inputs at export. Definitions live in `components/MetricsSelector.tsx`.
- **Engagement Rate denominator depends on content type.** Reels use plays; **image posts / carousels** have no view count, so they use **followers** as the denominator — but only when the user ticked **"Fetch follower count"** on the Profile Tracker (off by default; the option is shown only for Instagram with format `All Formats` or `Images/Carousel Only`). Ticking it sets `scrape_jobs.fetch_followers=true`; the worker then does one extra Apify lookup per profile and writes to `*_influencer_profiles.followers`.
- **Excel builder (profile-audit export, Exporter "Advanced settings" panel)** — toggles for which sheets/columns appear (`summary` / `details` / `notes`), sheet order, plus:
  - **Presets:** Detailed / Compact / Per-video / Custom (defined in `lib/exportConfig.ts → LAYOUT_PRESETS`).
  - **view_metric:** `play_count` vs `view_count` — which captured number feeds the summary's "Views" aggregates. Hidden when `content_filter='images'` (irrelevant).
  - **content_filter:** `all` / `videos` / `images` — limit the export to one content type. Picking `images` auto-disables and hides the Video Details sheet card.
  - An empty `layout` on the wire = the full default workbook (export-service treats it that way).
- **Exporter metric pickers are scoped to the selected function type** (`lib/exportConfig.ts → FUNCTION_CALC_METRICS` / `FUNCTION_SHOWS_METRICS` / `FUNCTION_SHOWS_BUILDER`):
  - **Profile**: full builder (raw + calc metrics, rates, Excel builder).
  - **URL**: metric pickers only — the Excel builder is hidden because `/api/export` doesn't accept a `layout` for the URL endpoint.
  - **Comment**: everything hidden — comment exports just compile every captured sentiment row as-is, no metric controls.
  - **All**: union of relevant metrics + full builder visible (mixed selections retain full control).
  - When VTR is toggled ON, the Video Details sheet's Play Count + View Count columns auto-enable (VTR = View / Play needs both columns in the workbook to be verifiable).
- **Profile-audit date window:** worker over-fetches `limit × date_multiplier` (user-set, 1–5×) to reach `date_from`; the export filters rows to the chosen window (the data tables accumulate across scrapes).
- **TikTok hashtag scrapes are region-locked to Indonesia** (ID proxy + `authorMeta.region == "ID"`). Instagram hashtags can't be region-locked (warn users to use ID-centric hashtags).
- **KOL Finder** (`/kol-finder`): ranks `trend_discovery` authors by reach/engagement/frequency; flags creators already scraped (global `influencer_profiles`); hashtag filter.
- **Dashboard** has a Comment Sentiment panel (keyword classifier mirroring `nlp_engine` dictionaries).
- **Scheduled email reports** (Exporter): worker processes `scheduled_reports` at a chosen ICT time (HH:MM, stored in `send_time`). Sends a data workbook (not the formatted export yet); "rescrape before sending" toggle not yet honored.
- **Queue:** row-select + bulk delete + bulk re-scrape; `<CatSpinner />` / Task Loading video shows while jobs are pending.
- **Auth forms** include `autoComplete` / `name` / `id` attributes so browser password managers autofill correctly.
- **Competitor Analysis (`/competitor`)** — Phase 1, Shopee + Tokopedia listings scraper + Excel export.
  - Job type: **`Ecom Listings`**. Config carried as `scrape_jobs.ecom_config` (jsonb):
    `{platforms, search_mode: 'keyword'|'shop', keywords[]|shop_targets[], official_store_filter: 'all'|'official_only'|'non_official_only', brand_names[], max_listings_per_platform}`.
  - Apify actors (hardcoded in `worker.py → ECOM_ACTORS`): Shopee `gio21/shopee-scraper`, Tokopedia `jupri/tokopedia-scraper`. Same `APIFY_TOKEN` env var — no new secrets.
  - Worker writes one row per **variation** to `ecom_listings` with `parse_confidence='raw'`. Raw actor response stored in `raw_payload` (jsonb) so the exporter / Phase 2 can re-parse without re-scraping.
  - **Excel export** (`POST /export/ecom` in `export-service`, file `export-service/ecom_export.py`): runs the Bahasa parser inline on every request (no DB persistence yet), then aggregates and writes a 4-sheet workbook. Sheets:
    - **Products** — one row per brand, flavours collected, sorted by total sold (most popular first). Columns: Product, Flavours, Total Volume, Per-Unit Cost (IDR), Popularity (avg rating), Reviews, Total Sold, # Listings, Platforms.
    - **By Flavour** — one row per (brand × parsed flavour) for within-brand flavour comparison.
    - **Raw Listings** — every listing with the parser's output for spot-checking.
    - **Notes** — caveats, regex coverage, parser limitations.
    - Reviews count is best-effort from `raw_payload` (tries `reviewCount` / `cmt_count` / `rating_count` etc., falls back to `—`).
    - The exporter triggers from `/competitor` directly (not the main Exporter) with optional brand + platform filters; reuses the existing `/api/export` proxy with `endpoint: "export/ecom"`.
  - **Old "Multi-Layer Intelligence" ecom sweep** (5 retailers + curl_cffi Cloudflare bypass + flat `ecommerce_products` table) was scrapped 2026-06-26. Code preserved at `DEAD_COMPETITOR_ANALYSIS_ENGINE/` — see that folder's README for revival checklist.
  - Phase 2 (TODO): **persist** the Bahasa parser output (`total_units`, `unit_volume`, `unit_volume_uom`, `container_type`, `flavour`, `price_per_100ml_or_g`) back into `ecom_listings` at scrape time and flip `parse_confidence` to `high` / `needs_review`. Same parser code as `export-service/ecom_export.py` — move into a shared module first.
  - Phase 3 (TODO): cross-listing aggregation with median + MAD outlier guard + sold-count-weighted variant.

## Persistent agent memory

The user's Claude memory holds the living status (`total-scraper-web.md`, `total-scraper-teams.md`,
`total-scraper-push-permission.md`, `total-scraper-no-rename.md`). This CLAUDE.md is the repo-side
summary; prefer the memory files for the latest commit-by-commit status if available.

## Recent changes (newest first — append every implemented change here)

> **Rule:** every commit that ships a behaviour, schema, page, or component change must add a one-line entry here in the same commit. Format: `YYYY-MM-DD — <short summary> (commit <short-sha>)`. Also update the relevant body section above when the change affects schema, features, SQL migrations, or pages.

- 2026-06-26 — **Competitor Analysis Excel export**: new `/export/ecom` endpoint in the export-service with inline Bahasa parser (`export-service/ecom_export.py` — bundle / volume / container / flavour / reviews). Produces a 4-sheet workbook (Products / By Flavour / Raw Listings / Notes) sorted by total sold. Triggered from the new "Export to Excel" panel on `/competitor` with optional brand + platform filters
- 2026-06-26 — **Exporter UX tightening**: calc metrics + builder scoped to selected function (`FUNCTION_CALC_METRICS` / `FUNCTION_SHOWS_METRICS` / `FUNCTION_SHOWS_BUILDER` in `lib/exportConfig.ts`); Comment exports hide all metric/builder controls; URL hides the builder; `content_filter='images'` hides Video Details + View Metric sections and auto-disables `details.enabled`; toggling VTR auto-enables Play Count + View Count columns in Video Details with an inline explainer
- 2026-06-26 — **Competitor Analysis Phase 1**: scrap old Multi-Layer Intelligence ecom sweep (preserved at `DEAD_COMPETITOR_ANALYSIS_ENGINE/`), drop `curl_cffi` dep, add new `Ecom Listings` job type (Shopee `gio21/shopee-scraper` + Tokopedia `jupri/tokopedia-scraper`), new `ecom_listings` table + `scrape_jobs.ecom_config` column (`sql/ecom_listings.sql`), full Competitor Analysis page replacing the ComingSoon stub
- 2026-06-26 — Restore VTR + expose Play Count / View Count as Excel-builder columns; Instagram-only (commit 9a09389)
- 2026-06-26 — Builder metric controls + follower-based engagement rate for image posts (`fetch_followers` opt-in on Profile Tracker; new SQL `follower_engagement.sql` + `view_count.sql`) (commit ec1487c)
- 2026-06-26 — Replace `Loader2` spinners with the animated task-loading cat across pages; added `components/CatSpinner.tsx` (commit a65e016)
- 2026-06-25 — Add Excel builder for profile-audit export — Exporter "Advanced settings" with sheets/columns toggles, Detailed/Compact/Per-video presets, `view_metric`, `content_filter` (commit 5852659)
- 2026-06-25 — Tailor export metrics to content type (reels vs photos) in `export-service/utils.py` (commit 1575c91)
- 2026-06-25 — Add `autoComplete` / `name` / `id` to auth fields so password managers autofill (commit 542f70b)
- 2026-06-25 — Add initial CLAUDE.md for session handoff (commit 559cf8d)
