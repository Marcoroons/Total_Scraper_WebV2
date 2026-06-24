"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Hash, RefreshCw } from "lucide-react";
import { useProject } from "@/lib/context/ProjectContext";
import { useJobs } from "@/lib/hooks/useJobs";
import { PlatformToggle } from "@/components/PlatformToggle";
import { ApifyKeyInput } from "@/components/ApifyKeyInput";

type Platform = "Instagram" | "TikTok";
type Tab = "trends" | "optimise";
const ACCENT = "#2dd4bf";

interface TrendRow {
  platform: string; search_target: string; video_url: string; username: string;
  caption: string; play_count: number; likes: number; comments: number;
  shares: number; video_duration: number; audio_track: string; content_type: string;
}

const fmt = (n: number) => {
  const v = Number(n) || 0;
  if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return String(v);
};
const dur = (s: number) => {
  const v = Math.round(Number(s) || 0);
  return v >= 60 ? `${Math.floor(v / 60)}m ${v % 60}s` : `${v}s`;
};

export default function HashtagsPage() {
  const { activeProjectId, activeProjectName } = useProject();
  const { createJobs } = useJobs(null);

  const [tab,      setTab]      = useState<Tab>("trends");
  const [platform, setPlatform] = useState<Platform>("Instagram");
  const [tags,     setTags]     = useState("");
  const [limit,    setLimit]    = useState(30);
  const [apifyKey, setApifyKey] = useState("");
  const [errors,   setErrors]   = useState<string[]>([]);
  const [queuing,  setQueuing]  = useState(false);
  const [okMsg,    setOkMsg]    = useState<string | null>(null);
  const [rows,     setRows]     = useState<TrendRow[]>([]);
  const [loading,  setLoading]  = useState(false);

  const loadResults = useCallback(async () => {
    if (!activeProjectId) { setRows([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/trends?project_id=${activeProjectId}`);
      const data = await res.json().catch(() => ({}));
      setRows(res.ok ? (data.rows ?? []) : []);
    } catch { setRows([]); }
    finally { setLoading(false); }
  }, [activeProjectId]);

  useEffect(() => { loadResults(); }, [loadResults]);

  // ── Video-optimisation analysis (client-side, from the scraped rows) ──
  const analysis = useMemo(() => {
    if (rows.length === 0) return null;
    const sorted = [...rows].sort((a, b) => b.play_count - a.play_count);
    const topN = sorted.slice(0, Math.max(5, Math.ceil(sorted.length * 0.2))); // top ~20%
    const avg = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);

    const typeCounts: Record<string, number> = {};
    for (const r of rows) { const t = r.content_type || "Video"; typeCounts[t] = (typeCounts[t] || 0) + 1; }
    const topType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Video";

    const audioCounts: Record<string, number> = {};
    for (const r of topN) { const a = r.audio_track || "Original Audio"; audioCounts[a] = (audioCounts[a] || 0) + 1; }
    const topAudio = Object.entries(audioCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

    const erLeaders = sorted
      .filter((r) => r.play_count > 0)
      .map((r) => ({ ...r, er: ((r.likes + r.comments) / r.play_count) * 100 }))
      .sort((a, b) => b.er - a.er)
      .slice(0, 5);

    return {
      avgDur:   avg(topN.map((r) => r.video_duration).filter((d) => d > 0)),
      avgCap:   avg(topN.map((r) => (r.caption || "").length)),
      avgViews: avg(topN.map((r) => r.play_count)),
      topType, topAudio, erLeaders, topCount: topN.length,
    };
  }, [rows]);

  function parseTags() {
    return tags.split(/[\n,]+/).map((t) => t.replace(/#/g, "").trim()).filter(Boolean);
  }

  async function handleQueue() {
    if (!activeProjectId) return;
    setOkMsg(null);
    const parsed = parseTags();
    if (parsed.length === 0) { setErrors(["Enter at least one hashtag."]); return; }
    setErrors([]);
    setQueuing(true);
    try {
      await createJobs([{
        project_id: activeProjectId, target_url: parsed.join(", "), platform,
        job_type: "Trend Discovery (Hashtag)", kol_username: "", rate: "",
        raw_metrics: [], calc_metrics: [], format_filter: "All Formats", target_limit: limit,
        ...(apifyKey.trim() ? { apify_api_key: apifyKey.trim() } : {}),
      }]);
      setOkMsg(`Queued ${parsed.length} hashtag(s) on ${platform}. Results appear below once the worker finishes.`);
      setTags("");
    } catch (e) {
      setErrors([e instanceof Error ? e.message : "Failed to queue. Try again."]);
    } finally { setQueuing(false); }
  }

  function exportCsv() {
    if (rows.length === 0) return;
    const cols: (keyof TrendRow)[] = ["search_target","platform","username","play_count","likes","comments","shares","video_duration","audio_track","caption","video_url"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = [...cols, "engagement_rate_pct"].join(",");
    const lines = rows.map((r) => {
      const plays = Number(r.play_count) || 0;
      const er = plays ? ((Number(r.likes) + Number(r.comments) + Number(r.shares)) / plays) * 100 : 0;
      return [...cols.map((c) => esc(r[c])), esc(er.toFixed(2))].join(",");
    });
    const csv = [header, ...lines].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `hashtag_trends_${Date.now()}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const cardCls = "bg-card border border-border rounded-xl";

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2" style={{ fontFamily: "Outfit, sans-serif" }}>
          <Hash className="w-5 h-5" style={{ color: ACCENT }} /> Hashtag / Trends
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Scrape top content under hashtags, then discover trends or reverse-engineer the winning format.
          {activeProjectName && <span> · {activeProjectName}</span>}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-5 items-start">
        {/* ── Config (shared) ── */}
        <div className="space-y-4">
          <div className={`${cardCls} p-5 space-y-3`}>
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Platform</p>
            <PlatformToggle value={platform} onChange={(p) => setPlatform(p as Platform)} />
          </div>
          <div className={`${cardCls} p-5 space-y-2`}>
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Hashtags</p>
            <textarea value={tags} onChange={(e) => setTags(e.target.value)} rows={4}
              placeholder="one per line or comma-separated&#10;e.g. yogurt, healthysnack, fyp"
              className="w-full px-3 py-2 text-sm rounded-lg bg-input border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y" />
            <p className="text-xs text-muted-foreground">The # is optional — we strip it.</p>
          </div>
          <div className={`${cardCls} p-5 space-y-2`}>
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Posts per hashtag</p>
            <input type="number" min={1} max={200} value={limit}
              onChange={(e) => setLimit(Math.min(200, Math.max(1, Number(e.target.value) || 1)))}
              className="w-28 px-3 py-1.5 text-sm rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
            <p className="text-xs" style={{ color: "#f59e0b" }}>More posts = more Apify credits.</p>
          </div>
          <ApifyKeyInput value={apifyKey} onChange={setApifyKey} />
          {errors.length > 0 && (
            <div className="rounded-xl p-4 space-y-1" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
              {errors.map((e, i) => <p key={i} className="text-sm" style={{ color: "#ef4444" }}>⚠️ {e}</p>)}
            </div>
          )}
          {okMsg && (
            <div className="rounded-xl p-4" style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" }}>
              <p className="text-sm" style={{ color: "#10b981" }}>✅ {okMsg} <a href="/queue" className="font-semibold underline">Track in Queue</a>.</p>
            </div>
          )}
          <button type="button" onClick={handleQueue} disabled={queuing || !activeProjectId}
            className="w-full py-2.5 text-sm font-semibold rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT}aa)`, color: "#060c18" }}>
            {queuing ? "Queuing…" : "Queue hashtag scrape"}
          </button>
          {!activeProjectId && <p className="text-sm text-muted-foreground">Select a project first.</p>}
        </div>

        {/* ── Results: tabbed ── */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex gap-0 border-b border-border">
              {([{ id: "trends", label: "Trend Discovery" }, { id: "optimise", label: "Video Optimisation" }] as { id: Tab; label: string }[]).map((t) => (
                <button key={t.id} onClick={() => setTab(t.id)} className="px-4 py-2.5 text-sm font-medium relative transition-all"
                  style={{ color: tab === t.id ? ACCENT : "#5a7294" }}>
                  {t.label}
                  {tab === t.id && <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t" style={{ background: ACCENT }} />}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={loadResults} title="Refresh" className="p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-colors">
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              </button>
              <button onClick={exportCsv} disabled={rows.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors hover:bg-primary/10 disabled:opacity-40"
                style={{ borderColor: `${ACCENT}55`, color: ACCENT }}>
                <Download className="w-3.5 h-3.5" /> CSV
              </button>
            </div>
          </div>

          {rows.length === 0 ? (
            <div className={`${cardCls} p-12 text-center text-sm text-muted-foreground`}>
              {loading ? "Loading…" : "No results yet. Queue a hashtag scrape — results show here when the worker finishes."}
            </div>
          ) : tab === "trends" ? (
            /* ── Trend Discovery: top content ── */
            <div className={`${cardCls} overflow-hidden`}>
              <div className="px-5 py-3 border-b border-border text-xs text-muted-foreground">{rows.length} posts · ranked by views</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr style={{ background: "#0f1e35" }}>
                    {["#", "Creator", "Views", "Likes", "Comments", "Audio", "Caption"].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-left text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.video_url || i} className="border-t hover:bg-white/[0.02] transition-colors" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                        <td className="px-4 py-3 text-muted-foreground">{i + 1}</td>
                        <td className="px-4 py-3">
                          <a href={r.video_url} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground hover:underline">{r.username ? `@${r.username}` : "—"}</a>
                          <span className="block text-[10px] text-muted-foreground">{r.search_target}</span>
                        </td>
                        <td className="px-4 py-3 font-medium text-foreground">{fmt(r.play_count)}</td>
                        <td className="px-4 py-3 text-muted-foreground">{fmt(r.likes)}</td>
                        <td className="px-4 py-3 text-muted-foreground">{fmt(r.comments)}</td>
                        <td className="px-4 py-3 text-muted-foreground max-w-[140px]"><span className="truncate block" title={r.audio_track}>{r.audio_track}</span></td>
                        <td className="px-4 py-3 text-muted-foreground max-w-[260px]"><span className="truncate block" title={r.caption}>{r.caption}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : analysis && (
            /* ── Video Optimisation: the winning template ── */
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Top format", value: analysis.topType },
                  { label: "Ideal length", value: analysis.avgDur ? dur(analysis.avgDur) : "—" },
                  { label: "Caption length", value: `~${analysis.avgCap} chars` },
                  { label: "Avg views (top 20%)", value: fmt(analysis.avgViews) },
                ].map((c) => (
                  <div key={c.label} className={`${cardCls} p-4`}>
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{c.label}</p>
                    <p className="text-lg font-bold text-foreground mt-1" style={{ fontFamily: "Outfit, sans-serif" }}>{c.value}</p>
                  </div>
                ))}
              </div>

              <div className={`${cardCls} p-5`}>
                <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-3">Trending audio (in top posts)</p>
                {analysis.topAudio.length === 0 ? <p className="text-xs text-muted-foreground">No audio data.</p> : (
                  <ul className="space-y-1.5">
                    {analysis.topAudio.map(([name, count]) => (
                      <li key={name} className="flex items-center justify-between text-sm">
                        <span className="text-foreground truncate mr-3">{name}</span>
                        <span className="text-xs text-muted-foreground flex-shrink-0">{count} post{count !== 1 ? "s" : ""}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className={`${cardCls} overflow-hidden`}>
                <div className="px-5 py-3 border-b border-border text-xs text-muted-foreground">Highest engagement-rate posts — templates to emulate</div>
                <table className="w-full text-sm">
                  <thead><tr style={{ background: "#0f1e35" }}>
                    {["Creator", "Eng. rate", "Views", "Length", "Caption"].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-left text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {analysis.erLeaders.map((r, i) => (
                      <tr key={r.video_url || i} className="border-t hover:bg-white/[0.02] transition-colors" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                        <td className="px-4 py-3"><a href={r.video_url} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground hover:underline">{r.username ? `@${r.username}` : "—"}</a></td>
                        <td className="px-4 py-3 font-medium" style={{ color: ACCENT }}>{r.er.toFixed(1)}%</td>
                        <td className="px-4 py-3 text-muted-foreground">{fmt(r.play_count)}</td>
                        <td className="px-4 py-3 text-muted-foreground">{r.video_duration ? dur(r.video_duration) : "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground max-w-[260px]"><span className="truncate block" title={r.caption}>{r.caption}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
