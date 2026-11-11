// ===========================================================================
// Warehouse (mobile) — shared types, helpers and small atoms.
//
// Everything here is LOCAL to the /m Warehouse screen (owner 2026-10-26: keep
// the helper functions local, do not extract them to a shared file). The two
// rack-item helpers mirror src/pages/warehouse.tsx (`rackItemSO`,
// `rackItemDescription`) because desktop wins where mobile differs.
// ===========================================================================
import { M } from "../../theme";
import { str } from "../../config/helpers";

// ---- API shapes (subset of routes/warehouse.ts output) ----
export type RackItem = {
  productionOrderId?: string;
  productCode?: string;
  productName?: string;
  sizeLabel?: string;
  customerName?: string;
  customerPOId?: string;
  companySOId?: string;
  qty?: number;
  stockedInDate?: string;
  notes?: string;
};
export type RackStatus = "OCCUPIED" | "EMPTY" | "RESERVED";
export type Rack = {
  id: string;
  rack: string;
  position?: string;
  status: RackStatus | string;
  items?: RackItem[];
};
export type WarehouseSummary = {
  total?: number;
  occupied?: number;
  empty?: number;
  reserved?: number;
  occupancyRate?: number;
};
export type WarehouseResp = { success?: boolean; data?: Rack[]; summary?: WarehouseSummary };
export type Movement = {
  id: string;
  type: string; // STOCK_IN | STOCK_OUT | TRANSFER
  rackLocationId?: string;
  rackLabel?: string;
  productName?: string;
  productCode?: string;
  quantity?: number;
  reason?: string;
  performedBy?: string;
  createdAt?: string;
  docRef?: string;
};
export type MovementsResp = { success?: boolean; data?: Movement[] };
export type RackDetailsResp = {
  success?: boolean;
  data?: { rack?: Rack; contents?: RackItem[]; movements?: Movement[] };
};
export type LocateHit = {
  rackItemId: string;
  rackLocationId: string;
  rackLabel: string;
  description: string;
  notes: string;
  stockedInDate: string;
  poNo: string;
  customerPO: string;
  salesOrderNo: string;
  itemCode: string;
  customerName: string;
};
export type LocateResp = { success?: boolean; data?: LocateHit[] };

export type WarehouseToast = { kind: "ok" | "err"; text: string };

// ---- rack naming / ordering ----
/** Rack name AS STORED ("Floor", "Rack 1"); the position is appended only when it exists. */
export function rackLabel(r: Pick<Rack, "rack" | "position">): string {
  const name = (r.rack ?? "").trim();
  const pos = (r.position ?? "").trim();
  return pos ? `${name} · ${pos}` : name;
}

/** Desktop's order (src/pages/warehouse.tsx): numeric part first, then the raw name. */
export function sortRacks(list: Rack[]): Rack[] {
  const no = (s: string) => parseInt(s.match(/\d+/)?.[0] ?? "0", 10);
  return [...list].sort((a, b) => no(a.rack) - no(b.rack) || a.rack.localeCompare(b.rack));
}

// ---- rack item identity (mirrors desktop) ----
export function rackItemSO(it: RackItem): string {
  const m = (it.notes || "").match(/\bSO\s+(\S+)/i);
  return m ? m[1] : it.companySOId || "";
}
export function rackItemDescription(it: RackItem): string {
  const name = (it.productName || it.productCode || "").trim();
  const size = (it.sizeLabel || "").trim();
  const desc = size && !name.includes(size) ? `${name} ${size}`.trim() : name;
  return desc || "Item";
}
/** "customer PO · SO" line, either half optional. */
export function rackItemRefs(it: RackItem): string {
  return [it.customerPOId || "", rackItemSO(it)].filter(Boolean).join(" · ");
}
export function itemsOf(r: Rack): RackItem[] {
  return Array.isArray(r.items) ? r.items : [];
}
export function rackStatusOf(r: Rack): RackStatus {
  const s = str(r as unknown as Record<string, unknown>, "status");
  return s === "OCCUPIED" || s === "RESERVED" ? s : "EMPTY";
}
export function pluralItems(n: number): string {
  return `${n} item${n === 1 ? "" : "s"}`;
}

// ---- status look ----
// Fixed hex on purpose: these are warm status tints from the design that must
// keep their meaning in dark mode too (M.taupe lightens in dark mode and would
// put white text on a pale tile).
export const TILE = {
  OCCUPIED: { bg: "#6B5C32", fg: "#FFFFFF", shadow: "0 10px 22px -14px rgba(107,92,50,.8)" },
  EMPTY: { bg: "#EEF3E4", fg: "#3D6229", shadow: "none" },
  RESERVED: { bg: "#FAEFCB", fg: "#85600F", shadow: "none" },
} as const;
export const STATUS_DOT = { OCCUPIED: "#6B5C32", RESERVED: "#9C6F1E", EMPTY: "#4F7C3A" } as const;
export const STATUS_LABEL = { OCCUPIED: "Occupied", RESERVED: "Reserved", EMPTY: "Empty" } as const;

// ---- dates ----
export function dateTimeShort(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
export function dateShort(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// ---- movements ----
// IN green, OUT red, TRANSFER neutral. A move's reason is written as
// "Moved from <rack>" (public-rack-qr.ts), so from → to is recovered from it.
export function movementLook(m: Movement) {
  if (m.type === "STOCK_IN") return { tag: "STOCK IN", rail: "#4F7C3A", bg: "#EEF3E4", fg: "#4F7C3A" };
  if (m.type === "TRANSFER") return { tag: "TRANSFER", rail: "#5B4B8A", bg: "#EDE8F5", fg: "#5B4B8A" };
  return { tag: "STOCK OUT", rail: "#9A3A2D", bg: "#F9E1DA", fg: "#9A3A2D" };
}
export function movedFrom(m: Movement): string {
  return (str(m, "reason").match(/^Moved from (.+)$/)?.[1] ?? "").trim();
}
/**
 * "from → to" for a move, else the rack. The rack NAME is resolved from
 * rackLocationId when possible: desktop writes the rack id into rackLabel on
 * its own movements, which would otherwise show as a UUID.
 */
export function movementRackText(m: Movement, nameById: Map<string, string>): string {
  const to = (m.rackLocationId && nameById.get(m.rackLocationId)) || str(m, "rackLabel");
  const from = movedFrom(m);
  return from ? `${from} → ${to || "—"}` : to;
}

// ---- form input style ----
export const FIELD_INPUT = {
  width: "100%",
  height: 46,
  border: `1px solid ${M.hairline}`,
  borderRadius: 12,
  padding: "0 13px",
  fontSize: 15,
  color: M.raisin,
  background: M.card,
  outline: "none",
  fontFamily: "inherit",
  boxSizing: "border-box",
} as const;
