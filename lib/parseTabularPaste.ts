// Tabular-paste parser for the URL Stats and Comments bulk-entry tables.
// Handles clipboard text from Excel/Sheets (tab-separated), CSV (comma-
// separated), or plain URL/KOL lists (newline-separated single column).
//
// The URL/KOL role of each cell is detected by content (URL-like strings go
// to `url`, rate-like numerics go to `rate`, everything else falls to `kol`)
// so pasting works regardless of visual column order — matches the same
// order-agnostic behaviour the VideoURLTable already had.

export interface ParsedTabularRow {
  url: string;
  kol: string;
  rate: string;
}

const looksLikeUrl = (s: string): boolean =>
  /^https?:\/\//i.test(s) ||
  /(instagram|tiktok|youtube|youtu\.be)\.[a-z]/i.test(s);

// A rate is a plain number, optionally with $, commas, or decimals.
// Restrictive on purpose — anything else falls to KOL.
const looksLikeRate = (s: string): boolean =>
  /^\$?\s*[\d,]+(?:\.\d+)?\s*$/.test(s);

const cleanRate = (s: string): string => s.replace(/[$,\s]/g, "");

/**
 * Parse a clipboard-text paste into an array of row objects.
 *
 * @param text          Raw clipboard content.
 * @param hasRate       Whether the destination table has a rate column
 *                      (URLDataTable when includeRate=true). If false, any
 *                      rate-looking value falls through to `kol` since the
 *                      caller has nowhere to put it.
 * @param preferredRole For single-value lines that DON'T look like a URL:
 *                      "kol" (default) means put the value in kol; "url"
 *                      means put in url. Lets URLDataTable's URL input
 *                      keep its historical "paste a list of URLs" behaviour
 *                      when the pasted lines are single strings.
 */
export function parseTabularPaste(
  text: string,
  hasRate: boolean = false,
  preferredRole: "kol" | "url" = "kol",
): ParsedTabularRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  return lines.map((line) => {
    // Tab wins over comma (Excel/Sheets uses tab; CSVs use comma). URLs can
    // legitimately contain commas (query strings), so splitting on comma when
    // tabs are present would be wrong.
    const parts =
      line.includes("\t") ? line.split("\t") :
      line.includes(",")  ? line.split(",")  :
      [line];
    const trimmed = parts.map((s) => s.trim()).filter(Boolean);

    if (trimmed.length === 0) return { url: "", kol: "", rate: "" };

    if (trimmed.length === 1) {
      const v = trimmed[0];
      if (looksLikeUrl(v)) return { url: v, kol: "", rate: "" };
      if (preferredRole === "url") return { url: v, kol: "", rate: "" };
      return { url: "", kol: v, rate: "" };
    }

    // Multi-cell row: fill by role detection. First URL-looking value wins the
    // url slot; first rate-looking value wins the rate slot (if hasRate);
    // everything else goes to kol (joined by space if multiple values remain).
    let url = "";
    let rate = "";
    const kolBits: string[] = [];
    for (const v of trimmed) {
      if (!url && looksLikeUrl(v))                 { url = v;              continue; }
      if (hasRate && !rate && looksLikeRate(v))    { rate = cleanRate(v);  continue; }
      kolBits.push(v);
    }
    return { url, kol: kolBits.join(" ").trim(), rate };
  });
}
