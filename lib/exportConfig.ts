import type { Job } from "@/lib/hooks/useJobs";

// Maps a DB job_type to the Railway export endpoint that produces its Excel file.
export const EXPORT_ENDPOINTS: Record<string, string> = {
  "Specific URLs (Video Stats)": "export/video-stats",
  "Profile Feed (Audit)":        "export/profile-audit",
  "Comments (Sentiment)":        "export/nlp",
};

// Friendly "function" filter → the DB job_type it represents.
export const SCRAPE_FUNCTIONS = [
  { key: "profile", label: "Profile",  jobType: "Profile Feed (Audit)",        color: "#a78bfa" },
  { key: "url",     label: "URL",      jobType: "Specific URLs (Video Stats)", color: "#f59e0b" },
  { key: "comment", label: "Comment",  jobType: "Comments (Sentiment)",        color: "#f472b6" },
] as const;

export type FunctionKey = (typeof SCRAPE_FUNCTIONS)[number]["key"];

// Report metrics carried over from the Report Builder.
export const REPORT_METRICS = [
  "Follower Count",      "Engagement Rate",
  "Post Frequency",      "Average Likes",
  "Average Comments",    "Content Categories",
  "Hashtag Strategy",    "Posting Times",
  "Audience Sentiment",  "Growth Rate (30d)",
  "Top Performing Posts","Brand Mentions",
];

export const DEFAULT_METRICS = [
  "Follower Count", "Engagement Rate", "Post Frequency",
  "Average Likes",  "Average Comments", "Content Categories",
];

export interface ExportOptions {
  sortBy?: string;       // "Most Recent" | "Oldest" | "Most Views" | "Least Views"
  inclTop5?: boolean;
  inclBot5?: boolean;
}

const DEFAULT_OPTS: Required<ExportOptions> = {
  sortBy: "Most Recent",
  inclTop5: true,
  inclBot5: false,
};

export function buildExportPayload(job: Job, endpoint: string, opts: ExportOptions = {}) {
  const o = { ...DEFAULT_OPTS, ...opts };
  const base = { project_id: job.project_id, platform: job.platform, endpoint };
  if (endpoint === "export/profile-audit") {
    return { ...base, usernames: [job.kol_username].filter(Boolean), sort_by: o.sortBy, incl_top5: o.inclTop5, incl_bot5: o.inclBot5 };
  }
  return { ...base, video_urls: [job.target_url] };
}

/**
 * Combine many jobs of the SAME endpoint + platform into one export call, so the
 * Railway service returns a single workbook containing all of them. The export
 * endpoints already accept arrays (usernames / video_urls).
 *
 * `jobs` should already be ordered as the user wants them to appear in the file
 * (the export service preserves the usernames array order).
 */
export function buildBatchExportPayload(jobs: Job[], endpoint: string, opts: ExportOptions = {}) {
  const o = { ...DEFAULT_OPTS, ...opts };
  const first = jobs[0];
  const base = { project_id: first.project_id, platform: first.platform, endpoint };
  if (endpoint === "export/profile-audit") {
    return {
      ...base,
      usernames: jobs.map((j) => j.kol_username).filter(Boolean),
      sort_by: o.sortBy,
      incl_top5: o.inclTop5,
      incl_bot5: o.inclBot5,
    };
  }
  return { ...base, video_urls: jobs.map((j) => j.target_url).filter(Boolean) };
}

export function exportFilename(job: Job) {
  return `${job.job_type.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${job.platform.toLowerCase()}_${job.job_id.slice(0, 8)}.xlsx`;
}

export function batchExportFilename(job: Job, count: number) {
  const type = job.job_type.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return `${type}_${job.platform.toLowerCase()}_${count}_items.xlsx`;
}

export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-SG", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}
