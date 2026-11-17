// m-employees-department-performance.test.mjs — HK-0125 Phase 5a: Employees → Department Performance. Sample values only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  dayCards,
  dayUrl,
  dayWorkers,
  effColor,
  filterCount,
  kpiCells,
  listUrl,
  parseCategory,
  scopeTitle,
} from "../src/pages/m/screens/employees/department-performance-model.ts";

const src = (p) => readFileSync(new URL(`../src/pages/m/screens/employees/${p}`, import.meta.url), "utf8");
const strip = (s) => s.replace(/^\s*\/\/.*$/gm, "");

const range = { from: "2026-11-01", to: "2026-11-30" };

test("the list reads the SUMMARY view; the tapped day is the same endpoint and filters for that one date (full payload)", () => {
  assert.equal(listUrl(range, "UPH", "SOFA"), "/api/department-performance?view=summary&from=2026-11-01&to=2026-11-30&departmentCode=UPH&category=SOFA");
  assert.equal(dayUrl("2026-11-04", "UPH", "SOFA"), "/api/department-performance?from=2026-11-04&to=2026-11-04&departmentCode=UPH&category=SOFA");
  assert.ok(!dayUrl("2026-11-04", "UPH", "SOFA").includes("view=summary"), "the day needs the workers and jobs the summary drops");
  // All departments / all categories: empty filters, as desktop sends them
  assert.equal(listUrl(range, "", ""), "/api/department-performance?view=summary&from=2026-11-01&to=2026-11-30&departmentCode=&category=");
  assert.equal(dayUrl("2026-11-04", "", ""), "/api/department-performance?from=2026-11-04&to=2026-11-04&departmentCode=&category=");
});

test("categories: only SOFA and BEDFRAME exist on the API; anything else is 'all'", () => {
  assert.equal(parseCategory("sofa"), "SOFA");
  assert.equal(parseCategory("BEDFRAME"), "BEDFRAME");
  assert.equal(parseCategory("ACCESSORY"), "");
  assert.equal(parseCategory(null), "");
  assert.equal(filterCount("", ""), 0);
  assert.equal(filterCount("UPH", ""), 1);
  assert.equal(filterCount("UPH", "SOFA"), 2);
});

test("summary tiles: the server's figures, desktop's colours (>= 80 green, >= 60 amber, else red), '—' with no hours", () => {
  const k = kpiCells({ workerCount: 6, workingMinutes: 2400, productionMinutes: 2100, efficiencyPct: 87.5 });
  assert.deepEqual(k.map((x) => [x.l, x.v]), [["Workers", "6"], ["Hours worked", "40h"], ["Earned time", "35h"], ["Avg Efficiency", "87.5%"]]);
  assert.equal(k[3].fg, "#4F7C3A");
  assert.equal(effColor(79.9, true), "#9C6F1E");
  assert.equal(effColor(80, true), "#4F7C3A");
  assert.equal(effColor(60, true), "#9C6F1E");
  assert.equal(effColor(59.9, true), "#9A3A2D");
  assert.equal(effColor(99, false), "#9A9082", "no efficiency is grey, never red");
  const none = kpiCells({ workerCount: 0, workingMinutes: 0, productionMinutes: 0, efficiencyPct: 0 });
  assert.deepEqual(none.map((x) => x.v), ["0", "—", "—", "—"]);
  assert.deepEqual(kpiCells(null).map((x) => x.v), ["—", "—", "—", "—"], "still loading or unavailable: dashes, never zeros");
});

test("no 'Overall x% (incl. helpers)' line and no provenance caption on the phone (owner 2026-11-17); the tiles are four equal cells", () => {
  const ui = strip(src("DepartmentPerformanceSection.tsx") + src("DeptPerfDayPage.tsx") + src("department-performance-model.ts"));
  assert.ok(!/Overall|incl\. helpers|measured duration|standard minutes earned|provenance/.test(ui));
  const k = kpiCells({ workerCount: 1, workingMinutes: 600, productionMinutes: 500, efficiencyPct: 83.3, overallPct: 70, helperWorkingMinutes: 120 });
  assert.equal(k.length, 4);
  assert.ok(k.every((x) => Object.keys(x).sort().join() === "fg,l,v"), "a tile is a label and a value only");
  const section = strip(src("DepartmentPerformanceSection.tsx"));
  assert.match(section, /minHeight: 66/);
  assert.match(section, /repeat\(2, minmax\(0, 1fr\)\)/);
});

test("day cards: newest first (the HTML; the API sends oldest first), one decimal, '—' for a day with no hours", () => {
  const cards = dayCards([
    { date: "2026-11-02", workingMinutes: 520, productionMinutes: 440, efficiencyPct: 84.6 },
    { date: "2026-11-04", workingMinutes: 0, productionMinutes: 0, efficiencyPct: 0 },
    { date: "2026-11-03", workingMinutes: 600, productionMinutes: 330, efficiencyPct: 55 },
  ]);
  assert.deepEqual(cards.map((c) => c.label), ["04/11/2026", "03/11/2026", "02/11/2026"]);
  assert.deepEqual(cards.map((c) => c.eff), ["—", "55.0%", "84.6%"]);
  assert.deepEqual(cards.map((c) => c.fg), ["#9A9082", "#9A3A2D", "#4F7C3A"]);
  assert.deepEqual([cards[2].hours, cards[2].earned], ["8h 40m", "7h 20m"]);
  assert.deepEqual([cards[0].hours, cards[0].earned], ["—", "—"]);
});

test("day detail workers: most hours first; a helper keeps the Helper flag and shows '—'; a worker's % has no decimals (desktop)", () => {
  const w = dayWorkers({
    date: "2026-11-04",
    workingMinutes: 1500,
    productionMinutes: 1000,
    efficiencyPct: 66.7,
    workers: [
      { workerId: "b", workerName: "Bob", workingMinutes: 300, productionMinutes: 210, efficiencyPct: 70, jobs: [{ jobCardId: "j1", productCode: "HB-1", productName: "Bedframe", wipLabel: "", poNo: "PO-9", productionMinutes: 30 }, { jobCardId: "j2", productCode: "SF-2", productName: "Sofa", wipLabel: "Seat cushion", poNo: null, productionMinutes: 180 }] },
      { workerId: "h", workerName: "Hal", workingMinutes: 540, productionMinutes: 600, efficiencyPct: 111, isHelper: true, jobs: [] },
      { workerId: "z", workerName: "Zed", workingMinutes: 0, productionMinutes: 0, efficiencyPct: 0, jobs: [] },
      { workerId: "a", workerName: "Ann", workingMinutes: 660, productionMinutes: 590, efficiencyPct: 89.4, jobs: [] },
    ],
  });
  assert.deepEqual(w.map((x) => x.name), ["Ann", "Hal", "Bob", "Zed"]);
  const by = Object.fromEntries(w.map((x) => [x.name, x]));
  assert.deepEqual([by.Ann.eff, by.Ann.fg], ["89%", "#4F7C3A"]);
  assert.deepEqual([by.Hal.isHelper, by.Hal.eff, by.Hal.fg], [true, "—", "#9A9082"]);
  assert.equal(by.Hal.earned, "10h", "a helper's hours and earned time are still shown");
  assert.deepEqual([by.Zed.hours, by.Zed.eff], ["—", "—"]);
  assert.deepEqual(by.Bob.jobs.map((j) => [j.title, j.code, j.po, j.earned]), [["Seat cushion", "SF-2", "", "3h"], ["Bedframe", "HB-1", "PO-9", "30m"]], "jobs: most earned time first; label, else product name");
  assert.deepEqual(dayWorkers(null), []);
});

test("day title: the department (or All departments) with the category; the date goes underneath", () => {
  assert.equal(scopeTitle(null, ""), "All departments");
  assert.equal(scopeTitle("Upholstery", ""), "Upholstery");
  assert.equal(scopeTitle("Upholstery", "SOFA"), "Upholstery · Sofa");
  assert.equal(scopeTitle(null, "BEDFRAME"), "All departments · Bedframe");
  const page = strip(src("DeptPerfDayPage.tsx"));
  assert.match(page, /\{title\}<\/div>/);
  assert.match(page, /\{dmy\(date\)\}/);
  assert.ok(page.indexOf("{title}") < page.indexOf("{dmy(date)}"), "title first, date underneath");
});

test("wiring: one existing endpoint (workers:read), the day fetched only when tapped, All departments by default, read-only", () => {
  const hook = strip(src("use-department-performance.ts"));
  assert.match(hook, /hasPermission\("workers", "read"\)/);
  assert.match(hook, /allowed && day \? dayUrl\(day, dept, cat\) : null/, "the day is requested only once it is tapped");
  assert.match(hook, /listUrl\(range, dept, cat\)/);
  assert.match(hook, /\/api\/departments/);
  const ui = strip(src("DepartmentPerformanceSection.tsx"));
  assert.match(ui, /const dept = params\.get\("dpd"\) \?\? ""/, "default: All departments");
  assert.match(ui, /parseCategory\(params\.get\("dpc"\)\)/);
  assert.match(ui, /useEmployeesPeriod\(\)/);
  assert.match(ui, /No access to Department Performance/);
  assert.match(ui, /Needs workers:read\./);
  assert.match(ui, /aria-label="Filter by department and category"/);
  assert.match(ui, /No working hours in the selected period\./);
  const sheet = strip(src("DeptPerfFilterSheet.tsx"));
  assert.match(sheet, /All departments/);
  assert.match(sheet, /setD\(""\);\s*setC\(""\)/, "Reset goes back to All departments / All");
  assert.ok(!/method:|mutateJson|fetch\(/.test(ui + hook + sheet + strip(src("DeptPerfDayPage.tsx"))), "read-only");
  const route = strip(src("EmployeesRoute.tsx"));
  assert.match(route, /section === "department-performance" \? <DepartmentPerformanceSection \/> : null/);
  assert.match(route, /\.\.\.DP_PARAMS/);
});
