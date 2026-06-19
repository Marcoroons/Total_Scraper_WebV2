"use client";

import { Plus, Trash2 } from "lucide-react";

export interface URLRow {
  id: string;
  url: string;
  kol: string;
  rate: string;
}

interface URLDataTableProps {
  rows: URLRow[];
  onChange: (rows: URLRow[]) => void;
  includeRate: boolean;
}

function makeRow(): URLRow {
  return { id: Math.random().toString(36).slice(2), url: "", kol: "", rate: "" };
}

function update(rows: URLRow[], id: string, patch: Partial<URLRow>): URLRow[] {
  return rows.map((r) => (r.id === id ? { ...r, ...patch } : r));
}

export function URLDataTable({ rows, onChange, includeRate }: URLDataTableProps) {
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
    <div className="border rounded-lg overflow-hidden">
      {/* Header */}
      <div
        className={`grid text-xs font-semibold uppercase tracking-wider text-gray-400 bg-gray-50 border-b px-3 py-2 gap-2 ${
          includeRate ? "grid-cols-[1fr_160px_96px_32px]" : "grid-cols-[1fr_160px_32px]"
        }`}
      >
        <span>Video URL *</span>
        <span>KOL Username</span>
        {includeRate && <span>Rate ($) *</span>}
        <span />
      </div>

      {/* Rows */}
      <div className="divide-y">
        {rows.map((row) => (
          <div
            key={row.id}
            className={`grid items-center gap-2 px-3 py-2 ${
              includeRate ? "grid-cols-[1fr_160px_96px_32px]" : "grid-cols-[1fr_160px_32px]"
            }`}
          >
            <input
              type="url"
              value={row.url}
              onChange={(e) => onChange(update(rows, row.id, { url: e.target.value }))}
              onPaste={(e) => handleUrlPaste(e, row.id)}
              placeholder="https://www.instagram.com/p/…"
              className="w-full px-2.5 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1F4E78] focus:border-transparent"
            />
            <input
              type="text"
              value={row.kol}
              onChange={(e) => onChange(update(rows, row.id, { kol: e.target.value }))}
              placeholder="@handle"
              className="w-full px-2.5 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1F4E78] focus:border-transparent"
            />
            {includeRate && (
              <input
                type="number"
                min="0"
                step="0.01"
                value={row.rate}
                onChange={(e) => onChange(update(rows, row.id, { rate: e.target.value }))}
                placeholder="0.00"
                className="w-full px-2.5 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1F4E78] focus:border-transparent"
              />
            )}
            <button
              type="button"
              onClick={() => removeRow(row.id)}
              className="p-1.5 text-gray-300 hover:text-red-400 hover:bg-red-50 rounded-lg transition-colors"
              title="Remove row"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Add row */}
      <div className="border-t bg-gray-50">
        <button
          type="button"
          onClick={addRow}
          className="flex items-center gap-1.5 px-4 py-2 text-sm text-[#1F4E78] font-medium hover:bg-blue-50 transition-colors w-full"
        >
          <Plus className="w-4 h-4" />
          Add URL
        </button>
      </div>
    </div>
  );
}