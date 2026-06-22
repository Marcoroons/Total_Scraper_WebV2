import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type SB = Awaited<ReturnType<typeof createClient>>;

/**
 * Verify the caller is a member of the project (flat access — any member may
 * view & manage). Returns the caller's membership row, or null if not a member.
 */
async function getCallerMembership(supabase: SB, projectId: string, userId: string) {
  const { data } = await supabase
    .from("project_members")
    .select("user_id, role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  return data;
}

// ── GET — list members of a project ─────────────────────────────────────────
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const membership = await getCallerMembership(supabase, params.id, user.id);
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: members, error } = await supabase
    .from("project_members")
    .select("user_id, role, created_at")
    .eq("project_id", params.id)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (members ?? []).map((m) => m.user_id);
  const emailById = new Map<string, string>();
  if (ids.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email")
      .in("id", ids);
    for (const p of profiles ?? []) emailById.set(p.id, p.email);
  }

  const enriched = (members ?? []).map((m) => ({
    user_id:    m.user_id,
    email:      emailById.get(m.user_id) ?? "(unknown)",
    role:       m.role,
    created_at: m.created_at,
  }));

  // Pending invites (emails that don't have an account / haven't claimed yet).
  // Best-effort: if the project_invites table isn't migrated, treat as none.
  const { data: pending } = await supabase
    .from("project_invites")
    .select("email, created_at")
    .eq("project_id", params.id)
    .order("created_at", { ascending: true });

  return NextResponse.json({
    members: enriched,
    pending: pending ?? [],
    current_user_id: user.id,
  });
}

// ── POST — invite a user to the project by email ────────────────────────────
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const membership = await getCallerMembership(supabase, params.id, user.id);
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { email } = (await request.json()) as { email?: string };
  const cleanEmail = email?.trim().toLowerCase();
  if (!cleanEmail) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  // Look up the invitee by email via the profiles mirror table.
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email")
    .eq("email", cleanEmail)
    .maybeSingle();

  if (!profile) {
    // No account yet → store a pending invite. It auto-converts to a
    // project_members row the first time that email loads their projects
    // after signing up (see claiming logic in GET /api/projects).
    const { error: invErr } = await supabase
      .from("project_invites")
      .upsert(
        { project_id: params.id, email: cleanEmail, invited_by: user.id },
        { onConflict: "project_id,email", ignoreDuplicates: true }
      );
    if (invErr) {
      return NextResponse.json({ error: invErr.message }, { status: 500 });
    }
    return NextResponse.json(
      { pending: true, email: cleanEmail },
      { status: 201 }
    );
  }

  // Already a member?
  const existing = await getCallerMembership(supabase, params.id, profile.id);
  if (existing) {
    return NextResponse.json(
      { error: "That user is already a member of this project." },
      { status: 409 }
    );
  }

  const { data: inserted, error } = await supabase
    .from("project_members")
    .insert({ project_id: params.id, user_id: profile.id, role: "member" })
    .select("user_id, role, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(
    {
      user_id:    inserted.user_id,
      email:      profile.email,
      role:       inserted.role,
      created_at: inserted.created_at,
    },
    { status: 201 }
  );
}

// ── DELETE — remove a member from the project ───────────────────────────────
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const membership = await getCallerMembership(supabase, params.id, user.id);
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as { user_id?: string; email?: string };

  // Cancel a pending invite (no account yet) by email.
  if (body.email && !body.user_id) {
    const { error: cancelErr } = await supabase
      .from("project_invites")
      .delete()
      .eq("project_id", params.id)
      .eq("email", body.email.trim().toLowerCase());
    if (cancelErr) return NextResponse.json({ error: cancelErr.message }, { status: 500 });
    return new NextResponse(null, { status: 204 });
  }

  const targetId = body.user_id;
  if (!targetId) {
    return NextResponse.json({ error: "user_id or email is required" }, { status: 400 });
  }

  // Look up the target's membership so we can guard the owner.
  const target = await getCallerMembership(supabase, params.id, targetId);
  if (!target) {
    return NextResponse.json({ error: "That user is not a member of this project." }, { status: 404 });
  }
  if (target.role === "owner") {
    return NextResponse.json(
      { error: "The project owner can't be removed." },
      { status: 403 }
    );
  }

  const { error } = await supabase
    .from("project_members")
    .delete()
    .eq("project_id", params.id)
    .eq("user_id", targetId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
