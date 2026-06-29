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


# ── Endpoints ─────────────────────────────────────────────────────────────────
@app.post("/export/video-stats")
def export_video_stats(req: VideoStatsRequest):
    supabase = _supabase()
    rows = get_campaign_videos(supabase, req.platform, req.video_urls)
    if not rows:
        raise HTTPException(
            status_code=404,
            detail="No video data found. The job may still be processing.",
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
    rows = get_comments(supabase, req.platform, req.video_urls)
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
    buf = build_ecom_workbook(rows, brand_filter=req.brand_filter)
    brand_slug = (req.brand_filter or "all").lower().replace(" ", "_")
    return _xlsx_response(buf, f"competitor_analysis_{brand_slug}.xlsx")
