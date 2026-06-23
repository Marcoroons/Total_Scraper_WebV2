import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type SB = Awaited<ReturnType<typeof createClient>>;

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
      .from("team_members").select("user_id")
      .eq("team_id", project.team_id).eq("user_id", userId).single();
    if (member) return true;
  }
  const { data: pm } = await supabase
    .from("project_members").select("user_id")
    .eq("project_id", projectId).eq("user_id", userId).maybeSingle();
  return !!pm;
}

/**
 * Returns the most recent scraped post count per username for a project + platform,
 * sourced from kol_snapshots.total_posts (written by the worker once per scrape run).
 * Response: { counts: { "<username>": { total_posts, snapshot_date } } }
 * Best-effort: if kol_snapshots doesn't exist yet, returns an empty map.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = request.nextUrl;
  const projectId = searchParams.get("project_id");
  const platform  = searchParams.get("platform");
  const usernames = (searchParams.get("usernames") ?? "").split(",").map((u) => u.trim()).filter(Boolean);

  if (!projectId || !platform) {
    return NextResponse.json({ error: "project_id and platform are required" }, { status: 400 });
  }
  if (!(await verifyProjectAccess(supabase, projectId, user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (usernames.length === 0) return NextResponse.json({ counts: {} });

  const { data, error } = await supabase
    .from("kol_snapshots")
    .select("username, total_posts, snapshot_date")
    .eq("project_id", projectId)
    .eq("platform", platform)
    .in("username", usernames)
    .order("snapshot_date", { ascending: false });

  // Table may not be migrated yet — treat as "no data" rather than erroring.
  if (error) return NextResponse.json({ counts: {} });

  // Keep the most recent snapshot per username (rows are ordered desc by date).
  const counts: Record<string, { total_posts: number; snapshot_date: string }> = {};
  for (const row of data ?? []) {
    if (!(row.username in counts)) {
      counts[row.username] = { total_posts: row.total_posts ?? 0, snapshot_date: row.snapshot_date };
    }
  }

  return NextResponse.json({ counts });
}
