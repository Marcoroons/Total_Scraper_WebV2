import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

/** A value is "real" if it's set and isn't one of the repo placeholder strings. */
function isConfigured(v: string | undefined): v is string {
  return !!v && v.trim().length > 0 && !v.trim().toLowerCase().startsWith("your-");
}

export async function POST(request: NextRequest) {
  // Top-level guard: this route must ALWAYS return JSON, never an HTML 500,
  // otherwise the client's res.json() throws and surfaces "Network error".
  try {
    const url     = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!isConfigured(url) || !isConfigured(anonKey)) {
      return NextResponse.json(
        { error: "Server is not configured: Supabase credentials are missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY." },
        { status: 500 }
      );
    }

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const { email, password, confirmPassword, inviteCode } = body as {
      email?: string;
      password?: string;
      confirmPassword?: string;
      inviteCode?: string;
    };

    if (!email?.trim() || !password) {
      return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters." }, { status: 400 });
    }
    // Defense in depth — the UI also checks this, but never trust the client.
    if (confirmPassword !== undefined && password !== confirmPassword) {
      return NextResponse.json({ error: "Passwords do not match." }, { status: 400 });
    }

    // Invite code — only enforced when the env var is actually configured.
    const expected = process.env.INVITE_CODE;
    if (isConfigured(expected) && inviteCode?.trim() !== expected.trim()) {
      return NextResponse.json({ error: "Incorrect invite code." }, { status: 403 });
    }

    const cleanEmail = email.trim().toLowerCase();

    // ── Fast path: service-role admin client (instant, no confirmation email) ──
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (isConfigured(serviceKey)) {
      const admin = createAdminClient(url, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      // Defensive duplicate check via the profiles mirror (best-effort) so we
      // reject a repeat email cleanly before even calling createUser. createUser
      // itself also enforces uniqueness as the authoritative backstop below.
      try {
        const { data: dupe } = await admin
          .from("profiles").select("id").eq("email", cleanEmail).maybeSingle();
        if (dupe) {
          return NextResponse.json(
            { error: "An account with this email already exists. Try signing in instead." },
            { status: 409 }
          );
        }
      } catch { /* profiles table may not exist yet — rely on createUser below */ }

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: cleanEmail,
        password,
        email_confirm: true,
      });

      if (createErr) {
        const msg = (createErr.message ?? "").toLowerCase();
        if (msg.includes("already") || msg.includes("exists") || msg.includes("registered")) {
          return NextResponse.json(
            { error: "An account with this email already exists. Try signing in instead." },
            { status: 409 }
          );
        }
        return NextResponse.json({ error: createErr.message || "Failed to create account." }, { status: 400 });
      }

      // Best-effort profile row so the onboarding flag exists from the start.
      if (created.user) {
        await admin
          .from("profiles")
          .upsert(
            { id: created.user.id, email: cleanEmail, has_completed_tour: false },
            { onConflict: "id", ignoreDuplicates: true }
          )
          .then(undefined, () => { /* table may not be migrated yet — ignore */ });
      }

      // Sign in immediately so the browser receives a session cookie.
      const supabase = await createServerClient();
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });
      if (signInErr) {
        return NextResponse.json({ requiresConfirmation: false, signInFailed: true });
      }
      return NextResponse.json({ requiresConfirmation: false });
    }

    // ── Fallback: standard signUp (sends a confirmation email) ──
    const supabase = await createServerClient();
    const { data, error } = await supabase.auth.signUp({ email: cleanEmail, password });

    if (error) {
      const msg = (error.message ?? "").toLowerCase();
      if (msg.includes("already") || msg.includes("exists") || msg.includes("registered")) {
        return NextResponse.json(
          { error: "An account with this email already exists. Try signing in instead." },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ requiresConfirmation: !data.session });
  } catch (err) {
    console.error("[/api/auth/signup] unexpected error:", err);
    return NextResponse.json(
      { error: "Unexpected server error during signup. Please try again." },
      { status: 500 }
    );
  }
}
