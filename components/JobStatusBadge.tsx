interface JobStatusBadgeProps {
  status: "PENDING" | "AUTO_PROCESSING" | "COMPLETED" | "FAILED";
  errorMessage?: string | null;
}

const CONFIG: Record<string, { label: string; bg: string; border: string; color: string }> = {
  PENDING: {
    label: "Pending",
    bg: "rgba(148,163,184,0.1)",
    border: "rgba(148,163,184,0.25)",
    color: "#94a3b8",
  },
  AUTO_PROCESSING: {
    label: "Processing",
    bg: "rgba(167,139,250,0.1)",
    border: "rgba(167,139,250,0.25)",
    color: "#a78bfa",
  },
  COMPLETED: {
    label: "Completed",
    bg: "rgba(16,185,129,0.1)",
    border: "rgba(16,185,129,0.25)",
    color: "#10b981",
  },
  FAILED: {
    label: "Failed",
    bg: "rgba(239,68,68,0.1)",
    border: "rgba(239,68,68,0.25)",
    color: "#ef4444",
  },
};

export function JobStatusBadge({ status, errorMessage }: JobStatusBadgeProps) {
  const cfg = CONFIG[status] ?? CONFIG.PENDING;

  return (
    <span
      title={status === "FAILED" && errorMessage ? errorMessage : undefined}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border select-none ${
        status === "FAILED" && errorMessage ? "cursor-help" : ""
      }`}
      style={{ background: cfg.bg, borderColor: cfg.border, color: cfg.color }}
    >
      {status === "AUTO_PROCESSING" && (
        <span
          className="w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0"
          style={{ background: cfg.color }}
        />
      )}
      {cfg.label}
    </span>
  );
}
