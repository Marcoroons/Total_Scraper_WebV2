"use client";

/**
 * TaskLoader — "Task Loading" banner shown in the Queue header band while jobs
 * are pending/processing. Plays /public/task-loading.mp4 with a multiply-blended
 * navy overlay + brightness filter so it reads dark/on-theme even if the clip
 * is bright or blue. Hidden on very small screens (no header band there).
 *
 * Layout: stretches to fill its flex parent (the Queue page wraps it in
 * `flex-1`). Cat video on the left, an animated "Task Loading…" label centered
 * in the rest of the band.
 */
export function TaskLoader({ label = "Task Loading" }: { label?: string }) {
  return (
    <div
      className="hidden sm:flex items-center gap-4 rounded-xl border px-4 py-2 w-full overflow-hidden"
      style={{
        background:
          "linear-gradient(90deg, #0d1829 0%, #0d1829 40%, rgba(0,201,255,0.06) 100%)",
        borderColor: "rgba(255,255,255,0.07)",
        minHeight: 64,
        animation: "wl-fade .25s ease-out both",
      }}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div className="relative inline-block rounded-md overflow-hidden flex-shrink-0" style={{ lineHeight: 0 }}>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          src="/task-loading.mp4"
          autoPlay
          loop
          muted
          playsInline
          aria-hidden="true"
          style={{ display: "block", height: 48, width: "auto", filter: "brightness(0.82) saturate(1.1)" }}
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "#0a1420", mixBlendMode: "multiply", opacity: 0.5 }}
        />
      </div>

      <p
        className="text-sm font-medium tracking-wide flex-1 text-center"
        style={{ color: "#c8d8ed" }}
      >
        {label}
        <span className="wl-dot" style={{ animationDelay: "0ms" }}>.</span>
        <span className="wl-dot" style={{ animationDelay: "180ms" }}>.</span>
        <span className="wl-dot" style={{ animationDelay: "360ms" }}>.</span>
      </p>
    </div>
  );
}
