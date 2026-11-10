// ---------------------------------------------------------------------------
// pdf-code-column.ts — keep item codes on ONE line on the PO / GRN / PI PDFs
// (cross-system review D5; Conts#683, Conts#767).
//
// The code column used to be a fixed 22–26 mm with `overflow: linebreak`, so a
// long code wrapped mid-code ("PC151-CUSHION-" / "A") and a buyer or a store
// clerk could read half of it. The column is now sized to the longest code on
// the document: it never gets narrower than its old width, it widens up to a
// cap (the description column, which is `auto`, absorbs the difference), and
// only when a code is longer than even the cap does its font shrink — down to
// a floor, never below it. Display only: no amount or quantity is touched.
// ---------------------------------------------------------------------------

/** The bit of jsPDF this needs — lets the test pass a fake measurer. */
export type TextMeasurer = {
  getTextWidth(text: string): number;
  getFontSize(): number;
  setFontSize(size: number): unknown;
  getFont(): { fontName: string; fontStyle: string };
  setFont(fontName: string, fontStyle?: string): unknown;
};

export type CodeColumnFit = { cellWidth: number; fontSize: number };

export type CodeColumnOptions = {
  /** The column's old fixed width (mm) — never go narrower. */
  minWidth: number;
  /** The widest the column may get (mm) before the font shrinks instead. */
  maxWidth: number;
  /** Table body font size (pt). */
  fontSize?: number;
  /** Smallest font size allowed (pt), the last resort. */
  minFontSize?: number;
  /** Left + right cell padding (mm). */
  padding?: number;
  /** Font style the codes print in. */
  fontStyle?: "bold" | "normal";
};

/** A little slack so rounding inside autotable can never push a code over. */
const SLACK_MM = 0.6;

/**
 * Width and font size for the item-code column so every code fits on one
 * line. Measures each code with the document's own font metrics.
 */
export function fitCodeColumn(
  doc: TextMeasurer,
  codes: ReadonlyArray<string | null | undefined>,
  opts: CodeColumnOptions,
): CodeColumnFit {
  const fontSize = opts.fontSize ?? 8;
  const minFontSize = opts.minFontSize ?? 6;
  const padding = opts.padding ?? 3.6;
  const prevSize = doc.getFontSize();
  const prevFont = doc.getFont();
  doc.setFont("helvetica", opts.fontStyle ?? "bold");
  doc.setFontSize(fontSize);
  let widest = 0;
  for (const c of codes) {
    const s = String(c ?? "").trim();
    if (!s) continue;
    widest = Math.max(widest, doc.getTextWidth(s));
  }
  doc.setFontSize(prevSize);
  doc.setFont(prevFont.fontName, prevFont.fontStyle);

  const needed = widest + padding + SLACK_MM;
  if (needed <= opts.minWidth) return { cellWidth: opts.minWidth, fontSize };
  if (needed <= opts.maxWidth) {
    return { cellWidth: Math.ceil(needed * 10) / 10, fontSize };
  }
  // Last resort: the cap is reached, shrink the code font to fit it.
  const room = opts.maxWidth - padding - SLACK_MM;
  const scaled = Math.floor(fontSize * (room / widest) * 10) / 10;
  return { cellWidth: opts.maxWidth, fontSize: Math.max(minFontSize, scaled) };
}
