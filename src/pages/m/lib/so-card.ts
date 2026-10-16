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
//   • activeFilterChips: one removable chip per active FilterSheet filter
//     (owner 2026-10-15, live prototype). Same "active" test as
//     activeFilterCount (config/helpers.ts), so the chips and the badge count
//     always agree. Expected DD / Amount presets show their name ("This
//     week", "Under RM 10k"); Amount values are sen and go through the
//     caller's money formatter (2026-10-15); other numbers show as stored.
// ---------------------------------------------------------------------------
import {
  AMT_KEY,
  AMT_PRESETS,
  EXP_KEY,
  EXP_PRESETS,
  detectAmtPreset,
  detectExpPreset,
  type Filter,
} from "./so-filter-presets";

type Row = Record<string, unknown>;

const OP: Record<string, string> = { eq: "=", gt: ">", lt: "<", gte: "≥", lte: "≤" };

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export function activeFilterChips(
  filters: Record<string, Filter>,
  columns: { key: string; label: string }[],
  opts: { today: string; money: (sen: number) => string },
): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  for (const col of columns) {
    const f = filters[col.key];
    if (!f) continue;
    const l = col.label;
    const exp = col.key === EXP_KEY ? detectExpPreset(f, opts.today) : "custom";
    const amt = col.key === AMT_KEY ? detectAmtPreset(f) : "custom";
    if (exp !== "custom" && exp !== "any") {
      out.push({ key: col.key, label: `${l}: ${EXP_PRESETS.find((p) => p.key === exp)!.label}` });
    } else if (amt !== "custom" && amt !== "any") {
      out.push({ key: col.key, label: AMT_PRESETS.find((p) => p.key === amt)!.label });
    } else if (f.type === "text" && f.contains.trim()) {
      out.push({ key: col.key, label: `${l}: ${f.contains.trim()}` });
    } else if (f.type === "number" && f.a != null) {
      const n = (x: number) => (col.key === AMT_KEY ? opts.money(x) : String(x));
      const v =
        f.op === "between"
          ? f.b != null ? `${n(Math.min(f.a, f.b))} – ${n(Math.max(f.a, f.b))}` : `${n(f.a)} – …`
          : `${OP[f.op] ?? "="} ${n(f.a)}`;
      out.push({ key: col.key, label: `${l} ${v}` });
    } else if (f.type === "date" && (f.from || f.to)) {
      const v = f.from && f.to ? `${f.from} – ${f.to}` : f.from ? `from ${f.from}` : `to ${f.to}`;
      out.push({ key: col.key, label: `${l} ${v}` });
    } else if (f.type === "enum" && f.selected.length) {
      const v = f.selected.length === 1 ? titleCase(f.selected[0]) : `${f.selected.length} selected`;
      out.push({ key: col.key, label: `${l}: ${v}` });
    }
  }
  return out;
}

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
