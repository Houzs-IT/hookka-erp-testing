// ---------------------------------------------------------------------------
// grid-copy-sum-url.test.mjs — DataGrid copy (TSV), range-sum and URL filters.
// Owner-approved item 23, 2026-11-08.
// Run: node --import tsx/esm --test tests/grid-copy-sum-url.test.mjs
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  rectFrom, rectContains, rectCellCount, tsvField, toTsv, rangeToTsv, rowsToTsv, rangeStats, browserOwnsCopy,
} from "../src/lib/grid-clipboard.ts";
import {
  readGridUrlState, writeGridUrlState, hasGridUrlState, sameParams, gridSearchParam,
} from "../src/lib/grid-url-state.ts";

const COLS = [
  { key: "__select__", label: "" },
  { key: "doc", label: "Doc No.", type: "docno" },
  { key: "name", label: "Customer" },
  { key: "qty", label: "Qty", type: "number" },
  { key: "amt", label: "Amount", type: "currency" },
  { key: "date", label: "Date", type: "date" },
];
const ROWS = [
  { doc: "SO-1", name: "Ivory\tSand", qty: 2, amt: 12345, date: "2026-11-08T10:00:00Z" },
  { doc: "SO-2", name: 'He said "hi"', qty: 3, amt: 50, date: "2026-11-09" },
  { doc: "SO-3", name: "Plain", qty: 5, amt: 1, date: "2026-11-10" },
];

// ── rectangles ────────────────────────────────────────────────────────────
test("rectFrom normalises any two corners", () => {
  assert.deepEqual(rectFrom({ row: 3, col: 1 }, { row: 0, col: 4 }), { r0: 0, r1: 3, c0: 1, c1: 4 });
  const r = rectFrom({ row: 1, col: 1 }, { row: 2, col: 3 });
  assert.equal(rectCellCount(r), 6);
  assert.equal(rectContains(r, 2, 3), true);
  assert.equal(rectContains(r, 0, 1), false);
  assert.equal(rectContains(null, 0, 0), false);
  assert.equal(rectCellCount(null), 0);
});

// ── TSV ───────────────────────────────────────────────────────────────────
test("tsvField quotes only tab / newline / quote, Excel-style", () => {
  assert.equal(tsvField("plain"), "plain");
  assert.equal(tsvField("a\tb"), '"a\tb"');
  assert.equal(tsvField("line1\nline2"), '"line1\nline2"');
  assert.equal(tsvField('say "x"'), '"say ""x"""');
  assert.equal(tsvField(null), "");
  assert.equal(tsvField(12.5), "12.5");
  assert.equal(toTsv([["a", 1], ["b", 2]]), "a\t1\r\nb\t2");
});

test("rangeToTsv: money as RM number, dates as the day, escaped text", () => {
  // rows 0-1, columns Customer..Date (indices 2..5)
  const tsv = rangeToTsv(ROWS, COLS, rectFrom({ row: 0, col: 2 }, { row: 1, col: 5 }));
  assert.equal(tsv, '"Ivory\tSand"\t2\t123.45\t2026-11-08\r\n"He said ""hi"""\t3\t0.5\t2026-11-09');
});

test("rowsToTsv: header row then one line per row; skips the select gutter", () => {
  const tsv = rowsToTsv([ROWS[2]], COLS);
  assert.equal(tsv, "Doc No.\tCustomer\tQty\tAmount\tDate\r\nSO-3\tPlain\t5\t0.01\t2026-11-10");
});

// ── range-sum ─────────────────────────────────────────────────────────────
test("rangeStats: money sums in sen (formatted as RM by the grid)", () => {
  const s = rangeStats(ROWS, COLS, rectFrom({ row: 0, col: 4 }, { row: 2, col: 4 }));
  assert.deepEqual(s, { count: 3, money: true, sum: 12396, avg: 4132 });
});

test("rangeStats: plain numbers; text / docno / date cells are not counted", () => {
  const s = rangeStats(ROWS, COLS, rectFrom({ row: 0, col: 1 }, { row: 2, col: 3 }));
  assert.deepEqual(s, { count: 3, money: false, sum: 10, avg: 10 / 3 });
});

test("rangeStats: mixed money + number → plain units, money=false", () => {
  const s = rangeStats(ROWS, COLS, rectFrom({ row: 0, col: 3 }, { row: 0, col: 4 }));
  assert.equal(s.money, false);
  assert.equal(s.count, 2);
  assert.ok(Math.abs(s.sum - (2 + 123.45)) < 1e-9);
});

test("rangeStats: fewer than 2 numeric cells → no readout", () => {
  assert.equal(rangeStats(ROWS, COLS, rectFrom({ row: 0, col: 4 }, { row: 0, col: 4 })), null);
  assert.equal(rangeStats(ROWS, COLS, rectFrom({ row: 0, col: 1 }, { row: 2, col: 2 })), null);
});

test("browserOwnsCopy: inputs and highlighted text keep the native copy", () => {
  assert.equal(browserOwnsCopy({ tagName: "INPUT" }, ""), true);
  assert.equal(browserOwnsCopy({ tagName: "TEXTAREA" }, ""), true);
  assert.equal(browserOwnsCopy({ tagName: "DIV", isContentEditable: true }, ""), true);
  assert.equal(browserOwnsCopy({ tagName: "BODY" }, "some text"), true);
  assert.equal(browserOwnsCopy({ tagName: "BODY" }, ""), false);
  assert.equal(browserOwnsCopy(null, ""), false);
});

// ── URL state ─────────────────────────────────────────────────────────────
test("URL state round-trips search + text filters under the gridId namespace", () => {
  const base = new URLSearchParams("tab=open&page=2&other.q=keep");
  const next = writeGridUrlState(base, "sales-orders", { search: "ivory 151", columnFilters: { customer: "houzs", status: "" } });
  assert.equal(next.get("tab"), "open");
  assert.equal(next.get("page"), "2");
  assert.equal(next.get("other.q"), "keep", "another grid's keys are untouched");
  assert.equal(next.get(gridSearchParam("sales-orders")), "ivory 151");
  assert.equal(next.get("sales-orders.f.customer"), "houzs");
  assert.equal(next.has("sales-orders.f.status"), false, "blank filters are not written");
  assert.deepEqual(readGridUrlState(next, "sales-orders"), { search: "ivory 151", columnFilters: { customer: "houzs" }, sort: null });
  assert.equal(hasGridUrlState(next, "sales-orders"), true);
});

test("clearing the search / filters removes the keys", () => {
  const withState = new URLSearchParams("g.q=x&g.f.a=1&tab=t");
  const cleared = writeGridUrlState(withState, "g", { search: "  ", columnFilters: {} });
  assert.equal(cleared.toString(), "tab=t");
  assert.equal(hasGridUrlState(cleared, "g"), false);
  assert.deepEqual(readGridUrlState(new URLSearchParams(""), "g"), { search: "", columnFilters: {}, sort: null });
});

test("sameParams ignores key order (no-op writes are skipped)", () => {
  assert.equal(sameParams(new URLSearchParams("a=1&b=2"), new URLSearchParams("b=2&a=1")), true);
  assert.equal(sameParams(new URLSearchParams("a=1"), new URLSearchParams("a=2")), false);
});

// ── wiring in the shared grid ─────────────────────────────────────────────
test("DataGrid wires copy, range-sum and URL filters, all opt-out-able", () => {
  const src = readFileSync("src/components/ui/data-grid.tsx", "utf8");
  assert.match(src, /cellCopy\?: boolean;/);
  assert.match(src, /urlFilters\?: boolean;/);
  assert.match(src, /cellCopy = true,/);
  // URL sync is ON for every grid with a gridId since 2026-11-10 (review G2):
  // the grids that manage their own search were exactly the big paged lists.
  assert.match(src, /const urlSyncOn = !!gridId && \(urlFilters \?\? true\);/);
  assert.match(src, /useSearchParams\(\)/);
  assert.match(src, /setSearchParamsRef\.current\(next, \{ replace: true, preventScrollReset: true \}\)/);
  assert.match(src, /data-dg-col=\{colIdx\}/);
  assert.match(src, /data-dg="range-sum"/);
  assert.match(src, /browserOwnsCopy\(document\.activeElement/);
  // The stale-range guard: a range only applies to the array it was made on.
  assert.match(src, /cellSel\.data === displayedData \? cellSel\.rect : null/);
});

test("Shift+click row range reads its anchor before queuing the update", () => {
  // Regression found in the harness 2026-11-08: with setCellSel queued first,
  // React ran the setSelectedKeys updater lazily, after lastClickedIndex had
  // moved, and Shift+click selected only the end row.
  const src = readFileSync("src/components/ui/data-grid.tsx", "utf8");
  assert.match(src, /const anchorIndex = lastClickedIndex\.current;\s*setSelectedKeys\(prev => \{/);
  assert.match(src, /if \(e\.shiftKey && anchorIndex !== null\) \{/);
});
