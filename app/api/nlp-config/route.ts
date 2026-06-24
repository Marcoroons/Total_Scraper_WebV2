import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type SB = Awaited<ReturnType<typeof createClient>>;

/** Owner, team member, or per-project member may access the project. */
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

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const project_id = new URL(request.url).searchParams.get("project_id");
  if (!project_id) return NextResponse.json({ error: "project_id required" }, { status: 400 });
  if (!(await verifyProjectAccess(supabase, project_id, user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("nlp_configs").select("*").eq("project_id", project_id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ config: data ?? null });
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { project_id, ...fields } = body as { project_id?: string; [k: string]: unknown };
  if (!project_id) return NextResponse.json({ error: "project_id required" }, { status: 400 });
  if (!(await verifyProjectAccess(supabase, project_id, user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: existing } = await supabase
    .from("nlp_configs").select("project_id").eq("project_id", project_id).maybeSingle();

  let error;
  if (!existing) {
    ({ error } = await supabase.from("nlp_configs").insert({ project_id, ...fields }));
  } else {
    ({ error } = await supabase.from("nlp_configs").update(fields).eq("project_id", project_id));
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
