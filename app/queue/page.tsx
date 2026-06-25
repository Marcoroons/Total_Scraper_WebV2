"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, RefreshCw, RotateCcw, Trash2, XCircle } from "lucide-react";
import { useProject } from "@/lib/context/ProjectContext";
import { useJobs, type Job } from "@/lib/hooks/useJobs";
import { JobStatusBadge } from "@/components/JobStatusBadge";
import { Exporter } from "@/components/Exporter";
import { TaskLoader } from "@/components/TaskLoader";
import { EXPORT_ENDPOINTS, buildExportPayload, exportFilename, formatDateTime } from "@/lib/exportConfig";

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

const STATUS_SUMMARY = [
  { key: "PENDING",         label: "Pending",    color: "#fbbf24" },
  { key: "AUTO_PROCESSING", label: "Processing", color: "#a78bfa" },
  { key: "COMPLETED",       label: "Completed",  color: "#34d399" },
  { key: "FAILED",          label: "Failed",     color: "#f87171" },
] as const;

const selectCls =
  "px-3 py-1.5 text-sm rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

// ─── Job Queue panel ──────────────────────────────────────────────────────────

function JobQueuePanel({ activeProjectId, onActivity }: { activeProjectId: string | null; onActivity?: (active: boolean) => void }) {
  const [statusFilter,   setStatusFilter]   = useState("");
  const [jobTypeFilter,  setJobTypeFilter]  = useState("");
  const [sort,           setSort]           = useState<"desc" | "asc">("desc");
  const [exportingJobId, setExportingJobId] = useState<string | null>(null);
  const [selectedIds,    setSelectedIds]    = useState<Set<string>>(new Set());
  const [deleting,       setDeleting]       = useState(false);
  const [rescraping,     setRescraping]     = useState(false);

  // Fetch all statuses so the summary counts are accurate; filter by status client-side.
  const { jobs, isLoading, error, refetch, cancelJob, retryJob, deleteJobs, createJobs } = useJobs(
    activeProjectId,
    { job_type: jobTypeFilter || undefined, sort }
  );

  const counts: Record<string, number> = {
    PENDING:         jobs.filter((j) => j.status === "PENDING").length,
    AUTO_PROCESSING: jobs.filter((j) => j.status === "AUTO_PROCESSING").length,
    COMPLETED:       jobs.filter((j) => j.status === "COMPLETED").length,
    FAILED:          jobs.filter((j) => j.status === "FAILED").length,
  };

  const displayedJobs = statusFilter ? jobs.filter((j) => j.status === statusFilter) : jobs;

  // Tell the page when there's outstanding work, so it can show the Task Loading
  // animation in the header while jobs are pending/processing.
  const activeCount = counts.PENDING + counts.AUTO_PROCESSING;
  useEffect(() => { onActivity?.(activeCount > 0); }, [activeCount, onActivity]);

  // ── Row selection + bulk delete ─────────────────────────────────────────────
  // Only ever act on currently-visible (filtered) rows, so a hidden selection
  // can't be deleted by surprise.
  const visibleSelected = displayedJobs.filter((j) => selectedIds.has(j.job_id)).map((j) => j.job_id);
  const allSelected = displayedJobs.length > 0 && visibleSelected.length === displayedJobs.length;

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) displayedJobs.forEach((j) => next.delete(j.job_id));
      else displayedJobs.forEach((j) => next.add(j.job_id));
      return next;
    });
  }
  async function handleDeleteSelected() {
    if (visibleSelected.length === 0) return;
    const n = visibleSelected.length;
    if (!window.confirm(
      `Delete ${n} job${n !== 1 ? "s" : ""} from the queue? This removes the queue ` +
      `entr${n !== 1 ? "ies" : "y"} and can't be undone. Data already scraped is kept.`
    )) return;
    setDeleting(true);
    try {
      await deleteJobs(visibleSelected);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        visibleSelected.forEach((id) => next.delete(id));
        return next;
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  // Re-queue the selected jobs with their original settings — pick the KOLs to
  // re-scrape without re-entering anything. Clones each job's config into a new
  // PENDING job (the API strips id/status/created_at and resets status).
  async function handleRescrapeSelected() {
    const sel = displayedJobs.filter((j) => selectedIds.has(j.job_id));
    if (sel.length === 0) return;
    const n = sel.length;
    if (!window.confirm(
      `Re-scrape ${n} job${n !== 1 ? "s" : ""} with the same settings? ` +
      `${n === 1 ? "A new pending job" : "New pending jobs"} will be queued.`
    )) return;
    setRescraping(true);
    try {
      const payloads = sel.map((j) => {
        const extra = j as unknown as { max_retries?: number; date_multiplier?: number };
        return {
          project_id:    j.project_id,
          target_url:    j.target_url,
          platform:      j.platform,
          job_type:      j.job_type,
          kol_username:  j.kol_username,
          rate:          j.rate,
          raw_metrics:   j.raw_metrics,
          calc_metrics:  j.calc_metrics,
          format_filter: j.format_filter,
          target_limit:  j.target_limit,
          date_from:     j.date_from,
          date_to:       j.date_to,
          ...(j.apify_api_key ? { apify_api_key: j.apify_api_key } : {}),
          ...(extra.max_retries ? { max_retries: extra.max_retries } : {}),
          ...(extra.date_multiplier ? { date_multiplier: extra.date_multiplier } : {}),
        };
      });
      await createJobs(payloads);
      setSelectedIds(new Set());
      await refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Re-scrape failed");
    } finally {
      setRescraping(false);
    }
  }

  // Scraped post counts for completed Profile Feed jobs (kol_snapshots.total_posts),
  // keyed by `${platform}__${username}`. Used to flag scrapes that returned fewer
  // posts than requested.
  const [scrapeCounts, setScrapeCounts] = useState<Record<string, number>>({});

  // Stable key of completed profile creators, so the scrape-count fetch only
  // re-runs when that set actually changes — not on every realtime job tick
  // (which, with 100+ users and live updates, was firing N fetches constantly).
  const profileScrapeKey = useMemo(() =>
    jobs
      .filter((j) => j.status === "COMPLETED" && j.job_type === "Profile Feed (Audit)" && j.kol_username)
      .map((j) => `${j.platform}__${j.kol_username}`)
      .sort()
      .join("|"),
    [jobs]
  );

  useEffect(() => {
    if (!activeProjectId || !profileScrapeKey) { setScrapeCounts({}); return; }

    const byPlatform = new Map<string, Set<string>>();
    for (const pair of profileScrapeKey.split("|")) {
      const sep = pair.indexOf("__");
      if (sep < 0) continue;
      const platform = pair.slice(0, sep);
      const username = pair.slice(sep + 2);
      const set = byPlatform.get(platform) ?? new Set<string>();
      set.add(username);
      byPlatform.set(platform, set);
    }

    let cancelled = false;
    (async () => {
      const merged: Record<string, number> = {};
      for (const [platform, usernames] of Array.from(byPlatform.entries())) {
        const params = new URLSearchParams({
          project_id: activeProjectId,
          platform,
          usernames: Array.from(usernames).join(","),
        });
        try {
          const res = await fetch(`/api/scrape-count?${params}`);
          if (!res.ok) continue;
          const data = await res.json();
          for (const [u, info] of Object.entries(data.counts ?? {})) {
            merged[`${platform}__${u}`] = (info as { total_posts: number }).total_posts;
          }
        } catch { /* best-effort */ }
      }
      if (!cancelled) setScrapeCounts(merged);
    })();
    return () => { cancelled = true; };
  }, [profileScrapeKey, activeProjectId]);

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
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildExportPayload(job, endpoint)),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Export failed" }));
        alert((err as { error?: string }).error ?? "Export failed. Check Railway logs.");
        return;
      }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = exportFilename(job);
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      alert("Export failed — export service may be down.");
    } finally {
      setExportingJobId(null);
    }
  }

  return (
    <div>
      {/* Status summary cards */}
      {activeProjectId && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {STATUS_SUMMARY.map((s) => {
            const active = statusFilter === s.key;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setStatusFilter(active ? "" : s.key)}
                className="rounded-xl border p-4 text-left transition-all"
                style={{
                  background: active ? `${s.color}12` : "#0d1829",
                  borderColor: active ? `${s.color}66` : "rgba(255,255,255,0.07)",
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full inline-block" style={{ background: s.color }} />
                  <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">{s.label}</span>
                </div>
                <p className="text-2xl font-bold mt-1.5" style={{ fontFamily: "Outfit, sans-serif", color: active ? s.color : "#dde4f4" }}>
                  {counts[s.key]}
                </p>
              </button>
            );
          })}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex flex-wrap gap-3">
          {statusFilter && (
            <button
              onClick={() => setStatusFilter("")}
              className="px-3 py-1.5 text-sm rounded-lg border border-border bg-card text-muted-foreground hover:bg-muted transition-colors"
            >
              ✕ {STATUS_SUMMARY.find((s) => s.key === statusFilter)?.label} only
            </button>
          )}
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
        <div className="flex items-center gap-2">
          {visibleSelected.length > 0 && (
            <button
              onClick={handleRescrapeSelected}
              disabled={rescraping || deleting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-colors disabled:opacity-50"
              style={{ borderColor: "rgba(0,201,255,0.4)", color: "#00c9ff", background: "rgba(0,201,255,0.08)" }}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {rescraping ? "Re-scraping…" : `Re-scrape (${visibleSelected.length})`}
            </button>
          )}
          {visibleSelected.length > 0 && (
            <button
              onClick={handleDeleteSelected}
              disabled={deleting || rescraping}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-colors disabled:opacity-50"
              style={{ borderColor: "rgba(239,68,68,0.4)", color: "#f87171", background: "rgba(239,68,68,0.08)" }}
            >
              <Trash2 className="w-3.5 h-3.5" />
              {deleting ? "Deleting…" : `Delete (${visibleSelected.length})`}
            </button>
          )}
          <button
            onClick={refetch}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground bg-card border border-border rounded-lg hover:bg-muted transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
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
      ) : displayedJobs.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center text-sm text-muted-foreground">
          No jobs found for the current filters.
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted text-left">
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all jobs"
                    className="accent-primary cursor-pointer align-middle"
                  />
                </th>
                {["Target", "Platform", "Job Type", "Status", "Created", "Actions"].map((h) => (
                  <th key={h} className="px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {displayedJobs.map((job) => {
                const canExport  = job.status === "COMPLETED" && job.job_type in EXPORT_ENDPOINTS;
                const isExporting = exportingJobId === job.job_id;
                return (
                  <tr key={job.job_id} className={`hover:bg-muted/50 transition-colors ${selectedIds.has(job.job_id) ? "bg-primary/5" : ""}`}>
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(job.job_id)}
                        onChange={() => toggleOne(job.job_id)}
                        aria-label="Select job"
                        className="accent-primary cursor-pointer align-middle"
                      />
                    </td>
                    <td className="px-4 py-3 max-w-[200px]">
                      <p className="truncate font-medium text-foreground" title={job.target_url}>{job.kol_username || job.target_url}</p>
                      {job.kol_username && <p className="text-xs text-muted-foreground truncate">{job.target_url}</p>}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{job.platform}</td>
                    <td className="px-4 py-3 text-muted-foreground max-w-[160px]">
                      <span className="truncate block" title={job.job_type}>{job.job_type}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1 items-start">
                        <JobStatusBadge status={job.status} errorMessage={job.error_message} />
                        {(() => {
                          if (job.status !== "COMPLETED" || job.job_type !== "Profile Feed (Audit)") return null;
                          const scraped = scrapeCounts[`${job.platform}__${job.kol_username}`];
                          if (scraped === undefined) return null;
                          const requested = job.target_limit;
                          const short = requested > 0 && scraped < requested;
                          return (
                            <span
                              className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded"
                              title={short
                                ? `This scrape returned ${scraped} post(s), fewer than the ${requested} requested.`
                                : `Scraped ${scraped} post(s).`}
                              style={short
                                ? { background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", color: "#fbbf24" }
                                : { background: "rgba(90,114,148,0.1)", border: "1px solid rgba(90,114,148,0.25)", color: "#8899b0" }}
                            >
                              {short && <AlertTriangle className="w-2.5 h-2.5" />}
                              {short ? `${scraped} of ${requested} posts` : `${scraped} posts`}
                            </span>
                          );
                        })()}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">{formatDateTime(job.created_at)}</td>
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
            {displayedJobs.length} job{displayedJobs.length !== 1 ? "s" : ""}{statusFilter ? " shown" : ""} · Realtime updates active
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "queue",    label: "Job Queue" },
  { id: "exporter", label: "Exporter" },
] as const;

type Tab = (typeof TABS)[number]["id"];

export default function QueuePage() {
  const { activeProjectId, activeProjectName } = useProject();
  const [tab, setTab] = useState<Tab>("queue");
  const [queueActive, setQueueActive] = useState(false);

  return (
    <div>
      {/* Header — Task Loading animation sits in the empty band, right side */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">Queue &amp; Export</h1>
          {activeProjectName && (
            <p className="text-sm text-muted-foreground mt-0.5">{activeProjectName}</p>
          )}
        </div>
        {tab === "queue" && queueActive && <TaskLoader />}
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
              <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t" style={{ background: "#00c9ff" }} />
            )}
          </button>
        ))}
      </div>

      {tab === "queue"    && <JobQueuePanel activeProjectId={activeProjectId} onActivity={setQueueActive} />}
      {tab === "exporter" && <Exporter activeProjectId={activeProjectId} />}
    </div>
  );
}
