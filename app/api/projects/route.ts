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

  const { data: personal } = await supabase
    .from("projects")
    .select("project_id, project_name, user_id, team_id")
    .eq("user_id", user.id)
    .is("team_id", null);

  const { data: teamMemberships } = await supabase
    .from("team_members")
    .select("team_id")
    .eq("user_id", user.id);

  let teamProjects: unknown[] = [];
  const teamIds = (teamMemberships ?? []).map(
    (m: { team_id: string }) => m.team_id
  );
  if (teamIds.length > 0) {
    const { data } = await supabase
      .from("projects")
      .select("project_id, project_name, user_id, team_id")
      .in("team_id", teamIds);
    teamProjects = data ?? [];
  }

  return NextResponse.json([...(personal ?? []), ...teamProjects]);
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

  return NextResponse.json(data, { status: 201 });
}