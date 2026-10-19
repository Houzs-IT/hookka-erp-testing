// ---------------------------------------------------------------------------
// m-receivables-aging-total.test.mjs — BUG-2026-10-17-307.
//
// The phone's Receivables list (/m/receivables) reads /api/accounting/aging.
// Each AR row carries five buckets (currentSen, days30Sen, days60Sen,
// days90Sen, over90Sen) and no total, but the list read `total` / `totalSen`,
// so every debtor showed "Outstanding RM 0.00" and the sort by outstanding
// sorted nothing. The outstanding is now the sum of the five buckets, the same
// figure as the desktop Debtor Aging's Total column. Made-up figures.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

try {
  register("tsx/esm", pathToFileURL("./"));
} catch {
  // Native type-stripping handles it on newer Node.
}
register("./tests/_alias-loader.mjs", pathToFileURL("./"));
// The config pulls in cached-fetch, which reads Vite's build id.
globalThis.__BUILD_ID__ = "test";
const { receivablesConfig } = await import(pathToFileURL(resolve(process.cwd(), "src/pages/m/config/modules.ts")).href);

const ROW = { customerId: "c-1", customerName: "Kedai Perabot", currentSen: 120000, days30Sen: 30000, days60Sen: 5000, days90Sen: 0, over90Sen: -2500, docs: [] };

test("BUG-307: a debtor's outstanding is the sum of its five aging buckets", () => {
  const src = receivablesConfig.sources[0];
  assert.equal(src.url, "/api/accounting/aging");
  const vm = src.toVM(ROW);
  assert.equal(vm.title, "Kedai Perabot");
  assert.equal(vm.meta1.label, "Outstanding");
  // The formatter may put a no-break space after "RM".
  assert.equal(vm.meta1.value.replace(/\s/g, " "), "RM 1,525.00", "1,200 + 300 + 50 + 0 − 25");
});

test("BUG-307: the Outstanding column sorts on the same figure", () => {
  const col = receivablesConfig.sources[0].columns.find((c) => c.key === "total");
  assert.ok(col, "the Outstanding column");
  const get = col.get ?? col.value ?? col.accessor;
  assert.equal(typeof get, "function");
  assert.equal(get(ROW), 152500);
  assert.equal(get({ customerId: "c-2", customerName: "Empty", docs: [] }), 0);
});
