import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient, SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "generated-reports";

type SB = Awaited<ReturnType<typeof createClient>>;

async function verifyProjectAccess(supabase: SB, projectId: string, userId: string): Promise<boolean> {
  const { data: project } = await supabase
    .from("projects")
    .select("user_id, team_id")
    .eq("project_id", projectId)
    .single();
  if (!project) return false;
  if (project.user_id === userId) return true;
  if (project.team_id) {
    const { data: member } = await supabase
      .from("team_members").select("user_id")
      .eq("team_id", project.team_id).eq("user_id", userId).single();
    if (member) return true;
  }
  const { data: pm } = await supabase
    .from("project_members").select("user_id")
    .eq("project_id", projectId).eq("user_id", userId).maybeSingle();
  return !!pm;
}

function getAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// Fetch the report row + verify the caller can access its project. Returns
// [row, errorResponse] — errorResponse is null on success.
async function fetchAndAuthorise(supabase: SB, userId: string, id: string) {
  const { data: report, error } = await supabase
    .from("generated_reports")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !report) {
    return [null, NextResponse.json({ error: "Report not found." }, { status: 404 })] as const;
  }
  if (!(await verifyProjectAccess(supabase, report.project_id, userId))) {
    return [null, NextResponse.json({ error: "Forbidden" }, { status: 403 })] as const;
  }
  return [report, null] as const;
}

// ── GET — return a short-lived signed URL for the client to download ──────
// The bucket is private; we sign for 5 minutes so the URL can't be shared
// long-term. The client fetches it directly from Supabase Storage — no bytes
// pass through Vercel, so this stays fast on large workbooks.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [report, err] = await fetchAndAuthorise(supabase, user.id, id);
  if (err) return err;

  const admin = getAdmin();
  if (!admin) return NextResponse.json({ error: "Storage not configured." }, { status: 503 });

  const { data: signed, error: signError } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(report.storage_path, 300);
  if (signError || !signed?.signedUrl) {
    return NextResponse.json({ error: `Signed URL failed: ${signError?.message ?? "unknown"}` }, { status: 500 });
  }
  return NextResponse.json({ url: signed.signedUrl, filename: report.filename });
}

// ── DELETE — remove the file from Storage and the row from the DB ─────────
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [report, err] = await fetchAndAuthorise(supabase, user.id, id);
  if (err) return err;

  const admin = getAdmin();
  if (admin) {
    // Best-effort file delete; if the file was already purged by the
    // worker's sweep, we still want to remove the row.
    await admin.storage.from(BUCKET).remove([report.storage_path]).catch(() => {});
  }
  const { error: deleteError } = await supabase.from("generated_reports").delete().eq("id", id);
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });

  return new NextResponse(null, { status: 204 });
}

// ── POST — "Email now" — dispatch this saved report to a recipient via the
//           existing scheduled_reports queue. We insert a one-shot schedule
//           with `next_run_at` in the past + `generated_report_id` set;
//           the worker's 3s poll picks it up and downloads-and-emails the
//           saved file without regenerating anything.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [report, err] = await fetchAndAuthorise(supabase, user.id, id);
  if (err) return err;

  const body = await request.json().catch(() => ({} as { recipient_email?: string }));
  const email = (body.recipient_email ?? "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "A valid recipient email is required." }, { status: 400 });
  }

  const row = {
    project_id:          report.project_id,
    created_by:          user.id,
    recipient_email:     email,
    generated_report_id: report.id,
    job_ids:             report.job_ids ?? [],
    job_types:           report.job_types ?? [],
    metrics:             [],
    frequency:           "once",
    active:              true,
    // Fire on the next worker poll (loop is ~3 s). We set slightly in the
    // past to guarantee `lte(next_run_at, now)` matches immediately.
    next_run_at:         new Date(Date.now() - 5_000).toISOString(),
    send_time:           "09:00",  // ignored for `once`, but stored for consistency
  };

  let { error: insertError } = await supabase.from("scheduled_reports").insert(row);
  // Column-safe if either send_time or generated_report_id hasn't been migrated.
  if (insertError && /generated_report_id/i.test(insertError.message)) {
    const { generated_report_id: _gr, ...rest } = row;
    ({ error: insertError } = await supabase.from("scheduled_reports").insert(rest));
  }
  if (insertError && /send_time/i.test(insertError.message)) {
    const { send_time: _st, generated_report_id: _gr, ...rest } = row;
    ({ error: insertError } = await supabase.from("scheduled_reports").insert(rest));
  }
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  return NextResponse.json({ ok: true, message: `Email queued to ${email} — fires within seconds.` }, { status: 201 });
}
