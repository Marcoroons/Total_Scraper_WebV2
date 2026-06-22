"use client";

import { useState, useId } from "react";
import { Plus, X } from "lucide-react";
import { useProject } from "@/lib/context/ProjectContext";
import { useJobs, type JobPayload } from "@/lib/hooks/useJobs";
import { PlatformToggle } from "@/components/PlatformToggle";
import { MetricsSelector } from "@/components/MetricsSelector";
import { ApifyKeyInput } from "@/components/ApifyKeyInput";

type Platform = "Instagram" | "TikTok";

const ACCENT = "#a78bfa";

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

const inputCls =
  "px-3 py-1.5 text-sm rounded-lg bg-input border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent";

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
            className={`flex-1 ${inputCls}`}
          />
          <button
            type="button"
            onClick={() => remove(i)}
            disabled={rows.length === 1}
            className="p-1.5 text-muted-foreground hover:text-red-400 disabled:opacity-20 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...rows, ""])}
        className="flex items-center gap-1.5 text-xs text-primary hover:opacity-80 transition-opacity"
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

    const jobs: JobPayload[] = [];
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
      // they are export-time parameters passed to /export/profile-audit.
      jobs.push({
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
        ...(startMode === "specific" && dateFrom ? { date_from: dateFrom } : {}),
        ...(endMode   === "specific" && dateTo   ? { date_to:   dateTo   } : {}),
        ...(apifyKey.trim() ? { apify_api_key: apifyKey.trim() } : {}),
      });
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
        <h1 className="text-xl font-bold text-foreground">Profile Tracker</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Scrape a creator&apos;s profile feed for audit.
          {activeProjectName && <span> · {activeProjectName}</span>}
        </p>
      </div>

      <div className="space-y-6">
        {/* Platform */}
        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Platform</p>
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
          <div className="bg-card border border-border rounded-xl p-5 space-y-3">
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              Content type <span className="text-red-400">*</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {FORMAT_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setFormat(opt)}
                  className="px-3 py-1.5 text-sm rounded-lg border transition-all"
                  style={
                    format === opt
                      ? { background: `${ACCENT}18`, borderColor: ACCENT, color: ACCENT }
                      : { background: "var(--card)", borderColor: "rgba(255,255,255,0.07)", color: "#8899b0" }
                  }
                >
                  {opt}
                </button>
              ))}
            </div>
            {format === "Reels Only" && (
              <p className="text-xs text-muted-foreground">
                Uses the dedicated Apify Reel Scraper — chronological, excludes pinned. Cheaper and more accurate than scraping all posts.
              </p>
            )}
          </div>
        )}

        {/* Posts per profile */}
        <div className="bg-card border border-border rounded-xl p-5 space-y-2">
          <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Posts per profile</p>
          <input
            type="number"
            min={1}
            max={200}
            value={postLimit}
            onChange={(e) => setPostLimit(Math.min(200, Math.max(1, Number(e.target.value) || 1)))}
            className={`w-28 ${inputCls}`}
          />
        </div>

        {/* Date range */}
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              Date range <span className="normal-case tracking-normal font-normal">(optional)</span>
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Instagram fetches forward from a start date — end-date filtering happens on our side and may cost a few extra Apify credits.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Start</p>
              <div className="flex flex-col gap-1">
                {(["all", "specific"] as const).map((m) => (
                  <label key={m} className="flex items-center gap-2 text-sm cursor-pointer text-foreground">
                    <input
                      type="radio"
                      checked={startMode === m}
                      onChange={() => { setStartMode(m); if (m === "all") setDateFrom(""); }}
                      className="accent-primary"
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
                  className={inputCls}
                />
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">End</p>
              <div className="flex flex-col gap-1">
                {(["now", "specific"] as const).map((m) => (
                  <label key={m} className="flex items-center gap-2 text-sm cursor-pointer text-foreground">
                    <input
                      type="radio"
                      checked={endMode === m}
                      onChange={() => { setEndMode(m); if (m === "now") setDateTo(""); }}
                      className="accent-primary"
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
                  className={inputCls}
                />
              )}
            </div>
          </div>

          {dateInvalid && (
            <p className="text-xs" style={{ color: "#ef4444" }}>Start date is after end date.</p>
          )}
          {!dateInvalid && (dateFrom || dateTo) && (
            <p className="text-xs text-primary">
              Range: {dateFrom || "start"} → {dateTo || "now"}
            </p>
          )}
        </div>

        {/* Sort order */}
        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Sort videos by in export <span className="text-red-400">*</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setSortBy(opt)}
                className="px-3 py-1.5 text-sm rounded-lg border transition-all"
                style={
                  sortBy === opt
                    ? { background: `${ACCENT}18`, borderColor: ACCENT, color: ACCENT }
                    : { background: "var(--card)", borderColor: "rgba(255,255,255,0.07)", color: "#8899b0" }
                }
              >
                {opt}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-6 pt-1">
            <label className="flex items-center gap-2 text-sm cursor-pointer text-foreground">
              <input
                type="checkbox"
                checked={top5}
                onChange={(e) => setTop5(e.target.checked)}
                className="accent-primary"
              />
              Include Top 5 links + avg
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer text-foreground">
              <input
                type="checkbox"
                checked={bot5}
                onChange={(e) => setBot5(e.target.checked)}
                className="accent-primary"
              />
              Include Bottom 5 links + avg
            </label>
          </div>
        </div>

        {/* Metrics */}
        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Metrics to include in export <span className="text-red-400">*</span>
          </p>
          <MetricsSelector
            platform={platform}
            rawSelected={rawMetrics}
            calcSelected={calcMetrics}
            onRawChange={setRawMetrics}
            onCalcChange={setCalcMetrics}
            accentColor={ACCENT}
          />
        </div>

        {/* Profiles */}
        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Profiles to scrape
            <span className="ml-1.5 normal-case tracking-normal font-normal text-muted-foreground">
              paste multiple lines to fill all at once
            </span>
          </p>
          <ProfileTable rows={profiles} onChange={setProfiles} />
        </div>

        {/* Apify key */}
        <ApifyKeyInput value={apifyKey} onChange={setApifyKey} />

        {/* Errors */}
        {errors.length > 0 && (
          <div
            className="rounded-xl p-4 space-y-1"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}
          >
            {errors.map((e, i) => (
              <p key={i} className="text-sm" style={{ color: "#ef4444" }}>⚠️ {e}</p>
            ))}
          </div>
        )}

        {/* Success */}
        {successCount !== null && (
          <div
            className="rounded-xl p-4"
            style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" }}
          >
            <p className="text-sm" style={{ color: "#10b981" }}>
              ✅ {successCount} profile audit{successCount !== 1 ? "s" : ""} queued.{" "}
              <a href="/queue" className="font-semibold underline">Track in Queue</a>.
            </p>
          </div>
        )}

        {/* Queue button */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleQueue}
            disabled={queuing || !activeProjectId}
            className="px-6 py-2.5 text-sm font-semibold rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT}aa)`, color: "#060c18" }}
          >
            {queuing ? "Queuing..." : "Queue Profile Audit"}
          </button>
          {!activeProjectId && (
            <p className="text-sm text-muted-foreground">Select a project first.</p>
          )}
        </div>
      </div>
    </div>
  );
}
