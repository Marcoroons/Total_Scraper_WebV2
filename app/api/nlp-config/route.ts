import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const project_id = searchParams.get("project_id");
  if (!project_id) return NextResponse.json({ error: "project_id required" }, { status: 400 });

  const { data, error } = await supabase
    .from("nlp_configs")
    .select("*")
    .eq("project_id", project_id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ config: data ?? null });
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { project_id, ...fields } = body as { project_id: string; [k: string]: unknown };
  if (!project_id) return NextResponse.json({ error: "project_id required" }, { status: 400 });

  // Upsert — create row if it doesn't exist yet
  const { data: existing } = await supabase
    .from("nlp_configs")
    .select("project_id")
    .eq("project_id", project_id)
    .maybeSingle();

  let error;
  if (!existing) {
    ({ error } = await supabase.from("nlp_configs").insert({ project_id, ...fields }));
  } else {
    ({ error } = await supabase.from("nlp_configs").update(fields).eq("project_id", project_id));
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
