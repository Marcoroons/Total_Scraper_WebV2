"use client";

import { useState, useId } from "react";
import { Plus, X } from "lucide-react";
import { useProject } from "@/lib/context/ProjectContext";
import { useJobs } from "@/lib/hooks/useJobs";
import { PlatformToggle } from "@/components/PlatformToggle";
import { MetricsSelector } from "@/components/MetricsSelector";
import { ApifyKeyInput } from "@/components/ApifyKeyInput";

type Platform = "Instagram" | "TikTok";

const FORMAT_OPTIONS = ["Reels Only", "All Formats", "Images/Carousel Only"] as const;
const SORT_OPTIONS   = ["Most Recent", "Oldest", "Most Views", "Least Views"] as const;

function extractHandle(raw: string, platform: Platform): string {
  const s = raw.trim();
  if (!s) return "";
  if (s.startsWith("@")) return s.slice(1).split("/")[0].trim();
  if (!s.startsWith("http")) return s.replace(/[^\w._]/g, "");
  const path = s.replace(/https?:\/\/(www\.)?/, "").replace(/^\/|\/$/g, "");
  const parts = path.split("/").filter(Boolean);
  if (platform === "Instagram") {
    if (parts.length >= 2 && !["p","reel","stories","explore","reels","tv"].includes(parts[1]))
      return parts[1];
    if (parts.length === 1) return parts[0];
    return "";
  }
  for (const p of parts) if (p.startsWith("@")) return p.slice(1);
  return parts[parts.length - 1] ?? "";
}

function ProfileTable({
  rows,
  onChange,
}: {
  rows: string[];
  onChange: (r: string[]) => void;
}) {
  const uid = useId();

  function update(i: number, v: string) {
    const next = [...rows];
    next[i] = v;
    onChange(next);
  }

  function remove(i: number) {
    onChange(rows.filter((_, idx) => idx !== i));
  }

  function handlePaste(i: number, e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text");
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length <= 1) return;
    e.preventDefault();
    const next = [...rows];
    next.splice(i, 1, ...lines);
    onChange(next.filter((v, idx) => v || idx === next.length - 1));
  }

  return (
    <div className="space-y-2">
      {rows.map((row, i) => (
        <div key={`${uid}-${i}`} className="flex items-center gap-2">
          <input
            type="text"
            value={row}
            placeholder="https://www.instagram.com/username/ or @handle"
            onChange={(e) => update(i, e.target.value)}
            onPaste={(e) => handlePaste(i, e)}
            className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1F4E78]"
          />
          <button
            type="button"
            onClick={() => remove(i)}
            disabled={rows.length === 1}
            className="p-1.5 text-gray-300 hover:text-red-400 disabled:opacity-20 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...rows, ""])}
        className="flex items-center gap-1.5 text-xs text-[#1F4E78] hover:text-[#2E86AB] transition-colors"
      >
        <Plus className="w-3.5 h-3.5" />
        Add row
      </button>
    </div>
  );
}

export default function ProfileTrackerPage() {
  const { activeProjectId, activeProjectName } = useProject();
  const { createJobs } = useJobs(null);

  const [platform,    setPlatform]    = useState<Platform>("Instagram");
  const [format,      setFormat]      = useState<string>("");
  const [postLimit,   setPostLimit]   = useState(10);
  const [startMode,   setStartMode]   = useState<"all" | "specific">("all");
  const [endMode,     setEndMode]     = useState<"now" | "specific">("now");
  const [dateFrom,    setDateFrom]    = useState("");
  const [dateTo,      setDateTo]      = useState("");
  const [sortBy,      setSortBy]      = useState<string>("");
  const [top5,        setTop5]        = useState(false);
  const [bot5,        setBot5]        = useState(false);
  const [rawMetrics,  setRawMetrics]  = useState<string[]>([]);
  const [calcMetrics, setCalcMetrics] = useState<string[]>([]);
  const [profiles,    setProfiles]    = useState<string[]>([""]);
  const [apifyKey,    setApifyKey]    = useState("");
  const [errors,      setErrors]      = useState<string[]>([]);
  const [queuing,     setQueuing]     = useState(false);
  const [successCount, setSuccessCount] = useState<number | null>(null);

  const isTikTok = platform === "TikTok";
  const dateInvalid = dateFrom && dateTo && dateFrom > dateTo;

  async function handleQueue() {
    if (!activeProjectId) return;
    setSuccessCount(null);

    const errs: string[] = [];
    if (!isTikTok && !format) errs.push("Content type not selected (choose Reels Only, All Formats, or Images/Carousel Only).");
    if (!sortBy) errs.push("Sort order not selected.");
    const filled = profiles.filter((p) => p.trim());
    if (filled.length === 0) errs.push("No profiles entered — add at least one URL or @handle.");
    if (rawMetrics.length === 0 && calcMetrics.length === 0) errs.push("No metrics selected — pick at least one raw or calculated metric.");
    if (dateInvalid) errs.push("Date range invalid — start date is after end date.");

    setErrors(errs);
    if (errs.length > 0) return;

    const jobs = [];
    const warnings: string[] = [];

    for (const raw of filled) {
      const handle = extractHandle(raw, platform);
      if (!handle) {
        warnings.push(`Could not extract username from: ${raw.slice(0, 50)}`);
        continue;
      }
      const url = platform === "Instagram"
        ? `https://www.instagram.com/${handle}/`
        : `https://www.tiktok.com/@${handle}`;

      // sort_by / incl_top5 / incl_bot5 are NOT columns in scrape_jobs —
      // they are export-time parameters (passed to /export/profile-audit).
      // date_from / date_to ARE columns if worker.py uses them; include them
      // only when the user actually set a date so we don't blow up on old schemas.
      const job: Record<string, unknown> = {
        project_id:    activeProjectId,
        target_url:    url,
        platform,
        job_type:      "Profile Feed (Audit)",
        kol_username:  handle,
        rate:          "",
        raw_metrics:   rawMetrics,
        calc_metrics:  calcMetrics,
        format_filter: isTikTok ? "All Formats" : format,
        target_limit:  postLimit,
        ...(apifyKey.trim() ? { apify_api_key: apifyKey.trim() } : {}),
      };
      if (startMode === "specific" && dateFrom) job.date_from = dateFrom;
      if (endMode   === "specific" && dateTo)   job.date_to   = dateTo;
      jobs.push(job);
    }

    if (warnings.length > 0) {
      setErrors(warnings);
      if (jobs.length === 0) return;
    }

    setQueuing(true);
    try {
      await createJobs(jobs);
      setSuccessCount(jobs.length);
      setProfiles([""]);
      setErrors([]);
    } catch (e) {
      setErrors([e instanceof Error ? e.message : "Failed to queue jobs. Try again."]);
    } finally {
      setQueuing(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Profile Tracker</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Scrape a creator&apos;s profile feed for audit.
          {activeProjectName && <span> · {activeProjectName}</span>}
        </p>
      </div>

      <div className="space-y-6">
        {/* Platform */}
        <div className="bg-white border rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">Platform</h2>
          <PlatformToggle
            value={platform}
            onChange={(p) => {
              setPlatform(p as Platform);
              setFormat("");
              setRawMetrics([]);
              setCalcMetrics([]);
            }}
          />
        </div>

        {/* Format (Instagram only) */}
        {!isTikTok && (
          <div className="bg-white border rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-semibold text-gray-700">
              Content type <span className="text-red-500">*</span>
            </h2>
            <div className="flex flex-wrap gap-2">
              {FORMAT_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setFormat(opt)}
                  className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                    format === opt
                      ? "bg-[#1F4E78] text-white border-[#1F4E78]"
                      : "bg-white text-gray-600 border-gray-200 hover:border-[#1F4E78]"
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
            {format === "Reels Only" && (
              <p className="text-xs text-gray-400">
                Uses the dedicated Apify Reel Scraper — chronological, excludes pinned. Cheaper and more accurate than scraping all posts.
              </p>
            )}
          </div>
        )}

        {/* Posts per profile */}
        <div className="bg-white border rounded-xl p-5 space-y-2">
          <h2 className="text-sm font-semibold text-gray-700">Posts per profile</h2>
          <input
            type="number"
            min={1}
            max={200}
            value={postLimit}
            onChange={(e) => setPostLimit(Math.min(200, Math.max(1, Number(e.target.value) || 1)))}
            className="w-28 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1F4E78]"
          />
        </div>

        {/* Date range */}
        <div className="bg-white border rounded-xl p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">Date range <span className="font-normal text-gray-400">(optional)</span></h2>
            <p className="text-xs text-gray-400 mt-1">
              Instagram fetches forward from a start date — end-date filtering happens on our side and may cost a few extra Apify credits.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-600">Start</p>
              <div className="flex flex-col gap-1">
                {(["all", "specific"] as const).map((m) => (
                  <label key={m} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      checked={startMode === m}
                      onChange={() => { setStartMode(m); if (m === "all") setDateFrom(""); }}
                      className="accent-[#1F4E78]"
                    />
                    {m === "all" ? "From the start (no known date)" : "Specific date"}
                  </label>
                ))}
              </div>
              {startMode === "specific" && (
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1F4E78]"
                />
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-600">End</p>
              <div className="flex flex-col gap-1">
                {(["now", "specific"] as const).map((m) => (
                  <label key={m} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      checked={endMode === m}
                      onChange={() => { setEndMode(m); if (m === "now") setDateTo(""); }}
                      className="accent-[#1F4E78]"
                    />
                    {m === "now" ? "Latest (now)" : "Specific date"}
                  </label>
                ))}
              </div>
              {endMode === "specific" && (
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1F4E78]"
                />
              )}
            </div>
          </div>

          {dateInvalid && (
            <p className="text-xs text-red-500">Start date is after end date.</p>
          )}
          {!dateInvalid && (dateFrom || dateTo) && (
            <p className="text-xs text-blue-600">
              Range: {dateFrom || "start"} → {dateTo || "now"}
            </p>
          )}
        </div>

        {/* Sort order */}
        <div className="bg-white border rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">
            Sort videos by in export <span className="text-red-500">*</span>
          </h2>
          <div className="flex flex-wrap gap-2">
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setSortBy(opt)}
                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                  sortBy === opt
                    ? "bg-[#1F4E78] text-white border-[#1F4E78]"
                    : "bg-white text-gray-600 border-gray-200 hover:border-[#1F4E78]"
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-6 pt-1">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={top5}
                onChange={(e) => setTop5(e.target.checked)}
                className="accent-[#1F4E78]"
              />
              Include Top 5 links + avg
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={bot5}
                onChange={(e) => setBot5(e.target.checked)}
                className="accent-[#1F4E78]"
              />
              Include Bottom 5 links + avg
            </label>
          </div>
        </div>

        {/* Metrics */}
        <div className="bg-white border rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">
            Metrics to include in export <span className="text-red-500">*</span>
          </h2>
          <MetricsSelector
            platform={platform}
            rawSelected={rawMetrics}
            calcSelected={calcMetrics}
            onRawChange={setRawMetrics}
            onCalcChange={setCalcMetrics}
          />
        </div>

        {/* Profiles */}
        <div className="bg-white border rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">
            Profiles to scrape
            <span className="ml-1.5 text-gray-400 font-normal text-xs">
              paste multiple lines to fill all at once
            </span>
          </h2>
          <ProfileTable rows={profiles} onChange={setProfiles} />
        </div>

        {/* Apify key */}
        <ApifyKeyInput value={apifyKey} onChange={setApifyKey} />

        {/* Errors */}
        {errors.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-1">
            {errors.map((e, i) => (
              <p key={i} className="text-sm text-red-600">⚠️ {e}</p>
            ))}
          </div>
        )}

        {/* Success */}
        {successCount !== null && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4">
            <p className="text-sm text-green-700">
              ✅ {successCount} profile audit{successCount !== 1 ? "s" : ""} queued. Track progress in{" "}
              <a href="/queue" className="font-semibold underline">Queue</a>.
            </p>
          </div>
        )}

        {/* Queue button */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleQueue}
            disabled={queuing || !activeProjectId}
            className="px-6 py-2.5 bg-[#1F4E78] text-white text-sm font-semibold rounded-lg hover:bg-[#2E86AB] transition-colors disabled:opacity-50"
          >
            {queuing ? "Queuing..." : "Queue Profile Audit"}
          </button>
          {!activeProjectId && (
            <p className="text-sm text-gray-400">Select a project first.</p>
          )}
        </div>
      </div>
    </div>
  );
}
