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
}

function toggle(list: string[], val: string) {
  return list.includes(val) ? list.filter((x) => x !== val) : [...list, val];
}

function ChipGroup({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const active = selected.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              title={TOOLTIPS[opt]}
              onClick={() => onChange(toggle(selected, opt))}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                active
                  ? "bg-[#1F4E78] text-white border-[#1F4E78]"
                  : "bg-white text-gray-600 border-gray-200 hover:border-[#1F4E78] hover:text-[#1F4E78]"
              }`}
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
      />
      <ChipGroup
        label="Calculated Metrics"
        options={calcOpts}
        selected={validCalc}
        onChange={onCalcChange}
      />
    </div>
  );
}

export { RAW_METRICS, CALC_METRICS };