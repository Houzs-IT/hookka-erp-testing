// ---------------------------------------------------------------------------
// labor-cost-incl-payroll.test.mjs — the "Labor Cost incl. EPF & Allowances"
// card on Employees › Labor Cost vs Revenue (owner 2026-10-12).
//
// 「如果我要看到今天的工资包括津贴、雇主 EPF/SOCSO/EIS、缺勤和扣钱的差价，我哪里可以
// 看到？」→ method B →「但先确定原本的没有碰到对吗？我只是多一个 card 罢了是吗？」→
// 「做」. The five existing cards, the breakdown, the reconciliation and the print
// stay exactly as they were; this card is added beside them.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
try { register("tsx/esm", pathToFileURL("./")); } catch {}
const m = await import(pathToFileURL(resolve(process.cwd(), "src/lib/labor-cost-incl-payroll.ts")).href);

const UI = readFileSync(resolve(process.cwd(), "src/pages/employees.tsx"), "utf8").replace(/\r\n/g, "\n");

const payslips = [
  { id: "a", departmentCode: "FAB_SEW", grossSen: 230000, statutorySen: 10000, allowancesSen: 15000 },
  { id: "b", departmentCode: "UPHOLSTERY", grossSen: 205000, statutorySen: 0, allowancesSen: 0 },
  { id: "c", departmentCode: "OFFICE", grossSen: 300000, statutorySen: 39000, allowancesSen: 0 },
];
const factory = (code) => code !== "OFFICE";
const bridges = { a: 1200, b: -300, c: 999 };

test("a finished month is the payroll itself: gross + employer EPF / SOCSO / EIS", () => {
  const sen = m.laborCostInclPayroll({
    monthFinished: true, loggedSen: 123456, payslips, isFactoryDept: factory,
    bridgeSen: (id) => bridges[id], share: 0.5,
  });
  assert.equal(sen, 230000 + 10000 + 205000 + 0 + 300000 + 39000);
});

test("a running month: logged hours + allowances and statutory pro-rated + the bridges incurred so far", () => {
  const sen = m.laborCostInclPayroll({
    monthFinished: false, loggedSen: 400000, payslips, isFactoryDept: factory,
    bridgeSen: (id) => bridges[id], share: 1 / 3,
  });
  // factory: (15000 + 10000) / 3 + (0 + 0) / 3; bridges 1200 − 300.
  // office (logs no factory hours): (300000 + 39000) / 3; its own bridge is not used.
  assert.equal(sen, 400000 + Math.round((25000 + 339000) / 3) + 900);
});

test("the share of the month: working days logged so far over the month's working days, never above 1", () => {
  assert.equal(m.loggedDayShare(9, 27), 1 / 3);
  assert.equal(m.loggedDayShare(30, 27), 1);
  assert.equal(m.loggedDayShare(0, 27), 0);
  assert.equal(m.loggedDayShare(5, 0), 0);
});

test("the card sits after Total Labor Cost and only when a whole, un-filtered month can be read", () => {
  assert.match(UI, /<p className="text-xs text-\[#6B7280\]">Total Labor Cost<\/p>[\s\S]{0,300}?\{fullCostCard && \(/);
  assert.match(UI, />Labor Cost incl\. EPF &amp; Allowances</);
  assert.match(UI, /if \(categoryFilter \|\| !isFullSingleMonth\(from, to\)\) return null;/);
  assert.match(UI, /laborCostInclPayroll\(\{/);
});

test("a running month without generated payslips reads the same live estimate the Payroll tab shows", () => {
  assert.match(UI, /`\/api\/payslips\/projected\?period=\$\{payrollPeriod\}`/);
  assert.match(UI, /const bridgePayslips = reconPayslips\.length > 0 \? reconPayslips : projectedPayslips;/);
});

test("the original cards are untouched", () => {
  assert.match(UI, /<p className="text-lg font-bold text-\[#1F1D1B\]">\{formatCurrency\(totalLaborCostSen\)\}<\/p>/);
  assert.match(UI, /<p className="text-lg font-bold text-\[#1F1D1B\]">\{formatCurrency\(totalLaborCostSen - productionLaborCostSen\)\}<\/p>/);
  assert.match(UI, /formatCurrency\(totalRevenueSen - productionLaborCostSen\)/);
  // Six across only when all six are there; otherwise the strip keeps its five columns.
  assert.match(UI, /\$\{fullCostCard && canSeeRevenue \? "md:grid-cols-6" : "md:grid-cols-5"\}/);
  // The print mirrors the original strip — the new card is not printed.
  const print = UI.slice(UI.indexOf("const handlePrint = useCallback(() => {"), UI.indexOf("const handlePrint = useCallback(() => {") + 6000);
  assert.doesNotMatch(print, /fullCostCard|incl\. EPF/);
});
