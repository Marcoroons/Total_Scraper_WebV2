"use client";

import { useState } from "react";
import { Download, RefreshCw, RotateCcw, XCircle } from "lucide-react";
import { useProject } from "@/lib/context/ProjectContext";
import { useJobs, type Job } from "@/lib/hooks/useJobs";
import { JobStatusBadge } from "@/components/JobStatusBadge";

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
  { value: "PENDING", label: "Pending" },
  { value: "AUTO_PROCESSING", label: "Processing" },
  { value: "COMPLETED", label: "Completed" },
  { value: "FAILED", label: "Failed" },
];

// Only job types that have a working export endpoint on the export-service
const EXPORT_ENDPOINTS: Record<string, string> = {
  "Specific URLs (Video Stats)": "export/video-stats",
  "Profile Feed (Audit)":        "export/profile-audit",
  "Comments (Sentiment)":        "export/nlp",
};

function buildExportPayload(job: Job, endpoint: string) {
  const base = { project_id: job.project_id, platform: job.platform, endpoint };
  if (endpoint === "export/profile-audit") {
    return {
      ...base,
      usernames:  [job.kol_username].filter(Boolean),
      sort_by:    "Most Views",
      incl_top5:  true,
      incl_bot5:  false,
    };
  }
  return { ...base, video_urls: [job.target_url] };
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-SG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function QueuePage() {
  const { activeProjectId, activeProjectName } = useProject();
  const [statusFilter, setStatusFilter] = useState("");
  const [jobTypeFilter, setJobTypeFilter] = useState("");
  const [sort, setSort] = useState<"desc" | "asc">("desc");
  const [exportingJobId, setExportingJobId] = useState<string | null>(null);

  const { jobs, isLoading, error, refetch, cancelJob, retryJob } = useJobs(
    activeProjectId,
    {
      status: statusFilter || undefined,
      job_type: jobTypeFilter || undefined,
      sort,
    }
  );

  async function handleCancel(job: Job) {
    try {
      await cancelJob(job.job_id);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Cancel failed");
    }
  }

  async function handleRetry(job: Job) {
    try {
      await retryJob(job.job_id);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Retry failed");
    }
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
      const safeType = job.job_type.toLowerCase().replace(/[^a-z0-9]+/g, "_");
      a.download = `${safeType}_${job.platform.toLowerCase()}_${job.job_id.slice(0, 8)}.xlsx`;
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
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Job Queue</h1>
          {activeProjectName && (
            <p className="text-sm text-gray-500 mt-0.5">{activeProjectName}</p>
          )}
        </div>
        <button
          onClick={refetch}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 bg-white border rounded-lg hover:bg-gray-50 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 mb-5">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 text-sm border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#1F4E78]"
        >
          <option value="">All Statuses</option>
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

        <select
          value={jobTypeFilter}
          onChange={(e) => setJobTypeFilter(e.target.value)}
          className="px-3 py-1.5 text-sm border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#1F4E78]"
        >
          <option value="">All Job Types</option>
          {JOB_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <button
          onClick={() => setSort((s) => (s === "desc" ? "asc" : "desc"))}
          className="px-3 py-1.5 text-sm border rounded-lg bg-white hover:bg-gray-50 transition-colors"
        >
          {sort === "desc" ? "↓ Newest First" : "↑ Oldest First"}
        </button>
      </div>

      {/* Content */}
      {!activeProjectId ? (
        <div className="bg-white border rounded-xl p-12 text-center text-sm text-gray-400">
          Select a project to view its job queue.
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-600">
          {error}
        </div>
      ) : isLoading ? (
        <div className="bg-white border rounded-xl p-12 text-center text-sm text-gray-400">
          Loading jobs…
        </div>
      ) : jobs.length === 0 ? (
        <div className="bg-white border rounded-xl p-12 text-center text-sm text-gray-400">
          No jobs found for the current filters.
        </div>
      ) : (
        <div className="bg-white border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-left">
                <th className="px-4 py-3 font-medium text-gray-600">Target</th>
                <th className="px-4 py-3 font-medium text-gray-600">Platform</th>
                <th className="px-4 py-3 font-medium text-gray-600">Job Type</th>
                <th className="px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 font-medium text-gray-600">Created</th>
                <th className="px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {jobs.map((job) => {
                const canExport = job.status === "COMPLETED" && job.job_type in EXPORT_ENDPOINTS;
                const isExporting = exportingJobId === job.job_id;
                return (
                  <tr key={job.job_id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 max-w-[200px]">
                      <p className="truncate font-medium text-gray-800" title={job.target_url}>
                        {job.kol_username || job.target_url}
                      </p>
                      {job.kol_username && (
                        <p className="text-xs text-gray-400 truncate">{job.target_url}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{job.platform}</td>
                    <td className="px-4 py-3 text-gray-600 max-w-[160px]">
                      <span className="truncate block" title={job.job_type}>{job.job_type}</span>
                    </td>
                    <td className="px-4 py-3">
                      <JobStatusBadge status={job.status} errorMessage={job.error_message} />
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                      {formatDate(job.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {job.status === "PENDING" && (
                          <button
                            onClick={() => handleCancel(job)}
                            title="Cancel job"
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        )}
                        {job.status === "FAILED" && (
                          <button
                            onClick={() => handleRetry(job)}
                            title="Retry job"
                            className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        )}
                        {canExport && (
                          <button
                            onClick={() => handleExport(job)}
                            disabled={isExporting}
                            title={isExporting ? "Generating…" : "Download Excel"}
                            className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-wait"
                          >
                            {isExporting ? (
                              <RefreshCw className="w-4 h-4 animate-spin" />
                            ) : (
                              <Download className="w-4 h-4" />
                            )}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-4 py-2.5 border-t bg-gray-50 text-xs text-gray-400 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
            {jobs.length} job{jobs.length !== 1 ? "s" : ""} · Realtime updates active
          </div>
        </div>
      )}
    </div>
  );
}