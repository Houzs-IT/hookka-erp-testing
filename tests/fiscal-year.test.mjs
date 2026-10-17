// ---------------------------------------------------------------------------
// fiscal-year.test.mjs — financial years with year-end changes (finance
// backlog item 9; the design's Settings › Financial Year End and the Month /
// Quarter / Financial Year pickers). With no change saved every year is what
// the old single year end gave — to the day; a change makes the year it
// starts a transition year of 1–18 months, and the years after it run to the
// new year end. Made-up dates only.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
try { register("tsx/esm", pathToFileURL("./")); } catch { /* native strip */ }
const fy = await import(pathToFileURL(resolve(process.cwd(), "src/lib/fiscal-year.ts")).href);
const fiscal = await import(pathToFileURL(resolve(process.cwd(), "src/api/lib/fiscal.ts")).href);
const fr = await import(pathToFileURL(resolve(process.cwd(), "src/lib/finance-reports.ts")).href);
const cf = await import(pathToFileURL(resolve(process.cwd(), "src/lib/cashflow-engine.ts")).href);

test("no change saved: every month's year is exactly the old single-year-end window", () => {
  for (let fye = 1; fye <= 12; fye++) {
    for (let t = 2024 * 12; t < 2029 * 12; t++) {
      const ym = `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
      const date = new Date(`${ym}-15T00:00:00Z`);
      assert.deepEqual(fiscal.fyWindowAt(date, { fyeMonth: fye, changes: [] }), fiscal.fyWindowFor(date, fye), `${ym} fye ${fye}`);
    }
  }
});

test("a year-end change: the year it starts is the transition, the next run to the new year end", () => {
  const short = { fyeMonth: 8, changes: [{ from: "2026-09", to: "2026-12" }] };
  assert.deepEqual(fy.fyPeriods(short, "2025-10", "2028-06").map((p) => [p.name, p.startYm, p.endYm, p.months, p.transition]), [
    ["FY 2025/26", "2025-09", "2026-08", 12, false],
    ["FY 2026", "2026-09", "2026-12", 4, true],
    ["FY 2027", "2027-01", "2027-12", 12, false],
    ["FY 2028", "2028-01", "2028-12", 12, false],
  ]);
  const long = { fyeMonth: 8, changes: [{ from: "2026-09", to: "2027-12" }] };
  assert.deepEqual(fy.fyPeriods(long, "2026-10", "2028-02").map((p) => [p.name, p.months, p.transition]), [["FY 2026/27", 16, true], ["FY 2028", 12, false]]);
  assert.equal(fy.fyFor("2027-11", long).name, "FY 2026/27");
  assert.deepEqual(fy.fyQuarters(fy.fyFor("2027-11", long)).map((q) => [q.q, q.startYm, q.endYm]), [
    [1, "2026-09", "2026-11"], [2, "2026-12", "2027-02"], [3, "2027-03", "2027-05"], [4, "2027-06", "2027-08"], [5, "2027-09", "2027-11"], [6, "2027-12", "2027-12"],
  ], "a 16-month year: five quarters and a last month");
  // The server's windows follow it.
  assert.deepEqual(fiscal.fyWindowAt("2026-11", short), { startIso: "2026-09-01", endIso: "2026-12-31", label: "FY 2026" });
  assert.deepEqual(fiscal.fyWindowAt(new Date("2027-02-10T00:00:00Z"), short), { startIso: "2027-01-01", endIso: "2027-12-31", label: "FY 2027" });
});

test("Change Year End: the transitions on offer run 1–18 months; a closed or finished year cannot change", () => {
  const s = { fyeMonth: 8, changes: [] };
  const cur = fy.fyFor("2026-10", s); // FY 2026/27, Sep 2026 – Aug 2027
  assert.deepEqual(fy.yearEndChangeOptions(cur, 12), [{ to: "2026-12", months: 4 }, { to: "2027-12", months: 16 }]);
  assert.deepEqual(fy.yearEndChangeOptions(cur, 3), [{ to: "2027-03", months: 7 }], "19 months is too long");
  assert.deepEqual(fy.yearEndChangeOptions(cur, 9), [{ to: "2026-09", months: 1 }, { to: "2027-09", months: 13 }]);
  assert.deepEqual(fy.yearEndChangeOptions(cur, 8), [], "already ends in August");
  const none = new Set();
  assert.equal(fy.yearEndChangeError(s, { from: "2026-09", to: "2026-12" }, none, "2026-10"), null);
  assert.match(fy.yearEndChangeError(s, { from: "2026-09", to: "2027-03" }, new Set(["2027-08"]), "2026-10"), /is closed/);
  assert.match(fy.yearEndChangeError(s, { from: "2025-09", to: "2025-12" }, none, "2026-10"), /already over/);
  assert.match(fy.yearEndChangeError(s, { from: "2026-10", to: "2026-12" }, none, "2026-10"), /beginning of a financial year/);
  assert.match(fy.yearEndChangeError(s, { from: "2026-09", to: "2028-03" }, none, "2026-10"), /1 to 18 months/);
  // Saving one replaces the changes from that year on.
  const saved = fy.withYearEndChange({ fyeMonth: 8, changes: [{ from: "2026-09", to: "2026-12" }, { from: "2027-01", to: "2027-06" }] }, { from: "2026-09", to: "2027-12" });
  assert.deepEqual(saved.changes, [{ from: "2026-09", to: "2027-12" }]);
  // Changing back to the old month makes an ordinary twelve-month year again.
  const back = fy.withYearEndChange(saved, { from: "2026-09", to: "2027-08" });
  assert.deepEqual(fy.fyPeriods(back, "2026-09", "2027-09").map((p) => [p.name, p.months, p.transition]), [["FY 2026/27", 12, false], ["FY 2027/28", 12, false]]);
});

test("period keys: a financial year and its quarters, read without the schedule", () => {
  const y = { startYm: "2026-09", endYm: "2027-12" };
  assert.equal(fy.fyKey(y), "fy:2026-09..2027-12");
  assert.equal(fy.fyqKey(y, 6), "fyq:2026-09..2027-12:Q6");
  assert.deepEqual(fy.parseFyKey("fy:2026-09..2027-12"), { kind: "year", fy: { startYm: "2026-09", endYm: "2027-12", name: "FY 2026/27" }, q: null, startYm: "2026-09", endYm: "2027-12" });
  assert.deepEqual(fy.parseFyKey("fyq:2026-09..2027-12:Q6"), { kind: "quarter", fy: { startYm: "2026-09", endYm: "2027-12", name: "FY 2026/27" }, q: 6, startYm: "2027-12", endYm: "2027-12" });
  for (const bad of ["fy:2026-09..2025-08", "fyq:2026-09..2027-08", "fyq:2026-09..2027-08:Q5", "fy:2026-13..2027-08", "2026-Q1", "fy:2026-09..2027-08:Q1"]) {
    assert.equal(fy.parseFyKey(bad), null, bad);
  }
  // The report helpers read them; calendar keys are untouched.
  assert.equal(fr.periodKind("fy:2025-09..2026-08"), "year");
  assert.equal(fr.periodKind("fyq:2025-09..2026-08:Q2"), "quarter");
  assert.equal(fr.periodLabel("fyq:2025-09..2026-08:Q2", "2026-10-18"), "Q2 FY 2025/26");
  assert.equal(fr.periodLabel("fy:2026-09..2027-08", "2026-10-18"), "FY 2026/27 · so far");
  assert.equal(fr.periodGroup("fyq:2025-09..2026-08:Q2"), "FY 2025/26");
  assert.equal(fr.periodShort("fyq:2025-09..2026-08:Q2"), "Q2");
  const opts = ["2026-10", "fyq:2025-09..2026-08:Q1", "fyq:2025-09..2026-08:Q2", "fyq:2026-09..2027-08:Q1", "fy:2025-09..2026-08", "fy:2026-09..2027-08"];
  assert.equal(fr.stepPeriod("fyq:2025-09..2026-08:Q2", 1, opts), "fyq:2026-09..2027-08:Q1", "into the next year's first quarter");
  assert.equal(fr.stepPeriod("fyq:2025-09..2026-08:Q1", -1, opts), "", "nothing before");
  assert.equal(fr.stepPeriod("fy:2026-09..2027-08", -1, opts), "fy:2025-09..2026-08");
  assert.equal(fr.stepPeriod("2026-Q1", 1), "2026-Q2", "calendar quarters as before");
  assert.equal(fr.periodLabel("2026", "2026-10-18"), "Full Year 2026 · so far");
});

test("the cash flow's year runs back to its own first month (a transition year past twelve)", () => {
  assert.deepEqual(cf.fyMonths("2026-11", 8), ["2026-11", "2026-10", "2026-09"], "as before without a schedule");
  assert.deepEqual(cf.fyMonths("2026-11", 8, "2026-09"), ["2026-11", "2026-10", "2026-09"]);
  const m = cf.fyMonths("2027-12", 12, "2026-09");
  assert.equal(m.length, 16);
  assert.equal(m[m.length - 1], "2026-09");
});

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const api = read("src/api/routes/accounting.ts");
const ui = read("src/pages/accounting/index.tsx");
const card = read("src/pages/accounting/tabs/FinancialYearsCard.tsx");
const slice = (src, from, to) => { const a = src.indexOf(from); assert.notEqual(a, -1, from); const b = src.indexOf(to, a + 1); return src.slice(a, b === -1 ? undefined : b); };

test("server: every year window follows the schedule; the years and Change Year End endpoints", () => {
  assert.doesNotMatch(api, /fyWindowFor\(|getFyeMonth\(/, "no reader left on the single year end");
  assert.match(api, /const fyWin = fyWindowAt\(endForFy, await getFySchedule\(c\.var\.DB\)\);/, "P&L year to date");
  assert.match(api, /const fy = fyWindowAt\(anchorDate, await getFySchedule\(c\.var\.DB\)\);/, "Monthly P&L");
  assert.match(api, /function lastEndedFyeIso\(today: Date, sched: FySchedule\): string \{/, "year-end close");
  const cs = slice(api, 'app.get("/cost-structure"', 'app.get("/cost-expense-classes"');
  assert.match(cs, /for \(let ym = startYm; ym <= fyWin\.endIso\.slice\(0, 7\); ym = addFyMonths\(ym, 1\)\) cols\.push\(ym\);/);
  assert.doesNotMatch(cs, /new Array\(12\)|i < 12/, "a transition year is not twelve months");
  assert.match(api, /const fk = parseFyKey\(period\); \/\/ "fy:2025-09\.\.2026-08" \/ "fyq:…:Q1" \(item 9\)\n\s*if \(fk\) return fk\.endYm;/);
  const get = slice(api, 'app.get("/fiscal-years"', 'app.put("/fiscal-years/year-end"');
  assert.match(get, /status: closed\.has\(y\.endYm\) \? "closed" : y\.startYm <= todayYm && todayYm <= y\.endYm \? "current" : y\.startYm > todayYm \? "future" : "open",/);
  assert.match(get, /canChangeYearEnd: role === "SUPER_ADMIN"/);
  const put = slice(api, 'app.put("/fiscal-years/year-end"', "// POST /api/accounting/year-close");
  assert.match(put, /if \(role !== "SUPER_ADMIN"\) return c\.json\(\{ success: false, error: "Only a Super Admin can change the financial year end\." \}, 403\);/);
  assert.match(put, /const err = yearEndChangeError\(sched, change, closed, runningMonthYm\(\)\);/);
  assert.match(put, /await emitAudit\(c, \{ resource: "finance-settings", resourceId: FYE_CHANGES_KV_KEY, action: "update",/);
});

test("screen: the P&L picks financial years and their quarters; Settings shows the years and Change Year End", () => {
  assert.match(ui, /const fiscal = useFiscalYears\(\);/);
  assert.match(ui, /\.\.\.recent\.flatMap\(\(y\) => fyQuarters\(y\)\.filter\(\(q\) => q\.startYm <= ym\)\.map\(\(q\) => fyqKey\(y, q\.q\)\)\),\n\s*\.\.\.recent\.map\(\(y\) => fyKey\(y\)\),/);
  assert.doesNotMatch(ui, /`\$\{y\}-Q\$\{q\}`/, "no calendar quarters on the P&L");
  assert.match(ui, /<FinancialYearsCard \/>/);
  // The export names the period in words and keeps ":" out of the file name.
  assert.match(ui, /const fileBase = `PL-\$\{line\}-\$\{period\.replace\(\/\[\^0-9A-Za-z-\]\+\/g, "_"\)\}`;/);
  assert.doesNotMatch(ui, /function FyeCard\(/, "the one-box editor that re-based every year is gone");
  assert.match(card, /\{data\?\.canChangeYearEnd && !form && changeable\.length > 0 && \(/);
  assert.match(card, /const changeable = \(data\?\.years \?\? \[\]\)\.filter\(\(y\) => y\.status === "current" \|\| y\.status === "future"\);/);
  assert.match(card, /fetch\("\/api\/accounting\/fiscal-years\/year-end", \{\n\s*method: "PUT",/);
});
