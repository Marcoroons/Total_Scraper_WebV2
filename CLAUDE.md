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
- **Competitor Analysis (`/competitor`)** — product-based Shopee + Tokopedia listings scraper + Excel export. This section is the authoritative reference; the chronological Recent Changes log below records how it evolved.

  **Scrape flow**
  - Job type: **`Ecom Listings`**. Config carried as `scrape_jobs.ecom_config` (jsonb):
    ```
    { platforms:      ["Shopee", "Tokopedia"],
      products:       [{brand, flavour, volume, type}, ...],  // brand required, others optional
      max_listings_per_product: 10..200,
      country:        "ID"|"MY"|"SG"|"TH"|"VN"|"PH"|"TW"|"BR"|"MX",  // Shopee marketplace; default ID
      match_mode:     "strict" | "loose",                     // default 'strict'
      // legacy fields (read-only fallback for pre-redesign jobs):
      keywords[], shop_targets[], brand_names[], official_store_filter, specific_shops[] }
    ```
  - Each product → one search per platform. **Shopee actor `gio21/shopee-scraper`** input shape (verified against actor console): `{ location: "{brand} {flavour} {volume} {type}", country, maxItems, priceSlicing: false }`. `location` is the actor's primary search field — sending `keyword` instead returns default popular items (the source of an earlier mass off-brand-bleed bug).
  - **Tokopedia actor `jupri/tokopedia-scraper`** input: `{ query: [target], limit: maxItems }`. Auto-disabled in the UI when `country != "ID"` (Tokopedia is Indonesia-only).
  - **Title-validation at scrape time** is the precision-critical filter. A listing is kept ONLY if its (diacritic-normalized) title contains the right tokens:
    - **strict mode** (default): ALL of brand + flavour + volume + type tokens
    - **loose mode**: ONLY brand + flavour tokens (volume + type still flow into the search query but aren't enforced on results — useful when titles use spelling variants or word-order quirks)
    - Brand tokens are strict-only (proper nouns; `Nescafé` ≠ `Nestlé`).
    - Flavour & type tokens are **synonym-aware** (`_SYNONYM_GROUPS` in `worker.py`): `kaleng`↔`can`↔`canned`↔`tin`, `kotak`↔`box`↔`carton`↔`karton`↔`dus`, `botol`↔`bottle`, `pouch`↔`pack`↔`bag`, `coklat`↔`cokelat`↔`chocolate`↔`choco`, `susu`↔`milk`, `kopi`↔`coffee`, `ayam`↔`chicken`, etc.
    - Diacritics are stripped on both sides (`_norm_text` uses NFKD + drop-combining): `nescafe` matches `Nescafé`.
    - Volume matching is whitespace-tolerant: `240ml` matches `240ml`, `240 ml`, `240ML`.
  - **No shop filter at scrape time.** Every title-validated row is written to `ecom_listings` regardless of seller. Shop filter is applied at export time — see below. (Previously enforced at scrape; moved 2026-06-29 because rejecting at scrape hid data and forced re-scrapes when the user changed their mind.)
  - User-specified `flavour`, `volume`, `container_type` are written to the DB columns directly (not regex-guessed). When the user leaves any blank, those columns are NULL and the exporter falls back to regex parsing of the title.
  - Worker writes one row per **variation** to `ecom_listings`. Each row tags `is_official_store` via `_shop_is_official` (shop name contains "official" or "mall", diacritic-aware). `raw_payload` (jsonb) stores the actor's complete response so the exporter / a future Phase 2 worker can re-parse without re-scraping.

  **Worker visibility (Recent Jobs panel "yellow note")**
  - Per-job summary written to `scrape_jobs.error_message` AFTER `update_job_status` (which clears `error_message` on COMPLETED): per-platform row count + breakdown of where rows went per product. Format:
    ```
    Shopee [strict]: 23 rows captured (12 flagged Official). Per-product:
      cappuccino 240ml kaleng: 8→0 (title-mismatch) |
      mocha 240ml kaleng: 10→4 |
      latte 240ml kaleng: 10→1. Top shops: Nestlé Indonesia Official Store (8)...
    ```
  - User immediately sees which products returned what without checking Railway logs.
  - `call_apify` is hardened against hangs (verified 2026-06-29): explicit timeouts on every HTTP call (60s start, 45s per-poll, 60s dataset fetch), poll loop capped at 60 iterations (~30 min ceiling) per actor call, transient errors retry with backoff instead of crashing. A genuinely stuck actor now raises a clear timeout, marks the job FAILED, and moves to the next.

  **Captured Listings preview** (Competitor page, lives between the Recent Jobs panel and the Export panel)
  - Supabase Realtime subscription on `ecom_listings` filtered by `project_id` — rows appear in the preview as the worker writes them, no manual refresh. Auto-opens whenever any Ecom Listings job is PENDING / AUTO_PROCESSING.
  - Requires the table to be in the `supabase_realtime` publication. `sql/ecom_listings.sql` includes the `ALTER PUBLICATION` block (idempotent via `EXCEPTION WHEN duplicate_object`).
  - **"view" button per row** opens a fullscreen modal showing the listing's complete `raw_payload` with sales / review fields explicitly highlighted at the top — fastest way to diagnose missing sold_count without opening Supabase.
  - "Clear all" wipes contaminated listings via `DELETE /api/ecom-listings?project_id=X[&job_id=Y]`. Ownership-checked, scoped to the project.
  - **Cancel** button on PENDING / AUTO_PROCESSING jobs in the Recent Jobs table — PATCHes to FAILED. Best-effort if the worker is mid-actor-call (Railway redeploy still needed for genuine pre-fix hangs).

  **Excel export** (`POST /export/ecom` → `export-service/main.py`, file `export-service/ecom_export.py`)
  - Triggered from the Competitor page's Export panel — NOT the main Exporter. Reuses the generic `/api/export` proxy with `endpoint: "export/ecom"`. Payload:
    ```
    { project_id, brand_filter, platform_filter, job_id,    // narrow what gets exported
      shop_filter, specific_shops,                          // applied here, not at scrape
      // (the page also stuffs the user's chosen filename into the download)
    }
    ```
  - **Latest completed job only** toggle (default ON) — pins the export to the most recent COMPLETED Ecom Listings job so legacy contaminated rows don't pollute.
  - **Shop filter** options: `all` / `official_only` / `non_official_only` / `specific_shops` (with comma-separated shop names input). Token-based diacritic-normalized match. `official_only` means "shop name contains 'official' or 'mall'" — works automatically for parent-brand stores like *Nestlé Indonesia Official Store* (Nescafe parent), *Wings Official* (Top Coffee parent), *Indofood* (Indomie parent), *Mayora* (Kopiko parent).
  - **Filename override**: optional text field on the Export panel. Empty = default `competitor_analysis_<brand>.xlsx`. `.xlsx` extension auto-appended. Illegal path chars stripped.

  **Workbook layout** (4 sheets)
  - **Products** — one row per (brand × flavour × volume × type), PLUS a **highlighted aggregate row at the top of each brand's block** (`{brand} — all flavours (N variants)`) summing every Nescafe listing across all flavours so the user gets brand-wide totals + per-flavour drill-down in one view. Columns: Product, Sales Volume, Unit Price per 100ml/g, Top Products, Reviews, # Listings, Platforms. Sorted by Sales Volume desc within each brand block.
  - **Raw Listings** — every parsed row + the parser's output for spot-checking.
  - **Notes** — full caveat sheet (parser behaviour, synonym groups, multi-flavour expansion rules, sales-volume fallback semantics).
  - **Multi-flavour expansion**: a listing whose title mentions multiple flavours from the project's tracked set is counted under EACH matching flavour. E.g. "NESCAFE MOCHA CAN. NESCAFE LATTE CAN." contributes to both Mocha and Latte aggregates rather than only whichever search found it.

  **Bahasa parser** (lives in `export-service/ecom_export.py`, runs fresh on every export — no DB persistence yet)
  - **Pack count** — `isi N`, `N pcs/pack/sachet`, `Nx`, `xN`, `1 lusin` (=12), `N lusin` (=N×12), `renceng N`. Volume tokens are STRIPPED before pack-count regex runs so `isi 220ml` → 1 unit (the 220 is volume, not a count) and `220ml x 6` → 6 (volume stripped, the 6 stays). Pack count is capped at 100 — anything higher is treated as 1 (mislabeled volume).
  - **Volume** — `Nml` / `N L` / `Ng` / `N kg`. `L` → ×1000 → `ml`; `kg` → ×1000 → `g`. Liquid vs solid never mixed in one aggregate.
  - **Container type** — `kaleng`→can, `kotak`/`karton`/`dus`→box, `botol`→bottle, `pouch`/`sachet`/`renceng`→pouch.
  - **Flavour** — curated Indonesian keyword list (`FLAVOUR_KEYWORDS`). Extend the list to add new flavours.
  - **Reviews extraction** — best-effort field sweep from `raw_payload`: tries `reviewCount` / `cmt_count` / `rating_count` / `ratingCount` / `numReviews` / etc.
  - **`_ecom_safe_int`** (worker) handles 0 (preserved through truthiness fix via `_ecom_first_present`), `"500"`, `"1.2K"`, `"10rb"` (Indonesian *ribu* = thousand), `"500+"`, `"1.500"` (Indonesian thousand-dot, distinguished from decimal via the `len==3` heuristic), `"2.5M"`.
  - **Sales Volume** in the workbook always shows a number. `_sum_or_zero` returns 0 instead of None when no listing in a group has an estimate; the cell shows `0 (no estimate)` when zero of the listings contributed.

  **Old "Multi-Layer Intelligence" ecom sweep** (5 retailers + curl_cffi Cloudflare bypass + flat `ecommerce_products` table) was scrapped 2026-06-26. Code preserved at `DEAD_COMPETITOR_ANALYSIS_ENGINE/` for reference — see that folder's README.md for the why-removed and revival checklist.

  **Future phases (not built)**
  - Phase 2: **persist** the Bahasa parser output (`total_units`, `unit_volume`, `unit_volume_uom`, `container_type`, `flavour`, `price_per_100ml_or_g`) back into `ecom_listings` at scrape time so the exporter doesn't re-parse on every download. Same parser code; just lift it out of `export-service/ecom_export.py` into a shared module the worker can import too.
  - Phase 3: cross-listing aggregation with median-of-medians, MAD outlier guard, sold-count-weighted variant, per-brand vs per-market granularity (see the original feature spec at top of the chronological log).
- **KOL Finder (`/kol-finder`)** — ranks `trend_discovery` authors by reach / engagement / frequency, flags creators already scraped (global `influencer_profiles` table), per-hashtag filter. Recent precision pass:
  - **Roster filters**: date window (All / 7 / 14 / 30 / 90 days — requires `trend_discovery.posted_at`, captured by the worker from IG `timestamp` / TT `createTimeISO`); "Exclude brand / shop accounts" toggle (default ON, strips usernames containing `official`, `.id`, `_id`, `indonesia`, `store`, `shop`, `brand`, `mart`, `resmi`, `.co`, `ltd`, `inc`); custom-pattern exclusion input; min-appearances slider.
  - **Roster columns**: rank, creator, score, reach, avg views, likes, comments, shares, engagement rate, posts, latest post date.
  - **Dedupe summary** above the table: "N found · X new · Y already in DB · Z filtered out".
  - **Limit cap**: asking for 10 posts gives ≤10 total (capped post-scrape with `data[:limit]` for both IG and TikTok). Previously the IG hashtag actor's `resultsLimit` was per-hashtag so 3 hashtags × 10 = 30.
  - **Trash icon next to the hashtag dropdown** — when a specific tag is selected, click to wipe every captured post for that hashtag on the selected platform via `DELETE /api/trends?project_id=X&hashtag=Y&platform=Z`. Token-aware match (`susu` won't accidentally wipe `susuformula`).
- **Hashtag / Trends (`/hashtags`)** — chip row above the tabbed results, listing every distinct hashtag captured for the active platform with its post count. Each chip has an X button that triggers the same `DELETE /api/trends` route. Wipes only `trend_discovery` rows; the jobs in `scrape_jobs` stay.

## Persistent agent memory

The user's Claude memory holds the living status (`total-scraper-web.md`, `total-scraper-teams.md`,
`total-scraper-push-permission.md`, `total-scraper-no-rename.md`). This CLAUDE.md is the repo-side
summary; prefer the memory files for the latest commit-by-commit status if available.

## Recent changes (newest first — append every implemented change here)

> **Rule:** every commit that ships a behaviour, schema, page, or component change must add a one-line entry here in the same commit. Format: `YYYY-MM-DD — <short summary> (commit <short-sha>)`. Also update the relevant body section above when the change affects schema, features, SQL migrations, or pages.

- 2026-06-29 — **KOL Finder precision pass**: (1) limit overshoot fixed — IG hashtag scraper's `resultsLimit` is per-hashtag, so asking for 10 across 3 hashtags returned 25-30. Now caps total output at `limit` post-scrape for both IG + TikTok. (2) New SQL `sql/trend_discovery_posted_at.sql` adds `posted_at` column; worker captures it from IG's `timestamp` / TikTok's `createTimeISO` (column-safe upsert in `database.py`); `/api/trends` selects it. (3) Frontend gets a date-window filter (All / 7 / 14 / 30 / 90 days), "Exclude brand / shop accounts" toggle (default ON — strips usernames containing `official`, `.id`, `_id`, `indonesia`, `store`, `shop`, `brand`, `mart`, `resmi`, `.co`, `ltd`, `inc`), and a custom-pattern exclusion input. (4) Roster table now surfaces Likes / Comments / Shares as separate columns + a Latest-post-date column. (5) Dedupe summary banner ("12 new · 18 in DB · 4 filtered") so the cross-project dedupe is visible at a glance. CSV export includes all the new fields.
- 2026-06-29 — **Brand-aggregate row + Excel filename rename + comprehensive CLAUDE.md compile**: (1) Products sheet now prepends a highlighted "{brand} — all flavours (N variants)" row at the top of each brand's block, summing every listing for that brand across all flavours / volumes / containers. Uses listing-equivalent dedupe (product_id+variation_id+platform) so multi-flavour bundles aren't double-counted in the brand total. (2) Filename override added to both the Competitor Analysis Export panel and the main Exporter — empty falls back to defaults, illegal path chars stripped, .xlsx auto-appended. Multi-file exports from the main Exporter get `-1` / `-2` suffixes. (3) CLAUDE.md Competitor Analysis + KOL Finder body sections rewritten to be authoritative for the next context — chronological changelog stays as commit history but the body is now the source of truth.
- 2026-06-29 — **Pack-count & multi-flavour aggregation fixes** (Competitor Analysis export):
  1. `parse_pack_count` now strips volume tokens (`220ml`, `1 liter`, `100g`, etc.) BEFORE running pack-count regex, so `isi 220ml` and `220ml x 6` no longer get misread as 220 units. Pack count is also capped at 100; anything higher is treated as 1 (almost certainly mislabeled volume that escaped the strip).
  2. Multi-flavour listings now expand across groups: `aggregate_by_product` first collects every flavour the project tracks (per brand), then for each listing scans the title for ALL matching flavours and counts the listing under each. A bundle titled "NESCAFE MOCHA CAN. NESCAFE LATTE CAN" contributes to both Mocha and Latte aggregates instead of just whichever search found it.
  3. Notes sheet updated for both behaviours.
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
