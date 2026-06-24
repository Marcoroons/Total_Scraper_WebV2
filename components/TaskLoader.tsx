"use client";

/**
 * TaskLoader — Queue page loading state. Plays /public/task-loading.mp4 on a dark
 * card with a "Task Loading" label. A multiply-blended navy overlay + brightness
 * filter keep the clip reading dark/on-theme even if the source is bright or blue.
 */
export function TaskLoader({ label = "Task Loading" }: { label?: string }) {
  return (
    <div
      className="w-full flex flex-col items-center justify-center gap-3 rounded-xl border py-6"
      style={{ background: "#0d1829", borderColor: "rgba(255,255,255,0.07)", animation: "wl-fade .25s ease-out both" }}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div className="relative inline-block rounded-lg overflow-hidden" style={{ lineHeight: 0 }}>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          src="/task-loading.mp4"
          autoPlay
          loop
          muted
          playsInline
          aria-hidden="true"
          style={{ display: "block", maxHeight: 180, maxWidth: "100%", width: "auto", filter: "brightness(0.82) saturate(1.1)" }}
        />
        {/* Dark tint so the clip stays dark/on-theme even if it's bright or blue. */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "#0a1420", mixBlendMode: "multiply", opacity: 0.5 }}
        />
      </div>

      <p className="text-sm font-medium" style={{ color: "#c8d8ed" }}>
        {label}
        <span className="wl-dot" style={{ animationDelay: "0ms" }}>.</span>
        <span className="wl-dot" style={{ animationDelay: "180ms" }}>.</span>
        <span className="wl-dot" style={{ animationDelay: "360ms" }}>.</span>
      </p>
    </div>
  );
}
