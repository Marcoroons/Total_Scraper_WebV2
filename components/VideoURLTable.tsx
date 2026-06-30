"use client";

import type { Platform } from "@/components/PlatformToggle";

export interface VideoRow {
  id: string;
  url: string;
  kol: string;
}

export function newVideoRow(): VideoRow {
  return { id: Math.random().toString(36).slice(2), url: "", kol: "" };
}

// Per-platform ghost text so switching the toggle updates the example URL
// to the right shape (catches IG-pasted-into-YouTube before submit).
const URL_PLACEHOLDER: Record<Platform, string> = {
  Instagram: "https://www.instagram.com/reel/...",
  TikTok:    "https://www.tiktok.com/@user/video/...",
  YouTube:   "https://www.youtube.com/watch?v=... or /shorts/...",
};

const KOL_PLACEHOLDER: Record<Platform, string> = {
  Instagram: "@username",
  TikTok:    "@username",
  YouTube:   "@channel",
};

interface Props {
  rows: VideoRow[];
  onChange: (rows: VideoRow[]) => void;
  platform?: Platform;
}

const inputCls =
  "w-full px-3 py-1.5 text-sm rounded-lg bg-input border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent";

export function VideoURLTable({ rows, onChange, platform = "Instagram" }: Props) {
  const urlPlaceholder = URL_PLACEHOLDER[platform];
  const kolPlaceholder = KOL_PLACEHOLDER[platform];
  function update(id: string, field: keyof Omit<VideoRow, "id">, value: string) {
    onChange(rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  function deleteRow(id: string) {
    const next = rows.filter((r) => r.id !== id);
    onChange(next.length ? next : [newVideoRow()]);
  }

  function handlePaste(
    e: React.ClipboardEvent<HTMLInputElement>,
    rowId: string
  ) {
    const text = e.clipboardData.getData("text");
    if (!text) return;

    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const hasSep = text.includes("\t") || text.includes(",");
    if (lines.length <= 1 && !hasSep) return;
    e.preventDefault();

    const parsed: VideoRow[] = lines.map((line) => {
      let url = line, kol = "";
      const tabIdx = line.indexOf("\t");
      if (tabIdx !== -1) {
        url = line.slice(0, tabIdx).trim();
        kol = line.slice(tabIdx + 1).trim();
      } else {
        const commaIdx = line.indexOf(",");
        if (commaIdx !== -1) {
          url = line.slice(0, commaIdx).trim();
          kol = line.slice(commaIdx + 1).trim();
        }
      }
      return { id: Math.random().toString(36).slice(2), url, kol };
    });

    const idx = rows.findIndex((r) => r.id === rowId);
    const spliced = [...rows.slice(0, idx), ...parsed, ...rows.slice(idx + 1)];
    const filtered = spliced.filter((r) => r.url || r.kol);
    onChange(filtered.length ? filtered : [newVideoRow()]);
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_180px_32px] gap-2 px-1">
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          Video URL <span className="text-red-400">*</span>
        </span>
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          KOL Username <span className="text-red-400">*</span>
        </span>
        <span />
      </div>

      {rows.map((row) => (
        <div key={row.id} className="grid grid-cols-[1fr_180px_32px] gap-2 items-center">
          <input
            type="text"
            value={row.url}
            onChange={(e) => update(row.id, "url", e.target.value)}
            onPaste={(e) => handlePaste(e, row.id)}
            placeholder={urlPlaceholder}
            className={inputCls}
          />
          <input
            type="text"
            value={row.kol}
            onChange={(e) => update(row.id, "kol", e.target.value)}
            placeholder={kolPlaceholder}
            className="px-3 py-1.5 text-sm rounded-lg bg-input border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
          />
          <button
            type="button"
            onClick={() => deleteRow(row.id)}
            aria-label="Remove row"
            className="flex items-center justify-center w-8 h-8 rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            ×
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange([...rows, newVideoRow()])}
        className="mt-1 text-xs text-primary hover:opacity-80 transition-opacity"
      >
        + Add row
      </button>
    </div>
  );
}
