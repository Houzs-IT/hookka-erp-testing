// IT Support: which part of Hookka a request is about, named after the sidebar groups.
import test from "node:test";
import assert from "node:assert/strict";

const { itModuleIndex, moduleName } = await import("../src/lib/it-support-module.ts");

const GROUPS = [
  { label: "OVERVIEW", items: [{ href: "/dashboard-experimental" }] },
  { label: "SALES & CUSTOMERS", items: [{ href: "/sales" }, { href: "/consignment", children: [{ href: "/consignment/note" }] }] },
  { label: "PRODUCTS & BOM", items: [{ href: "/products" }, { href: "/bom/wip-times" }] },
  { label: "PRODUCTION", items: [{ href: "/production", children: [{ href: "/production/fab-cut" }] }] },
  { label: "R&D", items: [{ href: "/rd" }] },
  { label: "FINANCE", items: [{ href: "/accounting?tab=pl" }] },
];

test("group labels read as names, acronyms kept", () => {
  assert.equal(moduleName("SALES & CUSTOMERS"), "Sales & Customers");
  assert.equal(moduleName("PRODUCTS & BOM"), "Products & BOM");
  assert.equal(moduleName("R&D"), "R&D");
});

test("a page maps to its sidebar group, from a path or a full address", () => {
  const { moduleFor } = itModuleIndex(GROUPS);
  assert.equal(moduleFor("/sales/SO-001"), "Sales & Customers");
  assert.equal(moduleFor("https://erp.hookka.com/consignment/note?x=1"), "Sales & Customers");
  assert.equal(moduleFor("/production/fab-cut"), "Production");
  assert.equal(moduleFor("/accounting?tab=gl"), "Finance");
  assert.equal(moduleFor("/it-support"), "");
  assert.equal(moduleFor(""), "");
});

test("the picker lists every group once, in sidebar order", () => {
  assert.deepEqual(itModuleIndex(GROUPS).options, ["Overview", "Sales & Customers", "Products & BOM", "Production", "R&D", "Finance"]);
});
