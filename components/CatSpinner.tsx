"use client";

/**
 * CatSpinner — the animated "task loading" cat (public/task-loading.mp4) shown
 * inline wherever a circular loading spinner used to be. Sized in px to match the
 * icon it replaces; dark-tinted like TaskLoader so it reads on-theme. Use this in
 * place of <Loader2 className="… animate-spin" /> and other loading indicators.
 */
export function CatSpinner({
  size = 16,
  className = "",
  label = "Loading",
}: {
  size?: number;
  className?: string;
  label?: string;
}) {
  return (
    <span
      className={`inline-block rounded-sm overflow-hidden align-middle flex-shrink-0 ${className}`}
      style={{ width: size, height: size, lineHeight: 0 }}
      role="status"
      aria-label={label}
    >
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        src="/task-loading.mp4"
        autoPlay
        loop
        muted
        playsInline
        aria-hidden="true"
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block",
          filter: "brightness(0.92) saturate(1.1)",
        }}
      />
    </span>
  );
}
