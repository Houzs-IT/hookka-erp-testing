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

// ---------------------------------------------------------------------------
// Sales Orders v3 card (owner 2026-10-26): reference chips and the Expected DD
// countdown. Both come only from fields the list row already carries
// (customerPO / customerSO, hookkaExpectedDD, status); nothing is stored or
// invented. There is deliberately NO progress/stage derivation: the row has no
// production-progress field.
// ---------------------------------------------------------------------------

/** "PO" / "Cust SO" chips; empty parts omitted (same sources as soRefLine). */
export function soRefChips(row: Row): { k: string; v: string }[] {
  const po = text(row, "customerPOId", "customer_po_id", "customerPO", "customer_po");
  const so = text(row, "customerSOId", "customer_so_id", "customerSO", "customer_so");
  const out: { k: string; v: string }[] = [];
  if (po) out.push({ k: "PO", v: po });
  if (so) out.push({ k: "Cust SO", v: so });
  return out;
}

/**
 * Only these statuses show a countdown (owner 2026-10-27): the order is committed
 * and still on Hookka's floor. Draft, On Hold, Shipped, Delivered, Invoiced,
 * Closed, Cancelled (and any unknown status) show none.
 */
const COUNTDOWN_STATUSES = new Set(["CONFIRMED", "IN_PRODUCTION", "READY_TO_SHIP"]);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-28" → "28 Oct"; "" when the date is blank or malformed. */
export function soShortDate(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day ?? "");
  if (!m) return "";
  const mon = MONTHS[Number(m[2]) - 1];
  return mon ? `${Number(m[3])} ${mon}` : "";
}

export type SoCountdownTone = "soon" | "normal";

/**
 * Display-only countdown to Expected DD (hookkaExpectedDD, our internal estimate),
 * both dates "YYYY-MM-DD", whole days by UTC maths so DST never shifts a day.
 *   today       → "Due today"
 *   1–7 days    → "In 1 day" / "In N days"
 *   anything else (past, >7 days, no date, other status) → "" (nothing shown).
 * Tone "soon" (amber) exactly when a label shows. It never says "late": real
 * lateness is judged against the customer delivery date elsewhere.
 */
export function soCountdown(
  expected: string,
  status: string,
  today: string,
): { text: string; tone: SoCountdownTone; days: number | null } {
  const e = /^(\d{4})-(\d{2})-(\d{2})/.exec(expected ?? "");
  const t = /^(\d{4})-(\d{2})-(\d{2})/.exec(today ?? "");
  if (!e || !t) return { text: "", tone: "normal", days: null };
  const utc = (m: RegExpExecArray) => Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const days = Math.round((utc(e) - utc(t)) / 864e5);
  if (!COUNTDOWN_STATUSES.has(String(status).toUpperCase())) return { text: "", tone: "normal", days };
  if (days === 0) return { text: "Due today", tone: "soon", days };
  if (days >= 1 && days <= 7) return { text: `In ${days} ${days === 1 ? "day" : "days"}`, tone: "soon", days };
  return { text: "", tone: "normal", days };
}

/**
 * Lifecycle position for the card's stage bar (Sales Orders v4, owner 2026-10-27).
 * The seven stages follow the server's VALID_TRANSITIONS order; CONFIRMED (a brief
 * checkpoint), ON_HOLD, CANCELLED and anything unknown are outside them and get
 * null, so the card hides the bar. This is the order's place in the status
 * lifecycle, NOT production progress, and it never touches the status itself.
 */
export const SO_STAGES = ["DRAFT", "IN_PRODUCTION", "READY_TO_SHIP", "SHIPPED", "DELIVERED", "INVOICED", "CLOSED"] as const;

export function soStage(status: string): { n: number; total: number } | null {
  const i = SO_STAGES.indexOf(String(status).toUpperCase() as (typeof SO_STAGES)[number]);
  return i < 0 ? null : { n: i + 1, total: SO_STAGES.length };
}
