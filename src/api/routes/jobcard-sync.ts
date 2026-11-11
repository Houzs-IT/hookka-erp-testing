// ---------------------------------------------------------------------------
// jobcard-sync — reconcile an existing PO's job_cards set with its CURRENT
// BOM template. Fixes the class of bug where a BOM was edited after POs were
// already created (e.g. migrations/0027 + 0029 adding UPHOLSTERY + PACKING to
// sofa variants, or the 5536-CSL / 5537-STOOL missing-FAB_CUT discovery):
// the POs kept their original JC set and had to be patched by hand.
//
// Endpoint:
//   POST /api/production/sync-jobcards-from-bom             — scan every PO
//   POST /api/production/sync-jobcards-from-bom?poId=XYZ    — scan one PO
//
// Semantics (idempotent):
//   For every (wipKey, deptCode) pair the CURRENT ACTIVE BOM expects, check
//   for an existing job_cards row on (productionOrderId, wipKey, deptCode).
//   If missing, INSERT a new row with status='WAITING', dueDate=po.targetEndDate,
//   PIC1/2 null, completedDate null. Existing JCs are never touched — use
//   /api/production-leadtimes or the dedicated recalc endpoint to refresh
//   dueDate/status.
//
// The BOM-resolution logic (ACTIVE first, fall back to most-recent) and the
// JC-row shape are imported from the shared helpers so this endpoint stays in
// lockstep with the SO-confirm path in sales-orders.ts.
// ---------------------------------------------------------------------------
import { Hono } from "hono";
import type { Env } from "../worker";
import { requirePermission } from "../lib/rbac";
import { deriveJobCardId } from "../lib/bom-wip-breakdown";
import {
  computeExpectedJcs,
  loadBomTemplate,
  type ProductionOrderRow,
} from "../lib/expected-job-cards";
import { planZeroMinuteFills, writeZeroMinuteFills } from "../lib/fill-zero-minutes";

const app = new Hono<Env>();

// Chunk an array into groups of n.
function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) {
    out.push(arr.slice(i, i + n));
  }
  return out;
}

// ---------------------------------------------------------------------------
// POST /api/production/sync-jobcards-from-bom
// ---------------------------------------------------------------------------
app.post("/", async (c) => {
  const denied = await requirePermission(c, "job-cards", "create");
  if (denied) return denied;
  const db = c.var.DB;
  const poIdParam = c.req.query("poId");

  // Load departments once — every INSERT needs deptId + deptName lookups.
  const deptRes = await db
    .prepare("SELECT id, code, name FROM departments")
    .all<{ id: string; code: string; name: string }>();
  const deptByCode = new Map<string, { id: string; name: string }>();
  for (const d of deptRes.results ?? []) {
    deptByCode.set(d.code, { id: d.id, name: d.name });
  }

  // Target PO set.
  let poRows: ProductionOrderRow[];
  if (poIdParam) {
    const one = await db
      .prepare(
        `SELECT id, salesOrderId, productCode, itemCategory, quantity,
                currentDepartment, targetEndDate, startDate, sizeCode, sizeLabel,
                fabricCode, gapInches, divanHeightInches, legHeightInches
           FROM production_orders WHERE id = ?`,
      )
      .bind(poIdParam)
      .first<ProductionOrderRow>();
    poRows = one ? [one] : [];
  } else {
    const all = await db
      .prepare(
        `SELECT id, salesOrderId, productCode, itemCategory, quantity,
                currentDepartment, targetEndDate, startDate, sizeCode, sizeLabel,
                fabricCode, gapInches, divanHeightInches, legHeightInches
           FROM production_orders`,
      )
      .all<ProductionOrderRow>();
    poRows = all.results ?? [];
  }

  const perPO: Array<{ poId: string; created: string[] }> = [];
  const insertStatements: D1PreparedStatement[] = [];
  let totalCreated = 0;

  for (const po of poRows) {
    const productCode = po.productCode ?? "";
    const bomRow = await loadBomTemplate(db, productCode);
    // Legacy POs without ANY BOM template: we still compute expected JCs —
    // breakBomIntoWips returns a synthetic FG_MAIN WIP covering DEPT_ORDER
    // when `wipComponents` is null, and parseL1Processes returns [] for null
    // l1Processes. This mirrors what SO-confirm would do for the same PO.
    const expected = computeExpectedJcs(po, bomRow);
    if (expected.length === 0) {
      perPO.push({ poId: po.id, created: [] });
      continue;
    }

    // Load existing (wipKey, deptCode) pairs for this PO in one shot.
    const existingRes = await db
      .prepare(
        "SELECT wipKey, departmentCode FROM job_cards WHERE productionOrderId = ?",
      )
      .bind(po.id)
      .all<{ wipKey: string | null; departmentCode: string | null }>();
    const existing = new Set<string>();
    for (const row of existingRes.results ?? []) {
      existing.add(`${row.wipKey ?? ""}::${row.departmentCode ?? ""}`);
    }

    const dueDate = po.targetEndDate || po.startDate || "";
    const createdForThisPO: string[] = [];
    for (const exp of expected) {
      const key = `${exp.wipKey}::${exp.deptCode}`;
      if (existing.has(key)) continue;
      const deptMeta = deptByCode.get(exp.deptCode);
      if (!deptMeta) continue;
      const jcId = deriveJobCardId(po.id, exp.wipKey, exp.deptCode);
      insertStatements.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO job_cards (id, productionOrderId, departmentId, departmentCode,
               departmentName, sequence, status, dueDate, wipKey, wipCode, wipType, wipLabel,
               wipQty, prerequisiteMet, pic1Id, pic1Name, pic2Id, pic2Name, completedDate,
               estMinutes, actualMinutes, category, productionTimeMinutes, overdue, rackingNumber, branchKey)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            jcId,
            po.id,
            deptMeta.id,
            exp.deptCode,
            deptMeta.name,
            exp.sequence,
            "WAITING",
            dueDate,
            exp.wipKey,
            exp.wipCode,
            exp.wipType,
            exp.wipLabel,
            exp.wipQty,
            // prerequisiteMet: leave 0 for appended JCs. The SO-confirm path
            // only sets 1 on sequence=0 of a fresh chain — for sync we can't
            // safely assume the appended dept is the new first step, so 0 is
            // the safe default. Upstream-lock / recalc endpoints can
            // re-evaluate.
            0,
            null,
            "",
            null,
            "",
            null,
            exp.estMinutes,
            null,
            exp.category,
            exp.estMinutes,
            "PENDING",
            null,
            // BOM-branch identifier — straight from computeExpectedJcs
            // which gets it from the BOM walker. Pure tree-driven, no
            // category/dept hardcode.
            exp.branchKey,
          ),
      );
      createdForThisPO.push(exp.deptCode);
      totalCreated++;
    }
    perPO.push({ poId: po.id, created: createdForThisPO });
  }

  // Batch INSERTs in groups of 50 to stay under D1's bound-param ceiling.
  for (const batch of chunk(insertStatements, 50)) {
    if (batch.length > 0) {
      await db.batch(batch);
    }
  }

  return c.json({
    success: true,
    scannedPOs: poRows.length,
    createdJCs: totalCreated,
    perPO,
  });
});

// ---------------------------------------------------------------------------
// POST /api/production/sync-jobcards-from-bom/fill-zero-minutes
//   ?dryRun=true             preview only
//   &completedFrom=YYYY-MM-DD  also fill COMPLETED/TRANSFERRED cards finished
//                              on or after this date (default: none)
//
// Live cards only (WAITING / IN_PROGRESS / PAUSED / BLOCKED): a CANCELLED card
// is never filled.
//
// A card's minutes are copied from the BOM once, when the card is created.
// Since BUG-2026-11-11-497 a BOM / WIP Times minutes save updates that
// product's live cards and cards completed this Malaysian month: cards at 0,
// and cards whose BOM step the save changed (syncJobCardMinutesToBomChanges);
// this endpoint is the manual sweep for everything else (earlier completed
// cards, older gaps).
// This fills ONLY cards still at 0. A card that has minutes is never touched,
// even if the BOM has changed since: that is the BOM of its day, not a gap.
// Each write is audited (before/after) so it can be traced and reversed.
// ---------------------------------------------------------------------------
app.post("/fill-zero-minutes", async (c) => {
  const denied = await requirePermission(c, "production-orders", "update");
  if (denied) return denied;
  const dryRun = c.req.query("dryRun") === "true";
  const completedFrom = c.req.query("completedFrom") ?? "";
  if (completedFrom && !/^\d{4}-\d{2}-\d{2}$/.test(completedFrom)) {
    return c.json({ success: false, error: "completedFrom must be YYYY-MM-DD" }, 400);
  }

  const { fills, skippedSamples, ...counts } = await planZeroMinuteFills(c.var.DB, { completedFrom });
  const summary = {
    ...counts,
    toFill: fills.length,
    toFillCompleted: fills.filter((fill) => fill.status === "COMPLETED" || fill.status === "TRANSFERRED").length,
  };
  if (dryRun) {
    return c.json({ success: true, dryRun: true, completedFrom, ...summary, fills, skippedSamples });
  }

  const updated = await writeZeroMinuteFills(c, fills, "admin");
  return c.json({ success: true, dryRun: false, completedFrom, ...summary, updated });
});

export default app;
