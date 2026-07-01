import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient, SupabaseClient } from "@supabase/supabase-js";

// Railway cold-starts can take 20–30 s — allow up to 60 s on the POST path.
export const maxDuration = 60;

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

// ── GET — list saved reports for a project ─────────────────────────────────
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectId = request.nextUrl.searchParams.get("project_id");
  if (!projectId) return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  if (!(await verifyProjectAccess(supabase, projectId, user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("generated_reports")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// ── POST — generate the xlsx via the export-service, upload to Storage,
//           insert a row in generated_reports, return it.
//           Body shape mirrors /api/export (endpoint + payload) plus an
//           optional `display_filename` for the saved report's label.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Storage not configured — set SUPABASE_SERVICE_ROLE_KEY in Vercel environment variables." },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => null) as {
    endpoint?: string;
    project_id?: string;
    display_filename?: string;
    job_ids?: string[];
    job_types?: string[];
    platforms?: string[];
    [k: string]: unknown;
  } | null;

  if (!body?.endpoint) return NextResponse.json({ error: "endpoint is required" }, { status: 400 });
  if (!body.project_id) return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  if (!(await verifyProjectAccess(supabase, body.project_id, user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const exportUrl = process.env.EXPORT_SERVICE_URL;
  if (!exportUrl) {
    return NextResponse.json({ error: "Export service not configured — set EXPORT_SERVICE_URL." }, { status: 503 });
  }

  // ── 1. Call the export-service to generate the xlsx ──
  const { endpoint, display_filename, job_ids, job_types, platforms, ...payload } = body;
  const targetUrl = `${exportUrl.replace(/\/$/, "")}/${endpoint}`;
  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(55_000),
    });
  } catch (fetchErr) {
    const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
    return NextResponse.json({ error: `Export service unreachable: ${msg}` }, { status: 502 });
  }
  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => "");
    let detail = `Export service error (HTTP ${upstream.status})`;
    try {
      const parsed = JSON.parse(errText) as { detail?: string };
      if (typeof parsed.detail === "string") detail = parsed.detail;
    } catch {
      if (errText) detail = errText.slice(0, 300);
    }
    return NextResponse.json({ error: detail.slice(0, 300) }, { status: upstream.status });
  }
  const buffer = new Uint8Array(await upstream.arrayBuffer());

  // ── 2. Upload to Supabase Storage ──
  // Path shape: {project_id}/{uuid}.xlsx — keeps files project-scoped so a
  // future move to storage RLS is trivial.
  const reportId = crypto.randomUUID();
  const storagePath = `${body.project_id}/${reportId}.xlsx`;
  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, buffer, {
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: false,
    });
  if (uploadError) {
    // The most common cause of this failing is the bucket not existing yet —
    // give the user an actionable message rather than a generic 500.
    const msg = uploadError.message.toLowerCase();
    const hint = msg.includes("not found") || msg.includes("bucket")
      ? " — the `generated-reports` bucket doesn't exist. Create it in Supabase Storage (private) before saving reports."
      : "";
    return NextResponse.json({ error: `Storage upload failed: ${uploadError.message}${hint}` }, { status: 500 });
  }

  // ── 3. Insert the metadata row ──
  const filename = (display_filename?.trim() || `report-${Date.now()}`)
    .replace(/[/\\?%*:|"<>]/g, "").replace(/\.xlsx$/i, "").slice(0, 120) + ".xlsx";
  const row = {
    id: reportId,
    project_id: body.project_id,
    created_by: user.id,
    filename,
    storage_path: storagePath,
    job_ids: job_ids ?? [],
    job_types: job_types ?? [],
    platforms: platforms ?? [],
    file_size_bytes: buffer.length,
  };
  const { data: inserted, error: insertError } = await supabase
    .from("generated_reports")
    .insert(row)
    .select()
    .single();
  if (insertError) {
    // Roll back the upload so we don't leak orphan files.
    await admin.storage.from(BUCKET).remove([storagePath]).catch(() => {});
    return NextResponse.json({ error: `DB insert failed: ${insertError.message}` }, { status: 500 });
  }

  return NextResponse.json(inserted, { status: 201 });
}
