import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

const FREQUENCIES = ["once", "daily", "weekly", "monthly"];

/**
 * First run as a UTC ISO string, anchored to `sendTime` (HH:MM) in Indochina
 * Time (UTC+7). Picks the next occurrence of that wall-clock time, then steps the
 * cadence. ("once" fires at the next occurrence of the chosen time.)
 */
function nextRunICT(frequency: string, sendTime: string): string {
  const [hRaw, mRaw] = (sendTime || "09:00").split(":").map((x) => parseInt(x, 10));
  const h = Number.isFinite(hRaw) ? hRaw : 9;
  const m = Number.isFinite(mRaw) ? mRaw : 0;
  const now = new Date();
  // ICT wall-clock expressed via a Date's UTC fields (now shifted +7h).
  const nowICT = new Date(now.getTime() + 7 * 3600 * 1000);
  const target = new Date(Date.UTC(nowICT.getUTCFullYear(), nowICT.getUTCMonth(), nowICT.getUTCDate(), h, m, 0, 0));
  if (target.getTime() <= nowICT.getTime()) {
    if (frequency === "weekly")       target.setUTCDate(target.getUTCDate() + 7);
    else if (frequency === "monthly") target.setUTCMonth(target.getUTCMonth() + 1);
    else                              target.setUTCDate(target.getUTCDate() + 1); // once / daily
  }
  // target's UTC fields hold the ICT wall-clock → real UTC instant is target − 7h.
  return new Date(target.getTime() - 7 * 3600 * 1000).toISOString();
}

// ── GET — list schedules for a project ──────────────────────────────────────
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
    .from("scheduled_reports")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// ── POST — create a schedule ────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    project_id?: string;
    recipient_email?: string;
    job_types?: string[];
    job_ids?: string[];    // NEW: concrete jobs from the current selection —
                           // schedule sends exactly these, no more filter-drift.
    metrics?: string[];
    date_from?: string | null;
    date_to?: string | null;
    frequency?: string;
    send_time?: string;
    rescrape?: boolean;
  } | null;

  if (!body?.project_id) return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  if (!(await verifyProjectAccess(supabase, body.project_id, user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const email = body.recipient_email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "A valid recipient email is required." }, { status: 400 });
  }

  const frequency = FREQUENCIES.includes(body.frequency ?? "") ? body.frequency! : "once";
  const sendTime  = /^\d{1,2}:\d{2}$/.test(body.send_time ?? "") ? body.send_time! : "09:00";

  const row = {
    project_id:      body.project_id,
    created_by:      user.id,
    recipient_email: email,
    job_types:       body.job_types ?? [],
    job_ids:         body.job_ids ?? [],
    metrics:         body.metrics ?? [],
    date_from:       body.date_from ?? null,
    date_to:         body.date_to ?? null,
    frequency,
    rescrape:        !!body.rescrape,
    active:          true,
    send_time:       sendTime,
    next_run_at:     nextRunICT(frequency, sendTime),
  };

  let { data, error } = await supabase.from("scheduled_reports").insert(row).select().single();
  // Column-safe: retry without any newly-added columns if the migration
  // hasn't run yet. Order matters — job_ids is the newest, drop it first.
  if (error && /job_ids/i.test(error.message)) {
    const { job_ids: _ji, ...rest } = row;
    ({ data, error } = await supabase.from("scheduled_reports").insert(rest).select().single());
  }
  if (error && /send_time/i.test(error.message)) {
    const { send_time: _st, job_ids: _ji, ...rest } = row;
    ({ data, error } = await supabase.from("scheduled_reports").insert(rest).select().single());
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

// ── DELETE — cancel a schedule ──────────────────────────────────────────────
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  // RLS + created_by guard: only the creator (or project member via RLS) can delete.
  const { error } = await supabase.from("scheduled_reports").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
