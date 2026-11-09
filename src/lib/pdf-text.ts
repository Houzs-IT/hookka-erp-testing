// ---------------------------------------------------------------------------
// pdf-text.ts — one clean-up pass for free text printed on a document PDF.
//
// Free-text fields reach the PDF generators straight from the row: a note an
// operator pasted with trailing spaces and blank lines, an address assembled
// as `${line1}, ${line2}` while line2 was null ("No 3, null"), a field that was
// stringified somewhere upstream ("undefined"). Each generator used to print
// whatever it was handed, so customers and suppliers saw "null" on a PO and
// ragged whitespace in a remark. Every main document generator (SO / DO /
// Invoice via the unified renderer, PO, PI, Credit Note) now passes its free
// text through here.
//
// What it does (and nothing else — layout, wrapping and fonts are untouched):
//   · null / undefined / non-string → ""  (numbers are stringified)
//   · the literal words "null" / "undefined" / "NaN" / "[object Object]" as a
//     whole value, or as a stand-alone comma/space-separated part, are dropped
//   · tabs and runs of spaces collapse to one space; each line is trimmed;
//     more than one blank line in a row collapses to one; CRLF → LF
//   · separators left dangling by a dropped part (", ,", a leading ", ") are
//     tidied
// Over-long text is NOT truncated here: every caller already wraps
// (autoTable `overflow: "linebreak"`, `splitTextToSize`, or the unified
// renderer's `wrapHard`). `pdfText` only guarantees what is wrapped is clean.
// Pure — shared by the browser generators and the worker-side unified
// renderer (src/api/lib/unified-do-invoice-pdf.ts).
// ---------------------------------------------------------------------------

const JUNK_WHOLE = /^(null|undefined|nan|\[object object\])$/i;
// A junk word standing alone between separators (start/end, comma, semicolon,
// slash, pipe or whitespace) — e.g. "No 3, null, Kuala Lumpur".
const JUNK_PART = /(^|[,;/|]\s*|\s)(?:null|undefined|NaN|\[object Object\])(?=\s*(?:[,;/|]|$))/g;

function cleanLine(line: string): string {
  // Any whitespace except the newline (tab, NBSP, form feed...) -> one space.
  let l = line.replace(/[^\S\n]+/g, " ").trim();
  if (JUNK_WHOLE.test(l)) return "";
  l = l.replace(JUNK_PART, "$1");
  // Tidy separators a dropped part left behind.
  l = l
    .replace(/\s+,/g, ",")
    .replace(/,(\s*,)+/g, ",")
    .replace(/^[\s,;]+/, "")
    .replace(/[\s,;]+$/, "")
    .replace(/ {2,}/g, " ")
    .trim();
  return JUNK_WHOLE.test(l) ? "" : l;
}

/** Clean a free-text value for a PDF. Returns "" for anything null-ish. */
export function pdfText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value !== "string") return "";
  const lines = value.replace(/\r\n?/g, "\n").split("\n").map(cleanLine);
  // Drop leading/trailing blank lines and collapse inner blank runs to one.
  const out: string[] = [];
  for (const l of lines) {
    if (l === "" && (out.length === 0 || out[out.length - 1] === "")) continue;
    out.push(l);
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

/** `pdfText`, with a placeholder (default "-") when nothing is left. */
export function pdfTextOr(value: unknown, placeholder = "-"): string {
  return pdfText(value) || placeholder;
}
