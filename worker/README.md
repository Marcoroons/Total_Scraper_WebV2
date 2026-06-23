# Scraper Worker

Background scraping worker (Apify → Supabase). This is the long-running process
that picks up `PENDING` rows from `scrape_jobs`, runs the appropriate Apify
actors (Instagram / TikTok profile feeds, video stats, comments, trends, etc.),
applies date-range filtering, and writes results to the platform data tables.

It is **not** a web service — it loops forever polling Supabase.

## Files
- `worker.py` — the worker loop and all scrape/job logic.
- `database.py` — Supabase query helpers (self-contained).
- `requirements.txt` — Python dependencies (no Streamlit/UI libs — worker only).
- `Procfile` — `worker: python worker.py`.

## Deploy on Railway (separate service)
1. Railway → **New** → **Deploy from GitHub repo** → select `Total_Scraper_WebV2`.
2. In the new service → **Settings**:
   - **Root Directory**: `worker`
   - **Start Command**: `python worker.py` (or rely on the Procfile).
3. **Variables** — set the same env vars your current worker service uses, at minimum:
   - `SUPABASE_URL`
   - `SUPABASE_KEY`  (service-role key)
   - `APIFY_TOKEN`
   - plus any others your worker reads (e.g. SMTP creds for scheduled emails,
     Google API key for YouTube) — copy them from the existing worker service.
4. Deploy. Watch the logs for `--- INITIALIZING WORKER ---` and
   `✅ Environment Variables Loaded.`

> Keep this in sync going forward: edit `worker/worker.py` here and push — the
> Railway worker service redeploys from this repo. The old `Total_Scraper_web`
> repo worker can then be retired to avoid two sources of truth.
