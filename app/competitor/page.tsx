"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2, Download, Plus, RefreshCcw, ShoppingCart, Trash2, X,
} from "lucide-react";
import { useProject } from "@/lib/context/ProjectContext";
import { useJobs, type Job, type EcomJobConfig } from "@/lib/hooks/useJobs";
import { ApifyKeyInput } from "@/components/ApifyKeyInput";
import { CatSpinner } from "@/components/CatSpinner";
import { createClient } from "@/lib/supabase/client";

const ACCENT = "#fb923c";

const PLATFORMS = ["Shopee", "Tokopedia"] as const;
type PlatformName = (typeof PLATFORMS)[number];

// Shopee operates in these markets — the actor takes the ISO-2 in its
// 'country' field. Tokopedia is Indonesia-only.
const COUNTRIES: { code: string; label: string }[] = [
  { code: "ID", label: "Indonesia" },
  { code: "MY", label: "Malaysia" },
  { code: "SG", label: "Singapore" },
  { code: "TH", label: "Thailand" },
  { code: "VN", label: "Vietnam" },
  { code: "PH", label: "Philippines" },
  { code: "TW", label: "Taiwan" },
  { code: "BR", label: "Brazil" },
  { code: "MX", label: "Mexico" },
];

const OFFICIAL_FILTERS: { value: EcomJobConfig["official_store_filter"]; label: string; hint: string }[] = [
  { value: "all",                 label: "All sellers",        hint: "Include every seller surfaced by the search." },
  { value: "official_only",       label: "Official store only", hint: "Shop name contains 'Official' or 'Mall' — works for parent-brand stores like Nestlé Indonesia (which sells Nescafe). Brand purity is handled by title-validation upstream." },
  { value: "non_official_only",   label: "Non-official only",  hint: "Exclude any 'Official' / 'Mall' shop — useful for reseller / grey-market pricing." },
  { value: "specific_shops",      label: "Specific shop(s)",   hint: "Target named shops. Case- and accent-insensitive ('nestle' matches 'Nestlé')." },
];

const inputCls =
  "px-3 py-1.5 text-sm rounded-lg bg-input border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent";

const STATUS_PILL: Record<Job["status"], { bg: string; border: string; color: string; label: string }> = {
  COMPLETED:       { bg: "rgba(16,185,129,0.10)",  border: "rgba(16,185,129,0.35)",  color: "#34d399", label: "Completed" },
  AUTO_PROCESSING: { bg: "rgba(167,139,250,0.10)", border: "rgba(167,139,250,0.35)", color: "#a78bfa", label: "Processing" },
  PENDING:         { bg: "rgba(245,158,11,0.10)",  border: "rgba(245,158,11,0.35)",  color: "#fbbf24", label: "Pending" },
  FAILED:          { bg: "rgba(239,68,68,0.10)",   border: "rgba(239,68,68,0.35)",   color: "#f87171", label: "Failed" },
};

// ── Page ────────────────────────────────────────────────────────────────────

export default function CompetitorAnalysisPage() {
  const { activeProjectId, activeProjectName } = useProject();
  const { jobs, isLoading, refetch, createJobs, deleteJobs, retryJob, cancelJob } = useJobs(activeProjectId, { sort: "desc" });

  // Job config state — product-based since 2026-06-26.
  const [platforms,    setPlatforms]    = useState<PlatformName[]>(["Shopee"]);
  const [country,      setCountry]      = useState<string>("ID");
  const [products,     setProducts]     = useState<{ brand: string; flavour: string; volume: string; type: string }[]>([
    { brand: "", flavour: "", volume: "", type: "" },
  ]);
  const [officialMode, setOfficialMode] = useState<EcomJobConfig["official_store_filter"]>("all");
  const [specificShops, setSpecificShops] = useState<string>("");   // comma-separated when officialMode='specific_shops'
  const [maxPerProduct, setMaxPerProduct] = useState(50);
  const [matchMode, setMatchMode] = useState<"strict" | "loose">("strict");
  const [apifyKey,     setApifyKey]     = useState("");

  const [queuing,     setQueuing]     = useState(false);
  const [feedback,    setFeedback]    = useState<{ ok: boolean; text: string } | null>(null);

  // Listings preview state
  const [previewOpen,  setPreviewOpen]  = useState(false);
  const [previewRows,  setPreviewRows]  = useState<ListingPreviewRow[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Export to Excel state
  const [exportBrand,    setExportBrand]    = useState<string>("");   // "" = all brands
  const [exportPlatform, setExportPlatform] = useState<string>("");   // "" = all platforms
  const [exportLatestOnly, setExportLatestOnly] = useState<boolean>(true);   // default ON — avoids legacy contamination
  const [exportShopMode, setExportShopMode] = useState<EcomJobConfig["official_store_filter"]>("all");
  const [exportSpecificShops, setExportSpecificShops] = useState<string>("");
  const [exporting,      setExporting]      = useState(false);
  const [exportMsg,      setExportMsg]      = useState<{ ok: boolean; text: string } | null>(null);

  // Clear-listings state
  const [clearing, setClearing] = useState(false);
  const [clearMsg, setClearMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const ecomJobs = useMemo(() => jobs.filter((j) => j.job_type === "Ecom Listings"), [jobs]);

  // Distinct brand tags present in the project's listings — drives the export
  // filter dropdown. Uses previewRows when loaded, falls back to job configs
  // (both new-shape `products[].brand` and legacy `brand_names[]`).
  const knownBrands = useMemo(() => {
    const set = new Set<string>();
    for (const r of (previewRows ?? [])) if (r.brand_name) set.add(r.brand_name);
    for (const j of ecomJobs) {
      const cfg = j.ecom_config as EcomJobConfig | undefined;
      for (const p of (cfg?.products ?? [])) if (p?.brand) set.add(p.brand);
      for (const b of (cfg?.brand_names ?? [])) if (b) set.add(b);
    }
    return Array.from(set).sort();
  }, [previewRows, ecomJobs]);

  // ── Form helpers ───────────────────────────────────────────────────────────

  function togglePlatform(p: PlatformName) {
    setPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );
  }

  function reset() {
    setPlatforms(["Shopee"]);
    setCountry("ID");
    setProducts([{ brand: "", flavour: "", volume: "", type: "" }]);
    setOfficialMode("all");
    setSpecificShops("");
    setMaxPerProduct(50);
    setMatchMode("strict");
    setApifyKey("");
    setFeedback(null);
  }

  // Tokopedia is Indonesia-only — when the user picks a non-ID country, auto-untoggle it.
  useEffect(() => {
    if (country !== "ID") {
      setPlatforms((prev) => prev.filter((p) => p !== "Tokopedia"));
    }
  }, [country]);

  function updateProduct(i: number, patch: Partial<{ brand: string; flavour: string; volume: string; type: string }>) {
    setProducts((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }
  function addProduct() {
    setProducts((prev) => [...prev, { brand: "", flavour: "", volume: "", type: "" }]);
  }
  function removeProduct(i: number) {
    setProducts((prev) => prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i));
  }

  const cleanProducts = useMemo(
    () => products
      .map((p) => ({
        brand:   p.brand.trim(),
        flavour: p.flavour.trim(),
        volume:  p.volume.trim(),
        type:    p.type.trim(),
      }))
      .filter((p) => p.brand.length > 0),
    [products]
  );

  const validationErrors = useMemo(() => {
    const errs: string[] = [];
    if (!activeProjectId) errs.push("Select a project first.");
    if (platforms.length === 0) errs.push("Pick at least one platform.");
    if (cleanProducts.length === 0)
      errs.push("Add at least one product — fill in a brand (flavour is optional).");
    if (maxPerProduct < 10 || maxPerProduct > 200)
      errs.push("Max listings per product must be between 10 and 200.");
    return errs;
  }, [activeProjectId, platforms, cleanProducts, maxPerProduct]);

  async function queueJob() {
    if (validationErrors.length || !activeProjectId) return;
    setQueuing(true);
    setFeedback(null);
    try {
      const shopList = specificShops.split(",").map((s) => s.trim()).filter(Boolean);
      const config: EcomJobConfig = {
        platforms,
        country,
        products: cleanProducts,
        official_store_filter: officialMode,
        ...(officialMode === "specific_shops" ? { specific_shops: shopList } : {}),
        max_listings_per_product: maxPerProduct,
        match_mode: matchMode,
      };
      // First brand tags the job row for at-a-glance identification in Recent Jobs.
      const tagBrand = cleanProducts[0]?.brand || "competitor-scrape";
      const targetSummary = cleanProducts
        .map((p) => p.flavour ? `${p.brand} ${p.flavour}` : p.brand)
        .join(", ");
      await createJobs([{
        project_id: activeProjectId,
        job_type:   "Ecom Listings",
        platform:   platforms.join("+"),
        target_url: targetSummary,
        kol_username: tagBrand,
        target_limit: maxPerProduct * cleanProducts.length,
        ecom_config:  config,
        ...(apifyKey.trim() ? { apify_api_key: apifyKey.trim() } : {}),
      }]);
      setFeedback({ ok: true, text: `Queued — worker will start within ~3s. Watch the Recent jobs panel below.` });
    } catch (e) {
      setFeedback({ ok: false, text: e instanceof Error ? e.message : "Failed to queue job." });
    } finally {
      setQueuing(false);
    }
  }

  // ── Listings preview ───────────────────────────────────────────────────────

  const loadPreview = useCallback(async () => {
    if (!activeProjectId) return;
    setPreviewLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("ecom_listings")
        .select("listing_id, platform, brand_name, shop_name, is_official_store, title, listing_price_idr, sold_count, rating, url, scraped_at, raw_payload")
        .eq("project_id", activeProjectId)
        .order("scraped_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      setPreviewRows((data ?? []) as ListingPreviewRow[]);
    } catch (e) {
      console.error("ecom_listings preview failed:", e);
      setPreviewRows([]);
    } finally {
      setPreviewLoading(false);
    }
  }, [activeProjectId]);

  // "View raw" modal — lets the user inspect what the actor actually returned
  // for any listing (so we can diagnose missing sold_count / etc. without
  // round-tripping through Supabase SQL editor).
  const [rawViewer, setRawViewer] = useState<ListingPreviewRow | null>(null);

  useEffect(() => {
    if (previewOpen) loadPreview();
  }, [previewOpen, loadPreview]);

  // ── Real-time listings subscription ────────────────────────────────────────
  // Pushes new ecom_listings rows into the preview as the worker writes them,
  // so the user doesn't have to refresh manually. Requires the table to be
  // added to the supabase_realtime publication (see sql/ecom_listings.sql).
  useEffect(() => {
    if (!activeProjectId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`ecom-listings:${activeProjectId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "ecom_listings",
          filter: `project_id=eq.${activeProjectId}`,
        },
        (payload) => {
          const r = payload.new as ListingPreviewRow;
          setPreviewRows((prev) => {
            // Cap at 50 like loadPreview, newest first, dedupe by listing_id.
            const head = [r, ...(prev ?? []).filter((x) => x.listing_id !== r.listing_id)];
            return head.slice(0, 50);
          });
          if (!previewOpen) setPreviewOpen(true);   // pop the preview open on first write
        }
      )
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [activeProjectId, previewOpen]);

  // Auto-open the preview while a job is processing so the user sees rows
  // land in real time without having to click Show.
  const hasActiveJob = useMemo(
    () => ecomJobs.some((j) => j.status === "PENDING" || j.status === "AUTO_PROCESSING"),
    [ecomJobs]
  );
  useEffect(() => {
    if (hasActiveJob && !previewOpen) setPreviewOpen(true);
  }, [hasActiveJob, previewOpen]);

  // ── Clear listings ─────────────────────────────────────────────────────────

  async function clearListings() {
    if (!activeProjectId) return;
    if (!confirm(
      "Delete all ecom_listings rows for this project? " +
      "Scrape jobs in the Recent Jobs panel stay; only the captured rows are wiped. " +
      "Re-run a scrape to repopulate."
    )) return;
    setClearing(true);
    setClearMsg(null);
    try {
      const res = await fetch(`/api/ecom-listings?project_id=${encodeURIComponent(activeProjectId)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
      setClearMsg({ ok: true, text: `Deleted ${(data as { deleted?: number }).deleted ?? 0} listing(s). Refresh the preview to confirm.` });
      setPreviewRows(null);
    } catch (e) {
      setClearMsg({ ok: false, text: e instanceof Error ? e.message : "Failed to clear listings." });
    } finally {
      setClearing(false);
    }
  }

  // ── Export to Excel ─────────────────────────────────────────────────────────

  async function runExport() {
    if (!activeProjectId) return;
    setExporting(true);
    setExportMsg(null);
    try {
      // "Latest job only" pins the export to the most recent completed Ecom
      // Listings job, so legacy contaminated rows from older scrapes don't
      // leak into the workbook.
      const latestJobId = exportLatestOnly
        ? (ecomJobs.find((j) => j.status === "COMPLETED")?.job_id ?? null)
        : null;
      const exportShopList = exportSpecificShops.split(",").map((s) => s.trim()).filter(Boolean);
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint:        "export/ecom",
          project_id:      activeProjectId,
          brand_filter:    exportBrand    || null,
          platform_filter: exportPlatform || null,
          job_id:          latestJobId,
          shop_filter:     exportShopMode,
          specific_shops:  exportShopMode === "specific_shops" ? exportShopList : null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `Export failed (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      const slug = (exportBrand || "all").toLowerCase().replace(/\s+/g, "_");
      a.href = url; a.download = `competitor_analysis_${slug}.xlsx`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportMsg({ ok: true, text: "Downloaded — check your browser's Downloads." });
    } catch (e) {
      setExportMsg({ ok: false, text: e instanceof Error ? e.message : "Export failed." });
    } finally {
      setExporting(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!activeProjectId) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center space-y-3">
        <ShoppingCart className="w-10 h-10 mx-auto text-muted-foreground" />
        <h1 className="text-xl font-semibold text-foreground">Competitor Analysis</h1>
        <p className="text-sm text-muted-foreground">
          Pick a project from the dropdown above to scope your e-commerce scrape.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-12">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <span
            className="inline-flex w-10 h-10 items-center justify-center rounded-xl border"
            style={{ background: `${ACCENT}1a`, borderColor: `${ACCENT}55`, color: ACCENT }}
          >
            <ShoppingCart className="w-5 h-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Competitor Analysis</h1>
            <p className="text-xs text-muted-foreground">
              Project: <span className="text-foreground font-medium">{activeProjectName}</span>
              <span className="mx-2">•</span>
              Phase 1: raw Shopee / Tokopedia listings → <code className="text-foreground">ecom_listings</code>
            </p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Pull competitor product listings from Shopee and / or Tokopedia, then enrich them with
          per-unit price &amp; volume so bundles, pack sizes, and container types are comparable.
          Phase 1 stores raw rows; Bahasa parsing (bundle, volume, container) and cross-listing
          market averages land in Phase 2 / 3.
        </p>
      </div>

      {/* ── Job config form ──────────────────────────────────────────────── */}
      <section className="bg-card border border-border rounded-2xl p-6 space-y-6">
        <h2 className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Configure scrape</h2>

        {/* Country + Platforms */}
        <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-4">
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Country / marketplace</p>
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className={`w-full ${inputCls}`}
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>{c.label} ({c.code})</option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">Passed to the Shopee actor's <code>country</code> field. Tokopedia is Indonesia-only.</p>
          </div>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Platforms</p>
            <div className="flex gap-2">
              {PLATFORMS.map((p) => {
                const active = platforms.includes(p);
                const disabled = p === "Tokopedia" && country !== "ID";
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => !disabled && togglePlatform(p)}
                    disabled={disabled}
                    title={disabled ? "Tokopedia is Indonesia-only — pick country ID" : undefined}
                    className="px-4 py-2 text-sm rounded-xl border transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{
                      background: active ? `${ACCENT}1a` : "transparent",
                      borderColor: active ? `${ACCENT}88` : "var(--border)",
                      color: active ? ACCENT : "var(--foreground)",
                    }}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Products to track ─── brand + flavour pairs.
            Each row drives ONE search per platform (query = "{brand} {flavour}")
            and a strict title-match check at scrape time so we only keep
            listings that actually carry the brand AND the flavour. */}
        <div className="space-y-2">
          <div className="flex items-end justify-between gap-2">
            <div>
              <p className="text-xs text-muted-foreground">Products to track</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Each row → one search per platform with the brand + flavour as the query.
                A listing is only kept if its title contains <em>both</em> the brand and the flavour.
                Leave flavour blank to track the brand overall.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            {/* Header */}
            <div className="grid grid-cols-[1.2fr_1.2fr_0.8fr_0.9fr_auto] gap-2 text-[10px] font-mono uppercase tracking-wider text-muted-foreground px-1">
              <span>Brand</span>
              <span>Flavour <span className="lowercase opacity-60">(optional)</span></span>
              <span>Volume <span className="lowercase opacity-60">(optional)</span></span>
              <span>Type <span className="lowercase opacity-60">(optional)</span></span>
              <span className="w-7"></span>
            </div>
            {products.map((p, i) => (
              <div key={i} className="grid grid-cols-[1.2fr_1.2fr_0.8fr_0.9fr_auto] gap-2 items-center">
                <input
                  type="text"
                  value={p.brand}
                  onChange={(e) => updateProduct(i, { brand: e.target.value })}
                  placeholder="e.g. Nescafe"
                  className={inputCls}
                  list="ecom-brand-suggestions"
                />
                <input
                  type="text"
                  value={p.flavour}
                  onChange={(e) => updateProduct(i, { flavour: e.target.value })}
                  placeholder="e.g. Latte"
                  className={inputCls}
                />
                <input
                  type="text"
                  value={p.volume}
                  onChange={(e) => updateProduct(i, { volume: e.target.value })}
                  placeholder="e.g. 240ml"
                  className={inputCls}
                />
                <input
                  type="text"
                  value={p.type}
                  onChange={(e) => updateProduct(i, { type: e.target.value })}
                  placeholder="e.g. kaleng"
                  className={inputCls}
                  list="ecom-type-suggestions"
                />
                <button
                  type="button"
                  onClick={() => removeProduct(i)}
                  disabled={products.length === 1}
                  className="w-7 h-7 inline-flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-red-400 disabled:opacity-30"
                  aria-label="Remove product"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <datalist id="ecom-brand-suggestions">
              {knownBrands.map((b) => <option key={b} value={b} />)}
              {/* Common Indonesian competitor brands as default suggestions. */}
              {["Nescafe", "Cimory", "Ultra Milk", "Greenfields", "Indomilk", "Diamond", "Oatside",
                "Indomie", "Mie Sedaap", "Pop Mie", "Good Day", "Top Coffee", "Aqua"
              ].map((b) => <option key={`d-${b}`} value={b} />)}
            </datalist>
            <datalist id="ecom-type-suggestions">
              {/* Common Indonesian container types — same vocab the parser
                  recognises in titles, so the user can match easily. */}
              {["kaleng", "kotak", "karton", "dus", "botol", "pouch", "sachet", "renceng"].map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <button
              type="button"
              onClick={addProduct}
              className="inline-flex items-center gap-1.5 text-xs text-primary hover:opacity-80"
            >
              <Plus className="w-3.5 h-3.5" /> Add product
            </button>
            <p className="text-[11px] text-muted-foreground">
              Volume tolerates whitespace — <code>240ml</code> matches both <code>240ml</code> and <code>240 ml</code> in titles.
              Type and flavour are <strong>synonym-aware</strong>:{" "}
              <code>kaleng</code> ↔ <code>can</code> ↔ <code>canned</code>,{" "}
              <code>kotak</code> ↔ <code>box</code> ↔ <code>carton</code>,{" "}
              <code>botol</code> ↔ <code>bottle</code>,{" "}
              <code>coklat</code> ↔ <code>chocolate</code>,{" "}
              <code>susu</code> ↔ <code>milk</code>,{" "}
              <code>kopi</code> ↔ <code>coffee</code>, etc. Accents are stripped — <code>nescafe</code> matches <code>Nescafé</code>.
            </p>
          </div>
        </div>

        {/* Shop filter moved to the Export panel (2026-06-29) — scrape captures
            every title-validated row, you filter by shop at export time without
            re-scraping. Kept officialMode + specificShops state only as
            defaults piped through into the Export panel below. */}
        <div className="rounded-lg border border-border p-3 text-[12px] text-muted-foreground" style={{ background: "var(--input)" }}>
          <strong className="text-foreground">Shop filter moved to the Export panel.</strong>{" "}
          Scraping now captures every listing whose title matches your brand + flavour + volume + type — including
          resellers and parent-brand stores. Choose your shop lens (Official only / Specific shop / etc.) when you
          export. This means one scrape, many filtered views — and you see in the Captured Listings preview exactly
          who's selling what before you commit to a filter.
        </div>

        {/* Match mode + Max per product + Apify */}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Matching strictness</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {([
              { v: "strict" as const, label: "Strict (default)", hint: "Listing's title must contain ALL of brand + flavour + volume + type. Best precision, lower recall — Shopee may simply not have many SKUs matching all 4 fields." },
              { v: "loose"  as const, label: "Loose", hint: "Listing's title needs only brand + flavour. Volume + type still go into the search query but aren't enforced on results. Use when Strict returns too few rows (e.g. spelling variants like 'cappucino' vs 'cappuccino')." },
            ]).map((m) => {
              const active = matchMode === m.v;
              return (
                <button
                  key={m.v}
                  type="button"
                  onClick={() => setMatchMode(m.v)}
                  className="text-left px-3 py-2 rounded-xl border transition-colors"
                  style={{
                    background: active ? `${ACCENT}1a` : "transparent",
                    borderColor: active ? `${ACCENT}88` : "var(--border)",
                  }}
                >
                  <div className="text-sm font-medium" style={{ color: active ? ACCENT : "var(--foreground)" }}>{m.label}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{m.hint}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Max listings per product</p>
            <input
              type="number"
              min={10}
              max={200}
              step={10}
              value={maxPerProduct}
              onChange={(e) => setMaxPerProduct(parseInt(e.target.value || "0", 10))}
              className={`w-full ${inputCls}`}
            />
            <p className="text-[11px] text-muted-foreground">10–200. Hard cap per search. If Shopee simply doesn&apos;t have this many matching SKUs, you get fewer — that&apos;s expected.</p>
          </div>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Apify API key (optional override)</p>
            <ApifyKeyInput value={apifyKey} onChange={setApifyKey} />
          </div>
        </div>

        {/* Errors + actions */}
        {validationErrors.length > 0 && (
          <ul className="text-xs text-red-400 space-y-0.5 list-disc list-inside">
            {validationErrors.map((e) => (<li key={e}>{e}</li>))}
          </ul>
        )}

        {feedback && (
          <div
            className="text-sm px-3 py-2 rounded-lg border"
            style={{
              borderColor: feedback.ok ? "rgba(52,211,153,0.4)" : "rgba(248,113,113,0.4)",
              background:  feedback.ok ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)",
              color:       feedback.ok ? "#34d399" : "#f87171",
            }}
          >
            {feedback.text}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={queueJob}
            disabled={queuing || validationErrors.length > 0}
            className="px-5 py-2 text-sm font-medium rounded-xl text-white disabled:opacity-40 transition-opacity"
            style={{ background: ACCENT }}
          >
            {queuing ? (
              <span className="inline-flex items-center gap-2">
                <CatSpinner size={14} /> Queueing…
              </span>
            ) : (
              "Queue scrape"
            )}
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={queuing}
            className="px-4 py-2 text-sm rounded-xl border border-border text-muted-foreground hover:text-foreground transition-colors"
          >
            Reset
          </button>
        </div>
      </section>

      {/* ── Export to Excel ──────────────────────────────────────────────── */}
      <section className="bg-card border border-border rounded-2xl p-6 space-y-4">
        <div>
          <h2 className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Export to Excel</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Compiles captured listings into a workbook ranked by total sold. Inline Bahasa parser fills in
            flavours, total volume, per-unit cost, popularity, and reviews from each listing's title +
            description. Sheets: <span className="text-foreground">Products</span> ·
            <span className="text-foreground"> By Flavour</span> ·
            <span className="text-foreground"> Raw Listings</span> ·
            <span className="text-foreground"> Notes</span>.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <p className="text-[11px] text-muted-foreground">Brand filter</p>
            <select
              value={exportBrand}
              onChange={(e) => setExportBrand(e.target.value)}
              className={`w-full ${inputCls}`}
            >
              <option value="">All brands in this project</option>
              {knownBrands.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <p className="text-[11px] text-muted-foreground">Platform filter</p>
            <select
              value={exportPlatform}
              onChange={(e) => setExportPlatform(e.target.value)}
              className={`w-full ${inputCls}`}
            >
              <option value="">All platforms</option>
              <option value="Shopee">Shopee only</option>
              <option value="Tokopedia">Tokopedia only</option>
            </select>
          </div>
        </div>

        {/* Source toggle — defaults to latest job so legacy data doesn't pollute */}
        <label className="flex items-center gap-2 text-sm cursor-pointer text-foreground">
          <input
            type="checkbox"
            checked={exportLatestOnly}
            onChange={(e) => setExportLatestOnly(e.target.checked)}
            className="accent-primary"
          />
          <span>
            <span className="font-medium">Latest completed job only</span>
            <span className="text-muted-foreground"> — uncheck to include every captured listing across all scrapes</span>
          </span>
        </label>

        {/* Shop filter — applied at export, not at scrape. Flip freely without re-scraping. */}
        <div className="space-y-2 pt-2">
          <p className="text-[11px] text-muted-foreground">Shop filter</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {OFFICIAL_FILTERS.map((f) => {
              const active = exportShopMode === f.value;
              return (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setExportShopMode(f.value)}
                  className="text-left px-3 py-2 rounded-xl border transition-colors"
                  style={{
                    background: active ? `${ACCENT}1a` : "transparent",
                    borderColor: active ? `${ACCENT}88` : "var(--border)",
                  }}
                >
                  <div className="text-sm font-medium" style={{ color: active ? ACCENT : "var(--foreground)" }}>
                    {f.label}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{f.hint}</div>
                </button>
              );
            })}
          </div>
          {exportShopMode === "specific_shops" && (
            <input
              type="text"
              value={exportSpecificShops}
              onChange={(e) => setExportSpecificShops(e.target.value)}
              placeholder="e.g. Nestlé Indonesia, Wings Official, Indomaret Official"
              className={`w-full ${inputCls}`}
            />
          )}

          {/* Tips — when to pick which mode + parent-brand reminder */}
          <details className="rounded-lg border border-border" style={{ background: "var(--input)" }}>
            <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground hover:text-foreground select-none">
              Tips · when and why to use each shop filter
            </summary>
            <div className="px-4 pb-3 pt-1 space-y-2 text-[12px] text-muted-foreground leading-relaxed">
              <p>
                <span className="text-foreground font-medium">All sellers</span> — every captured listing.
                Best for market-wide median pricing including resellers. <strong>Default — change after seeing the Captured Listings preview.</strong>
              </p>
              <p>
                <span className="text-foreground font-medium">Official store only</span> — shops whose name reads
                as <em>Official</em> / <em>Mall</em>. Works automatically for parent-brand stores like
                <em> Nestlé Indonesia Official Store</em> (which sells Nescafe / KitKat / Milo) — title-validation
                upstream already enforced brand purity, so this is just &quot;is the seller a Mall shop?&quot;.
              </p>
              <p>
                <span className="text-foreground font-medium">Non-official only</span> — excludes Mall / Official
                shops. Useful for spotting reseller / grey-market pricing or markup over MSRP.
              </p>
              <p>
                <span className="text-foreground font-medium">Specific shop(s)</span> — comma-separated list, case- AND accent-insensitive.
                Examples for Indonesian FMCG:
              </p>
              <ul className="list-disc list-inside pl-3 space-y-0.5">
                <li><code>Nestlé Indonesia</code> — Nescafe, KitKat, Milo, Bear Brand, Dancow</li>
                <li><code>Wings Official</code> — Top Coffee, Neo Coffee, Mie Sedaap, Floridina</li>
                <li><code>Indofood</code> — Indomie, Pop Mie, Indomilk, Pop Ice</li>
                <li><code>Mayora</code> — Kopiko, Beng-Beng, Le Minerale, Roma</li>
                <li><code>OATSIDE Official</code>, <code>Cimory Official</code> — single-brand companies</li>
              </ul>
              <p>
                Typing <code>nestle indonesia</code> matches <code>Nestlé Indonesia Official Store</code>.
                Each entry&apos;s tokens must ALL appear in the shop name; entries are OR&apos;d.
              </p>
            </div>
          </details>
        </div>

        {exportMsg && (
          <div
            className="text-sm px-3 py-2 rounded-lg border"
            style={{
              borderColor: exportMsg.ok ? "rgba(52,211,153,0.4)" : "rgba(248,113,113,0.4)",
              background:  exportMsg.ok ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)",
              color:       exportMsg.ok ? "#34d399" : "#f87171",
            }}
          >
            {exportMsg.text}
          </div>
        )}

        <button
          type="button"
          onClick={runExport}
          disabled={exporting}
          className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-xl text-white disabled:opacity-40 transition-opacity"
          style={{ background: ACCENT }}
        >
          {exporting ? (<><CatSpinner size={14} /> Building workbook…</>) : (<><Download className="w-4 h-4" /> Export Excel</>)}
        </button>
      </section>

      {/* ── Recent jobs ──────────────────────────────────────────────────── */}
      <section className="bg-card border border-border rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
            Recent Ecom Listings jobs
          </h2>
          <button
            type="button"
            onClick={refetch}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCcw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>

        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground text-sm">
            <CatSpinner size={20} className="mx-auto mb-2" />
            Loading…
          </div>
        ) : ecomJobs.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No Ecom Listings jobs yet for this project. Queue one above.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground uppercase tracking-wider">
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-3">Queued</th>
                  <th className="text-left py-2 pr-3">Brand</th>
                  <th className="text-left py-2 pr-3">Mode</th>
                  <th className="text-left py-2 pr-3">Platforms</th>
                  <th className="text-left py-2 pr-3">Targets</th>
                  <th className="text-left py-2 pr-3">Status</th>
                  <th className="text-right py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {ecomJobs.map((j) => {
                  const pill = STATUS_PILL[j.status];
                  const cfg = (j.ecom_config ?? {}) as EcomJobConfig;
                  // New-shape: list product labels. Legacy: fall back to the
                  // pre-redesign keywords/shop_targets so old jobs still read OK.
                  const targets: string[] = cfg.products?.length
                    ? cfg.products.map((p) => p.flavour ? `${p.brand} ${p.flavour}` : p.brand)
                    : (cfg.search_mode === "shop" ? cfg.shop_targets : cfg.keywords) ?? [];
                  const modeLabel = cfg.products?.length
                    ? `${cfg.products.length} product${cfg.products.length === 1 ? "" : "s"}`
                    : (cfg.search_mode ?? "—");
                  return (
                    <tr key={j.job_id} className="border-b border-border/40">
                      <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">
                        {new Date(j.created_at).toLocaleString("en-SG", {
                          day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                        })}
                      </td>
                      <td className="py-2 pr-3">{j.kol_username || "—"}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{modeLabel}</td>
                      <td className="py-2 pr-3">{j.platform}</td>
                      <td className="py-2 pr-3 max-w-[260px] truncate" title={targets.join(", ")}>
                        {targets.length ? targets.join(", ") : "—"}
                      </td>
                      <td className="py-2 pr-3">
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs border"
                          style={{ background: pill.bg, borderColor: pill.border, color: pill.color }}
                        >
                          {pill.label}
                        </span>
                        {j.error_message && (
                          <div
                            className="text-[11px] mt-1 max-w-[260px] truncate"
                            style={{ color: j.status === "FAILED" ? "rgba(248,113,113,0.85)" : "#fbbf24" }}
                            title={j.error_message}
                          >
                            {j.error_message}
                          </div>
                        )}
                      </td>
                      <td className="py-2 text-right space-x-1">
                        {(j.status === "PENDING" || j.status === "AUTO_PROCESSING") && (
                          <button
                            onClick={() => cancelJob(j.job_id).then(refetch)}
                            className="px-2 py-1 text-xs rounded-md border border-border text-muted-foreground hover:text-yellow-400"
                            title="Mark the job FAILED so the worker skips it. If the worker is mid-actor-call, the cancel is best-effort — restart the Railway worker if it's stuck."
                          >
                            Cancel
                          </button>
                        )}
                        {j.status === "FAILED" && (
                          <button
                            onClick={() => retryJob(j.job_id).then(refetch)}
                            className="px-2 py-1 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground"
                          >
                            Retry
                          </button>
                        )}
                        <button
                          onClick={() => {
                            if (confirm("Delete this job? Listings already written to the DB stay.")) {
                              deleteJobs([j.job_id]);
                            }
                          }}
                          className="px-2 py-1 text-xs rounded-md border border-border text-muted-foreground hover:text-red-400"
                          aria-label="Delete job"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Listings preview ─────────────────────────────────────────────── */}
      <section className="bg-card border border-border rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
            Captured listings (latest 50)
          </h2>
          <div className="flex items-center gap-2">
            {previewOpen && (
              <button
                type="button"
                onClick={loadPreview}
                disabled={previewLoading}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {previewLoading ? <CatSpinner size={12} /> : <RefreshCcw className="w-3.5 h-3.5" />}
                Refresh
              </button>
            )}
            <button
              type="button"
              onClick={clearListings}
              disabled={clearing}
              className="inline-flex items-center gap-1.5 text-xs text-red-400/80 hover:text-red-400 transition-colors"
              title="Delete every ecom_listings row in this project (jobs are kept)"
            >
              {clearing ? <CatSpinner size={12} /> : <Trash2 className="w-3.5 h-3.5" />}
              Clear all
            </button>
            <button
              type="button"
              onClick={() => setPreviewOpen((o) => !o)}
              className="text-xs underline text-muted-foreground hover:text-foreground"
            >
              {previewOpen ? "Hide" : "Show"}
            </button>
          </div>
        </div>

        {clearMsg && (
          <div
            className="text-sm px-3 py-2 rounded-lg border"
            style={{
              borderColor: clearMsg.ok ? "rgba(52,211,153,0.4)" : "rgba(248,113,113,0.4)",
              background:  clearMsg.ok ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)",
              color:       clearMsg.ok ? "#34d399" : "#f87171",
            }}
          >
            {clearMsg.text}
          </div>
        )}

        {previewOpen && (
          previewLoading ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              <CatSpinner size={20} className="mx-auto mb-2" />
              Loading…
            </div>
          ) : !previewRows || previewRows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No listings captured for this project yet. Run a scrape above and wait for it to
              complete, then refresh.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground uppercase tracking-wider">
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-3">Platform</th>
                    <th className="text-left py-2 pr-3">Title</th>
                    <th className="text-left py-2 pr-3">Shop</th>
                    <th className="text-right py-2 pr-3">Price (IDR)</th>
                    <th className="text-right py-2 pr-3">Sold</th>
                    <th className="text-right py-2 pr-3">Rating</th>
                    <th className="text-left py-2 pr-3">Scraped</th>
                    <th className="text-left py-2">Raw</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((r) => (
                    <tr key={r.listing_id} className="border-b border-border/40">
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <span className="text-xs px-1.5 py-0.5 rounded border border-border">{r.platform}</span>
                      </td>
                      <td className="py-2 pr-3 max-w-[360px] truncate" title={r.title}>
                        {r.url ? (
                          <a href={r.url} target="_blank" rel="noreferrer" className="hover:underline">
                            {r.title}
                          </a>
                        ) : (
                          r.title
                        )}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">
                        {r.shop_name ?? "—"}
                        {r.is_official_store ? (
                          <span className="ml-1 inline-flex items-center text-[10px] px-1 py-0.5 rounded" style={{ background: `${ACCENT}1a`, color: ACCENT }}>
                            <CheckCircle2 className="w-3 h-3 mr-0.5" />
                            Official
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        {r.listing_price_idr != null
                          ? new Intl.NumberFormat("id-ID").format(Number(r.listing_price_idr))
                          : "—"}
                      </td>
                      <td className="py-2 pr-3 text-right text-muted-foreground">
                        {r.sold_count != null ? new Intl.NumberFormat("id-ID").format(r.sold_count) : "—"}
                      </td>
                      <td className="py-2 pr-3 text-right text-muted-foreground">
                        {r.rating != null ? Number(r.rating).toFixed(2) : "—"}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">
                        {new Date(r.scraped_at).toLocaleString("en-SG", {
                          day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                        })}
                      </td>
                      <td className="py-2">
                        {r.raw_payload ? (
                          <button
                            type="button"
                            onClick={() => setRawViewer(r)}
                            className="text-[11px] underline text-muted-foreground hover:text-foreground"
                            title="Inspect the actor's raw response for this listing"
                          >
                            view
                          </button>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {!previewOpen && (
          <p className="text-xs text-muted-foreground">
            Listings land in <code className="text-foreground">ecom_listings</code> once a job completes. Click <em>Show</em> to peek.
          </p>
        )}
      </section>

      {/* Raw-payload viewer — opens when the user clicks "view" on a listing row.
          Shows the actor's complete response so you can spot which fields are
          (or aren't) populated. Highlights the sales-related fields explicitly. */}
      {rawViewer && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={() => setRawViewer(null)}
        >
          <div
            className="bg-card border border-border rounded-2xl max-w-3xl w-full max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <div className="min-w-0">
                <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Raw actor response</p>
                <p className="text-sm font-medium text-foreground truncate" title={rawViewer.title}>{rawViewer.title}</p>
              </div>
              <button
                type="button"
                onClick={() => setRawViewer(null)}
                className="text-muted-foreground hover:text-foreground p-1.5"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-3 border-b border-border text-[11px] text-muted-foreground">
              {(() => {
                const rp = (rawViewer.raw_payload ?? {}) as Record<string, unknown>;
                const soldFields = ["historicalSoldEstimated", "historicalSold", "sold", "soldCount", "salesCount", "monthlySold", "totalSold", "lifetimeSold"];
                const reviewFields = ["reviewCount", "numReviews", "rating_count", "ratingCount", "cmt_count"];
                const found = soldFields.filter((k) => rp[k] != null);
                const reviews = reviewFields.filter((k) => rp[k] != null);
                return (
                  <div className="space-y-1">
                    <div><span className="text-foreground">Sales fields present:</span> {found.length ? found.map((k) => `${k}=${JSON.stringify(rp[k])}`).join(", ") : "(none — actor returned no sales estimate)"}</div>
                    <div><span className="text-foreground">Review fields present:</span> {reviews.length ? reviews.map((k) => `${k}=${JSON.stringify(rp[k])}`).join(", ") : "(none)"}</div>
                  </div>
                );
              })()}
            </div>
            <div className="overflow-auto flex-1 px-5 py-4">
              <pre className="text-[11px] leading-relaxed text-foreground/90 whitespace-pre-wrap break-all">
{JSON.stringify(rawViewer.raw_payload, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Types ────────────────────────────────────────────────────────────────────

interface ListingPreviewRow {
  listing_id: string;
  platform: "Shopee" | "Tokopedia";
  brand_name: string | null;
  shop_name: string | null;
  is_official_store: boolean | null;
  title: string;
  listing_price_idr: number | null;
  sold_count: number | null;
  rating: number | null;
  url: string | null;
  scraped_at: string;
  raw_payload?: Record<string, unknown> | null;
}
