// run-print.ts — hand a PrintDoc (menu-prints.ts) to the shared desktop `printReport`. Call it straight from the menu tap so the
// print window is allowed to open. Nothing here decides content.
import { buildReportHTML, printReport, type PrintColumn, type PrintReportOptions } from "@/lib/print-report";
import type { PrintCell, PrintDoc } from "./menu-prints";

function toOptions(doc: PrintDoc): PrintReportOptions {
  return {
    title: doc.title,
    subtitle: doc.subtitle,
    filterSummary: doc.filterSummary,
    orientation: doc.orientation,
    dense: doc.dense,
    cards: doc.cards.length ? doc.cards : undefined,
    sections: doc.sections.map((s) => {
      const columns: PrintColumn[] = s.columns.map((c, i) => ({ header: c.header, align: c.align, width: c.width, value: (r: unknown) => (r as PrintCell[])[i] }));
      return { title: s.title, note: s.note, columns, rows: s.rows, emptyText: s.emptyText };
    }),
  };
}

export function runPrintDoc(doc: PrintDoc): void {
  printReport(toOptions(doc));
}

/**
 * Print into a window the caller already opened INSIDE the tap, once the data is ready. For a report whose data is fetched only
 * after the tap (Department Performance): a phone browser blocks a window opened after an await, so the tap opens it, the window
 * shows `waitingHtml`, and this fills and prints it. Same document and print step as `printReport`.
 */
export function printDocInto(win: Window, doc: PrintDoc): void {
  win.document.open();
  win.document.write(buildReportHTML(toOptions(doc)));
  win.document.close();
  win.focus();
  // eslint-disable-next-line no-restricted-syntax -- non-React utility called from an event handler (same as printReport)
  setTimeout(() => win.print(), 500);
}

export function showInWindow(win: Window, message: string): void {
  win.document.open();
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Report</title></head><body style="font-family:system-ui;padding:24px;color:#1F1D1B">${message}</body></html>`);
  win.document.close();
}
