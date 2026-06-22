import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const SELECT = "project_id, project_name, user_id, team_id";
  type Proj = { project_id: string; project_name: string; user_id: string | null; team_id: string | null };

  // 1. Personal projects owned directly by this user.
  const { data: personal } = await supabase
    .from("projects")
    .select(SELECT)
    .eq("user_id", user.id)
    .is("team_id", null);

  // 2. Team projects (existing team-based sharing model).
  const { data: teamMemberships } = await supabase
    .from("team_members")
    .select("team_id")
    .eq("user_id", user.id);

  let teamProjects: Proj[] = [];
  const teamIds = (teamMemberships ?? []).map((m: { team_id: string }) => m.team_id);
  if (teamIds.length > 0) {
    const { data } = await supabase.from("projects").select(SELECT).in("team_id", teamIds);
    teamProjects = (data as Proj[]) ?? [];
  }

  // 3. Projects shared with this user via project_members (per-project sharing).
  const { data: memberRows } = await supabase
    .from("project_members")
    .select("project_id")
    .eq("user_id", user.id);

  let sharedProjects: Proj[] = [];
  const memberProjectIds = (memberRows ?? []).map((m: { project_id: string }) => m.project_id);
  if (memberProjectIds.length > 0) {
    const { data } = await supabase.from("projects").select(SELECT).in("project_id", memberProjectIds);
    sharedProjects = (data as Proj[]) ?? [];
  }

  // Merge all three sources, de-duplicating by project_id.
  const byId = new Map<string, Proj>();
  for (const p of [...((personal ?? []) as Proj[]), ...teamProjects, ...sharedProjects]) {
    byId.set(p.project_id, p);
  }

  return NextResponse.json([...byId.values()]);
}

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { project_name } = await request.json();
  if (!project_name?.trim()) {
    return NextResponse.json(
      { error: "project_name is required" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("projects")
    .insert({ project_name: project_name.trim(), user_id: user.id })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Give the creator an 'owner' membership row so per-project sharing works.
  // Best-effort: if the project_members table isn't migrated yet, the project
  // is still created (the owner can access it via the personal-project query).
  const { error: memberErr } = await supabase
    .from("project_members")
    .insert({ project_id: data.project_id, user_id: user.id, role: "owner" });
  if (memberErr) {
    console.error("[/api/projects] failed to write owner membership:", memberErr.message);
  }

  return NextResponse.json(data, { status: 201 });
}