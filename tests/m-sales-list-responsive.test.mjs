// The Sales Orders list is ONE design at every width: the approved phone list. These
// tests server-render it with FIXTURE rows at phone and tablet widths and check that
// wider screens show the same controls and cards (not the old tablet list), arrange
// the cards in columns only where the phone rule allows, and keep the Sort the tablet
// list had. Fixture data: markup and wiring, not real data, not how it looks on a device.
import test from "node:test";
import assert from "node:assert/strict";
import React, { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";
import { renderScreen, listFixture } from "./_ssr-sales.mjs";

const LIST = ["src/pages/m/screens/SalesScreen.tsx", "SalesScreen"];
const render = (opts) => renderScreen(...LIST, { route: "/m/sales", routePath: "/m/sales", ...opts });
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const WIDE_GRID = "grid-template-columns:repeat(auto-fill, minmax(min(100%, 320px), 1fr))";
const FLEX_COLUMN = "display:flex;flex-direction:column;gap:11px;padding:8px 18px 120px";

// ---- the same design at every width ------------------------------------------------

test("every width shows the phone list's controls and cards", async () => {
  for (const width of [390, 768, 820, 1024, 1180]) {
    const html = await render({ width });
    const t = text(html);
    assert.ok(t.includes("ALL SALES ORDERS"), `${width}: summary hero`);
    assert.ok(html.includes('aria-label="New Sales Order"'), `${width}: round + in the header`);
    assert.ok(html.includes('aria-label="Scan customer PO"'), `${width}: Scan PO`);
    for (const chip of ["All", "Draft", "Confirmed", "In Production", "Ready", "Delivered", "Cancelled"]) {
      assert.ok(t.includes(chip), `${width}: chip ${chip}`);
    }
    for (const name of ["Aurora Living Sdn Bhd", "Sample Customer Sdn Bhd", "Echo Residence"]) assert.ok(t.includes(name), `${width}: ${name}`);
    assert.ok(t.includes("EXPECTED DD") && t.includes("TOTAL QTY") && t.includes("AMOUNT"), `${width}: card metrics`);
  }
});

test("the old tablet list is gone: no tablet search box, strip or card", async () => {
  for (const width of [768, 1024]) {
    const html = await render({ width });
    assert.ok(!html.includes("Search SO · customer · PO · reference"), "old tablet placeholder");
    assert.ok(!text(html).includes("ORDER DATE"), "old tablet card metric");
    assert.ok(!/ rev<\/span>/.test(html), "old tablet revenue strip");
  }
});

test("a Cancelled card is still dimmed and rows keep their status colours at every width", async () => {
  for (const width of [390, 1024]) {
    const html = await render({ width });
    assert.match(html, /opacity:0\.55/);
    assert.match(html, /background-color:#4F7C3A/); // the Delivered rail
  }
});

// ---- columns ---------------------------------------------------------------------------

test("phone (including 652-719px): one column, the original flex column", async () => {
  for (const width of [390, 600, 652, 719]) {
    const html = await render({ width });
    assert.ok(html.includes(FLEX_COLUMN), `${width}: flex column`);
    assert.ok(!html.includes(WIDE_GRID), `${width}: no grid`);
  }
});

test("tablet without a detail open: columns (320px minimum, 11px gap)", async () => {
  for (const width of [720, 768, 1024, 1180]) {
    const html = await render({ width });
    assert.ok(html.includes(WIDE_GRID), `${width}: grid`);
    assert.ok(/grid-template-columns:repeat\(auto-fill, ?minmax\(min\(100%, ?320px\), ?1fr\)\);gap:11px;padding:8px 18px 120px/.test(html), `${width}: gap and padding`);
    assert.ok(!html.includes(FLEX_COLUMN), `${width}: not the phone column`);
  }
});

test("tablet with a detail open (split view): the list pane stays one column", async () => {
  for (const width of [1024, 1180]) {
    const html = await render({ width, route: "/m/sales/so-2", routePath: "/m/sales/:id" });
    assert.ok(html.includes(FLEX_COLUMN), `${width}: one column in the pane`);
    assert.ok(!html.includes(WIDE_GRID), `${width}: no grid in the pane`);
  }
});

test("a split view that is NOT possible (768): a detail route still lists as columns", async () => {
  // At 768 the detail is a full screen, so the list is not shown in a pane there.
  const html = await render({ width: 768, route: "/m/sales/so-2", routePath: "/m/sales/:id" });
  assert.ok(html.includes(WIDE_GRID));
});

test("the same cards in the same order whatever the arrangement", async () => {
  const order = (html) => [...html.matchAll(/SO-2610-000(\d)/g)].map((m) => m[1]);
  const a = order(await render({ width: 390 }));
  const b = order(await render({ width: 1024 }));
  assert.deepEqual(a, b);
  assert.ok(a.length >= 6);
});

// ---- empty and filtered states -----------------------------------------------------------

test("empty list: the same prompt at every width", async () => {
  for (const width of [390, 1024]) {
    const t = text(await render({ width, list: { success: true, data: [] } }));
    assert.ok(t.includes("No sales orders. Tap ＋ to create one."), String(width));
  }
});

// ---- the Sort the tablet list had ----------------------------------------------------------

const imp = (p) => import(pathToFileURL(resolvePath(process.cwd(), p)).href);
const { SalesFilterSheet } = await imp("src/pages/m/screens/SalesFilterSheet.tsx");
const { salesConfig } = await imp("src/pages/m/config/modules.ts");

function sheet(props) {
  const columns = salesConfig.sources[0].columns;
  return renderToStaticMarkup(
    h(SalesFilterSheet, { open: true, onClose() {}, columns, rows: [], search: "", filters: {}, chip: "all", chipKeys: [], onApply() {}, ...props }),
  );
}

test("the phone sheet has no Sort section; wider screens add it with every column, both directions, and None", () => {
  const phone = text(sheet({}));
  assert.ok(!phone.includes("Sort by"));
  const wide = text(sheet({ withSort: true, sort: { key: "expectedDD", dir: "asc" } }));
  assert.ok(wide.includes("Sort by"));
  for (const col of salesConfig.sources[0].columns) {
    assert.ok(wide.includes(`${col.label} ↑`) && wide.includes(`${col.label} ↓`), col.label);
  }
  assert.ok(wide.includes("None"));
  // The current sort is the one marked on.
  const html = sheet({ withSort: true, sort: { key: "expectedDD", dir: "asc" } });
  const on = [...html.matchAll(/aria-checked="true"[^>]*>(?:<[^>]+>)*([^<]*)/g)].map((m) => m[1]);
  assert.ok(on.some((t) => t.includes("↑")), "an ascending choice is on");
});

test("the Sort section sits above the filters, and the phone sheet is otherwise identical", () => {
  const wide = text(sheet({ withSort: true, sort: null }));
  assert.ok(wide.indexOf("Sort by") < wide.indexOf("Expected DD"));
  const strip = (s) => s.replace(/<section aria-label="Sort by">[\s\S]*?<\/section>/, "");
  // Remove the Sort section and the markup equals the phone sheet's.
  assert.equal(strip(sheet({ withSort: true, sort: null })), sheet({}));
});
