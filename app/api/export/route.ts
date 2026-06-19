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
    const errText = await upstream.text().catch(() => "Export failed");
    let detail = "Export failed";
    try { detail = (JSON.parse(errText) as { detail?: string }).detail ?? errText; } catch { detail = errText; }
    console.error("[/api/export] upstream error", upstream.status, detail.slice(0, 300));
    return NextResponse.json({ error: detail.slice(0, 300) }, { status: upstream.status });
  }

  // Guard: reject anything that isn't xlsx so we never send HTML/JSON to the browser as a file
  const upstreamCT = upstream.headers.get("Content-Type") ?? "";
  if (!upstreamCT.includes("spreadsheetml") && !upstreamCT.includes("octet-stream")) {
    const body = await upstream.text().catch(() => "(unreadable)");
    console.error("[/api/export] non-xlsx response from export service:", upstreamCT, body.slice(0, 400));
    return NextResponse.json(
      { error: `Export service returned unexpected content-type: ${upstreamCT}. Is EXPORT_SERVICE_URL correct and the service deployed?` },
      { status: 502 }
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
