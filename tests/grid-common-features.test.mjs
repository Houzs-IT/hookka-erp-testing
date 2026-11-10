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
