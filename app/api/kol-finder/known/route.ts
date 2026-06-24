import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Given a set of creator usernames, report which we've already scraped — across
// ALL projects/teams. The `{ig|tiktok}_influencer_profiles` tables are global
// (no project_id), so a username present there means a Profile Audit was run on
// that creator at some point by anyone. `kol_snapshots` (per-project) adds how
// many distinct projects have them and when they were last seen.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = request.nextUrl;
  const platform = searchParams.get("platform") || "Instagram";
  const raw = (searchParams.get("usernames") || "").trim();
  if (!raw) return NextResponse.json({ known: {} });

  // Bound the request — only need to check the visible roster.
  const usernames = Array.from(
    new Set(raw.split(",").map((u) => u.trim()).filter(Boolean))
  ).slice(0, 200);
  if (usernames.length === 0) return NextResponse.json({ known: {} });

  const pfx = platform === "Instagram" ? "ig" : "tiktok";
  const known: Record<string, { posts: number; projects: number; lastSeen: string | null }> = {};
  const keyOf = (u: string) => u.toLowerCase();

  // 1) Global audit data — posts on file per creator.
  const { data: profileRows, error: profErr } = await supabase
    .from(`${pfx}_influencer_profiles`)
    .select("username")
    .in("username", usernames);
  if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 });
  for (const r of profileRows ?? []) {
    const k = keyOf(String(r.username ?? ""));
    if (!k) continue;
    (known[k] ??= { posts: 0, projects: 0, lastSeen: null }).posts += 1;
  }

  // 2) Per-project snapshots — distinct projects + most recent sighting.
  const { data: snapRows } = await supabase
    .from("kol_snapshots")
    .select("username, project_id, snapshot_date")
    .eq("platform", platform)
    .in("username", usernames);
  const projectsByUser = new Map<string, Set<string>>();
  for (const r of snapRows ?? []) {
    const k = keyOf(String(r.username ?? ""));
    if (!k) continue;
    const entry = (known[k] ??= { posts: 0, projects: 0, lastSeen: null });
    const set = projectsByUser.get(k) ?? new Set<string>();
    if (r.project_id) set.add(String(r.project_id));
    projectsByUser.set(k, set);
    const d = r.snapshot_date ? String(r.snapshot_date).slice(0, 10) : null;
    if (d && (!entry.lastSeen || d > entry.lastSeen)) entry.lastSeen = d;
  }
  for (const [k, set] of Array.from(projectsByUser.entries())) {
    if (known[k]) known[k].projects = set.size;
  }

  return NextResponse.json({ known });
}
