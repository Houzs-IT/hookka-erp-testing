// ---------------------------------------------------------------------------
// docs-grid-leftovers.test.mjs — the documents / grid leftovers from the
// 2026-11-10 cross-system review (WORK-TRACKER 118).
//
// D5  item codes stay on one line on the PO / GRN / PI PDFs.
//
// Pure helpers are exercised directly; the wiring is pinned by source pattern
// (house style, see tests/fe-quality-batch-a.test.mjs).
// Run: node --import tsx/esm --test tests/docs-grid-leftovers.test.mjs
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { jsPDF } from "jspdf";

import { fitCodeColumn } from "../src/lib/pdf-code-column.ts";
import { warehousePrintName, DEFAULT_WAREHOUSE_LABEL } from "../src/lib/pdf-warehouse.ts";
import {
  canEditSharedLayout,
  cleanSharedLayoutName,
  sameLayoutName,
  sharedLayoutIdFromKind,
  sharedLayoutKind,
} from "../src/lib/grid-shared-layouts.ts";
import {
  flattenGroupedRows,
  flatItemHeight,
  flatTotalHeight,
  rowRangeCols,
  GROUP_ROW_PX,
} from "../src/lib/grid-virtual-groups.ts";
import { Hono } from "hono";
import layoutsRoute from "../src/api/routes/datagrid-layouts.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// ── D5 ────────────────────────────────────────────────────────────────────
test("D5: a short code keeps the column's old width and font", () => {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  assert.deepEqual(fitCodeColumn(doc, ["PC151", "", null], { minWidth: 24, maxWidth: 38 }), {
    cellWidth: 24,
    fontSize: 8,
  });
});

test("D5: a long code widens the column so it fits on one line at 8 pt", () => {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const code = "HB-1003-QUEEN-FAB";
  const fit = fitCodeColumn(doc, ["PC151", code], { minWidth: 24, maxWidth: 38 });
  assert.equal(fit.fontSize, 8);
  assert.ok(fit.cellWidth > 24 && fit.cellWidth <= 38, `width ${fit.cellWidth}`);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  // Room inside the padding is at least the code's printed width.
  assert.ok(fit.cellWidth - 3.6 >= doc.getTextWidth(code));
});

test("D5: only past the cap does the font shrink, and never below the floor", () => {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const long = "SUPPLIER-ITEM-CODE-2026";
  const fit = fitCodeColumn(doc, [long], { minWidth: 24, maxWidth: 38 });
  assert.equal(fit.cellWidth, 38);
  assert.ok(fit.fontSize < 8 && fit.fontSize >= 6, `font ${fit.fontSize}`);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(fit.fontSize);
  assert.ok(38 - 3.6 >= doc.getTextWidth(long));
  const absurd = fitCodeColumn(doc, ["X".repeat(80)], { minWidth: 24, maxWidth: 38 });
  assert.equal(absurd.fontSize, 6);
});

test("D5: measuring leaves the document's font as it found it", () => {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  doc.setFont("helvetica", "italic");
  doc.setFontSize(13);
  fitCodeColumn(doc, ["SOME-CODE-1234567890"], { minWidth: 24, maxWidth: 38 });
  assert.equal(doc.getFontSize(), 13);
  assert.equal(doc.getFont().fontStyle, "italic");
});

test("D5: PO, GRN and PI size the Item Code column from their own codes", () => {
  for (const f of ["purchase-order", "grn", "purchase-invoice"]) {
    const src = read(`src/lib/generate-${f}-pdf.ts`);
    assert.match(src, /const codeCol = fitCodeColumn\(doc, tableBody\.map\(\(r\) => r\[1\]\)/, f);
    assert.match(src, /1: \{ cellWidth: codeCol\.cellWidth,[^}]*fontSize: codeCol\.fontSize \}/, f);
  }
});

// ── D6 ────────────────────────────────────────────────────────────────────
test("D6: no recorded warehouse prints Hookka's one site, a recorded one wins", () => {
  assert.equal(DEFAULT_WAREHOUSE_LABEL, "HOOKKA INDUSTRIES, Sungai Buloh");
  assert.equal(warehousePrintName(undefined), DEFAULT_WAREHOUSE_LABEL);
  assert.equal(warehousePrintName("  "), DEFAULT_WAREHOUSE_LABEL);
  assert.equal(warehousePrintName("-"), DEFAULT_WAREHOUSE_LABEL);
  assert.equal(warehousePrintName(" Rawang Store "), "Rawang Store");
});

test("D6: the DO prints Ship From and the GRN prints Received At (no more always-dash Warehouse)", () => {
  const dO = read("src/lib/generate-do-pdf.ts");
  assert.match(dO, /lblVal\(rightX, ry, "Ship From", warehousePrintName\(o\.warehouseName\), rightMaxW\)/);
  const grn = read("src/lib/generate-grn-pdf.ts");
  assert.match(grn, /lblVal\(rightX, ry, "Received At", warehousePrintName\(data\.warehouse\), rightMaxW\)/);
  assert.doesNotMatch(grn, /"Warehouse", data\.warehouse \?\? "-"/);
});

// ── CANCELLED stamp on the consignment note (follow-up to #1250) ──────────
test("CGN: a cancelled consignment note PDF carries the red CANCELLED stamp", () => {
  const cn = read("src/lib/generate-cn-pdf.ts");
  assert.match(cn, /import \{ isCancelledStatus, stampCancelledJsPdf \} from "\.\/pdf-cancelled-stamp";/);
  assert.match(cn, /status\?: string \| null;/);
  // Stamped after the footers, in the single-CN entry point (same order as the DO).
  assert.match(cn, /stampCnFooters\(doc\);\n\s*\/\/[^\n]*\n\s*if \(isCancelledStatus\(data\.status\)\) stampCancelledJsPdf\(doc\);/);
  // The page hands the RAW backend status (the display status folds states).
  const page = read("src/pages/consignment/note.tsx");
  assert.match(page, /status: row\.rawStatus, \/\/ CANCELLED → red stamp on the PDF/);
});

// ── G6 shared named layouts ───────────────────────────────────────────────
test("G6: the rules — names, the shared kind, who may change a layout", () => {
  assert.equal(sharedLayoutKind("abc"), "shared:abc");
  assert.equal(sharedLayoutIdFromKind("shared:abc"), "abc");
  assert.equal(sharedLayoutIdFromKind("shared:"), null);
  assert.equal(sharedLayoutIdFromKind("user:u1"), null);
  assert.equal(sharedLayoutIdFromKind("org-default"), null);
  assert.deepEqual(cleanSharedLayoutName("  Store   view "), { name: "Store view" });
  assert.ok("error" in cleanSharedLayoutName("   "));
  assert.ok("error" in cleanSharedLayoutName("x".repeat(61)));
  assert.ok(sameLayoutName("Store View", " store  view"));
  assert.equal(canEditSharedLayout("u1", "u1", "SALES"), true, "the author");
  assert.equal(canEditSharedLayout("u1", "u2", "SALES"), false, "another member");
  assert.equal(canEditSharedLayout("u1", "u2", "admin"), true, "an admin");
  assert.equal(canEditSharedLayout("u1", "u2", "SUPER_ADMIN"), true);
  assert.equal(canEditSharedLayout(null, null, "SALES"), false, "no author, no user: nobody but admins");
});

/** In-memory stand-in for datagrid_org_layouts, enough for the route's SQL. */
function layoutDb() {
  const rows = [];
  const db = {
    rows,
    prepare(sql) {
      let args = [];
      const s = sql.replace(/\s+/g, " ").trim();
      const stmt = {
        bind(...a) { args = a; return stmt; },
        async run() {
          if (/^(CREATE|ALTER)/.test(s)) return { success: true };
          if (s.startsWith("INSERT INTO datagrid_org_layouts")) {
            const [id, org_id, grid_id, kind, visible_cols, col_order, col_widths, updated_by, updated_at, name, created_by, created_by_name] = args;
            rows.push({ id, org_id, grid_id, kind, visible_cols, col_order, col_widths, updated_by, updated_at, name, created_by, created_by_name });
            return { success: true };
          }
          if (s.startsWith("UPDATE datagrid_org_layouts")) {
            const [vc, co, cw, name, by, at, org, grid, kind] = args;
            for (const r of rows) {
              if (r.org_id === org && r.grid_id === grid && r.kind === kind) {
                Object.assign(r, { visible_cols: vc, col_order: co, col_widths: cw, name: name ?? r.name, updated_by: by, updated_at: at });
              }
            }
            return { success: true };
          }
          if (s.startsWith("DELETE FROM datagrid_org_layouts")) {
            const [org, grid, kind] = args;
            for (let i = rows.length - 1; i >= 0; i--) {
              const r = rows[i];
              if (r.org_id === org && r.grid_id === grid && r.kind === kind) rows.splice(i, 1);
            }
            return { success: true };
          }
          throw new Error(`unexpected run: ${s}`);
        },
        async all() {
          const [org, grid, mine] = args;
          const inGrid = rows.filter((r) => r.org_id === org && r.grid_id === grid);
          if (s.startsWith("SELECT kind, visible_cols")) {
            return { results: inGrid.filter((r) => ["org-default", "print"].includes(r.kind) || r.kind === mine || r.kind.startsWith("shared:")) };
          }
          if (s.startsWith("SELECT kind, name, created_by")) {
            return { results: inGrid.filter((r) => r.kind.startsWith("shared:")) };
          }
          throw new Error(`unexpected all: ${s}`);
        },
        async first() {
          if (s.startsWith("SELECT displayName")) return { displayName: "Aina" };
          if (s.startsWith("SELECT kind, name, created_by")) {
            const [org, grid, kind] = args;
            return rows.find((r) => r.org_id === org && r.grid_id === grid && r.kind === kind) ?? null;
          }
          throw new Error(`unexpected first: ${s}`);
        },
      };
      return stmt;
    },
  };
  return db;
}

function layoutApp(db, who) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("DB", db);
    c.set("orgId", "hookka");
    c.set("userId", who.id);
    c.set("userRole", who.role);
    await next();
  });
  app.route("/api/datagrid-layouts", layoutsRoute);
  return app;
}
const call = (app, method, path, body) =>
  app.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

test("G6: a member shares a layout, everyone sees it tagged with its author; only author or admin change it", async () => {
  const db = layoutDb();
  const ali = layoutApp(db, { id: "u-ali", role: "SALES" });
  const bob = layoutApp(db, { id: "u-bob", role: "SALES" });
  const boss = layoutApp(db, { id: "u-boss", role: "ADMIN" });
  const cols = { gridId: "so-list", visibleCols: ["soNo", "customer"], colOrder: ["customer", "soNo"], colWidths: { soNo: "120px" } };

  let res = await call(ali, "POST", "/api/datagrid-layouts/shared", { ...cols, name: "Store view" });
  assert.equal(res.status, 200);
  const { id } = await res.json();
  assert.ok(id);

  // Same name again (any case / spacing) → 409; no name → 400.
  res = await call(bob, "POST", "/api/datagrid-layouts/shared", { ...cols, name: " store  VIEW " });
  assert.equal(res.status, 409);
  res = await call(bob, "POST", "/api/datagrid-layouts/shared", { ...cols, name: "" });
  assert.equal(res.status, 400);

  // Bob sees it, with Ali's name, and may not edit it.
  res = await call(bob, "GET", "/api/datagrid-layouts?gridId=so-list");
  const seen = (await res.json()).shared;
  assert.equal(seen.length, 1);
  assert.deepEqual(
    { name: seen[0].name, by: seen[0].createdByName, canEdit: seen[0].canEdit, order: seen[0].colOrder, widths: seen[0].colWidths },
    { name: "Store view", by: "Aina", canEdit: false, order: ["customer", "soNo"], widths: { soNo: "120px" } },
  );
  res = await call(ali, "GET", "/api/datagrid-layouts?gridId=so-list");
  assert.equal((await res.json()).shared[0].canEdit, true, "the author may edit");

  // Bob can neither overwrite nor delete it.
  res = await call(bob, "PUT", `/api/datagrid-layouts/shared/${id}`, { ...cols, visibleCols: ["soNo"] });
  assert.equal(res.status, 403);
  res = await call(bob, "DELETE", `/api/datagrid-layouts/shared/${id}?gridId=so-list`);
  assert.equal(res.status, 403);
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].visible_cols, JSON.stringify(["soNo", "customer"]), "untouched by the refused PUT");

  // The author updates it; an admin deletes it.
  res = await call(ali, "PUT", `/api/datagrid-layouts/shared/${id}`, { ...cols, visibleCols: ["soNo"] });
  assert.equal(res.status, 200);
  assert.equal(db.rows[0].visible_cols, JSON.stringify(["soNo"]));
  res = await call(boss, "DELETE", `/api/datagrid-layouts/shared/${id}?gridId=so-list`);
  assert.equal(res.status, 200);
  assert.equal(db.rows.length, 0);
  res = await call(ali, "DELETE", `/api/datagrid-layouts/shared/${id}?gridId=so-list`);
  assert.equal(res.status, 404);
});

test("G6: the generic PUT / DELETE cannot reach a shared row", async () => {
  const db = layoutDb();
  const bob = layoutApp(db, { id: "u-bob", role: "SALES" });
  const res = await call(bob, "PUT", "/api/datagrid-layouts", {
    gridId: "so-list", kind: "shared:x", visibleCols: ["a"], colOrder: ["a"],
  });
  // Not the user kind → the SUPER_ADMIN gate refuses first.
  assert.equal(res.status, 403);
});

test("G6: the Columns panel carries the Team layouts block, switching copies into the user's own layout", () => {
  const grid = read("src/components/ui/data-grid.tsx");
  assert.match(grid, /sharedLayouts=\{gridId \? \(\s*<GridSharedLayouts/);
  assert.match(grid, /const applySharedLayout = useCallback\(/);
  assert.match(grid, /localStorage\.setItem\(`datagrid-cols-\$\{gridId\}-\$\{userKey\(\)\}`, JSON\.stringify\(l\.visibleCols\)\)/);
  const panel = read("src/components/ui/grid-shared-layouts.tsx");
  assert.match(panel, />\s*Shared\s*</, "the Shared tag");
  assert.match(panel, /Team layouts/);
  assert.match(panel, /\{l\.canEdit && confirmDelete !== l\.id && \(/, "Update / Delete only for the author or an admin");
  assert.match(panel, /method: "POST",\s*body: \{ gridId, name: named\.name, \.\.\.current\(\) \}/);
});

// ── G8 grouped lists keep virtual scrolling ───────────────────────────────
const rowsAB = [
  { id: 1, g: "A" }, { id: 2, g: "A" }, { id: 3, g: "B" }, { id: 4, g: "C" }, { id: 5, g: "C" },
];
const byG = (r) => r.g;

test("G8: the flat list is the old render order — header, rows, subtotal per group", () => {
  assert.deepEqual(flattenGroupedRows(rowsAB, byG, new Set(), true), [
    { kind: "group", key: "A" }, { kind: "row", index: 0 }, { kind: "row", index: 1 }, { kind: "sub", key: "A" },
    { kind: "group", key: "B" }, { kind: "row", index: 2 }, { kind: "sub", key: "B" },
    { kind: "group", key: "C" }, { kind: "row", index: 3 }, { kind: "row", index: 4 }, { kind: "sub", key: "C" },
  ]);
  // A folded group keeps its header and subtotal, drops its rows; no totals → no subtotal items.
  assert.deepEqual(flattenGroupedRows(rowsAB, byG, new Set(["A", "C"]), false), [
    { kind: "group", key: "A" }, { kind: "group", key: "B" }, { kind: "row", index: 2 }, { kind: "group", key: "C" },
  ]);
  assert.deepEqual(flattenGroupedRows([], byG, new Set(), true), []);
});

test("G8: heights add up in the same pass (headers pinned to GROUP_ROW_PX)", () => {
  const flat = flattenGroupedRows(rowsAB, byG, new Set(), true);
  // 3 headers × 30 + 5 rows × 26 + 3 subtotals × 26
  assert.equal(GROUP_ROW_PX, 30);
  assert.equal(flatTotalHeight(flat, 26), 3 * 30 + 8 * 26);
  assert.equal(flatItemHeight({ kind: "row", index: 0 }, 26), 26);
  assert.equal(flatItemHeight({ kind: "group", key: "A" }, 26), 30);
});

test("G8: the grid windows the grouped body instead of painting every row", () => {
  const grid = read("src/components/ui/data-grid.tsx");
  assert.match(grid, /const groupedFlat = useMemo<FlatGroupItem\[\] \| null>\(\(\) => \{\s*if \(!virtualize \|\| !groupOn\) return null;/);
  assert.match(grid, /count: virtualizationActive \? displayedData\.length : groupedFlat \? groupedFlat\.length : 0,/);
  assert.match(grid, /getItemKey: groupedItemKey,/);
  assert.match(grid, /if \(groupedFlat && groupedFlat\.length >= VIRTUALIZE_MIN_ROWS\) \{/);
  assert.match(grid, /const totalSize = flatTotalHeight\(groupedFlat, ROW_HEIGHT_PX\);/);
  // Both group kinds paint their header through ONE builder in both paths.
  assert.match(grid, /out\.push\(userGroupCol \? userGroupHeader\(item\.key, true\) : pageGroupHeader\(item\.key, true\)\);/);
  assert.match(grid, /out\.push\(userGroupHeader\(key, false\)\);/);
  assert.match(grid, /rows\.push\(pageGroupHeader\(gv, false\)\);/);
  assert.match(grid, /style=\{fixed \? \{ height: `\$\{GROUP_ROW_PX\}px` \} : undefined\}/);
});

// ── G9 rows that did not change are not re-drawn ──────────────────────────
test("G9: a row outside the copy range gets the same range props however the range moves", () => {
  const rect = { r0: 2, r1: 4, c0: 1, c1: 3 };
  assert.deepEqual(rowRangeCols(rect, true, 3), [1, 3]);
  assert.deepEqual(rowRangeCols(rect, true, 0), [-1, -1]);
  assert.deepEqual(rowRangeCols({ r0: 5, r1: 9, c0: 0, c1: 6 }, true, 0), [-1, -1], "range moved, row 0 unchanged");
  assert.deepEqual(rowRangeCols(rect, false, 3), [-1, -1], "a single cell shows no range");
  assert.deepEqual(rowRangeCols(null, true, 3), [-1, -1]);
});

test("G9: a row's cells are one memoised component fed only stable / primitive props", () => {
  const grid = read("src/components/ui/data-grid.tsx");
  assert.match(grid, /const DataRowCells = React\.memo\(DataRowCellsImpl\) as typeof DataRowCellsImpl;/);
  assert.match(grid, /const rangeCols = rowRangeCols\(activeRect, showRange, index\);/);
  const call = grid.slice(grid.indexOf("<DataRowCells"), grid.indexOf("/>", grid.indexOf("<DataRowCells")));
  for (const p of [
    "row={row}", "index={index}", "visibleColumns={visibleColumns}", "colWidths={colWidths}",
    "stickyOffsets={stickyOffsets}", "isEven={isEven}", "isSelected={isSelected}", "isCancelled={isCancelled}",
    "rowCls={rowClassName?.(row)}", "rangeLo={rangeCols[0]}", "rangeHi={rangeCols[1]}",
    "search={deferredSearch}", "data={data}",
  ]) assert.ok(call.includes(p), p);
  // No inline closure / object literal props (they would defeat the memo).
  assert.doesNotMatch(call, /=\{\(|=\{\{/);
  // The cells no longer read grid state directly.
  const impl = grid.slice(grid.indexOf("function DataRowCellsImpl"), grid.indexOf("const DataRowCells = React.memo")).replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(impl, /activeRect|showRange|deferredSearch|rowClassName/);
  assert.match(impl, /const inRange = colIdx >= rangeLo && colIdx <= rangeHi;/);
});

// ── G3 for the DO and CN lists (follow-up to #1251, BUG-2026-11-10-443) ───
test("G3 DO: a stage tab's header sort / funnel says it covers the loaded page, with Load all", () => {
  const src = read("src/pages/delivery/index.tsx");
  // Browse view only: the search view already holds the whole-table matches.
  assert.match(src, /totalRows=\{search\.trim\(\) \|\| loadedAllDOs \? undefined : totalDOsServer\}/);
  assert.match(src, /onLoadAll=\{\(\) => \{ void loadAllTabDOs\(\); \}\}/);
  // Load all pages through every DO of THIS tab's statuses (the Export query).
  assert.match(src, /fetchAllPages<DeliveryOrder>\(`\/api\/delivery-orders\?status=\$\{statuses\.join\(","\)\}`\)/);
  // The loaded set is tied to the response and tab it was loaded for.
  assert.match(src, /allTabDOs && allTabDOs\.resp === doRaw && allTabDOs\.tab === activeTab \? allTabDOs\.rows : null/);
  assert.match(src, /return \(loadedAllDOs \?\? deliveryOrders\)\.filter\(\(d\) => statuses\.includes\(d\.status\)\);/);
});

test("G3 CN: a header sort / funnel / grouping widens the fetch to every CN; the pager counts the server total", () => {
  const src = read("src/pages/consignment/note.tsx");
  assert.match(src, /onColumnViewChange=\{setCnColumnView\}/);
  assert.match(src, /\}>\(cnColumnView \? "\/api\/consignment-notes" : `\/api\/consignment-notes\?page=\$\{page\}&limit=\$\{PAGE_SIZE\}`\);/);
  // BUG-2026-11-10-444: the pager used the loaded page's length (always one page).
  assert.match(src, /const totalCNs = cnRaw\?\.total \?\? cnList\.length;/);
  assert.doesNotMatch(src, /const totalCNs = cnList\.length;/);
});
