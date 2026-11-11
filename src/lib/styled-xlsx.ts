// ---------------------------------------------------------------------------
// Excel with lines (owner 2026-11-11 「做成好看一点的表格，有线条的」): an
// array-of-arrays plus one kind per row becomes a worksheet with thin borders
// on every table cell (empty ones too, so the lines print), a filled bold
// header, bold shaded group rows spanning the table, a shaded write-in column,
// red negatives and print margins.
//
// The xlsx module is passed in, so the styling stays pure and testable on real
// worksheets (tests/stock-count-styled.test.mjs). The page loads xlsx-js-style
// (SheetJS Community Edition with cell styles; plain `xlsx` cannot write
// styles) only when an export is clicked.
// ---------------------------------------------------------------------------
import { downloadBlob, safeSheetName, type Aoa } from "./export-report";

export type RowKind = "title" | "meta" | "metaLong" | "sign" | "note" | "blank" | "header" | "series" | "item";
export type StyledSheet = {
  name: string;
  aoa: Aoa;
  /** One per row of `aoa`. */
  kinds: RowKind[];
  /** Column widths in characters. */
  cols: number[];
  /** Columns shaded for writing in (Counted Qty, Remark). */
  writeCols?: number[];
  /** Number columns (right-aligned). */
  numCols?: number[];
  /** Columns whose negative numbers print red (red means negative only). */
  negRedCols?: number[];
  /** Black & white (owner 2026-11-11 「stock take 这个直接black & white」): no
   *  fills, black text and lines; the header keeps bold and a heavier rule under
   *  it, series rows stay bold. Used by the count sheet, which is printed. */
  mono?: boolean;
};

type Cell = { t?: string; v?: unknown; s?: unknown };
type Sheet = Record<string, unknown>;
type ZipEntry = { content: Uint8Array | number[]; size?: number };
export type XlsxLike = {
  utils: {
    aoa_to_sheet(aoa: Aoa): Sheet;
    encode_cell(c: { r: number; c: number }): string;
    encode_range(r: { s: { r: number; c: number }; e: { r: number; c: number } }): string;
    book_new(): unknown;
    book_append_sheet(wb: unknown, ws: Sheet, name: string): void;
  };
  write(wb: unknown, opts: { bookType: "xlsx"; type: "array" }): ArrayBuffer;
  /** The zip / compound-file reader-writer SheetJS ships with. */
  CFB: {
    read(data: Uint8Array, opts: { type: "array" }): { FullPaths: string[]; FileIndex: ZipEntry[] };
    write(cfb: unknown, opts: { fileType: "zip"; type: "array" }): Uint8Array | number[];
  };
};

type Palette = { ink: string; muted: string; line: string; headerInk: string; headerFill: string | null; seriesFill: string | null; writeFill: string | null; negative: string };
const COLOUR: Palette = { ink: "1F1D1B", muted: "6B7280", line: "8C8279", headerInk: "FFFFFF", headerFill: "6B5C32", seriesFill: "EFE9E1", writeFill: "FFF8DC", negative: "B91C1C" };
const MONO: Palette = { ink: "000000", muted: "000000", line: "000000", headerInk: "000000", headerFill: null, seriesFill: null, writeFill: null, negative: "000000" };
const TABLE: ReadonlySet<RowKind> = new Set(["header", "series", "item"]);
const fillOf = (rgb: string | null) => (rgb ? { fill: { fgColor: { rgb } } } : {});

/** The style of one cell, by its row's kind and its column; null = no style. */
export function cellStyle(kind: RowKind, col: number, value: unknown, sheet: Pick<StyledSheet, "writeCols" | "numCols" | "negRedCols" | "mono">): Record<string, unknown> | null {
  const p = sheet.mono ? MONO : COLOUR;
  const thin = { style: "thin", color: { rgb: p.line } };
  const box = { top: thin, bottom: thin, left: thin, right: thin };
  const num = (sheet.numCols ?? []).includes(col);
  const label = { font: { bold: true, color: { rgb: p.muted } } };
  switch (kind) {
    case "title":
      return { font: { bold: true, sz: 14, color: { rgb: p.ink } }, alignment: { vertical: "center" } };
    case "meta":
      return col === 0 || col === 3 ? label : { font: { bold: true, sz: 12, color: { rgb: p.ink } } };
    case "metaLong":
      return col === 0 ? label : { font: { color: { rgb: p.ink } } };
    case "sign":
      if (col === 0 || col === 3) return label;
      return col === 1 || col === 4 ? { border: { bottom: thin } } : null;
    case "note":
      return { font: { italic: true, color: { rgb: p.muted } }, alignment: { wrapText: true, vertical: "top" } };
    case "header":
      return {
        font: { bold: true, color: { rgb: p.headerInk } },
        ...fillOf(p.headerFill),
        // Without a fill the header is told apart by a heavier rule under it.
        border: sheet.mono ? { ...box, bottom: { style: "medium", color: { rgb: p.line } } } : box,
        alignment: { horizontal: num ? "right" : "left", vertical: "center", wrapText: true },
      };
    case "series":
      return { font: { bold: true, color: { rgb: p.ink } }, ...fillOf(p.seriesFill), border: box, alignment: { vertical: "center" } };
    case "item": {
      const s: Record<string, unknown> = { border: box, alignment: { horizontal: num ? "right" : "left", vertical: "center" } };
      if ((sheet.writeCols ?? []).includes(col) && p.writeFill) s.fill = { fgColor: { rgb: p.writeFill } };
      if ((sheet.negRedCols ?? []).includes(col) && typeof value === "number" && value < 0) s.font = { bold: true, color: { rgb: p.negative } };
      return s;
    }
    default:
      return null;
  }
}

const ROW_HEIGHT: Partial<Record<RowKind, number>> = { title: 24, header: 22, series: 18, item: 20, note: 30 };

/** One worksheet with lines, merges, column widths, row heights and print margins. */
export function buildStyledSheet(XLSX: XlsxLike, sheet: StyledSheet): Sheet {
  const ncols = Math.max(sheet.cols.length, ...sheet.aoa.map((r) => r.length), 1);
  // Table and signature rows get every cell, so an empty cell still carries its lines.
  const aoa: Aoa = sheet.aoa.map((r, i) => {
    const kind = sheet.kinds[i];
    return TABLE.has(kind) || kind === "sign" ? [...r, ...Array<string>(Math.max(0, ncols - r.length)).fill("")] : r;
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];
  const rows: { hpt?: number }[] = [];
  aoa.forEach((r, i) => {
    const kind = sheet.kinds[i] ?? "item";
    for (let c = 0; c < ncols; c++) {
      const st = cellStyle(kind, c, r[c], sheet);
      if (!st) continue;
      const ref = XLSX.utils.encode_cell({ r: i, c });
      const cell = (ws[ref] as Cell | undefined) ?? { t: "s", v: "" };
      cell.s = st;
      ws[ref] = cell;
    }
    if (kind === "title" || kind === "note" || kind === "series") merges.push({ s: { r: i, c: 0 }, e: { r: i, c: ncols - 1 } });
    if (kind === "metaLong") merges.push({ s: { r: i, c: 1 }, e: { r: i, c: ncols - 1 } });
    rows.push(ROW_HEIGHT[kind] ? { hpt: ROW_HEIGHT[kind] } : {});
  });
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, aoa.length - 1), c: ncols - 1 } });
  ws["!merges"] = merges;
  ws["!cols"] = sheet.cols.map((wch) => ({ wch }));
  ws["!rows"] = rows;
  ws["!margins"] = { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 };
  return ws;
}

const PAGE_SETUP = '<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/>';
const FIT_PR = '<pageSetUpPr fitToPage="1"/>';

/**
 * A worksheet's XML set to print on A4 portrait, one page wide and as many
 * pages tall as needed. A printer's own unprintable edge pushed the last
 * column onto a second page at 100% (measured 2026-11-11 with Excel on the
 * owner's PC), and SheetJS cannot write page setup, so the XML is patched:
 * `<pageSetUpPr fitToPage>` last inside `<sheetPr>` (made when missing, first
 * in the sheet) and `<pageSetup>` right after `<pageMargins>`, both once.
 */
export function fitToPageXml(xml: string): string {
  let out = xml;
  if (!out.includes("<pageSetUpPr")) {
    if (/<sheetPr\b[^>]*\/>/.test(out)) out = out.replace(/<sheetPr\b([^>]*)\/>/, `<sheetPr$1>${FIT_PR}</sheetPr>`);
    else if (out.includes("</sheetPr>")) out = out.replace("</sheetPr>", `${FIT_PR}</sheetPr>`);
    else out = out.replace(/(<worksheet\b[^>]*>)/, `$1<sheetPr>${FIT_PR}</sheetPr>`);
  }
  if (!out.includes("<pageSetup ")) {
    if (/<pageMargins\b[^>]*\/>/.test(out)) out = out.replace(/(<pageMargins\b[^>]*\/>)/, `$1${PAGE_SETUP}`);
    else out = out.replace("</worksheet>", `<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>${PAGE_SETUP}</worksheet>`);
  }
  return out;
}

/** A written .xlsx with every worksheet set by `fitToPageXml`. */
export function withFitToPage(XLSX: Pick<XlsxLike, "CFB">, data: Uint8Array): Uint8Array {
  const cfb = XLSX.CFB.read(data, { type: "array" });
  cfb.FullPaths.forEach((path, i) => {
    if (!/xl\/worksheets\/sheet\d+\.xml$/.test(path)) return;
    const entry = cfb.FileIndex[i];
    const xml = new TextDecoder().decode(entry.content instanceof Uint8Array ? entry.content : new Uint8Array(entry.content));
    const next = fitToPageXml(xml);
    if (next === xml) return;
    entry.content = new TextEncoder().encode(next);
    entry.size = entry.content.length;
  });
  const out = XLSX.CFB.write(cfb, { fileType: "zip", type: "array" });
  return out instanceof Uint8Array ? out : new Uint8Array(out);
}

/**
 * "Repeat the header row at the top of every printed page" — Excel's
 * `_xlnm.Print_Titles`, one per sheet that has a header row (SheetJS writes
 * workbook defined names; it cannot write page setup).
 */
export function printTitleNames(sheets: { kinds: RowKind[] }[], names: string[]): { Name: string; Sheet: number; Ref: string }[] {
  const out: { Name: string; Sheet: number; Ref: string }[] = [];
  sheets.forEach((s, i) => {
    const h = s.kinds.indexOf("header");
    if (h < 0 || !names[i]) return;
    out.push({ Name: "_xlnm.Print_Titles", Sheet: i, Ref: `'${names[i].replace(/'/g, "''")}'!$${h + 1}:$${h + 1}` });
  });
  return out;
}

/** Several styled sheets in one workbook, downloaded as `filename`. */
export async function exportStyledWorkbookXlsx(filename: string, sheets: StyledSheet[]): Promise<void> {
  const mod = (await import("xlsx-js-style")) as unknown as XlsxLike & { default?: XlsxLike };
  const XLSX = mod.default ?? mod;
  const wb = XLSX.utils.book_new() as { Workbook?: { Names?: unknown[] } };
  const used = new Set<string>();
  const names: string[] = [];
  for (const s of sheets) {
    const name = safeSheetName(s.name, used);
    names.push(name);
    XLSX.utils.book_append_sheet(wb, buildStyledSheet(XLSX, s), name);
  }
  if (!sheets.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Nothing to export"]]), "Report");
  const titles = printTitleNames(sheets, names);
  if (titles.length) wb.Workbook = { ...(wb.Workbook ?? {}), Names: titles };
  const out = withFitToPage(XLSX, new Uint8Array(XLSX.write(wb, { bookType: "xlsx", type: "array" })));
  // A fresh ArrayBuffer-backed copy: Blob takes no SharedArrayBuffer view.
  downloadBlob(new Blob([new Uint8Array(out)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename);
}
