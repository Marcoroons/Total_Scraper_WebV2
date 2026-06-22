"use client";

type Platform = "Instagram" | "TikTok";

const PLATFORM_COLORS: Record<Platform, string> = {
  Instagram: "#e1306c",
  TikTok: "#00c9ff",
};

interface PlatformToggleProps {
  value: Platform;
  onChange: (platform: Platform) => void;
}

export function PlatformToggle({ value, onChange }: PlatformToggleProps) {
  return (
    <div className="inline-flex rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
      {(["Instagram", "TikTok"] as Platform[]).map((p, i) => {
        const active = value === p;
        const color = PLATFORM_COLORS[p];
        return (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className="px-4 py-2 text-sm font-medium transition-all"
            style={{
              background: active ? `${color}18` : "var(--card)",
              color: active ? color : "#8899b0",
              borderRight: i === 0 ? "1px solid rgba(255,255,255,0.07)" : undefined,
            }}
          >
            {p === "Instagram" ? "📸 Instagram" : "🎵 TikTok"}
          </button>
        );
      })}
    </div>
  );
}
