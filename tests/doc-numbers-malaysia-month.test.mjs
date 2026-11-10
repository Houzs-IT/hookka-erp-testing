// Document numbers take the MALAYSIA month (Houzs #5464 / #5493, ported
// 2026-11-10). The Worker runs in UTC, so `new Date().getMonth()` numbered a
// PO raised at 07:30 MYT on 1 December as PO-2611-….
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { mytYymm, utcYymm } from "../src/lib/doc-number.ts";

test("mytYymm is the Malaysia month across the 1st-of-month midnight", () => {
  // 07:30 MYT on 1 Dec 2026 = 23:30 UTC on 30 Nov.
  const early = new Date("2026-11-30T23:30:00Z");
  assert.equal(utcYymm(early), "2611");
  assert.equal(mytYymm(early), "2612");
  // 07:59:59 MYT on 1 Jan = 23:59:59 UTC 31 Dec — the year rolls too.
  assert.equal(mytYymm(new Date("2026-12-31T23:59:59Z")), "2701");
  // Mid-day is the same either way.
  assert.equal(mytYymm(new Date("2026-11-15T04:00:00Z")), "2611");
});

test("no document-number builder in the API derives YYMM from the server (UTC) month", () => {
  const files = [];
  const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".ts")) files.push(p); } };
  walk("src/api");
  const offenders = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    // A number prefix built from getFullYear()/getMonth() — the old pattern.
    if (/yymm\s*=\s*`\$\{String\(now\.getFullYear\(\)\)/.test(src)) offenders.push(f + " (yymm from getFullYear)");
    if (/const yy = String\(now\.getFullYear\(\)\)\.slice\(-2\)/.test(src)) offenders.push(f + " (yy from getFullYear)");
  }
  assert.deepEqual(offenders, []);
  const svc = readFileSync("src/api/lib/doc-number-service.ts", "utf8");
  assert.match(svc, /opts\.yymm \?\? mytYymm\(\)/);
});
