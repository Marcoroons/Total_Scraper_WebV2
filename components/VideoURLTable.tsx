"use client";

export interface VideoRow {
  id: string;
  url: string;
  kol: string;
}

export function newVideoRow(): VideoRow {
  return { id: Math.random().toString(36).slice(2), url: "", kol: "" };
}

interface Props {
  rows: VideoRow[];
  onChange: (rows: VideoRow[]) => void;
}

export function VideoURLTable({ rows, onChange }: Props) {
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
        <span className="text-xs font-medium text-gray-500">
          Video URL <span className="text-red-400">*</span>
        </span>
        <span className="text-xs font-medium text-gray-500">
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
            placeholder="https://www.instagram.com/reel/..."
            className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1F4E78] focus:border-transparent"
          />
          <input
            type="text"
            value={row.kol}
            onChange={(e) => update(row.id, "kol", e.target.value)}
            placeholder="@username"
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1F4E78] focus:border-transparent"
          />
          <button
            type="button"
            onClick={() => deleteRow(row.id)}
            aria-label="Remove row"
            className="flex items-center justify-center w-8 h-8 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors text-lg leading-none"
          >
            x
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange([...rows, newVideoRow()])}
        className="mt-1 text-xs text-[#1F4E78] hover:underline"
      >
        + Add row
      </button>
    </div>
  );
}
