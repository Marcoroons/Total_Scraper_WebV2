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
3. Dark UI throughout: bg `#060c18`, card `#0d1829`, primary cyan `#00c9ff`, accent purple `#7c3aed`. Match the surrounding code's style.

## Critical gotchas

- **RLS is OFF** on most tables (the anon key is public). Must be enabled before public launch (SQL in `SECURITY.md`). The team tables (`teams`, `team_members`, `projects`, `project_members`) are intentionally RLS-off — access is enforced in the API routes.
- **Worker changes only take effect if this WebV2 `worker/` is the LIVE Railway scraper** (the old `Total_Scraper_web` worker must be disabled).
- **Secrets** live only in Vercel/Railway env vars; `.env.local` has placeholders.
- **Competitor Intelligence is gated OFF** by default via `ENABLE_INTELLIGENCE` (worker). It was a daily compiler that full-table-scanned data and could block scrapes; leave off until that feature ships. Set `ENABLE_INTELLIGENCE=true` in Railway to enable.

## Schema quirks (don't reintroduce fixed bugs)

- `teams` column is **`name`**, NOT `team_name` (API aliases `team_name:name`).
- **`team_members` has no `created_at`** — select only `user_id, role`.
- `scrape_jobs` optional columns added by migration: `max_retries`, `date_multiplier` (API insert is column-safe).
- `scheduled_reports.send_time` (HH:MM, ICT) added by migration; column-safe, defaults `09:00`.
- Global shared data tables have **no `project_id`**: `ig_/tiktok_influencer_profiles`, `_campaign_videos`, `_comments`, `trend_discovery`. `kol_snapshots` IS per-project.

## SQL migrations to run in Supabase (one-time)

Files in `sql/`: `team_collaboration.sql`, `pending_invites.sql`, `teams_fix.sql` (RLS-off + `team_invites`),
`scheduled_reports_send_time.sql`. Plus:
```sql
ALTER TABLE public.scrape_jobs ADD COLUMN IF NOT EXISTS max_retries int DEFAULT 1;
ALTER TABLE public.scrape_jobs ADD COLUMN IF NOT EXISTS date_multiplier numeric DEFAULT 3;
```

## Feature notes (current behaviour)

- **Metrics are chosen at EXPORT, not scrape.** The scraper captures all raw fields; the Exporter has the calc-metric + raw-column pickers. **CPV** = rate ÷ views, with per-KOL Rate inputs at export. **VTR removed** (not derivable — no separate view count).
- **Profile-audit date window:** worker over-fetches `limit × date_multiplier` (user-set, 1–5×) to reach `date_from`; the export filters rows to the chosen window (the data tables accumulate across scrapes).
- **TikTok hashtag scrapes are region-locked to Indonesia** (ID proxy + `authorMeta.region == "ID"`). Instagram hashtags can't be region-locked (warn users to use ID-centric hashtags).
- **KOL Finder** (`/kol-finder`): ranks `trend_discovery` authors by reach/engagement/frequency; flags creators already scraped (global `influencer_profiles`); hashtag filter.
- **Dashboard** has a Comment Sentiment panel (keyword classifier mirroring `nlp_engine` dictionaries).
- **Scheduled email reports** (Exporter): worker processes `scheduled_reports` at a chosen ICT time. Sends a data workbook (not the formatted export yet); "rescrape before sending" not yet honored.
- **Queue:** row-select + bulk delete + bulk re-scrape; "Task Loading" video shows while jobs are pending.

## Persistent agent memory

The user's Claude memory holds the living status (`total-scraper-web.md`, `total-scraper-teams.md`,
`total-scraper-push-permission.md`, `total-scraper-no-rename.md`). This CLAUDE.md is the repo-side
summary; prefer the memory files for the latest commit-by-commit status if available.
