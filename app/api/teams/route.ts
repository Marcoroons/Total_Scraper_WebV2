import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Auto-join: claim any pending team invites addressed to this user's email, so
  // an invited person joins the moment they sign in — no accept step. Best-effort
  // (skipped if the team_invites table isn't migrated yet).
  if (user.email) {
    const email = user.email.toLowerCase();
    const { data: invites } = await supabase
      .from("team_invites")
      .select("team_id, role")
      .eq("email", email);
    if (invites && invites.length > 0) {
      await supabase.from("team_members").upsert(
        invites.map((i: { team_id: string; role: string }) => ({ team_id: i.team_id, user_id: user.id, role: i.role })),
        { onConflict: "team_id,user_id", ignoreDuplicates: true }
      );
      await supabase.from("team_invites").delete().eq("email", email);
    }
  }

  const { data: memberships, error: memErr } = await supabase
    .from("team_members")
    .select("team_id, role")
    .eq("user_id", user.id);

  if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });
  if (!memberships || memberships.length === 0) return NextResponse.json([]);

  const teamIds = memberships.map((m: { team_id: string }) => m.team_id);

  const { data: teams, error: teamErr } = await supabase
    .from("teams")
    .select("team_id, team_name:name, created_at")
    .in("team_id", teamIds);

  if (teamErr) return NextResponse.json({ error: teamErr.message }, { status: 500 });

  const enriched = await Promise.all(
    (teams ?? []).map(async (team: { team_id: string; team_name: string; created_at: string }) => {
      const [memberRes, projectRes] = await Promise.all([
        supabase.from("team_members").select("team_id", { count: "exact", head: true }).eq("team_id", team.team_id),
        supabase.from("projects").select("project_id", { count: "exact", head: true }).eq("team_id", team.team_id),
      ]);
      return {
        ...team,
        member_count: memberRes.count ?? 0,
        project_count: projectRes.count ?? 0,
        my_role: memberships.find((m: { team_id: string; role: string }) => m.team_id === team.team_id)?.role ?? "member",
      };
    })
  );

  return NextResponse.json(enriched);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { team_name } = (await request.json()) as { team_name?: string };
  if (!team_name?.trim()) return NextResponse.json({ error: "team_name is required" }, { status: 400 });
  if (team_name.trim().length > 100) return NextResponse.json({ error: "team_name too long (max 100 chars)" }, { status: 400 });

  const { data: team, error } = await supabase
    .from("teams")
    .insert({ name: team_name.trim(), owner_id: user.id })
    .select("team_id, team_name:name, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from("team_members").insert({
    team_id: team.team_id,
    user_id: user.id,
    role: "admin",
  });

  return NextResponse.json({ ...team, member_count: 1, project_count: 0, my_role: "admin" }, { status: 201 });
}
