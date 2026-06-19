import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  // Auth guard — only signed-in users can trigger exports
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const exportUrl = process.env.EXPORT_SERVICE_URL;
  if (!exportUrl) {
    return NextResponse.json(
      { error: "Export service not configured (EXPORT_SERVICE_URL missing)." },
      { status: 503 }
    );
  }

  const body = await request.json();
  const { endpoint, ...payload } = body as { endpoint: string; [k: string]: unknown };

  if (!endpoint) {
    return NextResponse.json({ error: "endpoint is required" }, { status: 400 });
  }

  const upstream = await fetch(`${exportUrl.replace(/\/$/, "")}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!upstream.ok) {
    const err = await upstream.json().catch(() => ({ detail: "Export failed" }));
    return NextResponse.json(
      { error: (err as { detail?: string }).detail ?? "Export failed" },
      { status: upstream.status }
    );
  }

  const buffer = await upstream.arrayBuffer();
  const disposition =
    upstream.headers.get("Content-Disposition") ?? 'attachment; filename="export.xlsx"';

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": disposition,
    },
  });
}
