"use client";

import { useState, useId } from "react";
import {
  Download, FileText, Plus, RefreshCw, RotateCcw, X, XCircle,
} from "lucide-react";
import { useProject } from "@/lib/context/ProjectContext";
import { useJobs, type Job } from "@/lib/hooks/useJobs";
import { JobStatusBadge } from "@/components/JobStatusBadge";

// ─── Job Queue constants ──────────────────────────────────────────────────────

const JOB_TYPES = [
  "Profile Feed (Audit)",
  "Specific URLs (Video Stats)",
  "Comments (Sentiment)",
  "Trend Discovery (Hashtag)",
  "Trend Discovery (User Profile)",
  "Competitor Ads (Meta)",
  "YouTube Intelligence",
  "E-Commerce Intelligence",
];

const STATUSES = [
  { value: "PENDING",         label: "Pending" },
  { value: "AUTO_PROCESSING", label: "Processing" },
  { value: "COMPLETED",       label: "Completed" },
  { value: "FAILED",          label: "Failed" },
];

const EXPORT_ENDPOINTS: Record<string, string> = {
  "Specific URLs (Video Stats)": "export/video-stats",
  "Profile Feed (Audit)":        "export/profile-audit",
  "Comments (Sentiment)":        "export/nlp",
};

function buildExportPayload(job: Job, endpoint: string) {
  const base = { project_id: job.project_id, platform: job.platform, endpoint };
  if (endpoint === "export/profile-audit") {
    return { ...base, usernames: [job.kol_username].filter(Boolean), sort_by: "Most Views", incl_top5: true, incl_bot5: false };
  }
  return { ...base, video_urls: [job.target_url] };
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-SG", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ─── Report Builder constants ─────────────────────────────────────────────────

const DATE_RANGES = ["7d", "14d", "30d", "90d", "6mo"];

const REPORT_METRICS = [
  "Follower Count",      "Engagement Rate",
  "Post Frequency",      "Average Likes",
  "Average Comments",    "Content Categories",
  "Hashtag Strategy",    "Posting Times",
  "Audience Sentiment",  "Growth Rate (30d)",
  "Top Performing Posts","Brand Mentions",
];

const DEFAULT_METRICS = [
  "Follower Count", "Engagement Rate", "Post Frequency",
  "Average Likes",  "Average Comments", "Content Categories",
];

type RbPlatform = "Instagram" | "TikTok";

interface Competitor {
  id: string;
  handle: string;
  platform: RbPlatform;
  selected: boolean;
}

const PLATFORM_COLORS: Record<RbPlatform, string> = {
  Instagram: "#e1306c",
  TikTok: "#00c9ff",
};

const selectCls =
  "px-3 py-1.5 text-sm rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

// ─── Job Queue panel ──────────────────────────────────────────────────────────

function JobQueuePanel({ activeProjectId, activeProjectName }: { activeProjectId: string | null; activeProjectName: string | null }) {
  const [statusFilter,   setStatusFilter]   = useState("");
  const [jobTypeFilter,  setJobTypeFilter]  = useState("");
  const [sort,           setSort]           = useState<"desc" | "asc">("desc");
  const [exportingJobId, setExportingJobId] = useState<string | null>(null);

  const { jobs, isLoading, error, refetch, cancelJob, retryJob } = useJobs(
    activeProjectId,
    { status: statusFilter || undefined, job_type: jobTypeFilter || undefined, sort }
  );

  async function handleCancel(job: Job) {
    try { await cancelJob(job.job_id); }
    catch (e) { alert(e instanceof Error ? e.message : "Cancel failed"); }
  }

  async function handleRetry(job: Job) {
    try { await retryJob(job.job_id); }
    catch (e) { alert(e instanceof Error ? e.message : "Retry failed"); }
  }

  async function handleExport(job: Job) {
    const endpoint = EXPORT_ENDPOINTS[job.job_type];
    if (!endpoint) return;
    setExportingJobId(job.job_id);
    try {
      const payload = buildExportPayload(job, endpoint);
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Export failed" }));
        alert((err as { error?: string }).error ?? "Export failed. Check Railway logs.");
        return;
      }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `${job.job_type.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${job.platform.toLowerCase()}_${job.job_id.slice(0, 8)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      alert("Export failed — export service may be down.");
    } finally {
      setExportingJobId(null);
    }
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex flex-wrap gap-3">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={selectCls}>
            <option value="">All Statuses</option>
            {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select value={jobTypeFilter} onChange={(e) => setJobTypeFilter(e.target.value)} className={selectCls}>
            <option value="">All Job Types</option>
            {JOB_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button
            onClick={() => setSort((s) => (s === "desc" ? "asc" : "desc"))}
            className="px-3 py-1.5 text-sm text-muted-foreground border border-border rounded-lg bg-card hover:bg-muted transition-colors"
          >
            {sort === "desc" ? "↓ Newest First" : "↑ Oldest First"}
          </button>
        </div>
        <button
          onClick={refetch}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground bg-card border border-border rounded-lg hover:bg-muted transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {/* Table */}
      {!activeProjectId ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center text-sm text-muted-foreground">
          Select a project to view its job queue.
        </div>
      ) : error ? (
        <div className="rounded-xl p-4 text-sm" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#ef4444" }}>
          {error}
        </div>
      ) : isLoading ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center text-sm text-muted-foreground">
          Loading jobs…
        </div>
      ) : jobs.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center text-sm text-muted-foreground">
          No jobs found for the current filters.
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted text-left">
                {["Target", "Platform", "Job Type", "Status", "Created", "Actions"].map((h) => (
                  <th key={h} className="px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {jobs.map((job) => {
                const canExport  = job.status === "COMPLETED" && job.job_type in EXPORT_ENDPOINTS;
                const isExporting = exportingJobId === job.job_id;
                return (
                  <tr key={job.job_id} className="hover:bg-muted/50 transition-colors">
                    <td className="px-4 py-3 max-w-[200px]">
                      <p className="truncate font-medium text-foreground" title={job.target_url}>{job.kol_username || job.target_url}</p>
                      {job.kol_username && <p className="text-xs text-muted-foreground truncate">{job.target_url}</p>}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{job.platform}</td>
                    <td className="px-4 py-3 text-muted-foreground max-w-[160px]">
                      <span className="truncate block" title={job.job_type}>{job.job_type}</span>
                    </td>
                    <td className="px-4 py-3">
                      <JobStatusBadge status={job.status} errorMessage={job.error_message} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">{formatDate(job.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {job.status === "PENDING" && (
                          <button onClick={() => handleCancel(job)} title="Cancel" className="p-1.5 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
                            <XCircle className="w-4 h-4" />
                          </button>
                        )}
                        {job.status === "FAILED" && (
                          <button onClick={() => handleRetry(job)} title="Retry" className="p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-colors">
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        )}
                        {canExport && (
                          <button onClick={() => handleExport(job)} disabled={isExporting} title={isExporting ? "Generating…" : "Download Excel"} className="p-1.5 text-muted-foreground hover:text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-wait">
                            {isExporting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-4 py-2.5 border-t border-border bg-muted text-xs text-muted-foreground flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: "#10b981" }} />
            {jobs.length} job{jobs.length !== 1 ? "s" : ""} · Realtime updates active
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Report Builder panel ─────────────────────────────────────────────────────

function ReportBuilderPanel({ activeProjectId }: { activeProjectId: string | null }) {
  const uid = useId();

  // Competitors state
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [newHandle,   setNewHandle]   = useState("");
  const [newPlatform, setNewPlatform] = useState<RbPlatform>("Instagram");

  // Config state
  const [dateRange,      setDateRange]      = useState("30d");
  const [metrics,        setMetrics]        = useState<string[]>(DEFAULT_METRICS);
  const [emailScheduled, setEmailScheduled] = useState(false);
  const [generating,     setGenerating]     = useState(false);
  const [result,         setResult]         = useState<"idle" | "queued" | "error">("idle");

  function addCompetitor() {
    const handle = newHandle.trim().replace(/^@/, "");
    if (!handle) return;
    setCompetitors((prev) => [
      ...prev,
      { id: `${uid}-${Date.now()}`, handle, platform: newPlatform, selected: true },
    ]);
    setNewHandle("");
  }

  function removeCompetitor(id: string) {
    setCompetitors((prev) => prev.filter((c) => c.id !== id));
  }

  function toggleSelected(id: string) {
    setCompetitors((prev) => prev.map((c) => c.id === id ? { ...c, selected: !c.selected } : c));
  }

  function toggleMetric(m: string) {
    setMetrics((prev) => prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]);
  }

  async function handleGenerate() {
    if (!activeProjectId) return;
    const selected = competitors.filter((c) => c.selected);
    if (selected.length === 0 || metrics.length === 0) return;
    setGenerating(true);
    setResult("idle");
    // Simulate report queuing — replace with real API call when backend is ready
    await new Promise((r) => setTimeout(r, 800));
    setResult("queued");
    setGenerating(false);
  }

  const selectedCount = competitors.filter((c) => c.selected).length;
  const canGenerate   = activeProjectId && selectedCount > 0 && metrics.length > 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-5 items-start">

      {/* ── Left column ── */}
      <div className="space-y-4">

        {/* Competitors */}
        <div className="bg-card border border-border rounded-xl p-5">
          <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-4">Select competitors</p>

          {competitors.length === 0 ? (
            <p className="text-xs text-muted-foreground mb-4">No competitors added yet.</p>
          ) : (
            <div className="space-y-2 mb-4">
              {competitors.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all cursor-pointer"
                  style={{
                    background: c.selected ? "rgba(0,201,255,0.05)" : "var(--input)",
                    borderColor: c.selected ? "rgba(0,201,255,0.25)" : "rgba(255,255,255,0.07)",
                  }}
                  onClick={() => toggleSelected(c.id)}
                >
                  {/* Checkbox */}
                  <div
                    className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border transition-all"
                    style={{
                      background: c.selected ? "#00c9ff" : "transparent",
                      borderColor: c.selected ? "#00c9ff" : "rgba(255,255,255,0.2)",
                    }}
                  >
                    {c.selected && (
                      <svg className="w-2.5 h-2.5 text-[#060c18]" viewBox="0 0 10 8" fill="none">
                        <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">@{c.handle}</p>
                  </div>

                  {/* Platform badge */}
                  <span
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                    style={{ background: `${PLATFORM_COLORS[c.platform]}15`, color: PLATFORM_COLORS[c.platform] }}
                  >
                    {c.platform === "Instagram" ? "instagram" : "tiktok"}
                  </span>

                  {/* Remove */}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeCompetitor(c.id); }}
                    className="p-0.5 text-muted-foreground hover:text-red-400 transition-colors flex-shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add competitor row */}
          <div className="flex gap-2">
            <input
              type="text"
              value={newHandle}
              onChange={(e) => setNewHandle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCompetitor()}
              placeholder="@handle or username"
              className="flex-1 px-2.5 py-1.5 text-sm rounded-lg bg-input border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <select
              value={newPlatform}
              onChange={(e) => setNewPlatform(e.target.value as RbPlatform)}
              className="px-2 py-1.5 text-xs rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="Instagram">IG</option>
              <option value="TikTok">TT</option>
            </select>
            <button
              type="button"
              onClick={addCompetitor}
              disabled={!newHandle.trim()}
              className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-primary hover:border-primary transition-colors disabled:opacity-40"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Date range */}
        <div className="bg-card border border-border rounded-xl p-5">
          <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-3">Date range</p>
          <div className="flex gap-2">
            {DATE_RANGES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setDateRange(r)}
                className="flex-1 py-1.5 text-xs font-mono rounded-lg border transition-all"
                style={
                  dateRange === r
                    ? { background: "rgba(0,201,255,0.12)", borderColor: "#00c9ff", color: "#00c9ff" }
                    : { background: "var(--input)", borderColor: "rgba(255,255,255,0.07)", color: "#5a7294" }
                }
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {/* Scheduled email delivery */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Scheduled email delivery</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {emailScheduled ? "Report will be emailed weekly" : "One-time report generation"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setEmailScheduled((v) => !v)}
              className="relative w-10 h-5 rounded-full transition-colors flex-shrink-0"
              style={{ background: emailScheduled ? "#00c9ff" : "var(--muted)" }}
            >
              <span
                className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                style={{ left: emailScheduled ? "calc(100% - 18px)" : "2px" }}
              />
            </button>
          </div>
        </div>

        {/* Generate button */}
        <button
          type="button"
          onClick={handleGenerate}
          disabled={!canGenerate || generating}
          className="w-full py-3 text-sm font-semibold rounded-xl flex items-center justify-center gap-2 transition-opacity hover:opacity-90 disabled:opacity-40"
          style={{ background: "linear-gradient(135deg, #00c9ff, #0087d8)", color: "#060c18" }}
        >
          <FileText className="w-4 h-4" />
          {generating ? "Generating…" : "Generate report"}
        </button>
      </div>

      {/* ── Right column ── */}
      <div className="space-y-4">

        {/* Metrics */}
        <div className="bg-card border border-border rounded-xl p-5">
          <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-4">Report metrics</p>
          <div className="grid grid-cols-2 gap-2">
            {REPORT_METRICS.map((m) => {
              const active = metrics.includes(m);
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => toggleMetric(m)}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-left transition-all"
                  style={{
                    background: active ? "rgba(0,201,255,0.05)" : "var(--input)",
                    borderColor: active ? "rgba(0,201,255,0.3)" : "rgba(255,255,255,0.07)",
                  }}
                >
                  {/* Checkbox */}
                  <div
                    className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center border transition-all"
                    style={{
                      background: active ? "#00c9ff" : "transparent",
                      borderColor: active ? "#00c9ff" : "rgba(255,255,255,0.2)",
                    }}
                  >
                    {active && (
                      <svg className="w-2.5 h-2.5 text-[#060c18]" viewBox="0 0 10 8" fill="none">
                        <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                  <span className="text-sm" style={{ color: active ? "#dde4f4" : "#5a7294" }}>{m}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Output / preview */}
        <div className="bg-card border border-border rounded-xl p-5 min-h-[180px] flex items-center justify-center">
          {result === "queued" ? (
            <div className="text-center">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center mx-auto mb-3"
                style={{ background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.25)" }}
              >
                <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" style={{ color: "#10b981" }}>
                  <path d="M4 10l4 4 8-8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p className="text-sm font-medium" style={{ color: "#10b981" }}>Report queued</p>
              <p className="text-xs text-muted-foreground mt-1">
                {selectedCount} competitor{selectedCount !== 1 ? "s" : ""} · {metrics.length} metrics · {dateRange}
                {emailScheduled && " · email scheduled"}
              </p>
            </div>
          ) : (
            <div className="text-center">
              <FileText className="w-8 h-8 text-muted-foreground mx-auto mb-3 opacity-40" />
              <p className="text-sm text-muted-foreground">
                {!activeProjectId
                  ? "Select a project first."
                  : competitors.length === 0
                  ? "Add competitors, configure metrics, then generate."
                  : "Select competitors, configure metrics, then generate."}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "queue",   label: "Job Queue" },
  { id: "builder", label: "Report Builder" },
] as const;

type Tab = (typeof TABS)[number]["id"];

export default function QueuePage() {
  const { activeProjectId, activeProjectName } = useProject();
  const [tab, setTab] = useState<Tab>("queue");

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">Queue &amp; Export</h1>
          {activeProjectName && (
            <p className="text-sm text-muted-foreground mt-0.5">{activeProjectName}</p>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-0 mb-6 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className="px-4 py-2.5 text-sm font-medium transition-all relative"
            style={{ color: tab === t.id ? "#00c9ff" : "#5a7294" }}
          >
            {t.label}
            {tab === t.id && (
              <span
                className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t"
                style={{ background: "#00c9ff" }}
              />
            )}
          </button>
        ))}
      </div>

      {tab === "queue"   && <JobQueuePanel activeProjectId={activeProjectId} activeProjectName={activeProjectName} />}
      {tab === "builder" && <ReportBuilderPanel activeProjectId={activeProjectId} />}
    </div>
  );
}
