"""
worker.py — Background Execution Engine (Railway)
Restored: all Apify scraping, scheduled emails, recurring automations.
Added: Multi-Layer Intelligence compiler (YouTube, Meta Ads, Trends, News, E-Commerce).
"""
import os, time, re, requests, smtplib, base64, datetime, urllib.parse, json

# curl_cffi: Chrome TLS fingerprint impersonation — bypasses Cloudflare on Indonesian e-commerce sites
# Install: pip install curl_cffi==0.15.0
try:
    from curl_cffi import requests as cf_requests
    _CFFI_OK = True
except ImportError:
    cf_requests = requests
    _CFFI_OK = False
    print("⚠️  curl_cffi not installed — Cloudflare-protected retailers (Tokopedia/Alfamart/Indomaret) may fail")

_CHROME_HDRS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8",
    "DNT": "1",
}

def _cffi_get(url, params=None, extra_headers=None, verify=True, timeout=15):
    """GET with Chrome TLS impersonation. Falls back to standard requests if curl_cffi unavailable."""
    hdrs = {**_CHROME_HDRS, **(extra_headers or {})}
    kw = dict(params=params, headers=hdrs, timeout=timeout)
    if _CFFI_OK:
        kw["impersonate"] = "chrome124"
        if not verify: kw["verify"] = False
        r = cf_requests.get(url, **kw)
    else:
        kw["verify"] = verify
        r = requests.get(url, **kw)
    return r if r.ok else None
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

try:
    supabase: Client = db.make_client()
    print("✅ Supabase connected.")
except RuntimeError as e:
    print(f"🚨 FATAL: {e}"); sys.exit(1)

if not APIFY_TOKEN:
    print("🚨 FATAL: APIFY_TOKEN not set."); sys.exit(1)
print("✅ Environment ready.\n")

# ─────────────────────────────────────────────────────────────────────────────
# CORE APIFY HELPER
# ─────────────────────────────────────────────────────────────────────────────
def call_apify(actor, run_input, token=None):
    tok = (token or APIFY_TOKEN).strip()
    aid = actor.replace("/","~")
    hdrs = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
    r = requests.post(f"https://api.apify.com/v2/acts/{aid}/runs", headers=hdrs, json=run_input)
    if not r.ok: raise Exception(f"Start failed: {r.text[:300]}")
    run_id = r.json()["data"]["id"]
    ds_id = r.json()["data"]["defaultDatasetId"]
    print(f"   ➔ Apify Run {run_id}")
    while True:
        sr = requests.get(f"https://api.apify.com/v2/actor-runs/{run_id}?waitForFinish=30", headers=hdrs)
        s = sr.json()["data"]["status"]
        if s == "SUCCEEDED": break
        if s in ("FAILED","ABORTED","TIMED-OUT"): raise Exception(f"Apify Failed: {s}")
    items = requests.get(f"https://api.apify.com/v2/datasets/{ds_id}/items", headers=hdrs)
    if not items.ok: raise Exception("Dataset fetch failed")
    return items.json()

IG = {"video_stats":"apify/instagram-scraper","profile":"apify/instagram-scraper","comments":"apify/instagram-comment-scraper","hashtag":"apify/instagram-hashtag-scraper"}
TT = {"video_stats":"clockworks/tiktok-scraper","profile":"clockworks/tiktok-scraper","comments":"clockworks/tiktok-comments-scraper","hashtag":"clockworks/tiktok-scraper"}

# ─────────────────────────────────────────────────────────────────────────────
# EMAIL DISPATCHER
# ─────────────────────────────────────────────────────────────────────────────
def dispatch_email(msg):
    bot = os.environ.get("BOT_EMAIL","").strip()
    pw  = os.environ.get("BOT_APP_PASSWORD","").strip()
    if not bot or not pw: raise Exception("BOT_EMAIL/BOT_APP_PASSWORD missing")
    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as s:
        s.login(bot, pw); s.send_message(msg)

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
# ECOMMERCE SCRAPERS — routed through Apify Indonesian residential proxies
#
# WHY PROXIES ARE REQUIRED:
#   Shopee, Tokopedia, Alfamart, Indomaret all use Cloudflare Bot Management.
#   This blocks all datacenter IP ranges (AWS, GCP, Railway) at the ASN level
#   before any request is parsed — no header tricks can bypass this.
#   Solution: Apify residential proxy pool routes through real Indonesian home
#   IPs that Cloudflare trusts. Same Apify token you already have, extra credits.
#
# Schema (run once in Supabase if not exists):
#   CREATE TABLE IF NOT EXISTS ecommerce_products (
#       id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
#       project_id      uuid NOT NULL,
#       competitor_name text NOT NULL,
#       product_name    text NOT NULL,
#       sku             text,
#       current_price   numeric(12,2) NOT NULL,
#       original_price  numeric(12,2),
#       currency        varchar(10) DEFAULT 'IDR',
#       stock_status    text DEFAULT 'in_stock',
#       product_url     text,
#       image_url       text,
#       scraped_at      timestamptz DEFAULT now(),
#       updated_at      timestamptz DEFAULT now()
#   );
# ─────────────────────────────────────────────────────────────────────────────

import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


def _ecom_name(p: dict) -> str:
    """Extract product name from any field variant an API might return."""
    for f in ("name","productName","product_name","title","Title","Name","itemName","displayName"):
        v = p.get(f,"")
        if v and str(v).strip(): return str(v).strip()[:255]
    return ""

def _parse_idr(raw) -> float:
    """
    Clean any Indonesian Rupiah price string to a numeric float.
    Indonesian convention: dots = thousands separator, comma = decimal.
    Examples: 'Rp 15.000' → 15000.0 | 'Rp 1.500.000,50' → 1500000.5
    """
    if not raw:
        return 0.0
    s = re.sub(r'(?i)rp\.?\s*|idr\.?\s*|\s', '', str(raw))
    s = re.sub(r'[^\d.,]', '', s)
    if not s:
        return 0.0
    dc = s.count('.'); cc = s.count(',')
    if dc > 1:
        s = s.replace('.', '').replace(',', '.')
    elif dc == 1 and cc == 0:
        s = s.replace('.', '') if len(s.split('.')[1]) == 3 else s
    elif cc >= 1:
        s = s.replace('.', '').replace(',', '.')
    try:    return float(s)
    except: return 0.0


def _ecom_row(pid, comp, platform, name, cur, orig=None,
              sku=None, url=None, img=None, stock="in_stock") -> dict:
    """Build a dict matching the ecommerce_products schema."""
    return {
        "project_id":      pid,
        "competitor_name": comp,
        "product_name":    str(name).strip()[:255],
        "sku":             str(sku)[:100] if sku else None,
        "current_price":   round(float(cur or 0), 2),
        "original_price":  round(float(orig), 2) if orig else None,
        "currency":        "IDR",
        "stock_status":    stock or "in_stock",
        "product_url":     str(url)[:500] if url else None,
        "image_url":       str(img)[:500] if img else None,
        "scraped_at":      datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "updated_at":      datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }


def _proxy_session(apify_token: str) -> requests.Session:
    """
    Build a requests Session pre-configured with Apify Indonesian residential proxy.
    Traffic appears to originate from real Indonesian home IPs → passes Cloudflare.
    Proxy cost: ~$3–8/GB on Apify (a product search response is <100KB → cents).
    """
    tok   = (apify_token or APIFY_TOKEN).strip()
    proxy = f"http://groups-RESIDENTIAL,country-ID:{tok}@proxy.apify.com:8000"
    s = requests.Session()
    s.proxies = {"http": proxy, "https": proxy}
    s.verify  = False   # Apify proxy uses SSL interception
    s.headers.update({
        "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8",
    })
    return s


def _shopee(pid: str, brand: str, apify_token: str) -> tuple[list, str]:
    """
    Shopee Indonesia — community actor 'gio21/shopee-scraper'.
    ✅ No login, no cookies, no setup. Built-in proxy rotation. Supports ID.
    Pricing: ~$0.005/product (about Rp80/product — near free for 20-30 items).
    """
    try:
        tok  = (apify_token or APIFY_TOKEN).strip()
        hdrs = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
        run_input = {
            "keyword":  brand,
            "country":  "ID",
            "maxItems": 30,
        }
        r = requests.post(
            "https://api.apify.com/v2/acts/gio21~shopee-scraper/runs?waitForFinish=120",
            headers=hdrs, json=run_input, timeout=135
        )
        if not r.ok:
            return [], f"Shopee actor HTTP {r.status_code}: {r.text[:150]}"
        ds    = r.json()["data"]["defaultDatasetId"]
        items = requests.get(f"https://api.apify.com/v2/datasets/{ds}/items", headers=hdrs).json()
        print(f"      Shopee gio21: {len(items)} products")
        rows = []
        for p in (items or []):
            name = str(p.get("name","") or p.get("itemName","")).strip()[:255]
            if not name: continue
            # gio21 returns prices in IDR as integers (no ×100000 conversion needed)
            cur  = _parse_idr(p.get("price", p.get("priceMin", 0)))
            orig = _parse_idr(p.get("priceMax", p.get("originalPrice", 0))) or None
            if orig and orig <= cur: orig = None
            rows.append(_ecom_row(pid, brand, "Shopee", name, cur, orig,
                                  sku=str(p.get("itemId","") or "")[:100] or None,
                                  url=p.get("itemUrl") or p.get("url"),
                                  img=p.get("image") or p.get("imageUrl"),
                                  stock="in_stock" if p.get("stock",1) else "out_of_stock"))
        return rows, ""
    except Exception as e:
        return [], str(e)[:200]

def _tokopedia(pid: str, brand: str, apify_token: str) -> tuple[list, str]:
    """
    Tokopedia — Strategy:
    1. Direct ACE API (fastest, no proxy, free)
    2. shahidirfan community actor (if ACE blocked)
    3. Playwright fallback (last resort)
    Failure modes are reported with clear reasons, never loops.
    """
    import urllib.parse
    brand_words = brand.lower().split()
    tok  = (apify_token or APIFY_TOKEN).strip()
    hdrs = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
    rows = []

    # ── Attempt 1: Tokopedia ACE API via curl_cffi (Chrome TLS fingerprint) ─
    try:
        r = _cffi_get(
            "https://ace.tokopedia.com/search/product/v3",
            params={"q": brand, "rows": 25, "start": 0, "source": "search",
                    "device": "desktop", "related": "true", "ob": "23"},
            extra_headers={
                "X-Source": "tokopedia-lite",
                "X-Device": "desktop web",
                "X-Tkpd-Lite-Service": "zeus",
                "Referer": f"https://www.tokopedia.com/search?q={urllib.parse.quote(brand)}",
                "Origin": "https://www.tokopedia.com",
            }
        )
        if r:
            data = r.json()
            products = (data.get("data",{}).get("products") or
                        data.get("header",{}) and data.get("data",[]) or [])
            # Handle nested structure
            if isinstance(data.get("data"), dict):
                products = data["data"].get("products", [])
            for p in products:
                name = str(p.get("name","") or p.get("product_name","")).strip()[:255]
                if not name: continue
                if not any(w in name.lower() for w in brand_words): continue
                price_obj = p.get("price",{}) or {}
                cur = _parse_idr(price_obj.get("text_idr","") or price_obj.get("value",0) or p.get("price_int",0))
                rows.append(_ecom_row(pid, brand, "Tokopedia", name, cur,
                    url=p.get("url") or p.get("product_url",""),
                    img=p.get("image_url","") or p.get("thumbnail","")))
            if rows:
                print(f"      Tokopedia ACE API: {len(rows)} products")
                return rows, ""
            elif r.ok:
                print(f"      Tokopedia ACE API: responded but 0 matching products — JSON keys: {list(data.keys())[:8]}")
    except Exception as e:
        print(f"      Tokopedia ACE API error: {e}")

    # ── Attempt 2: shahidirfan actor (correct params) ─────────────────────
    try:
        r = requests.post(
            "https://api.apify.com/v2/acts/shahidirfan~tokopedia-search-scraper/runs?waitForFinish=90",
            headers=hdrs, json={"keyword": brand, "results_wanted": 25, "max_pages": 2}, timeout=105
        )
        if r.ok:
            ds    = r.json()["data"]["defaultDatasetId"]
            items = requests.get(f"https://api.apify.com/v2/datasets/{ds}/items", headers=hdrs, timeout=20).json()
            for p in (items or []):
                name = str(p.get("name","") or p.get("productName","")).strip()[:255]
                if not name or not any(w in name.lower() for w in brand_words): continue
                cur = _parse_idr(p.get("price",0) or p.get("currentPrice",0))
                rows.append(_ecom_row(pid, brand, "Tokopedia", name, cur,
                    url=p.get("url") or p.get("productUrl",""), img=p.get("imageUrl","")))
            if rows:
                print(f"      Tokopedia shahidirfan: {len(rows)} products")
                return rows, ""
        else:
            err = r.json().get("error",{})
            if "not-rented" in str(err.get("type","")):
                print(f"      Tokopedia shahidirfan: requires paid rental — skipping")
            else:
                print(f"      Tokopedia shahidirfan HTTP {r.status_code}: {r.text[:100]}")
    except Exception as e:
        print(f"      Tokopedia shahidirfan error: {e}")

    # ── Attempt 3: Playwright fallback ────────────────────────────────────
    try:
        q = urllib.parse.quote(brand)
        r = requests.post(
            "https://api.apify.com/v2/acts/apify~playwright-scraper/runs?waitForFinish=120",
            headers=hdrs, json={
                "startUrls":[{"url":f"https://www.tokopedia.com/search?q={q}&st=product&official=true"}],
                "pageFunction":"""async function pageFunction(c){const{page}=c;await page.waitForTimeout(5000);return await page.evaluate(()=>{try{const nd=JSON.parse(document.getElementById('__NEXT_DATA__').textContent);const prods=nd?.props?.pageProps?.data?.searchProductV5?.data?.products||nd?.props?.pageProps?.initialState?.searchProduct?.data?.products||[];return prods.slice(0,25).map(x=>({name:x.name,price:String(x.price?.value||0),url:x.url,img:x.imageUrl,sku:String(x.id||'')}))}catch(e){return[{_error:e.message}]}})}""",
                "maxPagesPerCrawl":1,
                "proxyConfiguration":{"useApifyProxy":True},
                "launchContext":{"launchOptions":{"headless":True},"stealth":True},
            }, timeout=140
        )
        if r.ok:
            ds = r.json()["data"]["defaultDatasetId"]
            items = requests.get(f"https://api.apify.com/v2/datasets/{ds}/items", headers=hdrs, timeout=20).json()
            for item in (items or []):
                if item.get("_error"): print(f"      Tokopedia playwright page error: {item['_error']}"); continue
                prods = item if isinstance(item, list) else ([item] if item.get("name") else [])
                for p in prods:
                    name = str(p.get("name","")).strip()[:255]
                    if not name or not any(w in name.lower() for w in brand_words): continue
                    rows.append(_ecom_row(pid, brand, "Tokopedia", name, _parse_idr(p.get("price",0)),
                        url=p.get("url",""), img=p.get("img","")))
            if rows:
                print(f"      Tokopedia playwright: {len(rows)} products")
                return rows, ""
            print(f"      Tokopedia playwright: 0 products — selectors may need update or page blocked")
        else:
            ecode = r.json().get("error",{}).get("message","")
            if "no-credit" in ecode.lower() or "insufficient" in ecode.lower():
                return [], "TOKOPEDIA FAIL: Insufficient Apify credits — top up at console.apify.com"
            print(f"      Tokopedia playwright HTTP {r.status_code}")
    except requests.Timeout:
        return [], "TOKOPEDIA FAIL: Playwright timed out (120s) — try again or reduce request scope"
    except Exception as e:
        return [], f"TOKOPEDIA FAIL: {str(e)[:150]}"

    return [], "TOKOPEDIA FAIL: All 3 strategies exhausted — ACE API returned empty, shahidirfan not rented, playwright returned 0 products. Try again in a few minutes (possible rate limit)."


def _alfamart(pid: str, brand: str, apify_token: str) -> tuple[list, str]:
    """
    Alfamart — Strategy:
    1. alfagift.id mobile app API (fastest, no proxy)
    2. Direct search scrape via cheerio-scraper (no JS needed for initial HTML)
    3. Clear failure message if both fail
    """
    import urllib.parse
    brand_words = brand.lower().split()
    tok  = (apify_token or APIFY_TOKEN).strip()
    hdrs = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
    rows = []

    # ── Attempt 1: alfagift.id API (mobile app endpoint) ─────────────────
    for api_url in [
        f"https://api.alfagift.id/v2/products/search?query={urllib.parse.quote(brand)}&page=1&limit=25",
        f"https://api.alfagift.id/api/v1/product/search?q={urllib.parse.quote(brand)}&limit=25",
        f"https://api.alfagift.id/api/v2/product/search?keyword={urllib.parse.quote(brand)}&page=1",
    ]:
        try:
            r = _cffi_get(api_url, verify=False,
                extra_headers={"User-Agent":"AlfaGift/4.0 (Android; API 31)","Accept":"application/json"})
            if r:
                data = r.json()
                items = (data.get("data",{}).get("items") or data.get("items") or
                         data.get("data",{}).get("products") or data.get("products") or
                         data.get("data") if isinstance(data.get("data"), list) else [])
                for p in (items or [])[:25]:
                    name = str(p.get("name","") or p.get("product_name","") or p.get("productName","")).strip()[:255]
                    if not name or not any(w in name.lower() for w in brand_words): continue
                    cur = _parse_idr(p.get("price",0) or p.get("selling_price",0) or p.get("normalPrice",0))
                    rows.append(_ecom_row(pid, brand, "Alfamart", name, cur,
                        url=p.get("url","") or p.get("product_url",""),
                        img=p.get("image","") or p.get("imageUrl","") or p.get("thumbnail","")))
                if rows:
                    print(f"      Alfamart API: {len(rows)} products ({api_url.split('?')[0].split('/')[-2]})")
                    return rows, ""
        except Exception as e:
            continue  # Try next URL

    print(f"      Alfamart direct API: 0 products — trying Apify scraper")

    # ── Attempt 2: Apify playwright (datacenter proxy, no residential needed) ──
    try:
        q = urllib.parse.quote(brand)
        r = requests.post(
            "https://api.apify.com/v2/acts/apify~playwright-scraper/runs?waitForFinish=120",
            headers=hdrs, json={
                "startUrls":[{"url":f"https://www.alfagift.id/search?q={q}"}],
                "pageFunction":"""async function pageFunction(c){
const{page}=c;
await page.waitForTimeout(6000);
// Try JSON-LD first (most reliable)
const jld = await page.evaluate(()=>{
  const scripts=[...document.querySelectorAll('script[type="application/ld+json"]')];
  const out=[];
  for(const s of scripts){try{const d=JSON.parse(s.textContent);const items=d.itemListElement||[];items.forEach(i=>{if(i.item?.name||i.name)out.push({name:i.item?.name||i.name,price:String(i.item?.offers?.price||i.offers?.price||0),url:i.item?.url||i.url||''})});}catch(e){}}
  return out;
});
if(jld.length) return jld;
// Fallback: DOM selectors
return await page.evaluate(()=>{
  const out=[];
  const sels=['[data-testid="product-card"]','[class*="ProductCard"]','[class*="product-card"]','[class*="product_card"]','.product-item','[class*="item-product"]'];
  for(const sel of sels){
    document.querySelectorAll(sel).forEach((el,i)=>{
      if(i>=25)return;
      const n=(el.querySelector('[class*="product-name"],[class*="productName"],[class*="name"],h3,h4')?.innerText||'').trim();
      const p=(el.querySelector('[class*="price"],[class*="Price"]')?.innerText||'').replace(/[^0-9,.]/g,'');
      const img=el.querySelector('img')?.src||'';
      const url=el.querySelector('a')?.href||'';
      if(n&&p)out.push({name:n,price:p,image_url:img,product_url:url});
    });
    if(out.length)break;
  }
  return out;
});
}""",
                "maxPagesPerCrawl":1,
                "proxyConfiguration":{"useApifyProxy":True},
                "launchContext":{"launchOptions":{"headless":True},"stealth":True},
            }, timeout=140
        )
        if r.ok:
            ds = r.json()["data"]["defaultDatasetId"]
            items = requests.get(f"https://api.apify.com/v2/datasets/{ds}/items", headers=hdrs, timeout=20).json()
            for item in (items or []):
                prods = item if isinstance(item, list) else ([item] if item.get("name") else [])
                for p in prods:
                    name = str(p.get("name","")).strip()[:255]
                    if not name or not any(w in name.lower() for w in brand_words): continue
                    cur = _parse_idr(p.get("price",0))
                    if cur < 100: continue  # price parse failed
                    rows.append(_ecom_row(pid, brand, "Alfamart", name, cur,
                        url=p.get("product_url",""), img=p.get("image_url","")))
            if rows:
                print(f"      Alfamart playwright: {len(rows)} products")
                return rows, ""
            status = r.json().get("data",{}).get("status","")
            return [], f"ALFAMART FAIL: Playwright ran (status={status}) but 0 products matched '{brand}'. alfagift.id may have updated their page structure."
        else:
            err = r.json().get("error",{}).get("message","")
            if "no-credit" in err.lower(): return [], "ALFAMART FAIL: Insufficient Apify credits"
            return [], f"ALFAMART FAIL: Playwright HTTP {r.status_code}"
    except requests.Timeout:
        return [], "ALFAMART FAIL: Playwright timed out (120s)"
    except Exception as e:
        return [], f"ALFAMART FAIL: {str(e)[:150]}"


def _indomaret(pid: str, brand: str, apify_token: str) -> tuple[list, str]:
    """
    Indomaret — Strategy:
    1. klikindomaret.com AJAX endpoint (direct, no proxy)
    2. Playwright fallback
    """
    import urllib.parse
    brand_words = brand.lower().split()
    tok  = (apify_token or APIFY_TOKEN).strip()
    hdrs = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
    rows = []

    # ── Attempt 1: KlikIndomaret AJAX product list ────────────────────────
    for attempt_url, attempt_params in [
        ("https://www.klikindomaret.com/product/getlist",
         {"keyword": brand, "currentPage": 1, "sortir": "def", "totalItem": 25}),
        ("https://www.klikindomaret.com/api/product/search",
         {"query": brand, "page": 1, "limit": 25}),
    ]:
        try:
            r = _cffi_get(attempt_url, params=attempt_params,
                extra_headers={"X-Requested-With":"XMLHttpRequest","Referer":"https://www.klikindomaret.com/"})
            if r:
                data = r.json() if r.headers.get("content-type","").startswith("application/json") else {}
                items = data.get("Data") or data.get("items") or data.get("products") or []
                for p in items[:25]:
                    name = str(p.get("Name","") or p.get("ProductName","") or p.get("name","")).strip()[:255]
                    if not name or not any(w in name.lower() for w in brand_words): continue
                    cur = _parse_idr(p.get("Price",0) or p.get("price",0) or p.get("HargaNormal",0))
                    rows.append(_ecom_row(pid, brand, "Indomaret", name, cur,
                        url=p.get("Url","") or p.get("url",""),
                        img=p.get("Image","") or p.get("image","")))
                if rows:
                    print(f"      Indomaret AJAX: {len(rows)} products")
                    return rows, ""
        except Exception:
            continue

    print(f"      Indomaret AJAX: 0 products — trying Apify scraper")

    # ── Attempt 2: Playwright scraper ─────────────────────────────────────
    try:
        q = urllib.parse.quote(brand)
        r = requests.post(
            "https://api.apify.com/v2/acts/apify~playwright-scraper/runs?waitForFinish=120",
            headers=hdrs, json={
                "startUrls":[{"url":f"https://www.klikindomaret.com/search?keyword={q}"}],
                "pageFunction":"""async function pageFunction(c){
const{page}=c;
await page.waitForTimeout(6000);
return await page.evaluate(()=>{
  const out=[];
  const sels=['[class*="product-card"]','[class*="ProductCard"]','[class*="prd-"]','.product-item','[class*="item-wrap"]'];
  for(const sel of sels){
    document.querySelectorAll(sel).forEach((el,i)=>{
      if(i>=25)return;
      const n=(el.querySelector('[class*="product-name"],[class*="productName"],h3,h4,[class*="name"]')?.innerText||'').trim();
      const p=(el.querySelector('[class*="price"],[class*="Price"],[class*="harga"]')?.innerText||'').replace(/[^0-9,.]/g,'');
      const img=el.querySelector('img')?.src||'';
      if(n&&p)out.push({name:n,price:p,image_url:img});
    });
    if(out.length)break;
  }
  return out;
});
}""",
                "maxPagesPerCrawl":1,
                "proxyConfiguration":{"useApifyProxy":True},
                "launchContext":{"launchOptions":{"headless":True},"stealth":True},
            }, timeout=140
        )
        if r.ok:
            ds = r.json()["data"]["defaultDatasetId"]
            items = requests.get(f"https://api.apify.com/v2/datasets/{ds}/items", headers=hdrs, timeout=20).json()
            for item in (items or []):
                prods = item if isinstance(item, list) else ([item] if item.get("name") else [])
                for p in prods:
                    name = str(p.get("name","")).strip()[:255]
                    if not name or not any(w in name.lower() for w in brand_words): continue
                    cur = _parse_idr(p.get("price",0))
                    if cur < 100: continue
                    rows.append(_ecom_row(pid, brand, "Indomaret", name, cur, img=p.get("image_url","")))
            if rows:
                print(f"      Indomaret playwright: {len(rows)} products")
                return rows, ""
            return [], "INDOMARET FAIL: 0 products — KlikIndomaret AJAX empty and playwright returned 0. Check Railway logs for page structure changes."
        else:
            err = r.json().get("error",{}).get("message","")
            if "no-credit" in err.lower(): return [], "INDOMARET FAIL: Insufficient Apify credits"
            return [], f"INDOMARET FAIL: Playwright HTTP {r.status_code}"
    except requests.Timeout:
        return [], "INDOMARET FAIL: Playwright timed out (120s)"
    except Exception as e:
        return [], f"INDOMARET FAIL: {str(e)[:150]}"


def _tiktok_shop(pid: str, brand: str, apify_token: str) -> tuple[list, str]:
    """
    TikTok Shop — Strategy:
    1. TikTok Shop public search page via playwright + Chrome stealth
    2. Try alternate URL patterns
    """
    import urllib.parse
    brand_words = brand.lower().split()
    tok  = (apify_token or APIFY_TOKEN).strip()
    hdrs = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
    rows = []

    pf_template = """async function pageFunction(c){
const{page}=c;
await page.waitForTimeout(10000);
return await page.evaluate(()=>{
  const out=[];
  const sels=[
    '[data-e2e="search_top_product"]',
    '[class*="search-product"]',
    '[class*="ProductCard"]',
    '[class*="product-card"]',
    '[class*="ShopCard"]',
    '[class*="goods-card"]',
  ];
  for(const sel of sels){
    document.querySelectorAll(sel).forEach((el,i)=>{
      if(i>=20)return;
      const name_el=el.querySelector('[class*="title"],[class*="name"],[class*="product-title"],h3,span[title]');
      const n=(name_el?.innerText||name_el?.title||'').trim();
      const price_el=el.querySelector('[class*="price"],[class*="Price"]');
      const p=(price_el?.innerText||'').replace(/[^0-9,.]/g,'');
      const url=el.querySelector('a')?.href||'';
      if(n&&p)out.push({name:n,price:p,url:url});
    });
    if(out.length)break;
  }
  return out;
});
}"""

    for search_url in [
        f"https://www.tiktok.com/search?q={urllib.parse.quote(brand)}&type=product",
        f"https://shop.tiktok.com/search?q={urllib.parse.quote(brand)}",
    ]:
        try:
            r = requests.post(
                "https://api.apify.com/v2/acts/apify~playwright-scraper/runs?waitForFinish=150",
                headers=hdrs, json={
                    "startUrls":[{"url": search_url}],
                    "pageFunction": pf_template,
                    "maxPagesPerCrawl":1,
                    "proxyConfiguration":{"useApifyProxy":True, "apifyProxyGroups":["RESIDENTIAL"], "apifyProxyCountry":"ID"},
                    "launchContext":{"launchOptions":{"headless":True},"stealth":True,"useChrome":True},
                }, timeout=170
            )
            if not r.ok:
                err = r.json().get("error",{})
                if "no-credit" in str(err.get("message","")).lower():
                    return [], "TIKTOK SHOP FAIL: Insufficient Apify credits (residential proxy required)"
                if "not-rented" in str(err.get("type","")).lower():
                    return [], "TIKTOK SHOP FAIL: Playwright actor not available on your Apify plan"
                continue
            ds = r.json()["data"]["defaultDatasetId"]
            items = requests.get(f"https://api.apify.com/v2/datasets/{ds}/items", headers=hdrs, timeout=20).json()
            for item in (items or []):
                prods = item if isinstance(item, list) else ([item] if item.get("name") else [])
                for p in prods:
                    name = str(p.get("name","")).strip()[:255]
                    if not name or not any(w in name.lower() for w in brand_words): continue
                    cur = _parse_idr(p.get("price",0))
                    if cur < 100: continue
                    rows.append(_ecom_row(pid, brand, "TikTok Shop", name, cur, url=p.get("url","")))
            if rows:
                print(f"      TikTok Shop playwright: {len(rows)} products ({search_url[:40]})")
                return rows, ""
            print(f"      TikTok Shop {search_url[:40]}: 0 products after filter")
        except requests.Timeout:
            print(f"      TikTok Shop timeout on {search_url[:40]}")
            continue
        except Exception as e:
            print(f"      TikTok Shop error: {e}"); continue

    return [], ("TIKTOK SHOP FAIL: 0 brand-matching products found. "
                "TikTok Shop search pages change frequently. "
                "Possible causes: page structure changed (selector update needed), "
                "residential proxy blocked (check Apify plan), "
                "or brand has no TikTok Shop listings.")


def _grabmart(pid: str, brand: str, apify_token: str) -> tuple[list, str]:
    """
    GrabMart — Public product search via GrabFood API.
    Note: GrabMart uses city-based pricing. Results are Jakarta (city_id=2).
    """
    import urllib.parse
    brand_words = brand.lower().split()
    rows = []
    try:
        r = requests.get(
            "https://portal.grab.com/foodweb/v2/search",
            params={"latlng": "-6.2088,106.8456", "keyword": brand,
                    "offset": 0, "limit": 25, "countryCode": "ID"},
            headers={
                "User-Agent": "Mozilla/5.0 GrabWebApp",
                "Accept": "application/json",
                "X-GrabBoot": "web",
            }, timeout=15
        )
        if r.ok:
            data = r.json()
            products = data.get("searchResult",{}).get("products",[]) or []
            for p in products:
                name = str(p.get("name","")).strip()[:255]
                if not name or not any(w in name.lower() for w in brand_words): continue
                cur = _parse_idr(p.get("price",0) or p.get("priceInLocal",0))
                rows.append(_ecom_row(pid, brand, "GrabMart", name, cur,
                    url=p.get("deeplink",""), img=p.get("imgUrl","")))
        if rows: return rows, ""
        return [], "GRABMART: 0 products (GrabMart API requires city-specific pricing; results vary by location)"
    except Exception as e:
        return [], f"GRABMART FAIL: {str(e)[:150]}"


def _gomart(pid: str, brand: str, apify_token: str) -> tuple[list, str]:
    """
    GoMart / GoFood — Public product search.
    Note: Results are Jakarta-based.
    """
    import urllib.parse
    brand_words = brand.lower().split()
    rows = []
    try:
        r = requests.get(
            "https://gofood.co.id/api/outlets/search",
            params={"query": brand, "latitude": -6.2088, "longitude": 106.8456, "serviceType": "MART"},
            headers={
                "User-Agent": "Mozilla/5.0",
                "Accept": "application/json",
                "X-Client-Version": "web",
            }, timeout=15
        )
        if r.ok:
            data = r.json()
            items = data.get("data",{}).get("products",[]) or data.get("products",[]) or []
            for p in items:
                name = str(p.get("name","")).strip()[:255]
                if not name or not any(w in name.lower() for w in brand_words): continue
                cur = _parse_idr(p.get("price",0))
                rows.append(_ecom_row(pid, brand, "GoMart", name, cur, img=p.get("imageURL","")))
        if rows: return rows, ""
        return [], "GOMART: 0 products (GoMart/Gofood API endpoints change frequently)"
    except Exception as e:
        return [], f"GOMART FAIL: {str(e)[:150]}"


def _fetch_ecommerce(pid: str, brand: str, apify_token: str) -> tuple[int, dict]:
    """
    Orchestrate all five retailers. Each runs independently — one failure never blocks others.
    Shopee + Alfamart + Indomaret use direct API calls through the Apify residential proxy.
    Tokopedia + TikTok Shop use Apify playwright with residential proxy.
    All prices stored as clean IDR floats; currency column hardcoded to 'IDR'.
    """
    print(f"   🛒 E-Commerce sweep: {brand}")
    all_rows = []; errors = {}
    tasks = [
        ("Shopee",      lambda: _shopee(pid, brand, apify_token)),
        ("Tokopedia",   lambda: _tokopedia(pid, brand, apify_token)),
        ("Alfamart",    lambda: _alfamart(pid, brand, apify_token)),
        ("Indomaret",   lambda: _indomaret(pid, brand, apify_token)),
        ("TikTok Shop", lambda: _tiktok_shop(pid, brand, apify_token)),
    ]
    for platform, fn in tasks:
        rows, err = fn()
        if rows:
            all_rows.extend(rows); print(f"   ✅ {platform}: {len(rows)} products")
        else:
            errors[platform] = err or "No products returned"
            print(f"   ⚠️  {platform}: {errors[platform][:80]}")
    if all_rows:
        supabase.table("ecommerce_products").upsert(
            all_rows, on_conflict="project_id,competitor_name,product_name"
        ).execute()
        print(f"   ✅ Saved {len(all_rows)} IDR products across {len(tasks)-len(errors)} retailers")
    if errors:
        try:
            supabase.table("ecommerce_scrape_log").upsert({
                "project_id": pid, "brand_name": brand,
                "scraped_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "failures": json.dumps(errors), "total_saved": len(all_rows),
            }, on_conflict="project_id,brand_name").execute()
        except Exception:
            pass
    return len(all_rows), errors



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


def _date_fetch_limit(limit: int, has_range: bool) -> int:
    """
    How many newest posts to pull when a date window is set. The actors return
    newest-first with NO "before this date" cutoff (Apify/Instagram limitation),
    so we over-fetch a MODERATE amount to give the date filter room without
    scraping deep history. For an end date far in the past this may under-deliver
    — that's an inherent Apify limit, raise the cap if you accept the credit cost.
    """
    return min(limit * 2 + 10, 80) if has_range else limit


def _call_ig_profile(url: str, fmt: str, limit: int, apikey: str,
                     date_from: str = "", date_to: str = "") -> list:
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
    fetch_limit = _date_fetch_limit(limit, has_range)  # over-fetch to reach the date window

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
        return filtered[:limit]

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
        return date_filtered[:limit]


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
    # Extract kol from kol_username or fall back to parsing the target_url
    # (original tab_extract.py stored "" when the user pasted a URL, not a @handle)
    _raw_kol = str(job.get("kol_username") or "").strip()
    if _raw_kol and _raw_kol.lower() not in ("unknown","none","nan",""):
        kol = _raw_kol.lstrip("@")
    else:
        import re as _re2
        _url = str(job.get("target_url",""))
        _m = _re2.search(r"instagram\.com/([^/?#]+)/?$", _url.rstrip("/") + "/")
        if _m and _m.group(1) not in ("p","reel","stories","explore","reels","tv"):
            kol = _m.group(1)
        else:
            _m2 = _re2.search(r"tiktok\.com/@([^/?#]+)", _url)
            kol = _m2.group(1) if _m2 else (_url.lstrip("@").split("/")[-1].strip("/") or "unknown")
    apikey = job.get("apify_api_key") or APIFY_TOKEN
    is_ig  = plat == "Instagram"
    is_tt  = plat == "TikTok"
    actors = IG if is_ig else TT

    if target and not target.startswith("http") and jtype not in ("Competitor Ads (Meta)", "YouTube Intelligence", "E-Commerce Intelligence", "Trend Discovery (Hashtag)"):
        c = target.replace("@","").strip()
        target = f"https://www.instagram.com/{c}/" if is_ig else f"https://www.tiktok.com/@{c}"

    print(f"\n{'='*48}\n🔄 {jid} | {plat} | {jtype}\n   Target: {target}")

    try:
        if jtype == "Trend Discovery (Hashtag)":
            tags = [h.replace("#","").strip() for h in target.split(",") if h.strip()]
            if is_ig:
                data = call_apify(actors["hashtag"],{"hashtags":tags,"resultsLimit":limit},apikey)
                payload = [{"project_id":pid,"platform":plat,"search_target":target,
                            "video_url":d.get("url"),"username":d.get("ownerUsername"),
                            "caption":d.get("caption",""),"play_count":int(d.get("videoPlayCount") or d.get("videoViewCount") or d.get("viewCount") or d.get("playCount") or 0),
                            "likes":d.get("likesCount",0),"comments":d.get("commentsCount",0),
                            "shares":d.get("sharesCount",0),"video_duration":int(d.get("videoDuration",0)),
                            "audio_track":(d.get("audioTrack") or {}).get("name","Original Audio"),
                            "content_type":d.get("type","Video")} for d in data if d.get("url")]
            else:
                data = call_apify(actors["hashtag"],{"hashtags":tags,"resultsPerPage":limit},apikey)
                payload = [{"project_id":pid,"platform":plat,"search_target":target,
                            "video_url":d.get("webVideoUrl") or d.get("videoUrl"),
                            "username":(d.get("authorMeta") or {}).get("name"),
                            "caption":d.get("text",""),"play_count":int(d.get("playCount") or d.get("videoPlayCount") or d.get("videoViewCount") or 0),
                            "likes":d.get("diggCount",0),"comments":d.get("commentCount",0),
                            "shares":d.get("shareCount",0),"video_duration":int((d.get("videoMeta") or {}).get("duration") or 0),
                            "audio_track":(d.get("musicMeta") or {}).get("musicName","Original Audio"),
                            "content_type":"Video"} for d in data if d.get("webVideoUrl") or d.get("videoUrl")]
            db.upsert_trend_discovery(supabase, payload)

        elif jtype == "Trend Discovery (User Profile)":
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
            if is_ig:
                data = call_apify(actors["video_stats"],{"directUrls":[target],"resultsType":"details"},apikey)
                payload = [{"video_url":target,"username":kol,"play_count":int(d.get("playCount") or d.get("videoPlayCount") or d.get("videoViewCount") or 0),
                            "likes":d.get("likesCount",0),"comments":d.get("commentsCount",0),
                            "shares":d.get("sharesCount",0)} for d in data]
            else:
                data = call_apify(actors["video_stats"],{"postURLs":[target],"resultsPerPage":1},apikey)
                payload = [{"video_url":target,"username":kol,"play_count":int(d.get("playCount") or d.get("videoPlayCount") or d.get("videoViewCount") or 0),
                            "likes":d.get("diggCount",0),"comments":d.get("commentCount",0),
                            "shares":d.get("shareCount",0)} for d in data]
            db.upsert_campaign_videos(supabase, plat, payload)

        elif jtype == "Profile Feed (Audit)":
            fmt = job.get("format_filter","All Formats")
            date_from = str(job.get("date_from","") or "").strip()
            date_to   = str(job.get("date_to","") or "").strip()
            if date_from or date_to:
                print(f"   📅 Date range: {date_from or 'start'} → {date_to or 'now'}")

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
                fetch_limit = _date_fetch_limit(limit, has_range)
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
                raw_data = _call_ig_profile(ig_url, fmt, limit, apikey, date_from=date_from, date_to=date_to)
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
                                date_from=date_from, date_to=date_to,
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
            total_saved = 0
            for h in all_handles:
                items = by_handle.get(h, [])[:limit]  # enforce limit per handle
                if is_ig:
                    payload = []
                    for d in items:
                        url = d.get("url","")
                        if not url: continue
                        play_count = int(d.get("videoPlayCount") or d.get("videoViewCount")
                                        or d.get("viewCount") or d.get("playCount") or 0)
                        payload.append({
                            "post_url":     url,
                            "username":     h,      # always use the requested handle
                            "caption":      d.get("caption",""),
                            "play_count":   play_count,
                            "likes":        int(d.get("likesCount",0) or 0),
                            "comments":     int(d.get("commentsCount",0) or 0),
                            "shares":       int(d.get("sharesCount",0) or 0),
                            "post_date":    _post_date(d),
                            "content_type": "Video",
                        })
                else:
                    payload = [{"post_url":d.get("webVideoUrl") or d.get("videoUrl"),
                                "username": h,
                                "caption":d.get("text",""),
                                "play_count":int(d.get("playCount") or d.get("videoPlayCount") or 0),
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
                        if "content_type" in err_str or "post_date" in err_str:
                            print(f"   ⚠️ DB rejected new columns — retrying without post_date/content_type")
                            for row in payload:
                                row.pop("content_type", None)
                                row.pop("post_date", None)
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
            if is_ig:
                data = call_apify(actors["comments"],{"directUrls":[target],"resultsLimit":limit,"includeReplies":False},apikey)[:limit]
                payload = [{"video_url":target,"influencer_username":kol,
                            "commenter_username":d.get("ownerUsername"),"comment_text":d.get("text")} for d in data]
            else:
                data = call_apify(actors["comments"],{"postURLs":[target],"maxItems":limit,"maxComments":limit,"commentsPerPost":limit},apikey)[:limit]
                payload = [{"video_url":target,"influencer_username":kol,
                            "commenter_username":d.get("uniqueId") or d.get("author"),
                            "comment_text":d.get("text")} for d in data]
            db.upsert_comments(supabase, plat, payload)

        elif jtype == "Competitor Ads (Meta)":
            fetch_meta_ads(pid, target)
            
        elif jtype == "YouTube Intelligence":
            fetch_youtube_videos(pid, target)
            
        elif jtype == "E-Commerce Intelligence":
            _fetch_ecommerce(pid, target, apikey)

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

            # Layer 4: E-Commerce (Tokopedia, Shopee, Alfamart, Indomaret, TikTok Shop)
            print("   🛒 Layer 4: E-Commerce")
            _fetch_ecommerce(pid, target, apikey)

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
print("\n🚀 Worker online — polling every 10s")
last_compiled = None

while True:
    try:
        pending = db.get_pending_jobs(supabase, limit=1)
        if pending: process_job(pending[0]); continue
        
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        emails  = db.get_due_scheduled_emails(supabase, now_iso)
        if emails: process_scheduled_email(emails[0]); continue
        
        autos = db.get_due_automations(supabase, now_iso)
        if autos: process_automation(autos[0]); continue
        
        today = datetime.date.today()
        if os.environ.get("LAST_COMPILED_DATE") != today.isoformat():
            compile_daily_snapshots()
            os.environ["LAST_COMPILED_DATE"] = today.isoformat()
            
        time.sleep(10)
    except Exception as e:
        print(f"🚨 Loop Err: {e}"); time.sleep(10)
