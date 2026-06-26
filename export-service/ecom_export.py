"""
ecom_export.py — Build the Excel workbook for the Competitor Analysis exporter.

Layer A: Bahasa Indonesia parser
   - bundle / pack count   (isi N, N pcs, Nx, lusin, ...)
   - unit volume + UOM     (Nml / NL → ml; Ng / Nkg → g)
   - container type        (kaleng / kotak / botol / pouch ...)
   - flavour keywords      (coklat, stroberi, ayam bawang, ...)
   - reviews count         (best-effort from raw_payload across actor field shapes)

Layer B: aggregation
   - Group by brand_name (primary) and by (brand_name × flavour) (secondary)
   - Aggregate: median per-unit cost, sum sold, sum reviews, avg rating,
                typical bundle volume (median unit_volume × median total_units)
   - Sort by total_sold desc — "most popular first"

Layer C: openpyxl workbook
   Sheets:
     "Products"     — one row per brand, flavours collected (the user-spec view)
     "By Flavour"   — one row per (brand × flavour)
     "Raw Listings" — every parsed row for drill-down
     "Notes"        — parsing caveats + column definitions

This file runs entirely in the export-service. Nothing is persisted back to
ecom_listings — the parser runs fresh on every export so we can iterate the
regex without backfill jobs. Phase 2 (persist) can come later.
"""
from __future__ import annotations

import io
import re
import statistics as stats
from collections import defaultdict
from typing import Any

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter


# ═════════════════════════════════════════════════════════════════════════════
# LAYER A — Bahasa parser
# ═════════════════════════════════════════════════════════════════════════════

# Flavour vocabulary. Lowercased exact-substring match against the title; the
# first hit wins so longer / more specific names go first.
FLAVOUR_KEYWORDS: list[str] = [
    # Indomie / instant noodle flavours
    "ayam bawang", "kari ayam", "soto mie", "soto", "mi goreng", "mie goreng",
    "rendang", "kaldu ayam", "cabe ijo", "sambal matah", "salted egg",
    # Sweet / dairy
    "coklat", "cokelat", "chocolate", "vanilla", "vanila", "stroberi", "strawberry",
    "mangga", "mango", "pisang", "banana", "melon", "taro", "matcha",
    "kopi", "coffee", "latte", "cappuccino", "mocca", "mocha",
    # Tea / others
    "teh tarik", "lychee", "leci", "anggur", "jeruk", "lemon",
    # Generic
    "original", "plain", "tawar", "pedas", "manis", "asin", "gurih",
]

# Container terms (lowercased substring match).
CONTAINER_KEYWORDS: dict[str, list[str]] = {
    "can":    ["kaleng", "can "],
    "box":    ["kotak", "karton", "dus", " box"],
    "bottle": ["botol", "bottle"],
    "pouch":  ["pouch", "sachet", "renceng", "saset"],
}

# Volume regexes — capture the number + the (lowercased) unit token.
_VOLUME_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"(\d+(?:[.,]\d+)?)\s*ml\b",        re.I), "ml"),
    (re.compile(r"(\d+(?:[.,]\d+)?)\s*l(?:iter)?\b", re.I), "L"),
    (re.compile(r"(\d+(?:[.,]\d+)?)\s*g(?:r|ram)?\b", re.I), "g"),
    (re.compile(r"(\d+(?:[.,]\d+)?)\s*kg\b",        re.I), "kg"),
]

# Pack-count regexes. Order matters — earlier patterns win.
_PACK_PATTERNS: list[tuple[re.Pattern, str | None]] = [
    (re.compile(r"isi\s*(\d+)",                          re.I), None),
    (re.compile(r"(\d+)\s*(?:pcs|pieces|pack|pak|sachet|saset)\b", re.I), None),
    (re.compile(r"\b(\d+)\s*x\b",                        re.I), None),
    (re.compile(r"\bx\s*(\d+)\b",                        re.I), None),
    (re.compile(r"(\d+)\s*@",                            re.I), None),
    (re.compile(r"\b(\d+)\s*lusin\b",                    re.I), "lusin"),
    (re.compile(r"\b1\s*lusin\b",                        re.I), "single_lusin"),
    (re.compile(r"renceng\s*(\d+)",                      re.I), None),
    (re.compile(r"(\d+)\s*renceng",                      re.I), None),
]


def _norm_num(s: str) -> float:
    """'1.500,5' → 1500.5; '2,5' → 2.5; '1.5' → 1.5. Tolerates Indonesian
    thousands-dot when followed by exactly 3 digits."""
    s = s.strip()
    if "," in s and "." in s:
        # Both — Indonesian convention: dot = thousands, comma = decimal.
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", ".")
    elif "." in s:
        # Single dot — thousands if exactly 3 digits after.
        parts = s.split(".")
        if len(parts) == 2 and len(parts[1]) == 3 and parts[1].isdigit():
            s = s.replace(".", "")
    try:
        return float(s)
    except ValueError:
        return 0.0


def parse_pack_count(text: str) -> tuple[int, str]:
    """Return (total_units, confidence). Default to (1, 'no_signal')."""
    if not text:
        return 1, "no_signal"
    t = text.lower()
    for rx, special in _PACK_PATTERNS:
        m = rx.search(t)
        if m:
            if special == "single_lusin":
                return 12, "lusin"
            n = int(m.group(1))
            if special == "lusin":
                return max(1, n) * 12, "lusin_n"
            if 1 <= n <= 999:
                return n, "explicit"
    return 1, "no_signal"


def parse_unit_volume(text: str) -> tuple[float | None, str | None]:
    """Return (volume, uom_normalised) or (None, None).
    Liquids return ('ml'), solids return ('g'). L → ×1000 → ml; kg → ×1000 → g."""
    if not text:
        return None, None
    t = text.lower()
    for rx, uom_raw in _VOLUME_PATTERNS:
        m = rx.search(t)
        if m:
            val = _norm_num(m.group(1))
            if val <= 0:
                continue
            if uom_raw == "ml":  return val, "ml"
            if uom_raw == "L":   return val * 1000, "ml"
            if uom_raw == "g":   return val, "g"
            if uom_raw == "kg":  return val * 1000, "g"
    return None, None


def parse_container(text: str) -> str:
    if not text:
        return "other"
    t = text.lower()
    for label, terms in CONTAINER_KEYWORDS.items():
        for term in terms:
            if term in t:
                return label
    return "other"


def parse_flavour(text: str) -> str | None:
    if not text:
        return None
    t = text.lower()
    for kw in FLAVOUR_KEYWORDS:
        if kw in t:
            return kw
    return None


def extract_reviews_count(raw_payload: Any) -> int | None:
    """Best-effort reviews count from the actor's raw response. The two actors
    (gio21/shopee, jupri/tokopedia) use different field names; try the common
    keys and fall back to None so the cell shows '—' rather than a wrong value."""
    if not isinstance(raw_payload, dict):
        return None
    for k in (
        "reviewCount", "review_count", "numReviews", "num_reviews",
        "cmt_count", "ratingCount", "rating_count", "rating_star_count",
        "totalRating", "total_rating", "totalReview", "total_review",
    ):
        v = raw_payload.get(k)
        if v is None:
            continue
        try:
            n = int(float(v))
            if n >= 0:
                return n
        except (TypeError, ValueError):
            continue
    return None


def parse_listing(row: dict) -> dict:
    """Decorate a raw ecom_listings row with parsed fields. Doesn't write back
    to the DB — this is the transient enrichment for one export."""
    title = (row.get("title") or "")
    desc  = (row.get("description") or "")
    blob  = f"{title}  |  {desc}"

    units, _bundle_conf = parse_pack_count(blob)
    vol, uom            = parse_unit_volume(blob)
    container           = parse_container(blob)
    flavour             = parse_flavour(blob)
    reviews             = extract_reviews_count(row.get("raw_payload"))

    listing_price = row.get("listing_price_idr")
    try:
        listing_price = float(listing_price) if listing_price is not None else None
    except (TypeError, ValueError):
        listing_price = None
    per_unit = (listing_price / units) if (listing_price and units and units > 0) else None

    total_vol = (vol * units) if (vol is not None and units) else None

    sold = row.get("sold_count")
    try:
        sold = int(sold) if sold is not None else None
    except (TypeError, ValueError):
        sold = None

    rating = row.get("rating")
    try:
        rating = float(rating) if rating is not None else None
    except (TypeError, ValueError):
        rating = None

    return {
        **row,
        "_total_units":       units,
        "_unit_volume":       vol,
        "_unit_volume_uom":   uom,
        "_total_volume":      total_vol,
        "_container":         container,
        "_flavour":           flavour,
        "_per_unit_price":    per_unit,
        "_reviews":           reviews,
        "_sold":              sold,
        "_rating":            rating,
        "_listing_price":     listing_price,
    }


# ═════════════════════════════════════════════════════════════════════════════
# LAYER B — aggregation
# ═════════════════════════════════════════════════════════════════════════════

def _median_or_none(xs: list) -> float | None:
    xs = [x for x in xs if x is not None]
    if not xs:
        return None
    return float(stats.median(xs))


def _mean_or_none(xs: list) -> float | None:
    xs = [x for x in xs if x is not None]
    if not xs:
        return None
    return float(stats.mean(xs))


def _sum_or_none(xs: list) -> int | None:
    xs = [x for x in xs if x is not None]
    if not xs:
        return None
    return int(sum(xs))


def _dominant_uom(rows: list[dict]) -> str | None:
    """Pick the most common volume UOM in a group — needed because you can't
    sum ml and g, so we report the bundle volume in the group's majority UOM
    and exclude the other rows from the volume aggregate."""
    counts: dict[str, int] = defaultdict(int)
    for r in rows:
        u = r.get("_unit_volume_uom")
        if u:
            counts[u] += 1
    if not counts:
        return None
    return max(counts.items(), key=lambda x: x[1])[0]


def aggregate_by_brand(parsed: list[dict]) -> list[dict]:
    groups: dict[str, list[dict]] = defaultdict(list)
    for r in parsed:
        key = (r.get("brand_name") or "(unbranded)").strip() or "(unbranded)"
        groups[key].append(r)

    out: list[dict] = []
    for brand, rows in groups.items():
        flavours = sorted({r["_flavour"] for r in rows if r.get("_flavour")})
        uom      = _dominant_uom(rows)
        vol_rows = [r for r in rows if r.get("_unit_volume_uom") == uom]
        typ_unit_vol = _median_or_none([r["_unit_volume"] for r in vol_rows])
        typ_pack     = _median_or_none([r["_total_units"] for r in rows])
        typ_total_vol = (typ_unit_vol * typ_pack) if (typ_unit_vol and typ_pack) else None

        out.append({
            "product":         brand,
            "flavours":        flavours,
            "n_listings":      len(rows),
            "typical_volume":  typ_total_vol,
            "volume_uom":      uom,
            "per_unit_price":  _median_or_none([r["_per_unit_price"] for r in rows]),
            "avg_rating":      _mean_or_none([r["_rating"] for r in rows]),
            "reviews":         _sum_or_none([r["_reviews"] for r in rows]),
            "total_sold":      _sum_or_none([r["_sold"] for r in rows]),
            "platforms":       sorted({r.get("platform") for r in rows if r.get("platform")}),
        })

    # Sort by total_sold desc — most popular first. Push None to bottom.
    out.sort(key=lambda r: (r["total_sold"] is None, -(r["total_sold"] or 0)))
    return out


def aggregate_by_flavour(parsed: list[dict]) -> list[dict]:
    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for r in parsed:
        brand = (r.get("brand_name") or "(unbranded)").strip() or "(unbranded)"
        fl    = r.get("_flavour") or "(unflavoured)"
        groups[(brand, fl)].append(r)

    out: list[dict] = []
    for (brand, fl), rows in groups.items():
        uom = _dominant_uom(rows)
        vol_rows = [r for r in rows if r.get("_unit_volume_uom") == uom]
        typ_unit_vol = _median_or_none([r["_unit_volume"] for r in vol_rows])
        typ_pack     = _median_or_none([r["_total_units"] for r in rows])
        typ_total_vol = (typ_unit_vol * typ_pack) if (typ_unit_vol and typ_pack) else None

        out.append({
            "product":         brand,
            "flavour":         fl,
            "n_listings":      len(rows),
            "typical_volume":  typ_total_vol,
            "volume_uom":      uom,
            "per_unit_price":  _median_or_none([r["_per_unit_price"] for r in rows]),
            "avg_rating":      _mean_or_none([r["_rating"] for r in rows]),
            "reviews":         _sum_or_none([r["_reviews"] for r in rows]),
            "total_sold":      _sum_or_none([r["_sold"] for r in rows]),
        })
    out.sort(key=lambda r: (r["total_sold"] is None, -(r["total_sold"] or 0)))
    return out


# ═════════════════════════════════════════════════════════════════════════════
# LAYER C — workbook
# ═════════════════════════════════════════════════════════════════════════════

_HEADER_FILL = PatternFill("solid", fgColor="0F1E35")
_HEADER_FONT = Font(name="Calibri", bold=True, color="FFFFFF", size=11)
_HEADER_ALIGN = Alignment(horizontal="left", vertical="center", wrap_text=True)
_BODY_ALIGN   = Alignment(horizontal="left", vertical="top",   wrap_text=True)
_BODY_NUM_ALIGN = Alignment(horizontal="right", vertical="top")


def _fmt_volume(val: float | None, uom: str | None) -> str:
    if val is None or uom is None:
        return "—"
    if uom == "ml" and val >= 1000:
        return f"{val/1000:.2f} L"
    if uom == "g"  and val >= 1000:
        return f"{val/1000:.2f} kg"
    return f"{val:.0f} {uom}"


def _fmt_idr(val: float | None) -> str:
    if val is None:
        return "—"
    return f"Rp {int(round(val)):,}".replace(",", ".")


def _fmt_rating(val: float | None) -> str:
    if val is None:
        return "—"
    return f"{val:.2f}"


def _fmt_int(val: int | None) -> str:
    if val is None:
        return "—"
    return f"{int(val):,}".replace(",", ".")


def _autosize(ws, headers: list[str]) -> None:
    for i, h in enumerate(headers, start=1):
        col = get_column_letter(i)
        ws.column_dimensions[col].width = max(14, min(48, len(h) + 4))


def _write_header(ws, headers: list[str]) -> None:
    for i, h in enumerate(headers, start=1):
        c = ws.cell(row=1, column=i, value=h)
        c.fill  = _HEADER_FILL
        c.font  = _HEADER_FONT
        c.alignment = _HEADER_ALIGN
    ws.row_dimensions[1].height = 28
    ws.freeze_panes = "A2"


def _products_sheet(wb: Workbook, brand_rows: list[dict]) -> None:
    ws = wb.create_sheet("Products")
    headers = [
        "Product", "Flavours", "Total Volume", "Per-Unit Cost (IDR)",
        "Popularity (avg rating)", "Reviews", "Total Sold", "# Listings", "Platforms",
    ]
    _write_header(ws, headers)
    for r in brand_rows:
        ws.append([
            r["product"],
            ", ".join(r["flavours"]) if r["flavours"] else "—",
            _fmt_volume(r["typical_volume"], r["volume_uom"]),
            _fmt_idr(r["per_unit_price"]),
            _fmt_rating(r["avg_rating"]),
            _fmt_int(r["reviews"]),
            _fmt_int(r["total_sold"]),
            r["n_listings"],
            ", ".join(r["platforms"]) if r["platforms"] else "—",
        ])
    for row in ws.iter_rows(min_row=2):
        for c in row:
            c.alignment = _BODY_NUM_ALIGN if isinstance(c.value, (int, float)) else _BODY_ALIGN
    _autosize(ws, headers)


def _by_flavour_sheet(wb: Workbook, flavour_rows: list[dict]) -> None:
    ws = wb.create_sheet("By Flavour")
    headers = [
        "Product", "Flavour", "Total Volume", "Per-Unit Cost (IDR)",
        "Popularity (avg rating)", "Reviews", "Total Sold", "# Listings",
    ]
    _write_header(ws, headers)
    for r in flavour_rows:
        ws.append([
            r["product"], r["flavour"],
            _fmt_volume(r["typical_volume"], r["volume_uom"]),
            _fmt_idr(r["per_unit_price"]),
            _fmt_rating(r["avg_rating"]),
            _fmt_int(r["reviews"]),
            _fmt_int(r["total_sold"]),
            r["n_listings"],
        ])
    for row in ws.iter_rows(min_row=2):
        for c in row:
            c.alignment = _BODY_NUM_ALIGN if isinstance(c.value, (int, float)) else _BODY_ALIGN
    _autosize(ws, headers)


def _raw_sheet(wb: Workbook, parsed: list[dict]) -> None:
    ws = wb.create_sheet("Raw Listings")
    headers = [
        "Platform", "Brand", "Title", "Shop", "Official",
        "Flavour (parsed)", "Container (parsed)", "Total Units (parsed)",
        "Unit Volume (parsed)", "Total Volume (parsed)",
        "Listing Price (IDR)", "Per-Unit Price (IDR)",
        "Rating", "Reviews", "Sold", "URL",
    ]
    _write_header(ws, headers)
    for r in parsed:
        ws.append([
            r.get("platform"),
            r.get("brand_name"),
            r.get("title"),
            r.get("shop_name"),
            "Yes" if r.get("is_official_store") else "No",
            r.get("_flavour") or "—",
            r.get("_container"),
            r.get("_total_units"),
            _fmt_volume(r.get("_unit_volume"), r.get("_unit_volume_uom")),
            _fmt_volume(r.get("_total_volume"), r.get("_unit_volume_uom")),
            _fmt_idr(r.get("_listing_price")),
            _fmt_idr(r.get("_per_unit_price")),
            _fmt_rating(r.get("_rating")),
            _fmt_int(r.get("_reviews")),
            _fmt_int(r.get("_sold")),
            r.get("url"),
        ])
    for row in ws.iter_rows(min_row=2):
        for c in row:
            c.alignment = _BODY_NUM_ALIGN if isinstance(c.value, (int, float)) else _BODY_ALIGN
    _autosize(ws, headers)


def _notes_sheet(wb: Workbook, n_listings: int, brand_filter: str | None) -> None:
    ws = wb.create_sheet("Notes")
    lines = [
        ("Competitor Analysis Export — How to read this file", True),
        ("", False),
        (f"Source: ecom_listings table, {n_listings} listing(s) "
         + (f"filtered to brand '{brand_filter}'." if brand_filter else "across all brands in this project."),
         False),
        ("", False),
        ("Sheets", True),
        ("• Products     — one row per brand. Flavours present in the brand's listings are collected.", False),
        ("• By Flavour   — one row per (brand × parsed flavour) so you can see which flavour is most popular within a brand.", False),
        ("• Raw Listings — every individual scraped listing with the parser's output, for spot-checking.", False),
        ("", False),
        ("Columns", True),
        ("• Total Volume   — typical bundle volume = median unit_volume × median total_units, reported in the group's majority UOM. Bundles in a different UOM are excluded from this aggregate.", False),
        ("• Per-Unit Cost  — median of (listing_price / total_units) across the group. Outlier-robust at small n.", False),
        ("• Popularity     — average star rating across listings.", False),
        ("• Reviews        — best-effort sum from the actor's raw_payload (reviewCount / cmt_count / rating_count). '—' if the actor didn't expose a reviews field.", False),
        ("• Total Sold     — sum of sold_count. Used as the sort key (most popular first).", False),
        ("", False),
        ("Parser caveats", True),
        ("• Bahasa pack-count terms recognised: 'isi N', 'N pcs/pack/sachet', 'Nx', 'xN', '1 lusin' (=12), 'N lusin' (=N×12), 'renceng N'.", False),
        ("• No bundle signal → total_units defaults to 1.", False),
        ("• Volume regex captures: Nml / N L / Ng / N kg. L→×1000 (ml), kg→×1000 (g). Liquid vs solid are never mixed in one aggregate.", False),
        ("• Flavour is a substring match against a curated Indonesian keyword list. Misses non-listed terms — extend FLAVOUR_KEYWORDS in ecom_export.py to add more.", False),
        ("• This export runs the parser FRESH each time. Phase 2 will persist parsed fields back into ecom_listings for faster repeated exports.", False),
    ]
    for i, (text, bold) in enumerate(lines, start=1):
        c = ws.cell(row=i, column=1, value=text)
        if bold:
            c.font = Font(bold=True, size=12)
        c.alignment = Alignment(vertical="top", wrap_text=True)
    ws.column_dimensions["A"].width = 110


def build_ecom_workbook(rows: list[dict], brand_filter: str | None = None) -> io.BytesIO:
    """Top-level entry: parse + aggregate + emit xlsx bytes."""
    parsed = [parse_listing(r) for r in rows]
    brand_rows   = aggregate_by_brand(parsed)
    flavour_rows = aggregate_by_flavour(parsed)

    wb = Workbook()
    wb.remove(wb.active)   # drop the default empty sheet
    _products_sheet(wb,  brand_rows)
    _by_flavour_sheet(wb, flavour_rows)
    _raw_sheet(wb,        parsed)
    _notes_sheet(wb, len(rows), brand_filter)

    buf = io.BytesIO()
    wb.save(buf)
    return buf
