"use client";

export type Platform = "Instagram" | "TikTok" | "YouTube";

const PLATFORM_COLORS: Record<Platform, string> = {
  Instagram: "#e1306c",
  TikTok: "#00c9ff",
  YouTube: "#ff0000",
};

const PLATFORM_LABELS: Record<Platform, string> = {
  Instagram: "📸 Instagram",
  TikTok: "🎵 TikTok",
  YouTube: "▶️ YouTube",
};

const DEFAULT_PLATFORMS: Platform[] = ["Instagram", "TikTok"];

interface PlatformToggleProps {
  value: Platform;
  onChange: (platform: Platform) => void;
  // Which platforms this page offers. Default = the historical IG+TikTok pair —
  // pages that don't support YouTube (Hashtag / KOL Finder) keep working by
  // omitting the prop, so YouTube can't accidentally appear there.
  platforms?: Platform[];
}

export function PlatformToggle({ value, onChange, platforms = DEFAULT_PLATFORMS }: PlatformToggleProps) {
  return (
    <div className="inline-flex rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
      {platforms.map((p, i) => {
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
              borderRight: i < platforms.length - 1 ? "1px solid rgba(255,255,255,0.07)" : undefined,
            }}
          >
            {PLATFORM_LABELS[p]}
          </button>
        );
      })}
    </div>
  );
}
