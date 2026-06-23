import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

function isConfigured(v: string | undefined): v is string {
  return !!v && v.trim().length > 0 && !v.trim().toLowerCase().startsWith("your-");
}

export async function POST() {
  try {
    const supabase = await createServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url        = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!isConfigured(url) || !isConfigured(serviceKey)) {
      return NextResponse.json(
        { error: "Account deletion isn't configured on the server (missing SUPABASE_SERVICE_ROLE_KEY)." },
        { status: 503 }
      );
    }

    const admin = createAdminClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Best-effort cleanup of the user's membership + profile rows so we don't
    // leave dangling references. Owned projects/teams are intentionally NOT mass
    // -deleted here (teammates may rely on them) — if a FK blocks the auth delete
    // we surface that clearly below.
    await admin.from("project_members").delete().eq("user_id", user.id).then(undefined, () => {});
    await admin.from("team_members").delete().eq("user_id", user.id).then(undefined, () => {});
    await admin.from("profiles").delete().eq("id", user.id).then(undefined, () => {});

    const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
    if (delErr) {
      console.error("[/api/auth/delete-account] deleteUser failed:", delErr.message);
      return NextResponse.json(
        { error: `Could not delete account: ${delErr.message}. You may still own projects/teams — remove or transfer them first.` },
        { status: 409 }
      );
    }

    // Clear this browser's session cookies.
    await supabase.auth.signOut().catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[/api/auth/delete-account] unexpected error:", err);
    return NextResponse.json({ error: "Unexpected error deleting account." }, { status: 500 });
  }
}
