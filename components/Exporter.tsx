"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2, Download, Loader2, Mail, RotateCcw, Send,
} from "lucide-react";
import { useJobs, type Job } from "@/lib/hooks/useJobs";
import {
  EXPORT_ENDPOINTS, SCRAPE_FUNCTIONS,
  buildBatchExportPayload, batchExportFilename, formatDateTime, type FunctionKey,
} from "@/lib/exportConfig";
import { CALC_METRICS } from "@/components/MetricsSelector";

// ─── Date range presets ───────────────────────────────────────────────────────

type PresetKey = "all" | "7d" | "30d" | "90d" | "custom";
const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "all",    label: "All time" },
  { key: "7d",     label: "Last 7 days" },
  { key: "30d",    label: "Last 30 days" },
  { key: "90d",    label: "Last 90 days" },
  { key: "custom", label: "Custom range" },
];

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function presetBounds(key: PresetKey, custom: { from: string; to: string }): { from: number; to: number } | null {
  if (key === "all") return null;
  if (key === "custom") {
    return {
      from: new Date(`${custom.from}T00:00:00`).getTime(),
      to:   new Date(`${custom.to}T23:59:59.999`).getTime(),
    };
  }
  const to = new Date();
  const from = new Date();
  if (key === "7d")  from.setDate(to.getDate() - 6);
  if (key === "30d") from.setDate(to.getDate() - 29);
  if (key === "90d") from.setDate(to.getDate() - 89);
  from.setHours(0, 0, 0, 0);
  return { from: from.getTime(), to: to.getTime() };
}

const STATUS_PILL: Record<Job["status"], { bg: string; border: string; color: string; label: string }> = {
  COMPLETED:       { bg: "rgba(16,185,129,0.1)",  border: "rgba(16,185,129,0.3)",  color: "#34d399", label: "Completed" },
  AUTO_PROCESSING: { bg: "rgba(167,139,250,0.1)", border: "rgba(167,139,250,0.3)", color: "#a78bfa", label: "Processing" },
  PENDING:         { bg: "rgba(245,158,11,0.1)",  border: "rgba(245,158,11,0.3)",  color: "#fbbf24", label: "Pending" },
  FAILED:          { bg: "rgba(239,68,68,0.1)",   border: "rgba(239,68,68,0.3)",   color: "#f87171", label: "Failed" },
};

const selectCls =
  "px-3 py-1.5 text-sm rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

// ════════════════════════════════════════════════════════════════════════════
//  Exporter
// ════════════════════════════════════════════════════════════════════════════

export function Exporter({ activeProjectId }: { activeProjectId: string | null }) {
  const { jobs, isLoading, error, refetch, retryJob } = useJobs(activeProjectId, { sort: "desc" });

  // Filters
  const [fnFilter, setFnFilter] = useState<"all" | FunctionKey>("all");
  const [preset,   setPreset]   = useState<PresetKey>("all");
  const [custom,   setCustom]   = useState({ from: ymd(new Date(Date.now() - 30 * 864e5)), to: ymd(new Date()) });

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Export options (profile-audit video ordering)
  const [sortBy,    setSortBy]    = useState("Most Recent");
  const [inclTop5,  setInclTop5]  = useState(true);
  const [inclBot5,  setInclBot5]  = useState(false);

  // Metric selection — moved here from the scrape pages (the scrape captures all
  // raw data; you choose which calculated metrics + rates to show at export).
  const [calcMetrics, setCalcMetrics] = useState<string[]>(["Engagement Rate", "Applause Rate", "Virality Rate", "Comment/View Ratio"]);
  const [rates, setRates] = useState<Record<string, string>>({});

  // Export progress
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null);
  const [rescraping, setRescraping] = useState<string | null>(null);

  // Schedule email
  const [recipient,   setRecipient]   = useState("");
  const [frequency,   setFrequency]   = useState("once");
  const [rescrapeFirst, setRescrapeFirst] = useState(false);
  const [scheduling,  setScheduling]  = useState(false);
  const [scheduleMsg, setScheduleMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // ── Finished jobs (COMPLETED + FAILED) after filters ──────────────────────
  const finishedJobs = useMemo(() => {
    const bounds = presetBounds(preset, custom);
    const wantedTypes: string[] = fnFilter === "all"
      ? SCRAPE_FUNCTIONS.map((f) => f.jobType)
      : [SCRAPE_FUNCTIONS.find((f) => f.key === fnFilter)!.jobType];

    return jobs.filter((j) => {
      if (j.status !== "COMPLETED" && j.status !== "FAILED") return false;
      if (!wantedTypes.includes(j.job_type)) return false;
      if (bounds) {
        const t = new Date(j.created_at).getTime();
        if (t < bounds.from || t > bounds.to) return false;
      }
      return true;
    });
  }, [jobs, fnFilter, preset, custom]);

  // Drop selections that are no longer visible after a filter change.
  useEffect(() => {
    setSelected((prev) => {
      const visible = new Set(finishedJobs.map((j) => j.job_id));
      const next = new Set(Array.from(prev).filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [finishedJobs]);

  // ── Click-and-drag range selection ────────────────────────────────────────
  const dragging   = useRef(false);
  const dragMode   = useRef<"select" | "deselect">("select");
  const dragAnchor = useRef<number | null>(null);

  const applyRange = useCallback((from: number, to: number, mode: "select" | "deselect") => {
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    setSelected((prev) => {
      const next = new Set(prev);
      for (let i = lo; i <= hi; i++) {
        const id = finishedJobs[i]?.job_id;
        if (!id) continue;
        if (mode === "select") next.add(id); else next.delete(id);
      }
      return next;
    });
  }, [finishedJobs]);

  function onRowMouseDown(index: number, e: React.MouseEvent) {
    // ignore clicks on action buttons
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    const id = finishedJobs[index].job_id;
    const mode: "select" | "deselect" = selected.has(id) ? "deselect" : "select";
    dragging.current = true;
    dragMode.current = mode;
    dragAnchor.current = index;
    applyRange(index, index, mode);
  }
  function onRowMouseEnter(index: number) {
    if (!dragging.current || dragAnchor.current === null) return;
    applyRange(dragAnchor.current, index, dragMode.current);
  }
  useEffect(() => {
    const up = () => { dragging.current = false; dragAnchor.current = null; };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  // ── Selection helpers ─────────────────────────────────────────────────────
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  const allVisibleSelected = finishedJobs.length > 0 && finishedJobs.every((j) => selected.has(j.job_id));
  function toggleAll() {
    setSelected(allVisibleSelected ? new Set() : new Set(finishedJobs.map((j) => j.job_id)));
  }

  // Selected jobs that can actually be exported (completed + known endpoint).
  const exportableSelected = useMemo(
    () => finishedJobs.filter((j) => selected.has(j.job_id) && j.status === "COMPLETED" && j.job_type in EXPORT_ENDPOINTS),
    [finishedJobs, selected]
  );

  // Jobs sharing an export endpoint + platform are combined into ONE workbook.
  // Different types/platforms have different column schemas, so each distinct
  // (type, platform) combo yields its own file.
  const exportGroups = useMemo(() => {
    const groups = new Map<string, Job[]>();
    for (const job of exportableSelected) {
      const key = `${job.job_type}__${job.platform}`;
      const arr = groups.get(key);
      if (arr) arr.push(job); else groups.set(key, [job]);
    }
    // Order each group oldest-first so the export lists KOLs in paste order.
    return Array.from(groups.values()).map((g) =>
      [...g].sort((a, b) => a.created_at.localeCompare(b.created_at))
    );
  }, [exportableSelected]);

  // ── Metric picker derived state ───────────────────────────────────────────
  const selectedPlatforms = useMemo(
    () => Array.from(new Set(exportableSelected.map((j) => j.platform))),
    [exportableSelected]
  );
  const availableCalc = useMemo(() => {
    const set = new Set<string>();
    const platforms = selectedPlatforms.length ? selectedPlatforms : ["Instagram"];
    for (const p of platforms) for (const m of (CALC_METRICS[p as "Instagram" | "TikTok"] ?? [])) set.add(m);
    return Array.from(set);
  }, [selectedPlatforms]);
  const profileKols = useMemo(
    () => Array.from(new Set(
      exportableSelected
        .filter((j) => j.job_type === "Profile Feed (Audit)" && j.kol_username)
        .map((j) => j.kol_username)
    )),
    [exportableSelected]
  );
  const cpvOn = calcMetrics.includes("CPV ($)");
  function toggleCalc(m: string) {
    setCalcMetrics((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  }

  // ── Export + download — one compiled file per (type, platform) group ───────
  async function handleExportDownload() {
    if (exportGroups.length === 0) return;
    const rateNums: Record<string, number> = {};
    for (const [k, v] of Object.entries(rates)) {
      const n = parseFloat(v);
      if (Number.isFinite(n) && n > 0) rateNums[k] = n;
    }
    setExporting({ done: 0, total: exportGroups.length });
    let failures = 0;
    for (let i = 0; i < exportGroups.length; i++) {
      const group = exportGroups[i];
      const endpoint = EXPORT_ENDPOINTS[group[0].job_type];
      try {
        const res = await fetch("/api/export", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildBatchExportPayload(group, endpoint, { sortBy, inclTop5, inclBot5, calcMetrics, rates: rateNums })),
        });
        if (!res.ok) { failures++; }
        else {
          const blob = await res.blob();
          const url  = URL.createObjectURL(blob);
          const a    = document.createElement("a");
          a.href = url; a.download = batchExportFilename(group[0], group.length);
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
      } catch { failures++; }
      setExporting({ done: i + 1, total: exportGroups.length });
    }
    setExporting(null);
    if (failures > 0) alert(`${failures} of ${exportGroups.length} export file(s) failed (the export service may be cold-starting — retry in ~30s).`);
  }

  async function handleRescrape(job: Job) {
    setRescraping(job.job_id);
    try { await retryJob(job.job_id); }
    catch (e) { alert(e instanceof Error ? e.message : "Rescrape failed"); }
    finally { setRescraping(null); }
  }

  // ── Schedule email ─────────────────────────────────────────────────────────
  async function handleSchedule() {
    if (!activeProjectId) return;
    setScheduleMsg(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.trim())) {
      setScheduleMsg({ ok: false, text: "Enter a valid recipient email." });
      return;
    }
    setScheduling(true);
    try {
      const bounds = presetBounds(preset, custom);
      const res = await fetch("/api/scheduled-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id:      activeProjectId,
          recipient_email: recipient.trim(),
          job_types:       fnFilter === "all" ? SCRAPE_FUNCTIONS.map((f) => f.jobType) : [SCRAPE_FUNCTIONS.find((f) => f.key === fnFilter)!.jobType],
          metrics:         [],
          date_from:       bounds ? new Date(bounds.from).toISOString() : null,
          date_to:         bounds ? new Date(bounds.to).toISOString() : null,
          frequency,
          rescrape:        rescrapeFirst,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setScheduleMsg({ ok: false, text: (data as { error?: string }).error ?? "Failed to schedule." }); return; }
      setScheduleMsg({
        ok: true,
        text: `Scheduled — ${frequency} to ${recipient.trim()}${rescrapeFirst ? " (with rescrape)" : ""}.`,
      });
      setRecipient("");
    } catch {
      setScheduleMsg({ ok: false, text: "Network error scheduling report." });
    } finally {
      setScheduling(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  if (!activeProjectId) {
    return (
      <div className="bg-card border border-border rounded-xl p-12 text-center text-sm text-muted-foreground">
        Select a project to export its scraped data.
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* ════════ Finished jobs ════════ */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-border">
          <div>
            <h3 className="text-sm font-semibold text-foreground" style={{ fontFamily: "Outfit, sans-serif" }}>Finished jobs</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Select rows to export · drag to multi-select · rescrape failures</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={fnFilter} onChange={(e) => setFnFilter(e.target.value as "all" | FunctionKey)} className={selectCls}>
              <option value="all">All functions</option>
              {SCRAPE_FUNCTIONS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
            <select value={preset} onChange={(e) => setPreset(e.target.value as PresetKey)} className={selectCls}>
              {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
            {preset === "custom" && (
              <>
                <input type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} className={selectCls} />
                <input type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} className={selectCls} />
              </>
            )}
            <button onClick={refetch} className="p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-colors" title="Refresh">
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {error ? (
          <div className="m-5 rounded-xl p-4 text-sm" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#ef4444" }}>{error}</div>
        ) : isLoading ? (
          <div className="p-12 text-center text-sm text-muted-foreground">Loading jobs…</div>
        ) : finishedJobs.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">No finished jobs for these filters.</div>
        ) : (
          <table className="w-full text-sm" style={{ userSelect: "none" }}>
            <thead>
              <tr style={{ background: "#0f1e35" }}>
                <th className="px-4 py-2.5 w-10">
                  <button onClick={toggleAll} className="w-4 h-4 rounded flex items-center justify-center border transition-all align-middle"
                    style={{ background: allVisibleSelected ? "#00c9ff" : "transparent", borderColor: allVisibleSelected ? "#00c9ff" : "rgba(255,255,255,0.2)" }}
                    title={allVisibleSelected ? "Deselect all" : "Select all"}>
                    {allVisibleSelected && <svg className="w-2.5 h-2.5" viewBox="0 0 10 8" fill="none" style={{ color: "#060c18" }}><path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                  </button>
                </th>
                {["Target / KOL", "Platform", "Function", "Status", "Finished", ""].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-[10px] font-mono uppercase tracking-wider text-muted-foreground font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {finishedJobs.map((job, index) => {
                const isSel = selected.has(job.job_id);
                const sp = STATUS_PILL[job.status];
                const canExport = job.status === "COMPLETED" && job.job_type in EXPORT_ENDPOINTS;
                return (
                  <tr
                    key={job.job_id}
                    onMouseDown={(e) => onRowMouseDown(index, e)}
                    onMouseEnter={() => onRowMouseEnter(index)}
                    className="border-t cursor-pointer transition-colors"
                    style={{ borderColor: "rgba(255,255,255,0.05)", background: isSel ? "rgba(0,201,255,0.06)" : undefined }}
                  >
                    <td className="px-4 py-3">
                      <button onClick={() => toggleOne(job.job_id)} className="w-4 h-4 rounded flex items-center justify-center border transition-all align-middle"
                        style={{ background: isSel ? "#00c9ff" : "transparent", borderColor: isSel ? "#00c9ff" : "rgba(255,255,255,0.2)" }}>
                        {isSel && <svg className="w-2.5 h-2.5" viewBox="0 0 10 8" fill="none" style={{ color: "#060c18" }}><path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                      </button>
                    </td>
                    <td className="px-4 py-3 max-w-[220px]">
                      <p className="truncate font-medium text-foreground" title={job.target_url}>{job.kol_username || job.target_url}</p>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{job.platform}</td>
                    <td className="px-4 py-3 text-muted-foreground max-w-[160px]"><span className="truncate block" title={job.job_type}>{job.job_type}</span></td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center text-[11px] font-medium px-2.5 py-1 rounded-full" style={{ background: sp.bg, border: `1px solid ${sp.border}`, color: sp.color }}>{sp.label}</span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">{formatDateTime(job.created_at)}</td>
                    <td className="px-4 py-3">
                      {job.status === "FAILED" ? (
                        <button onClick={() => handleRescrape(job)} disabled={rescraping === job.job_id}
                          className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg transition-colors hover:bg-primary/10 disabled:opacity-50"
                          style={{ color: "#00c9ff" }}>
                          {rescraping === job.job_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                          Rescrape
                        </button>
                      ) : !canExport ? (
                        <span className="text-[10px] text-muted-foreground">no export</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {finishedJobs.length > 0 && (
          <div className="px-5 py-2.5 border-t border-border bg-muted text-xs text-muted-foreground flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: "#00c9ff" }} />
            {selected.size} selected · {exportableSelected.length} exportable · {finishedJobs.length} shown
          </div>
        )}
      </div>

      {/* ════════ Export actions ════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">

          {/* Direct export */}
          <div className="bg-card border border-border rounded-xl p-5">
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-3">Export now</p>

            {/* Profile-audit video ordering */}
            <label className="block text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1.5">Sort videos by</label>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className={`${selectCls} w-full mb-3`}>
              <option value="Most Recent">Most Recent</option>
              <option value="Oldest">Oldest</option>
              <option value="Most Views">Most Views</option>
              <option value="Least Views">Least Views</option>
            </select>
            <div className="flex flex-wrap gap-4 mb-4">
              <label className="flex items-center gap-2 text-xs cursor-pointer text-foreground">
                <input type="checkbox" checked={inclTop5} onChange={(e) => setInclTop5(e.target.checked)} className="accent-primary" />
                Top 5 avg
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer text-foreground">
                <input type="checkbox" checked={inclBot5} onChange={(e) => setInclBot5(e.target.checked)} className="accent-primary" />
                Bottom 5 avg
              </label>
            </div>

            {/* Calculated metrics — chosen at export, not at scrape time */}
            <label className="block text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1.5">Calculated metrics</label>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {availableCalc.map((m) => {
                const on = calcMetrics.includes(m);
                return (
                  <button key={m} type="button" onClick={() => toggleCalc(m)}
                    className="px-2.5 py-1 rounded-full text-xs font-medium border transition-all"
                    style={on
                      ? { background: "rgba(0,201,255,0.12)", borderColor: "#00c9ff", color: "#00c9ff" }
                      : { background: "transparent", borderColor: "rgba(255,255,255,0.1)", color: "#8899b0" }}>
                    {m}
                  </button>
                );
              })}
            </div>

            {cpvOn && profileKols.length > 0 && (
              <div className="mb-3 rounded-lg border border-border p-3 space-y-2" style={{ background: "var(--input)" }}>
                <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Rate ($) per KOL — for CPV</p>
                {profileKols.map((k) => (
                  <div key={k} className="flex items-center gap-2">
                    <span className="text-xs text-foreground flex-1 truncate">@{k}</span>
                    <input type="number" min={0} step="0.01" value={rates[k] ?? ""}
                      onChange={(e) => setRates((r) => ({ ...r, [k]: e.target.value }))}
                      placeholder="0.00"
                      className="w-28 px-2 py-1 text-xs rounded-lg bg-card border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                  </div>
                ))}
                <p className="text-[11px] text-muted-foreground">CPV = rate ÷ views, per video. Leave a KOL blank to skip.</p>
              </div>
            )}

            <p className="text-xs text-muted-foreground mb-4">
              Compiles the selected completed jobs into a single Excel file, in the order they were scraped. Pick the calculated metrics above (profile-audit exports).
              {exportGroups.length > 1 && " Mixed scrape types or platforms are split into one file each (different column layouts)."}
            </p>
            <button
              type="button"
              onClick={handleExportDownload}
              disabled={exportGroups.length === 0 || exporting !== null}
              className="w-full py-3 text-sm font-semibold rounded-xl flex items-center justify-center gap-2 transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ background: "linear-gradient(135deg, #00c9ff, #0087d8)", color: "#060c18" }}
            >
              {exporting
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Exporting {exporting.done}/{exporting.total}…</>
                : <><Download className="w-4 h-4" /> Export &amp; download ({exportableSelected.length} job{exportableSelected.length !== 1 ? "s" : ""}{exportGroups.length > 1 ? ` → ${exportGroups.length} files` : ""})</>}
            </button>
          </div>

          {/* Schedule email */}
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Mail className="w-4 h-4" style={{ color: "#00c9ff" }} />
              <p className="text-sm font-medium text-foreground">Schedule email delivery</p>
            </div>

            <label className="block text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1.5">Recipient</label>
            <input
              type="email" value={recipient} onChange={(e) => setRecipient(e.target.value)}
              placeholder="designator@company.com"
              className="w-full mb-3 px-3 py-2 text-sm rounded-lg bg-input border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />

            <label className="block text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1.5">Frequency</label>
            <select value={frequency} onChange={(e) => setFrequency(e.target.value)} className={`${selectCls} w-full mb-3`}>
              <option value="once">Once</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>

            <button
              type="button"
              onClick={() => setRescrapeFirst((v) => !v)}
              className="flex items-center justify-between w-full mb-4 px-3 py-2.5 rounded-lg border transition-colors"
              style={{ background: "var(--input)", borderColor: "rgba(255,255,255,0.07)" }}
            >
              <span className="text-left">
                <span className="block text-sm text-foreground">Rescrape before sending</span>
                <span className="block text-xs text-muted-foreground">{rescrapeFirst ? "Refresh data, then email" : "Email the latest existing data"}</span>
              </span>
              <span className="relative w-10 h-5 rounded-full transition-colors flex-shrink-0" style={{ background: rescrapeFirst ? "#00c9ff" : "var(--muted)" }}>
                <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform" style={{ left: rescrapeFirst ? "calc(100% - 18px)" : "2px" }} />
              </span>
            </button>

            <button
              type="button"
              onClick={handleSchedule}
              disabled={scheduling || !recipient.trim()}
              className="w-full py-3 text-sm font-semibold rounded-xl flex items-center justify-center gap-2 border transition-colors hover:bg-primary/10 disabled:opacity-40"
              style={{ borderColor: "rgba(0,201,255,0.3)", color: "#00c9ff" }}
            >
              {scheduling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {scheduling ? "Scheduling…" : "Schedule email"}
            </button>

            {scheduleMsg && (
              <div className="mt-3 rounded-lg px-3 py-2 text-xs flex items-start gap-2"
                style={scheduleMsg.ok
                  ? { background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)", color: "#10b981" }
                  : { background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#ef4444" }}>
                {scheduleMsg.ok && <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />}
                <span>{scheduleMsg.text}</span>
              </div>
            )}
          </div>
      </div>
    </div>
  );
}
