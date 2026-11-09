// ---------------------------------------------------------------------------
// grid-clipboard — copy + range-sum for the shared DataGrid (pure, tested).
//
// Owner-approved item 23 (2026-11-08):
//   * Click a cell, Shift+click another → a rectangular CELL RANGE. Ctrl/Cmd+C
//     copies it as tab-separated text, which pastes into Excel cell-for-cell.
//     With no cell range but rows selected, Ctrl/Cmd+C copies those rows
//     (visible columns, header first).
//   * When a range holds several numeric cells, a small "Sum / Count / Avg"
//     readout appears in the footer. Money columns (sen) are summed in sen and
//     shown as RM.
//
// Cell values come from grid-export's `cellExportValue` — the same value the
// Excel export writes (money as a RM number, dates as the day), so a copy and
// an export of the same cells agree.
// ---------------------------------------------------------------------------
import { cellExportValue, type ExportColumn } from "./grid-export";

export type CellPos = { row: number; col: number };
export type CellRect = { r0: number; r1: number; c0: number; c1: number };

/** Normalised rectangle spanned by two corners (inclusive). */
export function rectFrom(a: CellPos, b: CellPos): CellRect {
  return {
    r0: Math.min(a.row, b.row),
    r1: Math.max(a.row, b.row),
    c0: Math.min(a.col, b.col),
    c1: Math.max(a.col, b.col),
  };
}

export function rectContains(r: CellRect | null, row: number, col: number): boolean {
  return !!r && row >= r.r0 && row <= r.r1 && col >= r.c0 && col <= r.c1;
}

export function rectCellCount(r: CellRect | null): number {
  return r ? (r.r1 - r.r0 + 1) * (r.c1 - r.c0 + 1) : 0;
}

/**
 * One TSV field. Excel's own clipboard rule: a value containing a tab, a line
 * break or a double quote is wrapped in quotes with inner quotes doubled;
 * anything else goes through bare.
 */
export function tsvField(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[\t\n\r"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows of values → tab-separated text, CRLF between rows (what Excel emits). */
export function toTsv(rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  return rows.map((r) => r.map(tsvField).join("\t")).join("\r\n");
}

const SKIP_KEYS = new Set(["__select__", "__actions__"]);

/** The TSV for a cell rectangle over `rows` × `columns` (display order). */
export function rangeToTsv<T>(rows: readonly T[], columns: readonly ExportColumn<T>[], rect: CellRect): string {
  const out: Array<Array<string | number>> = [];
  for (let r = rect.r0; r <= rect.r1 && r < rows.length; r++) {
    const line: Array<string | number> = [];
    for (let c = rect.c0; c <= rect.c1 && c < columns.length; c++) {
      line.push(cellExportValue(columns[c], rows[r]));
    }
    out.push(line);
  }
  return toTsv(out);
}

/** The TSV for whole rows: header row of labels, then one line per row. */
export function rowsToTsv<T>(rows: readonly T[], columns: readonly (ExportColumn<T>)[]): string {
  const cols = columns.filter((c) => !SKIP_KEYS.has(c.key));
  return toTsv([cols.map((c) => c.label), ...rows.map((r) => cols.map((c) => cellExportValue(c, r)))]);
}

export type RangeStats = {
  count: number;
  /** True when every counted cell is a money column — sum/avg are then sen. */
  money: boolean;
  /** Sen when `money`, else plain units. */
  sum: number;
  avg: number;
};

/**
 * Sum / Count / Avg over the numeric cells of a rectangle. Only `currency`
 * and `number` columns count (a numeric-looking doc no. is not summed).
 * Money is summed in integer sen; a mix of money and plain numbers is summed
 * in plain units (RM for the money cells) and reported with money=false.
 * Returns null when fewer than 2 numeric cells are in range.
 */
export function rangeStats<T>(rows: readonly T[], columns: readonly ExportColumn<T>[], rect: CellRect): RangeStats | null {
  let count = 0;
  let sumSen = 0;
  let sumPlain = 0; // money contributes RM here, so a mixed range still adds up
  let allMoney = true;
  for (let r = rect.r0; r <= rect.r1 && r < rows.length; r++) {
    for (let c = rect.c0; c <= rect.c1 && c < columns.length; c++) {
      const col = columns[c];
      if (col.type !== "currency" && col.type !== "number") continue;
      const v = cellExportValue(col, rows[r]);
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      count++;
      if (col.type === "currency") {
        const sen = Math.round(v * 100);
        sumSen += sen;
        sumPlain += sen / 100;
      } else {
        allMoney = false;
        sumPlain += v;
      }
    }
  }
  if (count < 2) return null;
  if (allMoney) return { count, money: true, sum: sumSen, avg: Math.round(sumSen / count) };
  return { count, money: false, sum: sumPlain, avg: sumPlain / count };
}

/**
 * True when a Ctrl/Cmd+C should be left to the browser: focus is in an
 * editable control, or the user has highlighted text with the mouse.
 */
export function browserOwnsCopy(active: Element | null, selectedText: string): boolean {
  if (selectedText.trim().length > 0) return true;
  if (!active) return false;
  const tag = active.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return (active as HTMLElement).isContentEditable === true;
}

/**
 * Put text on the clipboard. Async Clipboard API first; falls back to a
 * hidden <textarea> + execCommand("copy") for browsers / contexts that block
 * it. Resolves false only when both fail. (Browser-only; not unit-tested.)
 */
export async function writeClipboardText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the textarea path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
