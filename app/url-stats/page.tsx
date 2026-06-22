"use client";

import { useState } from "react";
import { useProject } from "@/lib/context/ProjectContext";
import { useJobs } from "@/lib/hooks/useJobs";
import { PlatformToggle } from "@/components/PlatformToggle";
import { MetricsSelector } from "@/components/MetricsSelector";
import { URLDataTable, type URLRow } from "@/components/URLDataTable";
import { ApifyKeyInput } from "@/components/ApifyKeyInput";

type Platform = "Instagram" | "TikTok";

const ACCENT = "#f59e0b";

function makeRow(): URLRow {
  return { id: Math.random().toString(36).slice(2), url: "", kol: "", rate: "" };
}

export default function URLStatsPage() {
  const { activeProjectId, activeProjectName } = useProject();
  const { createJobs } = useJobs(null);

  const [platform, setPlatform] = useState<Platform>("Instagram");
  const [includeRate, setIncludeRate] = useState(false);
  const [rows, setRows] = useState<URLRow[]>([makeRow()]);
  const [rawMetrics, setRawMetrics] = useState<string[]>([]);
  const [calcMetrics, setCalcMetrics] = useState<string[]>([]);
  const [apifyKey, setApifyKey] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [queuing, setQueuing] = useState(false);
  const [successCount, setSuccessCount] = useState<number | null>(null);

  function handlePlatformChange(p: Platform) {
    setPlatform(p);
    setRawMetrics([]);
    setCalcMetrics([]);
  }

  async function handleQueue() {
    if (!activeProjectId) return;
    setSuccessCount(null);

    const validRows = rows.filter((r) => r.url.trim());
    const errs: string[] = [];

    if (validRows.length === 0) {
      errs.push("No URLs entered — paste at least one video or reel URL.");
    }
    if (rawMetrics.length === 0 && calcMetrics.length === 0) {
      errs.push("No metrics selected — pick at least one raw or calculated metric.");
    }
    if (includeRate) {
      const missing = validRows.filter((r) => !r.rate.trim());
      if (missing.length > 0) {
        errs.push(
          `Rate is required for all URLs when the Rate column is enabled. Missing: ${missing
            .map((r) => r.url.slice(0, 40))
            .join(", ")}`
        );
      }
    }

    setErrors(errs);
    if (errs.length > 0) return;

    setQueuing(true);
    try {
      const jobs = validRows.map((row) => ({
        project_id:    activeProjectId,
        target_url:    row.url.trim(),
        platform,
        job_type:      "Specific URLs (Video Stats)",
        kol_username:  row.kol.trim(),
        rate:          includeRate ? row.rate.trim() : "",
        raw_metrics:   rawMetrics,
        calc_metrics:  calcMetrics,
        format_filter: "All Formats",
        target_limit:  10,
        ...(apifyKey.trim() ? { apify_api_key: apifyKey.trim() } : {}),
      }));

      await createJobs(jobs);
      setSuccessCount(jobs.length);
      setRows([makeRow()]);
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
        <h1 className="text-xl font-bold text-foreground">URL Stats</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Get engagement stats for specific video or reel URLs.
          {activeProjectName && <span> · {activeProjectName}</span>}
        </p>
      </div>

      <div className="space-y-6">
        {/* Platform */}
        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Platform</p>
          <PlatformToggle value={platform} onChange={handlePlatformChange} />
        </div>

        {/* Rate toggle */}
        <div className="bg-card border border-border rounded-xl p-5">
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <div className="relative">
              <input
                type="checkbox"
                className="sr-only"
                checked={includeRate}
                onChange={(e) => setIncludeRate(e.target.checked)}
              />
              <div
                className="w-10 h-5 rounded-full transition-colors"
                style={{ background: includeRate ? ACCENT : "var(--muted)" }}
              />
              <div
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                  includeRate ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </div>
            <div>
              <span className="text-sm font-medium text-foreground">Include Rate column</span>
              <p className="text-xs text-muted-foreground mt-0.5">
                Enter cost per post per URL — used to calculate CPV ($)
              </p>
            </div>
          </label>
        </div>

        {/* URL table */}
        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Video URLs
            <span className="ml-1.5 normal-case tracking-normal text-muted-foreground font-normal">
              (paste multiple lines to add in bulk)
            </span>
          </p>
          <URLDataTable rows={rows} onChange={setRows} includeRate={includeRate} />
        </div>

        {/* Metrics */}
        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Metrics to export
            <span className="ml-1.5 normal-case tracking-normal font-normal">
              (hover a calculated metric to see its formula)
            </span>
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

        {/* Apify key */}
        <ApifyKeyInput value={apifyKey} onChange={setApifyKey} />

        {/* Errors */}
        {errors.length > 0 && (
          <div
            className="rounded-xl p-4 space-y-1"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}
          >
            {errors.map((e, i) => (
              <p key={i} className="text-sm" style={{ color: "#ef4444" }}>
                ⚠️ {e}
              </p>
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
              ✅ {successCount} URL stat job{successCount !== 1 ? "s" : ""} queued successfully.{" "}
              <a href="/queue" className="font-semibold underline">
                Track in Queue
              </a>
              .
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
            {queuing ? "Queuing…" : "⚡ Queue URL Stats"}
          </button>
          {!activeProjectId && (
            <p className="text-sm text-muted-foreground">Select a project first.</p>
          )}
        </div>
      </div>
    </div>
  );
}
