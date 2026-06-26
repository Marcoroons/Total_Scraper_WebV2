"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2, Download, Plus, RefreshCcw, ShoppingCart, Store, Tag, Trash2, X,
} from "lucide-react";
import { useProject } from "@/lib/context/ProjectContext";
import { useJobs, type Job, type EcomJobConfig } from "@/lib/hooks/useJobs";
import { ApifyKeyInput } from "@/components/ApifyKeyInput";
import { CatSpinner } from "@/components/CatSpinner";
import { createClient } from "@/lib/supabase/client";

const ACCENT = "#fb923c";

const PLATFORMS = ["Shopee", "Tokopedia"] as const;
type PlatformName = (typeof PLATFORMS)[number];

const OFFICIAL_FILTERS: { value: EcomJobConfig["official_store_filter"]; label: string; hint: string }[] = [
  { value: "all",                 label: "All sellers",        hint: "Include every seller surfaced by the search." },
  { value: "official_only",       label: "Official store only", hint: "Only Shopee Mall / Tokopedia Official Store listings." },
  { value: "non_official_only",   label: "Non-official only",  hint: "Skip official stores — useful for spotting reseller / grey-market pricing." },
];

const inputCls =
  "px-3 py-1.5 text-sm rounded-lg bg-input border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent";

const STATUS_PILL: Record<Job["status"], { bg: string; border: string; color: string; label: string }> = {
  COMPLETED:       { bg: "rgba(16,185,129,0.10)",  border: "rgba(16,185,129,0.35)",  color: "#34d399", label: "Completed" },
  AUTO_PROCESSING: { bg: "rgba(167,139,250,0.10)", border: "rgba(167,139,250,0.35)", color: "#a78bfa", label: "Processing" },
  PENDING:         { bg: "rgba(245,158,11,0.10)",  border: "rgba(245,158,11,0.35)",  color: "#fbbf24", label: "Pending" },
  FAILED:          { bg: "rgba(239,68,68,0.10)",   border: "rgba(239,68,68,0.35)",   color: "#f87171", label: "Failed" },
};

// ── Tag-list input (used for keywords / shop_targets / brand_names) ─────────

function TagListInput({
  values,
  onChange,
  placeholder,
  accent = ACCENT,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  accent?: string;
}) {
  const [draft, setDraft] = useState("");

  function commitDraft() {
    const cleaned = draft.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    if (cleaned.length === 0) return;
    const next = Array.from(new Set([...values, ...cleaned]));
    onChange(next);
    setDraft("");
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border"
            style={{ borderColor: `${accent}55`, background: `${accent}1a`, color: accent }}
          >
            {v}
            <button
              type="button"
              onClick={() => onChange(values.filter((x) => x !== v))}
              className="hover:opacity-70"
              aria-label={`Remove ${v}`}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        {values.length === 0 && (
          <span className="text-[11px] text-muted-foreground italic">No entries yet</span>
        )}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commitDraft();
            }
          }}
          onBlur={() => draft.trim() && commitDraft()}
          placeholder={placeholder}
          className={`flex-1 ${inputCls}`}
        />
        <button
          type="button"
          onClick={commitDraft}
          disabled={!draft.trim()}
          className="px-3 py-1.5 text-xs rounded-lg border border-border text-foreground hover:bg-input disabled:opacity-30 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function CompetitorAnalysisPage() {
  const { activeProjectId, activeProjectName } = useProject();
  const { jobs, isLoading, refetch, createJobs, deleteJobs, retryJob } = useJobs(activeProjectId, { sort: "desc" });

  // Job config state
  const [platforms,    setPlatforms]    = useState<PlatformName[]>(["Shopee"]);
  const [searchMode,   setSearchMode]   = useState<"keyword" | "shop">("keyword");
  const [keywords,     setKeywords]     = useState<string[]>([]);
  const [shopTargets,  setShopTargets]  = useState<string[]>([]);
  const [brandNames,   setBrandNames]   = useState<string[]>([]);
  const [officialMode, setOfficialMode] = useState<EcomJobConfig["official_store_filter"]>("all");
  const [maxListings,  setMaxListings]  = useState(200);
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
  const [exporting,      setExporting]      = useState(false);
  const [exportMsg,      setExportMsg]      = useState<{ ok: boolean; text: string } | null>(null);

  const ecomJobs = useMemo(() => jobs.filter((j) => j.job_type === "Ecom Listings"), [jobs]);

  // Distinct brand tags present in the project's listings — drives the export
  // filter dropdown. Uses previewRows when loaded, falls back to job configs.
  const knownBrands = useMemo(() => {
    const set = new Set<string>();
    for (const r of (previewRows ?? [])) if (r.brand_name) set.add(r.brand_name);
    for (const j of ecomJobs) {
      const cfg = j.ecom_config as EcomJobConfig | undefined;
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
    setSearchMode("keyword");
    setKeywords([]);
    setShopTargets([]);
    setBrandNames([]);
    setOfficialMode("all");
    setMaxListings(200);
    setApifyKey("");
    setFeedback(null);
  }

  const validationErrors = useMemo(() => {
    const errs: string[] = [];
    if (!activeProjectId) errs.push("Select a project first.");
    if (platforms.length === 0) errs.push("Pick at least one platform.");
    if (searchMode === "keyword" && keywords.length === 0)
      errs.push("Add at least one keyword (e.g. 'coklat', 'susu uht', 'kaleng').");
    if (searchMode === "shop" && shopTargets.length === 0)
      errs.push("Add at least one shop URL or @username to scan.");
    if (brandNames.length === 0)
      errs.push("Add at least one brand name — the first is used to tag the listings.");
    if (maxListings < 10 || maxListings > 1000)
      errs.push("Max listings per platform must be between 10 and 1000.");
    return errs;
  }, [activeProjectId, platforms, searchMode, keywords, shopTargets, brandNames, maxListings]);

  async function queueJob() {
    if (validationErrors.length || !activeProjectId) return;
    setQueuing(true);
    setFeedback(null);
    try {
      const config: EcomJobConfig = {
        platforms,
        search_mode: searchMode,
        keywords: searchMode === "keyword" ? keywords : undefined,
        shop_targets: searchMode === "shop" ? shopTargets : undefined,
        official_store_filter: officialMode,
        brand_names: brandNames,
        max_listings_per_platform: maxListings,
      };
      const tagBrand = brandNames[0] || "competitor-scrape";
      await createJobs([{
        project_id: activeProjectId,
        job_type:   "Ecom Listings",
        platform:   platforms.join("+"),
        target_url: searchMode === "keyword" ? keywords.join(", ") : shopTargets.join(", "),
        kol_username: tagBrand,
        target_limit: maxListings,
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
        .select("listing_id, platform, brand_name, shop_name, is_official_store, title, listing_price_idr, sold_count, rating, url, scraped_at")
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

  useEffect(() => {
    if (previewOpen) loadPreview();
  }, [previewOpen, loadPreview]);

  // ── Export to Excel ─────────────────────────────────────────────────────────

  async function runExport() {
    if (!activeProjectId) return;
    setExporting(true);
    setExportMsg(null);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint:        "export/ecom",
          project_id:      activeProjectId,
          brand_filter:    exportBrand    || null,
          platform_filter: exportPlatform || null,
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

        {/* Platforms */}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Platforms</p>
          <div className="flex gap-2">
            {PLATFORMS.map((p) => {
              const active = platforms.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePlatform(p)}
                  className="px-4 py-2 text-sm rounded-xl border transition-colors"
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

        {/* Search mode */}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Search mode</p>
          <div className="flex gap-2">
            {(["keyword", "shop"] as const).map((m) => {
              const active = searchMode === m;
              const Icon = m === "keyword" ? Tag : Store;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setSearchMode(m)}
                  className="flex items-center gap-2 px-4 py-2 text-sm rounded-xl border transition-colors"
                  style={{
                    background: active ? `${ACCENT}1a` : "transparent",
                    borderColor: active ? `${ACCENT}88` : "var(--border)",
                    color: active ? ACCENT : "var(--foreground)",
                  }}
                >
                  <Icon className="w-4 h-4" />
                  {m === "keyword" ? "Search by keyword" : "Scan specific shops"}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {searchMode === "keyword"
              ? "One search per keyword (e.g. 'coklat', 'kaleng'). Dedupes by product_id across keywords."
              : "Paste shop URLs or @handles — the actor resolves them to a catalog."}
          </p>
        </div>

        {/* Targets */}
        {searchMode === "keyword" ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Keywords</p>
            <TagListInput
              values={keywords}
              onChange={setKeywords}
              placeholder="e.g. coklat, susu uht, kaleng — press Enter or comma"
            />
            <p className="text-[11px] text-muted-foreground">
              Mix flavour terms (<code>coklat</code>, <code>stroberi</code>) with container terms
              (<code>kaleng</code>, <code>kotak</code>) to seed the cross-listing aggregation later.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Shop URLs / usernames</p>
            <TagListInput
              values={shopTargets}
              onChange={setShopTargets}
              placeholder="e.g. https://shopee.co.id/cimoryofficial or @cimoryofficial"
            />
          </div>
        )}

        {/* Brand names */}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Brand names (for tagging)</p>
          <TagListInput
            values={brandNames}
            onChange={setBrandNames}
            placeholder="e.g. Cimory, Ultra Milk, Greenfields — first is used as the row tag"
          />
          <p className="text-[11px] text-muted-foreground">
            The first brand tags every listing this run produces. Future enrichment (Phase 2) will
            attribute listings back to a competitor at aggregation time.
          </p>
        </div>

        {/* Official store filter */}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Official store filter</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {OFFICIAL_FILTERS.map((f) => {
              const active = officialMode === f.value;
              return (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setOfficialMode(f.value)}
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
        </div>

        {/* Max listings + Apify */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Max listings per platform</p>
            <input
              type="number"
              min={10}
              max={1000}
              step={10}
              value={maxListings}
              onChange={(e) => setMaxListings(parseInt(e.target.value || "0", 10))}
              className={`w-full ${inputCls}`}
            />
            <p className="text-[11px] text-muted-foreground">10–1000. Divided across keywords / shops.</p>
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
                  const targets = (cfg.search_mode === "shop" ? cfg.shop_targets : cfg.keywords) ?? [];
                  return (
                    <tr key={j.job_id} className="border-b border-border/40">
                      <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">
                        {new Date(j.created_at).toLocaleString("en-SG", {
                          day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                        })}
                      </td>
                      <td className="py-2 pr-3">{j.kol_username || "—"}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{cfg.search_mode ?? "—"}</td>
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
                        {j.status === "FAILED" && j.error_message && (
                          <div className="text-[11px] text-red-400/80 mt-1 max-w-[260px] truncate" title={j.error_message}>
                            {j.error_message}
                          </div>
                        )}
                      </td>
                      <td className="py-2 text-right space-x-1">
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
              onClick={() => setPreviewOpen((o) => !o)}
              className="text-xs underline text-muted-foreground hover:text-foreground"
            >
              {previewOpen ? "Hide" : "Show"}
            </button>
          </div>
        </div>

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
                    <th className="text-left py-2">Scraped</th>
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
                      <td className="py-2 text-muted-foreground whitespace-nowrap">
                        {new Date(r.scraped_at).toLocaleString("en-SG", {
                          day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                        })}
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
}
