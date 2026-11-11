import type { Context } from "hono";
import type { Env } from "../worker";
import { todayYmdMY } from "../../lib/utils";
import { buildAuditStatement } from "./audit";
import {
  computeExpectedJcs,
  type ExpectedJc,
  type ProductionOrderRow,
} from "./expected-job-cards";
import {
  LIVE_STATUSES,
  LIVE_STATUS_LIST,
  bomMinutesForCard,
  chunkList,
  loadLiveDeptKeys,
} from "./fill-zero-minutes";

export interface BomMinutesSource {
  wipComponents: string | null;
  l1Processes: string | null;
  baseModel: string | null;
}

export interface SavedBomChange {
  productCode: string;
  before: BomMinutesSource | null;
  after: BomMinutesSource;
}

export interface CardMinutesChange {
  jcId: string;
  deptCode: string;
  fromMinutes: number;
  toMinutes: number;
  isCompleted: boolean;
}

export type CardMinutesSyncOutcome = { updated: number; scanned: number } | { error: string };

export interface JobCardMinutesPreview {
  toUpdate: number;
  unfinished: number;
  completedThisMonth: number;
}

export type JobCardMinutesPreviewOutcome = JobCardMinutesPreview | { error: string };

type CandidateCard = ProductionOrderRow & {
  jcId: string;
  wipKey: string | null;
  deptCode: string | null;
  status: string;
  minutes: number | null;
};


interface ProductBomChange {
  before: BomMinutesSource | null;
  after: BomMinutesSource;
}

const WRITE_CHUNK_SIZE = 50;
const PRODUCT_CODE_CHUNK_SIZE = 100;

export function currentMonthStartMY(): string {
  return `${todayYmdMY().slice(0, 8)}01`;
}

export function decideCardMinutes(
  currentMinutes: number,
  beforeMinutes: number | null,
  afterMinutes: number | null,
): number | null {
  if (afterMinutes === null || afterMinutes <= 0) return null;
  if (currentMinutes === afterMinutes) return null;
  if (currentMinutes === 0) return afterMinutes;
  if (beforeMinutes !== null && beforeMinutes !== afterMinutes) return afterMinutes;
  return null;
}

function mergeChangesByProduct(changes: readonly SavedBomChange[]): Map<string, ProductBomChange> {
  const byProduct = new Map<string, ProductBomChange>();
  for (const change of changes) {
    if (!change.productCode) continue;
    const earlier = byProduct.get(change.productCode);
    byProduct.set(change.productCode, { before: earlier ? earlier.before : change.before, after: change.after });
  }
  return byProduct;
}

async function selectCandidateCards(
  db: D1Database,
  productCodes: readonly string[],
  completedFrom: string,
): Promise<CandidateCard[]> {
  const selection = await db
    .prepare(
      `SELECT jc.id AS "jcId", jc.wipKey AS "wipKey", jc.departmentCode AS "deptCode",
              jc.status AS "status", jc.productionTimeMinutes AS "minutes",
              po.id, po.salesOrderId, po.productCode,
              po.itemCategory, po.quantity, po.currentDepartment, po.targetEndDate,
              po.startDate, po.sizeCode, po.sizeLabel, po.fabricCode, po.gapInches,
              po.divanHeightInches, po.legHeightInches
         FROM job_cards jc
         JOIN production_orders po ON po.id = jc.productionOrderId
        WHERE (jc.status IN (${LIVE_STATUSES}) OR jc.completedDate >= ?)
          AND jc.status <> 'CANCELLED'
          AND po.productCode IN (${productCodes.map(() => "?").join(", ")})
        ORDER BY jc.id`,
    )
    .bind(completedFrom, ...productCodes)
    .all<CandidateCard>();
  return selection.results ?? [];
}

async function loadCandidateCards(db: D1Database, productCodes: readonly string[]): Promise<CandidateCard[]> {
  const completedFrom = currentMonthStartMY();
  const cards: CandidateCard[] = [];
  for (const codes of chunkList(productCodes, PRODUCT_CODE_CHUNK_SIZE)) {
    cards.push(...(await selectCandidateCards(db, codes, completedFrom)));
  }
  return cards;
}

function minutesFromBom(
  card: { wipKey: string; deptCode: string; poId: string },
  expected: readonly ExpectedJc[] | null,
  hasOtherCardInDept: boolean,
): number | null {
  if (!expected) return null;
  const match = bomMinutesForCard(card, expected, hasOtherCardInDept);
  return "minutes" in match ? match.minutes : null;
}

export async function planCardMinutesChanges(
  db: D1Database,
  savedChanges: readonly SavedBomChange[],
): Promise<{ scanned: number; changes: CardMinutesChange[] }> {
  const byProduct = mergeChangesByProduct(savedChanges);
  if (byProduct.size === 0) return { scanned: 0, changes: [] };
  const cards = await loadCandidateCards(db, [...byProduct.keys()]);
  const expectedCache = new Map<string, ExpectedJc[] | null>();
  const deptKeysCache = new Map<string, Map<string, string[]>>();
  const expectedFor = (card: CandidateCard, side: "before" | "after", source: BomMinutesSource | null) => {
    const cacheKey = `${card.id}::${side}`;
    if (!expectedCache.has(cacheKey)) expectedCache.set(cacheKey, source ? computeExpectedJcs(card, source) : null);
    return expectedCache.get(cacheKey) ?? null;
  };
  const changes: CardMinutesChange[] = [];

  for (const card of cards) {
    const productChange = byProduct.get(card.productCode ?? "");
    if (!productChange) continue;
    const cardKey = { wipKey: card.wipKey ?? "", deptCode: card.deptCode ?? "", poId: card.id };
    let hasOtherCardInDept = false;
    if (cardKey.wipKey.endsWith("::FG_MAIN")) {
      if (!deptKeysCache.has(card.id)) deptKeysCache.set(card.id, await loadLiveDeptKeys(db, card.id));
      const keysInDept = deptKeysCache.get(card.id)?.get(cardKey.deptCode) ?? [];
      hasOtherCardInDept = keysInDept.some((key) => key !== cardKey.wipKey);
    }
    const currentMinutes = Number(card.minutes) || 0;
    const target = decideCardMinutes(
      currentMinutes,
      minutesFromBom(cardKey, expectedFor(card, "before", productChange.before), hasOtherCardInDept),
      minutesFromBom(cardKey, expectedFor(card, "after", productChange.after), hasOtherCardInDept),
    );
    if (target === null) continue;
    changes.push({
      jcId: card.jcId,
      deptCode: cardKey.deptCode,
      fromMinutes: currentMinutes,
      toMinutes: target,
      isCompleted: !LIVE_STATUS_LIST.includes(card.status),
    });
  }
  return { scanned: cards.length, changes };
}

export async function writeCardMinutesChanges(
  c: Context<Env>,
  changes: readonly CardMinutesChange[],
): Promise<number> {
  const db = c.var.DB;
  let updated = 0;
  for (const part of chunkList(changes, WRITE_CHUNK_SIZE)) {
    const statements: D1PreparedStatement[] = [];
    for (const change of part) {
      statements.push(
        db
          .prepare(
            `UPDATE job_cards SET productionTimeMinutes = ?, estMinutes = ?
              WHERE id = ? AND COALESCE(productionTimeMinutes, 0) = ?`,
          )
          .bind(change.toMinutes, change.toMinutes, change.jcId, change.fromMinutes),
      );
      const audit = await buildAuditStatement(c, {
        resource: "job-cards",
        resourceId: change.jcId,
        action: "sync-minutes-from-bom-edit",
        before: { productionTimeMinutes: change.fromMinutes, deptCode: change.deptCode },
        after: { productionTimeMinutes: change.toMinutes, estMinutes: change.toMinutes, deptCode: change.deptCode },
        source: "system",
      });
      if (audit) statements.push(audit);
    }
    await db.batch(statements);
    updated += part.length;
  }
  return updated;
}

export function summarizeCardMinutesChanges(changes: readonly CardMinutesChange[]): JobCardMinutesPreview {
  const completedThisMonth = changes.filter((change) => change.isCompleted).length;
  return { toUpdate: changes.length, unfinished: changes.length - completedThisMonth, completedThisMonth };
}

export async function previewJobCardMinutesForBomChanges(
  db: D1Database,
  savedChanges: readonly SavedBomChange[],
): Promise<JobCardMinutesPreviewOutcome> {
  try {
    const plan = await planCardMinutesChanges(db, savedChanges);
    return summarizeCardMinutesChanges(plan.changes);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[bom-edit-card-sync preview] err=${message}`);
    return { error: message };
  }
}

export async function syncJobCardMinutesToBomChanges(
  c: Context<Env>,
  savedChanges: readonly SavedBomChange[],
): Promise<CardMinutesSyncOutcome> {
  if (savedChanges.length === 0) return { updated: 0, scanned: 0 };
  try {
    const plan = await planCardMinutesChanges(c.var.DB, savedChanges);
    const updated = await writeCardMinutesChanges(c, plan.changes);
    return { updated, scanned: plan.scanned };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const productCodes = savedChanges.map((change) => change.productCode).join(",");
    console.error(`[bom-edit-card-sync] products=${productCodes} err=${message}`);
    return { error: message };
  }
}
