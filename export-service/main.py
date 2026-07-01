"""
export-service/main.py — FastAPI wrapper around utils.py / nlp_engine.py
Deployed as a separate Railway service alongside worker.py.
"""
import sys
import os
import traceback
from types import ModuleType

# ── Streamlit stub ────────────────────────────────────────────────────────────
# utils.py does `import streamlit as st` and calls st.secrets.get() inside a
# try/except.  We register a minimal stub so the import succeeds without
# installing Streamlit's full dependency tree.  st.secrets.get() returns None,
# so _get_bot_creds() falls through to the os.environ path — exactly what we want.
_st_stub = ModuleType("streamlit")

class _Secrets:
    def get(self, key, default=None):
        return default

_st_stub.secrets = _Secrets()
sys.modules.setdefault("streamlit", _st_stub)
# ─────────────────────────────────────────────────────────────────────────────

import io
import pandas as pd
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
from supabase import create_client

# Import generators (unchanged source files)
from utils import generate_video_stats_excel, generate_profile_audit_excel
from nlp_engine import generate_nlp_excel
from database import (
    get_campaign_videos,
    get_influencer_profiles,
    get_comments,
    get_nlp_config,
    get_ecom_listings,
)
from ecom_export import build_ecom_workbook

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="Total Scraper Export Service", version="1.0.0")

_frontend_url = os.environ.get("FRONTEND_URL", "*")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[_frontend_url] if _frontend_url != "*" else ["*"],
    allow_credentials=True,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    tb = traceback.format_exc()
    print(f"[export-service] Unhandled exception on {request.url.path}:\n{tb}")
    return JSONResponse(
        status_code=500,
        content={"detail": f"{type(exc).__name__}: {exc}"},
    )


def _supabase():
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_KEY", "")
    if not url or not key:
        raise HTTPException(
            status_code=503,
            detail=(
                "Export service is missing Supabase credentials. "
                "Set SUPABASE_URL and SUPABASE_KEY (service role key) "
                "in Railway → your export service → Variables."
            ),
        )
    return create_client(url, key)


def _xlsx_response(buf: io.BytesIO, filename: str) -> StreamingResponse:
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type=(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ),
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── URL normalization (YouTube tracking-param tolerance) ─────────────────────
# Background: the user can paste a YouTube URL in many forms — with `?si=...`
# tracking, mobile prefix, `youtu.be/...` short form, http vs https. The Apify
# actor canonicalises everything to `https://www.youtube.com/<path>` before
# returning items. Older scraped rows have the canonical form stored in
# video_url; newer scrapes (after the worker.py fix) store target verbatim.
# To find rows from EITHER era, the export expands each input URL into its
# variant set and queries `video_url IN (variants)`. IG/TT URLs are passed
# through unchanged (no normalization).
def _yt_url_variants(url: str) -> list[str]:
    if not url:
        return [url]
    if "youtube" not in url and "youtu.be" not in url:
        return [url]
    # Split off query + fragment; we'll selectively put `v=` and `list=` back
    # (those are real video/playlist identifiers, not tracking params).
    main, _, query = url.partition("?")
    main = main.split("#", 1)[0]
    if main.startswith("http://"):
        main = "https://" + main[len("http://"):]
    # youtu.be/<id> → www.youtube.com/watch?v=<id>
    if main.startswith("https://youtu.be/"):
        vid = main[len("https://youtu.be/"):].strip("/").split("/")[0]
        if vid:
            main = "https://www.youtube.com/watch"
            if "v=" not in (query or ""):
                query = f"v={vid}" + (f"&{query}" if query else "")
    # Force www. on bare and mobile hosts
    if main.startswith("https://youtube.com/"):
        main = "https://www." + main[len("https://"):]
    if main.startswith("https://m.youtube.com/"):
        main = "https://www." + main[len("https://m."):]
    # Reconstruct, keeping only meaningful params (drop si=, t=, feature=, utm_*, …)
    canonical = main
    if query:
        kept = []
        for part in query.split("&"):
            if "=" in part:
                k, v = part.split("=", 1)
                if k in ("v", "list"):
                    kept.append(f"{k}={v}")
        if kept:
            canonical = main + "?" + "&".join(kept)
    return [url] if canonical == url else [url, canonical]


def _expand_url_variants(urls: list[str]) -> list[str]:
    """Flatten + dedupe variants for all URLs in a list, preserving order."""
    out: list[str] = []
    seen: set[str] = set()
    for u in urls:
        for v in _yt_url_variants(u):
            if v and v not in seen:
                seen.add(v)
                out.append(v)
    return out


# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok"}


# ── Request models ────────────────────────────────────────────────────────────
class VideoStatsRequest(BaseModel):
    project_id: str
    video_urls: list[str]
    platform: str
    calc_metrics: list[str] = []   # calculated metrics chosen at export time
    raw_metrics: list[str] = []    # optional raw columns (Likes/Comments/Shares)


class ProfileAuditRequest(BaseModel):
    project_id: str
    usernames: list[str]
    platform: str
    sort_by: str = "Most Views"
    incl_top5: bool = True
    incl_bot5: bool = False
    limit: int = 0   # cap videos per creator to exactly this (0 = no cap)
    calc_metrics: list[str] = []   # user-selected calculated metrics (e.g. Engagement Rate)
    raw_metrics: list[str] = []    # optional raw columns (Likes/Comments/Shares)
    rates: dict = {}               # per-KOL rate ($) for CPV, keyed by username
    date_from: str = ""            # chosen scrape window start (for the duration column)
    date_to: str = ""
    layout: dict = {}              # builder layout: which sheets/columns + order


class NLPRequest(BaseModel):
    project_id: str
    video_urls: list[str]
    platform: str


class EcomRequest(BaseModel):
    project_id: str
    brand_filter: str | None = None      # case-insensitive ilike match; None = all brands
    platform_filter: str | None = None   # "Shopee" | "Tokopedia" | None for all
    job_id: str | None = None            # filter to a single scrape job's listings; None = all jobs
    # Shop filter applies at export time (decoupled from scrape).
    # 'all' | 'official_only' | 'non_official_only' | 'specific_shops'
    shop_filter: str | None = "all"
    specific_shops: list[str] | None = None   # used when shop_filter == 'specific_shops'


# ── Endpoints ─────────────────────────────────────────────────────────────────
@app.post("/export/video-stats")
def export_video_stats(req: VideoStatsRequest):
    supabase = _supabase()
    # Expand to canonical-URL variants so we find rows scraped before the
    # worker started preserving target-URL form (old rows have www.youtube.com
    # without tracking params; new rows have whatever the user pasted).
    queried_urls = _expand_url_variants(req.video_urls)
    print(f"[export/video-stats] platform={req.platform} querying {len(queried_urls)} URL variant(s): {queried_urls[:5]}")
    rows = get_campaign_videos(supabase, req.platform, queried_urls)
    print(f"[export/video-stats] -> {len(rows)} row(s) matched")
    if not rows:
        # Diagnostic detail: show the exact URLs we searched for so the
        # frontend alert / Railway logs pinpoint the mismatch immediately
        # (rather than the generic "may still be processing" hand-wave).
        preview = "; ".join(queried_urls[:3]) + (f" (+{len(queried_urls) - 3} more)" if len(queried_urls) > 3 else "")
        raise HTTPException(
            status_code=404,
            detail=(f"No {req.platform} video rows matched. Searched {len(queried_urls)} URL variant(s): "
                    f"{preview}. Compare against `SELECT video_url FROM {'youtube' if req.platform == 'YouTube' else 'ig' if req.platform == 'Instagram' else 'tiktok'}_campaign_videos` in Supabase."),
        )
    df = pd.DataFrame(rows)
    buf = generate_video_stats_excel(df, is_tiktok=(req.platform == "TikTok"), calc_metrics=req.calc_metrics, raw_metrics=req.raw_metrics)
    platform_slug = req.platform.lower()
    return _xlsx_response(buf, f"video_stats_{platform_slug}.xlsx")


@app.post("/export/profile-audit")
def export_profile_audit(req: ProfileAuditRequest):
    supabase = _supabase()
    rows = get_influencer_profiles(supabase, req.platform, req.usernames)
    if not rows:
        raise HTTPException(
            status_code=404,
            detail="No profile data found. The job may still be processing.",
        )
    df = pd.DataFrame(rows)

    # Preserve the caller's username order (the paste order) so the export lists
    # creators in the same sequence they were entered, not Supabase row order.
    if req.usernames and "username" in df.columns:
        order = {u.lower(): i for i, u in enumerate(req.usernames)}
        df["_kol_order"] = (
            df["username"].astype(str).str.lower().map(order).fillna(len(order)).astype(int)
        )
        df = df.sort_values("_kol_order", kind="stable").drop(columns="_kol_order")

    buf = generate_profile_audit_excel(
        df,
        is_tiktok=(req.platform == "TikTok"),
        sort_by=req.sort_by,
        incl_top5=req.incl_top5,
        incl_bot5=req.incl_bot5,
        limit=req.limit,
        calc_metrics=req.calc_metrics,
        raw_metrics=req.raw_metrics,
        rates=req.rates,
        date_from=req.date_from,
        date_to=req.date_to,
        requested_usernames=req.usernames,
        layout=req.layout,
    )
    platform_slug = req.platform.lower()
    return _xlsx_response(buf, f"profile_audit_{platform_slug}.xlsx")


@app.post("/export/nlp")
def export_nlp(req: NLPRequest):
    supabase = _supabase()
    # Same URL-variants expansion as video-stats — comments rows can have
    # either canonical or pasted-form video_url depending on when they were
    # scraped.
    queried_urls = _expand_url_variants(req.video_urls)
    print(f"[export/nlp] platform={req.platform} querying {len(queried_urls)} URL variant(s): {queried_urls[:5]}")
    rows = get_comments(supabase, req.platform, queried_urls)
    print(f"[export/nlp] -> {len(rows)} row(s) matched")
    if not rows:
        raise HTTPException(
            status_code=404,
            detail="No comment data found. The scrape may still be running.",
        )
    config = get_nlp_config(supabase, req.project_id)
    df = pd.DataFrame(rows)
    buf = generate_nlp_excel(df, config)
    platform_slug = req.platform.lower()
    return _xlsx_response(buf, f"nlp_analysis_{platform_slug}.xlsx")


@app.post("/export/ecom")
def export_ecom(req: EcomRequest):
    """Competitor Analysis export — Phase 1 listings + inline Bahasa parser.
    Sheets: Products / By Flavour / Raw Listings / Notes. Sorted by total sold."""
    supabase = _supabase()
    rows = get_ecom_listings(
        supabase,
        project_id=req.project_id,
        brand_filter=req.brand_filter,
        platform_filter=req.platform_filter,
        job_id=req.job_id,
    )
    if not rows:
        raise HTTPException(
            status_code=404,
            detail=(
                "No ecom listings found for this project. "
                "Run an Ecom Listings scrape from the Competitor Analysis page first."
            ),
        )
    buf = build_ecom_workbook(
        rows,
        brand_filter=req.brand_filter,
        shop_filter=req.shop_filter or "all",
        specific_shops=req.specific_shops,
    )
    brand_slug = (req.brand_filter or "all").lower().replace(" ", "_")
    return _xlsx_response(buf, f"competitor_analysis_{brand_slug}.xlsx")
