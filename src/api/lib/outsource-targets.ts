import { parseJobCardBarcode, parseStickerData } from "../../lib/qr-utils";
import { freshAll, freshFirst } from "./worker-penalties";
import { resolvePo } from "./sticker-resolve";
import type { PoMatch } from "./sticker-resolve";
import { ensureJobCardQrTokenColumn } from "./jobcard-qr-token";
import { isSofaWipType } from "./sewing-scope";
import { loadDoneSlots, slotKey } from "./outsource-issue";

export interface IssueTarget {
  cardIds: string[];
  pieceNo: number | null;
}

export function singleCardTarget(cardId: string, pieceNo: number | null): IssueTarget {
  return { cardIds: [cardId], pieceNo };
}

export function fanOutTarget(cards: ReadonlyArray<{ id: string }>, pieceNo: number | null): IssueTarget {
  return { cardIds: cards.map((card) => card.id), pieceNo };
}

export interface TargetCard {
  id: string;
  departmentCode: string;
  wipKey: string | null;
  wipLabel: string | null;
  wipType: string | null;
  status: string | null;
}

export type TargetLookup =
  | {
      kind: "found";
      departmentCode: string;
      order: PoMatch;
      itemLabel: string;
      totalPieces: number | null;
      target: IssueTarget;
      isDone: boolean;
    }
  | { kind: "not-a-sticker" }
  | { kind: "order-not-found" }
  | { kind: "no-worker-department" }
  | { kind: "no-card-for-department"; departmentCodes: string[] }
  | { kind: "ambiguous-department"; departments: string[] };

export type StickerRef =
  | { kind: "order"; pieceLabel: string | null }
  | { kind: "card"; cardId: string }
  | { kind: "compartment"; compartment: string | null; wipKey: string | null };

interface ParsedSticker {
  order: PoMatch;
  ref: StickerRef;
  pieceNo: number | null;
  totalPieces: number | null;
  namedDepartment: string | null;
}

const SENTINEL_PREFIX = "FG-";
const PACKING_TOKEN_PATTERN = /\/p\/([0-9a-f]{64})(?:[/?#]|$)/i;

function compartmentOf(wipKey: string | null): string {
  return (wipKey || "").split("::")[2] ?? "";
}

function isSofaVariant(cards: readonly TargetCard[], wipKey: string | null): boolean {
  return cards.some((card) => card.wipKey === wipKey && isSofaWipType(card.wipType));
}

async function parsePackingToken(
  db: D1Database,
  raw: string,
  token: string,
): Promise<ParsedSticker | null | "order-not-found"> {
  await ensureJobCardQrTokenColumn(db);
  const card = await freshFirst<Record<string, unknown>>(
    db,
    db.prepare("SELECT id FROM job_cards WHERE qr_token = ? LIMIT 1").bind(token),
  );
  if (!card) return "order-not-found";
  const cardId = String(card.id);
  const order = await resolvePo(db, cardId);
  if (!order) return "order-not-found";
  let pieceNo: number | null = null;
  try {
    const rawPiece = Number(new URL(raw).searchParams.get("p"));
    if (Number.isInteger(rawPiece) && rawPiece > 0) pieceNo = rawPiece;
  } catch {
    pieceNo = null;
  }
  return { order, ref: { kind: "card", cardId }, pieceNo, totalPieces: null, namedDepartment: null };
}

async function parseSticker(db: D1Database, rawQr: string): Promise<ParsedSticker | null | "order-not-found"> {
  const raw = rawQr.trim();
  const scheduleToken = parseJobCardBarcode(raw);
  if (scheduleToken) {
    const order = await resolvePo(db, scheduleToken);
    if (!order?.jobCardId) return "order-not-found";
    return {
      order,
      ref: { kind: "card", cardId: order.jobCardId },
      pieceNo: null,
      totalPieces: null,
      namedDepartment: null,
    };
  }
  const packingToken = PACKING_TOKEN_PATTERN.exec(raw);
  if (packingToken) return parsePackingToken(db, raw, packingToken[1]);
  const parsed = parseStickerData(raw);
  if (!parsed) return null;
  let ref: StickerRef;
  if (parsed.compartment || parsed.wipKey) {
    ref = {
      kind: "compartment",
      compartment: parsed.compartment ?? null,
      wipKey: parsed.wipKey ?? null,
    };
  } else if (parsed.opId?.startsWith(SENTINEL_PREFIX)) {
    ref = parsed.jobCardId
      ? { kind: "card", cardId: parsed.jobCardId }
      : { kind: "order", pieceLabel: parsed.pieceLabel ?? null };
  } else if (parsed.opId) {
    ref = { kind: "card", cardId: parsed.opId };
  } else {
    return null;
  }
  const order =
    (ref.kind === "card" ? await resolvePo(db, ref.cardId) : null) ??
    (await resolvePo(db, parsed.poNo));
  if (!order) return "order-not-found";
  return {
    order,
    ref,
    pieceNo: parsed.pieceNo ?? null,
    totalPieces: parsed.totalPieces ?? null,
    namedDepartment: departmentNamedBy(parsed.opId, parsed.deptCode),
  };
}

function departmentNamedBy(opId: string | undefined, deptCode: string | undefined): string | null {
  if (opId?.startsWith(SENTINEL_PREFIX)) return opId.slice(SENTINEL_PREFIX.length) || null;
  return deptCode || null;
}

function stickerDepartment(parsed: ParsedSticker, cards: readonly TargetCard[]): string | null {
  if (parsed.namedDepartment) return parsed.namedDepartment;
  if (parsed.ref.kind !== "card") return null;
  const cardId = parsed.ref.cardId;
  return cards.find((card) => card.id === cardId)?.departmentCode || null;
}

function departmentsToTry(
  departmentCodesOfWorker: readonly string[],
  namedDepartment: string | null,
): readonly string[] {
  return namedDepartment && departmentCodesOfWorker.includes(namedDepartment)
    ? [namedDepartment]
    : departmentCodesOfWorker;
}

export function targetCardsFor(
  cards: readonly TargetCard[],
  ref: StickerRef,
  pieceNo: number | null,
  departmentCode: string,
): { cards: TargetCard[]; pieceNo: number | null; labelCard: TargetCard | null } {
  const ofDepartment = cards.filter((card) => card.departmentCode === departmentCode);
  if (ref.kind === "order") {
    let chosen = ofDepartment;
    if (ref.pieceLabel && chosen.length > 1) {
      const wanted = ref.pieceLabel.trim().toUpperCase();
      const narrowed = chosen.filter((card) => (card.wipLabel ?? "").toUpperCase().includes(wanted));
      if (narrowed.length === 1) chosen = narrowed;
    }
    return { cards: chosen, pieceNo, labelCard: null };
  }
  if (ref.kind === "card") {
    const referenced = cards.find((card) => card.id === ref.cardId);
    if (!referenced) return { cards: [], pieceNo, labelCard: null };
    if (isSofaVariant(cards, referenced.wipKey)) {
      return { cards: ofDepartment, pieceNo: null, labelCard: referenced };
    }
    const chosen =
      referenced.departmentCode === departmentCode
        ? [referenced]
        : ofDepartment.filter((card) => card.wipKey === referenced.wipKey);
    return { cards: chosen, pieceNo, labelCard: chosen[0] ?? null };
  }
  const matching = ofDepartment.filter((card) =>
    ref.wipKey ? card.wipKey === ref.wipKey : compartmentOf(card.wipKey) === ref.compartment,
  );
  if (new Set(matching.map((card) => card.wipKey)).size !== 1) {
    return { cards: [], pieceNo, labelCard: null };
  }
  if (isSofaVariant(cards, matching[0].wipKey)) {
    return { cards: ofDepartment, pieceNo: null, labelCard: matching[0] };
  }
  return { cards: matching, pieceNo, labelCard: matching[0] };
}

export function itemLabelFor(
  chosen: readonly TargetCard[],
  labelCard: TargetCard | null,
  fallback: string,
): string {
  const fromCard = (labelCard?.wipLabel || "").trim();
  if (fromCard) return fromCard;
  if (labelCard === null && new Set(chosen.map((card) => card.wipKey)).size === 1) {
    return (chosen[0]?.wipLabel || "").trim() || fallback;
  }
  return fallback;
}

async function loadOrderCards(db: D1Database, productionOrderId: string): Promise<TargetCard[]> {
  const rows = await freshAll<Record<string, unknown>>(
    db,
    db
      .prepare(
        "SELECT id, departmentCode, wipKey, wipLabel, wipType, status FROM job_cards WHERE productionOrderId = ? ORDER BY sequence, id",
      )
      .bind(productionOrderId),
  );
  return rows.map((row) => ({
    id: String(row.id),
    departmentCode: String(row.departmentCode ?? row.department_code ?? ""),
    wipKey: (row.wipKey ?? row.wip_key ?? null) as string | null,
    wipLabel: (row.wipLabel ?? row.wip_label ?? null) as string | null,
    wipType: (row.wipType ?? row.wip_type ?? null) as string | null,
    status: (row.status ?? null) as string | null,
  }));
}

export async function resolveIssueTarget(
  db: D1Database,
  request: { qr: string; departmentCodes: readonly string[] },
): Promise<TargetLookup> {
  if (request.departmentCodes.length === 0) return { kind: "no-worker-department" };
  const parsed = await parseSticker(db, request.qr);
  if (parsed === null) return { kind: "not-a-sticker" };
  if (parsed === "order-not-found") return { kind: "order-not-found" };

  const cards = await loadOrderCards(db, parsed.order.productionOrderId);
  const candidates = [];
  for (const departmentCode of departmentsToTry(request.departmentCodes, stickerDepartment(parsed, cards))) {
    const { cards: chosen, pieceNo, labelCard } = targetCardsFor(cards, parsed.ref, parsed.pieceNo, departmentCode);
    if (chosen.length === 0) continue;
    const slots = chosen.map((card) => ({ cardId: card.id, pieceNo }));
    const done = await loadDoneSlots(db, slots);
    candidates.push({
      departmentCode,
      cards: chosen,
      pieceNo,
      labelCard,
      isDone: slots.every((slot) => done.has(slotKey(slot))),
    });
  }
  if (candidates.length === 0) {
    return { kind: "no-card-for-department", departmentCodes: [...request.departmentCodes] };
  }
  const open = candidates.filter((candidate) => !candidate.isDone);
  if (open.length > 1) {
    return { kind: "ambiguous-department", departments: open.map((entry) => entry.departmentCode) };
  }
  const picked = open[0] ?? candidates[0];
  return {
    kind: "found",
    departmentCode: picked.departmentCode,
    order: parsed.order,
    itemLabel: itemLabelFor(picked.cards, picked.labelCard, parsed.order.description),
    totalPieces: picked.pieceNo === null ? null : parsed.totalPieces,
    target: { cardIds: picked.cards.map((card) => card.id), pieceNo: picked.pieceNo },
    isDone: picked.isDone,
  };
}
