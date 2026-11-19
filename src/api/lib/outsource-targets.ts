import { parseJobCardBarcode, parseStickerData } from "../../lib/qr-utils";
import { freshAll } from "./worker-penalties";
import { resolvePo } from "./sticker-resolve";
import type { PoMatch } from "./sticker-resolve";
import { loadDoneSlots, slotKey } from "./outsource-issue";

export interface IssueTarget {
  cardIds: string[];
  pieceNo: number | null;
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
  | { kind: "no-card-for-department"; departmentCode: string }
  | { kind: "ambiguous-department"; departments: string[] };

export type StickerRef =
  | { kind: "order" }
  | { kind: "card"; cardId: string }
  | { kind: "compartment"; compartment: string | null; wipKey: string | null };

interface ParsedSticker {
  order: PoMatch;
  ref: StickerRef;
  pieceNo: number | null;
  totalPieces: number | null;
}

const SOFA_DEPARTMENTS: readonly string[] = ["FAB_SEW", "UPHOLSTERY"];
const SENTINEL_PREFIX = "FG-";

export function workerDepartments(worker: {
  departmentCode?: unknown;
  departmentCodes?: unknown;
}): string[] {
  const listed = parseCodeList(worker.departmentCodes);
  if (listed.length > 0) return listed;
  return typeof worker.departmentCode === "string" && worker.departmentCode
    ? [worker.departmentCode]
    : [];
}

function parseCodeList(raw: unknown): string[] {
  let value: unknown = raw;
  if (typeof raw === "string" && raw) {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return Array.isArray(value)
    ? value.filter((code): code is string => typeof code === "string" && code.length > 0)
    : [];
}

function compartmentOf(wipKey: string | null): string {
  return (wipKey || "").split("::")[2] ?? "";
}

function isSofaCard(card: TargetCard): boolean {
  return (card.wipType || "").toUpperCase().startsWith("SOFA_");
}

async function parseSticker(db: D1Database, rawQr: string): Promise<ParsedSticker | null | "order-not-found"> {
  const raw = rawQr.trim();
  const scheduleToken = parseJobCardBarcode(raw);
  if (scheduleToken) {
    const order = await resolvePo(db, scheduleToken);
    if (!order?.jobCardId) return "order-not-found";
    return { order, ref: { kind: "card", cardId: order.jobCardId }, pieceNo: null, totalPieces: null };
  }
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
    ref = parsed.jobCardId ? { kind: "card", cardId: parsed.jobCardId } : { kind: "order" };
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
  };
}

export function targetCardsFor(
  cards: readonly TargetCard[],
  ref: StickerRef,
  pieceNo: number | null,
  departmentCode: string,
): { cards: TargetCard[]; pieceNo: number | null } {
  const ofDepartment = cards.filter((card) => card.departmentCode === departmentCode);
  let chosen: TargetCard[] = [];
  if (ref.kind === "order") {
    chosen = ofDepartment;
  } else if (ref.kind === "card") {
    const referenced = cards.find((card) => card.id === ref.cardId);
    if (referenced) {
      chosen =
        referenced.departmentCode === departmentCode
          ? [referenced]
          : ofDepartment.filter((card) => card.wipKey === referenced.wipKey);
      if (isSofaCard(referenced) && SOFA_DEPARTMENTS.includes(departmentCode)) {
        chosen = ofDepartment;
        return { cards: chosen, pieceNo: null };
      }
    }
  } else {
    const matching = ofDepartment.filter((card) =>
      ref.wipKey ? card.wipKey === ref.wipKey : compartmentOf(card.wipKey) === ref.compartment,
    );
    const distinctWipKeys = new Set(matching.map((card) => card.wipKey));
    if (distinctWipKeys.size === 1) {
      chosen = matching;
      if (matching.some(isSofaCard) && SOFA_DEPARTMENTS.includes(departmentCode)) {
        return { cards: ofDepartment, pieceNo: null };
      }
    }
  }
  return { cards: chosen, pieceNo };
}

async function loadOrderCards(db: D1Database, productionOrderId: string): Promise<TargetCard[]> {
  const rows = await freshAll<Record<string, unknown>>(
    db,
    db
      .prepare(
        "SELECT id, departmentCode, wipKey, wipLabel, wipType, status FROM job_cards WHERE productionOrderId = ?",
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
  for (const departmentCode of request.departmentCodes) {
    const { cards: chosen, pieceNo } = targetCardsFor(cards, parsed.ref, parsed.pieceNo, departmentCode);
    if (chosen.length === 0) continue;
    const slots = chosen.map((card) => ({ cardId: card.id, pieceNo }));
    const done = await loadDoneSlots(db, slots);
    candidates.push({
      departmentCode,
      cards: chosen,
      pieceNo,
      isDone: slots.every((slot) => done.has(slotKey(slot))),
    });
  }
  if (candidates.length === 0) {
    return { kind: "no-card-for-department", departmentCode: request.departmentCodes[0] };
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
    itemLabel: (picked.cards[0].wipLabel || "").trim() || parsed.order.description,
    totalPieces: picked.pieceNo === null ? null : parsed.totalPieces,
    target: { cardIds: picked.cards.map((card) => card.id), pieceNo: picked.pieceNo },
    isDone: picked.isDone,
  };
}
