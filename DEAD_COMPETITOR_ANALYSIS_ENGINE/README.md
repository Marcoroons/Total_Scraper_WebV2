# DEAD COMPETITOR ANALYSIS ENGINE

**Status:** Preserved, not imported, not executed. Kept for reference only.

## What this was

A "Multi-Layer Intelligence" e-commerce sweep that ran inside `worker/worker.py`
under the `E-Commerce Intelligence` and `Competitor Intelligence Scan` job
types. Given a `brand` string, it tried to scrape product listings from **five
Indonesian retailers** in parallel and write them to a single flat
`ecommerce_products` table:

| Retailer    | Strategy                                                                    |
|-------------|-----------------------------------------------------------------------------|
| Shopee      | `gio21/shopee-scraper` Apify community actor (search by keyword)            |
| Tokopedia   | (1) Direct ACE API via `curl_cffi` Chrome TLS impersonation, (2) `shahidirfan/tokopedia-search-scraper` (paid), (3) Apify playwright fallback |
| Alfamart    | (1) `api.alfagift.id` mobile-app endpoints, (2) Apify playwright fallback   |
| Indomaret   | (1) `klikindomaret.com` AJAX endpoint, (2) Apify playwright fallback        |
| TikTok Shop | Apify playwright + Chrome stealth + ID residential proxy                    |

Plus `_grabmart` / `_gomart` helpers (defined, not wired into the orchestrator).

Cloudflare bypass relied on the `curl_cffi==0.15.0` package (Chrome TLS
fingerprint impersonation) for the direct-API attempts on Tokopedia / Alfamart
/ Indomaret. Apify residential-proxy routing handled the rest.

## Why it was removed

Superseded **2026-06-26** by the new **Competitor Analysis** module (Phase 1):
a narrower, structured Shopee + Tokopedia scraper that captures per-variation
data and is built to feed Bahasa enrichment (bundle / volume / container) in
Phase 2 and cross-listing aggregation in Phase 3.

Specific issues that motivated the rewrite:

- Single flat `ecommerce_products` schema lost per-variation pricing (one
  Shopee listing has many SKUs with different prices/stock — the old code
  upserted one row per listing).
- No bundle / pack-count parsing → 6-pack vs 24-pack collapsed to one price.
- Five-platform sweep was hard to debug when any one source broke; new module
  scopes to two platforms and per-keyword visibility.
- Cloudflare-bypass code was load-bearing for half the retailers and added an
  unusual `curl_cffi` dependency; the new module relies entirely on Apify
  actors so the worker stays vanilla.

The user's call (verbatim): *"scrap the whole e commerce intelligence and
overwrite it with this new prompt/idea, it was a useless venture anyways"*.

## What lives in this folder

- `worker_ecom_legacy.py` — extracted as-is from `worker/worker.py`. Includes
  the `_cffi_get` helper, `_parse_idr`, `_ecom_name`, `_ecom_row`,
  `_proxy_session`, and the per-platform fetchers, plus the orchestrator
  `_fetch_ecommerce`. Standalone — does not import anything from the live
  worker and is not invoked anywhere.

## How to revive (if Phase 1 fails and you want the old behaviour back)

1. Copy the helper block back into `worker/worker.py`.
2. Re-add `curl_cffi==0.15.0` to `worker/requirements.txt`.
3. Re-add `"E-Commerce Intelligence"` to `INTELLIGENCE_JOB_TYPES` and the
   `elif jtype == "E-Commerce Intelligence": _fetch_ecommerce(...)` dispatch
   branch.
4. Re-create the `ecommerce_products` and `ecommerce_scrape_log` Supabase
   tables (schema in the file's top docstring).

The old code is **not deleted** in Supabase — if the `ecommerce_products`
table still exists, its rows are intact; they're just no longer written to.

## What replaces it

- `sql/ecom_listings.sql` — new per-variation table
- `worker/worker.py` `ecom_run_listings(...)` and the `Ecom Listings` job type
- `app/competitor/page.tsx` — Competitor Analysis UI
