// ---------------------------------------------------------------------------
// export-all-pages.test.mjs — a server-paged list exports EVERY page, not the
// one on screen (BUG-2026-10-12-281).
//
// Sales Orders, Purchase Orders, GRN and Invoices load 200 rows a page and
// Delivery Orders 50; the grid Export read only the grid's rows, so an
// unfiltered export was one page. Now the page hands the grid a loader for
// every row (`exportAllRows`) and the grid runs its own filter + sort over
// them (`filterGridRows` / `sortGridRows`, lifted out of its memos verbatim).
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
try { register("tsx/esm", pathToFileURL("./")); } catch { /* native strip */ }

const { fetchAllPages, EXPORT_ROW_CAP } = await import(
  pathToFileURL(resolve(process.cwd(), "src/lib/fetch-all-pages.ts")).href
);

// data-grid.tsx imports via "@/" aliases node cannot resolve, so lift the
// helpers and the two pure functions out of the real source into a temp module.
const GRID = readFileSync("src/components/ui/data-grid.tsx", "utf8").replace(/\r\n/g, "\n");
const slice = (from, to) => {
  const i = GRID.indexOf(from);
  const j = GRID.indexOf(to, i);
  assert.ok(i >= 0 && j > i, `cannot locate ${from}`);
  return GRID.slice(i, j);
};
const dir = mkdtempSync(join(tmpdir(), "grid-view-"));
const mod = join(dir, "grid-view.mts");
// The lifted slices call helpers data-grid.tsx imports from "@/lib/grid-layout"
// — `decodeRange` and `inRange`, the number-range column filter. The slices do
// not carry that import, so without it the temp module throws "decodeRange is
// not defined" the moment a column filter is exercised.
// `grid-layout.ts` has no imports of its own, so the REAL module is loaded by
// path rather than stubbed: a stub would let the two drift and this test would
// keep passing while the grid itself was broken.
const gridLayout = pathToFileURL(resolve("src/lib/grid-layout.ts")).href;
writeFileSync(
  mod,
  `import { decodeRange, inRange } from ${JSON.stringify(gridLayout)};
` +
    "type Column<T> = any;\n" +
    slice("function getNestedValue(", "// Context Menu") +
    slice("type GridFilterState<T>", "export function DataGrid<"),
);
const { filterGridRows, sortGridRows } = await import(pathToFileURL(mod).href);

// ── fetchAllPages ──────────────────────────────────────────────────────────

const rowsOf = (n) => Array.from({ length: n }, (_, i) => ({ id: `r${i + 1}` }));
function pagedServer(all, { failPage, limitCap = 500 } = {}) {
  const calls = [];
  const impl = async (url) => {
    const u = new URL(url, "http://x");
    const page = Number(u.searchParams.get("page"));
    const limit = Math.min(limitCap, Number(u.searchParams.get("limit")));
    calls.push(page);
    if (page === failPage) return { ok: false, json: async () => ({}) };
    const data = all.slice((page - 1) * limit, page * limit);
    return { ok: true, json: async () => ({ success: true, data, total: all.length, page, limit }) };
  };
  return { impl, calls };
}

test("walks every page of the scoped route and returns them all", async () => {
  const all = rowsOf(1234);
  const { impl, calls } = pagedServer(all);
  const got = await fetchAllPages((p, l) => `/api/sales-orders?page=${p}&limit=${l}`, impl);
  assert.equal(got.length, 1234);
  assert.deepEqual(calls, [1, 2, 3]);
  assert.equal(got.at(-1).id, "r1234");
});

test("pages by the limit the route actually used", async () => {
  const { impl, calls } = pagedServer(rowsOf(450), { limitCap: 200 });
  const got = await fetchAllPages((p, l) => `/x?page=${p}&limit=${l}`, impl);
  assert.equal(got.length, 450);
  assert.deepEqual(calls, [1, 2, 3]);
});

test("a page that fails refuses the whole export instead of writing it short", async () => {
  const { impl } = pagedServer(rowsOf(1200), { failPage: 2 });
  await assert.rejects(fetchAllPages((p, l) => `/x?page=${p}&limit=${l}`, impl), /page 2/);
});

test("over the cap refuses before walking", async () => {
  const impl = async () => ({ ok: true, json: async () => ({ success: true, data: [], total: EXPORT_ROW_CAP + 1, limit: 500 }) });
  await assert.rejects(fetchAllPages((p, l) => `/x?page=${p}&limit=${l}`, impl), /Narrow the filter/);
});

test("a row repeated by a shifting page is kept once; a shrunk list refuses", async () => {
  let n = 0;
  const repeat = async (url) => {
    const page = Number(new URL(url, "http://x").searchParams.get("page"));
    n++;
    const data = page === 1 ? [{ id: "a" }, { id: "b" }] : [{ id: "b" }, { id: "c" }];
    return { ok: true, json: async () => ({ success: true, data, total: 3, limit: 2 }) };
  };
  assert.deepEqual((await fetchAllPages((p, l) => `/x?page=${p}&limit=${l}`, repeat)).map((r) => r.id), ["a", "b", "c"]);
  assert.equal(n, 2);

  const shrink = async (url) => {
    const page = Number(new URL(url, "http://x").searchParams.get("page"));
    const data = page === 1 ? [{ id: "a" }, { id: "b" }] : [{ id: "b" }];
    return { ok: true, json: async () => ({ success: true, data, total: 4, limit: 2 }) };
  };
  await assert.rejects(fetchAllPages((p, l) => `/x?page=${p}&limit=${l}`, shrink), /changed while exporting/);
});

// ── the grid's filter + sort, now callable on any rows ─────────────────────

const COLS = [
  { key: "doNo", label: "DO" },
  { key: "customerName", label: "Customer" },
  { key: "stage", label: "Stage", filterAccessor: (r) => (r.status === "DRAFT" ? "Pending" : "Done") },
  { key: "valueSen", label: "Amount", sortAccessor: (r) => -r.valueSen },
];
const ROWS = [
  { id: "1", doNo: "DO-1", customerName: "Akemi", status: "DRAFT", valueSen: 300, hidden: "x-ref" },
  { id: "2", doNo: "DO-2", customerName: "Trion", status: "DELIVERED", valueSen: 100 },
  { id: "3", doNo: "DO-3", customerName: "akemi sdn bhd", status: "DELIVERED", valueSen: 200 },
];
const view = (over = {}) => ({
  deferredSearch: "", visibleColumns: COLS, alwaysSearchKeys: [], forceShowKeys: new Set(),
  keyField: "id", columnFilters: {}, columnValueFilters: {}, columns: COLS, ...over,
});
const ids = (rows) => rows.map((r) => r.id);

test("search spans visible columns plus alwaysSearchKeys, case-insensitive", () => {
  assert.deepEqual(ids(filterGridRows(ROWS, view({ deferredSearch: "AKEMI" }))), ["1", "3"]);
  assert.deepEqual(ids(filterGridRows(ROWS, view({ deferredSearch: "x-ref" }))), []);
  assert.deepEqual(ids(filterGridRows(ROWS, view({ deferredSearch: "x-ref", alwaysSearchKeys: ["hidden"] }))), ["1"]);
});

test("column text filters keep their modes; value filters read filterAccessor", () => {
  assert.deepEqual(ids(filterGridRows(ROWS, view({ columnFilters: { doNo: "equals:do-2" } }))), ["2"]);
  assert.deepEqual(ids(filterGridRows(ROWS, view({ columnValueFilters: { stage: new Set(["Done"]) } }))), ["2", "3"]);
  assert.deepEqual(
    ids(filterGridRows(ROWS, view({ columnValueFilters: { stage: new Set(["Done"]) }, forceShowKeys: new Set(["1"]) }))),
    ["1", "2", "3"],
    "forceShowKeys bypasses value filters",
  );
});

test("sort uses sortAccessor and direction; the input array is not mutated", () => {
  const sort = { groupBy: undefined, groupEnabled: false, groupFilter: null, columns: COLS };
  assert.deepEqual(ids(sortGridRows(ROWS, { ...sort, sortKey: "valueSen", sortDir: "asc" })), ["1", "3", "2"]);
  assert.deepEqual(ids(sortGridRows(ROWS, { ...sort, sortKey: "doNo", sortDir: "desc" })), ["3", "2", "1"]);
  assert.deepEqual(ids(ROWS), ["1", "2", "3"]);
  assert.deepEqual(
    ids(sortGridRows(ROWS, { ...sort, groupBy: "status", groupEnabled: true, groupFilter: new Set(["DELIVERED"]), sortKey: null, sortDir: "asc" })),
    ["2", "3"],
  );
});

// ── wiring ─────────────────────────────────────────────────────────────────

test("the grid's memos and its all-pages export share the same filter + sort", () => {
  assert.match(GRID, /const filteredData = useMemo\(\(\) => \{\n\s+return filterGridRows\(data,/);
  assert.match(GRID, /const sortedData = useMemo\(\(\) => \{\n\s+return sortGridRows\(filteredData,/);
  const block = slice("{/* Export — WYSIWYG", "{/* Column customizer */}");
  assert.match(block, /await exportAllRows\(\)/);
  assert.match(block, /sortGridRows\(\s*filterGridRows\(all,/);
  assert.match(block, /if \(ticked\.length > 0\) return ticked;/, "ticked rows still win");
});

const PAGED = {
  "src/pages/sales/index.tsx": ["_filtersActive ? undefined", "/api/sales-orders?page=${p}&limit=${l}"],
  "src/pages/procurement/index.tsx": ["poFiltersActive ? undefined", "/api/purchase-orders?page=${p}&limit=${l}"],
  "src/pages/procurement/grn.tsx": ["grnFiltersActive ? undefined", "/api/grn?page=${p}&limit=${l}"],
  "src/pages/invoices/index.tsx": ["gridSearch.trim() || filterQs ? undefined", "/api/invoices?page=${p}&limit=${l}"],
  "src/pages/delivery/index.tsx": ["search.trim() || !TAB_DO_STATUSES[activeTab] ? undefined", "/api/delivery-orders?page=${p}&limit=${l}&status="],
};
for (const [file, [gate, url]] of Object.entries(PAGED)) {
  test(`${file} hands its Export every page, only while it is paged`, () => {
    const src = readFileSync(file, "utf8");
    assert.ok(src.includes(`exportAllRows={${gate}`), "gated on the paged branch");
    assert.ok(src.includes(url), "walks the same scoped list route");
  });
}

test("Consignment needs no loader: its route ignores paging and returns every row", () => {
  assert.doesNotMatch(readFileSync("src/api/routes/consignment-orders.ts", "utf8"), /c\.req\.query\("page"\)/);
  assert.doesNotMatch(readFileSync("src/pages/consignment/index.tsx", "utf8"), /exportAllRows=/);
});

test("Invoices search/filter no longer asks for limit=2000 (the route clamped it to 500)", () => {
  const src = readFileSync("src/pages/invoices/index.tsx", "utf8");
  assert.doesNotMatch(src, /\/api\/invoices\?[^`]*limit=2000/);
  assert.match(readFileSync("src/api/routes/invoices.ts", "utf8"), /const paginate = pageParam !== undefined \|\| limitParam !== undefined;/);
});
