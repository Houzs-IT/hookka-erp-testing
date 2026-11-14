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
