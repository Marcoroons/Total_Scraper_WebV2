import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

async function verifyProjectAccess(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  userId: string
): Promise<boolean> {
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

  return false;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const project_id = searchParams.get("project_id");
  if (!project_id) {
    return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  }

  const hasAccess = await verifyProjectAccess(supabase, project_id, user.id);
  if (!hasAccess) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const status = searchParams.get("status") ?? undefined;
  const job_type = searchParams.get("job_type") ?? undefined;
  const ascending = searchParams.get("sort") === "asc";

  let query = supabase
    .from("scrape_jobs")
    .select("*")
    .eq("project_id", project_id);
  if (status) query = query.eq("status", status);
  if (job_type) query = query.eq("job_type", job_type);
  query = query.order("created_at", { ascending });

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobs } = await request.json();
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return NextResponse.json({ error: "jobs array is required" }, { status: 400 });
  }

  const project_id = jobs[0]?.project_id as string | undefined;
  if (!project_id || jobs.some((j) => j.project_id !== project_id)) {
    return NextResponse.json(
      { error: "All jobs must share the same project_id" },
      { status: 400 }
    );
  }

  const hasAccess = await verifyProjectAccess(supabase, project_id, user.id);
  if (!hasAccess) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = jobs.map(
    ({
      job_id: _id,
      status: _s,
      error_message: _e,
      created_at: _c,
      ...rest
    }) => ({ ...rest, status: "PENDING" })
  );

  let { data, error } = await supabase
    .from("scrape_jobs")
    .insert(rows)
    .select();

  // Column-safe: if the optional max_retries column hasn't been migrated yet,
  // strip it and retry so queueing still works.
  if (error && /max_retries/i.test(error.message)) {
    const stripped = rows.map(({ max_retries: _mr, ...r }) => r);
    ({ data, error } = await supabase.from("scrape_jobs").insert(stripped).select());
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}