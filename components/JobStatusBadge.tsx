interface JobStatusBadgeProps {
  status: "PENDING" | "AUTO_PROCESSING" | "COMPLETED" | "FAILED";
  errorMessage?: string | null;
}

const CONFIG: Record<string, { label: string; className: string }> = {
  PENDING: {
    label: "Pending",
    className: "bg-amber-100 text-amber-700 border-amber-200",
  },
  AUTO_PROCESSING: {
    label: "Processing",
    className: "bg-blue-100 text-blue-700 border-blue-200",
  },
  COMPLETED: {
    label: "Completed",
    className: "bg-green-100 text-green-700 border-green-200",
  },
  FAILED: {
    label: "Failed",
    className: "bg-red-100 text-red-700 border-red-200",
  },
};

export function JobStatusBadge({ status, errorMessage }: JobStatusBadgeProps) {
  const cfg = CONFIG[status] ?? CONFIG.PENDING;

  return (
    <span
      title={status === "FAILED" && errorMessage ? errorMessage : undefined}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border select-none ${cfg.className} ${status === "FAILED" && errorMessage ? "cursor-help" : ""}`}
    >
      {status === "AUTO_PROCESSING" && (
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse flex-shrink-0" />
      )}
      {cfg.label}
    </span>
  );
}