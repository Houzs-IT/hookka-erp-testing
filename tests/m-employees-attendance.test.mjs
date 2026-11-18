// m-employees-attendance.test.mjs — HK-0125 Phase 2: the Attendance location rule, period params and the Phase 3 link.
// The factory fence is pinned to the desktop source so the two cannot drift silently.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ATT_FENCE,
  LOC_LABEL,
  filterByLoc,
  locCounts,
  metersFromFactory,
  parseLocFilter,
  punchLoc,
  rowLocation,
} from "../src/pages/m/screens/employees/attendance-location.ts";
import {
  MAX_RANGE_DAYS,
  attendanceLink,
  attendanceUrl,
  daysBetween,
  groupAttendance,
  parseAttendanceParams,
  periodLabel,
  punchRows,
} from "../src/pages/m/screens/employees/attendance-model.ts";

const desktop = readFileSync(new URL("../src/pages/employees.tsx", import.meta.url), "utf8");
const TODAY = "2026-11-16";
const params = (o) => (k) => o[k] ?? null;

test("fence constants match the desktop Attendance tab exactly", () => {
  assert.match(desktop, /const ATT_FENCE = \{ lat: 3\.187681, lng: 101\.570928, radiusM: 200 \};/);
  assert.deepEqual({ ...ATT_FENCE }, { lat: 3.187681, lng: 101.570928, radiusM: 200 });
  // The haversine and the in / out / none decision are the same lines as desktop's.
  assert.match(desktop, /Math\.cos\(toRad\(lat\)\) \* Math\.cos\(toRad\(ATT_FENCE\.lat\)\) \* Math\.sin\(dLng \/ 2\) \*\* 2/);
  assert.match(desktop, /attMetersFromFactory\(lat, lng\) <= ATT_FENCE\.radiusM \? "in" : "out"/);
});

test("distance: the factory point is 0 m; 0.001° of latitude is ~111 m; 0.003° is ~334 m", () => {
  assert.equal(Math.round(metersFromFactory(ATT_FENCE.lat, ATT_FENCE.lng)), 0);
  assert.ok(Math.abs(metersFromFactory(ATT_FENCE.lat + 0.001, ATT_FENCE.lng) - 111.2) < 1);
  assert.ok(Math.abs(metersFromFactory(ATT_FENCE.lat + 0.003, ATT_FENCE.lng) - 333.6) < 1);
});

test("one punch: inside the 200 m fence, outside it, or no usable coordinates", () => {
  assert.equal(punchLoc(ATT_FENCE.lat + 0.001, ATT_FENCE.lng), "in");
  assert.equal(punchLoc(ATT_FENCE.lat + 0.003, ATT_FENCE.lng), "out");
  assert.equal(punchLoc(null, null), "none");
  assert.equal(punchLoc(undefined, 101.5), "none");
  assert.equal(punchLoc(NaN, 101.5), "none");
  assert.equal(punchLoc("3.18", "101.57"), "none"); // strings are not coordinates (desktop rule)
});

const at = { clockInLat: ATT_FENCE.lat, clockInLng: ATT_FENCE.lng };
const far = { clockOutLat: ATT_FENCE.lat + 0.01, clockOutLng: ATT_FENCE.lng };
const nogps = { clockInLat: null, clockInLng: null, clockOutLat: null, clockOutLng: null };

test("row rule: Off-site when EITHER punch is outside; At factory when one is inside and none outside; else No GPS", () => {
  assert.equal(rowLocation({ ...at }), "factory");
  assert.equal(rowLocation({ ...far }), "offsite");
  assert.equal(rowLocation({ ...at, ...far }), "offsite"); // in-punch at factory, out-punch away → Off-site
  assert.equal(rowLocation({ clockInLat: far.clockOutLat, clockInLng: far.clockOutLng, clockOutLat: ATT_FENCE.lat, clockOutLng: ATT_FENCE.lng }), "offsite");
  assert.equal(rowLocation(nogps), "nogps");
  assert.equal(rowLocation({ ...at, clockOutLat: null, clockOutLng: null }), "factory"); // clocked in only, still on site
  assert.deepEqual({ ...LOC_LABEL }, { factory: "At factory", offsite: "Off-site", nogps: "No GPS" });
});

test("chip counts, filter results and the badge all come from the same rule", () => {
  const rows = [
    { id: "1", ...at },
    { id: "2", ...at, ...far },
    { id: "3", ...far },
    { id: "4", ...nogps },
    { id: "5", ...at },
  ];
  const c = locCounts(rows);
  assert.deepEqual(c, { all: 5, factory: 2, offsite: 2, nogps: 1 });
  for (const f of ["factory", "offsite", "nogps"]) {
    const list = filterByLoc(rows, f);
    assert.equal(list.length, c[f], `${f}: list length equals chip count`);
    assert.ok(list.every((r) => rowLocation(r) === f), `${f}: every row's badge matches the chip`);
  }
  assert.equal(filterByLoc(rows, "all").length, 5);
  assert.equal(c.factory + c.offsite + c.nogps, c.all);
});

test("loc param", () => {
  assert.equal(parseLocFilter("offsite"), "offsite");
  assert.equal(parseLocFilter("nonsense"), "all");
  assert.equal(parseLocFilter(null), "all");
});

test("default period is today (Malaysia); past dates are allowed; future / malformed fall back to today", () => {
  assert.deepEqual(parseAttendanceParams(params({}), TODAY).period, { kind: "day", date: TODAY });
  assert.deepEqual(parseAttendanceParams(params({ adate: "2026-11-04" }), TODAY).period, { kind: "day", date: "2026-11-04" });
  assert.deepEqual(parseAttendanceParams(params({ adate: "2026-11-17" }), TODAY).period, { kind: "day", date: TODAY });
  assert.deepEqual(parseAttendanceParams(params({ adate: "nope" }), TODAY).period, { kind: "day", date: TODAY });
  assert.deepEqual(parseAttendanceParams(params({ adate: "2019-12-31" }), TODAY).period, { kind: "day", date: TODAY });
});

test("the Phase 3 link: month-to-date Off-site opens a range with the Off-site chip on", () => {
  const link = attendanceLink({ loc: "offsite", from: "2026-11-01", to: TODAY });
  assert.equal(link, "/m/employees?section=attendance&loc=offsite&afrom=2026-11-01&ato=2026-11-16");
  const u = new URL(link, "http://x");
  const r = parseAttendanceParams((k) => u.searchParams.get(k), TODAY);
  assert.deepEqual(r.period, { kind: "range", from: "2026-11-01", to: TODAY });
  assert.equal(r.loc, "offsite");
  assert.equal(periodLabel(r.period), "1 Nov – 16 Nov 2026");
  assert.equal(attendanceLink(), "/m/employees?section=attendance");
});

test("a range must be ordered, not in the future, and at most 93 days", () => {
  const range = (afrom, ato) => parseAttendanceParams(params({ afrom, ato }), TODAY).period;
  assert.deepEqual(range("2026-11-01", TODAY), { kind: "range", from: "2026-11-01", to: TODAY });
  assert.equal(range("2026-11-10", "2026-11-01").kind, "day");
  assert.equal(range("2026-11-01", "2026-11-17").kind, "day");
  assert.equal(range("2026-11-01", null).kind, "day");
  assert.equal(daysBetween("2026-11-01", "2026-11-16"), 16);
  assert.equal(MAX_RANGE_DAYS, 93);
  assert.equal(range("2026-08-01", TODAY).kind, "day"); // 108 days
  assert.equal(range("2026-08-16", TODAY).kind, "range"); // 93 days
});

test("endpoints are the existing attendance route, by date or by from + to", () => {
  assert.equal(attendanceUrl({ kind: "day", date: "2026-11-04" }), "/api/attendance?date=2026-11-04");
  assert.equal(attendanceUrl({ kind: "range", from: "2026-11-01", to: TODAY }), "/api/attendance?from=2026-11-01&to=2026-11-16");
});

test("only rows with a punch are listed; a range groups by date (newest first), people by name", () => {
  const r = (id, date, name, clockIn, clockOut = null) => ({ id, employeeId: id, employeeName: name, date, clockIn, clockOut });
  const rows = punchRows([r("a", "2026-11-04", "Zed", "08:00"), r("b", "2026-11-04", "Amy", null, null), r("c", "2026-11-05", "Bob", null, "17:00"), r("d", "2026-11-04", "Amy", "07:50")]);
  assert.equal(rows.length, 3);
  const g = groupAttendance(rows);
  assert.deepEqual(g.map((x) => x.date), ["2026-11-05", "2026-11-04"]);
  assert.deepEqual(g[1].rows.map((x) => x.employeeName), ["Amy", "Zed"]);
  assert.equal(g[0].title, "Thu 5 Nov 2026");
  assert.equal(periodLabel({ kind: "day", date: "2026-11-04" }), "Wed 4 Nov 2026");
});

test("the Attendance UI shows no distance and reads no sample data", () => {
  const ui = readFileSync(new URL("../src/pages/m/screens/employees/AttendanceSection.tsx", import.meta.url), "utf8");
  assert.ok(!/\bkm\b|metersFromFactory/.test(ui), "no distance in the UI");
  assert.ok(!/2026-11-04|2026-11-13/.test(ui));
});

// ---- Phase 2 review fixes: row detail card -----------------------------------------------------------------------------
import { PUNCH_LABEL, fmtDistance, rowDistance } from "../src/pages/m/screens/employees/attendance-location.ts";

test("per-punch words match the row words", () => {
  assert.deepEqual({ ...PUNCH_LABEL }, { in: "At factory", out: "Off-site", none: "No GPS" });
});

test("distance: real GPS through the same fence maths; HTML wording", () => {
  assert.equal(fmtDistance(38.4), "38 m");
  assert.equal(fmtDistance(999.4), "999 m");
  assert.equal(fmtDistance(1380), "1.4 km");
  assert.equal(rowDistance({ clockInLat: ATT_FENCE.lat + 0.0003, clockInLng: ATT_FENCE.lng }), "33 m"); // at factory, one punch
  assert.equal(rowDistance({ clockInLat: ATT_FENCE.lat + 0.0003, clockInLng: ATT_FENCE.lng, clockOutLat: ATT_FENCE.lat + 0.0006, clockOutLng: ATT_FENCE.lng }), "67 m"); // farthest on-site punch
  assert.equal(rowDistance({ clockInLat: ATT_FENCE.lat + 0.0123, clockInLng: ATT_FENCE.lng }), "1.4 km from factory"); // off-site
  assert.equal(rowDistance({ clockInLat: ATT_FENCE.lat, clockInLng: ATT_FENCE.lng, clockOutLat: ATT_FENCE.lat + 0.0045, clockOutLng: ATT_FENCE.lng }), "500 m from factory"); // mixed: in at factory, out away
  assert.equal(rowDistance({ clockInLat: null, clockInLng: null }), "No GPS reading");
});

test("an Attendance row (its name or the row) opens the read-only punch detail; the photo buttons stay independent", () => {
  const ui = readFileSync(new URL("../src/pages/m/screens/employees/AttendanceSection.tsx", import.meta.url), "utf8");
  assert.match(ui, /role="button"[\s\S]*onClick=\{onDetail\}/);
  assert.match(ui, /e\.stopPropagation\(\);\s*onClick\(\);/, "In / Out buttons do not also open the detail");
  assert.match(ui, /<AttendanceDetail row=\{detail\}/);
  const d = readFileSync(new URL("../src/pages/m/screens/employees/AttendanceDetail.tsx", import.meta.url), "utf8");
  for (const f of ["Clock in", "Clock out", "Location", "Distance", "Photos", "In · Out (tap to view)", "View photos", "read-only"]) assert.ok(d.includes(f), f);
  assert.match(d, /rowDistance\(row\)/);
});

test("the row circles show the real punch photo, lazily, with a fallback icon", () => {
  const ui = readFileSync(new URL("../src/pages/m/screens/employees/AttendanceSection.tsx", import.meta.url), "utf8");
  assert.match(ui, /\/api\/attendance\/\$\{encodeURIComponent\(r\.id\)\}\/photo\?which=in/);
  assert.match(ui, /\/api\/attendance\/\$\{encodeURIComponent\(r\.id\)\}\/photo\?which=out/);
  assert.match(ui, /<img[\s\S]*loading="lazy"[\s\S]*onError=\{\(\) => setFailed\(true\)\}/);
  assert.match(ui, /objectFit: "cover"/);
  assert.match(ui, /has && !failed/, "no photo flag -> no request at all");
});
