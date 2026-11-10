// ---------------------------------------------------------------------------
// finance-tables-drills.test.mjs — finance plan batch 4 (owner 2026-10-01):
//   · finance tables never wrap; a column's header edge drags — only that
//     column changes, the rest move with it; widths remembered; reports
//     resize the description column only and stop stretching;
//   · Monthly P&L and Cash Flow open a row's entries UNDER it, each amount in
//     its month's column (and Accumulated), the last row counting them with
//     each month's subtotal and a link into the General Ledger.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
try { register("tsx/esm", pathToFileURL("./")); } catch { /* native strip */ }
const rt = await import(pathToFileURL(resolve(process.cwd(), "src/lib/use-resizable-tables.ts")).href);

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const ui = read("src/pages/accounting/index.tsx");
const api = read("src/api/routes/accounting.ts");
const lib = read("src/lib/use-resizable-tables.ts");
const slice = (src, from, to) => { const a = src.indexOf(from); assert.notEqual(a, -1, from); const b = src.indexOf(to, a + 1); assert.notEqual(b, -1, to); return src.slice(a, b); };

test("columns: a spanning header cell counts each real column; its edge is the last one it covers", () => {
  assert.equal(rt.columnCount([1, 1, 1]), 3);
  // A Monthly P&L header: Item, then each month over RM + %.
  assert.equal(rt.columnCount([1, 2, 2, 2]), 7);
  assert.deepEqual(rt.edgeColumns([1, 2, 2, 2]), [0, 2, 4, 6]);
  // Fractional measured widths round UP — rounding down cut a column that fitted exactly (prod 2026-10-01).
  assert.equal(rt.sumWidths([82.4, 100, 102.3]), 286);
});

test("widths are kept per page/tab and header; a report by its description column only", () => {
  assert.equal(rt.colWidthKey("accounting:payments", "", ["Date", "No.", "Payee"], false), "accounting:payments||Date|No.|Payee");
  assert.equal(rt.colWidthKey("accounting:plmonthly", "", ["Item", "Accumulated", "Sep 2026"], true), "accounting:plmonthly||first|Item", "new months do not lose the width");
});

test("a report lays out again when its columns come or go, keeping the dragged description width (BUG-2026-11-10-462)", () => {
  // Prod 2026-11-10, owner's screenshot: Cash Flow with a dragged Item width, Forecast pressed —
  // 5 columns became 35, the colgroup stayed pinned to 5 and the other 30 shrank to nothing.
  const actualHeads = ["Item", "Accumulated", "Nov'26", "Oct'26", "Sep'26"];
  const forecastHeads = ["Item", "Accumulated", "Nov'27", "Oct'27", "Nov'26", "Oct'26", "Sep'26"];
  const key = rt.colWidthKey("accounting:cashflow", "", actualHeads, true);
  assert.equal(rt.colWidthKey("accounting:cashflow", "", forecastHeads, true), key, "the dragged Item width is still found");
  assert.notEqual(
    rt.colLayoutSig(key, forecastHeads, [1, 1, 2, 2, 3, 3, 3]),
    rt.colLayoutSig(key, actualHeads, [1, 1, 1, 1, 1]),
    "Forecast on: the columns changed, so the table is laid out again",
  );
  assert.notEqual(rt.colLayoutSig(key, ["Item", "Nov'26"], [1, 2]), rt.colLayoutSig(key, ["Item", "Nov'26"], [1, 3]), "a month gaining a column is a new layout");
  assert.equal(rt.colLayoutSig(key, ["Item", "Nov'26"], [1, 2]), rt.colLayoutSig(key, ["Item", "Nov'26"], [1, 2]), "the same header keeps its layout");
  // The enhancer compares the layout, never the width key alone.
  assert.match(lib, /const sig = colLayoutSig\(key, cells\.map\(cellText\), spans\);\n  if \(t\.dataset\.colSig !== sig\) \{/);
  assert.doesNotMatch(lib, /t\.dataset\.colSig = key;/, "the width key is not the layout");
});

test("the enhancer: one column changes, the table is the sum of its columns, a colgroup pins them", () => {
  assert.match(lib, /t\.style\.tableLayout = "fixed";\n  t\.style\.width = `\$\{sumWidths\(widths\)\}px`;\n  t\.style\.minWidth = t\.hasAttribute\("data-fin-report"\) \? "0" : "100%";/, "a list never ends short of its box (owner 2026-10-21); a report keeps to its columns");
  assert.match(lib, /widths\[col\] = Math\.max\(MIN_W, startW \+ ev\.clientX - startX\);/);
  assert.match(lib, /style\.width = `\$\{Math\.ceil\(w\)\}px`/, "pinned widths round up");
  assert.doesNotMatch(lib, /requestAnimationFrame\(/, "a background tab still gets its handles");
  assert.match(lib, /cg\.dataset\.finCols = "1";/, "its own colgroup, marked");
  assert.match(lib, /if \(mode === "off" \|\| t\.querySelector\(":scope > colgroup:not\(\[data-fin-cols\]\)"\)\) return;/, "DataGrid (own colgroup) is left alone");
  assert.match(lib, /writeWidths\(keyOf\(scope, t, firstOnly\), firstOnly \? \[widths\[0\]\] : widths\);/, "remembered");
  assert.match(lib, /\[data-fin-tables\] table th, \[data-fin-tables\] table td \{ white-space: nowrap; \}/, "no wrapping");
  assert.match(lib, /h\.addEventListener\("dblclick"/, "double-click goes back to automatic widths");
});

test("the finance pages carry it; reports resize the description only and stop stretching", () => {
  assert.match(ui, /const tablesRef = useResizableTables\(`accounting:\$\{tab\}`\);\n\n  return \(\n    <div ref=\{tablesRef\} data-fin-tables/);
  for (const p of ["src/pages/invoices/supplier-payments.tsx", "src/pages/invoices/payments.tsx", "src/pages/invoices/e-invoice.tsx"]) {
    const src = read(p);
    assert.match(src, /const tablesRef = useResizableTables\("[a-z-]+"\);\n\n  if \(loading\) \{/, `${p}: hooked before the loading screen`);
    assert.match(src, /<div ref=\{tablesRef\} data-fin-tables className=/, `${p}: root marked`);
  }
  assert.equal((ui.match(/<table data-col-resize="first"/g) ?? []).length, 8, "P&L, Monthly P&L, Cost structure, Cost classes, Monthly trend, TB, Balance sheet, Cash Flow");
  assert.doesNotMatch(slice(ui, "function MonthlyPlTab(", "\nfunction "), /min-w-full/, "Monthly P&L no longer stretched to the full width");
  assert.doesNotMatch(slice(ui, "function CashFlowTab(", "\n}\n"), /minWidth: 760/);
});

test("Monthly P&L: a row's ledger lines under it, in their month's column; the last row ties and opens the GL", () => {
  const ep = slice(api, 'app.get("/pl-drill"', 'app.get("/bs-drill"');
  assert.match(ep, /const startYm = ranged \? fromQ : periodStartYm\(period\);/, "a run of months (the financial year)");
  assert.match(ep, /openingMonth,\n\s+lines,/, "months before the opening are from the old books");
  const tab = slice(ui, "function MonthlyPlTab(", "\nfunction ");
  assert.match(tab, /const drillCode = r\.kind === "line" \? \(r\.drillCode \?\? r\.accountCode\) : undefined;/);
  // Since 2026-11-10 the drill gets the columns on screen and their values (Hide past months).
  assert.match(tab, /<PlMonthlyDrillRows account=\{drillCode\} cols=\{visCols\} line=\{line\} rowValues=\{vis\.map\(\(\[, j\]\) => r\.values\[j\] \?\? 0\)\} depth=\{r\.depth\} \/>/);
  const rows = slice(ui, "function PlMonthlyDrillRows(", "\nfunction ");
  assert.match(rows, /fetch\(`\/api\/accounting\/pl-drill\?account=\$\{encodeURIComponent\(account\)\}&from=\$\{from\}&to=\$\{to\}`\)/);
  assert.match(rows, /\$\{l\.description \|\| "—"\}\$\{l\.ref2 \? ` · \$\{l\.ref2\}` : ""\} — \$\{l\.ref1\}/, "date · description · who — document no.");
  assert.match(rows, /const on = !c\.forecast && \(c\.accum \|\| c\.key === e\.ym\);/, "the amount in its month and in Accumulated, never in a forecast column (2026-11-09)");
  assert.match(rows, /const tied = line !== "all" \|\| cols\.every\(/, "each month's lines make the row");
  // Finance v2: "Open In GL →", only where the row is one account (a material
  // group's PURCHASE line has no single ledger).
  assert.match(rows, /\{glOk && <> · <Link to=\{glHref\(account, from, to\)\} className="text-\[#6B5C32\] hover:text-\[#574A28\]">Open In GL →<\/Link><\/>\}/);
  assert.match(rows, /const glOk = \/\^\\d\{3\}-\/\.test\(account\);/);
  // Computed lines that are one account's figure open too (as on the statement).
  const mx = read("src/lib/pnl-matrix.ts");
  // One level deeper under a material type when the forecast is on (2026-11-09).
  assert.match(mx, /line\("PURCHASE", depth \+ 1, \(w\) => find\(w\)\?\.purchasesSen \?\? 0, undefined, rg\.group\);/);
  // The trailing "700-1015" (2026-11-10) is the line's forecast key (fcKey), for the Edit forecast.
  assert.match(mx, /line\("CARRIAGE INWARDS", 1, \(w\) => w\.carriageSen, undefined, "700-1015", "700-1015"\);/);
});

test("the General Ledger opens from a drill's link with the account and dates picked", () => {
  const gl = slice(ui, "function GeneralLedgerTab(", "\nfunction ");
  assert.match(gl, /useState<string\[\]>\(\(\) => \{ const a = new URLSearchParams\(window\.location\.search\)\.get\("account"\); return a \? \[a\] : \[\]; \}\)/);
  assert.match(gl, /useState\(\(\) => new URLSearchParams\(window\.location\.search\)\.get\("from"\) \?\? ""\)/);
  // The link runs to the last day of the drill's last month, through the shared
  // helper the Trial Balance double-click uses too.
  assert.match(ui, /const glHref = \(account: string, fromYm: string, toYm: string\) =>\n  glLink\(\{ account, fromYm, toDate: monthEnd\(toYm\) \}\);/);
  const lib = read("src/lib/finance-reports.ts");
  assert.match(lib, /return `\/accounting\?tab=gl&account=\$\{encodeURIComponent\(o\.account\)\}&from=\$\{o\.fromYm\}-01&to=\$\{o\.toDate\}`;/);
});

test("a report narrower than its card closes on the right; a list fills its box (owner 2026-10-21)", () => {
  const css = read("src/styles/finance-v2.css");
  assert.match(css, /table\[data-fin-report\]\[data-fin-fit\] > thead > tr > th:last-child,\n\[data-fin-ui\] table\[data-fin-report\]\[data-colw\] > thead > tr > th:last-child \{\n  border-right: 1px solid #CBD5E1;/);
  assert.match(css, /table\[data-fin-report\]\[data-colw\] > tfoot > tr > td:last-child \{\n  border-right: 1px solid #E7E1D8;/);
});
