// ---------------------------------------------------------------------------
// so-card.ts — pure field derivations for the phone Sales Orders card
// (owner 2026-10-14). Kept free of React / "@/" imports so the test can load it.
//
//   • soTotalQty: Σ items[].quantity — the same sum desktop's Qty column uses
//     (src/pages/sales/index.tsx `row.items.reduce(s + i.quantity)`). NEVER the
//     line count. null when the row carries no items array, so the card shows
//     "—" instead of a made-up 0.
//   • soRefLine: "PO {customer PO} · Cust SO {customer SO}" (Claude Design
//     prototype, owner 2026-10-14). Empty parts are omitted; "" when both are
//     blank so the card hides the row. customerPOId first, as desktop shows it.
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;

function text(row: Row, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

export function soTotalQty(row: Row): number | null {
  const items = row.items;
  if (!Array.isArray(items)) return null;
  let total = 0;
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const n = Number((it as Row).quantity ?? (it as Row).qty);
    if (Number.isFinite(n)) total += n;
  }
  return total;
}

export function soRefLine(row: Row): string {
  const po = text(row, "customerPOId", "customer_po_id", "customerPO", "customer_po");
  const so = text(row, "customerSOId", "customer_so_id", "customerSO", "customer_so");
  return [po ? `PO ${po}` : "", so ? `Cust SO ${so}` : ""].filter(Boolean).join(" · ");
}
