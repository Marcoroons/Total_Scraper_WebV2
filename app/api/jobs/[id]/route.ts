import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const VALID_STATUSES = ["PENDING", "AUTO_PROCESSING", "COMPLETED", "FAILED"] as const;
type Status = (typeof VALID_STATUSES)[number];

async function getJobWithAccess(
  supabase: Awaited<ReturnType<typeof createClient>>,
  jobId: string,
  userId: string
) {
  const { data: job } = await supabase
    .from("scrape_jobs")
    .select("job_id, status, project_id")
    .eq("job_id", jobId)
    .single();

  if (!job) return { job: null, allowed: false };

  const { data: project } = await supabase
    .from("projects")
    .select("user_id, team_id")
    .eq("project_id", job.project_id)
    .single();

  if (!project) return { job, allowed: false };

  let allowed = project.user_id === userId;
  if (!allowed && project.team_id) {
    const { data: member } = await supabase
      .from("team_members")
      .select("user_id")
      .eq("team_id", project.team_id)
      .eq("user_id", userId)
      .single();
    allowed = !!member;
  }

  return { job, allowed };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { job, allowed } = await getJobWithAccess(supabase, params.id, user.id);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const update: Record<string, unknown> = {};

  if (body.status !== undefined) {
    if (!(VALID_STATUSES as readonly string[]).includes(body.status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` },
        { status: 400 }
      );
    }
    const newStatus = body.status as Status;
    const currentStatus = job.status as Status;

    if (newStatus === "PENDING" && currentStatus !== "FAILED") {
      return NextResponse.json(
        { error: "Only FAILED jobs can be retried (reset to PENDING)" },
        { status: 400 }
      );
    }
    if (newStatus === "FAILED" && currentStatus !== "PENDING") {
      return NextResponse.json(
        { error: "Only PENDING jobs can be cancelled" },
        { status: 400 }
      );
    }
    update.status = newStatus;
  }

  if ("error_message" in body) {
    update.error_message = body.error_message ?? null;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("scrape_jobs")
    .update(update)
    .eq("job_id", params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { job, allowed } = await getJobWithAccess(supabase, params.id, user.id);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { error } = await supabase
    .from("scrape_jobs")
    .delete()
    .eq("job_id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}