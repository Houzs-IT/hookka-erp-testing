import { Hono, type Context } from "hono";
import type { Env } from "../worker";
import { requirePermission } from "../lib/rbac";
import { buildAuditStatement } from "../lib/audit";
import { ensureProductionOrderSourceLine } from "../lib/production-order-line";
import { invalidateProductionListCaches } from "../lib/po-list-cache";
import { getOrgId } from "../lib/tenant";
import { planSourceLineBackfill, type SourceLineFill } from "../lib/production-order-line-backfill";

const app = new Hono<Env>();

const WRITE_CHUNK_SIZE = 50;
const SAMPLE_LIMIT = 50;

async function writeSourceLines(c: Context<Env>, fills: readonly SourceLineFill[]): Promise<number> {
  const db = c.var.DB;
  let updated = 0;
  for (let start = 0; start < fills.length; start += WRITE_CHUNK_SIZE) {
    const part = fills.slice(start, start + WRITE_CHUNK_SIZE);
    const statements: D1PreparedStatement[] = [];
    for (const fill of part) {
      statements.push(
        db
          .prepare("UPDATE production_orders SET source_line_no = ? WHERE id = ? AND source_line_no IS NULL")
          .bind(fill.sourceLineNo, fill.productionOrderId),
      );
      if (fill.sourceLineNo === fill.oldLineNo) continue;
      const audit = await buildAuditStatement(c, {
        resource: "production-orders",
        resourceId: fill.productionOrderId,
        action: "backfill-source-line",
        before: { lineNo: fill.oldLineNo, unitPriceSen: fill.oldUnitPriceSen },
        after: { sourceLineNo: fill.sourceLineNo, unitPriceSen: fill.newUnitPriceSen, method: fill.method },
        source: "admin",
      });
      if (audit) statements.push(audit);
    }
    await db.batch(statements);
    updated += part.length;
  }
  return updated;
}

async function clearProductionSheetCaches(c: Context<Env>): Promise<string | null> {
  try {
    await invalidateProductionListCaches(c, getOrgId(c));
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[production-order-lines] cache invalidation failed: ${message}`);
    return message;
  }
}

app.post("/backfill-source-lines", async (c) => {
  const denied = await requirePermission(c, "production-orders", "update");
  if (denied) return denied;
  const dryRun = c.req.query("dryRun") === "true";
  await ensureProductionOrderSourceLine(c.var.DB);

  const { fills, ...summary } = await planSourceLineBackfill(c.var.DB);
  const lineChangedSamples = fills
    .filter((fill) => fill.sourceLineNo !== fill.oldLineNo)
    .slice(0, SAMPLE_LIMIT);
  if (dryRun) {
    return c.json({ success: true, dryRun: true, toFill: fills.length, ...summary, lineChangedSamples });
  }

  const updated = await writeSourceLines(c, fills);
  const cacheInvalidationError = await clearProductionSheetCaches(c);
  return c.json({ success: true, dryRun: false, toFill: fills.length, ...summary, updated, cacheInvalidationError });
});

export default app;
