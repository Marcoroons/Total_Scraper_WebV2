"use client";

type Platform = "Instagram" | "TikTok";

const RAW_METRICS: Record<Platform, string[]> = {
  Instagram: ["Username", "Video URL", "Play Count", "View Count", "Likes", "Comments", "Shares"],
  TikTok:    ["Username", "Video URL", "Play Count", "Likes", "Comments", "Shares"],
};

const CALC_METRICS: Record<Platform, string[]> = {
  Instagram: ["Engagement Rate", "Applause Rate", "VTR", "Virality Rate", "CPV ($)", "Comment/View Ratio"],
  TikTok:    ["Engagement Rate", "Applause Rate", "Virality Rate", "CPV ($)", "Comment/View Ratio"],
};

const TOOLTIPS: Record<string, string> = {
  "Engagement Rate":    "(Likes + Comments + Shares) / Play Count × 100%",
  "Applause Rate":      "Likes / Play Count × 100%",
  "VTR":                "View Count / Play Count × 100%  (3-second views, Instagram only)",
  "Virality Rate":      "Shares / Play Count × 100%",
  "CPV ($)":            "Rate ($) ÷ Play Count — requires Rate column enabled",
  "Comment/View Ratio": "Comments / Play Count × 100%",
};

interface MetricsSelectorProps {
  platform: Platform;
  rawSelected: string[];
  calcSelected: string[];
  onRawChange: (v: string[]) => void;
  onCalcChange: (v: string[]) => void;
  accentColor?: string;
}

function toggle(list: string[], val: string) {
  return list.includes(val) ? list.filter((x) => x !== val) : [...list, val];
}

function ChipGroup({
  label,
  options,
  selected,
  onChange,
  accentColor,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  accentColor: string;
}) {
  return (
    <div>
      <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const active = selected.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              title={TOOLTIPS[opt]}
              onClick={() => onChange(toggle(selected, opt))}
              className="px-3 py-1 rounded-full text-xs font-medium border transition-all"
              style={
                active
                  ? { background: `${accentColor}18`, borderColor: accentColor, color: accentColor }
                  : { background: "var(--card)", borderColor: "rgba(255,255,255,0.07)", color: "#8899b0" }
              }
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function MetricsSelector({
  platform,
  rawSelected,
  calcSelected,
  onRawChange,
  onCalcChange,
  accentColor = "#00c9ff",
}: MetricsSelectorProps) {
  const rawOpts  = RAW_METRICS[platform];
  const calcOpts = CALC_METRICS[platform];
  const validRaw  = rawSelected.filter((m) => rawOpts.includes(m));
  const validCalc = calcSelected.filter((m) => calcOpts.includes(m));

  return (
    <div className="space-y-4">
      <ChipGroup
        label="Raw Metrics"
        options={rawOpts}
        selected={validRaw}
        onChange={onRawChange}
        accentColor={accentColor}
      />
      <ChipGroup
        label="Calculated Metrics"
        options={calcOpts}
        selected={validCalc}
        onChange={onCalcChange}
        accentColor={accentColor}
      />
    </div>
  );
}

export { RAW_METRICS, CALC_METRICS };
