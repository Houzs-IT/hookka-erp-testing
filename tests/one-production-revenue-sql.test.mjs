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

test("the shared rule reaches Postgres as snake_case, with Department Revenue's combined-card step (owner 2026-11-20)", () => {
  const ownCards = `per_po AS (
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
                         THEN 1 ELSE 0 END) = COUNT(*)`;
  const squash = (sql) => translateSql(sql).replace(/\s+/g, " ").trim();
  const cte = squash(FINISHED_PRODUCTION_ORDERS_CTE);
  assert.ok(cte.startsWith(squash(ownCards)), "the PO's own Upholstery cards, as before");
  assert.match(cte, /UNION ALL SELECT spo\.id AS production_order_id, od\.done_at AS unit_completed_at/);
  assert.match(cte, /cj\.wip_label LIKE '%\+%' OR cj\.wip_qty > cpo\.quantity/, "the same combined-card test as dept-revenue.ts");
  assert.match(cte, /NOT EXISTS \(SELECT 1 FROM job_cards sj WHERE sj\.production_order_id = spo\.id AND sj\.department_code = 'UPHOLSTERY'\)/);
});
