"""
worker.py — Background Execution Engine (Railway)
Restored: all Apify scraping, scheduled emails, recurring automations.
Added: Multi-Layer Intelligence compiler (YouTube, Meta Ads, Trends, News).
Added: Competitor Analysis Phase 1 — Shopee + Tokopedia listings ("Ecom Listings" job).
"""
import os, time, re, requests, smtplib, base64, datetime, urllib.parse, json, unicodedata
import feedparser
from pytrends.request import TrendReq
from email.message import EmailMessage
from supabase import create_client, Client
import sys
import database as db

sys.stdout.reconfigure(line_buffering=True)
print("--- WORKER INITIALIZING ---\n")

APIFY_TOKEN     = os.environ.get("APIFY_TOKEN","").strip()
META_AD_TOKEN   = os.environ.get("META_AD_TOKEN","").strip()
YOUTUBE_API_KEY = os.environ.get("YOUTUBE_API_KEY", "").strip()

# ── Competitor Intelligence kill-switch ──────────────────────────────────────
# OFF by default. While off, the daily Multi-Layer Intelligence compiler never
# runs and the competitor job types short-circuit, so neither can block or slow
# the core scrape→Excel path. Flip ENABLE_INTELLIGENCE=true (Railway → Variables)
# once Competitor Analysis is ready to ship. No code is removed — only gated.
ENABLE_INTELLIGENCE = os.environ.get("ENABLE_INTELLIGENCE", "").strip().lower() in ("1", "true", "yes", "on")
INTELLIGENCE_JOB_TYPES = {
    "Competitor Ads (Meta)", "YouTube Intelligence",
    "Competitor Intelligence Scan",
}
# NOTE: "E-Commerce Intelligence" was removed 2026-06-26 along with the old
# Multi-Layer Intelligence ecom sweep. Replaced by "Ecom Listings" — see the
# COMPETITOR ANALYSIS section below. Old code preserved in
# DEAD_COMPETITOR_ANALYSIS_ENGINE/ for reference.

try:
    supabase: Client = db.make_client()
    # Print the project ref (first component of the Supabase URL) so we can
    # compare against Vercel's NEXT_PUBLIC_SUPABASE_URL — if they don't match,
    # the frontend and worker are looking at different databases and every
    # scheduled_report we insert from Vercel is invisible to the worker.
    _sb_url = (os.environ.get("SUPABASE_URL", "") or "").strip()
    try:
        _project_ref = _sb_url.split("://")[-1].split(".")[0][:24]
    except Exception:
        _project_ref = "?"
    print(f"✅ Supabase connected — project ref: {_project_ref}")
except RuntimeError as e:
    print(f"🚨 FATAL: {e}"); sys.exit(1)

if not APIFY_TOKEN:
    print("🚨 FATAL: APIFY_TOKEN not set."); sys.exit(1)
print("✅ Environment ready.\n")

# ─────────────────────────────────────────────────────────────────────────────
# CORE APIFY HELPER
# ─────────────────────────────────────────────────────────────────────────────
def call_apify(actor, run_input, token=None):
    """Start an Apify actor run, poll until it finishes, return the dataset items.

    Hardened against network / Apify hangs (2026-06-26):
      - All HTTP calls have explicit timeouts so a dropped connection raises
        promptly instead of leaving the worker stuck for hours.
      - The poll loop is capped at MAX_POLLS iterations (each is up to 30s via
        waitForFinish), so the worst case is bounded at ~30 minutes per actor
        call rather than infinite.
      - JSON parsing is defensive — a transient HTML error page from the API
        gateway raises a clear exception rather than KeyError-ing on .json().
    """
    MAX_POLLS = 60   # 60 × ~30s waitForFinish ≈ 30 min ceiling per actor call
    tok = (token or APIFY_TOKEN).strip()
    aid = actor.replace("/","~")
    hdrs = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}

    try:
        r = requests.post(
            f"https://api.apify.com/v2/acts/{aid}/runs",
            headers=hdrs, json=run_input, timeout=60,
        )
    except requests.RequestException as e:
        raise Exception(f"Apify start request failed: {str(e)[:200]}") from e
    if not r.ok:
        raise Exception(f"Start failed: {r.text[:300]}")
    try:
        start_data = r.json()["data"]
        run_id = start_data["id"]
        ds_id  = start_data["defaultDatasetId"]
    except (ValueError, KeyError, TypeError) as e:
        raise Exception(f"Apify start returned unexpected payload: {r.text[:300]}") from e
    print(f"   ➔ Apify Run {run_id}")

    for poll_i in range(MAX_POLLS):
        try:
            sr = requests.get(
                f"https://api.apify.com/v2/actor-runs/{run_id}?waitForFinish=30",
                headers=hdrs, timeout=45,
            )
        except requests.RequestException as e:
            # Transient network blip — treat the next iteration as a retry rather
            # than failing the whole job. If it persists, MAX_POLLS will cap us.
            print(f"   ⚠️ Apify poll {poll_i+1}/{MAX_POLLS} network error: {str(e)[:120]} — retrying")
            time.sleep(5)
            continue
        try:
            s = sr.json()["data"]["status"]
        except (ValueError, KeyError, TypeError):
            print(f"   ⚠️ Apify poll {poll_i+1}/{MAX_POLLS} returned non-JSON: {sr.text[:120]} — retrying")
            time.sleep(5)
            continue
        if s == "SUCCEEDED":
            break
        if s in ("FAILED","ABORTED","TIMED-OUT"):
            raise Exception(f"Apify Failed: {s}")
        # Else: READY / RUNNING — keep polling.
    else:
        raise Exception(f"Apify run {run_id} did not finish within {MAX_POLLS} polls (~30 min)")

    try:
        items = requests.get(
            f"https://api.apify.com/v2/datasets/{ds_id}/items",
            headers=hdrs, timeout=60,
        )
    except requests.RequestException as e:
        raise Exception(f"Apify dataset fetch failed: {str(e)[:200]}") from e
    if not items.ok:
        raise Exception(f"Dataset fetch failed: HTTP {items.status_code}")
    try:
        return items.json()
    except ValueError as e:
        raise Exception(f"Apify dataset returned non-JSON: {items.text[:200]}") from e

IG = {"video_stats":"apify/instagram-scraper","profile":"apify/instagram-scraper","comments":"apify/instagram-comment-scraper","hashtag":"apify/instagram-hashtag-scraper"}
TT = {"video_stats":"clockworks/tiktok-scraper","profile":"clockworks/tiktok-scraper","comments":"clockworks/tiktok-comments-scraper","hashtag":"clockworks/tiktok-scraper"}
# YouTube as a first-class platform — Video Stats / Profile Audit / Comments only.
# The main `streamers/youtube-scraper` returns videos AND shorts in ONE run via
# per-type caps (`maxResults` / `maxResultsShorts` / `maxResultStreams`); leaving
# any of those blank means INFINITE (documented actor bug), so the worker MUST
# always send explicit integer values for all three on every call (see
# `_yt_caps`). `streamers/youtube-shorts-scraper` is reserved as an optional
# fallback for channel-shorts coverage and is NOT currently wired in. NO
# "hashtag" key — YouTube has no hashtag-feed flow (the UI hides the option).
YT = {"video_stats":"streamers/youtube-scraper",
      "shorts":"streamers/youtube-shorts-scraper",
      "profile":"streamers/youtube-scraper",
      "comments":"streamers/youtube-comments-scraper"}

# ─────────────────────────────────────────────────────────────────────────────
# EMAIL DISPATCHER
# ─────────────────────────────────────────────────────────────────────────────
def dispatch_email(msg):
    bot = os.environ.get("BOT_EMAIL","").strip()
    pw  = os.environ.get("BOT_APP_PASSWORD","").strip()
    if not bot or not pw:
        raise Exception("BOT_EMAIL/BOT_APP_PASSWORD missing on the worker service")
    # Granular prints + explicit timeout so a hang can't lock the worker on
    # SMTP forever (Gmail can take 30-60s to time out silently without one).
    print(f"   ✉️  SMTP connect smtp.gmail.com:465 …")
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=30) as s:
        print(f"   ✉️  SMTP login as {bot} …")
        s.login(bot, pw)
        print(f"   ✉️  SMTP send to {msg['To']} …")
        s.send_message(msg)
        print(f"   ✉️  SMTP OK")

# ─────────────────────────────────────────────────────────────────────────────
# EXTRACTION LAYER INTEGRATIONS
# ─────────────────────────────────────────────────────────────────────────────
def fetch_meta_ads(pid, competitor_name):
    """
    Fetch Meta ads via two methods (tried in order):
    1. Official Graph API — if META_AD_TOKEN is set in Railway env vars.
    2. Public Ad Library web scrape — works WITHOUT any token.
       Navigates to facebook.com/ads/library via Apify playwright.
    """
    if META_AD_TOKEN:
        _fetch_meta_ads_api(pid, competitor_name)
    else:
        print("   ℹ️  META_AD_TOKEN not set — falling back to public Ad Library scrape")
        _fetch_meta_ads_scraper(pid, competitor_name, APIFY_TOKEN)


def _fetch_meta_ads_api(pid, competitor_name):
    """Official Meta Ads Archive API (requires META_AD_TOKEN)."""
    params = {
        "access_token": META_AD_TOKEN, "ad_type": "ALL",
        "ad_reached_countries": '["ID"]',
        "search_terms": competitor_name, "ad_active_status": "ACTIVE", "limit": 100,
        "fields": "id,ad_creative_body,ad_creative_link_description,ad_delivery_start_time,page_name,impressions,publisher_platforms",
    }
    try:
        res = requests.get("https://graph.facebook.com/v18.0/ads_archive",
                           params=params, timeout=30)
        if not res.ok: raise Exception(res.text[:200])
        rows = []
        for ad in res.json().get("data", []):
            imp = ad.get("impressions", {})
            rows.append({
                "project_id": pid, "competitor_name": competitor_name,
                "ad_id": ad.get("id", ""),
                "ad_copy": ad.get("ad_creative_body","") or ad.get("ad_creative_link_description",""),
                "page_name": ad.get("page_name",""),
                "platform": str(ad.get("publisher_platforms",[])),
                "status": "ACTIVE",
                "start_time": ad.get("ad_delivery_start_time",""),
                "impression_min": int(imp.get("lower_bound",0)) if isinstance(imp,dict) else 0,
                "impression_max": int(imp.get("upper_bound",0)) if isinstance(imp,dict) else 0,
                "scraped_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            })
        if rows:
            supabase.table("meta_active_ads").upsert(rows, on_conflict="project_id,ad_id").execute()
            print(f"   ✅ Meta API: {len(rows)} ads saved.")
    except Exception as e:
        print(f"   ❌ Meta API error: {e}")


def _fetch_meta_ads_scraper(pid, competitor_name, apify_token):
    """
    Scrape the PUBLIC Meta Ad Library page — no token required.
    URL: facebook.com/ads/library/?active_status=active&country=ID&q=BRAND
    Uses Apify playwright-scraper with stealth mode to render the page and
    extract ad copy, page names, and start dates.
    """
    import urllib.parse
    q   = urllib.parse.quote(competitor_name)
    url = (f"https://www.facebook.com/ads/library/"
           f"?active_status=active&ad_type=all&country=ID"
           f"&q={q}&search_type=keyword_unordered&media_type=all")

    page_fn = r"""
async function pageFunction(context) {
    const { page } = context;

    // Dismiss cookie / consent dialogs
    for (const sel of [
        '[data-cookiebannerref="dialog"] button[value="1"]',
        'button[data-testid="cookie-policy-manage-dialog-accept-button"]',
        'button[title="Allow all cookies"]',
        '._42ft._4jy0._6lth._4jy6._4jy1.selected._51sy',
    ]) {
        try { const btn = await page.$(sel); if (btn) { await btn.click(); await page.waitForTimeout(1000); } }
        catch(e) {}
    }

    // Wait for ad cards to render (Ad Library is slow)
    for (let i = 0; i < 4; i++) {
        await page.waitForTimeout(3000);
        const cards = await page.$$('[data-testid="ad_library_main_page_card"], [data-testid="ad_library_preview_card"], ._7jyr._sxxr');
        if (cards.length > 0) break;
    }
    await page.waitForTimeout(2000);

    return await page.evaluate(() => {
        const results = [];

        // ── Strategy 1: official test-id selectors ───────────────────────────
        const mainCards = document.querySelectorAll('[data-testid="ad_library_main_page_card"]');
        const previewCards = document.querySelectorAll('[data-testid="ad_library_preview_card"]');
        const cards = mainCards.length > 0 ? mainCards : previewCards;

        if (cards.length > 0) {
            cards.forEach((card, i) => {
                if (i >= 40) return;
                const pageName = (
                    card.querySelector('[data-testid="ad_library_main_page_card_page_name"]')?.innerText ||
                    card.querySelector('[data-testid="ad_library_preview_card_ad_page_name"]')?.innerText ||
                    card.querySelector('a[href*="/ads/"]')?.innerText || ''
                ).trim();
                const adCopy = (
                    card.querySelector('[data-testid="ad_library_preview_card_body"]')?.innerText ||
                    card.querySelector('._7jyt')?.innerText ||
                    card.querySelectorAll('div > p')[0]?.innerText || ''
                ).trim().substring(0, 800);
                const startDate = (
                    card.querySelector('[data-testid="ad_library_preview_card_start_date"]')?.innerText || ''
                ).replace('Started running on', '').trim();
                const platforms = Array.from(card.querySelectorAll('img[alt]')).map(i => i.alt).filter(a => ['Facebook','Instagram','Messenger','WhatsApp','Audience Network'].includes(a));

                if (adCopy || pageName) {
                    results.push({ page_name: pageName, ad_copy: adCopy, start_time: startDate, platform: platforms.join(',') || 'Facebook,Instagram', status: 'ACTIVE' });
                }
            });
            return results;
        }

        // ── Strategy 2: text-based fallback when selectors have changed ──────
        const adRegions = document.querySelectorAll('div[class*="x78zum5 x1n2onr6"]');
        adRegions.forEach((el, i) => {
            if (i >= 40) return;
            const lines = (el.innerText || '').split('\n').filter(l => l.trim().length > 5);
            if (lines.length >= 2) {
                results.push({ page_name: lines[0], ad_copy: lines.slice(1, 6).join(' '), start_time: '', platform: 'Facebook,Instagram', status: 'ACTIVE' });
            }
        });

        if (results.length === 0) {
            // Return debug info so we can improve selectors
            return [{ _debug: true, url: location.href, html_length: document.body.innerHTML.length,
                body_text_preview: document.body.innerText.substring(0, 500) }];
        }
        return results;
    });
}"""

    try:
        tok  = (apify_token or APIFY_TOKEN).strip()
        aid  = "apify~playwright-scraper"
        hdrs = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
        run_input = {
            "startUrls": [{"url": url}],
            "pageFunction": page_fn,
            "maxPagesPerCrawl": 1,
            # Stealth mode helps avoid bot detection
            "launchContext": {
                "launchOptions": {"headless": True},
                "stealth": True,
                "useChrome": True,
            },
        }
        print(f"   🔍 Ad Library URL: {url[:80]}")
        r = requests.post(
            f"https://api.apify.com/v2/acts/{aid}/runs?waitForFinish=150",
            headers=hdrs, json=run_input, timeout=165
        )
        if not r.ok:
            print(f"   ❌ Apify start failed: {r.text[:150]}")
            return
        ds = r.json()["data"]["defaultDatasetId"]
        items = requests.get(f"https://api.apify.com/v2/datasets/{ds}/items", headers=hdrs).json()
        print(f"   📦 Apify returned {len(items)} item(s)")

        rows = []
        for i, item in enumerate(items or []):
            # Debug item — log it but don't save
            if item.get("_debug"):
                print(f"   ⚠️  Ad Library debug: html_length={item.get('html_length')} | preview={item.get('body_text_preview','')[:150]}")
                continue
            page_name = str(item.get("page_name","")).strip()[:200]
            ad_copy   = str(item.get("ad_copy","")).strip()[:1000]
            if not page_name and not ad_copy:
                continue
            # Generate a stable ad_id from page+copy hash since we don't have real ad IDs
            import hashlib
            ad_id = hashlib.md5(f"{pid}{competitor_name}{page_name}{ad_copy[:100]}".encode()).hexdigest()
            rows.append({
                "project_id":    pid,
                "competitor_name": competitor_name,
                "ad_id":         f"scrape_{ad_id}",
                "ad_copy":       ad_copy,
                "page_name":     page_name,
                "platform":      str(item.get("platform","Facebook,Instagram")),
                "status":        "ACTIVE",
                "start_time":    str(item.get("start_time",""))[:50],
                "impression_min": 0,
                "impression_max": 0,
                "scraped_at":    datetime.datetime.now(datetime.timezone.utc).isoformat(),
            })

        if rows:
            supabase.table("meta_active_ads").upsert(rows, on_conflict="project_id,ad_id").execute()
            print(f"   ✅ Ad Library scrape: {len(rows)} ads saved.")
        else:
            print("   ⚠️  Ad Library: 0 ads extracted — Facebook may have changed selectors or shown CAPTCHA.")
            print("        Check Railway logs for _debug output to diagnose.")
    except Exception as e:
        print(f"   ❌ Ad Library scrape error: {e}")



def fetch_youtube_videos(pid, competitor_name):
    if not YOUTUBE_API_KEY: return
    try:
        from googleapiclient.discovery import build
        youtube = build("youtube", "v3", developerKey=YOUTUBE_API_KEY)
        cutoff_date = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=45)).isoformat() + "Z"
        req = youtube.search().list(q=f"{competitor_name} official", part="snippet", type="video", maxResults=15, regionCode="ID", publishedAfter=cutoff_date)
        res = req.execute()
        if not res.get("items"): return
        
        video_ids = [item["id"]["videoId"] for item in res["items"]]
        stats_req = youtube.videos().list(part="statistics", id=",".join(video_ids))
        stats_res = stats_req.execute()
        view_counts = {item["id"]: int(item["statistics"].get("viewCount", 0)) for item in stats_res.get("items", [])}
        
        rows = []
        for item in res["items"]:
            vid = item["id"]["videoId"]
            snip = item["snippet"]
            rows.append({
                "project_id": pid, "competitor_name": competitor_name, "video_id": vid,
                "title": snip.get("title", ""), "description": snip.get("description", ""),
                "channel_name": snip.get("channelTitle", ""), "published_at": snip.get("publishedAt", ""),
                "view_count": view_counts.get(vid, 0), "scraped_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
            })
        if rows: supabase.table("youtube_videos").upsert(rows, on_conflict="project_id,video_id").execute()
    except Exception as e: print(f"   ❌ YouTube fetch failed: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# ═════════════════════════════════════════════════════════════════════════════
# COMPETITOR ANALYSIS — Shopee + Tokopedia listings (Phase 1: raw scraping)
# ═════════════════════════════════════════════════════════════════════════════
# Schema: see sql/ecom_listings.sql.
# Phase 1 stores raw listings (one row per variation) with parse_confidence='raw'.
# Phase 2 will add Bahasa enrichment (bundle / volume / container / flavour).
# Phase 3 will add cross-listing aggregation (median + MAD outliers, demand-wt).
#
# Old "Multi-Layer Intelligence" engine (5 retailers + flat ecommerce_products
# table + curl_cffi Cloudflare bypass) was scrapped 2026-06-26. Its code lives
# at DEAD_COMPETITOR_ANALYSIS_ENGINE/worker_ecom_legacy.py for reference; see
# that folder's README.md for the why and a revival checklist.
# ─────────────────────────────────────────────────────────────────────────────

ECOM_ACTORS = {
    "Shopee":    "gio21/shopee-scraper",
    "Tokopedia": "jupri/tokopedia-scraper",
}

def _ecom_parse_idr(raw) -> float:
    """Clean an Indonesian Rupiah price string to a float. 'Rp 15.000' -> 15000.0.
    Indonesian convention: dots = thousands separator, comma = decimal."""
    if raw is None or raw == "": return 0.0
    if isinstance(raw, (int, float)): return float(raw)
    s = re.sub(r'(?i)rp\.?\s*|idr\.?\s*|\s', '', str(raw))
    s = re.sub(r'[^\d.,]', '', s)
    if not s: return 0.0
    dc, cc = s.count('.'), s.count(',')
    if dc > 1:                    s = s.replace('.', '').replace(',', '.')
    elif dc == 1 and cc == 0:     s = s.replace('.', '') if len(s.split('.')[1]) == 3 else s
    elif cc >= 1:                 s = s.replace('.', '').replace(',', '.')
    try:    return float(s)
    except: return 0.0

def _ecom_safe_float(x):
    try: return float(x) if x is not None and x != "" else None
    except (TypeError, ValueError): return None

def _ecom_safe_int(x):
    """Parse to int. Handles: int/float, '1234', '1.234' (Indonesian thousand
    separator), '1.2K', '1.2 k', '500+', '10rb' (Indonesian 'ribu' = thousand),
    '2.5M'. Returns None for unparseable / empty / negative values."""
    try:
        if x is None or x == "": return None
        if isinstance(x, bool): return int(x)
        if isinstance(x, (int, float)): return int(x) if x >= 0 else None
        s = str(x).strip().lower().replace("+", "")
        if not s: return None
        # Distinguish '1.5' (decimal) from '1.500' (Indonesian thousand-dot).
        # Same heuristic the price parser uses: a single dot followed by
        # exactly 3 digits is a thousands separator.
        if "." in s and "," not in s:
            head, _, tail = s.partition(".")
            if tail.isdigit() and len(tail) == 3:
                s = head + tail
        s = s.replace(",", ".")
        m = re.match(r"^([0-9]*\.?[0-9]+)\s*([kmrb]+)?$", s)
        if not m:
            s2 = s.replace(".", "")
            return int(s2) if s2.isdigit() else None
        num = float(m.group(1))
        suf = m.group(2) or ""
        if suf in ("k", "rb"):
            num *= 1000
        elif suf == "m":
            num *= 1_000_000
        return int(num) if num >= 0 else None
    except (TypeError, ValueError):
        return None

def _ecom_first_present(*candidates):
    """Return the first candidate that is not None / not empty-string.
    Unlike `a or b or c`, this preserves a legitimate 0 — important for
    historicalSoldEstimated where 0 means 'no recorded sales' (a useful
    signal), not 'unknown' (which would be None)."""
    for c in candidates:
        if c is not None and c != "":
            return c
    return None

def _worker_parse_volume(s: str):
    """Parse a user-typed volume string into (value, 'ml'|'g').
    '240ml' → (240, 'ml'); '1L' → (1000, 'ml'); '100g' → (100, 'g'); '1kg' → (1000, 'g').
    Returns (None, None) on unrecognised input."""
    if not s or not s.strip(): return None, None
    m = re.match(r"\s*(\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)\b", s.strip().lower())
    if not m: return None, None
    val = float(m.group(1).replace(",", "."))
    uom = m.group(2)
    if uom == "ml":                                          return val,        "ml"
    if uom in ("l", "lt", "ltr", "liter", "litre"):          return val * 1000, "ml"
    if uom in ("g", "gr", "gram", "grm"):                    return val,        "g"
    if uom in ("kg", "kgs", "kilo", "kilogram", "kilogramme"): return val * 1000, "g"
    return None, None

def _ecom_is_official(item: dict, platform: str) -> bool:
    """Best-effort 'is official store' check across the field shapes Shopee /
    Tokopedia actors may return. Reads both top-level booleans and nested shop
    dicts; falls back to a shopName substring match because gio21/shopee-scraper
    doesn't expose officiality as a boolean (verified 2026-06-26)."""
    if platform == "Shopee":
        if any(item.get(k) for k in ("isOfficialShop","isMall","officialShop","shopeeMall")):
            return True
        shop = item.get("shop") if isinstance(item.get("shop"), dict) else {}
        if shop.get("isOfficial") or shop.get("isShopeeMall"):
            return True
        # Heuristic: Shopee Mall / official stores almost always include
        # "Official" or "Mall" in the shop name (e.g. "Nescafe Official Store").
        # Imperfect — a reseller calling itself "X Official Reseller" will match —
        # but the alternative is rejecting every item when the actor strips the flag.
        shop_name = str(item.get("shopName") or shop.get("name") or "").lower()
        return "official" in shop_name or " mall" in shop_name or shop_name.endswith("mall")
    if platform == "Tokopedia":
        if any(item.get(k) for k in ("isOfficialStore","official","isOfficial","officialStore")):
            return True
        shop = item.get("shop") if isinstance(item.get("shop"), dict) else {}
        if any(shop.get(k) for k in ("isOfficial","official","isOfficialStore")): return True
        labels = item.get("labels") or item.get("badges") or []
        if isinstance(labels, list):
            for l in labels:
                s = (l if isinstance(l, str) else str((l or {}).get("title") or (l or {}).get("name") or "")).lower()
                if "official" in s: return True
        return False
    return False

def _ecom_call_actor(actor: str, run_input: dict, apify_token: str) -> list:
    """Thin wrapper around call_apify with verbose logging — the Tokopedia and
    Shopee actors return different field shapes, so we always print the first
    item's keys so future-us can adapt mappers without a re-run."""
    items = call_apify(actor, run_input, apify_token) or []
    if items and isinstance(items, list):
        first = items[0] if isinstance(items[0], dict) else {}
        print(f"      {actor} returned {len(items)} items; first-item keys: {list(first.keys())[:25]}")
    return items

def _shopee_run(target: str, mode: str, max_items: int, apify_token: str, country: str = "ID") -> list:
    """Call gio21/shopee-scraper for one search target.
    Per the actor's input schema (verified from console screenshots 2026-06-29):
      - 'location'   — single keyword OR a shop/category URL ('the most reliable mode')
      - 'country'    — ISO-2 marketplace code
      - 'maxItems'   — hard cap
      - 'priceSlicing' — opt-in price-range slicing for fuller coverage; off here
    'location' handles both keyword and URL inputs, so we use it for both modes.
    The earlier 'keyword' field name was wrong and the actor was returning
    default/popular items rather than searching for our query."""
    cc = (country or "ID").upper()
    run_input = {
        "location":     target,
        "country":      cc,
        "maxItems":     max_items,
        "priceSlicing": False,
    }
    return _ecom_call_actor(ECOM_ACTORS["Shopee"], run_input, apify_token)

def _tokopedia_run(target: str, mode: str, max_items: int, apify_token: str, country: str = "ID") -> list:
    """Call jupri/tokopedia-scraper for one search target.
    Confirmed input shape from the actor's console UI:
      - 'query' (array of strings) — search terms
      - 'limit' (int) — max results
      - 'searchMode', 'shopLocation', 'sort', 'category', 'recentlyAdded',
        'priceMin'/'priceMax', 'condition', 'deliveryDuration' — all optional
        (exposed in the Product Search Filters block of the Apify UI).
    Shop-URL mode: the actor doesn't show a dedicated shop input in the
    keyword-search UI, so we pass the shop handle through 'query' as well and
    log the response shape — Phase 2 can add a real shop scrape once we wire
    in the filter knobs from the screenshots."""
    run_input = {"query": [target], "limit": max_items}
    return _ecom_call_actor(ECOM_ACTORS["Tokopedia"], run_input, apify_token)

def _shopee_to_rows(raw: dict, pid: str, jid: str, brand) -> list:
    """Map a single gio21/shopee-scraper item to ecom_listings rows.
    One row per variation; if the listing has no variations, one row total."""
    product_id = str(raw.get("itemId") or raw.get("id") or raw.get("itemid") or "")[:64]
    if not product_id: return []
    shop_dict = raw.get("shop") if isinstance(raw.get("shop"), dict) else {}
    base = {
        "project_id": pid, "job_id": jid, "platform": "Shopee",
        "product_id": product_id,
        "shop_name":  str(raw.get("shopName") or raw.get("shop_name") or shop_dict.get("name") or "")[:200] or None,
        "shop_url":   raw.get("shopUrl") or shop_dict.get("url") or None,
        "is_official_store": _ecom_is_official(raw, "Shopee"),
        "brand_name": brand or None,
        "title":      str(raw.get("name") or raw.get("itemName") or raw.get("title") or "")[:500],
        "description": str(raw.get("description") or raw.get("desc") or "")[:8000] or None,
        "rating":     _ecom_safe_float(_ecom_first_present(raw.get("rating"), raw.get("ratingStar"), raw.get("itemRating"))),
        # gio21/shopee-scraper returns 'historicalSoldEstimated'; older / other
        # actor versions use 'historicalSold' / 'sold' / 'soldCount' / 'salesCount'
        # / 'monthlySold' etc. Try a broad set, _ecom_first_present preserves a
        # legit 0. If every sales field is null/missing, fall back to reviewCount
        # as a known-imperfect popularity proxy (reviewers ⊂ buyers, so it's a
        # conservative lower bound; flagged separately in raw_payload so the
        # exporter can label it).
        "sold_count": _ecom_safe_int(_ecom_first_present(
            raw.get("historicalSoldEstimated"), raw.get("historicalSold"),
            raw.get("sold"), raw.get("soldCount"), raw.get("salesCount"),
            raw.get("monthlySold"), raw.get("totalSold"), raw.get("lifetimeSold"),
            raw.get("num_sold"), raw.get("numSold"),
        )),
        "url":        raw.get("itemUrl") or raw.get("url"),
        "parse_confidence": "raw",
        "raw_payload": raw,
    }
    variations = raw.get("variations") or raw.get("models") or raw.get("tierVariations") or []
    rows = []
    if isinstance(variations, list) and variations and isinstance(variations[0], dict):
        for v in variations:
            vid = str(v.get("modelId") or v.get("id") or v.get("name") or "")[:64]
            rows.append({
                **base, "variation_id": vid or "0",
                "listing_price_idr": _ecom_parse_idr(_ecom_first_present(v.get("price"), v.get("priceMin"), raw.get("price"))),
                "stock": "in_stock" if _ecom_safe_int(_ecom_first_present(v.get("stock"), v.get("stockCount"))) else "out_of_stock",
            })
    else:
        rows.append({
            **base, "variation_id": "",
            "listing_price_idr": _ecom_parse_idr(_ecom_first_present(raw.get("price"), raw.get("priceMin"))),
            "stock": "in_stock" if (raw.get("stock") or 1) else "out_of_stock",
        })
    return rows

def _tokopedia_to_rows(raw: dict, pid: str, jid: str, brand) -> list:
    """Map a single jupri/tokopedia-scraper item to ecom_listings rows.
    Robust to several field-name conventions because the actor's exact shape
    isn't documented here; raw_payload preserves the original for Phase 2."""
    product_id = (str(raw.get("id") or raw.get("productId") or raw.get("product_id") or raw.get("url") or "")[:200])
    if not product_id: return []
    shop_dict = raw.get("shop") if isinstance(raw.get("shop"), dict) else {}
    base = {
        "project_id": pid, "job_id": jid, "platform": "Tokopedia",
        "product_id": product_id,
        "shop_name":  str(shop_dict.get("name") or raw.get("shopName") or raw.get("seller") or "")[:200] or None,
        "shop_url":   shop_dict.get("url") or raw.get("shopUrl") or None,
        "is_official_store": _ecom_is_official(raw, "Tokopedia"),
        "brand_name": brand or None,
        "title":      str(raw.get("name") or raw.get("title") or raw.get("productName") or "")[:500],
        "description": str(raw.get("description") or raw.get("desc") or "")[:8000] or None,
        "rating":     _ecom_safe_float(raw.get("rating") or raw.get("avgRating") or raw.get("ratingAverage")),
        "sold_count": _ecom_safe_int(raw.get("sold") or raw.get("soldCount") or raw.get("countSold")),
        "url":        raw.get("url") or raw.get("productUrl"),
        "parse_confidence": "raw",
        "raw_payload": raw,
    }
    variations = raw.get("variants") or raw.get("variations") or raw.get("skus") or []
    rows = []
    if isinstance(variations, list) and variations and isinstance(variations[0], dict):
        for v in variations:
            vid = str(v.get("id") or v.get("sku") or v.get("name") or "")[:64]
            rows.append({
                **base, "variation_id": vid or "0",
                "listing_price_idr": _ecom_parse_idr(v.get("price") or raw.get("price")),
                "stock": "in_stock" if _ecom_safe_int(v.get("stock") or v.get("stockCount")) else "out_of_stock",
            })
    else:
        rows.append({
            **base, "variation_id": "",
            "listing_price_idr": _ecom_parse_idr(raw.get("price") or raw.get("priceMin")),
            "stock": "in_stock" if (raw.get("stock") or 1) else "out_of_stock",
        })
    return rows

def _shop_name_of(item: dict) -> str:
    """Pull the shop name out of either the top-level or nested-shop shape."""
    sn = item.get("shopName") or item.get("shop_name") or ""
    if not sn and isinstance(item.get("shop"), dict):
        sn = item["shop"].get("name") or ""
    return str(sn).strip()


def _shop_is_official(shop_name: str) -> bool:
    """'official_only' check — does the shop name read as an official / Mall shop?
    Diacritic-normalized so 'Nestlé Indonesia Official' is detected.
    NOTE: we used to require brand tokens here too, but that broke parent-brand
    stores (Nescafe sold by 'Nestlé Indonesia Official Store', Top Coffee sold
    by 'Wings Official', etc.). With title-validation now rejecting off-brand
    titles at the scrape stage, the shop check can be the simpler 'is this an
    Official/Mall shop at all?' — title-validation handles brand purity."""
    sn = _norm_text(shop_name)
    if not sn:
        return False
    return "official" in sn or "mall" in sn


def _apply_official_filter(items: list, mode: str, platform: str, brand: str,
                           specific_shops=None) -> list:
    """
    mode='all'                — no filter.
    mode='official_only'      — keep any shop whose name reads as Official / Mall.
                                Title-validation has already enforced brand purity
                                upstream, so this is the simpler 'is the seller a
                                Mall shop' check (works for parent-brand stores
                                like 'Nestlé Indonesia Official Store').
    mode='non_official_only'  — exclude Official / Mall shops.
    mode='specific_shops'     — token-based, diacritic-normalized match against
                                a user-supplied shop-name list (see below).
    `brand` is accepted for backward-compatibility but no longer used by
    official_only (was previously the brand-strict requirement that broke
    parent-brand stores).
    """
    _ = brand   # intentionally unused — keep param for API stability
    if mode == "all" or not mode:
        return items
    if mode == "official_only":
        return [it for it in items if _shop_is_official(_shop_name_of(it))]
    if mode == "non_official_only":
        return [it for it in items if not _shop_is_official(_shop_name_of(it))]
    if mode == "specific_shops":
        # Token-based match: each user-supplied shop name's tokens (diacritic-
        # normalized) must ALL appear in the listing's normalized shopName.
        # Multiple shop entries are OR'd. So 'nestle indonesia' matches
        # 'Nestlé Indonesia Official Store', and listing 'Wings Official' also
        # matches if the user supplied 'wings official' as a separate entry.
        wanted_groups: list = []
        for s in (specific_shops or []):
            toks = _tokens(s)
            if toks:
                wanted_groups.append(toks)
        if not wanted_groups:
            return []   # user picked 'specific_shops' but listed none — reject all
        def _shop_match(it):
            sn_norm = _norm_text(_shop_name_of(it))
            return any(all(t in sn_norm for t in group) for group in wanted_groups)
        return [it for it in items if _shop_match(it)]
    return items

def _norm_text(s: str) -> str:
    """Lowercase + strip combining diacritics so 'Nestlé' becomes 'nestle'.
    Without this, the user typing 'nestle indonesia' never matches the actual
    Shopee Mall store called 'Nestlé Indonesia Official Store'."""
    return "".join(
        c for c in unicodedata.normalize("NFKD", s or "") if not unicodedata.combining(c)
    ).lower()

def _tokens(s: str) -> list:
    """Diacritic-normalized lowercase alphanumeric token split —
    'Nestlé Indonesia' → ['nestle','indonesia']."""
    return [t for t in re.findall(r"[a-z0-9]+", _norm_text(s)) if t]


# Indonesian ↔ English equivalents that show up on Shopee titles. When a user
# types `kaleng` we should accept listings that say "Canned" too. Each group
# is a set of interchangeable tokens — matching any one satisfies the search.
# Lowercase, diacritic-stripped. Extend as you encounter more synonym pairs.
_SYNONYM_GROUPS = [
    # Container / packaging
    {"kaleng", "can", "canned", "tin"},
    {"kotak", "box", "carton", "karton", "dus"},
    {"botol", "bottle"},
    {"sachet", "saset"},
    {"renceng", "string", "strip"},
    {"pouch", "pack", "bag", "bungkus"},
    # Flavours / common product terms
    {"coklat", "cokelat", "chocolate", "choco"},
    {"stroberi", "strawberry"},
    {"vanila", "vanilla", "vanille"},
    {"pisang", "banana"},
    {"kopi", "coffee"},
    {"susu", "milk"},
    {"jeruk", "orange"},
    {"mangga", "mango"},
    {"nanas", "pineapple"},
    {"ayam", "chicken"},
    {"daging", "beef", "meat"},
    {"pedas", "spicy", "hot"},
    {"goreng", "fried"},
    {"manis", "sweet"},
    {"asam", "sour"},
]
# Reverse index: token -> the set it belongs to (or None if no synonyms).
_TOK_TO_GROUP = {tok: grp for grp in _SYNONYM_GROUPS for tok in grp}


def _token_matches_title(tok: str, title_norm: str) -> bool:
    """Token satisfied if the normalized title contains the token OR any
    synonym from the same group. Substring match — 'choco' will match
    'chocolaty' too, which is acceptable for FMCG titles."""
    grp = _TOK_TO_GROUP.get(tok)
    if grp:
        return any(s in title_norm for s in grp)
    return tok in title_norm


def _title_has_volume(title: str, vol_str: str) -> bool:
    """Tolerant volume match — '240ml' user input matches '240ml', '240 ml',
    '240 ML' in the title. If the user input doesn't parse as number+UOM,
    falls back to a plain case-insensitive substring check."""
    if not vol_str or not vol_str.strip():
        return True
    t = (title or "").lower()
    m = re.match(r"\s*(\d+(?:[.,]\d+)?)\s*([a-z]+)", vol_str.lower())
    if not m:
        return vol_str.lower() in t
    num = m.group(1).replace(",", ".")
    uom = m.group(2)
    return bool(re.search(rf"(?<!\d){re.escape(num)}\s*{re.escape(uom)}\b", t))


def _title_matches_product(title: str, brand: str, flavour: str,
                           volume: str = "", ptype: str = "",
                           match_mode: str = "strict") -> bool:
    """Reject T-shirts and other-brand bleed at scrape time. Each user-supplied
    field is a strict filter — title must contain ALL of:
      - brand tokens     (always required)
      - flavour tokens   (when flavour is set; synonyms accepted)
      - volume           (when volume is set; STRICT mode only)
      - type tokens      (when type is set, synonyms accepted in STRICT mode)
    Both sides are diacritic-normalized so 'Nestlé' titles match 'nestle' brand.
    Synonym groups recognised: kaleng↔can↔canned, kotak↔box↔carton, botol↔bottle,
    coklat↔chocolate, susu↔milk, kopi↔coffee, ayam↔chicken, etc. — see
    _SYNONYM_GROUPS above.
    match_mode='strict' (default): enforce ALL fields.
    match_mode='loose':           only brand+flavour required; volume+type are
                                  used in the SEARCH query but not enforced on
                                  the result. Higher recall, lower precision.
    """
    t = " " + _norm_text(title) + " "
    # Brand: typically a proper noun — no synonym fallback (Nescafé != Nestle).
    for tok in _tokens(brand):
        if tok not in t:
            return False
    # Flavour: synonym-aware (coklat ↔ chocolate, susu ↔ milk, etc.).
    for tok in _tokens(flavour):
        if not _token_matches_title(tok, t):
            return False
    if match_mode == "loose":
        return True
    if volume and not _title_has_volume(title, volume):
        return False
    # Container type: synonym-aware (kaleng ↔ can ↔ canned, kotak ↔ box).
    for tok in _tokens(ptype):
        if not _token_matches_title(tok, t):
            return False
    return True


def ecom_run_listings(pid: str, jid: str, cfg: dict, apify_token: str) -> tuple:
    """
    Run an 'Ecom Listings' scrape job.
    cfg shape (also see app/competitor/page.tsx for the UI side):
      {
        "platforms":               ["Shopee","Tokopedia"],
        "products":                [{ "brand": str, "flavour": str }, ...],
        "official_store_filter":   "all" | "official_only" | "non_official_only",
        "max_listings_per_product": int (10..200, default 50),
      }
    For each product:
      - Search the actor with query = "{brand} {flavour}".
      - Title-validate the results: ALL brand tokens AND ALL flavour tokens
        must appear in the listing title (case-insensitive). Drops T-shirts,
        other brands, and Shopee's loose-relevance bleed.
      - Tag the surviving rows with brand_name=product.brand AND
        flavour=product.flavour, persisting the user's intent directly to the
        ecom_listings columns (no regex guessing).
    Returns (total_written, note).
    """
    platforms = [p for p in (cfg.get("platforms") or []) if p in ECOM_ACTORS]
    if not platforms:
        raise ValueError("ecom_config.platforms must include 'Shopee' and/or 'Tokopedia'")
    of_filter = (cfg.get("official_store_filter") or "all").lower()
    specific_shops = [str(s).strip() for s in (cfg.get("specific_shops") or []) if str(s).strip()]
    cap_per   = max(10, min(int(cfg.get("max_listings_per_product") or 50), 200))
    country   = (cfg.get("country") or "ID").upper()
    match_mode = (cfg.get("match_mode") or "strict").lower()
    if match_mode not in ("strict", "loose"): match_mode = "strict"

    # ── Build the product list, accepting both the new shape and the legacy ──
    products: list = []
    for p in (cfg.get("products") or []):
        if not isinstance(p, dict): continue
        b = str(p.get("brand", "")).strip()
        f = str(p.get("flavour", "")).strip()
        v = str(p.get("volume", "")).strip()
        ty = str(p.get("type", "")).strip()
        if b:
            products.append({"brand": b, "flavour": f, "volume": v, "type": ty})
    # Legacy fall-back: jobs queued before the redesign send keywords + brand_names.
    # Map them to single-brand products so older queued jobs still work.
    if not products:
        legacy_brand = (cfg.get("brand_names") or [""])[0]
        for kw in (cfg.get("keywords") or []):
            kw_s = str(kw).strip()
            if kw_s:
                products.append({"brand": str(legacy_brand).strip() or kw_s,
                                 "flavour": kw_s, "volume": "", "type": ""})
    if not products:
        raise ValueError("ecom_config.products must list at least one {brand, flavour} pair")

    total_written = 0
    notes: list = []

    for platform in platforms:
        # Tokopedia is Indonesia-only — silently skip if the user picked a non-ID country.
        if platform == "Tokopedia" and country != "ID":
            notes.append(f"Tokopedia: skipped (Tokopedia is Indonesia-only; country={country})")
            print(f"   ⚠️ Tokopedia skipped — Tokopedia is Indonesia-only (country={country})")
            continue
        print(f"   🛒 Ecom {platform} [{country}]: {len(products)} product(s), cap {cap_per}/product")
        runner = _shopee_run if platform == "Shopee" else _tokopedia_run
        mapper = _shopee_to_rows if platform == "Shopee" else _tokopedia_to_rows

        platform_rows: list = []
        seen_keys: set = set()
        actor_errors = 0
        raw_count = 0
        filtered_count = 0
        title_dropped = 0
        # Per-product diagnostics — surface 'where did the rows go?' to the user.
        per_product_stats: list = []

        for prod in products:
            brand   = prod["brand"]
            flavour = prod.get("flavour", "")
            volume  = prod.get("volume", "")
            ptype   = prod.get("type", "")
            # Search query stitches together every supplied refinement. Empty
            # fields drop out cleanly thanks to the join + strip.
            query   = " ".join(s for s in (brand, flavour, volume, ptype) if s).strip()
            product_label = (flavour or "(no flavour)") + (f" {volume}" if volume else "") + (f" {ptype}" if ptype else "")
            try:
                items = runner(query, "keyword", cap_per, apify_token, country)
            except Exception as e:
                print(f"      '{query}' FAILED: {str(e)[:200]}")
                actor_errors += 1
                per_product_stats.append({"label": product_label, "raw": 0, "matched": 0, "written": 0, "error": str(e)[:80]})
                continue
            prod_raw = len(items or [])
            raw_count += prod_raw

            # Title-validate FIRST (cheapest filter) — drops T-shirts and other
            # brands' products before we even consider the official-store check.
            valid: list = []
            for it in (items or []):
                if not isinstance(it, dict): continue
                title = it.get("name") or it.get("itemName") or it.get("title") or ""
                if not _title_matches_product(title, brand, flavour, volume, ptype, match_mode):
                    title_dropped += 1
                    continue
                valid.append(it)
            prod_matched = len(valid)

            # Shop filtering moved to EXPORT time as of 2026-06-29. Scrape now
            # saves every title-validated row (with is_official_store tagged so
            # the exporter / preview can filter or color-code). Reasons:
            #   - User loses no Apify cost by capturing more (one call returns
            #     a fixed batch regardless).
            #   - Visibility — user sees every seller in Captured Listings and
            #     can decide which to include in the export without re-running.
            #   - Reversibility — change the export filter, re-export instantly.
            filtered = valid
            filtered_count += len(filtered)

            # Pre-compute user-spec overlays so the per-row work is cheap.
            user_vol_val, user_vol_uom = _worker_parse_volume(volume)
            user_type = ptype.strip().lower() or None
            user_flavour = flavour.strip().lower() or None

            # Map to ecom_listings rows, then overlay the user-specified fields
            # so attribution is by the user's intent. Volume / type are only
            # overlaid when the user supplied them — otherwise we leave the
            # mapper's null values for Phase 2 (regex) to fill in later.
            prod_written = 0
            for it in filtered:
                rs = mapper(it, pid, jid, brand)
                for r in rs:
                    r["flavour"] = user_flavour
                    if user_type:
                        r["container_type"] = user_type
                    if user_vol_val is not None:
                        r["unit_volume"]     = user_vol_val
                        r["unit_volume_uom"] = user_vol_uom
                    key = (r["product_id"], r["variation_id"])
                    if key in seen_keys: continue
                    seen_keys.add(key)
                    platform_rows.append(r)
                    prod_written += 1
            per_product_stats.append({"label": product_label, "raw": prod_raw, "matched": prod_matched, "written": prod_written})

        if not platform_rows:
            if raw_count == 0:
                reason = f"{platform}: actor returned 0 items across {len(products)} product(s)"
                if actor_errors: reason += f" ({actor_errors} actor error(s))"
            elif title_dropped == raw_count:
                reason = (f"{platform}: actor returned {raw_count} item(s) but ALL failed the "
                          f"title-validation (brand or flavour tokens not in title)")
            else:
                reason = f"{platform}: {raw_count} returned, mapper produced 0 rows (see Railway logs)"
            notes.append(reason)
            print(f"      ⚠️ {reason}")
            continue

        try:
            supabase.table("ecom_listings").upsert(
                platform_rows, on_conflict="project_id,product_id,variation_id,platform"
            ).execute()
            total_written += len(platform_rows)
            # Per-shop visibility — surface the top sellers in the job's
            # error_message so the user sees who's behind the data without
            # opening Supabase or the preview panel.
            shop_counts: dict = {}
            n_official = 0
            for r in platform_rows:
                sn = (r.get("shop_name") or "(unknown shop)")
                shop_counts[sn] = shop_counts.get(sn, 0) + 1
                if r.get("is_official_store"):
                    n_official += 1
            top_shops = sorted(shop_counts.items(), key=lambda x: -x[1])[:3]
            shops_blurb = ", ".join(f"{s} ({n})" for s, n in top_shops)

            # Per-product breakdown — answers 'why so few results?' at a glance.
            # Format: 'latte: 10→1 (kept) | mocha: 10→4 | cappucino: 8→0 (title-mismatch)'
            prod_bits: list = []
            for s in per_product_stats:
                if s.get("error"):
                    prod_bits.append(f"{s['label']}: ERROR ({s['error']})")
                elif s["raw"] == 0:
                    prod_bits.append(f"{s['label']}: 0 returned")
                elif s["matched"] == 0:
                    prod_bits.append(f"{s['label']}: {s['raw']}→0 (title-mismatch)")
                else:
                    prod_bits.append(f"{s['label']}: {s['raw']}→{s['written']}")
            prod_summary = " | ".join(prod_bits)

            print(f"      ✅ wrote {len(platform_rows)} rows ({raw_count} raw, {title_dropped} title-dropped)")
            notes.append(
                f"{platform} [{match_mode}]: {len(platform_rows)} rows captured "
                f"({n_official} Official). Per-product: {prod_summary}. "
                f"Top shops: {shops_blurb}."
            )
        except Exception as e:
            print(f"      ❌ upsert FAILED: {str(e)[:300]}")
            raise

    note = " | ".join(notes) if notes else f"completed: {total_written} rows"
    return total_written, note


def _filter_ig_content(data: list, format_filter: str) -> list:
    """
    Filter Instagram scraper results by content type.

    apify/instagram-scraper returns mixed types even when pointed at /reels/.
    This filter is the final safety net.

    Post-type signals checked (in priority order):
      1. type field: "GraphVideo" = reel/video | "GraphImage" = photo | "GraphSidecar" = carousel
      2. isVideo: True/False boolean from the API
      3. videoDuration: > 0 means video
      4. videoPlayCount: field exists (even if 0) = video metric = reel
      5. URL: contains /reel/ = reel
    """
    if format_filter == "All Formats" or not format_filter:
        return data

    filtered = []
    for d in data:
        post_type = str(d.get("type","") or d.get("mediaType","") or "").strip()
        url       = str(d.get("url",""))

        is_video = (
            post_type in ("GraphVideo","Video","video","Reel","reel","VIDEO")
            or d.get("isVideo") is True
            or int(d.get("videoDuration") or 0) > 0
            or d.get("videoPlayCount") is not None   # field present = reel
            or "/reel/" in url
        )
        is_photo = (
            post_type in ("GraphImage","Image","image","IMAGE")
            or post_type in ("GraphSidecar","Sidecar","sidecar","CAROUSEL")
        )

        if format_filter == "Reels Only":
            if is_video:
                filtered.append(d)
        elif format_filter == "Images/Carousel Only":
            if is_photo or (not is_video):
                filtered.append(d)

    return filtered


def _ig_content_type(d: dict) -> str:
    """
    Classify a single Instagram post as "Video" (reel/video — carries a view count)
    or "Image" (photo/carousel — no view count). Mirrors the signals in
    _filter_ig_content so the export can tailor view-based metrics: reels have
    views, images don't. Video signals win over image type (a sidecar containing a
    video is treated as a video).
    """
    post_type = str(d.get("type", "") or d.get("mediaType", "") or "").strip().lower()
    url       = str(d.get("url", ""))
    is_video = (
        post_type in ("graphvideo", "video", "reel", "clips", "igtv")
        or d.get("isVideo") is True
        or int(d.get("videoDuration") or 0) > 0
        or d.get("videoPlayCount") is not None
        or "/reel/" in url
    )
    if is_video:
        return "Video"
    if post_type in ("graphimage", "image", "graphsidecar", "sidecar", "carousel"):
        return "Image"
    # Unknown type — fall back to the presence of a play count.
    return "Video" if int(d.get("videoPlayCount") or 0) > 0 else "Image"


def _fetch_ig_followers(handle: str, apikey: str) -> int:
    """
    One lightweight Instagram profile-details lookup for a creator's follower
    count. Image posts have no view count, so engagement rate for them is computed
    against followers at export time. Only called when the user ticked "Fetch
    follower count" for a post-related scrape. Returns 0 on any failure so the
    scrape proceeds regardless.
    """
    try:
        url = f"https://www.instagram.com/{str(handle).lstrip('@').strip()}/"
        res = call_apify(
            "apify/instagram-scraper",
            {"directUrls": [url], "resultsType": "details", "resultsLimit": 1},
            apikey,
        )
        for d in (res or []):
            fc = d.get("followersCount")
            if fc is None:
                fc = (d.get("owner") or {}).get("followersCount")
            if fc:
                return int(fc)
    except Exception as e:
        print(f"   ⚠️ Follower lookup failed for @{handle}: {e}")
    return 0


def _extract_post_date(item: dict) -> str:
    """
    Best-effort YYYY-MM-DD for a scraped post, checking the many field names the
    IG/TikTok actors use (flat + a couple of nested spots). Returns "" if none
    found — callers KEEP undated posts rather than dropping them.
    """
    FIELDS = (
        "timestamp", "takenAt", "takenAtTimestamp", "taken_at", "taken_at_timestamp",
        "postedAt", "postedAtTimestamp", "date", "createTime", "createTimeISO", "create_time",
    )
    def _coerce(v) -> str:
        if v in (None, "", 0): return ""
        try:
            if isinstance(v, (int, float)):
                ts = float(v)
                if ts > 1e12: ts /= 1000.0          # milliseconds → seconds
                return datetime.datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d")
            s = str(v).strip()
            return s[:10] if len(s) >= 10 else ""    # "YYYY-MM-DD..." → date part
        except Exception:
            return ""
    for f in FIELDS:
        d = _coerce(item.get(f))
        if d: return d
    # A couple of nested spots some actor versions use
    for parent in ("node", "videoMeta", "media"):
        sub = item.get(parent)
        if isinstance(sub, dict):
            for f in FIELDS:
                d = _coerce(sub.get(f))
                if d: return d
    return ""


# Absolute safety ceiling for the date-window over-fetch (even at multiplier 5).
DATE_RANGE_FETCH_HARD_CAP = 1000


def _date_fetch_limit(limit: int, date_from: str = "", date_to: str = "",
                      multiplier: float = 3.0) -> int:
    """
    How many newest posts to request when a date window is set.

    The actors return newest-first, so to reach back to `date_from` for active
    accounts we must over-fetch and then keep only the posts that land inside the
    window. The USER controls how aggressively via `multiplier` (request
    post-count × N). When `date_from` is set we also pass `onlyPostsNewerThan`,
    which keeps real credit usage bounded by the window length server-side. The
    multiplier is clamped to 1×–5× and a hard ceiling so a typo can't run away.
    """
    if not (date_from or date_to):
        return limit
    try:
        m = float(multiplier)
    except (TypeError, ValueError):
        m = 3.0
    m = max(1.0, min(m, 5.0))
    return max(limit, min(int(limit * m + 0.5), DATE_RANGE_FETCH_HARD_CAP))


def _call_ig_profile(url: str, fmt: str, limit: int, apikey: str,
                     date_from: str = "", date_to: str = "",
                     multiplier: float = 3.0) -> list:
    """
    Fetch Instagram profile content.

    Handles ALL combinations:
      Reels Only + handle  → apify/instagram-reel-scraper (username param)
      Reels Only + URL     → extract handle from URL → same actor
      All Formats + handle → build URL → apify/instagram-scraper
      All Formats + URL    → apify/instagram-scraper (directUrls param)
      Images Only + handle → build URL → apify/instagram-scraper + filter
      Images Only + URL    → apify/instagram-scraper + filter

    apify/instagram-reel-scraper:
      ✅ Chronological (most recent first)
      ✅ Excludes pinned reels
      ✅ Only scrapes reels — no wasted credits
      Input: {"username": "handle_string", "resultsLimit": 10}

    apify/instagram-scraper:
      Input: {"directUrls": ["https://..."], "resultsType": "posts", "resultsLimit": 10}

    DATE RANGE FILTERING (date_from / date_to, format YYYY-MM-DD):
      The Apify actor only supports `onlyAfter` (scrape forward from a date to now) —
      there is no native `onlyBefore` parameter, so a true start→end window isn't
      something the actor can do in one call. The workaround:
        1. If date_from is set, pass it as `onlyAfter` so the actor doesn't waste
           credits scraping content older than your range start.
        2. Oversample (3× the limit, capped) since some results may fall after date_to.
        3. Filter client-side using each item's `timestamp` field, keeping only
           posts where date_from <= post_date <= date_to.
        4. Re-trim to `limit` after filtering.
      If date_from is blank, the actor scrapes chronologically from the most
      recent post — "scrape to the past" with no known start date.
    """
    import re

    handle = ""
    input_url = str(url or "").strip()

    if input_url.startswith("http"):
        m = re.search(r"instagram\.com/([^/?#]+)", input_url)
        if m and m.group(1) not in ("p", "reel", "stories", "explore", "reels", "tv", "accounts"):
            handle = m.group(1)
        elif m and m.group(1) == "reels":
            pass
        if not handle:
            m2 = re.search(r"instagram\.com/([^/?#]+)/reels", input_url)
            if m2: handle = m2.group(1)
    else:
        handle = input_url.lstrip("@").split("/")[0].strip()

    if not handle:
        print(f"   ⚠️ Could not extract handle from: {input_url[:60]}")
        return []

    profile_url = f"https://www.instagram.com/{handle}/"
    has_range = bool(date_from or date_to)
    fetch_limit = _date_fetch_limit(limit, date_from, date_to, multiplier)  # over-fetch to reach the date window

    def _apply_date_range(items: list) -> list:
        if not has_range:
            return items
        out = []
        for it in items:
            pd = _extract_post_date(it)
            if not pd:
                out.append(it)  # undated — keep it (don't drop), just can't date-filter
                continue
            if date_from and pd < date_from:
                continue
            if date_to and pd > date_to:
                continue
            out.append(it)
        return out

    if fmt == "Reels Only":
        run_input = {
            "username":           [handle],
            "resultsLimit":       fetch_limit,
            "skipPinnedPosts":    True,
        }
        if date_from:
            run_input["onlyPostsNewerThan"] = date_from   # actor-native: don't scrape older than this
        raw = call_apify("apify/instagram-reel-scraper", run_input, apikey)
        print(f"   IG Reels @{handle}: {len(raw)} raw reel(s) "
              f"(fetch_limit={fetch_limit}{', onlyPostsNewerThan='+date_from if date_from else ''})")
        filtered = _apply_date_range(raw)
        if has_range:
            print(f"   IG Reels @{handle}: {len(filtered)} after date filter "
                  f"[{date_from or 'start'} → {date_to or 'now'}]")
        # When a window is set, it governs the result set — keep everything
        # in-window (already bounded by fetch_limit) so posts back to date_from
        # aren't trimmed off; the limit only caps the no-date case.
        return filtered if has_range else filtered[:limit]

    else:
        run_input = {
            "directUrls":   [profile_url],
            "resultsType":  "posts",
            "resultsLimit": fetch_limit,
        }
        if date_from:
            run_input["onlyPostsNewerThan"] = date_from  # general scraper's date param name
        raw = call_apify("apify/instagram-scraper", run_input, apikey)
        print(f"   IG Profile @{handle} [{fmt}]: {len(raw)} raw post(s) (fetch_limit={fetch_limit})")
        type_filtered = _filter_ig_content(raw, fmt)
        date_filtered = _apply_date_range(type_filtered)
        if has_range:
            print(f"   IG Profile @{handle}: {len(date_filtered)} after date filter "
                  f"[{date_from or 'start'} → {date_to or 'now'}]")
        return date_filtered if has_range else date_filtered[:limit]


# ─────────────────────────────────────────────────────────────────────────────
# YOUTUBE HELPERS
# ─────────────────────────────────────────────────────────────────────────────
# Why a defensive _yt_first_present helper instead of `.get("viewCount") or
# d.get("views")`: a legit zero on `historicalSoldEstimated` once silently fell
# through to None in the ecom path (commit 4301eec) — same trap applies here.
# Use first-PRESENT (None-aware) so a real 0 view count survives.
def _yt_first_present(d: dict, *keys):
    for k in keys:
        if k in d and d[k] is not None:
            return d[k]
    return None


def _yt_safe_int(v) -> int:
    """Coerce YouTube actor values to int. Handles '1.2K', '500+', None, 0."""
    if v in (None, ""):
        return 0
    if isinstance(v, (int, float)):
        return int(v)
    s = str(v).strip().replace(",", "").replace("+", "")
    try:
        if s.endswith(("K", "k")):
            return int(float(s[:-1]) * 1000)
        if s.endswith(("M", "m")):
            return int(float(s[:-1]) * 1_000_000)
        if s.endswith(("B", "b")):
            return int(float(s[:-1]) * 1_000_000_000)
        return int(float(s))
    except (TypeError, ValueError):
        return 0


def _yt_parse_duration(v) -> int:
    """
    Parse a YouTube duration → seconds (int). The actor returns strings:
      "00:03:17"  → 197   (HH:MM:SS)
      "29:54"     → 1794  (MM:SS)
      "1:23:37"   → 5017  (H:MM:SS)
      "0:45"      → 45    (M:SS)
    Also accepts a plain int (already seconds) for forward-compat.
    Returns 0 on anything unparseable so the Shorts heuristic (duration ≤ 61s)
    falls back to URL/type signals rather than misclassifying.
    """
    if v in (None, ""):
        return 0
    if isinstance(v, (int, float)):
        return int(v)
    s = str(v).strip()
    if not s:
        return 0
    parts = s.split(":")
    try:
        nums = [int(p) for p in parts]
    except ValueError:
        return 0
    # Walk parts right-to-left: seconds, minutes, hours.
    secs = 0
    for i, n in enumerate(reversed(nums)):
        secs += n * (60 ** i)
    return secs


def _yt_extract_transcript(subs) -> str:
    """
    Pull plain text out of the subtitles array. Schema:
      [{ "srtUrl": "...", "type": "auto_generated"|"user_generated",
         "language": "en", "srt": "1\\n00:00..\\nline\\n\\n2\\n..." }]
    Prefer English (auto_generated or user_generated); fall back to the first
    entry. We strip the SRT timing lines and line numbers so the stored value
    is just the spoken text — feeds the deterministic claim/theme tagger.
    Returns "" if no subtitles or all entries had empty `srt`.
    """
    if not subs:
        return ""
    if isinstance(subs, str):
        return subs   # forward-compat: actor sometimes returns a flat string
    if not isinstance(subs, list):
        return ""
    chosen = None
    for s in subs:
        if not isinstance(s, dict):
            continue
        if str(s.get("language", "")).lower().startswith("en") and s.get("srt"):
            chosen = s
            break
    if chosen is None:
        for s in subs:
            if isinstance(s, dict) and s.get("srt"):
                chosen = s
                break
    if chosen is None:
        return ""
    srt = str(chosen.get("srt") or "")
    if not srt:
        return ""
    # Strip SRT block numbers and timing lines; keep the spoken text.
    import re as _re
    lines = []
    for raw in srt.splitlines():
        ln = raw.strip()
        if not ln:
            continue
        if ln.isdigit():               # block index
            continue
        if "-->" in ln:                # timing line
            continue
        lines.append(ln)
    # Dedupe consecutive duplicates (SRT often repeats lines across blocks).
    out: list = []
    for ln in lines:
        if not out or out[-1] != ln:
            out.append(ln)
    return " ".join(out)


def _yt_extract_date(v) -> str:
    """
    Return a YYYY-MM-DD date ONLY when the actor's `date` field looks ISO.
    The actor returns:
      • ISO on video-page scrapes:  "2021-12-21" / "2025-01-15T12:00:00.000Z"
      • Relative on channel-listings: "10 months ago" / "5 years ago" / "12 years ago"
    Relative strings can't be turned into a real date without knowing the
    scrape moment AND the actor's rounding (months ≠ 30 days), so we
    deliberately drop them — the export keeps undated rows rather than
    inventing a wrong post_date.
    """
    if v in (None, ""):
        return ""
    s = str(v).strip()
    if not s:
        return ""
    # ISO date or ISO datetime — first 10 chars must be YYYY-MM-DD.
    import re as _re
    if _re.match(r"^\d{4}-\d{2}-\d{2}", s):
        return s[:10]
    return ""


def _yt_handle_from_channel_url(url) -> str:
    """Extract a clean handle from a channel URL: '@handle' or 'UCxxx'."""
    if not url:
        return ""
    import re as _re
    s = str(url)
    m = _re.search(r"youtube\.com/@([^/?#]+)", s)
    if m:
        return m.group(1)
    m = _re.search(r"youtube\.com/(?:channel|c|user)/([^/?#]+)", s)
    if m:
        return m.group(1)
    return ""


def _yt_caps(format_filter: str, n: int) -> dict:
    """
    Build the explicit-zeros cap dict for `streamers/youtube-scraper`. CRITICAL:
    leaving any of the three blank means INFINITE (documented actor bug) — a
    Videos-only scrape that omits maxResultsShorts will silently pull unlimited
    shorts and burn the Apify bill. Always pass explicit integers; zeros for the
    types we don't want this run.
    """
    if format_filter == "Shorts Only":
        return {"maxResults": 0, "maxResultsShorts": n, "maxResultStreams": 0}
    if format_filter == "Videos Only":
        return {"maxResults": n, "maxResultsShorts": 0, "maxResultStreams": 0}
    # "All Formats" or empty → both, no streams
    return {"maxResults": n, "maxResultsShorts": n, "maxResultStreams": 0}


def _yt_content_type(item: dict) -> str:
    """
    Return 'Short' if the item is a YouTube Short, else 'Video'. Signals
    (priority order):
      1. URL contains '/shorts/' (most reliable — Shorts have a distinct path)
      2. Actor's `type` field (Shorts schema sets type="shorts")
      3. `fromChannelListPage` == "shorts" (set when scraping a channel's
         /shorts page)
      4. duration ≤ 61 seconds (regular videos can be short but rarely
         exactly Short-format-length)
    """
    url = str(_yt_first_present(item, "url", "videoUrl", "watchUrl", "link") or "")
    if "/shorts/" in url:
        return "Short"
    t = str(_yt_first_present(item, "type", "videoType", "kind") or "").lower()
    if "short" in t:
        return "Short"
    if t in ("video", "longform", "regular"):
        return "Video"
    src = str(item.get("fromChannelListPage") or "").lower()
    if "short" in src:
        return "Short"
    dur = _yt_parse_duration(_yt_first_present(item, "duration", "durationSeconds", "lengthSeconds"))
    if 0 < dur <= 61:
        return "Short"
    return "Video"


def _filter_yt_content(items: list, format_filter: str) -> list:
    """
    Final safety net for YouTube content-type filtering. The actor's per-type
    caps usually do the work, but if it returns a mixed bag for "Videos Only" or
    "Shorts Only", this filter trims to the requested type. "All Formats" keeps
    both. Mirrors the IG content-filter pattern; KEEPS items whose type we
    couldn't classify rather than dropping them.
    """
    if not format_filter or format_filter == "All Formats":
        return items
    want = "Short" if format_filter == "Shorts Only" else "Video"
    return [d for d in items if _yt_content_type(d) == want]


def _yt_extract_video_id(url: str) -> str:
    """Pull the 11-char video id from any YouTube URL form."""
    import re as _re
    if not url:
        return ""
    s = str(url)
    for pat in (r"/shorts/([A-Za-z0-9_-]{11})",
                r"watch\?v=([A-Za-z0-9_-]{11})",
                r"youtu\.be/([A-Za-z0-9_-]{11})",
                r"/embed/([A-Za-z0-9_-]{11})"):
        m = _re.search(pat, s)
        if m:
            return m.group(1)
    return ""


def _yt_map_video(d: dict, channel_handle: str = "") -> dict:
    """
    Map a `streamers/youtube-scraper` item to the YouTube data-table column set.
    Field names confirmed against actor samples 2026-06-30 (see CLAUDE.md):
      • URL        → `url`
      • views      → `viewCount` (number)
      • likes      → `likes` (number)          [missing on channel-listing scrapes]
      • comments # → `commentsCount` (number)  [missing on channel-listing scrapes]
      • subscribers→ `numberOfSubscribers` (number)
      • duration   → `duration` (HH:MM:SS / MM:SS / H:MM:SS string)
      • description→ `text` (string)
      • subtitles  → `subtitles` ARRAY of {srt, language, type}
                     [missing on channel-listing scrapes]
      • hashtags   → `hashtags` (array of strings, sometimes with #)
      • date       → `date` — ISO on video-page, RELATIVE on channel-listing
      • channel    → `channelName` (display) + `channelUrl` + `channelUsername`
      • video id   → `id`
    Alternate names kept as fallbacks for forward-compat. Uses _yt_first_present
    so a legit 0 metric isn't silently dropped.
    """
    url = str(_yt_first_present(d, "url", "videoUrl", "watchUrl", "link") or "")
    is_short = _yt_content_type(d) == "Short"
    duration = _yt_parse_duration(_yt_first_present(d, "duration", "durationSeconds", "lengthSeconds"))
    views = _yt_safe_int(_yt_first_present(d, "viewCount", "views", "viewsCount"))
    likes = _yt_safe_int(_yt_first_present(d, "likes", "likeCount"))
    cmts = _yt_safe_int(_yt_first_present(d, "commentsCount", "commentCount"))
    subs = _yt_safe_int(_yt_first_present(d, "numberOfSubscribers", "subscriberCount", "subscribersCount"))
    # Channel handle preference: explicit param (we know who we asked for) >
    # actor's `channelUsername` (clean handle on Shorts) > parse from
    # `channelUrl` > `channelName` (display name, possibly with spaces).
    uploader = (channel_handle.strip().lstrip("@")
                or str(_yt_first_present(d, "channelUsername") or "").lstrip("@")
                or _yt_handle_from_channel_url(_yt_first_present(d, "channelUrl"))
                or str(_yt_first_present(d, "channelName", "channelTitle", "author", "uploaderName") or "").lstrip("@"))
    title = str(_yt_first_present(d, "title", "videoTitle") or "")
    caption = str(_yt_first_present(d, "text", "description", "videoDescription") or "")
    transcript = _yt_extract_transcript(_yt_first_present(d, "subtitles", "transcript", "captions"))
    tags = _yt_first_present(d, "hashtags", "tags")
    if isinstance(tags, str):
        tags = [t.strip().lstrip("#") for t in tags.split(",") if t.strip()]
    elif isinstance(tags, list):
        tags = [str(t).strip().lstrip("#") for t in tags if str(t).strip()]
    else:
        tags = None
    vid_id = (str(_yt_first_present(d, "id", "videoId") or "").strip()
              or _yt_extract_video_id(url))
    # Date: ONLY keep ISO ("2021-12-21" / "2025-01-15T12:00:00.000Z") — relative
    # strings ("10 months ago", "5 years ago") returned on channel-listing
    # scrapes are dropped so post_date stays a real date, not "10 months ".
    post_date = _yt_extract_date(_yt_first_present(d, "date", "publishedAt", "uploadDate"))
    if not post_date:
        # Fall back to the IG/TT-shared extractor (handles Unix timestamps, etc.)
        post_date = _extract_post_date(d)
    return {
        "url": url,
        "username": uploader,
        "play_count": views,             # YouTube has no plays/views distinction — both = views
        "view_count": views,
        "likes": likes,
        "comments": cmts,
        # YouTube actors don't expose share counts. Leave None so the export
        # can render blank instead of a misleading 0.
        "shares": None,
        "subscribers": subs,
        "followers": subs,               # alias so shared export code that reads `followers` works
        "duration_seconds": duration,
        "is_short": is_short,
        "video_id": vid_id,
        "title": title,
        "caption": caption,
        "transcript": transcript,
        "hashtags": tags,
        "post_date": post_date,
        "content_type": "Short" if is_short else "Video",
    }


def _yt_subtitle_input() -> dict:
    """
    Subtitle/transcript download toggle for `streamers/youtube-scraper`. The
    exact key isn't confirmed (candidates seen in the actor docs:
    saveSubsToKVS / downloadSubtitles / subtitlesLanguage). We send the safest
    superset — extra keys the actor doesn't recognise are ignored.
    """
    return {
        "saveSubsToKVS": True,
        "downloadSubtitles": True,
        "subtitlesLanguage": "any",
    }


def _channel_url_from_handle(raw: str) -> str:
    """Build a YouTube /videos channel URL from any handle / channel form."""
    s = str(raw or "").strip()
    if not s:
        return ""
    if s.startswith("http"):
        # Already a URL; pass through. The actor accepts channel URLs as-is.
        return s
    if s.startswith("@"):
        s = s[1:]
    # Treat bare strings as channel handles.
    return f"https://www.youtube.com/@{s}/videos"


def process_job(job):
    # ── Job ID detection ─────────────────────────────────────────────────
    # database.py uses "job_id" as default. Check that first.
    id_col = "job_id" if job.get("job_id") else ("id" if job.get("id") else "uuid")
    jid    = str(job.get(id_col) or "").strip()
    if not jid or jid.lower() in ("none","null",""):
        # Last resort: try every possible ID column
        for col in ("job_id","id","uuid"):
            val = str(job.get(col,"") or "").strip()
            if val and val.lower() not in ("none","null",""):
                jid = val; id_col = col; break
    if not jid or jid.lower() in ("none","null",""):
        print(f"   ❌ SKIP: Job has no valid ID. Keys: {list(job.keys())[:10]}")
        print(f"   Raw ID values: id={job.get('id')}, job_id={job.get('job_id')}, uuid={job.get('uuid')}")
        return
    print(f"   Job ID: {jid[:12]}… (column: {id_col})")
    pid    = job.get("project_id")
    jtype  = job.get("job_type")
    plat   = job.get("platform","Instagram")
    target = job.get("target_url","")
    limit  = int(job.get("target_limit") or 50)
    # User-selected solo-retry passes for short handles (min 1, capped for safety).
    max_retries = max(1, min(int(job.get("max_retries") or 1), 10))
    # User-set over-fetch multiplier for date-windowed scrapes (post-count × N).
    # Clamped 1×–5×; defaults to 3× when unset/invalid.
    try:
        date_multiplier = max(1.0, min(float(job.get("date_multiplier") or 3.0), 5.0))
    except (TypeError, ValueError):
        date_multiplier = 3.0
    # Extract kol from kol_username or fall back to parsing the target_url
    # (original tab_extract.py stored "" when the user pasted a URL, not a @handle)
    _raw_kol = str(job.get("kol_username") or "").strip()
    if _raw_kol and _raw_kol.lower() not in ("unknown","none","nan",""):
        kol = _raw_kol.lstrip("@")
    else:
        import re as _re2
        _url = str(job.get("target_url",""))
        # YouTube handle forms: @handle, /channel/UCxxx, /c/Name, /user/Name.
        _myt = _re2.search(r"youtube\.com/@([^/?#]+)", _url) or \
               _re2.search(r"youtube\.com/(?:channel|c|user)/([^/?#]+)", _url)
        if _myt:
            kol = _myt.group(1)
        else:
            _m = _re2.search(r"instagram\.com/([^/?#]+)/?$", _url.rstrip("/") + "/")
            if _m and _m.group(1) not in ("p","reel","stories","explore","reels","tv"):
                kol = _m.group(1)
            else:
                _m2 = _re2.search(r"tiktok\.com/@([^/?#]+)", _url)
                kol = _m2.group(1) if _m2 else (_url.lstrip("@").split("/")[-1].strip("/") or "unknown")
    apikey = job.get("apify_api_key") or APIFY_TOKEN
    is_ig  = plat == "Instagram"
    is_tt  = plat == "TikTok"
    is_yt  = plat == "YouTube"
    actors = YT if is_yt else (IG if is_ig else TT)

    if target and not target.startswith("http") and jtype not in ("Competitor Ads (Meta)", "YouTube Intelligence", "Trend Discovery (Hashtag)", "Ecom Listings"):
        c = target.replace("@","").strip()
        if is_yt:
            target = _channel_url_from_handle(c)
        elif is_ig:
            target = f"https://www.instagram.com/{c}/"
        else:
            target = f"https://www.tiktok.com/@{c}"

    print(f"\n{'='*48}\n🔄 {jid} | {plat} | {jtype}\n   Target: {target}")

    try:
        if jtype in INTELLIGENCE_JOB_TYPES and not ENABLE_INTELLIGENCE:
            # Gated off so it can't run heavy Playwright/pytrends work. The job is
            # marked FAILED with a clear reason rather than silently hanging.
            raise RuntimeError(
                "Competitor Intelligence is disabled on this worker "
                "(set ENABLE_INTELLIGENCE=true to enable)."
            )

        if jtype == "Trend Discovery (Hashtag)":
            if is_yt:
                # UI hides YouTube from hashtag scrapes; this is the belt-and-braces
                # guard so a hand-crafted job (or a bug in the platform toggle)
                # can't sneak through and silently fail later.
                raise ValueError("YouTube is not supported for hashtag/creator discovery")
            tags = [h.replace("#","").strip() for h in target.split(",") if h.strip()]
            if is_ig:
                # actor's resultsLimit is PER HASHTAG — overshoots when multiple
                # hashtags are passed. Cap the output to `limit` total below.
                data = call_apify(actors["hashtag"],{"hashtags":tags,"resultsLimit":limit},apikey)
                data = (data or [])[:limit]   # hard cap — fixes the "asked for 10, got 25" overshoot
                payload = [{"project_id":pid,"platform":plat,"search_target":target,
                            "video_url":d.get("url"),"username":d.get("ownerUsername"),
                            "caption":d.get("caption",""),"play_count":int(d.get("videoPlayCount") or d.get("videoViewCount") or d.get("viewCount") or d.get("playCount") or 0),
                            "likes":d.get("likesCount",0),"comments":d.get("commentsCount",0),
                            "shares":d.get("sharesCount",0),"video_duration":int(d.get("videoDuration",0)),
                            "audio_track":(d.get("audioTrack") or {}).get("name","Original Audio"),
                            "content_type":d.get("type","Video"),
                            # actor's 'timestamp' field is an ISO string ('2024-06-29T08:00:00.000Z')
                            "posted_at":d.get("timestamp") or d.get("takenAt") or None,
                            } for d in data if d.get("url")]
            else:
                # Region-lock TikTok to Indonesia: scrape through an ID residential
                # proxy (biases TikTok's results to ID at the source), over-fetch,
                # then keep only creators whose authorMeta.region is ID. If the actor
                # returns no region field at all, fall back to the ID-proxied set so
                # the scrape never silently comes back empty.
                tt_fetch = min(limit * 3, 200)
                raw_tt = call_apify(actors["hashtag"], {
                    "hashtags": tags, "resultsPerPage": tt_fetch,
                    "proxyConfiguration": {"useApifyProxy": True,
                                           "apifyProxyGroups": ["RESIDENTIAL"],
                                           "apifyProxyCountry": "ID"},
                }, apikey)
                id_only = [d for d in raw_tt
                           if str((d.get("authorMeta") or {}).get("region") or "").upper() == "ID"]
                if id_only:
                    data = id_only[:limit]
                    print(f"   🌏 TikTok region-lock ID: kept {len(id_only)}/{len(raw_tt)} posts")
                else:
                    data = raw_tt[:limit]
                    print(f"   🌏 TikTok region-lock ID: actor returned no region field — using ID-proxied results ({len(raw_tt)})")
                payload = [{"project_id":pid,"platform":plat,"search_target":target,
                            "video_url":d.get("webVideoUrl") or d.get("videoUrl"),
                            "username":(d.get("authorMeta") or {}).get("name"),
                            "caption":d.get("text",""),"play_count":int(d.get("playCount") or d.get("videoPlayCount") or d.get("videoViewCount") or 0),
                            "likes":d.get("diggCount",0),"comments":d.get("commentCount",0),
                            "shares":d.get("shareCount",0),"video_duration":int((d.get("videoMeta") or {}).get("duration") or 0),
                            "audio_track":(d.get("musicMeta") or {}).get("musicName","Original Audio"),
                            "content_type":"Video",
                            # clockworks/tiktok-scraper returns 'createTimeISO' or numeric 'createTime'
                            "posted_at": d.get("createTimeISO")
                                or (datetime.datetime.fromtimestamp(int(d["createTime"]), tz=datetime.timezone.utc).isoformat()
                                    if d.get("createTime") else None),
                            } for d in data if d.get("webVideoUrl") or d.get("videoUrl")]
            db.upsert_trend_discovery(supabase, payload)

        elif jtype == "Trend Discovery (User Profile)":
            if is_yt:
                raise ValueError("YouTube is not supported for hashtag/creator discovery")
            h = target.replace("@","").strip().split("/")[-1].strip("/")
            fmt = job.get("format_filter","All Formats")
            if is_ig:
                ig_url = f"https://www.instagram.com/{h}/"
                data   = _call_ig_profile(ig_url, fmt, limit, apikey)
                payload=[{"project_id":pid,"platform":plat,"search_target":f"@{h}","video_url":d.get("url"),
                          "username":h,"caption":d.get("caption",""),"play_count":int(d.get("videoPlayCount") or d.get("videoViewCount") or d.get("viewCount") or d.get("playCount") or 0),
                          "likes":d.get("likesCount",0),"comments":d.get("commentsCount",0),"shares":d.get("sharesCount",0),
                          "video_duration":int(d.get("videoDuration",0) or 0),
                          "audio_track":(d.get("audioTrack") or {}).get("name","Original Audio"),
                          "content_type":d.get("type","Video")} for d in data if d.get("url")]
            else:
                url = f"https://www.tiktok.com/@{h}"
                data = call_apify(actors["profile"],{"profiles":[url],"resultsPerPage":limit},apikey)
                payload=[{"project_id":pid,"platform":plat,"search_target":f"@{h}",
                          "video_url":d.get("webVideoUrl") or d.get("videoUrl"),
                          "username":h,"caption":d.get("text",""),"play_count":int(d.get("playCount") or d.get("videoPlayCount") or d.get("videoViewCount") or 0),
                          "likes":d.get("diggCount",0),"comments":d.get("commentCount",0),"shares":d.get("shareCount",0),
                          "video_duration":int((d.get("videoMeta") or {}).get("duration") or 0),
                          "audio_track":(d.get("musicMeta") or {}).get("musicName","Original Audio"),
                          "content_type":"Video"} 
                         for d in data if d.get("webVideoUrl") or d.get("videoUrl")]
            db.upsert_trend_discovery(supabase, payload)

        elif jtype == "Specific URLs (Video Stats)":
            if is_yt:
                # YouTube URL stats: exactly one video URL in startUrls, so the
                # actor scrapes that one source — the per-type caps just need
                # to NOT block. Use 1/1/0 (allow either Video or Short, no
                # streams) instead of routing through _yt_caps (correct for
                # channel-feed sampling but over-conservative here: a
                # youtu.be/... short-link the actor classifies as a Short
                # would be blocked by maxResultsShorts:0). Streams stay 0.
                # Still explicit integers — never blanks (the actor's
                # blank-means-INFINITE bug bites at any scale).
                run_input = {
                    "startUrls": [{"url": target}],
                    "maxResults": 1, "maxResultsShorts": 1, "maxResultStreams": 0,
                    "proxyConfiguration": {"useApifyProxy": True},
                    **_yt_subtitle_input(),
                }
                data = call_apify(actors["video_stats"], run_input, apikey)
                payload = []
                for d in (data or []):
                    m = _yt_map_video(d, channel_handle=kol)
                    payload.append({
                        # MUST use `target` (the original user-pasted URL) not
                        # the actor's normalized URL. The export queries
                        # video_url IN (job.target_url, …); if we store the
                        # actor's canonical form ("https://www.youtube.com/
                        # shorts/abc"), it won't match the user's input
                        # ("https://youtube.com/shorts/abc?si=tracking") and
                        # the export returns 404. IG / TT branches use
                        # `target` for the same reason — keep the contract
                        # consistent across platforms.
                        "video_url":        target,
                        "username":         m["username"] or kol,
                        "play_count":       m["play_count"],
                        "view_count":       m["view_count"],
                        "likes":            m["likes"],
                        "comments":         m["comments"],
                        "shares":           m["shares"],
                        "duration_seconds": m["duration_seconds"],
                        "is_short":         m["is_short"],
                        "video_id":         m["video_id"],
                        "title":            m["title"],
                        "transcript":       m["transcript"],
                        "hashtags":         m["hashtags"],
                        "subscribers":      m["subscribers"],
                        "followers":        m["followers"],
                    })
            elif is_ig:
                data = call_apify(actors["video_stats"],{"directUrls":[target],"resultsType":"details"},apikey)
                payload = [{"video_url":target,"username":kol,"play_count":int(d.get("playCount") or d.get("videoPlayCount") or d.get("videoViewCount") or 0),
                            "likes":d.get("likesCount",0),"comments":d.get("commentsCount",0),
                            "shares":d.get("sharesCount",0)} for d in data]
            else:
                data = call_apify(actors["video_stats"],{"postURLs":[target],"resultsPerPage":1},apikey)
                payload = [{"video_url":target,"username":kol,"play_count":int(d.get("playCount") or d.get("videoPlayCount") or d.get("videoViewCount") or 0),
                            "likes":d.get("diggCount",0),"comments":d.get("commentCount",0),
                            "shares":d.get("shareCount",0)} for d in data]
            # Column-safe upsert — youtube_campaign_videos has extra columns
            # (duration_seconds, is_short, video_id, transcript, hashtags,
            # subscribers, followers) that IG/TikTok rows don't carry. If the
            # migration hasn't run yet, retry without the YouTube-only columns.
            try:
                db.upsert_campaign_videos(supabase, plat, payload)
            except Exception as db_err:
                err_str = str(db_err).lower()
                yt_only = ("duration_seconds", "is_short", "video_id", "transcript",
                           "hashtags", "subscribers", "followers", "title")
                if is_yt and any(c in err_str for c in yt_only):
                    print(f"   ⚠️ DB rejected YouTube columns — retrying without them (run sql/youtube_platform.sql)")
                    for row in payload:
                        for c in yt_only:
                            row.pop(c, None)
                    db.upsert_campaign_videos(supabase, plat, payload)
                else:
                    raise

        elif jtype == "Profile Feed (Audit)":
            fmt = job.get("format_filter","All Formats")
            date_from = str(job.get("date_from","") or "").strip()
            date_to   = str(job.get("date_to","") or "").strip()
            if date_from or date_to:
                print(f"   📅 Date range: {date_from or 'start'} → {date_to or 'now'}")

            if is_yt:
                # YouTube profile audit: one channel URL, per-type caps drive
                # Shorts/Videos/All Formats. ONE actor call (the main scraper
                # returns both types in a single run) — no batching, no date
                # over-fetch (the actor doesn't expose `onlyAfter`; date
                # filtering happens at export time via the post_date column).
                # `fetch_followers` is a no-op for YouTube — subscribers come
                # back on every video result for free.
                channel_url = target if str(target).startswith("http") else _channel_url_from_handle(kol)
                run_input = {
                    "startUrls": [{"url": channel_url}],
                    **_yt_caps(fmt or "All Formats", limit),
                    "proxyConfiguration": {"useApifyProxy": True},
                    **_yt_subtitle_input(),
                }
                raw = call_apify(actors["profile"], run_input, apikey)
                # Belt-and-braces type filter — actor's caps usually do the job
                # but a stray item of the wrong type doesn't pollute the result.
                items = _filter_yt_content(raw or [], fmt or "All Formats")
                items = items[:limit] if limit else items
                payload = []
                for d in items:
                    m = _yt_map_video(d, channel_handle=kol)
                    if not m["url"]:
                        continue
                    payload.append({
                        "post_url":         m["url"],
                        "username":         m["username"] or kol,
                        "caption":          m["caption"] or m["title"],
                        "play_count":       m["play_count"],
                        "view_count":       m["view_count"],
                        "likes":            m["likes"],
                        "comments":         m["comments"],
                        "shares":           m["shares"],
                        "post_date":        m["post_date"],
                        "content_type":     m["content_type"],
                        "duration_seconds": m["duration_seconds"],
                        "is_short":         m["is_short"],
                        "video_id":         m["video_id"],
                        "title":            m["title"],
                        "transcript":       m["transcript"],
                        "hashtags":         m["hashtags"],
                        "subscribers":      m["subscribers"],
                        "followers":        m["followers"],
                    })
                if payload:
                    # Column-safe upsert: drop YouTube-only columns if the
                    # migration hasn't run yet (parallels the IG fallback below).
                    try:
                        db.upsert_influencer_profiles(supabase, plat, payload)
                        print(f"   🗄️ YT @{kol}: {len(payload)} row(s) saved")
                    except Exception as db_err:
                        err_str = str(db_err).lower()
                        yt_only = ("duration_seconds", "is_short", "video_id", "transcript",
                                   "hashtags", "subscribers", "followers", "title",
                                   "view_count", "content_type", "post_date")
                        if any(c in err_str for c in yt_only):
                            print(f"   ⚠️ DB rejected YouTube columns — retrying stripped (run sql/youtube_platform.sql)")
                            for row in payload:
                                for c in yt_only:
                                    row.pop(c, None)
                            db.upsert_influencer_profiles(supabase, plat, payload)
                            print(f"   🗄️ YT @{kol}: {len(payload)} row(s) saved (fallback)")
                        else:
                            raise
                    db.write_kol_snapshot(supabase, pid, kol, plat, payload)
                else:
                    print(f"   ⚠️ YT @{kol}: 0 rows — channel may be empty or unreachable")
                # Done — skip the IG/TikTok batch logic below. YouTube doesn't
                # batch (the actor takes one channel URL per run, not a list),
                # so finalise this job ourselves and return.
                print(f"   📊 YouTube profile audit: {len(payload)} row(s)")
                print(f"✅ {jid} done.")
                db.update_job_status(supabase, jid, "COMPLETED", id_col=id_col)
                return

            # Follower lookup: only for post-related scrapes (image posts need a
            # follower-based engagement rate; reels use views) and only when the
            # user ticked the box on the Profile Tracker.
            fetch_followers = bool(job.get("fetch_followers")) and fmt != "Reels Only"

            # ── BATCH MODE: only batch with other PENDING jobs sharing the SAME date range ──
            # (Different KOLs may be queued with different ranges — batching those together
            #  would silently apply the wrong window to some handles, so we only group jobs
            #  whose date_from/date_to match exactly.)
            batch_jobs = []
            batch_handles = []
            try:
                pending = (supabase.table("scrape_jobs")
                    .select("id,target_url,kol_username,target_limit,format_filter,apify_api_key,date_from,date_to")
                    .eq("project_id", pid).eq("job_type", "Profile Feed (Audit)")
                    .eq("platform", plat).eq("status", "PENDING")
                    .limit(20).execute().data or [])
                for pj in pending:
                    pj_date_from = str(pj.get("date_from","") or "").strip()
                    pj_date_to   = str(pj.get("date_to","") or "").strip()
                    if pj_date_from != date_from or pj_date_to != date_to:
                        continue  # different range — don't batch with current job
                    pj_handle = str(pj.get("kol_username","") or "").strip()
                    if not pj_handle:
                        pj_url = str(pj.get("target_url",""))
                        m = re.search(r"instagram\.com/([^/?#]+)", pj_url)
                        pj_handle = m.group(1) if m and m.group(1) not in ("p","reel","stories","explore","reels","tv") else ""
                    if pj_handle and str(pj.get(id_col,"")) != jid:
                        batch_jobs.append(pj)
                        batch_handles.append(pj_handle)
            except Exception: pass

            # Include current job
            all_handles = [kol] + batch_handles if kol else batch_handles
            all_handles = list(dict.fromkeys(h for h in all_handles if h))  # dedupe, preserve order
            all_job_ids = [jid] + [str(j.get("id","") or j.get("job_id","")) for j in batch_jobs]

            if len(all_handles) > 1:
                print(f"   🚀 BATCH MODE: {len(all_handles)} handles (same date range) in ONE Apify call: {all_handles}")
            else:
                print(f"   Single handle: @{kol}")

            # ── Stage 1: Apify call ──────────────────────────────────────────
            if is_ig and fmt == "Reels Only":
                # Chunk into groups of 10 — each chunk is ONE Apify call
                # Reduces 80 KOLs from 80 sequential calls → 8 calls (10× faster)
                has_range = bool(date_from or date_to)
                CHUNK_SIZE = 10
                chunks = [all_handles[i:i+CHUNK_SIZE] for i in range(0, len(all_handles), CHUNK_SIZE)]
                raw_data = []
                # Oversample when filtering by date — some results will fall outside date_to
                fetch_limit = _date_fetch_limit(limit, date_from, date_to, date_multiplier)
                for ci, chunk in enumerate(chunks, 1):
                    print(f"   📡 Stage 1 chunk {ci}/{len(chunks)}: {chunk}")
                    chunk_input = {
                        "username":           chunk,
                        "resultsLimit":       fetch_limit * len(chunk),
                        "skipPinnedPosts":    True,
                    }
                    if date_from:
                        chunk_input["onlyPostsNewerThan"] = date_from  # actor-native — saves credits
                    chunk_raw = call_apify("apify/instagram-reel-scraper", chunk_input, apikey)
                    raw_data.extend(chunk_raw)
                    print(f"      → {len(chunk_raw)} reels")
                print(f"   📡 Stage 1 total: {len(raw_data)} raw reels across {len(chunks)} chunk(s)")

                if has_range:
                    before_count = len(raw_data)
                    # Keep undated posts; only drop DATED posts outside the window.
                    def _in_window(d):
                        pd = _extract_post_date(d)
                        if not pd: return True   # undated — keep, can't date-filter
                        if date_from and pd < date_from: return False
                        if date_to and pd > date_to:     return False
                        return True
                    raw_data = [d for d in raw_data if _in_window(d)]
                    undated = sum(1 for d in raw_data if not _extract_post_date(d))
                    print(f"   📅 Date filter [{date_from or 'start'} → {date_to or 'now'}]: "
                          f"{len(raw_data)}/{before_count} reels kept ({undated} undated)")
            elif is_ig:
                # General scraper — can't batch, process only current handle
                ig_url = f"https://www.instagram.com/{kol}/"
                raw_data = _call_ig_profile(ig_url, fmt, limit, apikey, date_from=date_from, date_to=date_to, multiplier=date_multiplier)
                all_handles = [kol]
                all_job_ids = [jid]
                print(f"   📡 Stage 1: Apify returned {len(raw_data)} posts for @{kol}")
            else:
                # TikTok
                raw_data = call_apify(actors["profile"],{"profiles":[target],"resultsPerPage":limit},apikey)
                all_handles = [kol]
                all_job_ids = [jid]
                print(f"   📡 Stage 1: Apify returned {len(raw_data)} videos for @{kol}")

            # ── Stage 2: Distribute results by handle ────────────────────────
            import unicodedata
            def _norm(s): return unicodedata.normalize("NFKD", str(s)).encode("ascii","ignore").decode().lower().strip()

            def _post_date(d) -> str:
                return _extract_post_date(d)

            by_handle = {}  # handle → [items]
            single_handle = len(all_handles) == 1

            if single_handle:
                # SINGLE HANDLE: assign ALL results to that creator.
                # The Reels tab returns their own posts + collab posts where they
                # are tagged as a co-author. All of these count as their content.
                h = all_handles[0]
                by_handle[h] = raw_data
                collab_count = sum(1 for d in raw_data
                                   if _norm(d.get("ownerUsername","")) != _norm(h) and d.get("ownerUsername"))
                if collab_count:
                    print(f"   ℹ️ @{h}: {collab_count} collab reel(s) included (appear on their Reels tab)")
            else:
                # BATCH: distribute by ownerUsername
                for d in raw_data:
                    if is_ig:
                        raw_user = (d.get("ownerUsername") or (d.get("owner") or {}).get("username") or "").strip()
                    else:
                        raw_user = (d.get("authorMeta") or {}).get("name","")
                    matched = None
                    for h in all_handles:
                        if _norm(raw_user) == _norm(h): matched = h; break
                    if not matched:
                        for h in all_handles:
                            if _norm(h) in _norm(raw_user) or _norm(raw_user) in _norm(h):
                                matched = h; break
                    if not matched:
                        # Unmatched → a collab/cross-post we can't attribute. Do NOT
                        # assign it to the fewest-items handle (that misattributes data
                        # and creates phantom "0 results" for the real owner). Set it
                        # aside; the targeted retry re-fetches any empty handle solo.
                        by_handle.setdefault("__unmatched__", []).append(d)
                        continue
                    by_handle.setdefault(matched, []).append(d)

            print(f"   🔄 Stage 2: Distribution:")
            for h in all_handles:
                count = len(by_handle.get(h, []))
                icon = "✅" if count > 0 else "❌"
                print(f"      {icon} @{h}: {count} items (limit={limit})")
                if count == 0:
                    # Check if stored under different name
                    close = [k for k in by_handle if _norm(h) in _norm(k)]
                    if close:
                        print(f"         Possible match under: {close}")
                    else:
                        print(f"         ⚠️ API returned 0 for this handle — private account? Rate limited?")

            # ── Targeted retry: re-scrape SHORT handles solo, up to max_retries ──
            # After the batch finishes we detect every handle that returned fewer than
            # the requested `limit` and re-run it individually with the SAME parameters
            # (format + date window). A solo fetch sidesteps batch mis-attribution and
            # transient rate-limits and often returns more; we keep the larger set
            # (merged, de-duped by URL — Stage 3 caps to limit). The user picks how many
            # passes (>=1); we also stop early once a whole pass yields no improvement,
            # so a genuinely low-posting creator isn't looped on needlessly.
            if is_ig:
                def _url_of(d):
                    return d.get("url") or d.get("webVideoUrl") or d.get("videoUrl") or ""
                for attempt in range(1, max_retries + 1):
                    short = [h for h in all_handles if len(by_handle.get(h, [])) < limit]
                    if not short:
                        break
                    print(f"   ♻️ Retry pass {attempt}/{max_retries}: {len(short)} handle(s) under {limit}")
                    improved_any = False
                    for h in short:
                        existing = by_handle.get(h, [])
                        try:
                            retry = _call_ig_profile(
                                f"https://www.instagram.com/{h}/", fmt, limit, apikey,
                                date_from=date_from, date_to=date_to, multiplier=date_multiplier,
                            )
                        except Exception as e:
                            print(f"   ♻️ Retry @{h} errored: {str(e)[:120]}")
                            continue
                        if not retry:
                            continue
                        seen, merged = set(), []
                        for d in list(existing) + list(retry):
                            u = _url_of(d)
                            if u and u in seen:
                                continue
                            if u:
                                seen.add(u)
                            merged.append(d)
                        if len(merged) > len(existing):
                            by_handle[h] = merged
                            improved_any = True
                            print(f"   ♻️ Retry @{h}: {len(existing)} → {len(merged)} post(s)")
                    if not improved_any:
                        print(f"   ♻️ Pass {attempt} recovered nothing new — stopping retries early")
                        break

            # ── Stage 3: Build payloads and insert per handle ────────────────
            # When a date window is set the window governs the result set, so keep
            # all in-window posts (already bounded by the over-fetch) instead of
            # trimming to `limit` — otherwise posts back toward date_from get cut.
            total_saved = 0
            eff_limit = _date_fetch_limit(limit, date_from, date_to, date_multiplier) if (date_from or date_to) else limit
            for h in all_handles:
                items = by_handle.get(h, [])[:eff_limit]  # date window overrides limit
                if is_ig:
                    foll = _fetch_ig_followers(h, apikey) if fetch_followers else 0
                    if fetch_followers:
                        print(f"   👥 @{h}: {foll:,} followers")
                    payload = []
                    for d in items:
                        url = d.get("url","")
                        if not url: continue
                        # Plays vs views: IG exposes videoPlayCount (total plays) and
                        # videoViewCount (reach) separately, though it often returns only
                        # one now. Capture both; mirror so neither column is left blank.
                        play_count = int(d.get("videoPlayCount") or d.get("playCount") or 0)
                        view_count = int(d.get("videoViewCount") or d.get("viewCount") or 0)
                        if not play_count: play_count = view_count
                        if not view_count: view_count = play_count
                        payload.append({
                            "post_url":     url,
                            "username":     h,      # always use the requested handle
                            "caption":      d.get("caption",""),
                            "play_count":   play_count,
                            "view_count":   view_count,
                            "followers":    foll,
                            "likes":        int(d.get("likesCount",0) or 0),
                            "comments":     int(d.get("commentsCount",0) or 0),
                            "shares":       int(d.get("sharesCount",0) or 0),
                            "post_date":    _post_date(d),
                            "content_type": _ig_content_type(d),
                        })
                else:
                    payload = [{"post_url":d.get("webVideoUrl") or d.get("videoUrl"),
                                "username": h,
                                "caption":d.get("text",""),
                                "play_count":int(d.get("playCount") or d.get("videoPlayCount") or 0),
                                "view_count":int(d.get("playCount") or d.get("videoPlayCount") or 0),
                                "likes":d.get("diggCount",0),"comments":d.get("commentCount",0),
                                "shares":d.get("shareCount",0),
                                "post_date": _post_date(d),
                                "content_type": "Video"}
                               for d in items if d.get("webVideoUrl") or d.get("videoUrl")]

                if payload:
                    # Column-safe upsert: retry without new columns if DB rejects them
                    try:
                        db.upsert_influencer_profiles(supabase, plat, payload)
                        print(f"   🗄️ DB upsert OK: {len(payload)} rows")
                    except Exception as db_err:
                        err_str = str(db_err)
                        if ("content_type" in err_str or "post_date" in err_str
                                or "view_count" in err_str or "followers" in err_str):
                            print(f"   ⚠️ DB rejected new columns — retrying without post_date/content_type/view_count/followers")
                            for row in payload:
                                row.pop("content_type", None)
                                row.pop("post_date", None)
                                row.pop("view_count", None)
                                row.pop("followers", None)
                            db.upsert_influencer_profiles(supabase, plat, payload)
                            print(f"   🗄️ DB upsert OK (fallback): {len(payload)} rows")
                        else:
                            print(f"   ❌ DB upsert FAILED: {err_str[:200]}")
                            raise
                    db.write_kol_snapshot(supabase, pid, h, plat, payload)
                    total_saved += len(payload)
                    plays_sample = [p["play_count"] for p in payload[:3]]
                    print(f"   🗄️ @{h}: {len(payload)} rows saved | plays: {plays_sample}")
                else:
                    print(f"   ⚠️ @{h}: 0 rows to save — all items dropped or API returned empty")

            # ── Mark batched jobs as COMPLETED ───────────────────────────────
            for batch_jid in all_job_ids:
                if batch_jid and batch_jid != jid and batch_jid.lower() not in ("none","null",""):
                    try:
                        supabase.table("scrape_jobs").update({"status":"COMPLETED"}).eq(id_col,batch_jid).execute()
                        print(f"   ✅ Batch job {str(batch_jid)[:8]} marked COMPLETED")
                    except Exception as e:
                        print(f"   ⚠️ Could not update batch job {str(batch_jid)[:8]}: {e}")

            print(f"   📊 Stage 3 total: {total_saved} rows saved across {len(all_handles)} handle(s)")

        elif jtype == "Comments (Sentiment)":
            if is_yt:
                # YouTube comments via `streamers/youtube-comments-scraper`.
                # Verified output fields (sample 2026-06-30):
                #   comment, cid, author (with @), videoId, pageUrl,
                #   commentsCount, replyCount, voteCount (= comment likes),
                #   authorIsChannelOwner, hasCreatorHeart, type ("comment"),
                #   replyToCid, title.
                # The cap key isn't documented — send the three most likely
                # (`maxComments`/`maxResults`/`commentsPerVideo`); the actor
                # ignores keys it doesn't recognise.
                # comment_text MUST map to the same `comment_text` column the
                # NLP engine reads so YouTube comments classify through the
                # existing Indonesian/English nlp_engine with no special-casing.
                run_input = {
                    "startUrls":         [{"url": target}],
                    "maxComments":       limit,
                    "maxResults":        limit,
                    "commentsPerVideo":  limit,
                    "proxyConfiguration": {"useApifyProxy": True},
                }
                data = call_apify(actors["comments"], run_input, apikey) or []
                payload = []
                for d in data:
                    text = _yt_first_present(d, "comment", "text", "content", "commentText")
                    author = _yt_first_present(d, "author", "authorName", "channelName", "username")
                    # Top-level replies only: skip nested replies if the actor returns them.
                    # `replyToCid` is set for replies; leave it filtered out so the comment
                    # count in the export matches what's shown on the video page top-level.
                    if d.get("replyToCid"):
                        continue
                    payload.append({
                        # Use `target` (the original job URL) so the export
                        # query matches — same reason as the video-stats path.
                        # YT comment jobs are single-URL today; if we ever
                        # batch multiple video URLs into one job, we'd need to
                        # match `pageUrl` back to the job's target list, but
                        # storing pageUrl directly would break export lookup.
                        "video_url":          target,
                        "influencer_username": kol,
                        "commenter_username":  str(author or "").lstrip("@") or "unknown",
                        "comment_text":        str(text or ""),
                        # voteCount = upvotes on the comment itself. youtube_comments
                        # has a `likes` column for it; the IG/TT tables don't, so this
                        # only flows when is_yt.
                        "likes":               _yt_safe_int(d.get("voteCount")),
                    })
            elif is_ig:
                data = call_apify(actors["comments"],{"directUrls":[target],"resultsLimit":limit,"includeReplies":False},apikey)[:limit]
                payload = [{"video_url":target,"influencer_username":kol,
                            "commenter_username":d.get("ownerUsername"),"comment_text":d.get("text")} for d in data]
            else:
                data = call_apify(actors["comments"],{"postURLs":[target],"maxItems":limit,"maxComments":limit,"commentsPerPost":limit},apikey)[:limit]
                payload = [{"video_url":target,"influencer_username":kol,
                            "commenter_username":d.get("uniqueId") or d.get("author"),
                            "comment_text":d.get("text")} for d in data]
            # YT: cap to `limit` AFTER reply-filter so we don't return half-empty.
            if is_yt and limit:
                payload = payload[:limit]
            try:
                db.upsert_comments(supabase, plat, payload)
            except Exception as db_err:
                err_str = str(db_err).lower()
                if is_yt and "likes" in err_str:
                    # youtube_comments migration not run yet — strip the YT-only
                    # `likes` column and retry. IG/TT branches never set this.
                    print(f"   ⚠️ DB rejected youtube_comments.likes — retrying without (run sql/youtube_platform.sql)")
                    for row in payload:
                        row.pop("likes", None)
                    db.upsert_comments(supabase, plat, payload)
                else:
                    raise

        elif jtype == "Competitor Ads (Meta)":
            fetch_meta_ads(pid, target)
            
        elif jtype == "YouTube Intelligence":
            fetch_youtube_videos(pid, target)
            
        elif jtype == "Ecom Listings":
            # New Competitor Analysis Phase 1 — Shopee + Tokopedia raw scraping.
            # Config carried in scrape_jobs.ecom_config (jsonb). See ecom_run_listings.
            cfg = job.get("ecom_config") or {}
            if isinstance(cfg, str):
                try:    cfg = json.loads(cfg)
                except Exception: cfg = {}
            n, _ecom_note = ecom_run_listings(pid, jid, cfg, apikey)
            print(f"   ✅ Ecom Listings job wrote {n} rows to ecom_listings — {_ecom_note}")

        elif jtype == "Competitor Intelligence Scan":
            # ── FULL SCAN — runs all layers for a competitor brand ─────────────
            print(f"   🚀 Full Intelligence Scan: {target}")

            # Load this competitor's config (hashtags, keywords, blacklist)
            try:
                cfg_rows = (supabase.table("competitor_config")
                            .select("brand_hashtags,brand_keywords")
                            .eq("project_id", pid)
                            .ilike("competitor_name", f"%{target}%")
                            .execute().data or [])
                cfg = cfg_rows[0] if cfg_rows else {}
            except Exception:
                cfg = {}
            brand_hashtags = [h.strip().lstrip("#") for h in
                              str(cfg.get("brand_hashtags","")).split(",") if h.strip()]
            print(f"   Config loaded: {len(brand_hashtags)} hashtag(s) → {brand_hashtags[:5]}")

            # Layer 1: Meta Ad Library (public scrape, no token required)
            print("   📱 Layer 1: Meta Ads")
            fetch_meta_ads(pid, target)

            # Layer 2: YouTube brand films
            print("   ▶  Layer 2: YouTube")
            fetch_youtube_videos(pid, target)

            # Layer 3: Google Trends + News RSS (in compile_daily_snapshots)
            print("   🔍 Layer 3: Trends + News will run in next compiler cycle")

            # Layer 4: E-Commerce — removed 2026-06-26. The old multi-retailer
            # sweep (_fetch_ecommerce) is superseded by the new "Ecom Listings"
            # job type, which is more structured (per-variation, Bahasa-enrichable)
            # and runs as its own job rather than as a layer of this scan.

            # Layer 5: Hashtag KOL discovery — scrape all configured brand hashtags
            if brand_hashtags:
                print(f"   #️⃣  Layer 5: Hashtag KOL scan ({len(brand_hashtags)} hashtag(s))")
                actors = {
                    "hashtag": "clockworks/free-tiktok-scraper",
                    "profile": "apify/instagram-scraper",
                }
                for ht in brand_hashtags[:8]:     # cap at 8 hashtags per scan
                    try:
                        # TikTok hashtag
                        ht_data = call_apify(actors["hashtag"],
                                            {"hashtags": [ht], "resultsPerPage": 30}, apikey)
                        td_payload = [{"project_id": pid, "platform": "TikTok",
                                       "search_target": f"#{ht}",
                                       "video_url": d.get("webVideoUrl") or d.get("videoUrl",""),
                                       "username": (d.get("authorMeta") or {}).get("name",""),
                                       "caption": d.get("text",""),
                                       "play_count": int(d.get("playCount",0) or 0),
                                       "likes": int(d.get("diggCount",0) or 0),
                                       "comments": int(d.get("commentCount",0) or 0),
                                       "shares": int(d.get("shareCount",0) or 0),
                                       "content_type": "Video"}
                                      for d in ht_data if d.get("webVideoUrl") or d.get("videoUrl")]
                        if td_payload:
                            db.upsert_trend_discovery(supabase, td_payload)
                            print(f"      #{ht}: {len(td_payload)} TikTok posts saved")

                        # Instagram hashtag
                        ig_url = f"https://www.instagram.com/explore/tags/{ht}/"
                        ig_data = call_apify(actors["profile"],
                                            {"directUrls": [ig_url],
                                             "resultsType": "posts", "resultsLimit": 20}, apikey)
                        ig_td_payload = [{"project_id": pid, "platform": "Instagram",
                                          "search_target": f"#{ht}",
                                          "video_url": d.get("url",""),
                                          "username": d.get("ownerUsername",""),
                                          "caption": d.get("caption",""),
                                          "play_count": int(d.get("videoPlayCount") or d.get("videoViewCount") or 0),
                                          "likes": int(d.get("likesCount",0) or 0),
                                          "comments": int(d.get("commentsCount",0) or 0),
                                          "content_type": d.get("type","Post")}
                                         for d in ig_data if d.get("url")]
                        if ig_td_payload:
                            db.upsert_trend_discovery(supabase, ig_td_payload)
                            print(f"      #{ht}: {len(ig_td_payload)} IG posts saved")
                    except Exception as ht_err:
                        print(f"      #{ht} error: {ht_err}")
            else:
                print("   #️⃣  Layer 5: No hashtags configured — add them in the Intelligence tab config panel")

            print(f"   ✅ Full Scan complete for {target}")

        else:
            raise ValueError(f"Unknown job_type: '{jtype}'")

        print(f"✅ {jid} done.")
        db.update_job_status(supabase, jid, "COMPLETED", id_col=id_col)

        # Ecom Listings jobs carry a "what happened" summary note (per-platform
        # row counts, or why zero rows were produced). update_job_status clears
        # error_message on COMPLETED, so write our note AFTER it so the UI can
        # surface zero-row outcomes without forcing a Railway-logs dig.
        _ecom_note = locals().get("_ecom_note")
        if _ecom_note:
            try:
                supabase.table("scrape_jobs").update({"error_message": str(_ecom_note)[:500]}).eq(id_col, jid).execute()
            except Exception as _e:
                print(f"   ⚠️ ecom note write failed: {_e}")

    except Exception as e:
        err = str(e)[:500]
        print(f"🚨 {jid} FAILED: {err}")
        db.update_job_status(supabase, jid, "FAILED", error_message=err, id_col=id_col)

# ─────────────────────────────────────────────────────────────────────────────
# SCHEDULED EMAIL & AUTOMATIONS
# ─────────────────────────────────────────────────────────────────────────────
def process_scheduled_email(ej):
    jid = ej["id"]
    try:
        print(f"\n📧 Email {jid} → {ej.get('recipients','')}")
        bot = os.environ.get("BOT_EMAIL","").strip()
        msg = EmailMessage()
        msg["Subject"]  = f"📊 Total Scraper: {ej.get('platform','')} — {ej.get('mode','')}"
        msg["From"]     = f"Total Scraper <{bot}>"
        msg["To"]       = ", ".join(e.strip() for e in ej.get("recipients","").split(",") if e.strip())
        msg["Reply-To"] = ej.get("user_email","")
        msg.set_content("Scheduled report attached.")
        msg.add_attachment(base64.b64decode(ej["file_data"]), maintype="application",
                           subtype="vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                           filename=ej.get("file_name","report.xlsx"))
        dispatch_email(msg)
        print(f"✅ Email {jid} sent.")
        db.mark_email_sent(supabase, jid)
    except Exception as e:
        print(f"🚨 Email {jid}: {e}")
        db.mark_email_failed(supabase, jid)

def process_automation(auto):
    aid  = auto["id"]
    pid  = auto["project_id"]
    plat = auto["platform"]
    mode = auto["mode"]
    freq = auto.get("frequency","Daily")
    print(f"\n⏰ Automation {aid}: {plat} — {mode}")
    try:
        import pandas as pd, io as _io
        jobs = db.get_project_jobs(supabase, pid, platform=plat, job_type=mode)
        urls = list({j["target_url"] for j in jobs if j.get("target_url")})
        df_e = pd.DataFrame()
        if urls:
            if mode == "Specific URLs (Video Stats)":
                df_e = pd.DataFrame(db.get_campaign_videos(supabase, plat, urls))
            elif mode == "Profile Feed (Audit)":
                names = [j.get("kol_username","") for j in jobs if j.get("kol_username")]
                bare  = [u for u in urls if not u.startswith("http")]
                df_e  = pd.DataFrame(db.get_influencer_profiles(supabase, plat, names + bare))
            elif mode == "Comments (Sentiment)":
                df_e = pd.DataFrame(db.get_comments(supabase, plat, urls))
        if not df_e.empty:
            buf = _io.BytesIO()
            with pd.ExcelWriter(buf, engine="openpyxl") as w:
                df_e.to_excel(w, index=False)
            buf.seek(0)
            bot = os.environ.get("BOT_EMAIL","").strip()
            msg = EmailMessage()
            msg["Subject"] = f"📊 Auto Report: {plat} — {mode}"
            msg["From"]    = f"Total Scraper <{bot}>"
            msg["To"]      = auto.get("recipients","")
            msg["Reply-To"]= auto.get("user_email","")
            msg.set_content("Scheduled report attached.")
            msg.add_attachment(buf.read(), maintype="application",
                               subtype="vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                               filename=f"Auto_{plat}_{mode}.xlsx")
            dispatch_email(msg)
            print(f"✅ Automation {aid} sent.")
        
        now = datetime.datetime.now(datetime.timezone.utc)
        if "Weekly"  in freq: nxt = now + datetime.timedelta(weeks=1)
        elif "Monthly" in freq:
            m = now.month % 12 + 1
            y = now.year + (1 if now.month == 12 else 0)
            nxt = now.replace(year=y, month=m)
        else: nxt = now + datetime.timedelta(days=1)
        db.advance_automation(supabase, aid, nxt.isoformat())
    except Exception as e:
        print(f"🚨 Automation {aid}: {e}")


# ── Scheduled reports (Exporter "Schedule email delivery") ───────────────────
ICT_TZ = datetime.timezone(datetime.timedelta(hours=7))  # Indochina Time (UTC+7)

def _next_run_ict(frequency: str, send_time: str) -> str:
    """Next UTC ISO instant for `send_time` (HH:MM, ICT) at the given cadence."""
    try:
        hh, mm = [int(x) for x in str(send_time or "09:00").split(":")[:2]]
    except Exception:
        hh, mm = 9, 0
    now_ict = datetime.datetime.now(ICT_TZ)
    target  = now_ict.replace(hour=hh, minute=mm, second=0, microsecond=0)
    if target <= now_ict:
        f = (frequency or "daily").lower()
        if "week" in f:
            target += datetime.timedelta(weeks=1)
        elif "month" in f:
            m = target.month % 12 + 1
            y = target.year + (1 if target.month == 12 else 0)
            target = target.replace(year=y, month=m)
        else:  # daily / once
            target += datetime.timedelta(days=1)
    return target.astimezone(datetime.timezone.utc).isoformat()

def process_scheduled_report(report):
    rid       = report["id"]
    pid       = report.get("project_id")
    job_types = report.get("job_types") or []
    job_ids   = report.get("job_ids") or []
    gen_id    = report.get("generated_report_id")   # Feature B: saved-file mode
    recipient = (report.get("recipient_email") or "").strip()
    freq      = (report.get("frequency") or "once").lower()
    send_time = report.get("send_time") or "09:00"
    # `once` schedules fire from `next_run_at` (which "Email now" sets to
    # now-5s), NOT from `send_time`. Print the send_time only for recurring
    # so the log stops implying a one-shot got scheduled 8 hours out.
    if freq == "once":
        print(f"\n📧 Scheduled report {rid} → {recipient} (once — firing immediately)")
    else:
        print(f"\n📧 Scheduled report {rid} → {recipient} ({freq} @ {send_time} ICT)")

    # ── Saved-file mode (Feature B) ─────────────────────────────────────
    # If the schedule is bound to a pre-generated report, skip the whole
    # regenerate-from-scratch pipeline: download the xlsx from Supabase
    # Storage + email it directly. Rescrape flag is ignored in this mode
    # (there's nothing to rescrape — the file's already fixed).
    if gen_id and recipient:
        try:
            gen_row = (
                supabase.table("generated_reports")
                .select("filename,storage_path")
                .eq("id", gen_id).single().execute().data
            )
            if not gen_row:
                raise RuntimeError(f"generated_report {gen_id} not found (deleted?)")
            path = gen_row["storage_path"]
            print(f"   Saved-file mode: downloading {path}")
            file_bytes = supabase.storage.from_("generated-reports").download(path)
            if not file_bytes:
                raise RuntimeError(f"Storage returned empty bytes for {path}")
            bot = os.environ.get("BOT_EMAIL","").strip()
            msg = EmailMessage()
            msg["Subject"] = f"📊 Total Scraper — {gen_row.get('filename') or 'report'}"
            msg["From"]    = f"Total Scraper <{bot}>"
            msg["To"]      = recipient
            msg.set_content("Your saved Total Scraper report is attached.")
            msg.add_attachment(
                file_bytes, maintype="application",
                subtype="vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                filename=gen_row.get("filename") or "report.xlsx",
            )
            dispatch_email(msg)
            print(f"✅ Scheduled report {rid} sent (saved file, {len(file_bytes)} bytes).")
        except Exception as e:
            print(f"🚨 Scheduled report {rid} (saved-file mode): {e}")
        # After processing: one-shots get HARD-DELETED (their reason to exist
        # is gone — keeping a dead row just clutters the Active schedules
        # panel and the DB). Recurring schedules advance to the next fire.
        # We always run this branch so a failure can't busy-loop the worker.
        try:
            if freq == "once":
                supabase.table("scheduled_reports").delete().eq("id", rid).execute()
                print(f"   🗑️ Deleted one-shot schedule {rid}")
            else:
                db.advance_scheduled_report(supabase, rid, next_run_iso=_next_run_ict(freq, send_time))
        except Exception as e:
            print(f"🚨 Scheduled report {rid} advance/delete failed: {e}")
        return

    try:
        import pandas as pd, io as _io
        sheets = {}

        # ── Concrete-job mode (new, preferred) ───────────────────────────
        # When job_ids is present, send EXACTLY those jobs' data — no filter
        # drift, no picking up new jobs the user didn't authorise. Groups by
        # (platform, job_type) so each combo becomes one sheet in the workbook.
        if job_ids:
            print(f"   Concrete-job mode: {len(job_ids)} bound job(s)")
            try:
                bound_jobs = (
                    supabase.table("scrape_jobs")
                    .select("job_id,target_url,kol_username,platform,job_type,status")
                    .in_("job_id", job_ids)
                    .execute()
                    .data or []
                )
            except Exception as e:
                print(f"   ⚠️ Bound-jobs lookup failed: {e}")
                bound_jobs = []
            # Group by (platform, job_type)
            groups: dict = {}
            for j in bound_jobs:
                if j.get("status") != "COMPLETED":
                    continue
                key = (j.get("platform","Instagram"), j.get("job_type",""))
                groups.setdefault(key, []).append(j)
            for (plat, jt), gjobs in groups.items():
                urls = list({j["target_url"] for j in gjobs if j.get("target_url")})
                names = [j.get("kol_username","") for j in gjobs if j.get("kol_username")]
                df_e = pd.DataFrame()
                if jt == "Specific URLs (Video Stats)" and urls:
                    df_e = pd.DataFrame(db.get_campaign_videos(supabase, plat, urls))
                elif jt == "Profile Feed (Audit)" and names:
                    df_e = pd.DataFrame(db.get_influencer_profiles(supabase, plat, names))
                elif jt == "Comments (Sentiment)" and urls:
                    df_e = pd.DataFrame(db.get_comments(supabase, plat, urls))
                if not df_e.empty:
                    sheets[f"{jt.split(' ')[0]}_{plat}"[:31]] = df_e
        # ── Legacy filter mode (job_ids empty — pre-migration schedules) ─
        else:
            for jt in job_types:
                for plat in ("Instagram", "TikTok", "YouTube"):
                    jobs = db.get_project_jobs(supabase, pid, platform=plat, job_type=jt)
                    urls = list({j["target_url"] for j in jobs if j.get("target_url")})
                    df_e = pd.DataFrame()
                    if jt == "Specific URLs (Video Stats)" and urls:
                        df_e = pd.DataFrame(db.get_campaign_videos(supabase, plat, urls))
                    elif jt == "Profile Feed (Audit)":
                        names = [j.get("kol_username","") for j in jobs if j.get("kol_username")]
                        if names:
                            df_e = pd.DataFrame(db.get_influencer_profiles(supabase, plat, names))
                    elif jt == "Comments (Sentiment)" and urls:
                        df_e = pd.DataFrame(db.get_comments(supabase, plat, urls))
                    if not df_e.empty:
                        sheets[f"{jt.split(' ')[0]}_{plat}"[:31]] = df_e

        if sheets and recipient:
            buf = _io.BytesIO()
            with pd.ExcelWriter(buf, engine="openpyxl") as w:
                for name, df_e in sheets.items():
                    df_e.to_excel(w, index=False, sheet_name=name)
            buf.seek(0)
            bot = os.environ.get("BOT_EMAIL","").strip()
            msg = EmailMessage()
            msg["Subject"] = "📊 Total Scraper — Scheduled Report"
            msg["From"]    = f"Total Scraper <{bot}>"
            msg["To"]      = recipient
            msg.set_content("Your scheduled Total Scraper report is attached.")
            msg.add_attachment(buf.read(), maintype="application",
                               subtype="vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                               filename="scheduled_report.xlsx")
            dispatch_email(msg)
            print(f"✅ Scheduled report {rid} sent ({len(sheets)} sheet(s)).")
        else:
            print(f"⚠️ Scheduled report {rid}: nothing to send (no data or no recipient).")
    except Exception as e:
        print(f"🚨 Scheduled report {rid}: {e}")

    # After processing: one-shots get HARD-DELETED (they exist only to fire
    # once — no reason to leave dead rows in the DB or the Active schedules
    # panel). Recurring schedules advance to their next fire time. We always
    # run this branch so a failure can't busy-loop the worker.
    try:
        if freq == "once":
            supabase.table("scheduled_reports").delete().eq("id", rid).execute()
            print(f"   🗑️ Deleted one-shot schedule {rid}")
        else:
            db.advance_scheduled_report(supabase, rid, next_run_iso=_next_run_ict(freq, send_time))
    except Exception as e:
        print(f"🚨 Scheduled report {rid} advance/delete failed: {e}")

# ─────────────────────────────────────────────────────────────────────────────
# MULTI-LAYER DAILY COMPILER (Runs Once Per Day)
# ─────────────────────────────────────────────────────────────────────────────
def compile_daily_snapshots():
    today = datetime.date.today().isoformat()
    now_utc = datetime.datetime.now(datetime.timezone.utc).isoformat()
    print(f"\n🧠 Running Multi-Layer Intelligence Compiler — {today}")
    
    try:
        projects = supabase.table("projects").select("project_id").execute().data or []
        for p in projects:
            pid = p.get("project_id") or p.get("id")
            if not pid: continue

            # 1. Compile Core Social Snapshots (Layer 1 & 2 integration)
            ads_res = supabase.table("meta_active_ads").select("competitor_name").eq("project_id", pid).eq("status","ACTIVE").execute()
            brand_ads = {}
            for ad in (ads_res.data or []):
                b = (ad.get("competitor_name") or "Unknown").strip()
                brand_ads[b] = brand_ads.get(b, 0) + 1

            brand_eng = {}
            for pfx in ("ig","tiktok"):
                plat = "Instagram" if pfx == "ig" else "TikTok"
                try:
                    rows = supabase.table(f"{pfx}_influencer_profiles").select("username,play_count,likes,comments,shares").execute().data or []
                    for r in rows:
                        b = (r.get("username") or "Unknown").strip()
                        if b not in brand_eng: brand_eng[b] = {"posts":0,"plays":0,"eng":0,"plat":plat}
                        brand_eng[b]["posts"] += 1
                        brand_eng[b]["plays"] += max(r.get("play_count",0),0)
                        brand_eng[b]["eng"]   += (max(r.get("likes",0),0) + max(r.get("comments",0),0) + max(r.get("shares",0),0))
                except: pass

            payloads = []
            all_brands = set(list(brand_ads.keys()) + list(brand_eng.keys()))
            for brand in all_brands:
                em = brand_eng.get(brand, {"posts":0,"plays":1,"eng":0,"plat":"Cross-Platform"})
                er = round(em["eng"] / max(em["plays"],1) * 100, 2)
                payloads.append({
                    "project_id": pid, "brand_name": brand, "platform": em.get("plat","Cross-Platform"),
                    "snapshot_date": today, "engagement_rate": er, "posts_volume": em["posts"],
                    "ad_count": brand_ads.get(brand,0), "top_hashtags": [], "messaging_themes": {}
                })
            if payloads:
                supabase.table("competitor_snapshots").upsert(payloads, on_conflict="project_id,brand_name,platform,snapshot_date").execute()

            # 2. LAYER 3: Search Trends & Google News
            tracked_brands = [b for b in all_brands if b != "Unknown"][:3]
            
            for brand in tracked_brands:
                try:
                    encoded_brand = urllib.parse.quote(brand)
                    rss_url = f"https://news.google.com/rss/search?q={encoded_brand}&hl=id-ID&gl=ID&ceid=ID:id"
                    feed = feedparser.parse(rss_url)
                    news_payloads = []
                    for entry in feed.entries[:5]: 
                        news_payloads.append({
                            "project_id": pid, "brand_name": brand,
                            "title": entry.title, "link": entry.link,
                            "published_at": now_utc
                        })
                    if news_payloads:
                        supabase.table("news_mentions").upsert(news_payloads, on_conflict="project_id,link").execute()
                except Exception as e: print(f"   ⚠️ News RSS err for {brand}: {e}")

                try:
                    pytrends = TrendReq(hl='id-ID', tz=420)
                    pytrends.build_payload([brand], timeframe='today 3-m', geo='ID')
                    trend_df = pytrends.interest_over_time()
                    if not trend_df.empty:
                        score = int(trend_df[brand].iloc[-1])
                        supabase.table("search_trends").upsert({
                            "project_id": pid, "brand_name": brand,
                            "trend_date": today, "interest_score": score
                        }, on_conflict="project_id,brand_name,trend_date").execute()
                    time.sleep(1)
                except Exception as e: print(f"   ⚠️ PyTrends err for {brand}: {e}")
                
            # 3. LAYER 5: Creator Roster Derivation (Hashtag co-occurrence)
            try:
                ht_res = supabase.table("trend_discovery").select("search_target, username, platform, play_count").eq("project_id", pid).execute().data or []
                roster_dict = {}
                for h in ht_res:
                    brand = h.get("search_target","").replace("#","").strip()
                    creator = h.get("username")
                    plat = h.get("platform")
                    if brand and creator and plat:
                        key = f"{brand}_{creator}_{plat}"
                        if key not in roster_dict:
                            roster_dict[key] = {"b": brand, "c": creator, "p": plat, "count": 0, "plays": 0}
                        roster_dict[key]["count"] += 1
                        roster_dict[key]["plays"] += int(h.get("play_count") or 0)
                
                roster_payload = []
                for v in roster_dict.values():
                    roster_payload.append({
                        "project_id": pid, "competitor_name": v["b"], "creator_username": v["c"],
                        "platform": v["p"], "last_seen": today, "post_count": v["count"],
                        "affinity_score": v["plays"]
                    })
                if roster_payload:
                    supabase.table("competitor_kol_roster").upsert(roster_payload, on_conflict="project_id,competitor_name,creator_username,platform").execute()
            except Exception as e: print(f"   ⚠️ Creator Roster err: {e}")

        print("✅ Multi-Layer Intelligence complete.")
    except Exception as e: print(f"❌ Compiler: {e}")

# ─────────────────────────────────────────────────────────────────────────────
# MAIN LOOP
# ─────────────────────────────────────────────────────────────────────────────
print(f"\n🚀 Worker online — polling every 3s | Competitor Intelligence: "
      f"{'ON' if ENABLE_INTELLIGENCE else 'OFF (set ENABLE_INTELLIGENCE=true to enable)'}")
last_compiled = None
last_gen_reports_sweep = 0.0   # Feature B: purge expired saved reports (hourly)

# One-time startup cleanup + proof of life. We ALWAYS print the result now
# (was previously silent when there was nothing to purge) so the Railway logs
# clearly show the worker made it past bootstrap and into the poll loop.
try:
    stale = (
        supabase.table("scheduled_reports")
        .delete()
        .eq("active", False)
        .execute().data or []
    )
    print(f"🗑️ Startup: purged {len(stale)} legacy fired one-shot(s)")
except Exception as e:
    print(f"⚠️ Startup one-shot purge skipped: {e}")

# Heartbeat state — every N polls print a line so we can tell from Railway
# logs whether the worker is alive but idle vs. dead. Cheap and diagnostic.
_hb_counter = 0
_HB_EVERY = 30   # 30 polls × 3s = ~90s between heartbeats


def sweep_expired_generated_reports():
    """Delete Storage files + DB rows for generated_reports past their
    expires_at. Keeps the `generated-reports` bucket bounded so it doesn't
    grow forever. Silently skips if the table hasn't been migrated yet."""
    try:
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        expired = (
            supabase.table("generated_reports")
            .select("id,storage_path")
            .lt("expires_at", now_iso)
            .limit(50).execute().data or []
        )
        if not expired:
            return
        print(f"🧹 Purging {len(expired)} expired generated_report(s)")
        paths = [r["storage_path"] for r in expired if r.get("storage_path")]
        if paths:
            try:
                supabase.storage.from_("generated-reports").remove(paths)
            except Exception as e:
                print(f"   ⚠️ Storage sweep skipped: {e}")
        ids = [r["id"] for r in expired]
        supabase.table("generated_reports").delete().in_("id", ids).execute()
    except Exception as e:
        msg = str(e).lower()
        if "generated_reports" in msg or "pgrst" in msg:
            # Migration hasn't run yet — quietly ignore.
            return
        print(f"   ⚠️ Generated-reports sweep err: {e}")


while True:
    try:
        pending = db.get_pending_jobs(supabase, limit=1)
        if pending: process_job(pending[0]); continue

        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        emails  = db.get_due_scheduled_emails(supabase, now_iso)
        if emails: process_scheduled_email(emails[0]); continue

        autos = db.get_due_automations(supabase, now_iso)
        if autos: process_automation(autos[0]); continue

        reports = db.get_due_scheduled_reports(supabase, now_iso)
        if reports: process_scheduled_report(reports[0]); continue

        # Hourly sweep for expired saved reports (Feature B — keeps the
        # generated-reports bucket bounded). Timestamped so we don't hammer
        # the DB every 3-second poll.
        _now = time.time()
        if _now - last_gen_reports_sweep > 3600:
            sweep_expired_generated_reports()
            last_gen_reports_sweep = _now

        if ENABLE_INTELLIGENCE:
            today = datetime.date.today()
            if os.environ.get("LAST_COMPILED_DATE") != today.isoformat():
                compile_daily_snapshots()
                os.environ["LAST_COMPILED_DATE"] = today.isoformat()

        # Heartbeat — every ~90s. Prints:
        #   - due count (active=true AND next_run_at <= now)
        #   - TOTAL count in the table (irrespective of due/active)
        # If total=0 but you know rows exist via the SQL editor, the worker
        # is looking at a different Supabase project than the frontend →
        # SUPABASE_URL on Railway worker ≠ NEXT_PUBLIC_SUPABASE_URL on Vercel.
        _hb_counter += 1
        if _hb_counter >= _HB_EVERY:
            try:
                due_now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
                due_rows = (
                    supabase.table("scheduled_reports")
                    .select("id,next_run_at,active")
                    .eq("active", True)
                    .lte("next_run_at", due_now_iso)
                    .execute().data or []
                )
                all_rows = (
                    supabase.table("scheduled_reports")
                    .select("id,active,next_run_at")
                    .limit(5)
                    .execute().data or []
                )
                print(f"💓 Heartbeat — alive · {len(due_rows)} due / {len(all_rows)} total (first 5) in this DB")
                for r in all_rows[:3]:
                    print(f"     · {r.get('id')[:8]} active={r.get('active')} next_run_at={r.get('next_run_at')}")
            except Exception as e:
                print(f"💓 Heartbeat (query err ignored: {e})")
            _hb_counter = 0

        time.sleep(3)
    except Exception as e:
        print(f"🚨 Loop Err: {e}"); time.sleep(10)
