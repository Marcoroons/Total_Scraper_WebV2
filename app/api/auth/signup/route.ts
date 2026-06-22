import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { email, password, inviteCode } = body as {
    email?: string;
    password?: string;
    inviteCode?: string;
  };

  if (!email?.trim() || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  // Invite code — only enforced when the env var is actually configured.
  // If INVITE_CODE is not set we treat signup as open (dev / first-run).
  const expected = process.env.INVITE_CODE?.trim();
  if (expected && inviteCode?.trim() !== expected) {
    return NextResponse.json({ error: "Incorrect invite code." }, { status: 403 });
  }

  const cleanEmail = email.trim().toLowerCase();

  // ── Fast path: admin client with service-role key (no email confirmation) ──
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (serviceKey) {
    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceKey,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: cleanEmail,
      password,
      email_confirm: true, // skip confirmation email entirely
    });

    if (createErr) {
      // Surface a friendlier duplicate-account message
      const msg = createErr.message ?? "";
      if (msg.toLowerCase().includes("already") || msg.toLowerCase().includes("exists")) {
        return NextResponse.json(
          { error: "An account with this email already exists. Try signing in instead." },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: msg || "Failed to create account." }, { status: 400 });
    }

    // Ensure the profiles row exists (trigger may not be configured yet)
    if (created.user) {
      await admin.from("profiles").upsert(
        { id: created.user.id, email: cleanEmail, has_completed_tour: false },
        { onConflict: "id", ignoreDuplicates: true }
      );
    }

    // Sign the user in immediately so the client gets a session
    const supabase = await createServerClient();
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });
    if (signInErr) {
      // User was created but sign-in failed — ask them to sign in manually
      return NextResponse.json({ requiresConfirmation: false, signInFailed: true });
    }

    return NextResponse.json({ requiresConfirmation: false });
  }

  // ── Fallback: standard signUp (requires email confirmation) ──
  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: cleanEmail,
    password,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/auth/callback`,
    },
  });

  if (error) {
    const msg = error.message ?? "";
    if (msg.toLowerCase().includes("already") || msg.toLowerCase().includes("exists")) {
      return NextResponse.json(
        { error: "An account with this email already exists. Try signing in instead." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  return NextResponse.json({ requiresConfirmation: !data.session });
}
