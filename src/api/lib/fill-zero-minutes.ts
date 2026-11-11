import type { Context } from "hono";
import type { Env } from "../worker";
import { buildAuditStatement, type AuditSource } from "./audit";
import {
  computeExpectedJcs,
  loadBomTemplate,
  type ExpectedJc,
  type ProductionOrderRow,
} from "./expected-job-cards";

export type ZeroMinuteSkipReason = "bomZero" | "noMatch" | "sofaFabCutMerge" | "duplicateDept";

export interface ZeroMinuteFill {
  jcId: string;
  poNo: string;
  productCode: string;
  deptCode: string;
  status: string;
  minutes: number;
}

export interface ZeroMinuteSkip {
  jcId: string;
  poNo: string;
  productCode: string;
  deptCode: string;
  reason: ZeroMinuteSkipReason;
}

export interface ZeroMinutePlan {
  scanned: number;
  fills: ZeroMinuteFill[];
  skipped: Record<ZeroMinuteSkipReason, number>;
  skippedSamples: ZeroMinuteSkip[];
}

export interface ZeroMinuteScope {
  completedFrom?: string;
  productCodes?: readonly string[];
}

type ZeroCard = ProductionOrderRow & {
  jcId: string;
  wipKey: string | null;
  deptCode: string | null;
  status: string;
  completedDate: string | null;
  poNo: string | null;
};

type MinutesExpectation = Pick<ExpectedJc, "wipKey" | "deptCode" | "estMinutes">;

export const LIVE_STATUSES = "'WAITING','IN_PROGRESS','PAUSED','BLOCKED'";
const WRITE_CHUNK_SIZE = 50;
const PRODUCT_CODE_CHUNK_SIZE = 100;
const SKIPPED_SAMPLE_LIMIT = 50;

// The minutes the CURRENT BOM gives an existing card, or why it can't say.
// A merged Fab Cut card (wipKey `<poId>::<model>::<fabric>::FAB_CUT`) gets the
// sum of every Fab Cut step of its PO, the same total aggregateFcSlots stamps
// on a new one. A sofa merge spans several POs (key starts with the SO id), so
// one PO's BOM can't price it.
// A `<product>::FG_MAIN` card is the all-dept chain a PO got while its BOM was
// empty (before BUG-2026-10-01-244). Today's BOM has other wipKeys, so it is
// matched by dept instead: the sum of that dept's steps. Skipped when the PO
// has another live card in the same dept, or that work would be counted twice.
export function bomMinutesForCard(
  card: { wipKey: string; deptCode: string; poId: string },
  expected: readonly MinutesExpectation[],
  otherCardInDept = false,
): { minutes: number } | { skip: "sofaFabCutMerge" | "noMatch" | "duplicateDept" } {
  if (card.deptCode === "FAB_CUT" && card.wipKey.endsWith("::FAB_CUT")) {
    if (!card.wipKey.startsWith(`${card.poId}::`)) return { skip: "sofaFabCutMerge" };
    const fc = expected.filter((e) => e.deptCode === "FAB_CUT");
    if (fc.length === 0) return { skip: "noMatch" };
    return { minutes: fc.reduce((sum, e) => sum + e.estMinutes, 0) };
  }
  const hit = expected.find(
    (e) => e.wipKey === card.wipKey && e.deptCode === card.deptCode,
  );
  if (hit) return { minutes: hit.estMinutes };
  if (!card.wipKey.endsWith("::FG_MAIN")) return { skip: "noMatch" };
  if (otherCardInDept) return { skip: "duplicateDept" };
  const steps = expected.filter((e) => e.deptCode === card.deptCode);
  if (steps.length === 0) return { skip: "noMatch" };
  return { minutes: steps.reduce((sum, e) => sum + e.estMinutes, 0) };
}

export function chunkList<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function selectZeroCards(
  db: D1Database,
  completedFrom: string,
  productCodes: readonly string[] | null,
): Promise<ZeroCard[]> {
  const productFilter = productCodes
    ? `AND po.productCode IN (${productCodes.map(() => "?").join(", ")})`
    : "";
  const selection = await db
    .prepare(
      `SELECT jc.id AS "jcId", jc.wipKey AS "wipKey", jc.departmentCode AS "deptCode",
              jc.status AS "status", jc.completedDate AS "completedDate",
              po.poNo AS "poNo", po.id, po.salesOrderId, po.productCode,
              po.itemCategory, po.quantity, po.currentDepartment, po.targetEndDate,
              po.startDate, po.sizeCode, po.sizeLabel, po.fabricCode, po.gapInches,
              po.divanHeightInches, po.legHeightInches
         FROM job_cards jc
         JOIN production_orders po ON po.id = jc.productionOrderId
        WHERE COALESCE(jc.productionTimeMinutes, 0) = 0
          AND (jc.status IN (${LIVE_STATUSES})
               ${completedFrom ? "OR jc.completedDate >= ?" : ""})
          ${productFilter}
        ORDER BY jc.id`,
    )
    .bind(...(completedFrom ? [completedFrom] : []), ...(productCodes ?? []))
    .all<ZeroCard>();
  return selection.results ?? [];
}

async function loadZeroCards(db: D1Database, scope: ZeroMinuteScope): Promise<ZeroCard[]> {
  const completedFrom = scope.completedFrom ?? "";
  if (!scope.productCodes) return selectZeroCards(db, completedFrom, null);
  const productCodes = [...new Set(scope.productCodes.filter((code) => code.length > 0))];
  const cards: ZeroCard[] = [];
  for (const codes of chunkList(productCodes, PRODUCT_CODE_CHUNK_SIZE)) {
    cards.push(...(await selectZeroCards(db, completedFrom, codes)));
  }
  return cards;
}

export async function loadLiveDeptKeys(db: D1Database, poId: string): Promise<Map<string, string[]>> {
  const own = await db
    .prepare(
      `SELECT wipKey AS "wipKey", departmentCode AS "deptCode" FROM job_cards
        WHERE productionOrderId = ? AND status <> 'CANCELLED'`,
    )
    .bind(poId)
    .all<{ wipKey: string | null; deptCode: string | null }>();
  const deptKeys = new Map<string, string[]>();
  for (const row of own.results ?? []) {
    const keys = deptKeys.get(row.deptCode ?? "") ?? [];
    keys.push(row.wipKey ?? "");
    deptKeys.set(row.deptCode ?? "", keys);
  }
  return deptKeys;
}

export async function planZeroMinuteFills(
  db: D1Database,
  scope: ZeroMinuteScope,
): Promise<ZeroMinutePlan> {
  const cards = await loadZeroCards(db, scope);
  const bomCache = new Map<string, Awaited<ReturnType<typeof loadBomTemplate>>>();
  const expectedByPo = new Map<string, ExpectedJc[]>();
  const deptKeysByPo = new Map<string, Map<string, string[]>>();
  const plan: ZeroMinutePlan = {
    scanned: cards.length,
    fills: [],
    skipped: { bomZero: 0, noMatch: 0, sofaFabCutMerge: 0, duplicateDept: 0 },
    skippedSamples: [],
  };

  for (const card of cards) {
    const productCode = card.productCode ?? "";
    let expected = expectedByPo.get(card.id);
    if (!expected) {
      if (!bomCache.has(productCode)) bomCache.set(productCode, await loadBomTemplate(db, productCode));
      expected = computeExpectedJcs(card, bomCache.get(productCode) ?? null);
      expectedByPo.set(card.id, expected);
    }
    let deptKeys = deptKeysByPo.get(card.id);
    if (!deptKeys) {
      deptKeys = await loadLiveDeptKeys(db, card.id);
      deptKeysByPo.set(card.id, deptKeys);
    }
    const wipKey = card.wipKey ?? "";
    const deptCode = card.deptCode ?? "";
    const match = bomMinutesForCard(
      { wipKey, deptCode, poId: card.id },
      expected,
      (deptKeys.get(deptCode) ?? []).some((key) => key !== wipKey),
    );
    const base = { jcId: card.jcId, poNo: card.poNo ?? "", productCode, deptCode };
    if ("skip" in match || match.minutes <= 0) {
      const reason: ZeroMinuteSkipReason = "skip" in match ? match.skip : "bomZero";
      plan.skipped[reason]++;
      if (plan.skippedSamples.length < SKIPPED_SAMPLE_LIMIT) plan.skippedSamples.push({ ...base, reason });
      continue;
    }
    plan.fills.push({ ...base, status: card.status, minutes: match.minutes });
  }
  return plan;
}

export async function writeZeroMinuteFills(
  c: Context<Env>,
  fills: readonly ZeroMinuteFill[],
  source: AuditSource,
): Promise<number> {
  const db = c.var.DB;
  let updated = 0;
  for (const part of chunkList(fills, WRITE_CHUNK_SIZE)) {
    const statements: D1PreparedStatement[] = [];
    for (const fill of part) {
      // Re-checks 0 so a card that got minutes since the SELECT is left alone.
      statements.push(
        db
          .prepare(
            `UPDATE job_cards SET productionTimeMinutes = ?, estMinutes = ?
              WHERE id = ? AND COALESCE(productionTimeMinutes, 0) = 0`,
          )
          .bind(fill.minutes, fill.minutes, fill.jcId),
      );
      const audit = await buildAuditStatement(c, {
        resource: "job-cards",
        resourceId: fill.jcId,
        action: "fill-zero-minutes-from-bom",
        before: { productionTimeMinutes: 0, deptCode: fill.deptCode },
        after: { productionTimeMinutes: fill.minutes, estMinutes: fill.minutes, deptCode: fill.deptCode },
        source,
      });
      if (audit) statements.push(audit);
    }
    await db.batch(statements);
    updated += part.length;
  }
  return updated;
}
