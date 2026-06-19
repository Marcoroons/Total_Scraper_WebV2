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
    <div className="border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
      >
        <Key className="w-4 h-4 text-gray-400 flex-shrink-0" />
        <span className="flex-1 text-left">
          Apify API Key{" "}
          <span className="text-gray-400 font-normal">(optional)</span>
          {value && <span className="ml-2 text-green-600 text-xs">✓ set</span>}
        </span>
        {open ? (
          <ChevronUp className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        )}
      </button>
      {open && (
        <div className="px-4 pb-3 pt-2 border-t bg-gray-50">
          <input
            type="password"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="apify_api_..."
            className="w-full px-3 py-2 text-sm border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#1F4E78] focus:border-transparent"
          />
          <p className="text-xs text-gray-400 mt-1.5">
            Leave empty to use the shared platform key.
          </p>
        </div>
      )}
    </div>
  );
}