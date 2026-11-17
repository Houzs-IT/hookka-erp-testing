// employees-format.ts — display formatting shared by the Employees Working Hours / Attendance screens (HK-0125 Phase 2).
// Pure: no clock, no React.
import { monthShort } from "./employees-dates";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function weekdayOf(ymd: string): string {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7));
  const d = Number(ymd.slice(8, 10));
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** "11 Nov 2026" */
export function shortDate(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  return `${Number(ymd.slice(8, 10))} ${monthShort(Number(ymd.slice(5, 7)))} ${ymd.slice(0, 4)}`;
}

/** "Tue 11 Nov 2026" — the date heading used by the approved HTML. */
export function dayHeading(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  return `${weekdayOf(ymd)} ${shortDate(ymd)}`;
}

/** Hours without trailing zeros: 9 → "9", 4.5 → "4.5", 4.25 → "4.25". */
export function fmtHours(h: number): string {
  const v = Math.round((Number(h) || 0) * 100) / 100;
  return String(v);
}

/** Minutes the way the approved HTML writes them: "51 min", "1h", "1h 20min". */
export function fmtMin(m: number): string {
  const total = Math.max(0, Math.round(Number(m) || 0));
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return hh ? `${hh}h${mm ? ` ${mm}min` : ""}` : `${mm} min`;
}

export function initialsOf(name: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
