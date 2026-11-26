// ---------------------------------------------------------------------------
// Plain helpers of the Receivable views (Batch 3): dual-keyed reads of the
// server's rows, the list envelope, key / value rows. No figure is computed.
// No components here, so rcv-lib.tsx exports components only (react-refresh).
// ---------------------------------------------------------------------------
import type { ReactNode } from "react";
import type { Row } from "../finance/fin-kit";
import { F } from "../finance/fin-format";

export type Raw = Record<string, unknown>;

/** The first present, non-empty value of `keys`, as text. */
export const str = (r: Raw | null | undefined, ...keys: string[]): string => {
  if (!r) return "";
  for (const k of keys) {
    const v = r[k];
    if (v !== undefined && v !== null && String(v) !== "") return String(v);
  }
  return "";
};
/** The first present number of `keys` (sen stays sen), 0 when none. */
export const num = (r: Raw | null | undefined, ...keys: string[]): number => {
  if (!r) return 0;
  for (const k of keys) {
    const v = r[k];
    if (v === undefined || v === null || v === "") continue;
    const x = Number(v);
    if (Number.isFinite(x)) return Math.round(x);
  }
  return 0;
};

/** A list endpoint's rows: `{ success, data: [] }` or a bare array. */
export function listOf<T = Raw>(resp: unknown): T[] {
  if (Array.isArray(resp)) return resp as T[];
  const d = (resp as { data?: unknown } | null)?.data;
  return Array.isArray(d) ? (d as T[]) : [];
}
/** Whether a list read failed (a refusal or an error). */
export const failedOf = (resp: unknown, error: string | null): boolean =>
  !!error || (!!resp && !Array.isArray(resp) && (resp as { success?: boolean }).success === false);

/** The prototype's key/value rows (grey label, value on the right). */
export function kvRows(pairs: [string, ReactNode][]): Row[] {
  // A long value (an address, a note) wraps in a right-aligned block instead of running off the card.
  const fit = (v: ReactNode) =>
    typeof v === "string" && v.length > 26 ? <span style={{ display: "block", whiteSpace: "normal", maxWidth: 200, marginLeft: "auto", wordBreak: "break-word" }}>{v}</span> : v;
  return pairs.map(([l, v], i) => ({ key: `${l}-${i}`, l, w: 500, lc: F.muted, fs: 12.5, v: v === "" || v == null ? "—" : fit(v), vfs: 12.5, vw: 600 }));
}
/** "BANK_TRANSFER" → "Bank transfer". */
export const words = (s: string): string => {
  const t = s.replace(/_/g, " ").trim().toLowerCase();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
};
