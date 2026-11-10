// ---------------------------------------------------------------------------
// grid-common-features.test.mjs — the common list / grid features from the
// 2026-11-10 cross-system review, section 2b (G1, G2, G3, G4, G7).
//
// G1  header right-click menu + header drag-reorder on EVERY gridId grid
//     (was opt-in, switched on in 6 finance pages only).
// G2  search, column text filters AND the header sort mirrored into the URL on
//     every gridId grid (was skipped on the grids that manage their own search
//     — exactly the big paged lists), so Back / refresh / a shared link keep it.
//
// Pure helpers are exercised directly; the wiring is pinned by source pattern
// (house style, see tests/fe-quality-batch-a.test.mjs).
// Run: node --import tsx/esm --test tests/grid-common-features.test.mjs
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  parseGridSort,
  readGridUrlState,
  writeGridUrlState,
  hasGridUrlState,
} from "../src/lib/grid-url-state.ts";
import {
  columnViewActive,
  columnTotals,
  isCancelledStatusRow,
  splitForTotals,
  totalFooterText,
} from "../src/lib/grid-layout.ts";
import { listLoadError } from "../src/lib/list-load-error.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const GRID = read("src/components/ui/data-grid.tsx");

// ── G1 ────────────────────────────────────────────────────────────────────
test("G1: header menu and header drag default ON for a grid with a gridId", () => {
  assert.match(GRID, /const headerMenu = headerMenuProp \?\? !!gridId;/);
  assert.match(GRID, /const reorderableHeaders = reorderableHeadersProp \?\? !!gridId;/);
  // The header cells read the resolved values.
  assert.match(GRID, /onContextMenu=\{headerMenu \? \(e\) => openHeaderMenu\(e, col\.key\) : undefined\}/);
  assert.match(GRID, /draggable=\{reorderableHeaders \|\| undefined\}/);
});

test("G1: a default-on grid keeps its toolbar Export; only an explicit headerMenu hides it", () => {
  // The main lists carry Detail Listing / fetchAllRows on the toolbar Export.
  assert.match(GRID, /\{exportName && !headerMenuProp && \(/);
});

test("G1: the header menu's Export / Print covers every matching row on a paged grid", () => {
  const at = GRID.indexOf("const runExport = async (kind");
  assert.ok(at >= 0, "runExport is async");
  const fn = GRID.slice(at, GRID.indexOf("const saveUserDefault", at));
  assert.match(fn, /if \(fetchAllRows\) \{/);
  assert.match(fn, /rows = sortRows\(filterRows\(await fetchAllRows\(\)\)\);/);
  assert.match(fn, /exportSheet\(rows\)/);
});

// The main list pages the review names. Each must give its grid a gridId —
// that is what switches G1 + G2 on. Leads and Products have no DataGrid (hand-
// rolled tables), so they are not here; see docs/WORK-TRACKER.md.
const MAIN_LISTS = [
  ["src/pages/sales/index.tsx", "sales-orders-list"],
  ["src/pages/procurement/index.tsx", "purchase-orders-list"],
  ["src/pages/procurement/grn.tsx", "goods-receipts-list"],
  ["src/pages/procurement/pi.tsx", "purchase-invoices-list"],
  ["src/pages/invoices/index.tsx", "invoices-list"],
  ["src/pages/delivery/index.tsx", "delivery-orders-list"],
  ["src/pages/consignment/index.tsx", "consignment-orders-list"],
  ["src/pages/consignment/note.tsx", "consignment-notes-list"],
  ["src/pages/consignment/return.tsx", "consignment-returns-list"],
  ["src/pages/customers.tsx", "customers"],
  ["src/pages/procurement/maintenance.tsx", "supplier-info"],
  ["src/pages/inventory/index.tsx", "inventory-rm"],
  ["src/pages/inventory/index.tsx", "inventory-fg"],
  ["src/pages/service-cases/index.tsx", "service-cases"],
  ["src/pages/employees.tsx", "employees-master"],
];
for (const [file, id] of MAIN_LISTS) {
  test(`G1/G2: ${file} names gridId="${id}" and does not opt out`, () => {
    const src = read(file);
    assert.match(src, new RegExp(`gridId="${id}"`));
    assert.doesNotMatch(src, /headerMenu=\{false\}|reorderableHeaders=\{false\}|urlFilters=\{false\}/);
  });
}
test("G1/G2: the production department grids name a gridId", () => {
  assert.match(read("src/pages/production/index.tsx"), /gridId=\{`production-dept-\$\{activeDept\.code\.toLowerCase\(\)\}`\}/);
});

// ── G2 ────────────────────────────────────────────────────────────────────
test("G2: URL sync is on for every gridId grid, and carries the sort", () => {
  assert.match(GRID, /const urlSyncOn = !!gridId && \(urlFilters \?\? true\);/);
  assert.match(GRID, /useState<string \| null>\(urlSeed\?\.sort\?\.key \?\? null\)/);
  assert.match(GRID, /sort: sortKey \? \{ key: sortKey, dir: sortDir \} : null,/);
  assert.match(GRID, /\[urlSyncOn, gridId, searchText, columnFilters, sortKey, sortDir\]/);
});

test("G2: a page's empty initialSearch no longer hides the URL search", () => {
  // Invoices / CN / DO seed `initialSearch` from page state that starts "" —
  // under `??` that empty string beat the URL, so a reload lost the search.
  assert.match(GRID, /initialSearch \|\| urlSeed\?\.search \|\| \(initialSearch === undefined \? seeded\?\.searchText \?\? "" : ""\)/);
});

test("parseGridSort splits on the LAST colon and rejects junk", () => {
  assert.deepEqual(parseGridSort("totalSen:desc"), { key: "totalSen", dir: "desc" });
  assert.deepEqual(parseGridSort("customer.name:asc"), { key: "customer.name", dir: "asc" });
  assert.deepEqual(parseGridSort("a:b:asc"), { key: "a:b", dir: "asc" });
  assert.equal(parseGridSort("totalSen"), null);
  assert.equal(parseGridSort(":asc"), null);
  assert.equal(parseGridSort("x:sideways"), null);
  assert.equal(parseGridSort(""), null);
  assert.equal(parseGridSort(null), null);
});

test("the sort round-trips through the URL beside the page's own keys", () => {
  const start = new URLSearchParams("tab=CONFIRMED&page=2");
  const written = writeGridUrlState(start, "so", {
    search: "ivory",
    columnFilters: { customerName: "acme" },
    sort: { key: "totalSen", dir: "desc" },
  });
  assert.equal(written.get("so.s"), "totalSen:desc");
  assert.equal(written.get("tab"), "CONFIRMED");
  assert.equal(written.get("page"), "2");
  assert.deepEqual(readGridUrlState(written, "so"), {
    search: "ivory",
    columnFilters: { customerName: "acme" },
    sort: { key: "totalSen", dir: "desc" },
  });
  // Clearing the sort removes the key; a sort alone counts as state.
  const cleared = writeGridUrlState(written, "so", { search: "", columnFilters: {}, sort: null });
  assert.equal(cleared.has("so.s"), false);
  assert.equal(cleared.toString(), "tab=CONFIRMED&page=2");
  assert.equal(hasGridUrlState(new URLSearchParams("so.s=a:asc"), "so"), true);
  // Another grid's sort is left alone.
  const two = writeGridUrlState(new URLSearchParams("po.s=a:asc"), "so", { search: "", columnFilters: {}, sort: null });
  assert.equal(two.get("po.s"), "a:asc");
});

// ── G3 ────────────────────────────────────────────────────────────────────
// Verified 2026-11-10 by reading the code: SO / PO / GRN load one 200-row page
// and widened to the whole list only for their filter bar and search box;
// Invoices page server-side (#1216) for search + filter bar. The header sort,
// funnels and Group By are the grid's own and never reached the page, so on a
// list longer than one page they judged the loaded 200 rows only.
test("columnViewActive: sort, text filter, touched value filter or grouping", () => {
  const base = { sortKey: null, columnFilters: {}, valueFilterKeys: 0, valueFilterTouched: false, userGroupKey: null };
  assert.equal(columnViewActive(base), false);
  assert.equal(columnViewActive({ ...base, sortKey: "totalSen" }), true);
  assert.equal(columnViewActive({ ...base, columnFilters: { customerName: "acme" } }), true);
  assert.equal(columnViewActive({ ...base, columnFilters: { customerName: "" } }), false, "a cleared box is not a filter");
  // A page's own defaultExcludedValues (Sales hides shipped rows) is NOT the
  // operator narrowing — otherwise /sales would always fetch everything.
  assert.equal(columnViewActive({ ...base, valueFilterKeys: 1, valueFilterTouched: false }), false);
  assert.equal(columnViewActive({ ...base, valueFilterKeys: 1, valueFilterTouched: true }), true);
  assert.equal(columnViewActive({ ...base, userGroupKey: "status" }), true);
});

test("G3: DataGrid reports the column view and flags a partial page", () => {
  assert.match(GRID, /onColumnViewChange\?: \(active: boolean\) => void;/);
  assert.match(GRID, /onColumnViewChange\(colViewActive\);/);
  assert.match(GRID, /\}, \[colViewActive\]\);/, "fires on the boolean, not the callback identity");
  assert.match(GRID, /const partialView = colViewActive && totalRows !== undefined && totalRows > data\.length && !loading;/);
  assert.match(GRID, /Column sorting, filters and grouping cover the \{data\.length\.toLocaleString\(\)\} loaded rows of/);
  assert.match(GRID, /Load all \{totalRows!\.toLocaleString\(\)\}/);
});

for (const [file, flag] of [
  ["src/pages/sales/index.tsx", /_flCompany\[0\] \|\| gridColumnView \|\| gridSearch\.trim\(\) \|\|/],
  ["src/pages/procurement/index.tsx", /gridSearch\.trim\(\) \|\|\s*gridColumnView\s*\);/],
  ["src/pages/procurement/grn.tsx", /gridSearch\.trim\(\) \|\|\s*gridColumnView\s*\);/],
]) {
  test(`G3: ${file} widens to the whole list under a header sort / funnel`, () => {
    const src = read(file);
    assert.match(src, /const \[gridColumnView, setGridColumnView\] = useState\(false\);/);
    assert.match(src, flag);
    assert.match(src, /onColumnViewChange=\{setGridColumnView\}/);
  });
}

test("G3: Consignment Orders widens to every CO for search and header sort / funnels", () => {
  const src = read("src/pages/consignment/index.tsx");
  assert.match(src, /filterCategory \|\| filterDDFrom \|\| filterDDTo \|\| gridSearch\.trim\(\) \|\| gridColumnView/);
  assert.match(src, /onSearchChange=\{setGridSearch\}/);
  assert.match(src, /onColumnViewChange=\{setGridColumnView\}/);
});

test("G3: Invoices says it holds one page and can load every match", () => {
  const src = read("src/pages/invoices/index.tsx");
  assert.match(src, /totalRows=\{loadedAll \? undefined : totalInvoicesServer\}/);
  assert.match(src, /onLoadAll=\{\(\) => \{ void loadAllInvoices\(\); \}\}/);
  assert.match(src, /fetchAllPages<Invoice>\(`\/api\/invoices\?\$\{invoiceListQs\}`\)/);
  // The loaded set is tied to the response + query, so a refresh / new filter
  // drops back to paging instead of showing stale rows.
  assert.match(src, /allMatches\.resp === invResp && allMatches\.qs === invoiceListQs/);
  assert.match(src, /return \(loadedAll \?\? invoices\)\.filter/);
});

// ── G4 — footer totals that leave cancelled rows out ─────────────────────
test("isCancelledStatusRow: cancelled / voided, any case; everything else counts", () => {
  for (const s of ["CANCELLED", "cancelled", "Canceled", "VOID", "voided"]) assert.equal(isCancelledStatusRow({ status: s }), true, s);
  for (const s of ["DRAFT", "CONFIRMED", "PAID", "", undefined, null]) assert.equal(isCancelledStatusRow({ status: s }), false, String(s));
});

test("splitForTotals + columnTotals: a cancelled row is listed but not added up", () => {
  const rows = [
    { status: "CONFIRMED", totalSen: 10000 },
    { status: "CANCELLED", totalSen: 99999 },
    { status: "PAID", totalSen: 2550 },
  ];
  const { counted, skipped } = splitForTotals(rows, isCancelledStatusRow);
  assert.equal(skipped, 1);
  assert.equal(counted.length, 2);
  const t = columnTotals(counted, [{ key: "totalSen", total: "sum" }], (r, k) => r[k]);
  assert.equal(t.totalSen, 12550, "whole sen stay whole");
  // No skip → every row counts, exactly as before.
  assert.deepEqual(splitForTotals(rows), { counted: rows, skipped: 0 });
});

test("totalFooterText says what was left out and when only a page is loaded", () => {
  assert.equal(totalFooterText({ shown: 12, all: 40 }), "Total · 12 shown of 40");
  assert.equal(totalFooterText({ shown: 12, all: 40, skipped: 1 }), "Total · 12 shown of 40 · 1 cancelled not counted");
  assert.equal(totalFooterText({ shown: 1200, all: 1200, skipped: 0, totalRows: 1200 }), "Total · 1,200 shown of 1,200");
  assert.equal(
    totalFooterText({ shown: 200, all: 200, skipped: 3, totalRows: 1234 }),
    "Total · 200 shown of 200 · 3 cancelled not counted · loaded rows only",
  );
});

test("G4: DataGrid totals, group subtotals and the export all skip the same rows", () => {
  assert.match(GRID, /splitForTotals\(sortedData, totalsSkipRow\)/);
  assert.match(GRID, /columnTotals\(totalsSplit\.counted, visibleColumns/);
  assert.match(GRID, /columnTotals\(splitForTotals\(g\.rows, totalsSkipRow\)\.counted, visibleColumns/);
  assert.match(GRID, /const sumOf = \(rs: T\[\]\) => columnTotals\(splitForTotals\(rs, totalsSkipRow\)\.counted/);
  assert.match(GRID, /skipped: totalsSplit\.skipped,/);
});

// [file, gridId, amount keys with total: "sum"]
const DOC_LISTS = [
  ["src/pages/sales/index.tsx", "sales-orders-list", ["totalSen"]],
  ["src/pages/procurement/index.tsx", "purchase-orders-list", ["totalSen"]],
  ["src/pages/procurement/grn.tsx", "goods-receipts-list", ["totalAmount"]],
  ["src/pages/procurement/pi.tsx", "purchase-invoices-list", ["amountSen"]],
  ["src/pages/invoices/index.tsx", "invoices-list", ["totalSen", "paidAmount"]],
  ["src/pages/consignment/index.tsx", "consignment-orders-list", ["totalSen"]],
];
for (const [file, , keys] of DOC_LISTS) {
  test(`G4: ${file} totals its amount column(s) and skips cancelled rows`, () => {
    const src = read(file);
    for (const k of keys) {
      assert.match(src, new RegExp(`\\{ key: "${k}", label: "[^"]+", type: "currency",[^\\n]*total: "sum"`), k);
    }
    assert.match(src, /totalsSkipRow=\{isCancelledStatusRow\}/);
  });
}

// ── G7 — "Couldn't load this list" + Retry ───────────────────────────────
test("listLoadError: the fetch error, a { success: false } body, or null", () => {
  assert.equal(listLoadError({ success: true, data: [] }, null), null);
  assert.equal(listLoadError([], null), null, "a bare array is a good answer");
  assert.equal(listLoadError(null, null), null, "not loaded yet is not an error");
  assert.equal(listLoadError(null, "The request timed out."), "The request timed out.");
  assert.equal(listLoadError({ success: false, error: "Not allowed" }, null), "Not allowed");
  assert.equal(listLoadError({ success: false }, null), "The server could not return this list.");
  assert.equal(listLoadError({ success: true }, "  Network error  "), "Network error");
});

test("G7: DataGrid shows a load error instead of the empty message, with Retry", () => {
  assert.match(GRID, /error\?: string \| null;/);
  assert.match(GRID, /onRetry\?: \(\) => void;/);
  const at = GRID.indexOf(") : error && data.length === 0 ? (");
  const empty = GRID.indexOf(") : sortedData.length === 0 ? (");
  assert.ok(at > 0 && at < empty, "the error branch comes before the empty message");
  assert.match(GRID, /Couldn&apos;t load this list/);
  assert.match(GRID, /Couldn&apos;t refresh this list: \{error\}/, "rows still shown → a banner, not a blank grid");
});

for (const [file, gridId] of [
  ...DOC_LISTS.map(([f, id]) => [f, id]),
  ["src/pages/delivery/index.tsx", "delivery-orders-list"],
  ["src/pages/consignment/note.tsx", "consignment-notes-list"],
]) {
  test(`G7: ${file} hands its list error and refresh to the grid`, () => {
    const src = read(file);
    const at = src.indexOf(`gridId="${gridId}"`);
    assert.ok(at > 0);
    const grid = src.slice(src.lastIndexOf("<DataGrid", at), src.indexOf("/>", at));
    assert.match(grid, /error=\{listLoadError\(\w+, \w+\)\}/);
    assert.match(grid, /onRetry=\{\w+\}/);
  });
}
