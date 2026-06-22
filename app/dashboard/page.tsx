"use client";

import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  LayoutGrid,
  TrendingUp,
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

// ════════════════════════════════════════════════════════════════════════════
//  Types
// ════════════════════════════════════════════════════════════════════════════

interface KPIMetric {
  id:        string;
  label:     string;
  value:     string;
  icon:      LucideIcon;
  trend:     number;        // signed percentage, e.g. +12.4 / -3.2
  trendNote: string;        // "this week", "vs. last run"…
  accent:    string;        // hex accent for the icon chip
}

interface ChartDataPoint {
  label: string;            // x-axis label (date)
  value: number;            // scrapes run that day
}

interface PlatformSplit {
  platform: string;
  value:    number;         // percentage share
  color:    string;
}

interface RecentJob {
  id:        string;
  target:    string;
  platform:  "Instagram" | "TikTok";
  jobType:   string;
  status:    "COMPLETED" | "AUTO_PROCESSING" | "PENDING" | "FAILED";
  createdAt: string;        // ISO
}

// ════════════════════════════════════════════════════════════════════════════
//  Mock data  (UI-only — wire to the backend later)
// ════════════════════════════════════════════════════════════════════════════

const MOCK = {
  kpis: [
    { id: "scrapes",   label: "Total Scrapes",   value: "1,284", icon: Activity,     trend:  12.4, trendNote: "this week",    accent: "#00c9ff" },
    { id: "completed", label: "Completed Jobs",  value: "1,102", icon: CheckCircle2, trend:   8.1, trendNote: "this week",    accent: "#10b981" },
    { id: "queue",     label: "In Queue",        value: "47",    icon: Clock,        trend:  -3.2, trendNote: "vs. yesterday", accent: "#f59e0b" },
    { id: "engage",    label: "Avg. Engagement", value: "4.7%",  icon: TrendingUp,   trend:   0.6, trendNote: "vs. last run", accent: "#a78bfa" },
  ] as KPIMetric[],

  scrapeTrend: [
    { label: "Jun 10", value:  42 },
    { label: "Jun 11", value:  68 },
    { label: "Jun 12", value:  55 },
    { label: "Jun 13", value:  91 },
    { label: "Jun 14", value:  74 },
    { label: "Jun 15", value: 110 },
    { label: "Jun 16", value:  96 },
    { label: "Jun 17", value: 134 },
    { label: "Jun 18", value: 118 },
    { label: "Jun 19", value: 152 },
    { label: "Jun 20", value: 128 },
    { label: "Jun 21", value: 167 },
    { label: "Jun 22", value: 143 },
    { label: "Jun 23", value: 189 },
  ] as ChartDataPoint[],

  platformSplit: [
    { platform: "Instagram", value: 62, color: "#f472b6" },
    { platform: "TikTok",    value: 38, color: "#00c9ff" },
  ] as PlatformSplit[],

  recentJobs: [
    { id: "a1b2c3d4", target: "@nike",            platform: "Instagram", jobType: "Profile Feed (Audit)",        status: "COMPLETED",      createdAt: "2026-06-23T09:14:00Z" },
    { id: "e5f6g7h8", target: "@gymshark",        platform: "TikTok",    jobType: "Comments (Sentiment)",        status: "AUTO_PROCESSING", createdAt: "2026-06-23T08:52:00Z" },
    { id: "i9j0k1l2", target: "tiktok.com/@khaby",platform: "TikTok",    jobType: "Specific URLs (Video Stats)", status: "COMPLETED",      createdAt: "2026-06-23T08:31:00Z" },
    { id: "m3n4o5p6", target: "#summerdrop",      platform: "Instagram", jobType: "Trend Discovery (Hashtag)",   status: "PENDING",        createdAt: "2026-06-23T08:05:00Z" },
    { id: "q7r8s9t0", target: "@fashionnova",     platform: "Instagram", jobType: "Competitor Ads (Meta)",       status: "FAILED",         createdAt: "2026-06-22T22:47:00Z" },
    { id: "u1v2w3x4", target: "@duolingo",        platform: "TikTok",    jobType: "Profile Feed (Audit)",        status: "COMPLETED",      createdAt: "2026-06-22T21:12:00Z" },
  ] as RecentJob[],
};

// ════════════════════════════════════════════════════════════════════════════
//  Status / platform pill styling
// ════════════════════════════════════════════════════════════════════════════

const STATUS_PILL: Record<RecentJob["status"], { bg: string; border: string; color: string; label: string }> = {
  COMPLETED:       { bg: "rgba(16,185,129,0.1)",  border: "rgba(16,185,129,0.3)",  color: "#34d399", label: "Completed" },
  AUTO_PROCESSING: { bg: "rgba(167,139,250,0.1)", border: "rgba(167,139,250,0.3)", color: "#a78bfa", label: "Processing" },
  PENDING:         { bg: "rgba(245,158,11,0.1)",  border: "rgba(245,158,11,0.3)",  color: "#fbbf24", label: "Pending" },
  FAILED:          { bg: "rgba(239,68,68,0.1)",   border: "rgba(239,68,68,0.3)",   color: "#f87171", label: "Failed" },
};

const PLATFORM_PILL: Record<RecentJob["platform"], { bg: string; border: string; color: string }> = {
  Instagram: { bg: "rgba(225,48,108,0.1)", border: "rgba(225,48,108,0.3)", color: "#f472b6" },
  TikTok:    { bg: "rgba(0,201,255,0.1)",  border: "rgba(0,201,255,0.3)",  color: "#00c9ff" },
};

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("en-SG", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

// ════════════════════════════════════════════════════════════════════════════
//  Chart tooltips
// ════════════════════════════════════════════════════════════════════════════

interface TooltipPayload { value: number; name?: string; payload?: ChartDataPoint }

function LineTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayload[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#0d1829", border: "1px solid rgba(0,201,255,0.25)", borderRadius: 8, padding: "8px 12px", boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}>
      <p style={{ fontSize: 10, fontFamily: "monospace", color: "#5a7294", marginBottom: 2 }}>{label}</p>
      <p style={{ fontSize: 14, fontWeight: 700, color: "#00c9ff" }}>{payload[0].value} scrapes</p>
    </div>
  );
}

function DonutTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div style={{ background: "#0d1829", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "6px 10px" }}>
      <p style={{ fontSize: 12, fontWeight: 600, color: "#dde4f4" }}>{p.name}: {p.value}%</p>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  Page
// ════════════════════════════════════════════════════════════════════════════

export default function DashboardPage() {
  return (
    <div className="space-y-5">

      {/* ── Page sub-header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground" style={{ fontFamily: "Outfit, sans-serif" }}>
            Overview
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Activity across all your scrapers</p>
        </div>
        <span
          className="flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 rounded-full"
          style={{ background: "rgba(0,201,255,0.08)", border: "1px solid rgba(0,201,255,0.2)", color: "#00c9ff" }}
        >
          Last 14 days
        </span>
      </div>

      {/* ════════ ROW 1 — KPI cards ════════ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {MOCK.kpis.map((kpi) => {
          const Icon = kpi.icon;
          const up   = kpi.trend >= 0;
          return (
            <div
              key={kpi.id}
              className="rounded-2xl border p-5"
              style={{ background: "#0d1829", borderColor: "rgba(255,255,255,0.07)", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }}
            >
              <div className="flex items-start justify-between mb-4">
                <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">{kpi.label}</p>
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: `${kpi.accent}14`, border: `1px solid ${kpi.accent}26` }}
                >
                  <Icon className="w-4 h-4" style={{ color: kpi.accent }} />
                </div>
              </div>
              <p className="text-3xl font-bold text-foreground leading-none" style={{ fontFamily: "Outfit, sans-serif", letterSpacing: "-0.02em" }}>
                {kpi.value}
              </p>
              <div className="flex items-center gap-1 mt-3">
                {up
                  ? <ArrowUpRight   className="w-3.5 h-3.5" style={{ color: "#34d399" }} />
                  : <ArrowDownRight className="w-3.5 h-3.5" style={{ color: "#f87171" }} />}
                <span className="text-xs font-semibold" style={{ color: up ? "#34d399" : "#f87171" }}>
                  {up ? "+" : ""}{kpi.trend}%
                </span>
                <span className="text-xs text-muted-foreground">{kpi.trendNote}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Edit layout — sits directly under the first KPI card */}
      <div className="-mt-1">
        <button
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors hover:border-[rgba(0,201,255,0.3)] hover:text-[#00c9ff]"
          style={{ borderColor: "rgba(255,255,255,0.08)", color: "#5a7294" }}
        >
          <LayoutGrid className="w-3.5 h-3.5" />
          Edit layout
        </button>
      </div>

      {/* ════════ ROW 2 — Line chart (≈65%) + Donut (≈35%) ════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Line chart */}
        <div
          className="lg:col-span-2 rounded-2xl border p-5"
          style={{ background: "#0d1829", borderColor: "rgba(255,255,255,0.07)" }}
        >
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-semibold text-foreground" style={{ fontFamily: "Outfit, sans-serif" }}>
                Scrape volume
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">Jobs run per day</p>
            </div>
            <span
              className="flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 rounded-full"
              style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)", color: "#34d399" }}
            >
              <span className="w-1.5 h-1.5 rounded-full inline-block animate-pulse" style={{ background: "#34d399" }} />
              Live
            </span>
          </div>

          <div style={{ width: "100%", height: 260 }}>
            <ResponsiveContainer>
              <AreaChart data={MOCK.scrapeTrend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="scrapeFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#00c9ff" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#00c9ff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="label"
                  tick={{ fill: "#5a7294", fontSize: 10, fontFamily: "monospace" }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                  minTickGap={24}
                />
                <YAxis
                  tick={{ fill: "#5a7294", fontSize: 10, fontFamily: "monospace" }}
                  axisLine={false}
                  tickLine={false}
                  width={40}
                />
                <Tooltip content={<LineTooltip />} cursor={{ stroke: "rgba(0,201,255,0.25)", strokeWidth: 1 }} />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#00c9ff"
                  strokeWidth={2}
                  fill="url(#scrapeFill)"
                  dot={false}
                  activeDot={{ r: 4, fill: "#00c9ff", stroke: "#060c18", strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Donut chart */}
        <div
          className="rounded-2xl border p-5 flex flex-col"
          style={{ background: "#0d1829", borderColor: "rgba(255,255,255,0.07)" }}
        >
          <h2 className="text-sm font-semibold text-foreground" style={{ fontFamily: "Outfit, sans-serif" }}>
            Platform split
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">Share of total scrapes</p>

          <div className="relative flex-1 flex items-center justify-center" style={{ minHeight: 200 }}>
            <div style={{ width: "100%", height: 200 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={MOCK.platformSplit}
                    dataKey="value"
                    nameKey="platform"
                    cx="50%"
                    cy="50%"
                    innerRadius={58}
                    outerRadius={82}
                    paddingAngle={3}
                    strokeWidth={0}
                  >
                    {MOCK.platformSplit.map((p) => <Cell key={p.platform} fill={p.color} />)}
                  </Pie>
                  <Tooltip content={<DonutTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            {/* Centered total */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-2xl font-bold text-foreground" style={{ fontFamily: "Outfit, sans-serif" }}>1,284</span>
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">total</span>
            </div>
          </div>

          {/* Custom legend */}
          <div className="flex items-center justify-center gap-5 mt-2">
            {MOCK.platformSplit.map((p) => (
              <div key={p.platform} className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: p.color }} />
                <span className="text-xs text-muted-foreground">{p.platform}</span>
                <span className="text-xs font-semibold text-foreground">{p.value}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ════════ ROW 3 — Recent jobs table ════════ */}
      <div
        className="rounded-2xl border overflow-hidden"
        style={{ background: "#0d1829", borderColor: "rgba(255,255,255,0.07)" }}
      >
        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground" style={{ fontFamily: "Outfit, sans-serif" }}>
              Recent jobs
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">Latest activity across your scrapers</p>
          </div>
          <a href="/queue" className="text-xs font-medium text-primary hover:opacity-80 transition-opacity">
            View all →
          </a>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "#0f1e35" }}>
              {["Target", "Platform", "Job Type", "Status", "Created"].map((h) => (
                <th key={h} className="px-5 py-2.5 text-left text-[10px] font-mono uppercase tracking-wider text-muted-foreground font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
            {MOCK.recentJobs.map((job) => {
              const sp = STATUS_PILL[job.status];
              const pp = PLATFORM_PILL[job.platform];
              return (
                <tr key={job.id} className="transition-colors hover:bg-white/[0.02]" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                  <td className="px-5 py-3.5">
                    <span className="font-medium text-foreground">{job.target}</span>
                  </td>
                  <td className="px-5 py-3.5">
                    <span
                      className="inline-flex items-center text-[11px] font-medium px-2.5 py-1 rounded-full"
                      style={{ background: pp.bg, border: `1px solid ${pp.border}`, color: pp.color }}
                    >
                      {job.platform}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-muted-foreground">{job.jobType}</td>
                  <td className="px-5 py-3.5">
                    <span
                      className="inline-flex items-center text-[11px] font-medium px-2.5 py-1 rounded-full"
                      style={{ background: sp.bg, border: `1px solid ${sp.border}`, color: sp.color }}
                    >
                      {sp.label}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-muted-foreground text-xs whitespace-nowrap">{fmtTime(job.createdAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

    </div>
  );
}
