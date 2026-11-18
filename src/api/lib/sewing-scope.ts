import { parseStickerData } from "../../lib/qr-utils";
import { resolvePo } from "./sticker-resolve";
import type { PoMatch } from "./sticker-resolve";

export interface SewingScope {
  productionOrderId: string;
  wipKey: string | null;
  pieceNo: number | null;
}

export type SewingScopeLookup =
  | {
      kind: "found";
      scope: SewingScope;
      order: PoMatch;
      itemLabel: string;
      totalPieces: number | null;
      isSewn: boolean;
    }
  | { kind: "not-a-sewing-sticker" }
  | { kind: "order-not-found" }
  | { kind: "compartment-not-found" };

type SewingCardRow = {
  id: string;
  wipKey: string | null;
  wipLabel: string | null;
  status: string | null;
};

const FINISHED_STATUSES: readonly string[] = ["COMPLETED", "TRANSFERRED"];
const FAB_SEW_SENTINEL = "FG-FAB_SEW";

export async function resolveSewingScope(
  db: D1Database,
  request: { productionOrderId: string; wipKey?: string; pieceNo?: number },
): Promise<SewingScope> {
  let wipKey = request.wipKey;
  let pieceNo = request.pieceNo;
  // SOFA exception: a sofa BASE compartment represents the WHOLE variant — its
  // base, cushions and armrests are sewn together by one worker (Wei Siang
  // 2026-06-07: scan 1A → 1A's base + armrest + back-cushion complete together).
  // The base sticker carries the base's own wipKey so the PHONE resolves it to a
  // single card (no Divan-vs-HB-style chooser), but COMPLETION must fan out to
  // every FAB_SEW / UPHOLSTERY card of the variant. Detect a sofa compartment by
  // its wipType (SOFA_BASE / SOFA_CUSHION / SOFA_ARMREST / SOFA_HEADREST) and drop
  // the per-compartment + per-piece scoping so the whole-dept fan-out runs.
  // Bedframe pieces (DIVAN / HEADBOARD) are NOT SOFA_* — they keep per-piece
  // scoping and stay separately scannable.
  if (wipKey) {
    const wkProbe = await db
      .prepare(
        "SELECT wipType FROM job_cards WHERE productionOrderId = ? AND wipKey = ? LIMIT 1",
      )
      .bind(request.productionOrderId, wipKey)
      .first<{ wipType: string | null }>();
    if ((wkProbe?.wipType || "").toUpperCase().startsWith("SOFA_")) {
      wipKey = undefined;
      pieceNo = undefined;
    }
  }
  return {
    productionOrderId: request.productionOrderId,
    wipKey: wipKey ?? null,
    pieceNo: pieceNo ?? null,
  };
}

async function loadSewingCards(
  db: D1Database,
  productionOrderId: string,
): Promise<SewingCardRow[]> {
  const result = await db
    .prepare(
      "SELECT id, wipKey, wipLabel, status FROM job_cards WHERE productionOrderId = ? AND departmentCode = 'FAB_SEW'",
    )
    .bind(productionOrderId)
    .all<SewingCardRow>();
  return result.results ?? [];
}

export type SewingCardState = {
  id: string;
  wipKey: string | null;
  status: string | null;
};

export type PieceSlotState = {
  jobCardId: string;
  pieceNo: number;
  pic1Id: string | null;
};

export function openCardsInScope(
  scope: SewingScope,
  cards: readonly SewingCardState[],
): SewingCardState[] {
  return cards.filter(
    (card) =>
      (!scope.wipKey || card.wipKey === scope.wipKey) &&
      !FINISHED_STATUSES.includes(card.status ?? ""),
  );
}

export function isScopeSewn(
  scope: SewingScope,
  cards: readonly SewingCardState[],
  slots: readonly PieceSlotState[],
): boolean {
  const inScope = cards.filter(
    (card) => !scope.wipKey || card.wipKey === scope.wipKey,
  );
  if (inScope.length === 0) return false;
  const open = openCardsInScope(scope, cards);
  if (open.length === 0) return true;
  if (scope.pieceNo === null) return false;
  return open.every((card) =>
    slots.some(
      (slot) =>
        slot.jobCardId === card.id &&
        slot.pieceNo === scope.pieceNo &&
        !!slot.pic1Id,
    ),
  );
}

export async function isSewingDone(
  db: D1Database,
  scope: SewingScope,
): Promise<boolean> {
  const cards = await loadSewingCards(db, scope.productionOrderId);
  const open = openCardsInScope(scope, cards);
  let slots: PieceSlotState[] = [];
  if (open.length > 0 && scope.pieceNo !== null) {
    const result = await db
      .prepare(
        `SELECT jobCardId, pieceNo, pic1Id FROM piece_pics WHERE jobCardId IN (${open.map(() => "?").join(",")}) AND pieceNo = ?`,
      )
      .bind(...open.map((card) => card.id), scope.pieceNo)
      .all<PieceSlotState>();
    slots = result.results ?? [];
  }
  return isScopeSewn(scope, cards, slots);
}

function compartmentOf(wipKey: string | null): string {
  return (wipKey || "").split("::")[2] ?? "";
}

export async function sewingScopeFromSticker(
  db: D1Database,
  rawQr: string,
): Promise<SewingScopeLookup> {
  const parsed = parseStickerData(rawQr.trim());
  if (!parsed) return { kind: "not-a-sewing-sticker" };
  const isCompartmentSticker = !!(parsed.compartment || parsed.wipKey);
  const isSewingSentinel =
    parsed.opId === FAB_SEW_SENTINEL && parsed.deptCode === "FAB_SEW";
  if (!isCompartmentSticker && !isSewingSentinel) {
    return { kind: "not-a-sewing-sticker" };
  }

  const order =
    (parsed.jobCardId ? await resolvePo(db, parsed.jobCardId) : null) ??
    (await resolvePo(db, parsed.poNo));
  if (!order) return { kind: "order-not-found" };

  const cards = await loadSewingCards(db, order.productionOrderId);
  let requestedWipKey: string | undefined;
  let itemLabel = order.description;
  if (isCompartmentSticker) {
    const matching = cards.filter((card) =>
      parsed.wipKey
        ? card.wipKey === parsed.wipKey
        : compartmentOf(card.wipKey) === parsed.compartment,
    );
    const distinctWipKeys = [...new Set(matching.map((card) => card.wipKey))];
    if (distinctWipKeys.length !== 1 || !distinctWipKeys[0]) {
      return { kind: "compartment-not-found" };
    }
    requestedWipKey = distinctWipKeys[0];
    itemLabel = (matching[0]?.wipLabel || "").trim() || order.description;
  } else if (cards.length === 0) {
    return { kind: "compartment-not-found" };
  }

  const scope = await resolveSewingScope(db, {
    productionOrderId: order.productionOrderId,
    wipKey: requestedWipKey,
    pieceNo: parsed.pieceNo,
  });
  return {
    kind: "found",
    scope,
    order,
    itemLabel,
    totalPieces: scope.pieceNo === null ? null : (parsed.totalPieces ?? null),
    isSewn: await isSewingDone(db, scope),
  };
}
