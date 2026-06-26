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

// ── Excel builder layout (profile-audit export) ─────────────────────────────
// Drives which sheets/columns appear and in what order. An empty object on the
// wire means the full default workbook (the export-service treats it that way).
export type SheetKey = "summary" | "details" | "notes";

export type ViewMetric = "play_count" | "view_count";
export type ContentFilter = "all" | "videos" | "images";

export interface ExportLayout {
  summary: { enabled: boolean; images: boolean; dates: boolean; kpi: boolean; videos: boolean };
  details: { enabled: boolean; type: boolean; date: boolean; scrape_range: boolean; sort_order: boolean; url: boolean };
  notes:   { enabled: boolean };
  order:   SheetKey[];
  view_metric: ViewMetric;       // which captured number feeds the "Views" columns
  content_filter: ContentFilter; // limit the export to one content type
}

export const DEFAULT_LAYOUT: ExportLayout = {
  summary: { enabled: true, images: true, dates: true, kpi: true, videos: true },
  details: { enabled: true, type: true, date: true, scrape_range: true, sort_order: true, url: true },
  notes:   { enabled: true },
  order:   ["summary", "details", "notes"],
  view_metric: "play_count",
  content_filter: "all",
};

export type LayoutPreset = "detailed" | "compact" | "per_video" | "custom";

// Canned layouts. "custom" has no entry — it's whatever the user has toggled.
export const LAYOUT_PRESETS: Record<Exclude<LayoutPreset, "custom">, ExportLayout> = {
  // Everything — same as the historical default workbook.
  detailed: DEFAULT_LAYOUT,
  // A tight one-row-per-creator overview: summary only, no per-video grid.
  compact: {
    summary: { enabled: true, images: false, dates: false, kpi: true, videos: false },
    details: { enabled: false, type: true, date: true, scrape_range: false, sort_order: false, url: true },
    notes:   { enabled: false },
    order:   ["summary", "details", "notes"],
    view_metric: "play_count",
    content_filter: "all",
  },
  // Lead with the per-video table; keep the summary + notes after it.
  per_video: {
    summary: { enabled: true, images: true, dates: true, kpi: true, videos: true },
    details: { enabled: true, type: true, date: true, scrape_range: false, sort_order: false, url: true },
    notes:   { enabled: true },
    order:   ["details", "summary", "notes"],
    view_metric: "play_count",
    content_filter: "all",
  },
};

export interface ExportOptions {
  sortBy?: string;       // "Most Recent" | "Oldest" | "Most Views" | "Least Views"
  inclTop5?: boolean;
  inclBot5?: boolean;
  calcMetrics?: string[];            // calculated metrics chosen at export time
  rawMetrics?: string[];             // optional raw columns (Likes/Comments/Shares)
  rates?: Record<string, number>;    // per-KOL rate ($) for CPV, keyed by username
  layout?: ExportLayout;             // Excel builder layout (profile-audit only)
}

const DEFAULT_OPTS: Required<ExportOptions> = {
  sortBy: "Most Recent",
  inclTop5: true,
  inclBot5: false,
  calcMetrics: [],
  rawMetrics: ["Likes", "Comments", "Shares"],
  rates: {},
  layout: DEFAULT_LAYOUT,
};

export function buildExportPayload(job: Job, endpoint: string, opts: ExportOptions = {}) {
  const o = { ...DEFAULT_OPTS, ...opts };
  const base = { project_id: job.project_id, platform: job.platform, endpoint };
  if (endpoint === "export/profile-audit") {
    return {
      ...base, usernames: [job.kol_username].filter(Boolean),
      sort_by: o.sortBy, incl_top5: o.inclTop5, incl_bot5: o.inclBot5,
      limit: Number(job.target_limit) || 0,
      calc_metrics: o.calcMetrics.length ? o.calcMetrics : (job.calc_metrics ?? []),
      raw_metrics: o.rawMetrics,
      rates: o.rates,
      date_from: job.date_from ?? "", date_to: job.date_to ?? "",
      layout: o.layout,
    };
  }
  return { ...base, video_urls: [job.target_url], calc_metrics: o.calcMetrics, raw_metrics: o.rawMetrics };
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
      // Cap to the largest requested limit in the batch (each job's posts-per-profile).
      limit: Math.max(0, ...jobs.map((j) => Number(j.target_limit) || 0)),
      // Metrics + rates are chosen at export time; fall back to the first job's
      // stored metrics for back-compat. Date window comes from the first job.
      calc_metrics: o.calcMetrics.length ? o.calcMetrics : (first.calc_metrics ?? []),
      raw_metrics: o.rawMetrics,
      rates: o.rates,
      date_from: first.date_from ?? "", date_to: first.date_to ?? "",
      layout: o.layout,
    };
  }
  return { ...base, video_urls: jobs.map((j) => j.target_url).filter(Boolean), calc_metrics: o.calcMetrics, raw_metrics: o.rawMetrics };
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
