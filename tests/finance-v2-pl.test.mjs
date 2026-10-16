// ---------------------------------------------------------------------------
// finance-v2-pl.test.mjs — the P&L hub and statement in the v2 report shell
// (plan 2026-10-16-finance-v2-reports Task 5). One switch for the view and one
// for the product line on the title row (the three views share the line); the
// statement keeps its data call, figures and drag-to-reclassify, and gets the
// period stepper, Edit Layout, DETAIL L1–L4, one download (CSV kept until the
// owner decides), the amber negative-stock warning with View / Hide, the
// framed two-row-header table, and "Open In GL →" in the drill's total.
// Made-up figures only (the repo is public).
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { foldStatementRows } from "../src/lib/finance-reports.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const ui = read("src/pages/accounting/index.tsx");
const slice = (from, to = "\nfunction ") => { const a = ui.indexOf(from); return ui.slice(a, ui.indexOf(to, a + 10)); };
const hub = slice("function PlHubTab(");
const st = slice("function PLStatementTab(");
const panel = ui.slice(ui.indexOf("function PlDrillPanel("), ui.indexOf("function PLStatementTab("));
const css = read("src/styles/finance-v2.css");

test("the hub: view and product line on the title row, the line shared by the three views", () => {
  const bar = hub.slice(hub.indexOf("<FinanceTitleActions>"), hub.indexOf("</FinanceTitleActions>"));
  assert.match(bar, /<SegmentedSwitch label="P&L view" options=\{views\} value=\{view\} onChange=\{setView\} \/>/);
  assert.match(bar, /<SegmentedSwitch label="Product line" options=\{lines\} value=\{line\} onChange=\{setLine\} \/>/);
  assert.match(hub, /\{view === "statement" && <PLStatementTab line=\{line\} \/>\}/);
  assert.match(hub, /\{view === "monthly" && <MonthlyPlTab line=\{line\} \/>\}/);
  assert.match(hub, /\{view === "cost" && <CostStructureTab line=\{line\} \/>\}/);
  for (const fn of ["function PLStatementTab(", "function MonthlyPlTab(", "function CostStructureTab("]) {
    const body = slice(fn);
    assert.match(body, /^function \w+\(\{ line \}: \{ line: PlLine \}\) \{/, `${fn} takes the hub's line`);
    assert.doesNotMatch(body, /setLine\(/, `${fn} no longer switches the line itself`);
  }
});

test("the statement: same data call, the server's figures, drag-to-reclassify kept", () => {
  assert.match(st, /fetch\(`\/api\/accounting\/pl-statement\?period=\$\{period\}&line=\$\{line\}\$\{edit \? "&editable=1" : ""\}`\)/);
  assert.match(st, /const shown = foldStatementRows\(rows, collapsed\);/);
  assert.match(st, /const pct = \(v: number \| undefined\) => fmtPctOfSales\(v, net\);/);
  assert.match(st, /const amt = \(v: number \| undefined\) => \(v === undefined \? "" : v === 0 \? "-" : fmtAmt\(v\)\);/);
  assert.match(st, /void moveTo\(src, row\.bucket\)/, "Edit Layout still saves the section map");
  assert.match(st, /fetch\("\/api\/accounting\/pnl\/section-map", \{ method: "PUT"/);
});

test("folding: a folded group is one row; an open one is heading, rows, its own total line", () => {
  const rows = [
    { kind: "group", depth: 0, groupId: "g0", label: "SALES" },
    { kind: "line", depth: 1, label: "A" },
    { kind: "line", depth: 1, label: "B" },
    { kind: "gap", depth: 0, label: "" },
    { kind: "group", depth: 0, groupId: "g1", label: "COST" },
    { kind: "group", depth: 1, groupId: "g2", label: "RAW" },
    { kind: "line", depth: 2, label: "C" },
    { kind: "total", depth: 1, label: "MFG" },
    { kind: "grandtotal", depth: 0, label: "GP" },
  ];
  const lbl = (xs) => xs.map((x) => (x.close ? `/${x.row.label}` : x.row.label));
  assert.deepEqual(lbl(foldStatementRows(rows, new Set())), ["SALES", "A", "B", "/SALES", "", "COST", "RAW", "C", "/RAW", "MFG", "/COST", "GP"]);
  assert.deepEqual(lbl(foldStatementRows(rows, new Set(["g2"]))), ["SALES", "A", "B", "/SALES", "", "COST", "RAW", "MFG", "/COST", "GP"]);
  assert.deepEqual(lbl(foldStatementRows(rows, new Set(["g0", "g1"]))), ["SALES", "", "COST", "GP"]);
  // The close entry is the group itself: its figure is the server's.
  const open = foldStatementRows(rows, new Set());
  assert.equal(open[3].row, rows[0]);
});

test("an open group's figure sits on its total line (the design's statement)", () => {
  assert.match(st, /<td data-cell="stick" style=\{pad\}>\{row\.totalLabel \?\? `TOTAL \$\{row\.label\}`\}<\/td>/);
  assert.match(st, /<td data-cell="num split">\{isOpen \? "" : amt\(row\.ytdSen\)\}<\/td>/);
  assert.match(st, /data-row=\{grand \? "res" : "sub"\} data-fin-double=\{grand && row === lastGrand \? "" : undefined\}/, "Net Profit closes with the double line");
  assert.match(css, /tr\[data-row="res"\]\[data-fin-double\] > td \{\n  border-bottom: 3px double #1F1D1B;/);
});

test("periods: months, calendar quarters and years — the keys /pl-statement reads", () => {
  assert.match(st, /\.\.\.monthOptions\(today\.slice\(0, 7\), 18\),/);
  assert.match(st, /<PeriodStepper value=\{period\} options=\{periodOptions\} onChange=\{setPeriod\} today=\{today\} \/>/);
});

test("toolbar: Edit Layout, DETAIL L1–L4 (hidden while editing), one download with CSV kept", () => {
  assert.match(st, /<EditLayoutToggle on=\{edit\}/);
  assert.match(st, /\{!edit && <DetailLevels levels=\{\[1, 2, 3, 4\]\} value=\{level\} onChange=\{\(L\) => applyLevel\(rows, L\)\} \/>\}/);
  for (const l of ["Export to Excel", "Print / PDF", "Export to CSV"]) assert.ok(st.includes(`label: "${l}"`), l);
  assert.match(st, /<EditLayoutBanner>/);
});

test("the amber negative-stock warning opens with View and closes with Hide", () => {
  assert.match(st, /border-\[#E8D597\] bg-\[#FAEFCB\]/);
  assert.match(st, /\{showMatWarnings \? "Hide" : "View"\}/);
  assert.match(st, /material cost may be understated\./);
});

test("the frame and the two-row header (period over RM | %), first column frozen", () => {
  assert.match(st, /company=\{PL_COMPANY\}/);
  assert.match(ui, /const PL_COMPANY = "HOOKKA MANUFACTURING SDN BHD";/, "the printed name stays until the owner confirms the legal name");
  assert.match(st, /maxHeight="calc\(100vh - 300px\)"/);
  assert.match(st, /<th rowSpan=\{2\} data-cell="stick" className="min-w-\[280px\]">Item<\/th>/);
  assert.match(st, /<tr data-row="h2">/);
  assert.match(css, /tr\[data-row="h2"\] > th \{\n  top: 34px;/);
  assert.match(css, /tr\[data-row="h1"\] > th \{\n  height: 34px;/);
});

test("the drill's total opens the General Ledger for the same months (account lines only)", () => {
  assert.match(panel, /const glRange = \/\^\\d\{3\}-\/\.test\(account\) \? periodMonths\(period\) : null;/);
  assert.match(panel, /\{glRange && <Link to=\{glHref\(account, glRange\[0\], glRange\[1\]\)\} className="ml-3 text-\[#6B5C32\] hover:text-\[#574A28\]">Open In GL →<\/Link>\}/);
  assert.match(panel, /bg-\[#E8EDF2\]/, "the drill total in the v2 detail-total colour");
});
