import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type SB = Awaited<ReturnType<typeof createClient>>;

/** Mirror the access check used by /api/jobs (owner or team member). */
async function verifyProjectAccess(supabase: SB, projectId: string, userId: string): Promise<boolean> {
  const { data: project } = await supabase
    .from("projects")
    .select("user_id, team_id")
    .eq("project_id", projectId)
    .single();

  if (!project) return false;
  if (project.user_id === userId) return true;

  if (project.team_id) {
    const { data: member } = await supabase
      .from("team_members")
      .select("user_id")
      .eq("team_id", project.team_id)
      .eq("user_id", userId)
      .single();
    if (member) return true;
  }

  // Per-project sharing fallback (project_members).
  const { data: pm } = await supabase
    .from("project_members")
    .select("user_id")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  return !!pm;
}

const COLUMNS = "job_id, target_url, platform, job_type, kol_username, target_limit, status, created_at";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const projectId = searchParams.get("project_id");
  if (!projectId) {
    return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  }

  const hasAccess = await verifyProjectAccess(supabase, projectId, user.id);
  if (!hasAccess) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // job_type DB values to include, comma-separated. Empty => nothing selected.
  const typesParam = searchParams.get("types") ?? "";
  const types = typesParam.split(",").map((t) => t.trim()).filter(Boolean);
  if (types.length === 0) {
    return NextResponse.json({ jobs: [], prevTotal: 0 });
  }

  const from = searchParams.get("from"); // ISO timestamp (inclusive)
  const to   = searchParams.get("to");   // ISO timestamp (inclusive)
  if (!from || !to) {
    return NextResponse.json({ error: "from and to are required" }, { status: 400 });
  }

  // Current-window jobs
  const { data: jobs, error } = await supabase
    .from("scrape_jobs")
    .select(COLUMNS)
    .eq("project_id", projectId)
    .in("job_type", types)
    .gte("created_at", from)
    .lte("created_at", to)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Previous equal-length window (for an honest trend delta).
  let prevTotal = 0;
  const fromMs = Date.parse(from);
  const toMs   = Date.parse(to);
  if (!Number.isNaN(fromMs) && !Number.isNaN(toMs) && toMs > fromMs) {
    const len      = toMs - fromMs;
    const prevFrom = new Date(fromMs - len).toISOString();
    const prevTo   = new Date(fromMs - 1).toISOString();
    const { count } = await supabase
      .from("scrape_jobs")
      .select("job_id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .in("job_type", types)
      .gte("created_at", prevFrom)
      .lte("created_at", prevTo);
    prevTotal = count ?? 0;
  }

  // ── Aggregate real engagement metrics for the scraped content ───────────────
  // The ig_/tiktok_ data tables are keyed by username (profiles) / video_url
  // (videos) and share the columns play_count, likes, comments, shares. We pull
  // the identifiers from this window's COMPLETED jobs, then sum the data tables.
  const completed = (jobs ?? []).filter((j) => j.status === "COMPLETED");
  const pfx = (platform: string) => (platform === "Instagram" ? "ig" : "tiktok");

  const profUsers: Record<string, Set<string>> = {};
  const vidUrls:   Record<string, Set<string>> = {};
  for (const j of completed) {
    if (j.job_type === "Profile Feed (Audit)" && j.kol_username) {
      (profUsers[j.platform] ??= new Set()).add(j.kol_username);
    } else if (j.job_type === "Specific URLs (Video Stats)" && j.target_url) {
      (vidUrls[j.platform] ??= new Set()).add(j.target_url);
    }
  }

  type Agg = { name: string; platform: string; views: number; likes: number; comments: number; shares: number; posts: number };
  const perKol = new Map<string, Agg>();
  const N = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  function accumulate(platform: string, name: string, row: { play_count?: unknown; likes?: unknown; comments?: unknown; shares?: unknown }) {
    const key = `${platform}__${name}`;
    const a = perKol.get(key) ?? { name, platform, views: 0, likes: 0, comments: 0, shares: 0, posts: 0 };
    a.views += N(row.play_count); a.likes += N(row.likes); a.comments += N(row.comments); a.shares += N(row.shares); a.posts += 1;
    perKol.set(key, a);
  }

  // Profile audit data (by username)
  for (const platform of Object.keys(profUsers)) {
    const usernames = Array.from(profUsers[platform]);
    if (usernames.length === 0) continue;
    const { data } = await supabase
      .from(`${pfx(platform)}_influencer_profiles`)
      .select("username, play_count, likes, comments, shares")
      .in("username", usernames);
    for (const row of data ?? []) accumulate(platform, String(row.username || "(unknown)"), row);
  }
  // Video stats data (by video_url, attributed to its username)
  for (const platform of Object.keys(vidUrls)) {
    const urls = Array.from(vidUrls[platform]);
    if (urls.length === 0) continue;
    const { data } = await supabase
      .from(`${pfx(platform)}_campaign_videos`)
      .select("username, video_url, play_count, likes, comments, shares")
      .in("video_url", urls);
    for (const row of data ?? []) accumulate(platform, String(row.username || row.video_url || "(unknown)"), row);
  }

  const kols = Array.from(perKol.values()).sort((a, b) => b.views - a.views);
  const totals = kols.reduce(
    (t, k) => ({ views: t.views + k.views, likes: t.likes + k.likes, comments: t.comments + k.comments, shares: t.shares + k.shares, posts: t.posts + k.posts }),
    { views: 0, likes: 0, comments: 0, shares: 0, posts: 0 }
  );
  const viewsByPlatform: Record<string, number> = {};
  for (const k of kols) viewsByPlatform[k.platform] = (viewsByPlatform[k.platform] ?? 0) + k.views;

  // ── Scrape completeness / failure rate (profile feed jobs) ──────────────────
  // For each completed profile scrape, compare the posts we actually have for
  // that KOL against the requested target_limit. "empty" = nothing came back at
  // all (the reliable hard-failure signal: private / rate-limited / failed).
  // "partial" = fewer than requested (note: post counts are cumulative per KOL,
  // so partial is a conservative lower bound).
  const postsByKey = new Map<string, number>();
  for (const k of kols) postsByKey.set(`${k.platform}__${k.name}`, k.posts);

  const profileJobs = completed.filter((j) => j.job_type === "Profile Feed (Audit)" && j.kol_username);
  let empty = 0, partial = 0, ok = 0;
  for (const j of profileJobs) {
    const got = postsByKey.get(`${j.platform}__${j.kol_username}`) ?? 0;
    const req = Number((j as { target_limit?: unknown }).target_limit) || 0;
    if (got === 0) empty++;
    else if (req > 0 && got < req) partial++;
    else ok++;
  }
  const profileTotal = profileJobs.length;
  const failures     = empty + partial;
  const completeness = {
    profileTotal,
    empty,
    partial,
    ok,
    failures,
    emptyRate:   profileTotal > 0 ? (empty / profileTotal) * 100 : 0,
    failureRate: profileTotal > 0 ? (failures / profileTotal) * 100 : 0,
  };

  return NextResponse.json({ jobs: jobs ?? [], prevTotal, totals, kols, viewsByPlatform, completeness });
}
