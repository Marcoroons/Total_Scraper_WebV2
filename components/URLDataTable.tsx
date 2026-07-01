"use client";

import { Plus, Trash2 } from "lucide-react";
import type { Platform } from "@/components/PlatformToggle";
import { cleanRateInput, formatRateDisplay } from "@/lib/formatRate";

export interface URLRow {
  id: string;
  url: string;
  kol: string;
  rate: string;
}

// Platform-shaped placeholders so the ghost text matches the currently-selected
// platform — pasting an IG URL into a YouTube tab is a common mis-paste, the
// placeholder catches it before the user submits.
const URL_PLACEHOLDER: Record<Platform, string> = {
  Instagram: "https://www.instagram.com/p/...",
  TikTok:    "https://www.tiktok.com/@user/video/...",
  YouTube:   "https://www.youtube.com/watch?v=... or /shorts/...",
};

const KOL_PLACEHOLDER: Record<Platform, string> = {
  Instagram: "@handle",
  TikTok:    "@handle",
  YouTube:   "@channel",
};

interface URLDataTableProps {
  rows: URLRow[];
  onChange: (rows: URLRow[]) => void;
  includeRate: boolean;
  platform?: Platform;   // defaults to Instagram for back-compat
}

function makeRow(): URLRow {
  return { id: Math.random().toString(36).slice(2), url: "", kol: "", rate: "" };
}

function update(rows: URLRow[], id: string, patch: Partial<URLRow>): URLRow[] {
  return rows.map((r) => (r.id === id ? { ...r, ...patch } : r));
}

// Rate formatting helpers live in lib/formatRate.ts — shared with the
// Exporter's per-KOL CPV rate input so both fields behave identically.

const inputCls =
  "w-full px-2.5 py-1.5 text-sm rounded-lg bg-input border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent";

export function URLDataTable({ rows, onChange, includeRate, platform = "Instagram" }: URLDataTableProps) {
  const urlPlaceholder = URL_PLACEHOLDER[platform];
  const kolPlaceholder = KOL_PLACEHOLDER[platform];
  function handleUrlPaste(e: React.ClipboardEvent<HTMLInputElement>, rowId: string) {
    const text = e.clipboardData.getData("text");
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length > 1) {
      e.preventDefault();
      const existing = rows.filter((r) => r.id !== rowId && r.url.trim());
      const pasted: URLRow[] = lines.map((line) => ({
        id: Math.random().toString(36).slice(2),
        url: line,
        kol: "",
        rate: "",
      }));
      onChange([...existing, ...pasted]);
    }
  }

  function addRow() {
    onChange([...rows, makeRow()]);
  }

  function removeRow(id: string) {
    const next = rows.filter((r) => r.id !== id);
    onChange(next.length > 0 ? next : [makeRow()]);
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Header — KOL on the left, URL on the right (swapped so the eye lands
          on WHO the row is about before the long URL string). */}
      <div
        className={`grid text-[10px] font-mono uppercase tracking-wider text-muted-foreground bg-muted border-b border-border px-3 py-2 gap-2 ${
          includeRate ? "grid-cols-[160px_1fr_96px_32px]" : "grid-cols-[160px_1fr_32px]"
        }`}
      >
        <span>KOL Username</span>
        <span>Video URL *</span>
        {includeRate && <span>Rate ($) *</span>}
        <span />
      </div>

      {/* Rows */}
      <div className="divide-y divide-border">
        {rows.map((row) => (
          <div
            key={row.id}
            className={`grid items-center gap-2 px-3 py-2 ${
              includeRate ? "grid-cols-[160px_1fr_96px_32px]" : "grid-cols-[160px_1fr_32px]"
            }`}
          >
            <input
              type="text"
              value={row.kol}
              onChange={(e) => onChange(update(rows, row.id, { kol: e.target.value }))}
              placeholder={kolPlaceholder}
              className={inputCls}
            />
            <input
              type="url"
              value={row.url}
              onChange={(e) => onChange(update(rows, row.id, { url: e.target.value }))}
              onPaste={(e) => handleUrlPaste(e, row.id)}
              placeholder={urlPlaceholder}
              className={inputCls}
            />
            {includeRate && (
              <input
                type="text"
                inputMode="decimal"
                value={formatRateDisplay(row.rate)}
                onChange={(e) => onChange(update(rows, row.id, { rate: cleanRateInput(e.target.value) }))}
                placeholder="0.00"
                className={inputCls}
              />
            )}
            <button
              type="button"
              onClick={() => removeRow(row.id)}
              className="p-1.5 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
              title="Remove row"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Add row */}
      <div className="border-t border-border bg-muted">
        <button
          type="button"
          onClick={addRow}
          className="flex items-center gap-1.5 px-4 py-2 text-sm text-primary font-medium hover:bg-primary/10 transition-colors w-full"
        >
          <Plus className="w-4 h-4" />
          Add URL
        </button>
      </div>
    </div>
  );
}
