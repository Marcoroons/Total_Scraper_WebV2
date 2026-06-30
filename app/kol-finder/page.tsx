"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, Star, ExternalLink, UserSearch, Database, Trash2 } from "lucide-react";
import { CatSpinner } from "@/components/CatSpinner";
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
  posted_at?: string | null;
}

interface Kol {
  username: string; platform: string; posts: number; reach: number; avgViews: number;
  likes: number; comments: number; shares: number;
  engagement: number; er: number; searches: number;
  topPostUrl: string; topPostViews: number; score: number;
  newestPostedAt: string | null;
}

// Heuristic patterns that flag brand / business / reseller accounts rather
// than individual KOLs. User can toggle the bundle on/off and extend via a
// custom-pattern field.
const BUSINESS_PATTERNS = [
  "official", ".id", "_id", "indonesia", "store", "shop", "brand", "mart", "resmi", ".co", "ltd", "inc",
];

const DATE_WINDOWS: { value: number; label: string }[] = [
  { value: 0,   label: "All time" },
  { value: 7,   label: "Last 7 days" },
  { value: 14,  label: "Last 14 days" },
  { value: 30,  label: "Last 30 days" },
  { value: 90,  label: "Last 90 days" },
];

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
  const [hashtagFilter, setHashtagFilter] = useState("");
  // KOL-quality filters
  const [hideBusiness, setHideBusiness] = useState(true);
  const [customExclude, setCustomExclude] = useState("");
  const [dateWindowDays, setDateWindowDays] = useState(0);

  const [deletingTag, setDeletingTag] = useState<string | null>(null);

  const deleteHashtag = useCallback(async (tag: string) => {
    if (!activeProjectId || !tag) return;
    if (!confirm(
      `Delete every scraped post tagged "#${tag}" on ${platform}? ` +
      `Jobs in the Queue stay; only the captured trend_discovery rows are wiped. ` +
      `KOL Finder, the Hashtag/Trends page, and any creators only seen via this hashtag will lose data.`
    )) return;
    setDeletingTag(tag);
    try {
      const params = new URLSearchParams({ project_id: activeProjectId, hashtag: tag, platform });
      const res = await fetch(`/api/trends?${params}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
      const n = (data as { deleted?: number }).deleted ?? 0;
      setOkMsg(`Deleted ${n} post(s) tagged #${tag} on ${platform}.`);
      // Reset filter if we just nuked the selected hashtag, then reload.
      setHashtagFilter("");
      await loadResults();
    } catch (e) {
      setErrors([e instanceof Error ? e.message : "Failed to delete hashtag data."]);
    } finally {
      setDeletingTag(null);
    }
  // loadResults is defined just below — referenced via closure, safe.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId, platform]);

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

  // Distinct hashtags present in the scraped data for this platform. Auto-grows
  // as the user scrapes more hashtags — feeds the filter dropdown.
  const availableHashtags = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.platform !== platform) continue;
      for (const t of (r.search_target || "").split(",")) {
        const tag = t.replace(/#/g, "").trim();
        if (tag) set.add(tag);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows, platform]);

  // ── Aggregate hashtag-scrape authors into a ranked outreach roster ──
  // No follower counts exist for hashtag scrapes, so "outreach" is derived
  // from demonstrated reach + engagement + how often a creator surfaces.
  const roster = useMemo<Kol[]>(() => {
    // Date-window cutoff (in epoch ms). 0 = no date filter.
    const cutoffMs = dateWindowDays > 0
      ? Date.now() - dateWindowDays * 86400000
      : 0;

    const filtered = rows.filter((r) => {
      if (r.platform !== platform || !r.username) return false;
      if (hashtagFilter !== "" &&
          !(r.search_target || "").split(",").some((t) => t.replace(/#/g, "").trim() === hashtagFilter))
        return false;
      // Date filter — posts without a posted_at are kept ONLY when no
      // date window is set, so the filter is strict ("last N days" means
      // posts with a known date in that window).
      if (cutoffMs > 0) {
        if (!r.posted_at) return false;
        const t = new Date(r.posted_at).getTime();
        if (!Number.isFinite(t) || t < cutoffMs) return false;
      }
      return true;
    });
    if (filtered.length === 0) return [];

    type Acc = {
      username: string; platform: string; posts: number; reach: number;
      likes: number; comments: number; shares: number;
      searches: Set<string>; topPostUrl: string; topPostViews: number;
      newestPostedAt: string | null;
    };
    const map = new Map<string, Acc>();
    for (const r of filtered) {
      const key = r.username.toLowerCase();
      const cur = map.get(key) ?? {
        username: r.username, platform: r.platform, posts: 0, reach: 0,
        likes: 0, comments: 0, shares: 0,
        searches: new Set<string>(), topPostUrl: "", topPostViews: -1,
        newestPostedAt: null as string | null,
      };
      const plays = Number(r.play_count) || 0;
      cur.posts += 1;
      cur.reach += plays;
      cur.likes    += Number(r.likes)    || 0;
      cur.comments += Number(r.comments) || 0;
      cur.shares   += Number(r.shares)   || 0;
      if (r.search_target) cur.searches.add(r.search_target);
      if (plays > cur.topPostViews) { cur.topPostViews = plays; cur.topPostUrl = r.video_url; }
      if (r.posted_at && (!cur.newestPostedAt || r.posted_at > cur.newestPostedAt)) {
        cur.newestPostedAt = r.posted_at;
      }
      map.set(key, cur);
    }

    const list = Array.from(map.values()).map((c) => {
      const engagement = c.likes + c.comments + c.shares;
      return {
        username: c.username, platform: c.platform, posts: c.posts, reach: c.reach,
        avgViews: c.posts ? Math.round(c.reach / c.posts) : 0,
        likes: c.likes, comments: c.comments, shares: c.shares,
        engagement,
        er: c.reach ? (engagement / c.reach) * 100 : 0,
        searches: c.searches.size,
        topPostUrl: c.topPostUrl, topPostViews: Math.max(0, c.topPostViews), score: 0,
        newestPostedAt: c.newestPostedAt,
      };
    });

    // Composite score, normalised against the strongest creator in the pool.
    const maxReach = Math.max(...list.map((k) => k.reach), 1);
    const maxEr    = Math.max(...list.map((k) => k.er), 1);
    const maxPosts = Math.max(...list.map((k) => k.posts), 1);
    return list.map((k) => ({
      ...k,
      score: Math.round(100 * (0.5 * (k.reach / maxReach) + 0.3 * (k.er / maxEr) + 0.2 * (k.posts / maxPosts))),
    }));
  }, [rows, platform, hashtagFilter, dateWindowDays]);

  // Compiled exclusion tester. Returns true if username should be excluded.
  const isExcluded = useCallback((username: string): boolean => {
    const u = username.toLowerCase();
    if (hideBusiness && BUSINESS_PATTERNS.some((p) => u.includes(p))) return true;
    const customs = customExclude.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (customs.length && customs.some((p) => u.includes(p))) return true;
    return false;
  }, [hideBusiness, customExclude]);

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
    const f = roster.filter((k) =>
      k.posts >= minPosts
      && (!hideKnown || !isKnown(k.username))
      && !isExcluded(k.username)
    );
    const sorters: Record<SortKey, (a: Kol, b: Kol) => number> = {
      score:    (a, b) => b.score - a.score,
      reach:    (a, b) => b.reach - a.reach,
      er:       (a, b) => b.er - a.er,
      posts:    (a, b) => b.posts - a.posts,
      avgViews: (a, b) => b.avgViews - a.avgViews,
    };
    return [...f].sort(sorters[sortKey]);
  }, [roster, sortKey, minPosts, hideKnown, isKnown, isExcluded]);

  // Suggested picks: top by score that appear more than once (not one-off flukes).
  const suggested = useMemo(() => {
    const base = roster.filter((k) => (!hideKnown || !isKnown(k.username)) && !isExcluded(k.username));
    const repeat = base.filter((k) => k.posts >= 2).sort((a, b) => b.score - a.score);
    return (repeat.length ? repeat : [...base].sort((a, b) => b.score - a.score)).slice(0, 4);
  }, [roster, hideKnown, isKnown, isExcluded]);

  // Dedupe summary — at-a-glance "12 new / 18 in DB / 4 excluded".
  const summary = useMemo(() => {
    let news = 0, inDb = 0, excluded = 0;
    for (const k of roster) {
      if (isExcluded(k.username)) { excluded++; continue; }
      if (isKnown(k.username)) inDb++; else news++;
    }
    return { news, inDb, excluded, total: roster.length };
  }, [roster, isKnown, isExcluded]);

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
    const cols = [
      "rank", "username", "platform", "kol_score", "appearances", "total_reach", "avg_views",
      "total_likes", "total_comments", "total_shares", "total_engagement", "engagement_rate_pct",
      "hashtag_searches", "latest_post_date", "scraped_before", "db_posts_on_file", "db_projects",
      "profile_url", "top_post_url",
    ];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = ranked.map((k, i) => {
      const info = known[k.username.toLowerCase()];
      return [
        i + 1, k.username, k.platform, k.score, k.posts, k.reach, k.avgViews,
        k.likes, k.comments, k.shares, k.engagement, k.er.toFixed(1),
        k.searches, k.newestPostedAt ?? "",
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
            <PlatformToggle value={platform} onChange={(p) => { setPlatform(p as Platform); setHashtagFilter(""); }} />
            <p className="text-[11px] text-muted-foreground leading-snug">
              YouTube isn&apos;t available here — it has no creator-feed-by-hashtag equivalent. Use <a href="/profile-tracker" className="underline">Profile</a> scrapes to audit specific YouTube channels.
            </p>
          </div>
          <div className={`${cardCls} p-5 space-y-2`}>
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Hashtags to mine for creators</p>
            <textarea value={tags} onChange={(e) => setTags(e.target.value)} rows={4}
              placeholder="one per line or comma-separated&#10;e.g. yogurt, healthysnack, fyp"
              className="w-full px-3 py-2 text-sm rounded-lg bg-input border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y" />
            <p className="text-xs text-muted-foreground">The # is optional — we strip it. <span className="text-foreground">Tip:</span> Indonesia-centric tags (susu sapi, susu segar, yogurt) surface local creators.</p>
          </div>
          {/* Region note — TikTok is locked to Indonesia; Instagram can't be */}
          {platform === "Instagram" ? (
            <div className="rounded-xl p-4" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)" }}>
              <p className="text-xs" style={{ color: "#f59e0b" }}>
                ⚠️ Instagram hashtags are global — results can&apos;t be locked to Indonesia. Use Indonesia-specific hashtags (e.g. <span className="font-medium">susu sapi, susu segar, yogurt</span>) to keep creators local.
              </p>
            </div>
          ) : (
            <div className="rounded-xl p-4" style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" }}>
              <p className="text-xs" style={{ color: "#10b981" }}>
                🌏 TikTok results are locked to Indonesia (creators in region ID only).
              </p>
            </div>
          )}
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
          <div className="space-y-3 mb-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Hashtag</span>
                <select value={hashtagFilter} onChange={(e) => setHashtagFilter(e.target.value)}
                  className="px-2.5 py-1.5 text-xs rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring max-w-[170px]">
                  <option value="">All hashtags{availableHashtags.length ? ` (${availableHashtags.length})` : ""}</option>
                  {availableHashtags.map((h) => <option key={h} value={h}>#{h}</option>)}
                </select>
                {hashtagFilter && (
                  <button
                    type="button"
                    onClick={() => deleteHashtag(hashtagFilter)}
                    disabled={deletingTag === hashtagFilter}
                    title={`Delete every scraped post tagged #${hashtagFilter} on ${platform}`}
                    className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-border text-muted-foreground hover:text-red-400 hover:border-red-400/40 disabled:opacity-30 transition-colors"
                  >
                    {deletingTag === hashtagFilter ? <CatSpinner size={12} /> : <Trash2 className="w-3.5 h-3.5" />}
                  </button>
                )}
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground ml-2">Rank by</span>
                <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}
                  className="px-2.5 py-1.5 text-xs rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
                  {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground ml-2">Posted</span>
                <select value={dateWindowDays} onChange={(e) => setDateWindowDays(Number(e.target.value))}
                  className="px-2.5 py-1.5 text-xs rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  title="Filter to creators whose posts in this scrape were made within the chosen window. Posts without a post-date are excluded once a window is set.">
                  {DATE_WINDOWS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
                </select>
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground ml-2">Min appearances</span>
                <input type="number" min={1} max={50} value={minPosts}
                  onChange={(e) => setMinPosts(Math.max(1, Number(e.target.value) || 1))}
                  className="w-16 px-2 py-1.5 text-xs rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <div className="flex items-center gap-2">
                <button onClick={loadResults} title="Refresh" className="p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-colors">
                  {loading ? <CatSpinner size={16} /> : <RefreshCw className="w-4 h-4" />}
                </button>
                <button onClick={exportCsv} disabled={ranked.length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors hover:bg-primary/10 disabled:opacity-40"
                  style={{ borderColor: `${ACCENT}55`, color: ACCENT }}>
                  <Download className="w-3.5 h-3.5" /> CSV shortlist
                </button>
              </div>
            </div>

            {/* Quality filters — exclude business accounts + dedupe summary */}
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <label className="flex items-center gap-1.5 cursor-pointer" title={`Exclude usernames containing any of: ${BUSINESS_PATTERNS.join(", ")}`}>
                <input type="checkbox" checked={hideBusiness} onChange={(e) => setHideBusiness(e.target.checked)} className="accent-primary" />
                Exclude brand / shop accounts
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer" title="Hide creators we've already profile-scraped across any project or team">
                <input type="checkbox" checked={hideKnown} onChange={(e) => setHideKnown(e.target.checked)} className="accent-primary" />
                Hide already-scraped
              </label>
              <input
                type="text"
                value={customExclude}
                onChange={(e) => setCustomExclude(e.target.value)}
                placeholder="custom exclusions: comma-separated (e.g. mycompetitor, partner)"
                className="flex-1 min-w-[200px] px-2 py-1 text-xs rounded-lg bg-input border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {roster.length > 0 && (
              <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                <span><span className="text-foreground font-semibold">{summary.total}</span> creator{summary.total !== 1 ? "s" : ""} found</span>
                <span>· <span style={{ color: "#22d3ee" }}>{summary.news}</span> new</span>
                <span>· <span style={{ color: "#34d399" }}>{summary.inDb}</span> already in DB</span>
                {summary.excluded > 0 && (
                  <span>· <span className="text-yellow-400">{summary.excluded}</span> filtered out{hideBusiness || customExclude.trim() ? " by exclusions" : ""}</span>
                )}
                {dateWindowDays > 0 && (
                  <span>· posted in last {dateWindowDays} day{dateWindowDays !== 1 ? "s" : ""}</span>
                )}
              </div>
            )}
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
                      {["#", "Creator", "Score", "Reach", "Avg views", "Likes", "Comments", "Shares", "Eng. rate", "Posts", "Latest", ""].map((h) => (
                        <th key={h} className="px-3 py-2.5 text-left text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {ranked.map((k, i) => (
                        <tr key={k.username} className="border-t hover:bg-white/[0.02] transition-colors" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                          <td className="px-3 py-3 text-muted-foreground">{i + 1}</td>
                          <td className="px-3 py-3">
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
                          <td className="px-3 py-3 font-bold" style={{ color: ACCENT }}>{k.score}</td>
                          <td className="px-3 py-3 font-medium text-foreground">{fmt(k.reach)}</td>
                          <td className="px-3 py-3 text-muted-foreground">{fmt(k.avgViews)}</td>
                          <td className="px-3 py-3 text-muted-foreground">{fmt(k.likes)}</td>
                          <td className="px-3 py-3 text-muted-foreground">{fmt(k.comments)}</td>
                          <td className="px-3 py-3 text-muted-foreground">{fmt(k.shares)}</td>
                          <td className="px-3 py-3 text-muted-foreground">{k.er.toFixed(1)}%</td>
                          <td className="px-3 py-3 text-muted-foreground">{k.posts}</td>
                          <td className="px-3 py-3 text-muted-foreground text-xs whitespace-nowrap">
                            {k.newestPostedAt
                              ? new Date(k.newestPostedAt).toLocaleDateString("en-SG", { day: "2-digit", month: "short", year: "2-digit" })
                              : "—"}
                          </td>
                          <td className="px-3 py-3">
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
