"use client";

import { useEffect, useState } from "react";
import { useProject } from "@/lib/context/ProjectContext";
import { useJobs } from "@/lib/hooks/useJobs";
import { PlatformToggle } from "@/components/PlatformToggle";
import { VideoURLTable, type VideoRow, newVideoRow } from "@/components/VideoURLTable";
import { ApifyKeyInput } from "@/components/ApifyKeyInput";
import { NlpSettingsPanel } from "@/components/NlpSettingsPanel";

type Platform = "Instagram" | "TikTok" | "YouTube";
type Tab = "scraper" | "nlp";

const ACCENT = "#f472b6";

export default function CommentsPage() {
  const { activeProjectId, activeProjectName } = useProject();
  const { createJobs } = useJobs(null);

  const [tab, setTab] = useState<Tab>("scraper");
  const [platform, setPlatform] = useState<Platform>("Instagram");
  const [rows, setRows] = useState<VideoRow[]>([newVideoRow()]);
  const [maxComments, setMaxComments] = useState(50);
  const [apifyKey, setApifyKey] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [queuing, setQueuing] = useState(false);
  const [successCount, setSuccessCount] = useState<number | null>(null);

  // Deep-link to the NLP subtab via /comments?tab=nlp
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tab") === "nlp") setTab("nlp");
  }, []);

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
        errs.push(`KOL Username missing for: ${missingKol.map((r) => r.url.slice(0, 45)).join(", ")}`);
      }
      if (missingUrl.length > 0) {
        errs.push(`Video URL missing for KOL: ${missingUrl.map((r) => r.kol).join(", ")}`);
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
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-bold text-foreground">Comment Sentiment Analysis</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Scrape comments and configure the NLP model that analyses them.
          {activeProjectName && <span> · {activeProjectName}</span>}
        </p>
      </div>

      {/* Subtabs */}
      <div className="flex gap-0 mb-6 border-b border-border">
        {([
          { id: "scraper", label: "Comment Scraper" },
          { id: "nlp",     label: "NLP Settings" },
        ] as { id: Tab; label: string }[]).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className="px-4 py-2.5 text-sm font-medium transition-all relative"
            style={{ color: tab === t.id ? ACCENT : "#5a7294" }}
          >
            {t.label}
            {tab === t.id && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t" style={{ background: ACCENT }} />
            )}
          </button>
        ))}
      </div>

      {tab === "nlp" ? (
        <NlpSettingsPanel />
      ) : (
        <div className="max-w-3xl space-y-6">
          {/* Platform */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-3">
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Platform</p>
            <PlatformToggle value={platform} platforms={["Instagram", "TikTok", "YouTube"]} onChange={(p) => setPlatform(p as Platform)} />
          </div>

          {/* Video URL + KOL table */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-3">
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              Videos to scrape
              <span className="ml-1.5 normal-case tracking-normal font-normal text-muted-foreground">
                paste lines as KOL[tab]URL or URL,KOL — order auto-detected, tab or comma separator
              </span>
            </p>
            <VideoURLTable rows={rows} onChange={setRows} platform={platform} />
          </div>

          {/* Max comments */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-2">
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Max comments per post</p>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={1}
                max={5000}
                value={maxComments}
                onChange={(e) => setMaxComments(Math.min(5000, Math.max(1, Number(e.target.value) || 1)))}
                className="w-28 px-3 py-1.5 text-sm rounded-lg bg-input border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <span className="text-xs text-muted-foreground">1 to 5,000</span>
            </div>
            <p className="text-xs" style={{ color: "#f59e0b" }}>
              More comments = more Apify credits consumed per post.
            </p>
          </div>

          {/* NLP disclaimer */}
          <div
            className="rounded-xl p-4"
            style={{ background: "rgba(0,201,255,0.06)", border: "1px solid rgba(0,201,255,0.15)" }}
          >
            <p className="text-sm" style={{ color: "#00c9ff" }}>
              Configure the analysis dictionaries in the{" "}
              <button onClick={() => setTab("nlp")} className="font-semibold underline">
                NLP Settings
              </button>{" "}
              tab before exporting. Scraping and analysis are separate steps — comments are stored raw here and analysed at export time.
            </p>
          </div>

          {/* Apify key */}
          <ApifyKeyInput value={apifyKey} onChange={setApifyKey} />

          {/* Errors */}
          {errors.length > 0 && (
            <div className="rounded-xl p-4 space-y-1" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
              {errors.map((e, i) => (
                <p key={i} className="text-sm" style={{ color: "#ef4444" }}>⚠️ {e}</p>
              ))}
            </div>
          )}

          {/* Success */}
          {successCount !== null && (
            <div className="rounded-xl p-4" style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" }}>
              <p className="text-sm" style={{ color: "#10b981" }}>
                ✅ {successCount} comment scrape{successCount !== 1 ? "s" : ""} queued.{" "}
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
              {queuing ? "Queuing..." : "Queue Comment Scrape"}
            </button>
            {!activeProjectId && <p className="text-sm text-muted-foreground">Select a project first.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
