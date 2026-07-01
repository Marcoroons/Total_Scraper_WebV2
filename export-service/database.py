"""
database.py — Centralised Supabase helper functions.

Design: functions take an explicit `supabase` client parameter.
This lets both the Streamlit app (which uses @st.cache_resource) and the
Railway worker (which uses a plain sync init) share the same query logic
without coupling the connection strategy.

Usage in appv2.py:
    from database import db   # thin wrapper bound to the app's client

Usage in worker.py:
    from database import db   # thin wrapper bound to the worker's client

Or import functions directly:
    from database import get_pending_jobs, update_job_status
    get_pending_jobs(supabase)
"""
from __future__ import annotations

import os
import datetime
from typing import Any

# ─────────────────────────────────────────────────────────────────────────────
# CONNECTION FACTORY
# Used by worker.py (plain process, no Streamlit).
# appv2.py uses its own @st.cache_resource init instead.
# ─────────────────────────────────────────────────────────────────────────────
def make_client():
    """
    Create and return a Supabase client for non-Streamlit contexts (e.g. worker).
    Raises RuntimeError immediately if credentials are missing so the process
    exits with a clear message instead of failing silently mid-job.
    """
    from supabase import create_client, Client

    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_KEY", "")

    # Try loading from .streamlit/secrets.toml for local testing
    if not url or not key:
        secrets_path = ".streamlit/secrets.toml"
        if os.path.exists(secrets_path):
            with open(secrets_path) as f:
                for line in f:
                    if "=" in line and not line.strip().startswith("#"):
                        k, v = line.split("=", 1)
                        k, v = k.strip(), v.strip().strip('"').strip("'")
                        if k == "SUPABASE_URL": url = v
                        if k == "SUPABASE_KEY": key = v

    if not url or not key or url.startswith("FALLBACK"):
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_KEY must be set in environment variables "
            "or .streamlit/secrets.toml"
        )

    return create_client(url, key)


# ─────────────────────────────────────────────────────────────────────────────
# SCRAPE JOBS
# ─────────────────────────────────────────────────────────────────────────────
def get_pending_jobs(supabase, limit: int = 1) -> list[dict]:
    """Return up to `limit` PENDING scrape jobs, oldest first."""
    return (
        supabase.table("scrape_jobs")
        .select("*")
        .eq("status", "PENDING")
        .order("created_at")
        .limit(limit)
        .execute()
        .data or []
    )


def get_project_jobs(
    supabase,
    project_id: str,
    platform: str | None = None,
    job_type: str | None = None,
    status: str | None = None,
) -> list[dict]:
    """Fetch scrape jobs for a project with optional filters."""
    q = supabase.table("scrape_jobs").select("*").eq("project_id", project_id)
    if platform:  q = q.eq("platform",  platform)
    if job_type:  q = q.eq("job_type",  job_type)
    if status:    q = q.eq("status",    status)
    return q.order("created_at", desc=True).execute().data or []


def update_job_status(
    supabase,
    job_id: str,
    status: str,
    error_message: str | None = None,
    id_col: str = "job_id",
) -> None:
    """Mark a scrape job as COMPLETED, FAILED, etc."""
    payload: dict[str, Any] = {"status": status}
    if error_message is not None:
        payload["error_message"] = str(error_message)[:500]
    elif status == "COMPLETED":
        payload["error_message"] = None
    supabase.table("scrape_jobs").update(payload).eq(id_col, job_id).execute()


def insert_jobs(supabase, rows: list[dict]) -> None:
    """Bulk-insert scrape job rows."""
    if rows:
        supabase.table("scrape_jobs").insert(rows).execute()


# ─────────────────────────────────────────────────────────────────────────────
# SCRAPED DATA  (ig / tiktok / youtube tables)
# ─────────────────────────────────────────────────────────────────────────────
# Platform → table-prefix mapping. Mirrors worker/database.py. Previously the
# export-service had a binary `pfx = "ig" if IG else "tiktok"` fallback which
# routed YouTube queries into tiktok_campaign_videos — returning 0 rows every
# time and 404ing every YouTube export.
_PFX = {"Instagram": "ig", "TikTok": "tiktok", "YouTube": "youtube"}


def _pfx(platform: str) -> str:
    return _PFX.get(platform, "ig")


def upsert_campaign_videos(supabase, platform: str, rows: list[dict]) -> None:
    pfx = _pfx(platform)
    if rows:
        supabase.table(f"{pfx}_campaign_videos").upsert(rows, on_conflict="video_url").execute()


def upsert_influencer_profiles(supabase, platform: str, rows: list[dict]) -> None:
    pfx = _pfx(platform)
    if rows:
        supabase.table(f"{pfx}_influencer_profiles").upsert(rows, on_conflict="username,post_url").execute()


def upsert_comments(supabase, platform: str, rows: list[dict]) -> None:
    pfx = _pfx(platform)
    if rows:
        supabase.table(f"{pfx}_comments").upsert(
            rows, on_conflict="video_url,commenter_username,comment_text"
        ).execute()


def upsert_trend_discovery(supabase, rows: list[dict]) -> None:
    if rows:
        supabase.table("trend_discovery").upsert(rows, on_conflict="video_url").execute()


def get_campaign_videos(supabase, platform: str, urls: list[str]) -> list[dict]:
    pfx = _pfx(platform)
    return (
        supabase.table(f"{pfx}_campaign_videos")
        .select("*").in_("video_url", urls).execute().data or []
    )


def get_influencer_profiles(supabase, platform: str, usernames: list[str]) -> list[dict]:
    pfx = _pfx(platform)
    return (
        supabase.table(f"{pfx}_influencer_profiles")
        .select("*").in_("username", usernames).execute().data or []
    )


def get_comments(supabase, platform: str, video_urls: list[str]) -> list[dict]:
    pfx = _pfx(platform)
    return (
        supabase.table(f"{pfx}_comments")
        .select("*").in_("video_url", video_urls).execute().data or []
    )


# ─────────────────────────────────────────────────────────────────────────────
# ECOM LISTINGS  (Competitor Analysis Phase 1 table)
# ─────────────────────────────────────────────────────────────────────────────
def get_ecom_listings(
    supabase,
    project_id: str,
    brand_filter: str | None = None,
    platform_filter: str | None = None,
    job_id: str | None = None,
) -> list[dict]:
    """Fetch ecom_listings rows for a project, optionally narrowed by brand,
    platform, or the originating scrape job (the job_id filter is the easy way
    to exclude legacy listings from a contaminated table — pass the latest
    completed Ecom Listings job_id to get just that run's data)."""
    q = (
        supabase.table("ecom_listings")
        .select("*")
        .eq("project_id", project_id)
    )
    if platform_filter:
        q = q.eq("platform", platform_filter)
    if brand_filter:
        q = q.ilike("brand_name", brand_filter)
    if job_id:
        q = q.eq("job_id", job_id)
    return q.order("scraped_at", desc=True).execute().data or []


# ─────────────────────────────────────────────────────────────────────────────
# NLP CONFIGS
# ─────────────────────────────────────────────────────────────────────────────
def get_nlp_config(supabase, project_id: str) -> dict:
    """Return the NLP config for a project, or an empty dict if none exists."""
    res = (
        supabase.table("nlp_configs")
        .select("*").eq("project_id", project_id).execute()
    )
    return res.data[0] if res.data else {}


def upsert_nlp_config(supabase, project_id: str, updates: dict) -> None:
    # Ensure a row exists first
    existing = supabase.table("nlp_configs").select("project_id").eq("project_id", project_id).execute()
    if not existing.data:
        supabase.table("nlp_configs").insert({"project_id": project_id}).execute()
    supabase.table("nlp_configs").update(updates).eq("project_id", project_id).execute()


# ─────────────────────────────────────────────────────────────────────────────
# PROJECTS & TEAMS
# ─────────────────────────────────────────────────────────────────────────────
def get_user_projects(supabase, user_id: str, team_id: str | None = None) -> list[dict]:
    if team_id:
        return supabase.table("projects").select("*").eq("team_id", team_id).execute().data or []
    return (
        supabase.table("projects").select("*")
        .eq("user_id", user_id).is_("team_id", "null").execute().data or []
    )


def get_user_teams(supabase, user_id: str) -> list[dict]:
    return (
        supabase.table("team_members")
        .select("team_id, teams(name, owner_id)")
        .eq("user_id", user_id).execute().data or []
    )


# ─────────────────────────────────────────────────────────────────────────────
# KOL SNAPSHOTS  (time-series tracking)
# ─────────────────────────────────────────────────────────────────────────────
def write_kol_snapshot(
    supabase,
    project_id: str,
    username: str,
    platform: str,
    payload: list[dict],
) -> None:
    """
    Write a daily aggregate snapshot from a Profile Feed payload.
    Silently skips if the kol_snapshots table doesn't exist yet.

    Requires (run once in Supabase SQL editor):
        CREATE TABLE kol_snapshots (
            id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
            project_id uuid, username text, platform text,
            snapshot_date date DEFAULT CURRENT_DATE,
            total_posts integer DEFAULT 0,
            avg_play_count numeric DEFAULT 0,
            avg_likes numeric DEFAULT 0,
            avg_comments numeric DEFAULT 0,
            avg_shares numeric DEFAULT 0,
            avg_er numeric DEFAULT 0,
            scraped_at timestamptz DEFAULT now(),
            UNIQUE(project_id, username, platform, snapshot_date)
        );
    """
    try:
        valid   = [p for p in payload if p.get("play_count", 0) > 0]
        if not valid:
            return
        visible = [p for p in valid if p.get("likes", 0) != -1]

        avg_plays    = sum(p["play_count"]      for p in valid)   / len(valid)
        avg_likes    = sum(p.get("likes",    0) for p in visible) / max(len(visible), 1)
        avg_comments = sum(p.get("comments", 0) for p in valid)   / len(valid)
        avg_shares   = sum(p.get("shares",   0) for p in valid)   / len(valid)
        avg_er = (
            sum(
                (p.get("likes", 0) + p.get("comments", 0) + p.get("shares", 0))
                / max(p["play_count"], 1)
                for p in visible
            ) / max(len(visible), 1) * 100
        )

        supabase.table("kol_snapshots").upsert({
            "project_id":     project_id,
            "username":       username,
            "platform":       platform,
            "snapshot_date":  str(datetime.date.today()),
            "total_posts":    len(payload),
            "avg_play_count": round(avg_plays,    2),
            "avg_likes":      round(avg_likes,    2),
            "avg_comments":   round(avg_comments, 2),
            "avg_shares":     round(avg_shares,   2),
            "avg_er":         round(avg_er,       4),
        }, on_conflict="project_id,username,platform,snapshot_date").execute()
    except Exception as e:
        print(f"   ⚠️ Snapshot write skipped (kol_snapshots may not exist yet): {e}")


def get_kol_snapshots(
    supabase,
    project_id: str,
    username: str,
    platform: str,
) -> list[dict]:
    try:
        return (
            supabase.table("kol_snapshots")
            .select("*")
            .eq("project_id", project_id)
            .eq("username",   username)
            .eq("platform",   platform)
            .order("snapshot_date")
            .execute()
            .data or []
        )
    except Exception:
        return []


# ─────────────────────────────────────────────────────────────────────────────
# AUTOMATIONS & SCHEDULED EMAILS
# ─────────────────────────────────────────────────────────────────────────────
def get_due_automations(supabase, now_iso: str) -> list[dict]:
    return (
        supabase.table("automations")
        .select("*").eq("status", "ACTIVE").lte("next_run_at", now_iso)
        .limit(1).execute().data or []
    )


def advance_automation(supabase, auto_id: str, next_run_iso: str) -> None:
    supabase.table("automations").update({"next_run_at": next_run_iso}).eq("id", auto_id).execute()


def get_due_scheduled_emails(supabase, now_iso: str) -> list[dict]:
    return (
        supabase.table("scheduled_emails")
        .select("*").eq("status", "PENDING").lte("scheduled_for", now_iso)
        .limit(1).execute().data or []
    )


def mark_email_sent(supabase, email_id: str) -> None:
    supabase.table("scheduled_emails").update({"status": "SENT", "file_data": None}).eq("id", email_id).execute()


def mark_email_failed(supabase, email_id: str) -> None:
    supabase.table("scheduled_emails").update({"status": "FAILED"}).eq("id", email_id).execute()
