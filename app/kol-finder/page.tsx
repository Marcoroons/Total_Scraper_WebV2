"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, Star, ExternalLink, UserSearch, Database } from "lucide-react";
import { useProject } from "@/lib/context/ProjectContext";
import { useJobs } from "@/lib/hooks/useJobs";
import { PlatformToggle } from "@/components/PlatformToggle";
import { ApifyKeyInput } from "@/components/ApifyKeyInput";

type Platform = "Instagram" | "TikTok";
type SortKey = "score" | "reach" | "er" | "posts" | "avgViews";
const ACCENT = "#fbbf24";

interface TrendRow {
  platform: string; search_target: string; video_url: string; username: string;
  caption: string; play_count: number; likes: number; comments: number;
  shares: number; video_duration: number; audio_track: string; content_type: string;
}

interface Kol {
  username: string; platform: string; posts: number; reach: number; avgViews: number;
  engagement: number; er: number; searches: number;
  topPostUrl: string; topPostViews: number; score: number;
}

// Has this creator been scraped (profile-audited) before — across any project/team?
interface KnownInfo { posts: number; projects: number; lastSeen: string | null }
type KnownMap = Record<string, KnownInfo>;

const fmt = (n: number) => {
  const v = Number(n) || 0;
  if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return String(v);
};

const profileUrl = (username: string, platform: string) =>
  platform === "Instagram"
    ? `https://www.instagram.com/${username}/`
    : `https://www.tiktok.com/@${username}`;

const SORTS: { id: SortKey; label: string }[] = [
  { id: "score",    label: "KOL score" },
  { id: "reach",    label: "Total reach" },
  { id: "er",       label: "Engagement rate" },
  { id: "avgViews", label: "Avg views" },
  { id: "posts",    label: "Appearances" },
];

export default function KolFinderPage() {
  const { activeProjectId, activeProjectName } = useProject();
  const { createJobs } = useJobs(null);

  const [platform, setPlatform] = useState<Platform>("Instagram");
  const [tags,     setTags]     = useState("");
  const [limit,    setLimit]    = useState(30);
  const [apifyKey, setApifyKey] = useState("");
  const [errors,   setErrors]   = useState<string[]>([]);
  const [queuing,  setQueuing]  = useState(false);
  const [okMsg,    setOkMsg]    = useState<string | null>(null);
  const [rows,     setRows]     = useState<TrendRow[]>([]);
  const [loading,  setLoading]  = useState(false);

  const [sortKey,  setSortKey]  = useState<SortKey>("score");
  const [minPosts, setMinPosts] = useState(1);
  const [known,    setKnown]    = useState<KnownMap>({});
  const [hideKnown, setHideKnown] = useState(false);

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

  // ── Aggregate hashtag-scrape authors into a ranked outreach roster ──
  // No follower counts exist for hashtag scrapes, so "outreach" is derived
  // from demonstrated reach + engagement + how often a creator surfaces.
  const roster = useMemo<Kol[]>(() => {
    const filtered = rows.filter((r) => r.platform === platform && r.username);
    if (filtered.length === 0) return [];

    type Acc = {
      username: string; platform: string; posts: number; reach: number;
      engagement: number; searches: Set<string>; topPostUrl: string; topPostViews: number;
    };
    const map = new Map<string, Acc>();
    for (const r of filtered) {
      const key = r.username.toLowerCase();
      const cur = map.get(key) ?? {
        username: r.username, platform: r.platform, posts: 0, reach: 0,
        engagement: 0, searches: new Set<string>(), topPostUrl: "", topPostViews: -1,
      };
      const plays = Number(r.play_count) || 0;
      cur.posts += 1;
      cur.reach += plays;
      cur.engagement += (Number(r.likes) || 0) + (Number(r.comments) || 0) + (Number(r.shares) || 0);
      if (r.search_target) cur.searches.add(r.search_target);
      if (plays > cur.topPostViews) { cur.topPostViews = plays; cur.topPostUrl = r.video_url; }
      map.set(key, cur);
    }

    const list = Array.from(map.values()).map((c) => ({
      username: c.username, platform: c.platform, posts: c.posts, reach: c.reach,
      avgViews: c.posts ? Math.round(c.reach / c.posts) : 0,
      engagement: c.engagement,
      er: c.reach ? (c.engagement / c.reach) * 100 : 0,
      searches: c.searches.size,
      topPostUrl: c.topPostUrl, topPostViews: Math.max(0, c.topPostViews), score: 0,
    }));

    // Composite score, normalised against the strongest creator in the pool.
    const maxReach = Math.max(...list.map((k) => k.reach), 1);
    const maxEr    = Math.max(...list.map((k) => k.er), 1);
    const maxPosts = Math.max(...list.map((k) => k.posts), 1);
    return list.map((k) => ({
      ...k,
      score: Math.round(100 * (0.5 * (k.reach / maxReach) + 0.3 * (k.er / maxEr) + 0.2 * (k.posts / maxPosts))),
    }));
  }, [rows, platform]);

  // Look up which roster creators we've already scraped, across all projects/teams.
  useEffect(() => {
    const names = roster.map((k) => k.username);
    if (names.length === 0) { setKnown({}); return; }
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams({ platform, usernames: names.join(",") });
        const res = await fetch(`/api/kol-finder/known?${params}`);
        const data = await res.json().catch(() => ({}));
        if (!cancelled) setKnown(res.ok ? (data.known ?? {}) : {});
      } catch { if (!cancelled) setKnown({}); }
    })();
    return () => { cancelled = true; };
  }, [roster, platform]);

  const isKnown = useCallback((u: string) => (known[u.toLowerCase()]?.posts ?? 0) > 0, [known]);

  const ranked = useMemo(() => {
    const f = roster.filter((k) => k.posts >= minPosts && (!hideKnown || !isKnown(k.username)));
    const sorters: Record<SortKey, (a: Kol, b: Kol) => number> = {
      score:    (a, b) => b.score - a.score,
      reach:    (a, b) => b.reach - a.reach,
      er:       (a, b) => b.er - a.er,
      posts:    (a, b) => b.posts - a.posts,
      avgViews: (a, b) => b.avgViews - a.avgViews,
    };
    return [...f].sort(sorters[sortKey]);
  }, [roster, sortKey, minPosts, hideKnown, isKnown]);

  // Suggested picks: top by score that appear more than once (not one-off flukes).
  const suggested = useMemo(() => {
    const base = roster.filter((k) => !hideKnown || !isKnown(k.username));
    const repeat = base.filter((k) => k.posts >= 2).sort((a, b) => b.score - a.score);
    return (repeat.length ? repeat : [...base].sort((a, b) => b.score - a.score)).slice(0, 4);
  }, [roster, hideKnown, isKnown]);

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
      setOkMsg(`Queued ${parsed.length} hashtag(s) on ${platform}. Creators appear here once the worker finishes.`);
      setTags("");
    } catch (e) {
      setErrors([e instanceof Error ? e.message : "Failed to queue. Try again."]);
    } finally { setQueuing(false); }
  }

  function exportCsv() {
    if (ranked.length === 0) return;
    const cols = ["rank", "username", "platform", "kol_score", "appearances", "total_reach", "avg_views", "total_engagement", "engagement_rate_pct", "hashtag_searches", "scraped_before", "db_posts_on_file", "db_projects", "profile_url", "top_post_url"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = ranked.map((k, i) => {
      const info = known[k.username.toLowerCase()];
      return [
        i + 1, k.username, k.platform, k.score, k.posts, k.reach, k.avgViews,
        k.engagement, k.er.toFixed(1), k.searches,
        info?.posts ? "yes" : "no", info?.posts ?? 0, info?.projects ?? 0,
        profileUrl(k.username, k.platform), k.topPostUrl,
      ].map(esc).join(",");
    });
    const csv = [cols.join(","), ...lines].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `kol_shortlist_${platform.toLowerCase()}_${Date.now()}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const cardCls = "bg-card border border-border rounded-xl";

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2" style={{ fontFamily: "Outfit, sans-serif" }}>
          <UserSearch className="w-5 h-5" style={{ color: ACCENT }} /> KOL Finder
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Rank the creators surfacing under your hashtags by outreach potential — reach, engagement and how often they show up — and flag who we&apos;ve already scraped across your projects &amp; teams, so you know who&apos;s fresh to approach.
          {activeProjectName && <span> · {activeProjectName}</span>}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-5 items-start">
        {/* ── Discover (queue a hashtag scrape) ── */}
        <div className="space-y-4">
          <div className={`${cardCls} p-5 space-y-3`}>
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Platform</p>
            <PlatformToggle value={platform} onChange={(p) => setPlatform(p as Platform)} />
          </div>
          <div className={`${cardCls} p-5 space-y-2`}>
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Hashtags to mine for creators</p>
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
            <p className="text-xs" style={{ color: "#f59e0b" }}>More posts = wider creator pool, more Apify credits.</p>
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
            {queuing ? "Queuing…" : "Find creators under these hashtags"}
          </button>
          {!activeProjectId && <p className="text-sm text-muted-foreground">Select a project first.</p>}
          <p className="text-xs text-muted-foreground">
            Already scraped hashtags (here or on the <a href="/hashtags" className="underline">Hashtag / Trends</a> page) feed this roster automatically.
          </p>
        </div>

        {/* ── Ranked roster ── */}
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Rank by</span>
              <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}
                className="px-2.5 py-1.5 text-xs rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
                {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground ml-2">Min appearances</span>
              <input type="number" min={1} max={50} value={minPosts}
                onChange={(e) => setMinPosts(Math.max(1, Number(e.target.value) || 1))}
                className="w-16 px-2 py-1.5 text-xs rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
              <label className="flex items-center gap-1.5 text-xs cursor-pointer ml-2 text-muted-foreground" title="Hide creators we've already profile-scraped in any project or team">
                <input type="checkbox" checked={hideKnown} onChange={(e) => setHideKnown(e.target.checked)} className="accent-primary" />
                Hide already-scraped
              </label>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={loadResults} title="Refresh" className="p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-colors">
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              </button>
              <button onClick={exportCsv} disabled={ranked.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors hover:bg-primary/10 disabled:opacity-40"
                style={{ borderColor: `${ACCENT}55`, color: ACCENT }}>
                <Download className="w-3.5 h-3.5" /> CSV shortlist
              </button>
            </div>
          </div>

          {roster.length === 0 ? (
            <div className={`${cardCls} p-12 text-center text-sm text-muted-foreground`}>
              {loading
                ? "Loading…"
                : `No ${platform} creators yet. Queue a hashtag scrape on the left — once the worker finishes, ranked creators show here.`}
            </div>
          ) : (
            <div className="space-y-4">
              {/* ── Suggested outreach targets ── */}
              {suggested.length > 0 && (
                <div className={`${cardCls} p-5`}>
                  <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
                    <Star className="w-3.5 h-3.5" style={{ color: ACCENT }} /> Suggested outreach targets
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {suggested.map((k) => (
                      <a key={k.username} href={profileUrl(k.username, k.platform)} target="_blank" rel="noopener noreferrer"
                        className="block rounded-lg p-3 border transition-colors hover:bg-white/[0.03]"
                        style={{ borderColor: `${ACCENT}33`, background: `${ACCENT}0a` }}>
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-foreground truncate">@{k.username}</span>
                          <span className="text-xs font-bold flex-shrink-0 ml-2" style={{ color: ACCENT }}>{k.score}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {fmt(k.reach)} reach · {k.er.toFixed(1)}% ER · {k.posts} post{k.posts !== 1 ? "s" : ""}
                          {k.searches > 1 ? ` across ${k.searches} searches` : ""}
                        </p>
                        {isKnown(k.username) ? (
                          <span className="inline-flex items-center gap-1 mt-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded"
                            style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", color: "#34d399" }}>
                            <Database className="w-2.5 h-2.5" /> Already in database
                          </span>
                        ) : (
                          <span className="inline-flex items-center mt-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded"
                            style={{ background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.25)", color: "#22d3ee" }}>
                            New creator
                          </span>
                        )}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Full ranked table ── */}
              <div className={`${cardCls} overflow-hidden`}>
                <div className="px-5 py-3 border-b border-border text-xs text-muted-foreground flex items-center justify-between">
                  <span>{ranked.length} creator{ranked.length !== 1 ? "s" : ""} · ranked by {SORTS.find((s) => s.id === sortKey)?.label.toLowerCase()}</span>
                  <span className="hidden sm:inline">Score = 50% reach · 30% engagement rate · 20% appearances (vs. top creator)</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr style={{ background: "#0f1e35" }}>
                      {["#", "Creator", "Score", "Reach", "Avg views", "Eng. rate", "Posts", ""].map((h) => (
                        <th key={h} className="px-4 py-2.5 text-left text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {ranked.map((k, i) => (
                        <tr key={k.username} className="border-t hover:bg-white/[0.02] transition-colors" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                          <td className="px-4 py-3 text-muted-foreground">{i + 1}</td>
                          <td className="px-4 py-3">
                            <a href={profileUrl(k.username, k.platform)} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground hover:underline">@{k.username}</a>
                            <span className="flex items-center gap-1.5 mt-0.5">
                              {(() => {
                                const info = known[k.username.toLowerCase()];
                                return info?.posts ? (
                                  <span
                                    title={`Scraped before — ${info.posts} post(s) on file${info.projects ? ` · ${info.projects} project(s)` : ""}${info.lastSeen ? ` · last ${info.lastSeen}` : ""}`}
                                    className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded"
                                    style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", color: "#34d399" }}>
                                    <Database className="w-2.5 h-2.5" /> In DB
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded"
                                    style={{ background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.25)", color: "#22d3ee" }}>
                                    New
                                  </span>
                                );
                              })()}
                              {k.searches > 1 && <span className="text-[10px] text-muted-foreground">· {k.searches} searches</span>}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-bold" style={{ color: ACCENT }}>{k.score}</td>
                          <td className="px-4 py-3 font-medium text-foreground">{fmt(k.reach)}</td>
                          <td className="px-4 py-3 text-muted-foreground">{fmt(k.avgViews)}</td>
                          <td className="px-4 py-3 text-muted-foreground">{k.er.toFixed(1)}%</td>
                          <td className="px-4 py-3 text-muted-foreground">{k.posts}</td>
                          <td className="px-4 py-3">
                            {k.topPostUrl && (
                              <a href={k.topPostUrl} target="_blank" rel="noopener noreferrer" title="Top post" className="text-muted-foreground hover:text-primary inline-flex">
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
