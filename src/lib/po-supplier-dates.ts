/**
 * Review H2-8 (Houzs#4571 / #5035) — a PO keeps every delivery date the
 * supplier gives: Date 1, then revised Date 2 / 3 / 4. A recorded date can't
 * be overwritten or cleared, so the slip history stays on the PO.
 *
 * Stored in `purchase_orders.supplier_date_1..4` (TEXT, YYYY-MM-DD,
 * self-applied by POST /api/purchase-orders/:id/supplier-date — the only
 * writer; the PO edit PUT never touches them). Display / follow-up only: no
 * money, stock or overdue figure reads these dates.
 */
export const SUPPLIER_DATE_SLOTS = [1, 2, 3, 4] as const;
export type SupplierDateSlot = (typeof SUPPLIER_DATE_SLOTS)[number];
export type SupplierDates = [string | null, string | null, string | null, string | null];

const ymd = (v: unknown): string | null => {
  const s = String(v ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

export function isYmd(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
}

/** Date 1..4 off a PO row, dual-keyed (supplier_date_1 / supplierDate1). */
export function readSupplierDates(row: Record<string, unknown> | null | undefined): SupplierDates {
  const r = row ?? {};
  return SUPPLIER_DATE_SLOTS.map((n) => ymd(r[`supplier_date_${n}`] ?? r[`supplierDate${n}`])) as SupplierDates;
}

export function supplierDateLabel(slot: number): string {
  return slot === 1 ? "Date 1" : `Revised date ${slot}`;
}

/** The latest recorded supplier date ("" when none). */
export function latestSupplierDate(dates: SupplierDates): string {
  for (let i = dates.length - 1; i >= 0; i--) if (dates[i]) return dates[i] as string;
  return "";
}

export type SlotPick =
  | { ok: true; slot: SupplierDateSlot; unchanged?: false }
  | { ok: true; unchanged: true }
  | { ok: false; status: 400 | 409; error: string };

/**
 * Which slot a new supplier date goes into. `"next"` = the first empty slot.
 * A filled slot is refused (409) — never overwritten. The same date as the
 * latest recorded one, sent to "next", is a no-op (a double click must not
 * fill two slots with one date).
 */
export function pickSupplierDateSlot(
  dates: SupplierDates,
  date: string,
  slot: unknown = "next",
): SlotPick {
  if (!isYmd(date)) return { ok: false, status: 400, error: "Pick a valid delivery date (YYYY-MM-DD)." };
  if (slot === "next" || slot === undefined || slot === null || slot === "") {
    if (latestSupplierDate(dates) === date) return { ok: true, unchanged: true };
    const idx = dates.findIndex((d) => !d);
    if (idx < 0) {
      return {
        ok: false,
        status: 409,
        error: "All four supplier dates are already recorded. A recorded date can't be overwritten.",
      };
    }
    return { ok: true, slot: (idx + 1) as SupplierDateSlot };
  }
  const n = Number(slot);
  if (!SUPPLIER_DATE_SLOTS.includes(n as SupplierDateSlot)) {
    return { ok: false, status: 400, error: "slot must be 1, 2, 3, 4 or \"next\"." };
  }
  const existing = dates[n - 1];
  if (existing) {
    if (existing === date) return { ok: true, unchanged: true };
    return {
      ok: false,
      status: 409,
      error: `${supplierDateLabel(n)} is already recorded (${existing}) and can't be overwritten.`,
    };
  }
  return { ok: true, slot: n as SupplierDateSlot };
}
