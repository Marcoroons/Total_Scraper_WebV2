import { Sparkles, type LucideIcon } from "lucide-react";

export function ComingSoon({
  title,
  description,
  icon: Icon = Sparkles,
  accent = "#00c9ff",
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  accent?: string;
}) {
  return (
    <div className="flex items-center justify-center" style={{ minHeight: "calc(100vh - 140px)" }}>
      <div
        className="rounded-2xl border p-10 max-w-md text-center"
        style={{ background: "#0d1829", borderColor: "rgba(255,255,255,0.07)" }}
      >
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5"
          style={{ background: `${accent}14`, border: `1px solid ${accent}33` }}
        >
          <Icon className="w-6 h-6" style={{ color: accent }} />
        </div>

        <span
          className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider px-2.5 py-1 rounded-full mb-4"
          style={{ background: `${accent}12`, border: `1px solid ${accent}26`, color: accent }}
        >
          <Sparkles className="w-3 h-3" />
          Coming soon
        </span>

        <h1 className="text-xl font-bold text-foreground mb-2" style={{ fontFamily: "Outfit, sans-serif" }}>
          {title}
        </h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {description ?? "This tool is under construction and will be available in a future release."}
        </p>
      </div>
    </div>
  );
}
