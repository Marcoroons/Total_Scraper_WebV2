// Rate-input formatting helpers.
// Storage stays raw ("1234567" / "1234.56") so downstream parseFloat works
// unchanged; display gets thousand-separator commas for readability while
// typing. Used by URLDataTable (URL Stats page) + Exporter (per-KOL CPV
// rate input).

// Strip anything that isn't a digit or dot; collapse to a single decimal.
// Also strips commas the user pasted in — so pasting "1,234,567" produces
// "1234567", which then displays as "1,234,567" via formatRateDisplay.
export function cleanRateInput(raw: string): string {
  let s = raw.replace(/[^\d.]/g, "");
  const dot = s.indexOf(".");
  if (dot !== -1) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, "");
  return s;
}

// Format a raw stored string ("1234567" or "1234.56") with commas ("1,234,567" /
// "1,234.56") for display. Preserves a trailing decimal point during mid-type
// ("1234." → "1,234.") so the user can keep typing digits after it.
export function formatRateDisplay(raw: string): string {
  if (!raw) return "";
  const [intPart, decPart] = raw.split(".");
  const withCommas = (intPart || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return raw.includes(".") ? `${withCommas}.${decPart ?? ""}` : withCommas;
}
