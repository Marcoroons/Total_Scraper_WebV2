"""
worker_ecom_legacy.py — DEAD CODE. Preserved for reference only.

Extracted verbatim (2026-06-26) from worker/worker.py. Was the e-commerce
sweep behind the "E-Commerce Intelligence" and "Competitor Intelligence Scan"
job types. Replaced by the new Phase 1 Competitor Analysis module — see
DEAD_COMPETITOR_ANALYSIS_ENGINE/README.md for the why.

This file is NOT imported anywhere. It is not runnable as-is (depends on
`supabase`, `APIFY_TOKEN`, and a `requests`/`re`/`datetime`/`json` import
chain that the live worker provides). If you want to revive it, paste the
blocks below back into worker.py — see the README for the full revival
checklist.

Original Supabase schema this code writes to:

    CREATE TABLE IF NOT EXISTS ecommerce_products (
        id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        project_id      uuid NOT NULL,
        competitor_name text NOT NULL,
        product_name    text NOT NULL,
        sku             text,
        current_price   numeric(12,2) NOT NULL,
        original_price  numeric(12,2),
        currency        varchar(10) DEFAULT 'IDR',
        stock_status    text DEFAULT 'in_stock',
        product_url     text,
        image_url       text,
        scraped_at      timestamptz DEFAULT now(),
        updated_at      timestamptz DEFAULT now()
    );
    -- plus ecommerce_scrape_log (project_id, brand_name, scraped_at, failures jsonb, total_saved)
"""

# ────────────────────────────────────────────────────────────────────────────
# IMPORTS the live worker provides — listed here so future-you knows what was
# in scope. DO NOT uncomment; this file isn't meant to import-resolve.
# ────────────────────────────────────────────────────────────────────────────
# import os, re, datetime, json, urllib.parse
# import requests
# import urllib3
# urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
# from supabase import Client
# supabase: Client = ...        # live worker created this
# APIFY_TOKEN: str = ...        # live worker read from env

# curl_cffi: Chrome TLS fingerprint impersonation — bypasses Cloudflare on
# Indonesian e-commerce sites (Tokopedia / Alfamart / Indomaret direct APIs).
# Install: pip install curl_cffi==0.15.0
# try:
#     from curl_cffi import requests as cf_requests
#     _CFFI_OK = True
# except ImportError:
#     cf_requests = requests
#     _CFFI_OK = False
#     print("⚠️  curl_cffi not installed — Cloudflare-protected retailers may fail")

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


# ────────────────────────────────────────────────────────────────────────────
# ECOMMERCE SCRAPERS — routed through Apify Indonesian residential proxies
#
# WHY PROXIES ARE REQUIRED:
#   Shopee, Tokopedia, Alfamart, Indomaret all use Cloudflare Bot Management.
#   This blocks all datacenter IP ranges (AWS, GCP, Railway) at the ASN level
#   before any request is parsed — no header tricks can bypass this.
#   Solution: Apify residential proxy pool routes through real Indonesian home
#   IPs that Cloudflare trusts. Same Apify token you already have, extra credits.
# ────────────────────────────────────────────────────────────────────────────

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


def _shopee(pid: str, brand: str, apify_token: str) -> tuple:
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


def _tokopedia(pid: str, brand: str, apify_token: str) -> tuple:
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


def _alfamart(pid: str, brand: str, apify_token: str) -> tuple:
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


def _indomaret(pid: str, brand: str, apify_token: str) -> tuple:
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


def _tiktok_shop(pid: str, brand: str, apify_token: str) -> tuple:
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


def _grabmart(pid: str, brand: str, apify_token: str) -> tuple:
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


def _gomart(pid: str, brand: str, apify_token: str) -> tuple:
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


def _fetch_ecommerce(pid: str, brand: str, apify_token: str) -> tuple:
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


# ────────────────────────────────────────────────────────────────────────────
# Original dispatch wiring in worker.py (preserved here, commented out):
#
#   INTELLIGENCE_JOB_TYPES = {
#       "Competitor Ads (Meta)", "YouTube Intelligence",
#       "E-Commerce Intelligence",         # ← this entry was the trigger
#       "Competitor Intelligence Scan",
#   }
#
#   elif jtype == "E-Commerce Intelligence":
#       _fetch_ecommerce(pid, target, apikey)
#
#   # And as Layer 4 inside the full Competitor Intelligence Scan:
#   print("   🛒 Layer 4: E-Commerce")
#   _fetch_ecommerce(pid, target, apikey)
# ────────────────────────────────────────────────────────────────────────────
