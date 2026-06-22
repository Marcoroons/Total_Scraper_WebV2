"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  Clock,
  FolderOpen,
  Loader2,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useProject } from "@/lib/context/ProjectContext";

// ════════════════════════════════════════════════════════════════════════════
//  Config
// ════════════════════════════════════════════════════════════════════════════

/** Friendly scrape types → the DB job_type values they map to.
 *  Add { key: "comments", label: "Comment Sentiment", jobType: "Comments (Sentiment)", color: "#f472b6" }
 *  here when the user asks for it. */
const SCRAPE_TYPES = [
  { key: "url",     label: "URL Scraper",     jobType: "Specific URLs (Video Stats)", color: "#f59e0b" },
  { key: "profile", label: "Profile Scraper", jobType: "Profile Feed (Audit)",        color: "#a78bfa" },
] as const;

type ScrapeKey = (typeof SCRAPE_TYPES)[number]["key"];

const DEFAULT_TYPES: ScrapeKey[] = ["url", "profile"];

const PLATFORM_COLOR: Record<string, string> = {
  Instagram: "#f472b6",
  TikTok:    "#00c9ff",
};

// ════════════════════════════════════════════════════════════════════════════
//  Types
// ════════════════════════════════════════════════════════════════════════════

interface DashboardJob {
  job_id:       string;
  target_url:   string;
  platform:     string;
  job_type:     string;
  kol_username: string | null;
  status:       "PENDING" | "AUTO_PROCESSING" | "COMPLETED" | "FAILED";
  created_at:   string;
}

interface KPIMetric {
  label:  string;
  value:  string;
  icon:   LucideIcon;
  accent: string;
  trend?: number | null;   // signed %, null = no comparison available
  note:   string;
}

interface KolRow {
  kol:         string;
  platform:    string;
  types:       Set<string>;
  count:       number;
  lastScraped: string;
  lastStatus:  DashboardJob["status"];
}

// ════════════════════════════════════════════════════════════════════════════
//  Date range
// ════════════════════════════════════════════════════════════════════════════

type PresetKey = "7d" | "30d" | "90d" | "ytd" | "custom";

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "7d",     label: "Last 7 days" },
  { key: "30d",    label: "Last 30 days" },
  { key: "90d",    label: "Last 90 days" },
  { key: "ytd",    label: "Year to date" },
  { key: "custom", label: "Custom range" },
];

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Resolve a preset to {from, to} as yyyy-mm-dd local dates. */
function presetRange(key: Exclude<PresetKey, "custom">): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  if (key === "7d")  from.setDate(to.getDate() - 6);
  if (key === "30d") from.setDate(to.getDate() - 29);
  if (key === "90d") from.setDate(to.getDate() - 89);
  if (key === "ytd") { from.setMonth(0); from.setDate(1); }
  return { from: ymd(from), to: ymd(to) };
}

const STATUS_PILL: Record<DashboardJob["status"], { bg: string; border: string; color: string; label: string }> = {
  COMPLETED:       { bg: "rgba(16,185,129,0.1)",  border: "rgba(16,185,129,0.3)",  color: "#34d399", label: "Completed" },
  AUTO_PROCESSING: { bg: "rgba(167,139,250,0.1)", border: "rgba(167,139,250,0.3)", color: "#a78bfa", label: "Processing" },
  PENDING:         { bg: "rgba(245,158,11,0.1)",  border: "rgba(245,158,11,0.3)",  color: "#fbbf24", label: "Pending" },
  FAILED:          { bg: "rgba(239,68,68,0.1)",   border: "rgba(239,68,68,0.3)",   color: "#f87171", label: "Failed" },
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-SG", { day: "2-digit", month: "short", year: "numeric" });
}

// ════════════════════════════════════════════════════════════════════════════
//  Small dropdown shell (outside-click close)
// ════════════════════════════════════════════════════════════════════════════

function Dropdown({
  label, value, icon: Icon, width = 220, children,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  width?: number;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors hover:border-[rgba(0,201,255,0.3)]"
        style={{ background: "#0d1829", borderColor: "rgba(255,255,255,0.08)" }}
      >
        <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#5a7294" }} />
        <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: "#3a4d68" }}>{label}</span>
        <span className="font-medium text-foreground max-w-[180px] truncate">{value}</span>
        <ChevronDown className={["w-3.5 h-3.5 transition-transform", open ? "rotate-180" : ""].join(" ")} style={{ color: "#5a7294" }} />
      </button>
      {open && (
        <div
          className="absolute top-full left-0 mt-2 rounded-xl border shadow-xl z-50 overflow-hidden"
          style={{ background: "#0d1829", borderColor: "rgba(255,255,255,0.1)", width }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  Chart tooltips
// ════════════════════════════════════════════════════════════════════════════

interface TP { value: number; name?: string }

function LineTooltip({ active, payload, label }: { active?: boolean; payload?: TP[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#0d1829", border: "1px solid rgba(0,201,255,0.25)", borderRadius: 8, padding: "8px 12px" }}>
      <p style={{ fontSize: 10, fontFamily: "monospace", color: "#5a7294", marginBottom: 2 }}>{label}</p>
      <p style={{ fontSize: 14, fontWeight: 700, color: "#00c9ff" }}>{payload[0].value} scrapes</p>
    </div>
  );
}

function DonutTooltip({ active, payload }: { active?: boolean; payload?: TP[] }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#0d1829", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "6px 10px" }}>
      <p style={{ fontSize: 12, fontWeight: 600, color: "#dde4f4" }}>{payload[0].name}: {payload[0].value}</p>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  Page
// ════════════════════════════════════════════════════════════════════════════

export default function DashboardPage() {
  const { activeProjectId, activeProjectName, availableProjects, setActiveProject } = useProject();

  const [selectedTypes, setSelectedTypes] = useState<ScrapeKey[]>(DEFAULT_TYPES);
  const [preset, setPreset] = useState<PresetKey>("30d");
  const [custom, setCustom] = useState<{ from: string; to: string }>(presetRange("30d"));

  const [jobs, setJobs]         = useState<DashboardJob[]>([]);
  const [prevTotal, setPrevTotal] = useState(0);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");

  // Resolve the active range (yyyy-mm-dd).
  const range = useMemo(
    () => (preset === "custom" ? custom : presetRange(preset)),
    [preset, custom]
  );

  // Fetch live data whenever a filter changes.
  const load = useCallback(async () => {
    if (!activeProjectId) { setJobs([]); return; }
    const jobTypes = SCRAPE_TYPES.filter((t) => selectedTypes.includes(t.key)).map((t) => t.jobType);
    if (jobTypes.length === 0) { setJobs([]); setPrevTotal(0); return; }

    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        project_id: activeProjectId,
        types: jobTypes.join(","),
        from: `${range.from}T00:00:00.000Z`,
        to:   `${range.to}T23:59:59.999Z`,
      });
      const res = await fetch(`/api/dashboard?${params}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "Failed to load dashboard data."); return; }
      setJobs(data.jobs ?? []);
      setPrevTotal(data.prevTotal ?? 0);
    } catch {
      setError("Network error loading dashboard.");
    } finally {
      setLoading(false);
    }
  }, [activeProjectId, selectedTypes, range]);

  useEffect(() => { load(); }, [load]);

  // ── Derived analytics ──────────────────────────────────────────────────────

  const total     = jobs.length;
  const completed = jobs.filter((j) => j.status === "COMPLETED").length;
  const inQueue   = jobs.filter((j) => j.status === "PENDING" || j.status === "AUTO_PROCESSING").length;

  const kolRows = useMemo<KolRow[]>(() => {
    const map = new Map<string, KolRow>();
    for (const j of jobs) {
      const kol = (j.kol_username?.trim() || j.target_url || "(unknown)").trim();
      const existing = map.get(kol);
      if (existing) {
        existing.count += 1;
        existing.types.add(j.job_type);
        if (j.created_at > existing.lastScraped) {
          existing.lastScraped = j.created_at;
          existing.lastStatus  = j.status;
          existing.platform    = j.platform;
        }
      } else {
        map.set(kol, {
          kol, platform: j.platform, types: new Set([j.job_type]),
          count: 1, lastScraped: j.created_at, lastStatus: j.status,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.lastScraped.localeCompare(a.lastScraped));
  }, [jobs]);

  const uniqueKols = kolRows.length;

  const trend = prevTotal === 0 ? null : ((total - prevTotal) / prevTotal) * 100;

  const kpis: KPIMetric[] = [
    { label: "Total Scrapes", value: String(total),      icon: Activity,     accent: "#00c9ff", trend, note: "vs. previous period" },
    { label: "KOLs Scraped",  value: String(uniqueKols), icon: Users,        accent: "#a78bfa", note: "unique in period" },
    { label: "Completed",     value: String(completed),  icon: CheckCircle2, accent: "#10b981", note: total ? `${Math.round((completed / total) * 100)}% success` : "—" },
    { label: "In Queue",      value: String(inQueue),    icon: Clock,        accent: "#f59e0b", note: "active now" },
  ];

  // Daily buckets across the range (continuous line, zero-filled).
  const trendData = useMemo(() => {
    const start = new Date(`${range.from}T00:00:00`);
    const end   = new Date(`${range.to}T00:00:00`);
    const buckets = new Map<string, number>();
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      buckets.set(ymd(d), 0);
    }
    for (const j of jobs) {
      const key = ymd(new Date(j.created_at));
      if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    return Array.from(buckets.entries()).map(([k, v]) => ({
      label: new Date(`${k}T00:00:00`).toLocaleDateString("en-SG", { day: "2-digit", month: "short" }),
      value: v,
    }));
  }, [jobs, range]);

  const platformSplit = useMemo(() => {
    const counts = new Map<string, number>();
    for (const j of jobs) counts.set(j.platform, (counts.get(j.platform) ?? 0) + 1);
    return Array.from(counts.entries())
      .map(([platform, value]) => ({ platform, value, color: PLATFORM_COLOR[platform] ?? "#5a7294" }))
      .sort((a, b) => b.value - a.value);
  }, [jobs]);

  const rangeLabel = preset === "custom"
    ? `${fmtDate(range.from)} – ${fmtDate(range.to)}`
    : PRESETS.find((p) => p.key === preset)?.label ?? "";

  const typesLabel = selectedTypes.length === 0
    ? "None"
    : selectedTypes.length === SCRAPE_TYPES.length
      ? "All types"
      : SCRAPE_TYPES.filter((t) => selectedTypes.includes(t.key)).map((t) => t.label.split(" ")[0]).join(", ");

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* ════════ Filter toolbar ════════ */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Project */}
        <Dropdown label="Project" value={activeProjectName ?? "Select"} icon={FolderOpen} width={240}>
          {(close) => (
            <div className="py-1 max-h-64 overflow-y-auto">
              {availableProjects.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">No projects yet.</p>
              ) : availableProjects.map((p) => (
                <button
                  key={p.project_id}
                  onClick={() => { setActiveProject(p); close(); }}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-left hover:bg-muted transition-colors"
                  style={{ color: p.project_id === activeProjectId ? "#00c9ff" : "#dde4f4" }}
                >
                  <FolderOpen className="w-4 h-4 flex-shrink-0" style={{ color: p.project_id === activeProjectId ? "#00c9ff" : "#5a7294" }} />
                  <span className="flex-1 truncate">{p.project_name}</span>
                  {p.project_id === activeProjectId && <CheckCircle2 className="w-4 h-4" />}
                </button>
              ))}
            </div>
          )}
        </Dropdown>

        {/* Scrape types (multi-select) */}
        <Dropdown label="Scrapers" value={typesLabel} icon={Activity} width={240}>
          {() => (
            <div className="py-1.5">
              {SCRAPE_TYPES.map((t) => {
                const checked = selectedTypes.includes(t.key);
                return (
                  <button
                    key={t.key}
                    onClick={() => setSelectedTypes((prev) =>
                      prev.includes(t.key) ? prev.filter((k) => k !== t.key) : [...prev, t.key]
                    )}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-muted transition-colors"
                  >
                    <span
                      className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border transition-all"
                      style={{
                        background: checked ? t.color : "transparent",
                        borderColor: checked ? t.color : "rgba(255,255,255,0.2)",
                      }}
                    >
                      {checked && (
                        <svg className="w-2.5 h-2.5" viewBox="0 0 10 8" fill="none" style={{ color: "#060c18" }}>
                          <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    <span className="flex-1" style={{ color: checked ? "#dde4f4" : "#8899b0" }}>{t.label}</span>
                    <span className="w-2 h-2 rounded-full" style={{ background: t.color }} />
                  </button>
                );
              })}
              <p className="px-4 pt-2 pb-1 text-[10px] text-muted-foreground border-t mt-1" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                Pick one or more. Charts update to match.
              </p>
            </div>
          )}
        </Dropdown>

        {/* Date range */}
        <Dropdown label="Period" value={rangeLabel} icon={Clock} width={260}>
          {(close) => (
            <div className="py-1">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => { setPreset(p.key); if (p.key !== "custom") close(); }}
                  className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-left hover:bg-muted transition-colors"
                  style={{ color: preset === p.key ? "#00c9ff" : "#dde4f4" }}
                >
                  {p.label}
                  {preset === p.key && <CheckCircle2 className="w-4 h-4" />}
                </button>
              ))}
              {preset === "custom" && (
                <div className="px-4 py-3 border-t space-y-2.5" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                  <div>
                    <label className="block text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">From</label>
                    <input
                      type="date"
                      value={custom.from}
                      max={custom.to}
                      onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
                      className="w-full px-2.5 py-1.5 text-sm rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">To</label>
                    <input
                      type="date"
                      value={custom.to}
                      min={custom.from}
                      onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
                      className="w-full px-2.5 py-1.5 text-sm rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </Dropdown>

        {loading && <Loader2 className="w-4 h-4 animate-spin" style={{ color: "#5a7294" }} />}
      </div>

      {/* ════════ No project / error ════════ */}
      {!activeProjectId ? (
        <div className="rounded-2xl border p-12 text-center text-sm text-muted-foreground" style={{ background: "#0d1829", borderColor: "rgba(255,255,255,0.07)" }}>
          Select a project to view its analytics.
        </div>
      ) : error ? (
        <div className="rounded-2xl p-4 text-sm" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#ef4444" }}>
          {error}
        </div>
      ) : (
        <>
          {/* ════════ ROW 1 — KPI cards ════════ */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {kpis.map((kpi) => {
              const Icon = kpi.icon;
              const hasTrend = kpi.trend !== undefined && kpi.trend !== null;
              const up = (kpi.trend ?? 0) >= 0;
              return (
                <div key={kpi.label} className="rounded-2xl border p-5" style={{ background: "#0d1829", borderColor: "rgba(255,255,255,0.07)" }}>
                  <div className="flex items-start justify-between mb-4">
                    <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">{kpi.label}</p>
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${kpi.accent}14`, border: `1px solid ${kpi.accent}26` }}>
                      <Icon className="w-4 h-4" style={{ color: kpi.accent }} />
                    </div>
                  </div>
                  <p className="text-3xl font-bold text-foreground leading-none" style={{ fontFamily: "Outfit, sans-serif", letterSpacing: "-0.02em" }}>
                    {kpi.value}
                  </p>
                  <div className="flex items-center gap-1 mt-3">
                    {hasTrend ? (
                      <>
                        {up ? <ArrowUpRight className="w-3.5 h-3.5" style={{ color: "#34d399" }} />
                            : <ArrowDownRight className="w-3.5 h-3.5" style={{ color: "#f87171" }} />}
                        <span className="text-xs font-semibold" style={{ color: up ? "#34d399" : "#f87171" }}>
                          {up ? "+" : ""}{kpi.trend!.toFixed(1)}%
                        </span>
                        <span className="text-xs text-muted-foreground">{kpi.note}</span>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">{kpi.note}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ════════ ROW 2 — Line (≈65%) + Donut (≈35%) ════════ */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 rounded-2xl border p-5" style={{ background: "#0d1829", borderColor: "rgba(255,255,255,0.07)" }}>
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="text-sm font-semibold text-foreground" style={{ fontFamily: "Outfit, sans-serif" }}>Scrape volume</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Jobs per day · {rangeLabel}</p>
                </div>
                <span className="flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 rounded-full" style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)", color: "#34d399" }}>
                  <span className="w-1.5 h-1.5 rounded-full inline-block animate-pulse" style={{ background: "#34d399" }} />
                  Live
                </span>
              </div>
              <div style={{ width: "100%", height: 260 }}>
                {total === 0 ? (
                  <div className="h-full flex items-center justify-center text-sm text-muted-foreground">No scrapes in this period.</div>
                ) : (
                  <ResponsiveContainer>
                    <AreaChart data={trendData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                      <defs>
                        <linearGradient id="scrapeFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#00c9ff" stopOpacity={0.28} />
                          <stop offset="100%" stopColor="#00c9ff" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="label" tick={{ fill: "#5a7294", fontSize: 10, fontFamily: "monospace" }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={28} />
                      <YAxis tick={{ fill: "#5a7294", fontSize: 10, fontFamily: "monospace" }} axisLine={false} tickLine={false} width={40} allowDecimals={false} />
                      <Tooltip content={<LineTooltip />} cursor={{ stroke: "rgba(0,201,255,0.25)", strokeWidth: 1 }} />
                      <Area type="monotone" dataKey="value" stroke="#00c9ff" strokeWidth={2} fill="url(#scrapeFill)" dot={false} activeDot={{ r: 4, fill: "#00c9ff", stroke: "#060c18", strokeWidth: 2 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="rounded-2xl border p-5 flex flex-col" style={{ background: "#0d1829", borderColor: "rgba(255,255,255,0.07)" }}>
              <h2 className="text-sm font-semibold text-foreground" style={{ fontFamily: "Outfit, sans-serif" }}>Platform split</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Share of scrapes</p>
              <div className="relative flex-1 flex items-center justify-center" style={{ minHeight: 200 }}>
                {total === 0 ? (
                  <p className="text-sm text-muted-foreground">No data.</p>
                ) : (
                  <>
                    <div style={{ width: "100%", height: 200 }}>
                      <ResponsiveContainer>
                        <PieChart>
                          <Pie data={platformSplit} dataKey="value" nameKey="platform" cx="50%" cy="50%" innerRadius={58} outerRadius={82} paddingAngle={3} strokeWidth={0}>
                            {platformSplit.map((p) => <Cell key={p.platform} fill={p.color} />)}
                          </Pie>
                          <Tooltip content={<DonutTooltip />} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-2xl font-bold text-foreground" style={{ fontFamily: "Outfit, sans-serif" }}>{total}</span>
                      <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">total</span>
                    </div>
                  </>
                )}
              </div>
              {total > 0 && (
                <div className="flex items-center justify-center gap-5 mt-2 flex-wrap">
                  {platformSplit.map((p) => (
                    <div key={p.platform} className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: p.color }} />
                      <span className="text-xs text-muted-foreground">{p.platform}</span>
                      <span className="text-xs font-semibold text-foreground">{Math.round((p.value / total) * 100)}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ════════ ROW 3 — KOLs scraped ════════ */}
          <div className="rounded-2xl border overflow-hidden" style={{ background: "#0d1829", borderColor: "rgba(255,255,255,0.07)" }}>
            <div className="flex items-center justify-between px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold text-foreground" style={{ fontFamily: "Outfit, sans-serif" }}>KOLs scraped</h2>
                <p className="text-xs text-muted-foreground mt-0.5">{uniqueKols} unique · {rangeLabel}</p>
              </div>
              <a href="/queue" className="text-xs font-medium text-primary hover:opacity-80 transition-opacity">View queue →</a>
            </div>

            {kolRows.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm text-muted-foreground">No KOLs scraped in this period.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: "#0f1e35" }}>
                    {["KOL / Target", "Platform", "Scrapes", "Status", "Last scraped"].map((h) => (
                      <th key={h} className="px-5 py-2.5 text-left text-[10px] font-mono uppercase tracking-wider text-muted-foreground font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {kolRows.map((row) => {
                    const sp = STATUS_PILL[row.lastStatus];
                    const pc = PLATFORM_COLOR[row.platform] ?? "#5a7294";
                    return (
                      <tr key={row.kol} className="border-t transition-colors hover:bg-white/[0.02]" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                        <td className="px-5 py-3.5 max-w-[280px]">
                          <span className="font-medium text-foreground truncate block" title={row.kol}>{row.kol}</span>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className="inline-flex items-center text-[11px] font-medium px-2.5 py-1 rounded-full" style={{ background: `${pc}1a`, border: `1px solid ${pc}4d`, color: pc }}>
                            {row.platform}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-muted-foreground">{row.count}</td>
                        <td className="px-5 py-3.5">
                          <span className="inline-flex items-center text-[11px] font-medium px-2.5 py-1 rounded-full" style={{ background: sp.bg, border: `1px solid ${sp.border}`, color: sp.color }}>
                            {sp.label}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-muted-foreground text-xs whitespace-nowrap">{fmtDate(row.lastScraped)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
