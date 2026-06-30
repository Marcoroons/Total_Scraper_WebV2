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
- `trend_discovery_posted_at.sql` — adds `trend_discovery.posted_at timestamptz` so KOL Finder can filter creators by "posted in last N days"

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
- **Competitor Analysis (`/competitor`)** — product-based Shopee + Tokopedia listings scraper + Excel export.
  - Job type: **`Ecom Listings`**. Config carried as `scrape_jobs.ecom_config` (jsonb):
    `{platforms, products: [{brand, flavour}], official_store_filter, max_listings_per_product}`.
  - The user lists **products to track** (brand + optional flavour). Each product → one Shopee search with query `"{brand} {flavour}"`, then **title-validated** at scrape time — a listing is kept ONLY if its title contains ALL brand tokens AND ALL flavour tokens (case-insensitive). This kills off-brand bleed (Shopee's loose search was previously returning T-shirts and other brands' products for keyword scrapes).
  - The user-specified `flavour` is written to `ecom_listings.flavour` directly (no regex guessing). `brand_name` is the user-specified brand, not the actor's surface field.
  - Legacy `keywords[]` / `shop_targets[]` / `brand_names[]` fields are still readable on `EcomJobConfig` so old queued jobs and old recent-jobs rows still display correctly; the worker auto-migrates legacy shape into single-brand products.
  - Apify actors (hardcoded in `worker.py → ECOM_ACTORS`): Shopee `gio21/shopee-scraper`, Tokopedia `jupri/tokopedia-scraper`. Same `APIFY_TOKEN` env var — no new secrets.
  - Worker writes one row per **variation** to `ecom_listings` with `parse_confidence='raw'`. Raw actor response stored in `raw_payload` (jsonb) so the exporter / Phase 2 can re-parse without re-scraping.
  - **Excel export** (`POST /export/ecom` in `export-service`, file `export-service/ecom_export.py`): runs the Bahasa parser inline on every request (no DB persistence yet), then aggregates per-product and writes a 3-sheet workbook. Sheets:
    - **Products** — one row per tracked product (brand × flavour), sorted by **Sales Volume** desc. Columns: Product, Sales Volume, Unit Price per 100ml/g, Top Products (top 3 listings by sold count, multi-line), Reviews, # Listings, Platforms.
    - **Raw Listings** — every listing with the parser's output for spot-checking.
    - **Notes** — caveats, regex coverage, parser limitations.
    - Sales Volume = sum of `sold_count` (which the worker writes from `historicalSoldEstimated`). Reviews = sum of `reviewCount` from the actor's raw_payload (falls back to `—`).
    - Unit Price per 100ml/g = median of `(per_unit_price / unit_volume × 100)` across the group; UOM follows the group's majority (liquids in ml, solids in g; mixed-UOM rows excluded).
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

- 2026-06-29 — **KOL Finder precision pass**: (1) limit overshoot fixed — IG hashtag scraper's `resultsLimit` is per-hashtag, so asking for 10 across 3 hashtags returned 25-30. Now caps total output at `limit` post-scrape for both IG + TikTok. (2) New SQL `sql/trend_discovery_posted_at.sql` adds `posted_at` column; worker captures it from IG's `timestamp` / TikTok's `createTimeISO` (column-safe upsert in `database.py`); `/api/trends` selects it. (3) Frontend gets a date-window filter (All / 7 / 14 / 30 / 90 days), "Exclude brand / shop accounts" toggle (default ON — strips usernames containing `official`, `.id`, `_id`, `indonesia`, `store`, `shop`, `brand`, `mart`, `resmi`, `.co`, `ltd`, `inc`), and a custom-pattern exclusion input. (4) Roster table now surfaces Likes / Comments / Shares as separate columns + a Latest-post-date column. (5) Dedupe summary banner ("12 new · 18 in DB · 4 filtered") so the cross-project dedupe is visible at a glance. CSV export includes all the new fields.
- 2026-06-29 — **Sales Volume diagnostics**: user still saw nil for all shops after the previous fix — most small Apotek-style sellers genuinely return null for `historicalSoldEstimated`. Two improvements: (1) `_ecom_safe_int` now handles string-formatted counts like `"1.2K"`, `"10rb"` (Indonesian *ribu* = thousand), `"500+"`, `"1.500"` (Indonesian thousand-dot vs decimal disambiguated by the `len==3` heuristic from the price parser); (2) broadened the `sold_count` field sweep to also try `salesCount`, `monthlySold`, `totalSold`, `lifetimeSold`, `numSold`. New **"view"** button in the Captured Listings preview opens a modal showing the listing's full `raw_payload` with sales/review fields explicitly highlighted — fastest way to confirm whether the actor returned a field we missed or genuinely nothing.
- 2026-06-29 — **Sales Volume bug fix (0 ≠ —)**: user reported `historicalSoldEstimated` not surfacing as Sales Volume in the Competitor Analysis export. Two bugs together:
  1. Worker's `_shopee_to_rows` chained candidates with `or`, so a legit `historicalSoldEstimated=0` was treated as falsy and fell through to non-existent fallback fields → recorded as `None`. New `_ecom_first_present(*candidates)` helper preserves zeros. Same pattern applied to `rating`, `listing_price_idr`, and `stock` in both the variation and non-variation paths.
  2. Exporter's `aggregate_by_product` used `_sum_or_none([…])` for `sales_volume`, returning `None` when all listings had no estimate → cell showed `—`. New `_sum_or_zero` always returns an int. Added `sales_known_n` so the Products sheet appends `(no estimate)` when 0 listings contributed — disambiguates "0 sales" from "actor returned nothing".
- 2026-06-29 — **Delete-by-hashtag** for trend_discovery: new `DELETE /api/trends?project_id=X&hashtag=Y[&platform=Z]` route — token-aware (matches `search_target` as a comma-separated token so `susu` doesn't accidentally hit `susuformula`), platform-scoped, ownership-checked. UI: KOL Finder shows a trash icon next to the hashtag filter dropdown when a specific tag is selected; Hashtag/Trends page gains a chip list of every scraped hashtag (per platform, with post counts) and an X on each chip to wipe its data. Wipes only `trend_discovery` rows — the queued jobs in `scrape_jobs` stay.
- 2026-06-29 — **Synonym-aware title validation (kaleng ↔ can ↔ canned)**: user noted Shopee listings often use English alongside Indonesian, so typing `kaleng` was dropping titles that said "Canned". New `_SYNONYM_GROUPS` in `worker.py` maps interchangeable token sets — kaleng/can/canned/tin, kotak/box/carton/karton/dus, botol/bottle, coklat/cokelat/chocolate/choco, susu/milk, kopi/coffee, ayam/chicken, etc. Title-validation now resolves any token to its synonym group before checking. Brand tokens are NOT synonym-mapped (proper nouns; `Nescafé` ≠ `Nestlé`). Diacritic normalization already handled `Nescafé` ↔ `nescafe` from a prior commit. UI Tips updated to list the synonym pairs.
- 2026-06-29 — **Ecom scrape visibility + strict/loose match mode**: user reported a 4-product scrape with cap 10 returning only 5 rows total — no visibility into why. Worker now emits a per-product breakdown in the job's note (`latte: 10→1 | mocha: 10→4 | cappucino: 8→0 (title-mismatch) | original: 7→0`) so the user immediately sees which products failed title-validation, which returned fewer raw results, or which errored. New `match_mode` in `ecom_config`: `strict` (default — all 4 fields required in title) or `loose` (only brand+flavour enforced; volume+type are still in the search query but not validated on results — boosts recall when Strict returns too few). Toggle on `/competitor` scrape config above max-listings.
- 2026-06-29 — **Shop filter moved from scrape time → export time**: user reported "Shopee: 4 valid item(s) but all rejected by official_only" — scrape-time filtering hid the data without showing what was returned. Worker now writes EVERY title-validated row to `ecom_listings` (no shop filter at scrape time); shop filter applies in the exporter (`shop_filter` + `specific_shops` added to `EcomRequest`). Captured Listings preview shows every seller via realtime; user picks the shop lens at export time without re-scraping. Worker's per-job note now includes the per-shop breakdown (top 3 shops + counts + how many flagged Official) so user sees who's selling without opening Supabase. The scrape-config Shop filter UI was replaced with an info banner pointing to the new export-panel location.
- 2026-06-29 — **Fix gio21 actor input field + loosen official_only**: (1) Apify actor's real input field is `location` (single keyword OR URL), not `keyword` — the actor was ignoring our `keyword` field and returning default/popular items, which is why title-validation killed almost everything. Switched `_shopee_run` to `{location, country, maxItems, priceSlicing}`. (2) `official_only` previously required brand tokens in the shop name (brand-strict), which broke parent-brand stores: Nescafe sold by Nestlé Indonesia, Top Coffee by Wings, Indomie by Indofood. Title-validation already enforces brand purity, so `official_only` now just checks for `Official`/`Mall` in shop name — works automatically for parent-brand cases. Tips panel rewritten accordingly.
- 2026-06-26 — **Diacritic-tolerant shop matching + Shop filter tips**: user typed `nestle indonesia` in Specific shops mode and got 0 results because the actual Shopee Mall is `Nestlé Indonesia Official Store` (with the é). Added `_norm_text()` in `worker.py` that strips combining diacritics (`Nestlé` → `nestle`) and routed it through `_tokens`, `_title_matches_product`, `_is_brand_official_shop`, and the `specific_shops` filter. Token-based matching for `specific_shops` — all tokens of each user-supplied shop name must appear in the listing's normalized shopName; multiple entries OR'd. New Tips collapsible below the Shop filter on `/competitor` explains when/why to use each mode + flags the **parent-brand gotcha** (Nescafe sold by Nestlé Indonesia, Top Coffee by Wings, Indomie by Indofood, etc.)
- 2026-06-26 — **Competitor Analysis live-updates + country selector**: (1) Captured Listings panel subscribes to Supabase Realtime INSERTs on `ecom_listings` — new scraped rows appear without manual refresh. Migration `sql/ecom_listings.sql` now adds the table to the `supabase_realtime` publication (idempotent — re-run safely). (2) Preview auto-opens whenever a job is PENDING or AUTO_PROCESSING. (3) New country/marketplace dropdown — Shopee's 9 markets (ID, MY, SG, TH, VN, PH, TW, BR, MX) passed to the actor's `country` field. Tokopedia auto-disables when country != ID (Tokopedia is Indonesia-only). (4) Cancel button on PENDING / AUTO_PROCESSING jobs — marks the job FAILED so the worker skips it (best-effort if mid-actor-call — restart Railway worker for genuine hangs).
- 2026-06-26 — **Competitor Analysis precision pass**: (1) new `specific_shops` shop-filter mode — user types comma-separated shop names, case-insensitive substring match against `shopName`. (2) Excel export now has a "Latest completed job only" checkbox (ON by default) — pins the export to the most recent Ecom Listings job so legacy contaminated rows from older scrapes don't pollute. Wired through `export-service/main.py` as `EcomRequest.job_id`. (3) New `DELETE /api/ecom-listings?project_id=…[&job_id=…]` route + "Clear all" button on the Captured Listings preview so users can wipe contaminated data from pre-validation scrapes
- 2026-06-26 — **Product refinement: volume + container type per product row**: extended each "Products to track" row from `{brand, flavour}` to `{brand, flavour, volume, type}`. Volume (e.g. `240ml`, `1L`, `100g`) and Type (e.g. `kaleng`, `kotak`, `botol`) feed both the search query AND the title-validation. Volume match is whitespace-tolerant (`240ml` matches `240ml` and `240 ml`). User-specified volume / type are persisted to `ecom_listings.unit_volume` / `unit_volume_uom` / `container_type` columns at scrape time, and the exporter now groups by the full `(brand, flavour, container_type, unit_volume, unit_volume_uom)` tuple — so `Nescafe Latte 240ml kaleng` and `Nescafe Latte 220ml kaleng` show as separate rows in the Products sheet
- 2026-06-26 — **Brand-strict "official store" filter**: `gio21/shopee-scraper` doesn't expose `isMall`/`isOfficial`, so `official_only` previously let in any shop with "Official" in its name (Wings Official Shop, AGEN SEMUA OFFICIAL, etc. polluted Nescafe scrapes). Now requires shopName to contain ALL brand tokens AND ('official' OR 'mall') — e.g. for a Nescafe search, only `Nescafe Official Store` / `Nescafe Mall` qualify. `non_official_only` excludes ANY 'official'/'mall' shop regardless of brand match
- 2026-06-26 — **Competitor Analysis switched to product-based scraping**: replaced the keyword/shop-mode UI with a "Products to track" table where each row is a `{brand, flavour}` pair. Worker now builds the search query as `"{brand} {flavour}"` and **title-validates** every result (must contain all brand AND all flavour tokens) before persisting — kills the off-brand bleed where "caramel macchiato" was pulling T-shirts and other brands' products. User-specified flavour is written to `ecom_listings.flavour` directly. Exporter redesigned around per-product rows: **Sales Volume** (sum sold) / **Unit Price per 100ml/g** (median) / **Top Products** (top 3 listings by sold count) / **Reviews** (sum reviewCount). Legacy `EcomJobConfig` shape (keywords/shop_targets/brand_names) still readable so old queued jobs and old recent-jobs rows render correctly
- 2026-06-26 — **TaskLoader fills the Queue header band** (`flex-1`, video left + animated label center, gradient hint); harden `call_apify` against hangs — all `requests` calls have explicit timeouts (60s / 45s), the poll loop is capped at 60 iterations (~30 min ceiling per actor call), and transient JSON / network errors retry instead of crashing the worker. Pre-existing weakness that bit ecom scrapes harder because they fire one actor call per keyword
- 2026-06-26 — **Ecom diagnostics + Shopee official-store heuristic**: `gio21/shopee-scraper` doesn't expose officiality as a boolean (verified via Railway logs) — `_ecom_is_official` now falls back to a `shopName` "Official" / "Mall" substring match for Shopee. Also fixed sold_count mapping to include `historicalSoldEstimated` (the field gio21 actually returns). `ecom_run_listings` now returns `(rows_written, note)` and the dispatcher writes the note to `scrape_jobs.error_message` AFTER the COMPLETED status update so zero-row outcomes are visible in the UI (e.g. "Shopee: 63 items returned but all filtered out by official_store_filter='official_only'"). The `/competitor` Recent Jobs panel now renders that note in yellow on COMPLETED jobs (red on FAILED)
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
