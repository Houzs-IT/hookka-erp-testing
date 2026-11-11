// Helper / 杂工 (owner 2026-11-11). A helper clocks in to a production
// department but scans no completions of their own (if they do share a scan,
// the usual PIC half-split applies — no rule change). Rules:
//   • their hours still count as Production Hours;
//   • no personal efficiency ("—") and no efficiency allowance;
//   • production efficiency (and the KPI built on it) leaves them out.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const eff = await import(pathToFileURL(resolve(process.cwd(), "src/api/lib/efficiency-allowance.ts")).href);
const read = (p) => readFileSync(p, "utf8");

function mockDb({ helpers = [], helperQueryFails = false }) {
  return {
    prepare(sql) {
      return {
        bind() {
          return {
            async all() {
              if (sql.includes("is_helper")) {
                if (helperQueryFails) throw new Error('column "is_helper" does not exist');
                return { results: helpers.map((id) => ({ id })) };
              }
              if (sql.includes("FROM departments")) return { results: [{ code: "UPHOLSTERY", isProduction: 1 }] };
              if (sql.includes("contrib_min")) return { results: [{ workerId: "P1", productionMinutes: 450 }] };
              if (sql.includes("working_hour_entries"))
                return {
                  results: [
                    { workerId: "P1", departmentCode: "UPHOLSTERY", date: "2026-11-02", hours: 8 },
                    { workerId: "H1", departmentCode: "UPHOLSTERY", date: "2026-11-02", hours: 8 },
                  ],
                };
              return { results: [] };
            },
          };
        },
      };
    },
  };
}

test("a helper keeps their Production Hours but has no efficiency, so no allowance", async () => {
  const m = await eff.computeMonthlyEfficiencyByWorker(mockDb({ helpers: ["H1"] }), "2026-11-01", "2026-11-30");
  const h = m.get("H1");
  assert.equal(h.prodHours, 8, "hours still counted");
  assert.equal(h.pct, null, "no personal efficiency");
  assert.equal(h.isHelper, true);
  assert.equal(eff.resolveEfficiencyAllowanceSen(h, 10000, 80), 0, "no efficiency allowance");
  // The producer is untouched.
  assert.equal(Math.round(m.get("P1").pct * 10) / 10, 93.8);
  assert.equal(m.get("P1").isHelper, false);
});

test("before is_helper exists nobody is a helper — figures unchanged", async () => {
  const m = await eff.computeMonthlyEfficiencyByWorker(mockDb({ helperQueryFails: true }), "2026-11-01", "2026-11-30");
  assert.equal(m.get("H1").pct, 0, "an ordinary worker with hours and no output is a real 0%");
  assert.equal(m.get("H1").isHelper, false);
});

test("KPI production efficiency leaves helpers out of the pool", () => {
  const src = read("src/api/lib/kpi-metrics.ts");
  assert.match(src, /if \(w\.isHelper\) continue;/);
});

test("column self-applies, is rename-mapped, and the workers API reads + writes it as a real boolean", () => {
  assert.match(read("src/api/lib/payment-columns.ts"), /ADD COLUMN IF NOT EXISTS is_helper BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.equal(JSON.parse(read("src/api/lib/column-rename-map.json")).isHelper, "is_helper");
  const w = read("src/api/routes/workers.ts");
  assert.match(w, /isHelper: Boolean\(row\.isHelper \?\? row\.is_helper \?\? false\)/);
  assert.match(w, /paymentMethod, bankName, bankAccount, isHelper\)/);
  assert.match(w, /body\.isHelper === true,/);
  assert.match(w, /isOutsource = \?, payMode = \?, dailyRateSen = \?, isHelper = \?,/);
  assert.match(w, /merged\.isHelper === true \|\| merged\.isHelper === 1,/);
});

test("Employee Master: Helper tick box in the drawer, Helper tag beside the name", () => {
  const d = read("src/components/employee-drawer.tsx");
  assert.match(d, /checked=\{draft\.isHelper\}/);
  assert.match(d, /Helper \(assists others — no personal efficiency, no efficiency allowance\)/);
  const e = read("src/pages/employees.tsx");
  assert.match(e, /\{row\.isHelper && <HelperTag \/>\}/);
});

test("worker phone: a helper sees — instead of an efficiency %", () => {
  assert.match(read("src/api/routes/worker.ts"), /isHelper: myEff\?\.isHelper \?\? false,/);
  assert.match(read("src/pages/worker/index.tsx"), /hist\.totals\.isHelper \|\| \(hist\.totals\.prodDeptMinutes \?\? 0\) < 30 \? "—"/);
  assert.match(read("src/pages/worker/scan.tsx"), /today\.totals\.isHelper \? "—"/);
});
