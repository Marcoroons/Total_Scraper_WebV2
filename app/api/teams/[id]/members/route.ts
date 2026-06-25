import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const VALID_ROLES = ["admin", "analyst", "editor", "viewer"];

async function assertMember(supabase: Awaited<ReturnType<typeof createClient>>, teamId: string, userId: string) {
  const { data } = await supabase
    .from("team_members")
    .select("role")
    .eq("team_id", teamId)
    .eq("user_id", userId)
    .maybeSingle();
  return data as { role: string } | null;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const membership = await assertMember(supabase, params.id, user.id);
  if (!membership) return NextResponse.json({ error: "Not a member of this team" }, { status: 403 });

  // NB: select only columns guaranteed to exist on team_members (user_id, role).
  // The table has no created_at in some schema versions — don't depend on it.
  const { data: members, error } = await supabase
    .from("team_members")
    .select("user_id, role")
    .eq("team_id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (members ?? []).map((m: { user_id: string }) => m.user_id);
  const emailById = new Map<string, string>();
  const nameById  = new Map<string, string>();

  if (ids.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email, full_name")
      .in("id", ids);
    for (const p of profiles ?? []) {
      emailById.set(p.id, p.email ?? "");
      if (p.full_name) nameById.set(p.id, p.full_name);
    }
  }

  const enriched = (members ?? []).map((m: { user_id: string; role: string }) => ({
    user_id:    m.user_id,
    email:      emailById.get(m.user_id) ?? "(unknown)",
    full_name:  nameById.get(m.user_id) ?? null,
    role:       m.role,
    created_at: null as string | null,
  }));

  // Pending team invites (best-effort — table may not exist yet)
  const { data: pending } = await supabase
    .from("team_invites")
    .select("email, role, created_at")
    .eq("team_id", params.id)
    .order("created_at", { ascending: true });

  return NextResponse.json({
    members: enriched,
    pending: pending ?? [],
    current_user_id: user.id,
  });
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const membership = await assertMember(supabase, params.id, user.id);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await request.json()) as { email?: string; role?: string };
  const cleanEmail = body.email?.trim().toLowerCase();
  if (!cleanEmail) return NextResponse.json({ error: "email is required" }, { status: 400 });

  const role = VALID_ROLES.includes(body.role ?? "") ? body.role! : "analyst";

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email")
    .eq("email", cleanEmail)
    .maybeSingle();

  if (!profile) {
    const { error: invErr } = await supabase
      .from("team_invites")
      .upsert(
        { team_id: params.id, email: cleanEmail, role, invited_by: user.id },
        { onConflict: "team_id,email", ignoreDuplicates: true }
      );
    if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 });
    return NextResponse.json({ pending: true, email: cleanEmail }, { status: 201 });
  }

  const existing = await assertMember(supabase, params.id, profile.id);
  if (existing) return NextResponse.json({ error: "Already a member" }, { status: 409 });

  const { error } = await supabase
    .from("team_members")
    .insert({ team_id: params.id, user_id: profile.id, role });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ pending: false, email: cleanEmail, role }, { status: 201 });
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const membership = await assertMember(supabase, params.id, user.id);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await request.json()) as { user_id?: string; email?: string };

  if (body.email && !body.user_id) {
    await supabase.from("team_invites").delete().eq("team_id", params.id).eq("email", body.email.trim().toLowerCase());
    return new NextResponse(null, { status: 204 });
  }

  if (!body.user_id) return NextResponse.json({ error: "user_id or email required" }, { status: 400 });

  const target = await assertMember(supabase, params.id, body.user_id);
  if (!target) return NextResponse.json({ error: "Not a member" }, { status: 404 });
  if (target.role === "admin" && body.user_id !== user.id) {
    // Non-self admin removal: allowed if requester is also admin
    if (membership.role !== "admin") return NextResponse.json({ error: "Only admins can remove admins" }, { status: 403 });
  }

  const { error } = await supabase
    .from("team_members")
    .delete()
    .eq("team_id", params.id)
    .eq("user_id", body.user_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
