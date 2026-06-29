import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Delete ecom_listings rows for the active project.
// Optional ?job_id=<uuid> to scope the delete to a single scrape job.
// Used to wipe contaminated listings from pre-validation scrapes — the user
// re-runs with the current product-based config to repopulate.
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const project_id = searchParams.get("project_id");
  const job_id     = searchParams.get("job_id");
  if (!project_id) {
    return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  }

  // Ownership check — the user must own or be a member of this project.
  const { data: project } = await supabase
    .from("projects")
    .select("user_id, team_id")
    .eq("project_id", project_id)
    .single();
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  let allowed = project.user_id === user.id;
  if (!allowed && project.team_id) {
    const { data: member } = await supabase
      .from("team_members")
      .select("user_id")
      .eq("team_id", project.team_id)
      .eq("user_id", user.id)
      .single();
    if (member) allowed = true;
  }
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let q = supabase
    .from("ecom_listings")
    .delete({ count: "exact" })
    .eq("project_id", project_id);
  if (job_id) q = q.eq("job_id", job_id);
  const { error, count } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ deleted: count ?? 0 });
}
