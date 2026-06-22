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

const COLUMNS = "job_id, target_url, platform, job_type, kol_username, status, created_at";

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

  return NextResponse.json({ jobs: jobs ?? [], prevTotal });
}
