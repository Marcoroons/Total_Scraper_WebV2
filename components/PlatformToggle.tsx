"use client";

type Platform = "Instagram" | "TikTok";

interface PlatformToggleProps {
  value: Platform;
  onChange: (platform: Platform) => void;
}

export function PlatformToggle({ value, onChange }: PlatformToggleProps) {
  return (
    <div className="inline-flex rounded-lg border overflow-hidden">
      {(["Instagram", "TikTok"] as Platform[]).map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(p)}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            value === p
              ? "bg-[#1F4E78] text-white"
              : "bg-white text-gray-600 hover:bg-gray-50"
          }`}
        >
          {p === "Instagram" ? "📸 Instagram" : "🎵 TikTok"}
        </button>
      ))}
    </div>
  );
}