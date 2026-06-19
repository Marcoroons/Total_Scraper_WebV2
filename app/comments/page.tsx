"use client";

import Link from "next/link";
import { useState } from "react";
import { useProject } from "@/lib/context/ProjectContext";
import { useJobs } from "@/lib/hooks/useJobs";
import { PlatformToggle } from "@/components/PlatformToggle";
import { VideoURLTable, type VideoRow, newVideoRow } from "@/components/VideoURLTable";
import { ApifyKeyInput } from "@/components/ApifyKeyInput";

type Platform = "Instagram" | "TikTok";

export default function CommentsPage() {
  const { activeProjectId, activeProjectName } = useProject();
  const { createJobs } = useJobs(null);

  const [platform, setPlatform] = useState<Platform>("Instagram");
  const [rows, setRows] = useState<VideoRow[]>([newVideoRow()]);
  const [maxComments, setMaxComments] = useState(50);
  const [apifyKey, setApifyKey] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [queuing, setQueuing] = useState(false);
  const [successCount, setSuccessCount] = useState<number | null>(null);

  async function handleQueue() {
    if (!activeProjectId) return;
    setSuccessCount(null);

    const filledRows = rows.filter((r) => r.url.trim() || r.kol.trim());
    const errs: string[] = [];

    if (filledRows.length === 0) {
      errs.push("No entries — paste at least one video URL with its KOL username.");
    } else {
      const missingKol = filledRows.filter((r) => r.url.trim() && !r.kol.trim());
      const missingUrl = filledRows.filter((r) => r.kol.trim() && !r.url.trim());
      if (missingKol.length > 0) {
        errs.push(
          `KOL Username missing for: ${missingKol
            .map((r) => r.url.slice(0, 45))
            .join(", ")}`
        );
      }
      if (missingUrl.length > 0) {
        errs.push(
          `Video URL missing for KOL: ${missingUrl.map((r) => r.kol).join(", ")}`
        );
      }
    }

    setErrors(errs);
    if (errs.length > 0) return;

    const validRows = filledRows.filter((r) => r.url.trim() && r.kol.trim());
    setQueuing(true);
    try {
      const jobs = validRows.map((row) => ({
        project_id:    activeProjectId,
        target_url:    row.url.trim(),
        platform,
        job_type:      "Comments (Sentiment)",
        kol_username:  row.kol.trim(),
        rate:          "",
        raw_metrics:   [] as string[],
        calc_metrics:  [] as string[],
        format_filter: "All Formats",
        target_limit:  maxComments,
        ...(apifyKey.trim() ? { apify_api_key: apifyKey.trim() } : {}),
      }));

      await createJobs(jobs);
      setSuccessCount(jobs.length);
      setRows([newVideoRow()]);
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
        <h1 className="text-xl font-bold text-gray-900">Comments</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Scrape comments for NLP sentiment analysis.
          {activeProjectName && <span> · {activeProjectName}</span>}
        </p>
      </div>

      <div className="space-y-6">
        {/* Platform */}
        <div className="bg-white border rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">Platform</h2>
          <PlatformToggle value={platform} onChange={(p) => setPlatform(p as Platform)} />
        </div>

        {/* Video URL + KOL table */}
        <div className="bg-white border rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">
            Videos to scrape
            <span className="ml-1.5 text-gray-400 font-normal text-xs">
              paste lines as URL[tab]KOL or URL,KOL to fill both columns at once
            </span>
          </h2>
          <VideoURLTable rows={rows} onChange={setRows} />
        </div>

        {/* Max comments */}
        <div className="bg-white border rounded-xl p-5 space-y-2">
          <h2 className="text-sm font-semibold text-gray-700">Max comments per post</h2>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={1}
              max={5000}
              value={maxComments}
              onChange={(e) =>
                setMaxComments(
                  Math.min(5000, Math.max(1, Number(e.target.value) || 1))
                )
              }
              className="w-28 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1F4E78]"
            />
            <span className="text-xs text-gray-400">1 to 5,000</span>
          </div>
          <p className="text-xs text-amber-600">
            More comments = more Apify credits consumed per post.
          </p>
        </div>

        {/* NLP disclaimer */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <p className="text-sm text-blue-700">
            NLP analysis settings should be configured before exporting results.{" "}
            <Link href="/nlp-settings" className="font-semibold underline">
              Visit NLP Settings
            </Link>
            . Scraping and analysis are separate steps — comments are stored raw here
            and analysed at export time.
          </p>
        </div>

        {/* Apify key */}
        <ApifyKeyInput value={apifyKey} onChange={setApifyKey} />

        {/* Errors */}
        {errors.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-1">
            {errors.map((e, i) => (
              <p key={i} className="text-sm text-red-600">
                ⚠️ {e}
              </p>
            ))}
          </div>
        )}

        {/* Success */}
        {successCount !== null && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4">
            <p className="text-sm text-green-700">
              ✅ {successCount} comment scrape{successCount !== 1 ? "s" : ""} queued
              successfully. Track progress in{" "}
              <a href="/queue" className="font-semibold underline">
                Queue
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
            className="px-6 py-2.5 bg-[#1F4E78] text-white text-sm font-semibold rounded-lg hover:bg-[#2E86AB] transition-colors disabled:opacity-50"
          >
            {queuing ? "Queuing..." : "Queue Comment Scrape"}
          </button>
          {!activeProjectId && (
            <p className="text-sm text-gray-400">Select a project first.</p>
          )}
        </div>
      </div>
    </div>
  );
}
