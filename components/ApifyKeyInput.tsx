"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Key } from "lucide-react";

interface ApifyKeyInputProps {
  value: string;
  onChange: (v: string) => void;
}

export function ApifyKeyInput({ value, onChange }: ApifyKeyInputProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted transition-colors"
      >
        <Key className="w-4 h-4 flex-shrink-0" />
        <span className="flex-1 text-left">
          Apify API Key{" "}
          <span className="font-normal">(optional)</span>
          {value && (
            <span className="ml-2 text-xs" style={{ color: "#10b981" }}>
              ✓ set
            </span>
          )}
        </span>
        {open ? (
          <ChevronUp className="w-4 h-4" />
        ) : (
          <ChevronDown className="w-4 h-4" />
        )}
      </button>
      {open && (
        <div className="px-4 pb-3 pt-2 border-t border-border bg-muted">
          <input
            type="password"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="apify_api_..."
            className="w-full px-3 py-2 text-sm rounded-lg bg-input border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <p className="text-xs text-muted-foreground mt-1.5">
            Leave empty to use the shared platform key.
          </p>
        </div>
      )}
    </div>
  );
}
