// Shared helpers for the phone Production Orders list + detail (Claude Design
// "Production Orders v3", owner 2026-10-29). Presentational helpers only: no data
// access. The department list is the DESKTOP constant, so the order (and the
// "Step N of 10" count) can never drift from the Production page.
import { DEPARTMENTS } from "@/pages/production/utils";

export const DEPTS = DEPARTMENTS;

export const SHADOW_CARD = "0 1px 2px rgba(31,29,27,.05),0 12px 28px -16px rgba(31,29,27,.22)";
export const SHADOW_SECTION = "0 1px 2px rgba(31,29,27,.05),0 10px 24px -14px rgba(31,29,27,.2)";
export const SHADOW_CONTROL = "0 1px 2px rgba(31,29,27,.05),0 8px 22px -10px rgba(31,29,27,.18)";

// Status text/dot colour keyed by the resolved status hex. The semantic text vars
// are lifted in dark mode (theme-vars.css), as on the Sales Orders card.
const STATUS_TEXT: Record<string, string> = {
  "#6B7280": "var(--m-body)", // NEUTRAL
  "#3E6570": "var(--m-text-status-info)", // INFO
  "#4F7C3A": "var(--m-text-status-success)", // SUCCESS
  "#9C6F1E": "var(--m-text-status-warning)", // WARNING
  "#9A3A2D": "var(--m-text-status-danger)", // DANGER
};
export function statusTint(hex: string): { bg: string; fg: string } {
  const fg = STATUS_TEXT[hex] ?? hex;
  return { fg, bg: `color-mix(in srgb, ${fg} 14%, transparent)` };
}
export const TINT_DANGER = statusTint("#9A3A2D");
export const TINT_WARNING = statusTint("#9C6F1E");
export const TINT_INFO = statusTint("#3E6570");

/** "2026-10-22" -> "22 Oct" ("" when absent). */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function shortDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : "";
}
export function fullDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "";
}

function dayDiff(target: string, today: string): number | null {
  const e = /^(\d{4})-(\d{2})-(\d{2})/.exec(target ?? "");
  const t = /^(\d{4})-(\d{2})-(\d{2})/.exec(today ?? "");
  if (!e || !t) return null;
  const utc = (m: RegExpExecArray) => Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Math.round((utc(e) - utc(t)) / 864e5);
}

export type DueLook = {
  text: string;
  tone: "normal" | "soon" | "overdue";
};

/**
 * EXPECTED DD box. Red ("overdue") ONLY when `overdue` is true, i.e. the PO is in
 * the id set returned by /api/production-orders/overdue-counts (the desktop rule:
 * Our DD passed while Upholstery is open). targetEndDate on its own only ever
 * drives an amber reminder: it is never read as "overdue". With no overdue data
 * (`overdue` false) nothing turns red.
 */
export function dueLook(target: string, overdue: boolean, today: string): DueLook {
  if (overdue) return { text: "Overdue", tone: "overdue" };
  const n = dayDiff(target, today);
  if (n == null) return { text: "", tone: "normal" };
  if (n < 0) return { text: `${-n} ${n === -1 ? "day" : "days"} ago`, tone: "soon" };
  if (n === 0) return { text: "Due today", tone: "soon" };
  if (n <= 3) return { text: `In ${n} ${n === 1 ? "day" : "days"}`, tone: "soon" };
  return { text: "", tone: "normal" };
}
