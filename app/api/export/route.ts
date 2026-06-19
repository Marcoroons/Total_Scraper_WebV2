import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Railway cold-starts can take 20-30 s — allow up to 60 s on this function
export const maxDuration = 60;

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
      { error: "Export service not configured — set EXPORT_SERVICE_URL in Vercel environment variables." },
      { status: 503 }
    );
  }

  const body = await request.json();
  const { endpoint, ...payload } = body as { endpoint: string; [k: string]: unknown };

  if (!endpoint) {
    return NextResponse.json({ error: "endpoint is required" }, { status: 400 });
  }

  const targetUrl = `${exportUrl.replace(/\/$/, "")}/${endpoint}`;

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      signal: AbortSignal.timeout(55_000), // 55 s — just under our 60 s maxDuration
    });
  } catch (fetchErr) {
    const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
    const isTimeout = msg.toLowerCase().includes("timeout") || msg.toLowerCase().includes("abort");
    console.error("[/api/export] fetch to export service failed:", msg);
    return NextResponse.json(
      {
        error: isTimeout
          ? "Export service timed out (Railway may be cold-starting — wait 30 s and retry)."
          : `Could not reach export service at ${exportUrl}: ${msg}`,
      },
      { status: 502 }
    );
  }

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => "");
    let detail = `Export service error (HTTP ${upstream.status})`;
    try {
      const parsed = JSON.parse(errText) as { detail?: string | unknown[] };
      if (typeof parsed.detail === "string") detail = parsed.detail;
      else if (Array.isArray(parsed.detail)) detail = JSON.stringify(parsed.detail);
    } catch {
      if (errText) detail = errText.slice(0, 300);
    }
    console.error("[/api/export] upstream error", upstream.status, detail.slice(0, 300));
    return NextResponse.json({ error: detail.slice(0, 300) }, { status: upstream.status });
  }

  // Guard: reject anything that isn't xlsx so we never forward garbage bytes to the browser
  const upstreamCT = upstream.headers.get("Content-Type") ?? "";
  if (!upstreamCT.includes("spreadsheetml") && !upstreamCT.includes("octet-stream")) {
    const bodyText = await upstream.text().catch(() => "(unreadable)");
    console.error("[/api/export] non-xlsx from export service:", upstreamCT, bodyText.slice(0, 400));
    return NextResponse.json(
      {
        error: `Export service returned unexpected content-type: ${upstreamCT}. Check that EXPORT_SERVICE_URL points to the Railway service (not its dashboard).`,
      },
      { status: 502 }
    );
  }

  const buffer = await upstream.arrayBuffer();
  const disposition =
    upstream.headers.get("Content-Disposition") ?? 'attachment; filename="export.xlsx"';

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": disposition,
    },
  });
}
