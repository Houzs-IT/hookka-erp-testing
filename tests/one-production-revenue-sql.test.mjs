// Production revenue SQL is written once (src/api/lib/production-revenue.ts).
// Nine copies of the "order finished" rule and six of the price lookup drifted
// apart before (BUG-2026-11-11-498 fixed six lookups and missed a seventh).
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { translateSql } from "../src/api/lib/supabase-compat.ts";
import { FINISHED_PRODUCTION_ORDERS_CTE } from "../src/api/lib/production-revenue.ts";

const SHARED_FILE = join("src", "api", "lib", "production-revenue.ts");
const sourceFiles = readdirSync("src/api", { recursive: true })
  .filter((name) => String(name).endsWith(".ts"))
  .map((name) => join("src", "api", String(name)));
const countIn = (pattern) =>
  sourceFiles
    .filter((file) => file !== SHARED_FILE)
    .flatMap((file) => (readFileSync(file, "utf8").match(pattern) ?? []).map(() => file));

test("the price lookup is written only in the shared module", () => {
  assert.deepEqual(countIn(/(basePriceSen|base_price_sen) DESC NULLS LAST/g), []);
});

test("the order-finished rule is written only in the shared module, apart from the unused /daily-breakdown", () => {
  assert.deepEqual(countIn(/WITH per_po AS/g), [join("src", "api", "routes", "working-hour-entries.ts")]);
});

test("the shared rule reaches Postgres as the snake_case query the daily panel used to carry", () => {
  const dailyPanelBefore = `per_po AS (
         SELECT production_order_id,
                MAX(CASE WHEN status IN ('COMPLETED','TRANSFERRED')
                              AND completed_date IS NOT NULL
                         THEN completed_date END) AS unit_completed_at
           FROM job_cards
          WHERE department_code = 'UPHOLSTERY'
          GROUP BY production_order_id
         HAVING COUNT(*) > 0
            AND SUM(CASE WHEN status IN ('COMPLETED','TRANSFERRED')
                              AND completed_date IS NOT NULL
                         THEN 1 ELSE 0 END) = COUNT(*)
       )`;
  const squash = (sql) => translateSql(sql).replace(/\s+/g, " ").trim();
  assert.equal(squash(FINISHED_PRODUCTION_ORDERS_CTE), squash(dailyPanelBefore));
});
