// MRP port (owner 2026-11-23): netting order, per-WIP deduction slices, and
// the merged material tabs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { netMaterial, statusOf } from "../src/lib/mrp-netting.ts";
import { mrpGroupOf, mrpGroupTabs } from "../src/lib/mrp-groups.ts";

const d = (sortKey, required, needBy) => ({ rmId: "rm1", required, needBy, sortKey });

test("earliest need-by takes stock first, then the earliest PO, the rest is short", () => {
  const out = netMaterial(
    [d("SO-3", 6, "2026-12-05"), d("SO-1", 5.5, "2026-11-27"), d("SO-2", 6, "2026-11-28"), d("SO-4", 5.5, "2026-12-06")],
    11.5,
    [
      { rmId: "rm1", ref: "PO-LATE", eta: "2026-12-10", qty: 100 },
      { rmId: "rm1", ref: "PO-EARLY", eta: "2026-12-01", qty: 6 },
    ],
  );
  assert.deepEqual(out.map((a) => a.demand.sortKey), ["SO-1", "SO-2", "SO-3", "SO-4"]);
  assert.deepEqual(out[0].covers, [{ source: "STOCK", qty: 5.5 }]);
  assert.deepEqual(out[1].covers, [{ source: "STOCK", qty: 6 }]);
  assert.deepEqual(out[2].covers, [{ source: "PO", ref: "PO-EARLY", eta: "2026-12-01", qty: 6 }]);
  assert.deepEqual(out[3].covers, [{ source: "PO", ref: "PO-LATE", eta: "2026-12-10", qty: 5.5 }]);
  assert.deepEqual(out.map(statusOf), ["READY", "READY", "WAITING_PO", "WAITING_PO"]);
});

test("no PO and not enough stock → short; negative stock counts as zero", () => {
  const [a, b] = netMaterial([d("A", 3, "2026-11-25"), d("B", 4, "2026-11-26")], 5, []);
  assert.equal(a.shortQty, 0);
  assert.equal(b.shortQty, 2);
  assert.equal(statusOf(b), "SHORT");
  const [c] = netMaterial([d("C", 2, "")], -10, []);
  assert.equal(c.shortQty, 2);
});

test("an order with no date is served last", () => {
  const out = netMaterial([d("NODATE", 5, ""), d("DATED", 5, "2026-12-31")], 5, []);
  assert.equal(out[0].demand.sortKey, "DATED");
  assert.equal(out[0].shortQty, 0);
  assert.equal(out[1].shortQty, 5);
});

test("MRP tabs merge sofa + bedframe and keep new categories as their own tab", () => {
  assert.equal(mrpGroupOf("B.M-FABR"), "Fabric");
  assert.equal(mrpGroupOf("S.M-FABR"), "Fabric");
  assert.equal(mrpGroupOf("WD STRIP"), "Wood");
  assert.equal(mrpGroupOf("PLYWOOD"), "Wood");
  assert.equal(mrpGroupOf("S.MECH"), "Mechanism");
  assert.equal(mrpGroupOf("B.MECHAN"), "Mechanism");
  assert.equal(mrpGroupOf("B.WEBB"), "Webbing");
  assert.equal(mrpGroupOf("S.ACC"), "Accessories");
  assert.deepEqual(mrpGroupTabs(["S.FILLER", "NEW-GRP", "B.M-FABR", "OTHERS", "S.OTHERS"]), [
    "Fabric",
    "Filler",
    "Others",
    "NEW-GRP",
  ]);
});

test("each WIP deducts its own materials when its job card completes (consume dept)", async () => {
  const { consumeDeptOf } = await import("../src/api/lib/po-cost-cascade.ts");
  assert.equal(consumeDeptOf(["FAB_CUT"]), "FAB_CUT");
  assert.equal(consumeDeptOf(["FIBRE"]), "FIBRE");
  // a node listing several depts consumes at the earliest one
  assert.equal(consumeDeptOf(["WEBBING", "FAB_SEW", "WOOD_CUT"]), "FAB_SEW");
  // no owner info (legacy BOM shapes) keeps the old first-Fab-Cut behaviour
  assert.equal(consumeDeptOf(undefined), "FAB_CUT");
});

test("every job-card completion path deducts per WIP, not only Fab Cut", () => {
  const helpers = readFileSync(new URL("../src/api/routes/production-orders/_helpers.ts", import.meta.url), "utf8");
  assert.doesNotMatch(helpers, /if \(updated\.departmentCode === "FAB_CUT"\) \{\s*try \{\s*const rm = await consume/);
  assert.match(helpers, /consumeRawMaterialsForJobCard\(db, existing\.id, \{/);
  const scans = readFileSync(new URL("../src/api/routes/production-orders.ts", import.meta.url), "utf8");
  // all four scan completion sites (postJobCardLabor) also deduct RM
  assert.equal((scans.match(/await consumeRmForScannedJc\(/g) ?? []).length, 4);
});

test("a PO deducted under the old whole-PO rule is never deducted again", () => {
  const src = readFileSync(new URL("../src/api/lib/po-cost-cascade.ts", import.meta.url), "utf8");
  assert.match(src, /if \(issued\.has\(id\) && st\.consumed\.size === 0\) st\.legacyConsumed = true;/);
  assert.match(src, /ON CONFLICT \(po_id, wip_key, dept_code\) DO NOTHING/);
  // the slice is claimed BEFORE any stock write
  const claimAt = src.indexOf("await claimSlice(");
  const fifoAt = src.indexOf("await fifoConsumeLines(db, po, claimed)");
  assert.ok(claimAt > 0 && fifoAt > claimAt);
});

test("BUG-548: an open PO in another unit (ROLL vs MTR) is shown, never netted as metres", async () => {
  const { normUnit } = await import("../src/api/lib/mrp-plan.ts");
  assert.equal(normUnit("METER"), "MTR");
  assert.equal(normUnit("mtr"), "MTR");
  assert.equal(normUnit("ROLL"), "ROLL");
  assert.notEqual(normUnit("ROLL"), normUnit("MTR"));
  const engine = readFileSync(new URL("../src/api/lib/mrp-plan.ts", import.meta.url), "utf8");
  assert.match(engine, /if \(lineUnit && normUnit\(lineUnit\) !== rmUnitOf\(rm\)\) \{/);
  const page = readFileSync(new URL("../src/pages/planning/mrp.tsx", import.meta.url), "utf8");
  assert.match(page, /Also on order in another unit — not counted/);
});

test("the per-WIP deduction can be audited without DB access", () => {
  const route = readFileSync(new URL("../src/api/routes/mrp.ts", import.meta.url), "utf8");
  assert.match(route, /app\.get\("\/consume-log"/);
  assert.match(route, /FROM rm_consume_marks m/);
});

// ---- Full Houzs-parity MRP (owner 2026-11-23 「可以了 去做吧」) ----
const page = () => readFileSync(new URL("../src/pages/planning/mrp.tsx", import.meta.url), "utf8");
const route = () => readFileSync(new URL("../src/api/routes/mrp.ts", import.meta.url), "utf8");

test("Proceed PO creates REAL POs, Combined per supplier or Per SO per supplier per order", () => {
  const src = page();
  assert.match(src, /const gk = mode === "combined" \? p\.line\.supplierId : `\$\{p\.line\.supplierId\}\|\$\{p\.line\.productionOrderId\}`;/);
  assert.match(src, /status: "CONFIRMED",/);
  assert.match(src, /"Idempotency-Key": `mrp-\$\{plan\.calculatedAt\}-\$\{g\.key\}`/);
});

test("the stale-plan check runs BEFORE any PO or binding is written", () => {
  const src = page();
  const chk = src.indexOf("/api/mrp/plan-check?asOf=");
  const bind = src.indexOf('fetch("/api/supplier-materials"');
  const po = src.indexOf('fetch("/api/purchase-orders"');
  assert.ok(chk > 0 && bind > chk && po > bind);
  assert.match(route(), /app\.get\("\/plan-check"/);
  assert.match(route(), /WHERE po\.created_at > \?/);
});

test("a supplier picked for an unbound material is bound to it (owner option 2)", () => {
  const src = page();
  assert.match(src, /<optgroup label="Other suppliers \(will be bound\)">/);
  assert.match(src, /if \(!res\.ok && res\.status !== 409\)/);
});

test("Lead Times are saved per supplier and drive the order-by date", () => {
  assert.match(route(), /app\.put\("\/lead-times"/);
  assert.match(route(), /n < 0 \|\| n > 365/);
  assert.match(page(), /orderBy: minusDays\(o\.needBy, lead\)/);
});

test("dates follow the system standard dd/mm/yyyy", () => {
  assert.match(page(), /const dmy = \(iso: string\): string => \(iso && iso\.length >= 10 \? `\$\{iso\.slice\(8, 10\)\}\/\$\{iso\.slice\(5, 7\)\}\/\$\{iso\.slice\(0, 4\)\}` : "—"\);/);
  assert.doesNotMatch(page(), /month: "short"/);
});

test("Houzs toolbar: date type, From/To, no-date, shortages, export all / current tab, wrap, columns, filters", () => {
  const src = page();
  for (const s of ['value="orderBy"', 'value="due"', 'value="soDate"', "SHOW NO-DATE", "ONLY SHORTAGES", "EXPORT ALL", "EXPORT CURRENT TAB", "WRAP", "FILTERS", "Columns ·", "COMBINED", "PER SO", "COLLAPSE", "EXPAND", "LEAD TIMES", "Proceed PO ("]) {
    assert.ok(src.includes(s), `missing ${s}`);
  }
});

test("Production Tracking keeps its columns and only ADDS a Stock column", () => {
  const prod = readFileSync(new URL("../src/pages/production/index.tsx", import.meta.url), "utf8");
  assert.match(prod, /\}>\("\/api\/mrp\/stock-status"\);/);
  assert.match(prod, /key: "stockStatus",\s*label: "Stock",/);
  assert.match(prod, /stockStatus\[`\$\{row\.poId\}\|\$\{row\.wipKey \?\? ""\}`\] \?\? stockStatus\[`\$\{row\.poId\}\|`\]/);
  assert.match(route(), /app\.get\("\/stock-status"/);
});
