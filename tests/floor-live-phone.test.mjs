// Phone Floor Live (Claude Design handoff). DESIGN ONLY: the component must keep
// using the desktop's data + rules, and the desktop view must stay untouched.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { floorLiveLayout } from "../src/pages/dashboards/floor-live-lib.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const phone = read("src/pages/m/screens/dashboard/FloorLivePhone.tsx");

test("phone Floor Live reads the same endpoints and layout rules as the desktop", () => {
  assert.match(phone, /\/api\/dashboard\/floor-live\?date=\$\{day\}/);
  assert.match(phone, /"\/api\/dashboard\/floor-live"/);
  assert.match(phone, /\/api\/dashboard\/floor-live\/completed\?from=\$\{day\}&to=\$\{day\}/);
  assert.match(phone, /\/api\/dashboard\/floor-live\/summary\?from=\$\{from\}&to=\$\{to\}/);
  assert.match(phone, /floorLiveLayout\(data, \{ q, issuesOnly \}\)/);
  assert.match(phone, /summaryLayout\(data, q\)/);
  assert.match(phone, /periodRange\(period, today\)/);
  assert.match(phone, /const ROW_LIMIT = 6;/);
  assert.match(phone, /const REFRESH_MS = 3 \* 60 \* 1000;/);
  assert.match(phone, /useInterval\(\(\) => \{ refresh\(\); completed\.refresh\(\); \}, pastDay \? null : REFRESH_MS\)/);
});

test("owner rules kept: red <80%, red non-prod hour row, last check-in, helpers", () => {
  assert.match(phone, /const red = production \? p\.effPct != null && p\.effPct < 80 : p\.overHourNonProd;/);
  assert.match(phone, /e < 80 \? RED/);
  assert.match(phone, /const lastIn = \(p: FloorLiveRow\) => p\.scannedAt \?\? p\.clockIn \?\? "—";/);
  assert.match(phone, /p\.isHelper \? <HelperPill \/>/);
});

test("Category breakdown strip + completed detail use the desktop's numbers and rules", () => {
  assert.match(phone, /<CategoryStrip code=\{d\.code\} name=\{d\.name\} data=\{completed\.data\} showUsual live=\{!pastDay\} onOpen=\{detail\.open\} \/>/);
  assert.match(phone, /showUsual=\{false\} live=\{false\} onOpen=\{detail\.open\}/);
  assert.match(phone, /<CompletedDetail target=\{detail\.target\} data=\{completed\.data\} onClose=\{detail\.close\} \/>/);
  const c = read("src/pages/m/screens/dashboard/FloorLiveCompleted.tsx");
  assert.match(c, /deptCompletedFor\(data, code\)/);
  assert.match(c, /deptCompletedDays\(shown, target\.code, today\)/);
  assert.match(c, /behindPace\(v, usual, nowMin\)/);
  assert.match(c, /\/api\/dashboard\/floor-live\/completed\?from=\$\{data\.from\}&to=\$\{data\.to\}&month=\$\{month\}/);
  assert.doesNotMatch(c, /Math\.random|const TODAY\s*=/, "no prototype sample data");
});

test("detail: Malaysia date for the month limit, opens on the viewed date's month, Sundays kept", () => {
  const c = read("src/pages/m/screens/dashboard/FloorLiveCompleted.tsx");
  assert.match(c, /const today = todayYmdMY\(\);/);
  assert.match(c, /const baseMonth = \(data\?\.to \?\? today\)\.slice\(0, 7\);/);
  assert.match(c, /if \(t <= curMonth\) setMonth\(t\);/);
  assert.match(c, /disabled=\{isCurrent\}/);
  assert.doesNotMatch(c, /getUTCDay\(\) === 0|=== 0\) continue/, "no Sunday filter: a Sunday with completions is shown");
});

test("detail captions: 'this month' only for the current month; the 12-day avg is the latest baseline", () => {
  const c = read("src/pages/m/screens/dashboard/FloorLiveCompleted.tsx");
  assert.match(c, /isCurrent \? "12-day avg" : "Latest 12-day avg"/);
  assert.match(c, /isCurrent \? "this month" : `\$\{mon\} avg`/);
  assert.match(c, /deptCompletedFor\(data, target\.code\); \/\/ the 12-day baseline is the latest one/);
});

test("detail closes on Back button, Escape and the phone/browser Back (one history entry)", () => {
  const c = read("src/pages/m/screens/dashboard/FloorLiveCompleted.tsx");
  const h = read("src/pages/m/screens/dashboard/completed-detail-state.ts");
  assert.match(c, /e\.key === "Escape"\) onClose\(\)/);
  assert.match(c, /aria-label="Back"/);
  assert.match(h, /window\.history\.pushState\(/);
  assert.match(h, /addEventListener\("popstate", onPop\)/);
  assert.match(h, /window\.history\.back\(\)/);
  assert.doesNotMatch(h, /useEffect\([^)]*pushState/, "pushed from the tap, not an effect (StrictMode)");
});

test("Issues badge = issue rows matching the search, counted before the 6-row limit", () => {
  assert.match(phone, /floorLiveLayout\(data, \{ q, issuesOnly: true \}\)/);
  const data = {
    departments: [{ code: "FAB_CUT", name: "Fabric Cutting", isProduction: true, sequence: 1 }],
    workers: Array.from({ length: 9 }, (_, i) => ({
      id: `w${i}`, name: `Low ${i}`, homeDept: "FAB_CUT", dept: "FAB_CUT", isProduction: true,
      clockIn: "08:00", clockOut: null, scannedAt: null, done: 1, workingMinutes: 100, earnedMinutes: 10, effPct: 10, overHourNonProd: false,
    })).concat([{ id: "ok", name: "Fine", homeDept: "FAB_CUT", dept: "FAB_CUT", isProduction: true, clockIn: "08:00", clockOut: null, scannedAt: null, done: 1, workingMinutes: 100, earnedMinutes: 95, effPct: 95, overHourNonProd: false }]),
  };
  const count = (q) => floorLiveLayout(data, { q, issuesOnly: true }).production.reduce((s, c) => s + c.rows.length, 0);
  assert.equal(count(""), 9, "all 9 issues, not capped at 6");
  assert.equal(count("low 3"), 1, "only the rows that match the search");
});

test("mounted on /m Home; the desktop FloorLiveView is not used there any more and not edited", () => {
  const home = read("src/pages/m/screens/dashboard/HomeDashboard.tsx");
  assert.match(home, /<FloorLivePhone period=\{period\} today=\{today\} onPeriodChange=\{setPeriod\} \/>/);
  assert.doesNotMatch(home, /<FloorLiveView /);
  assert.match(read("src/pages/dashboards/OperationsView.tsx"), /<FloorLiveView period=/);
});

test("phone colours come from the /m theme tokens, so dark mode works", () => {
  assert.match(phone, /import \{ M \} from "\.\.\/\.\.\/theme";/);
  assert.doesNotMatch(phone, /backgroundColor: "#FFFFFF"|backgroundColor: "#FAF8F4"/);
});
