"use client";

import { memo } from "react";
import { FileSpreadsheet } from "lucide-react";
import type { ExportLayout, SheetKey } from "@/lib/exportConfig";

// ─────────────────────────────────────────────────────────────────────────────
// LAYOUT PREVIEW
// Pure-client renderer: shows what the profile-audit workbook WILL look like
// for the current ExportLayout / metric selections, using mock numbers. No
// data fetch, no network, no server load — reflects toggles in real time.
//
// The mock data is intentionally generic (no real handles, no real metrics);
// it's there so the user can see the column lineup, sheet order, and toggle
// effects, NOT to imply what their actual export would contain.
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  layout: ExportLayout;
  rawMetrics: string[];     // ["Likes", "Comments", "Shares"] subset
  calcMetrics: string[];    // ["Engagement Rate", "VTR", "CPV ($)", …]
  sortBy: string;
  inclTop5: boolean;
  inclBot5: boolean;
}

// Mock KOLs — three fake creators with believable-but-clearly-fake numbers.
const MOCK_KOLS = [
  { username: "creator_alpha",   videos: 12, images: 3, vlist: [890_000, 145_000, 67_000] },
  { username: "creator_bravo",   videos: 8,  images: 1, vlist: [230_000, 67_000,  45_000] },
  { username: "creator_charlie", videos: 15, images: 0, vlist: [110_000, 32_000,  18_000] },
];

const MOCK_VIDEOS = [
  { kol: "creator_alpha",   type: "Video", views: 890_000, plays: 920_000, likes: 45_000, comments: 1_200, shares: 380, date: "2025-12-15", url: "https://example.com/v/aa1" },
  { kol: "creator_alpha",   type: "Video", views: 145_000, plays: 152_000, likes: 8_200,  comments: 340,   shares: 92,  date: "2025-11-28", url: "https://example.com/v/aa2" },
  { kol: "creator_bravo",   type: "Short", views: 230_000, plays: 230_000, likes: 12_000, comments: 580,   shares: 145, date: "2025-12-08", url: "https://example.com/s/bb1" },
  { kol: "creator_charlie", type: "Video", views: 110_000, plays: 118_000, likes: 4_500,  comments: 220,   shares: 78,  date: "2025-12-12", url: "https://example.com/v/cc1" },
];

const fmtInt = (n: number) => n.toLocaleString("en-US");
const fmtPct = (n: number) => `${n.toFixed(2)}%`;

const NAVY  = "#1B3A6B";
const HEAD_BG = NAVY;

const thCls = "px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-white whitespace-nowrap border-r last:border-r-0";
const thStyle: React.CSSProperties = { background: HEAD_BG, borderRightColor: "rgba(255,255,255,0.12)" };
const tdCls = "px-2 py-1 text-[11px] text-foreground whitespace-nowrap border-r last:border-r-0 border-b";
const tdStyle: React.CSSProperties = { borderColor: "rgba(255,255,255,0.06)" };

function MockBadge() {
  return (
    <span
      className="px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider rounded"
      style={{ background: "rgba(167,139,250,0.15)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.3)" }}
    >
      Mock
    </span>
  );
}

function renderSummary(layout: ExportLayout, inclTop5: boolean, inclBot5: boolean): JSX.Element {
  const s = layout.summary;
  const viewLabel = layout.view_metric === "view_count" ? "View Count" : "Play Count";

  // Mirror export-service header order: KOL | Platform | # Videos | [# Images]
  // | Avg Views | Most Views | Least Views | [date cols] | [KPI] | [Top/Bot]
  // | V1 V2 V3 …
  const headers: string[] = ["KOL / Creator", "Platform", "# Videos"];
  if (s.images) headers.push("# Images");
  headers.push("Avg Views", "Most Views", "Least Views");
  if (s.dates) headers.push("Date (Most Viewed)", "Date (Least Viewed)");
  if (s.kpi)   headers.push("KPI Est. Views");
  if (inclTop5) headers.push("Top 5 Avg Views");
  if (inclBot5) headers.push("Bottom 5 Avg Views");
  const maxVideos = s.videos ? 3 : 0;
  for (let i = 1; i <= maxVideos; i++) headers.push(`V${i}`);

  // Content-filter affects which mock rows we want to render. Images-only would
  // disable details entirely (handled upstream), so this preview always shows
  // a KOL summary regardless.
  const rows = MOCK_KOLS;

  return (
    <table className="text-xs border-collapse w-full">
      <thead>
        <tr>
          {headers.map((h) => (
            <th key={h} className={thCls} style={thStyle}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const cells: (string | number)[] = [r.username, "Mock", r.videos];
          if (s.images) cells.push(r.images);
          const avg = Math.round(r.vlist.reduce((a, b) => a + b, 0) / r.vlist.length);
          cells.push(fmtInt(avg), fmtInt(Math.max(...r.vlist)), fmtInt(Math.min(...r.vlist)));
          if (s.dates) cells.push("2025-12-15", "2025-11-12");
          if (s.kpi)   cells.push(fmtInt(Math.round(avg / 10000) * 10000));
          if (inclTop5) cells.push(fmtInt(Math.max(...r.vlist)));
          if (inclBot5) cells.push(fmtInt(Math.min(...r.vlist)));
          for (let v = 0; v < maxVideos; v++) {
            cells.push(r.vlist[v] !== undefined ? fmtInt(r.vlist[v]) : "");
          }
          return (
            <tr key={i} style={{ background: i % 2 === 0 ? "rgba(255,255,255,0.02)" : "transparent" }}>
              {cells.map((c, ci) => (
                <td key={ci} className={tdCls} style={tdStyle}>{c}</td>
              ))}
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={headers.length} className="px-2 py-1 text-[10px] text-muted-foreground italic" style={{ background: "rgba(255,255,255,0.02)" }}>
            Views feed from <span className="text-foreground">{viewLabel}</span>. V-cells hold individual video views (hover-comments in the real workbook).
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

function renderDetails(
  layout: ExportLayout,
  rawMetrics: string[],
  calcMetrics: string[],
  sortBy: string,
): JSX.Element {
  const d = layout.details;

  // Filter mock rows by content_filter so the preview reflects the toggle.
  let rows = MOCK_VIDEOS;
  if (layout.content_filter === "videos") rows = rows.filter((r) => r.type === "Video");
  else if (layout.content_filter === "shorts") rows = rows.filter((r) => r.type === "Short");
  else if (layout.content_filter === "images") rows = []; // details sheet is normally disabled in this mode

  const headers: string[] = ["KOL / Creator", "Platform"];
  if (d.type) headers.push("Type");
  headers.push("Video #");
  if (d.play) headers.push("Play Count");
  if (d.view) headers.push("View Count");
  if (d.date) headers.push("Date Posted");
  const rawCols = (["Likes", "Comments", "Shares"] as const).filter((c) => rawMetrics.includes(c));
  headers.push(...rawCols);
  const calcCols = calcMetrics.filter((m) => m); // already filtered upstream
  headers.push(...calcCols);
  if (d.scrape_range) headers.push("Scrape Range");
  if (d.sort_order)   headers.push("Sort Order");
  if (d.url)          headers.push("Video URL");

  // Compute calc-metric values from the mock row — same formulas as the
  // export-service so the preview is faithful, not approximate.
  function calcCell(m: string, r: typeof MOCK_VIDEOS[number]): string {
    const v = r.views, l = r.likes, c = r.comments, s = r.shares, p = r.plays;
    if (m === "Engagement Rate") return fmtPct((l + c + s) / Math.max(v, 1) * 100);
    if (m === "Applause Rate")   return fmtPct(l / Math.max(v, 1) * 100);
    if (m === "Virality Rate")   return fmtPct(s / Math.max(v, 1) * 100);
    if (m === "Comment/View Ratio") return fmtPct(c / Math.max(v, 1) * 100);
    if (m === "VTR")             return fmtPct(v / Math.max(p, 1) * 100);
    if (m === "CPV ($)")         return "$0.0028";   // illustrative — needs a rate
    return "—";
  }

  return (
    <table className="text-xs border-collapse w-full">
      <thead>
        <tr>
          {headers.map((h) => (
            <th key={h} className={thCls} style={thStyle}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={headers.length} className="px-3 py-4 text-center text-[11px] text-muted-foreground italic">
              No rows in this preview for the current content filter.
            </td>
          </tr>
        ) : rows.map((r, i) => {
          const cells: (string | number)[] = [r.kol, "Mock"];
          if (d.type) cells.push(r.type);
          cells.push(i + 1);
          if (d.play) cells.push(fmtInt(r.plays));
          if (d.view) cells.push(fmtInt(r.views));
          if (d.date) cells.push(r.date);
          for (const c of rawCols) {
            cells.push(fmtInt(c === "Likes" ? r.likes : c === "Comments" ? r.comments : r.shares));
          }
          for (const m of calcCols) cells.push(calcCell(m, r));
          if (d.scrape_range) cells.push("All time");
          if (d.sort_order)   cells.push(sortBy);
          if (d.url)          cells.push(r.url);
          return (
            <tr key={i} style={{ background: i % 2 === 0 ? "rgba(255,255,255,0.02)" : "transparent" }}>
              {cells.map((c, ci) => (
                <td key={ci} className={tdCls} style={tdStyle}>{c}</td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function renderNotes(): JSX.Element {
  return (
    <div className="p-3 space-y-1.5 text-[11px] text-muted-foreground">
      <p className="font-semibold text-foreground">Export Notes</p>
      <p>• Caveats sheet — platform disclaimers, view-count semantics, content-type behaviour.</p>
      <p>• Calculated-metric formulas for every metric you selected.</p>
      <p>• Data-completeness notes — flags creators that returned fewer rows than requested.</p>
      <p className="italic mt-2">(Real sheet content depends on your selections.)</p>
    </div>
  );
}

function sheetTitle(key: SheetKey): string {
  if (key === "summary") return "KOL Views (Mock)";
  if (key === "details") return "Video Details";
  return "Export Notes";
}

// React.memo wrapper: the Exporter re-renders on every job-poll tick, every
// keystroke in unrelated inputs (recipient email, filename), every selection
// change in the job list — none of which affect the preview. Default shallow
// comparison on the 6 props is enough because:
//   • layout / rawMetrics / calcMetrics are state — references only change
//     when their setters fire (i.e. when a builder toggle actually changes).
//   • sortBy / inclTop5 / inclBot5 are primitives — Object.is-stable.
// So the preview now re-renders ONLY when a builder control actually changes,
// not on every Exporter render.
export const ExportPreview = memo(function ExportPreview({ layout, rawMetrics, calcMetrics, sortBy, inclTop5, inclBot5 }: Props) {
  const sheetContent: Record<SheetKey, JSX.Element | null> = {
    summary: layout.summary.enabled ? renderSummary(layout, inclTop5, inclBot5) : null,
    details: layout.details.enabled ? renderDetails(layout, rawMetrics, calcMetrics, sortBy) : null,
    notes:   layout.notes.enabled   ? renderNotes() : null,
  };
  const order = (layout.order && layout.order.length ? layout.order : ["summary", "details", "notes"] as SheetKey[]);
  const sheets = order
    .map((key) => ({ key, content: sheetContent[key] }))
    .filter((s): s is { key: SheetKey; content: JSX.Element } => s.content !== null);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <FileSpreadsheet className="w-3.5 h-3.5" style={{ color: "#00c9ff" }} />
        <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          Workbook preview — reflects your toggles in real time
        </p>
        <MockBadge />
      </div>

      {sheets.length === 0 ? (
        <div className="rounded-lg border border-border p-4 text-[11px] text-muted-foreground italic text-center" style={{ background: "var(--card)" }}>
          Enable at least one sheet to preview the workbook.
        </div>
      ) : sheets.map(({ key, content }, i) => (
        <div key={key} className="rounded-lg border border-border overflow-hidden" style={{ background: "var(--card)" }}>
          <div className="px-3 py-1.5 border-b border-border flex items-center gap-2" style={{ background: "var(--input)" }}>
            <span className="text-[10px] font-mono text-muted-foreground">Sheet {i + 1}</span>
            <span className="text-xs font-medium text-foreground">{sheetTitle(key)}</span>
            <span className="ml-auto text-[10px] text-muted-foreground">
              {key === "summary" ? `${MOCK_KOLS.length} creator${MOCK_KOLS.length !== 1 ? "s" : ""}` :
               key === "details" ? "1 row per video" : ""}
            </span>
          </div>
          <div className="overflow-x-auto" style={{ maxHeight: 240 }}>
            {content}
          </div>
        </div>
      ))}

      <p className="text-[10px] text-muted-foreground italic">
        Numbers are placeholders. Your actual data fills in on download.
      </p>
    </div>
  );
});
