import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type SB = Awaited<ReturnType<typeof createClient>>;

async function verifyProjectAccess(supabase: SB, projectId: string, userId: string): Promise<boolean> {
  const { data: project } = await supabase
    .from("projects").select("user_id, team_id").eq("project_id", projectId).single();
  if (!project) return false;
  if (project.user_id === userId) return true;
  if (project.team_id) {
    const { data: m } = await supabase
      .from("team_members").select("user_id").eq("team_id", project.team_id).eq("user_id", userId).maybeSingle();
    if (m) return true;
  }
  const { data: pm } = await supabase
    .from("project_members").select("user_id").eq("project_id", projectId).eq("user_id", userId).maybeSingle();
  return !!pm;
}

// Returns hashtag/trend-discovery rows for a project, newest-engagement first.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = request.nextUrl;
  const projectId = searchParams.get("project_id");
  const platform  = searchParams.get("platform") || undefined;
  if (!projectId) return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  if (!(await verifyProjectAccess(supabase, projectId, user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let query = supabase
    .from("trend_discovery")
    .select("platform, search_target, video_url, username, caption, play_count, likes, comments, shares, video_duration, audio_track, content_type, posted_at")
    .eq("project_id", projectId);
  if (platform) query = query.eq("platform", platform);

  const first = await query.order("play_count", { ascending: false }).limit(1000);
  let data: unknown = first.data;
  let error = first.error;
  // Column-safe: if posted_at hasn't been migrated yet, retry without it.
  if (error && /posted_at/i.test(error.message)) {
    let retry = supabase
      .from("trend_discovery")
      .select("platform, search_target, video_url, username, caption, play_count, likes, comments, shares, video_duration, audio_track, content_type")
      .eq("project_id", projectId);
    if (platform) retry = retry.eq("platform", platform);
    const second = await retry.order("play_count", { ascending: false }).limit(1000);
    data = second.data;
    error = second.error;
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data ?? [] });
}
