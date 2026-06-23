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

    const uid = user.id;
    // Swallow individual cleanup errors so one missing table doesn't abort the
    // whole deletion (best-effort).
    const safe = (q: PromiseLike<unknown>) => Promise.resolve(q).then(() => {}, () => {});

    // 1. The user's OWNED, non-team projects.
    const { data: owned } = await admin
      .from("projects").select("project_id").eq("user_id", uid).is("team_id", null);
    const ownedIds = (owned ?? []).map((p: { project_id: string }) => p.project_id);

    // 2. Keep only the ones NOT shared with anyone else — those are truly personal
    //    and safe to wipe. Projects shared via project_members stay for the others.
    const personalOnly: string[] = [];
    for (const pid of ownedIds) {
      const { data: members } = await admin
        .from("project_members").select("user_id").eq("project_id", pid);
      const others = (members ?? []).filter((m: { user_id: string }) => m.user_id !== uid);
      if (others.length === 0) personalOnly.push(pid);
    }

    // 3. Wipe personal-only projects + their scraped-job records, schedules, config.
    //    (The global ig_/tiktok_ data tables are keyed by username/url and shared
    //     across projects, so they can't be attributed to one user and are left.)
    if (personalOnly.length > 0) {
      await safe(admin.from("scrape_jobs").delete().in("project_id", personalOnly));
      await safe(admin.from("scheduled_reports").delete().in("project_id", personalOnly));
      await safe(admin.from("nlp_configs").delete().in("project_id", personalOnly));
      await safe(admin.from("project_members").delete().in("project_id", personalOnly));
      await safe(admin.from("projects").delete().in("project_id", personalOnly));
    }

    // 4. Remove the user from everything shared so it remains intact for others.
    await safe(admin.from("project_members").delete().eq("user_id", uid));
    await safe(admin.from("team_members").delete().eq("user_id", uid));
    await safe(admin.from("scheduled_reports").delete().eq("created_by", uid));

    // 5. Profile mirror row, then the auth user itself.
    await safe(admin.from("profiles").delete().eq("id", uid));

    const { error: delErr } = await admin.auth.admin.deleteUser(uid);
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
