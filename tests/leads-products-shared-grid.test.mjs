// ---------------------------------------------------------------------------
// leads-products-shared-grid.test.mjs — Leads and Products (SKU Master) on the
// shared DataGrid (WORK-TRACKER 120, handoff "Next batches" item 1).
//
// Both pages were left out of the 2026-11-10 grid batch (#1235 / #1251 /
// #1259) because they had no DataGrid: Products SKU Master was a hand-made
// CSS-grid table, and Leads is a kanban board with no list at all (its banner
// pointed at a "leads list" that did not exist).
//
//   Products — the SKU Master table IS the DataGrid now. Behaviour parity is
//   the hard rule, so this pins what the hand-made table did: the row click
//   opens the detail panel under the row (a new opt-in DataGrid prop), the
//   inline price / seat-price / Unit / Fabric edits stay behind Edit mode and
//   the bulk Save, sofa seat-size columns follow Maintenance sizes, and the
//   price columns stay out for users without product-pricing permission.
//   Catalog and Maintenance are untouched.
//   Leads — the board stays exactly as it was (the default); a List view on
//   the shared grid is added beside it, over every lead.
//
// Wiring is pinned by source pattern (house style, tests/grid-common-features
// .test.mjs). Run: node --import tsx/esm --test tests/leads-products-shared-grid.test.mjs
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const GRID = read("src/components/ui/data-grid.tsx");
const PRODUCTS = read("src/pages/products/index.tsx");
const LEADS = read("src/pages/leads/index.tsx");

const gridBlock = (src, marker) => {
  const at = src.indexOf(marker);
  assert.ok(at > 0, `${marker} present`);
  return src.slice(src.lastIndexOf("<DataGrid", at), src.indexOf("/>", at));
};

// ── DataGrid: the opt-in row detail panel ─────────────────────────────────
test("DataGrid: expandedRowKey + renderRowDetail draw one detail row under the opened row", () => {
  assert.match(GRID, /expandedRowKey\?: string \| null;/);
  assert.match(GRID, /renderRowDetail\?: \(row: T\) => React\.ReactNode;/);
  assert.match(GRID, /renderRowDetail && expandedRowKey != null && key === expandedRowKey/);
  // Not a data row: no data-dg="row", no row handlers, spans every column.
  assert.match(GRID, /<tr key=\{`\$\{key\}__detail`\} data-dg="detail"/);
  assert.match(GRID, /colSpan=\{visibleColumns\.length \+ \(selectable \? 1 : 0\) \+ \(hasContextMenu \? 1 : 0\)\}\s*\n\s*className="p-0 whitespace-normal/);
});

test("DataGrid: an open detail panel switches windowing off (rows are no longer one height)", () => {
  assert.match(GRID, /const detailOpen = !!renderRowDetail && expandedRowKey != null;/);
  assert.match(GRID, /const windowing = virtualize && !detailOpen;/);
  assert.match(GRID, /const virtualizationActive = windowing && !groupOn;/);
  assert.match(GRID, /if \(!windowing \|\| !groupOn\) return null;/, "the grouped windowed body follows it too");
});

// ── Products SKU Master ───────────────────────────────────────────────────
test("Products: the hand-made SKU table and its private prefs are gone", () => {
  assert.doesNotMatch(PRODUCTS, /catalogRowVirtualizer|productsScrollRef/);
  assert.doesNotMatch(PRODUCTS, /hookka\.products\.(baseCols|colOrder|colWidths|colFilters|analyticCols)/);
  assert.doesNotMatch(PRODUCTS, /<table className="min-w-full divide-y divide-\[#E5E7EB\]">/);
  // The sofa tier choice is not a column layout and stays per browser.
  assert.match(PRODUCTS, /hookka\.products\.sofaTier/);
});

test("Products: one gridId per category, all distinct", () => {
  const m = PRODUCTS.match(/const SKU_GRID_IDS: Record<ProdCat, string> = \{([\s\S]*?)\};/);
  assert.ok(m, "SKU_GRID_IDS map");
  const ids = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  assert.deepEqual(ids, ["products-sku-bedframe", "products-sku-sofa", "products-sku-accessory"]);
  assert.match(PRODUCTS, /const skuGridId = SKU_GRID_IDS\[skuCat\];/);
});

test("Products: the SKU grid carries the common features and the old row behaviour", () => {
  const g = gridBlock(PRODUCTS, "gridId={skuGridId}");
  assert.match(g, /key=\{skuGridId\}/, "a category switch mounts that category's layout");
  assert.doesNotMatch(g, /headerMenu=\{false\}|reorderableHeaders=\{false\}|urlFilters=\{false\}/);
  // Row click toggles the detail panel, exactly as the hand-made row did.
  assert.match(g, /onRowClick=\{\(r\) => setExpandedId\(\(cur\) => \(cur === r\.id \? null : r\.id\)\)\}/);
  assert.match(g, /expandedRowKey=\{expandedId\}/);
  assert.match(g, /renderRowDetail=\{\(r\) => renderSkuDetail\(r\._p\)\}/);
  // Expanded / dirty tints.
  assert.match(g, /expandedId === r\.id \? "bg-\[#F4F0E8\]" : isProductDirty\(r\.id\) \? "bg-\[#FEFBF0\]" : ""/);
  // Search is cross-category, as before: the grid's search tells the page.
  assert.match(g, /onSearchChange=\{setSearchQuery\}/);
  assert.match(g, /alwaysSearchKeys=\{SKU_SEARCH_KEYS\}/);
  assert.match(PRODUCTS, /const SKU_SEARCH_KEYS = \["code", "description", "model", "category"\];/);
  assert.match(PRODUCTS, /if \(!q\) return products\.filter\(\(p\) => p\.category === categoryFilter\);\n\s*return products;/);
  // Couldn't load — Retry.
  assert.match(g, /error=\{productsLoadError\}/);
  assert.match(g, /onRetry=\{\(\) => void loadProducts\(true\)\}/);
  assert.match(PRODUCTS, /setProductsLoadError\(listLoadError\(pData, null\)\);/);
  // Export (N) and the count read what the grid shows.
  assert.match(g, /onFilteredDataChange=\{setVisibleSkuRows\}/);
  assert.match(PRODUCTS, /const filtered = useMemo\(\(\) => visibleSkuRows\.map\(\(r\) => r\._p\), \[visibleSkuRows\]\);/);
});

test("Products: columns come from the BASE_COLS registry, so sizes stay dynamic and prices stay gated", () => {
  // Price columns (and the seat-size price columns) still leave baseCols
  // without product-pricing permission — the grid columns are built from it.
  assert.match(PRODUCTS, /const canSeePricing = hasPerm\("product-pricing", "read"\);/);
  assert.match(PRODUCTS, /\(col\) => !PRICE_COL_KEYS\.has\(col\.key\) && !H_COL_RE\.test\(col\.key\)/);
  assert.match(PRODUCTS, /const cols: Column<SkuRow>\[\] = baseCols\[skuCat\]\.map\(\(bc\) => \{/);
  // Seat-size columns: key from the size (dot-safe), money in sen.
  assert.match(PRODUCTS, /key: isSize \? skuSizeKey\(bc\.key\.slice\(1\)\) : bc\.key,/);
  assert.match(PRODUCTS, /const skuSizeKey = \(size: string\) => `h\$\{size\}`\.replace\(\/\\\.\/g, "_"\);/);
  assert.match(PRODUCTS, /for \(const n of sofaHeightList\) \{\s*\n\s*const v = Number\(sortValueFor\(p, `h\$\{n\}`\)\);\s*\n\s*row\[skuSizeKey\(n\)\] = v > 0 \? v : null;/);
  // Code stays frozen; the same sort values as the old header sort.
  assert.match(PRODUCTS, /sticky: bc\.frozen \|\| undefined,/);
  assert.match(PRODUCTS, /sortAccessor: \(r\) => sortValueFor\(r\._p, bc\.key\),/);
  // Analytic columns: Margin (P1) / Labor % (P1) start hidden, as before.
  assert.match(PRODUCTS, /defaultHidden: !c\.defaultOn \|\| undefined,/);
});

test("Products: inline edits still need Edit mode and still go through the bulk Save", () => {
  const at = PRODUCTS.indexOf("const skuCellFor = (key: string, p: Product): ReactNode => {");
  assert.ok(at > 0);
  const fn = PRODUCTS.slice(at, PRODUCTS.indexOf("const renderSkuDetail", at));
  // Price 2, Price 1 and every seat-size cell: no edit outside Edit mode.
  assert.equal((fn.match(/if \(!editMode\) return;/g) ?? []).length, 3);
  // Every edit is buffered, never written on blur.
  assert.match(fn, /recordDirty\(p\.id, \{ basePriceSen: val \}\);/);
  assert.match(fn, /recordDirty\(p\.id, \{ price1Sen: val \}\);/);
  assert.match(fn, /recordDirty\(p\.id, \{ seatHeightPrices: updated \}\);/);
  assert.match(fn, /unitM3: \(\) => renderUnitM3Cell\(p, cfg\),/);
  assert.match(fn, /fabric: \(\) => renderFabricCell\(p, cfg\),/);
  assert.doesNotMatch(fn, /fetch\(/, "a cell never saves on its own");
  // The price-change calendar and Variants button stop the row click.
  assert.match(fn, /title="Schedule price change"[\s\S]*?e\.stopPropagation\(\);\s*\n\s*setScheduleProductId\(p\.id\);/);
  assert.match(fn, /onClick=\{\(\) => setEditingVariant\(p\)\}/);
});

test("Products: the detail panel keeps every section the expanded row had", () => {
  const at = PRODUCTS.indexOf("const renderSkuDetail = (p: Product): ReactNode => {");
  const fn = PRODUCTS.slice(at, PRODUCTS.indexOf("const skuColumns", at));
  for (const part of [
    /\{cfg && <ProductionConfig config=\{cfg\} \/>\}/,
    /Price vs Labor \(Margin\)/,
    /Variant Defaults/,
    /to=\{`\/products\/\$\{p\.id\}\/bom`\}/,
    /to=\{`\/products\/\$\{p\.id\}\/documents`\}/,
    /Manage Variants/,
    /<CustomerAssignmentsSection productId=\{p\.id\} active=\{isExpanded\} \/>/,
    /<CncTemplatePanel/,
  ]) assert.match(fn, part);
});

test("Products: Catalog and Maintenance views are not on the grid", () => {
  assert.match(PRODUCTS, /\{viewMode === "catalog" && <ProductCatalog products=\{products\} \/>\}/);
  assert.match(PRODUCTS, /\{viewMode === "maintenance" && <MaintenanceView \/>\}/);
  assert.match(PRODUCTS, /\{viewMode === "skuMaster" && \(\n\s*<DataGrid<SkuRow>/);
});

// ── Leads ─────────────────────────────────────────────────────────────────
test("Leads: the board is still the default, still drag-to-move", () => {
  assert.match(LEADS, /const isList = searchParams\.get\("view"\) === "list";/);
  assert.match(LEADS, /\{\/\* Board \*\/\}\n\s*\{!isList && \(/);
  assert.match(LEADS, /onDrop=\{[\s\S]*?moveStage\(lead, s\.key\)/);
});

test("Leads: the List view is the shared grid over every lead", () => {
  const g = gridBlock(LEADS, 'gridId="leads-list"');
  assert.match(g, /data=\{allLeads\}/);
  assert.match(g, /onRowClick=\{\(l\) => setOpenLeadId\(l\.id\)\}/, "row click opens the same drawer");
  assert.match(g, /contextMenuItems=\{listMenu\}/);
  assert.match(g, /error=\{listError\}/);
  assert.match(g, /onRetry=\{\(\) => setListNonce\(\(n\) => n \+ 1\)\}/);
  // Est. value adds up; a Dropped lead is listed, not counted.
  assert.match(LEADS, /\{ key: "est_value_sen", label: "Est\. value", type: "currency",[^\n]*total: "sum" \}/);
  assert.match(g, /totalsSkipRow=\{\(l\) => l\.stage === "LOST"\}/);
  // Every lead, not the board's first page: pages the endpoint by offset.
  assert.match(LEADS, /fetch\(`\/api\/sales-leads\?limit=\$\{LEAD_PAGE\}&offset=\$\{out\.length\}`\)/);
  assert.match(LEADS, /if \(err\) throw new Error\(err\);/, "a failed page is an error, not an empty list");
  // A lead opened from the List beyond the board's page still opens.
  assert.match(LEADS, /leads\.find\(\(l\) => l\.id === openLeadId\) \?\? allLeads\.find\(\(l\) => l\.id === openLeadId\)/);
});

test("Leads: the List's row menu moves through the same moveStage, and asks before deleting", () => {
  const at = LEADS.indexOf("const listMenu = (l: Lead): ContextMenuItem[] => [");
  assert.ok(at > 0);
  const fn = LEADS.slice(at, LEADS.indexOf("];", LEADS.indexOf('label: "Delete"', at)));
  assert.match(fn, /action: \(\) => void moveStage\(l, s\.key\)/);
  assert.match(fn, /await confirm\(\{/);
  assert.match(fn, /if \(ok\) void delLead\(l\.id\);/);
  // The stage move updates the List optimistically too.
  assert.match(LEADS, /setAllLeads\(\(prev\) => prev\.map\(\(l\) => \(l\.id === lead\.id \? \{ \.\.\.l, stage/);
});
