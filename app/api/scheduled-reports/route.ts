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

/** Compute the first run time from a frequency (UTC). "once" => ~1 min from now. */
function nextRun(frequency: string): string {
  const d = new Date();
  switch (frequency) {
    case "daily":   d.setDate(d.getDate() + 1); break;
    case "weekly":  d.setDate(d.getDate() + 7); break;
    case "monthly": d.setMonth(d.getMonth() + 1); break;
    default:        d.setMinutes(d.getMinutes() + 1); break; // once
  }
  return d.toISOString();
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
    metrics?: string[];
    date_from?: string | null;
    date_to?: string | null;
    frequency?: string;
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

  const { data, error } = await supabase
    .from("scheduled_reports")
    .insert({
      project_id:      body.project_id,
      created_by:      user.id,
      recipient_email: email,
      job_types:       body.job_types ?? [],
      metrics:         body.metrics ?? [],
      date_from:       body.date_from ?? null,
      date_to:         body.date_to ?? null,
      frequency,
      rescrape:        !!body.rescrape,
      active:          true,
      next_run_at:     nextRun(frequency),
    })
    .select()
    .single();

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
