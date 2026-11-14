// Working Hours shows each worker-day's department QR scans (owner 2026-11-14:
// 「中途也可以看 然后就可以tally跟floorlive了」).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

test("read-only scans endpoint behind attendance read, same table Floor Live reads", () => {
  const r = read("src/api/routes/working-hour-entries.ts");
  const i = r.indexOf('app.get("/dept-scans"');
  assert.ok(i > 0 && i < r.indexOf('app.get("/", async'), "registered before GET /");
  const body = r.slice(i, r.indexOf("\n});\n", i));
  assert.match(body, /requirePermission\(c, "attendance", "read"\)/);
  assert.match(body, /FROM dept_scan_events WHERE date >= \? AND date <= \?/);
  assert.doesNotMatch(body, /\b(INSERT|UPDATE|DELETE)\b/);
});

test("the grid lists the day's scans under each worker, non-production in red", () => {
  const p = read("src/pages/employees.tsx");
  assert.match(p, /fetch\(`\/api\/working-hour-entries\/dept-scans\?from=\$\{lo\}&to=\$\{hi\}`\)/);
  assert.match(p, /<span className="font-semibold">Scans:<\/span>/);
  assert.match(p, /x\.isProduction \? "text-\[#1F1D1B\]" : "font-semibold text-\[#9A3A2D\]"/);
});

// Owner 2026-11-14: 「结束了那个department就可以show出来了啊」 — finished stints
// show at once; the running one waits for punch-out.
test("timed segments: home until the first scan, each stint keeps from-to, hours add up, last is open", async () => {
  const { timedSegments } = await import("../src/lib/dept-scan-split.ts");
  const segs = timedSegments(6.3, 7 * 60 + 46, 14 * 60 + 30, "FAB_SEW", [
    { departmentCode: "R_AND_D", atMin: 7 * 60 + 48 },
    { departmentCode: "FAB_SEW", atMin: 13 * 60 + 59 },
  ]);
  assert.deepEqual(segs.map((s) => [s.departmentCode, s.fromMin, s.toMin, s.open]), [
    ["FAB_SEW", 466, 468, false],
    ["R_AND_D", 468, 839, false],
    ["FAB_SEW", 839, 870, true],
  ]);
  assert.equal(Math.round(segs.reduce((t, s) => t + s.hours, 0) * 100), 630, "segments add up to the day total");
  assert.equal(timedSegments(2, 480, 600, "UPHOLSTERY", []).length, 1, "no scans = one home stint");
});

test("live-segments route: read-only, today only, finished rows + 'now in' line on the grid", () => {
  const r = read("src/api/routes/working-hour-entries.ts");
  const i = r.indexOf('app.get("/live-segments"');
  assert.ok(i > 0 && i < r.indexOf('app.get("/", async'));
  const body = r.slice(i, r.indexOf("\n});\n", i));
  assert.match(body, /requirePermission\(c, "attendance", "read"\)/);
  assert.match(body, /if \(date !== today\) return c\.json\(\{ success: true, data: \[\] \}\);/);
  assert.doesNotMatch(body, /\b(INSERT|UPDATE|DELETE)\b/);
  const p = read("src/pages/employees.tsx");
  assert.match(p, /\.filter\(\(x\) => !x\.open\)\.map\(/);
  assert.match(p, /since \{x\.from\} — closes at punch-out/);
});
