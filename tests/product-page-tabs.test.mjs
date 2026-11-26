// ---------------------------------------------------------------------------
// product-page-tabs.test.mjs — owner 2026-11-22 (plan D12/D13): click a
// product row = the dropdown as before; double-click = the product page with
// tabs BOM / Costing / Customers / Documents; a Costing button sits beside
// View BOM; Customer Assignments is one shared component.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p) => readFileSync(resolve(process.cwd(), p), "utf8");

test("routes: costing and customers pages exist next to bom and documents", () => {
  const r = read("src/dashboard-routes.tsx");
  for (const tab of ["bom", "documents", "costing", "customers"]) {
    assert.match(r, new RegExp(`path: '/products/:id/${tab}'`));
  }
});

test("Products list: click still toggles the dropdown, double-click opens the product, not while typing", () => {
  const p = read("src/pages/products/index.tsx");
  assert.match(p, /onRowClick=\{\(r\) => setExpandedId\(\(cur\) => \(cur === r\.id \? null : r\.id\)\)\}/);
  assert.match(p, /onDoubleClick=\{\(r\) => \{[\s\S]{0,200}INPUT\|TEXTAREA\|SELECT[\s\S]{0,120}navigate\(`\/products\/\$\{encodeURIComponent\(r\._p\.id\)\}\/\$\{canSeeCosting \? "costing" : "bom"\}`\)/);
  // Costing link only for Admin / Finance / R&D (owner 2026-11-26); others land on the BOM.
  assert.match(p, /View BOM\s*<\/Link>\s*\{canSeeCosting && \(\s*<Link to=\{`\/products\/\$\{p\.id\}\/costing`\}/);
});

test("dropdown keeps everything it had (owner: dropdown information remains)", () => {
  const p = read("src/pages/products/index.tsx");
  // Round 2 (owner-approved design ④, 2026-11-22): the labour-only "Price vs
  // Labor" box became cost tiles on total cost; everything else stays.
  for (const s of ["Labour", "Total cost", "View BOM", "Manage Variants", "<CustomerAssignmentsSection", "CncTemplatePanel"]) {
    assert.ok(p.includes(s), s);
  }
  assert.doesNotMatch(p, /function CustomerAssignmentsSection\(/, "moved to its own file, not duplicated");
  assert.match(read("src/pages/products/customer-assignments.tsx"), /export function CustomerAssignmentsSection\(/);
});

test("every product page shows the same tab strip", () => {
  for (const [file, tab] of [["bom", "bom"], ["documents", "documents"]]) {
    assert.match(read(`src/pages/products/${file}.tsx`), new RegExp(`<ProductTabStrip productId=\{product\.id\} active="${tab}" />`));
  }
  assert.match(read("src/pages/products/costing.tsx"), /active="costing"/);
  assert.match(read("src/pages/products/customers.tsx"), /active="customers"/);
});

test("costing page: no price is never shown as RM 0; only Set-as-standard writes", () => {
  const c = read("src/pages/products/costing.tsx");
  assert.match(c, /m\.priceSen == null \? <span className="font-semibold text-\[#B91C1C\]">No price<\/span>/);
  assert.match(c, /m\.amountSen == null \? "—"/);
  // The only write is "Set as standard" (D3), behind a confirm; the calculator writes nothing.
  assert.equal((c.match(/method: "(POST|PUT|PATCH|DELETE)"/g) ?? []).length, 1);
  assert.match(c, /await confirm\(\{[\s\S]{0,800}\/standard[\s\S]{0,200}method: "POST"/);
});
