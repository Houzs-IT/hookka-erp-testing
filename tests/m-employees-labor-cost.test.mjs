// m-employees-labor-cost.test.mjs — HK-0125 Phase 5b: Employees → Labor Cost. Sample values only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  catLabel,
  computeLaborCost,
  costRatio,
  filterUnits,
  groupUnits,
  overheadBucket,
  parseLcCategory,
  productionDeptCount,
  revenueUnits,
} from "../src/pages/m/screens/employees/labor-cost-model.ts";
import { computeDepartmentLabor } from "../src/pages/m/screens/employees/department-labor-model.ts";

const src = (p) => readFileSync(new URL(`../src/pages/m/screens/employees/${p}`, import.meta.url), "utf8");
const strip = (s) => s.replace(/^\s*\/\/.*$/gm, "");

// October 2026: 27 Mon-Sat working days (1 Oct = Thu, Sundays 4/11/18/25). 6 Oct = Tue, 7 Oct = Wed, 4 Oct = Sun.
const OCT = { from: "2026-10-01", to: "2026-10-31" };
const DEPTS = [
  { code: "UPH", name: "Upholstery", isProduction: true, sequence: 1 },
  { code: "FRM", name: "Framing", isProduction: true, sequence: 2 },
  { code: "WAREHOUSING", name: "Warehousing", isProduction: false, sequence: 8 },
  { code: "PRODUCTION_SHORTFALL", name: "Production Shortfall", isProduction: false, sequence: 9 },
  { code: "REPAIR", name: "Repair", isProduction: false, sequence: 10 },
];
const W = (id, o = {}) => ({ id, status: "ACTIVE", departmentCode: "UPH", basicSalarySen: 260000, workingHoursPerDay: 9, workingDaysPerMonth: 26, otMultiplier: 1.5, ...o });
const E = (workerId, date, departmentCode, hours, category = "") => ({ workerId, date, departmentCode, hours, category });
const input = (o = {}) => ({ entries: [], workers: [W("a")], depts: DEPTS, holidays: [], versions: [], effSalary: {}, range: OCT, category: "", byDeptCategory: null, costDataOk: true, ...o });
const REG = 260000 / 27 / 9;
const OTB = 260000 / 26 / 9;
const row = (res, code, cat) => [...res.production, ...res.overhead].find((r) => r.deptCode === code && r.category === cat);

test("desktop Labor Cost costing: (department, category) buckets; regular, weekday OT and Sunday OT (worked examples)", () => {
  const res = computeLaborCost(input({
    entries: [E("a", "2026-10-06", "UPH", 9, "SOFA"), E("a", "2026-10-07", "UPH", 10, "SOFA"), E("a", "2026-10-04", "FRM", 8, "BEDFRAME")],
  }));
  const sofa = 9 * REG + (9 * REG + OTB * 1.5); // the second day has 1 OT hour at 1.5x
  assert.equal(row(res, "UPH", "SOFA").costSen, Math.round(sofa));
  assert.equal(row(res, "UPH", "SOFA").hours, 19);
  assert.equal(row(res, "FRM", "BEDFRAME").costSen, Math.round(8 * OTB * 2), "Sunday: every hour OT at the Sunday multiplier");
  assert.equal(res.productionSen, Math.round(sofa) + Math.round(8 * OTB * 2));
  assert.equal(res.mode, "ok");
});

test("uses the SHARED worker-day function: hours after a resignation date cost nothing (the Department Labor tab's own loop still costs them)", () => {
  const entries = [E("a", "2026-10-06", "UPH", 9, "SOFA"), E("a", "2026-10-13", "UPH", 9, "SOFA")];
  const workers = [W("a", { resignedAt: "2026-10-09" })];
  const lc = computeLaborCost(input({ entries, workers }));
  assert.equal(row(lc, "UPH", "SOFA").costSen, Math.round(9 * REG), "the 13 Oct day is after the last paid day, so it costs 0");
  assert.equal(row(lc, "UPH", "SOFA").hours, 18, "its hours are still counted");
  const dl = computeDepartmentLabor({ entries, workers, depts: DEPTS, holidays: [], versions: [], effSalary: {}, payslips: null, docks: null, range: OCT, category: "", today: "2026-10-20", costDataOk: true });
  assert.equal(dl.rows.find((r) => r.deptCode === "UPH").costSen, Math.round(18 * REG), "desktop's Department Labor costs both days: the two tabs differ here, as on desktop");
});

test("daily-paid workers cost the day rate; no-salary and unknown workers are skipped", () => {
  const res = computeLaborCost(input({
    workers: [W("d", { payMode: "DAILY", dailyRateSen: 8000, basicSalarySen: 0 }), W("n", { basicSalarySen: 0 })],
    entries: [E("d", "2026-10-06", "UPH", 6, "SOFA"), E("d", "2026-10-06", "FRM", 2, "BEDFRAME"), E("n", "2026-10-06", "UPH", 8, "SOFA"), E("ghost", "2026-10-06", "UPH", 8, "SOFA")],
  }));
  assert.equal(row(res, "UPH", "SOFA").costSen, 6000);
  assert.equal(row(res, "FRM", "BEDFRAME").costSen, 2000);
  assert.equal(row(res, "UPH", "SOFA").hours, 6);
});

test("category filter keeps that category AND the uncategorised overhead entries", () => {
  const entries = [E("a", "2026-10-06", "UPH", 3, "SOFA"), E("a", "2026-10-06", "FRM", 3, "BEDFRAME"), E("a", "2026-10-06", "REPAIR", 3, "")];
  const res = computeLaborCost(input({ entries, category: "SOFA" }));
  assert.deepEqual(res.production.map((r) => [r.deptCode, r.category]), [["UPH", "SOFA"]]);
  assert.deepEqual(res.overhead.map((r) => r.deptCode), ["REPAIR"], "overhead is not category-tagged, so it always shows");
});

test("rows follow the department order, then Sofa, Bedframe, Accessory; production and overhead are split by the department's flag", () => {
  const res = computeLaborCost(input({
    entries: [E("a", "2026-10-06", "FRM", 1, "BEDFRAME"), E("a", "2026-10-06", "UPH", 1, "ACCESSORY"), E("a", "2026-10-06", "UPH", 1, "SOFA"), E("a", "2026-10-06", "UPH", 1, "BEDFRAME"), E("a", "2026-10-06", "REPAIR", 1, ""), E("a", "2026-10-06", "WAREHOUSING", 1, "")],
  }));
  assert.deepEqual(res.production.map((r) => `${r.deptCode}|${r.category}`), ["UPH|SOFA", "UPH|BEDFRAME", "UPH|ACCESSORY", "FRM|BEDFRAME"]);
  assert.deepEqual(res.overhead.map((r) => r.deptCode), ["WAREHOUSING", "REPAIR"]);
});

test("the Production Breakdown header counts DISTINCT departments, not (department, category) rows", () => {
  const res = computeLaborCost(input({ entries: [E("a", "2026-10-06", "UPH", 1, "SOFA"), E("a", "2026-10-06", "UPH", 1, "BEDFRAME"), E("a", "2026-10-06", "UPH", 1, "ACCESSORY"), E("a", "2026-10-06", "FRM", 1, "BEDFRAME")] }));
  assert.equal(res.production.length, 4);
  assert.equal(productionDeptCount(res.production), 2);
  assert.equal(productionDeptCount([]), 0);
  const ui = strip(src("LaborCostSection.tsx"));
  assert.match(ui, /productionDeptCount\(prodRows\)/);
  assert.match(ui, /department\$\{deptCount === 1 \? "" : "s"\} - /);
});

test("revenue: each production row carries its department's slice; overhead and uncategorised rows carry none; cost / revenue colours", () => {
  const res = computeLaborCost(input({ entries: [E("a", "2026-10-06", "UPH", 9, "SOFA"), E("a", "2026-10-06", "REPAIR", 1, "")], byDeptCategory: { "UPH|SOFA": 50000, "REPAIR|": 999 } }));
  assert.equal(row(res, "UPH", "SOFA").revenueSen, 50000);
  assert.equal(row(res, "REPAIR", "").revenueSen, 0);
  assert.equal(computeLaborCost(input({ entries: [E("a", "2026-10-06", "UPH", 9, "SOFA")], byDeptCategory: null })).production[0].revenueSen, 0, "no revenue access: no slice");
  assert.deepEqual(costRatio(30001, 100000), { text: "30.0%", fg: "#9A3A2D" });
  assert.equal(costRatio(25000, 100000).fg, "#85600F");
  assert.equal(costRatio(20000, 100000).fg, "#3D6229", "exactly 20 % is green; only over 20 % is amber");
  assert.deepEqual(costRatio(500, 0), { text: "—", fg: "#1F1D1B" });
  assert.equal(costRatio(0, 1000).text, "—", "no labor against a revenue slice reads — (desktop)");
});

test("overhead buckets: Shortfall (red), Borrowed (Warehousing) (amber), everything else Overhead (grey)", () => {
  assert.equal(overheadBucket({ isShortfall: true, isWarehousing: false }).label, "Shortfall");
  assert.equal(overheadBucket({ isShortfall: false, isWarehousing: true }).label, "Borrowed (Warehousing)");
  assert.equal(overheadBucket({ isShortfall: false, isWarehousing: false }).label, "Overhead");
  const res = computeLaborCost(input({ entries: [E("a", "2026-10-06", "PRODUCTION_SHORTFALL", 1, ""), E("a", "2026-10-06", "WAREHOUSING", 1, ""), E("a", "2026-10-06", "REPAIR", 1, "")] }));
  assert.deepEqual(res.overhead.map((r) => [r.isShortfall, r.isWarehousing]), [[false, true], [true, false], [false, false]]);
  assert.equal(res.overheadSen, res.overhead.reduce((s, r) => s + r.costSen, 0));
});

test("cost data missing: hours only and 'unavailable', never a guessed number", () => {
  const res = computeLaborCost(input({ costDataOk: false, entries: [E("a", "2026-10-06", "UPH", 9, "SOFA")] }));
  assert.equal(res.mode, "unavailable");
  assert.equal(row(res, "UPH", "SOFA").hours, 9);
  assert.equal(row(res, "UPH", "SOFA").costSen, 0);
  assert.equal(res.productionSen, 0);
  const ui = strip(src("LaborCostSection.tsx"));
  assert.match(ui, /"Unavailable"/);
});

test("revenue units: category filter (trimmed, upper-cased), newest first, search by product / customer / SO, grouped by date", () => {
  const rows = [
    { date: "2026-10-03", productCode: "5530", productName: "Aspen Sofa", category: "sofa ", customerName: "Desa Interior", soNo: "SO-1", qty: 1, unitPriceSen: 330000, totalPriceSen: 330000 },
    { date: "2026-10-05", productCode: "HB-1", productName: "Harbour Bed", category: "BEDFRAME", customerName: "Mewah Home", soNo: "SO-2", qty: 2, unitPriceSen: 189000, totalPriceSen: 378000 },
    { date: "2026-10-05", productCode: "SC-9", productName: "", category: "ACCESSORY", customerName: "Desa Interior", soNo: "SO-3", qty: 12, unitPriceSen: 4500, totalPriceSen: 54000 },
  ];
  assert.deepEqual(revenueUnits(rows, "").map((u) => u.soNo), ["SO-2", "SO-3", "SO-1"]);
  assert.deepEqual(revenueUnits(rows, "SOFA").map((u) => u.soNo), ["SO-1"], "a lower-case or padded category still matches");
  assert.deepEqual(filterUnits(rows, "desa").map((u) => u.soNo), ["SO-1", "SO-3"]);
  assert.deepEqual(filterUnits(rows, "so-2").map((u) => u.soNo), ["SO-2"]);
  assert.deepEqual(filterUnits(rows, "5530").map((u) => u.soNo), ["SO-1"], "the product code is searchable too");
  const g = groupUnits(revenueUnits(rows, ""));
  assert.deepEqual(g.map((x) => [x.date, x.units, x.totalSen]), [["2026-10-05", 2, 432000], ["2026-10-03", 1, 330000]]);
  assert.equal(catLabel("BEDFRAME"), "Bedframe");
  assert.equal(catLabel(""), "—");
  assert.equal(parseLcCategory("accessory"), "ACCESSORY");
  assert.equal(parseLcCategory("x"), "");
});

test("wiring: existing endpoints and gates; revenue needs revenue-figures:read and is not even requested without it; read-only", () => {
  const hook = strip(src("use-labor-cost.ts"));
  for (const url of ["/api/working-hour-entries?from=", "/api/workers", "/api/workers/salary/effective?period=", "/api/kv-config/public_holidays", "/api/pay-rules", "/api/departments", "/api/working-hour-entries/production-revenue?from="]) assert.ok(hook.includes(url), url);
  assert.match(hook, /hasPermission\("workers", "read"\) && hasPermission\("payslips", "read"\)/);
  assert.match(hook, /canRevenue = allowed && hasPermission\("revenue-figures", "read"\)/);
  assert.match(hook, /canRevenue \? `\/api\/working-hour-entries\/production-revenue/, "no request without the permission");
  const ui = strip(src("LaborCostSection.tsx"));
  assert.match(ui, /st\.revenue !== "locked"/, "revenue columns and the Revenue Raw Data card are skipped when locked");
  assert.match(ui, /Revenue figures need revenue-figures:read\./);
  assert.match(ui, /No access to Labor Cost/);
  assert.match(ui, /Production Breakdown/);
  assert.match(ui, /Overhead Breakdown/);
  assert.match(ui, /Revenue Raw Data/);
  assert.match(ui, /View all \{units\.length\} units/);
  assert.match(ui, /% = labor cost ÷ that department’s slice of category revenue\./);
  assert.match(ui, /useState<\{ prod: boolean; oh: boolean; rev: boolean \}>\(\{ prod: true, oh: false, rev: false \}\)/, "Production open, the others collapsed");
  assert.ok(!/method:|mutateJson|fetch\(/.test(ui + hook + strip(src("RevenueUnitsPage.tsx"))), "read-only");
  assert.match(strip(src("EmployeesRoute.tsx")), /section === "labor-cost" \? <LaborCostSection \/> : null/);
  assert.match(strip(src("EmployeesRoute.tsx")), /\.\.\.LC_PARAMS/);
});
