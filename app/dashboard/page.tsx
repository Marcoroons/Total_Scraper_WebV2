"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2, ChevronDown, Clock, Eye, FolderOpen, Heart, Loader2,
  MessageCircle, Share2, type LucideIcon,
} from "lucide-react";
import {
  Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useProject } from "@/lib/context/ProjectContext";

// ─── Config ────────────────────────────────────────────────────────────────────

const SCRAPE_TYPES = [
  { key: "url",     label: "URL Scraper",     jobType: "Specific URLs (Video Stats)", color: "#f59e0b" },
  { key: "profile", label: "Profile Scraper", jobType: "Profile Feed (Audit)",        color: "#a78bfa" },
] as const;
type ScrapeKey = (typeof SCRAPE_TYPES)[number]["key"];
const DEFAULT_TYPES: ScrapeKey[] = ["url", "profile"];

const PLATFORM_COLOR: Record<string, string> = { Instagram: "#f472b6", TikTok: "#00c9ff" };

interface KolAgg { name: string; platform: string; views: number; likes: number; comments: number; shares: number; posts: number }
interface Totals { views: number; likes: number; comments: number; shares: number; posts: number }

// ─── Date range ────────────────────────────────────────────────────────────────

type PresetKey = "7d" | "30d" | "90d" | "ytd" | "custom";
const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "7d", label: "Last 7 days" }, { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" }, { key: "ytd", label: "Year to date" },
  { key: "custom", label: "Custom range" },
];
function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function presetRange(key: Exclude<PresetKey, "custom">): { from: string; to: string } {
  const to = new Date(); const from = new Date();
  if (key === "7d")  from.setDate(to.getDate() - 6);
  if (key === "30d") from.setDate(to.getDate() - 29);
  if (key === "90d") from.setDate(to.getDate() - 89);
  if (key === "ytd") { from.setMonth(0); from.setDate(1); }
  return { from: ymd(from), to: ymd(to) };
}

function fmt(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return String(Math.round(n));
}

// ─── Dropdown shell ──────────────────────────────────────────────────────────

function Dropdown({ label, value, icon: Icon, width = 220, children }: {
  label: string; value: string; icon: LucideIcon; width?: number;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onClick(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors hover:border-[rgba(0,201,255,0.3)]"
        style={{ background: "#0d1829", borderColor: "rgba(255,255,255,0.08)" }}>
        <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#5a7294" }} />
        <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: "#3a4d68" }}>{label}</span>
        <span className="font-medium text-foreground max-w-[180px] truncate">{value}</span>
        <ChevronDown className={["w-3.5 h-3.5 transition-transform", open ? "rotate-180" : ""].join(" ")} style={{ color: "#5a7294" }} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-2 rounded-xl border shadow-xl z-50 overflow-hidden"
          style={{ background: "#0d1829", borderColor: "rgba(255,255,255,0.1)", width }}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

interface TP { value: number; name?: string; payload?: KolAgg }
function BarTip({ active, payload }: { active?: boolean; payload?: TP[] }) {
  if (!active || !payload?.length) return null;
  const k = payload[0].payload;
  return (
    <div style={{ background: "#0d1829", border: "1px solid rgba(0,201,255,0.25)", borderRadius: 8, padding: "8px 12px" }}>
      <p style={{ fontSize: 12, fontWeight: 700, color: "#dde4f4" }}>{k?.name}</p>
      <p style={{ fontSize: 11, color: "#00c9ff" }}>{fmt(k?.views ?? 0)} views</p>
      <p style={{ fontSize: 10, color: "#5a7294" }}>{fmt(k?.likes ?? 0)} likes · {fmt(k?.comments ?? 0)} comments</p>
    </div>
  );
}
function DonutTip({ active, payload }: { active?: boolean; payload?: TP[] }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#0d1829", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "6px 10px" }}>
      <p style={{ fontSize: 12, fontWeight: 600, color: "#dde4f4" }}>{payload[0].name}: {fmt(payload[0].value)} views</p>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { activeProjectId, activeProjectName, availableProjects, setActiveProject } = useProject();

  const [selectedTypes, setSelectedTypes] = useState<ScrapeKey[]>(DEFAULT_TYPES);
  const [preset, setPreset] = useState<PresetKey>("30d");
  const [custom, setCustom] = useState(presetRange("30d"));

  const [totals, setTotals] = useState<Totals>({ views: 0, likes: 0, comments: 0, shares: 0, posts: 0 });
  const [kols, setKols] = useState<KolAgg[]>([]);
  const [viewsByPlatform, setViewsByPlatform] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const range = useMemo(() => (preset === "custom" ? custom : presetRange(preset)), [preset, custom]);

  const load = useCallback(async () => {
    if (!activeProjectId) { setKols([]); return; }
    const jobTypes = SCRAPE_TYPES.filter((t) => selectedTypes.includes(t.key)).map((t) => t.jobType);
    if (jobTypes.length === 0) { setKols([]); setTotals({ views: 0, likes: 0, comments: 0, shares: 0, posts: 0 }); return; }

    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({
        project_id: activeProjectId, types: jobTypes.join(","),
        from: `${range.from}T00:00:00.000Z`, to: `${range.to}T23:59:59.999Z`,
      });
      const res = await fetch(`/api/dashboard?${params}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "Failed to load dashboard data."); return; }
      setTotals(data.totals ?? { views: 0, likes: 0, comments: 0, shares: 0, posts: 0 });
      setKols(data.kols ?? []);
      setViewsByPlatform(data.viewsByPlatform ?? {});
    } catch {
      setError("Network error loading dashboard.");
    } finally {
      setLoading(false);
    }
  }, [activeProjectId, selectedTypes, range]);

  useEffect(() => { load(); }, [load]);

  const engagementRate = totals.views > 0
    ? ((totals.likes + totals.comments + totals.shares) / totals.views) * 100 : 0;

  const kpis = [
    { label: "Total Views",    value: fmt(totals.views),    icon: Eye,           accent: "#00c9ff", note: `across ${fmt(totals.posts)} posts` },
    { label: "Total Likes",    value: fmt(totals.likes),    icon: Heart,         accent: "#f472b6", note: `${engagementRate.toFixed(1)}% engagement` },
    { label: "Total Comments", value: fmt(totals.comments), icon: MessageCircle, accent: "#a78bfa", note: `${kols.length} KOL${kols.length !== 1 ? "s" : ""}` },
    { label: "Total Shares",   value: fmt(totals.shares),   icon: Share2,        accent: "#10b981", note: "all scraped content" },
  ];

  const topKols = kols.slice(0, 8).map((k) => ({ ...k, short: k.name.length > 16 ? k.name.slice(0, 15) + "…" : k.name }));
  const platformData = Object.entries(viewsByPlatform)
    .map(([platform, value]) => ({ platform, value, color: PLATFORM_COLOR[platform] ?? "#5a7294" }))
    .sort((a, b) => b.value - a.value);

  const rangeLabel = preset === "custom" ? `${range.from} → ${range.to}` : PRESETS.find((p) => p.key === preset)?.label ?? "";
  const typesLabel = selectedTypes.length === 0 ? "None"
    : selectedTypes.length === SCRAPE_TYPES.length ? "All types"
    : SCRAPE_TYPES.filter((t) => selectedTypes.includes(t.key)).map((t) => t.label.split(" ")[0]).join(", ");

  const hasData = totals.views > 0 || totals.likes > 0 || kols.length > 0;

  return (
    <div className="space-y-5">

      {/* Filter toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <Dropdown label="Project" value={activeProjectName ?? "Select"} icon={FolderOpen} width={240}>
          {(close) => (
            <div className="py-1 max-h-64 overflow-y-auto">
              {availableProjects.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">No projects yet.</p>
              ) : availableProjects.map((p) => (
                <button key={p.project_id} onClick={() => { setActiveProject(p); close(); }}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-left hover:bg-muted transition-colors"
                  style={{ color: p.project_id === activeProjectId ? "#00c9ff" : "#dde4f4" }}>
                  <FolderOpen className="w-4 h-4 flex-shrink-0" style={{ color: p.project_id === activeProjectId ? "#00c9ff" : "#5a7294" }} />
                  <span className="flex-1 truncate">{p.project_name}</span>
                  {p.project_id === activeProjectId && <CheckCircle2 className="w-4 h-4" />}
                </button>
              ))}
            </div>
          )}
        </Dropdown>

        <Dropdown label="Scrapers" value={typesLabel} icon={Eye} width={240}>
          {() => (
            <div className="py-1.5">
              {SCRAPE_TYPES.map((t) => {
                const checked = selectedTypes.includes(t.key);
                return (
                  <button key={t.key} onClick={() => setSelectedTypes((prev) => prev.includes(t.key) ? prev.filter((k) => k !== t.key) : [...prev, t.key])}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-muted transition-colors">
                    <span className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border transition-all"
                      style={{ background: checked ? t.color : "transparent", borderColor: checked ? t.color : "rgba(255,255,255,0.2)" }}>
                      {checked && <svg className="w-2.5 h-2.5" viewBox="0 0 10 8" fill="none" style={{ color: "#060c18" }}><path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                    </span>
                    <span className="flex-1" style={{ color: checked ? "#dde4f4" : "#8899b0" }}>{t.label}</span>
                    <span className="w-2 h-2 rounded-full" style={{ background: t.color }} />
                  </button>
                );
              })}
            </div>
          )}
        </Dropdown>

        <Dropdown label="Period" value={rangeLabel} icon={Clock} width={260}>
          {(close) => (
            <div className="py-1">
              {PRESETS.map((p) => (
                <button key={p.key} onClick={() => { setPreset(p.key); if (p.key !== "custom") close(); }}
                  className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-left hover:bg-muted transition-colors"
                  style={{ color: preset === p.key ? "#00c9ff" : "#dde4f4" }}>
                  {p.label}{preset === p.key && <CheckCircle2 className="w-4 h-4" />}
                </button>
              ))}
              {preset === "custom" && (
                <div className="px-4 py-3 border-t space-y-2.5" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                  <div>
                    <label className="block text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">From</label>
                    <input type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
                      className="w-full px-2.5 py-1.5 text-sm rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">To</label>
                    <input type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
                      className="w-full px-2.5 py-1.5 text-sm rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
                  </div>
                </div>
              )}
            </div>
          )}
        </Dropdown>

        {loading && <Loader2 className="w-4 h-4 animate-spin" style={{ color: "#5a7294" }} />}
      </div>

      {!activeProjectId ? (
        <div className="rounded-2xl border p-12 text-center text-sm text-muted-foreground" style={{ background: "#0d1829", borderColor: "rgba(255,255,255,0.07)" }}>
          Select a project to view its analytics.
        </div>
      ) : error ? (
        <div className="rounded-2xl p-4 text-sm" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#ef4444" }}>{error}</div>
      ) : (
        <>
          {/* ROW 1 — metric KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {kpis.map((kpi) => {
              const Icon = kpi.icon;
              return (
                <div key={kpi.label} className="rounded-2xl border p-5" style={{ background: "#0d1829", borderColor: "rgba(255,255,255,0.07)" }}>
                  <div className="flex items-start justify-between mb-4">
                    <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">{kpi.label}</p>
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${kpi.accent}14`, border: `1px solid ${kpi.accent}26` }}>
                      <Icon className="w-4 h-4" style={{ color: kpi.accent }} />
                    </div>
                  </div>
                  <p className="text-3xl font-bold text-foreground leading-none" style={{ fontFamily: "Outfit, sans-serif", letterSpacing: "-0.02em" }}>{kpi.value}</p>
                  <p className="text-xs text-muted-foreground mt-3">{kpi.note}</p>
                </div>
              );
            })}
          </div>

          {/* ROW 2 — top KOLs by views + views by platform */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 rounded-2xl border p-5" style={{ background: "#0d1829", borderColor: "rgba(255,255,255,0.07)" }}>
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="text-sm font-semibold text-foreground" style={{ fontFamily: "Outfit, sans-serif" }}>Top KOLs by views</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">{rangeLabel}</p>
                </div>
                <span className="flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 rounded-full" style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)", color: "#34d399" }}>
                  <span className="w-1.5 h-1.5 rounded-full inline-block animate-pulse" style={{ background: "#34d399" }} />Live
                </span>
              </div>
              <div style={{ width: "100%", height: 280 }}>
                {!hasData ? (
                  <div className="h-full flex items-center justify-center text-sm text-muted-foreground">No scraped data in this period yet.</div>
                ) : (
                  <ResponsiveContainer>
                    <BarChart data={topKols} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                      <XAxis type="number" tick={{ fill: "#5a7294", fontSize: 10, fontFamily: "monospace" }} axisLine={false} tickLine={false} tickFormatter={fmt} />
                      <YAxis type="category" dataKey="short" tick={{ fill: "#8899b0", fontSize: 11 }} axisLine={false} tickLine={false} width={110} />
                      <Tooltip content={<BarTip />} cursor={{ fill: "rgba(0,201,255,0.06)" }} />
                      <Bar dataKey="views" radius={[0, 4, 4, 0]} barSize={16}>
                        {topKols.map((k, i) => <Cell key={i} fill={PLATFORM_COLOR[k.platform] ?? "#00c9ff"} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="rounded-2xl border p-5 flex flex-col" style={{ background: "#0d1829", borderColor: "rgba(255,255,255,0.07)" }}>
              <h2 className="text-sm font-semibold text-foreground" style={{ fontFamily: "Outfit, sans-serif" }}>Views by platform</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Share of total views</p>
              <div className="relative flex-1 flex items-center justify-center" style={{ minHeight: 200 }}>
                {!hasData ? (
                  <p className="text-sm text-muted-foreground">No data.</p>
                ) : (
                  <>
                    <div style={{ width: "100%", height: 200 }}>
                      <ResponsiveContainer>
                        <PieChart>
                          <Pie data={platformData} dataKey="value" nameKey="platform" cx="50%" cy="50%" innerRadius={58} outerRadius={82} paddingAngle={3} strokeWidth={0}>
                            {platformData.map((p) => <Cell key={p.platform} fill={p.color} />)}
                          </Pie>
                          <Tooltip content={<DonutTip />} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-2xl font-bold text-foreground" style={{ fontFamily: "Outfit, sans-serif" }}>{fmt(totals.views)}</span>
                      <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">total views</span>
                    </div>
                  </>
                )}
              </div>
              {hasData && (
                <div className="flex items-center justify-center gap-5 mt-2 flex-wrap">
                  {platformData.map((p) => (
                    <div key={p.platform} className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: p.color }} />
                      <span className="text-xs text-muted-foreground">{p.platform}</span>
                      <span className="text-xs font-semibold text-foreground">{totals.views ? Math.round((p.value / totals.views) * 100) : 0}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ROW 3 — per-KOL metrics table */}
          <div className="rounded-2xl border overflow-hidden" style={{ background: "#0d1829", borderColor: "rgba(255,255,255,0.07)" }}>
            <div className="px-5 py-4">
              <h2 className="text-sm font-semibold text-foreground" style={{ fontFamily: "Outfit, sans-serif" }}>KOL breakdown</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{kols.length} KOL{kols.length !== 1 ? "s" : ""} · {rangeLabel}</p>
            </div>
            {kols.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm text-muted-foreground">No scraped data for these filters.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: "#0f1e35" }}>
                    {["KOL", "Platform", "Posts", "Views", "Likes", "Comments", "Shares"].map((h, i) => (
                      <th key={h} className={`px-5 py-2.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground font-medium ${i >= 2 ? "text-right" : "text-left"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {kols.map((k) => {
                    const pc = PLATFORM_COLOR[k.platform] ?? "#5a7294";
                    return (
                      <tr key={`${k.platform}-${k.name}`} className="border-t transition-colors hover:bg-white/[0.02]" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                        <td className="px-5 py-3 max-w-[240px]"><span className="font-medium text-foreground truncate block" title={k.name}>{k.name}</span></td>
                        <td className="px-5 py-3">
                          <span className="inline-flex items-center text-[11px] font-medium px-2.5 py-1 rounded-full" style={{ background: `${pc}1a`, border: `1px solid ${pc}4d`, color: pc }}>{k.platform}</span>
                        </td>
                        <td className="px-5 py-3 text-right text-muted-foreground">{k.posts}</td>
                        <td className="px-5 py-3 text-right font-medium text-foreground">{fmt(k.views)}</td>
                        <td className="px-5 py-3 text-right text-muted-foreground">{fmt(k.likes)}</td>
                        <td className="px-5 py-3 text-right text-muted-foreground">{fmt(k.comments)}</td>
                        <td className="px-5 py-3 text-right text-muted-foreground">{fmt(k.shares)}</td>
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
