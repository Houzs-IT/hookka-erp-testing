// ===========================================================================
// 3PL Providers — the prototype's colour variables and repeated style values.
// Colours come from the shared Batch 4 tokens (../xops/xops-theme.css, --xo-*,
// light + dark, copied from the prototype). Imported once by tpl-kit.tsx.
// ===========================================================================
import type { CSSProperties } from "react";
import type { ProviderStatus } from "./tpl-lib";

export const X = {
  page: "var(--xo-page)",
  bg: "var(--xo-bg)",
  card: "var(--xo-card)",
  ink: "var(--xo-ink)",
  sub: "var(--xo-sub)",
  mut: "var(--xo-mut)",
  ln: "var(--xo-ln)",
  chip: "var(--xo-chip)",
  tint: "var(--xo-tint)",
  br: "var(--xo-br)",
  pri: "var(--xo-pri)",
  prit: "var(--xo-prit)",
  ring: "var(--xo-ring)",
  shd: "var(--xo-shd)",
  ok: "var(--xo-ok)",
  okb: "var(--xo-okb)",
  warn: "var(--xo-warn)",
  warnb: "var(--xo-warnb)",
  neu: "var(--xo-neu)",
  neub: "var(--xo-neub)",
  bad: "var(--xo-bad)",
  badb: "var(--xo-badb-3pl)",
  note: "var(--xo-note)",
  inp: "var(--xo-inp)",
  scrim: "var(--xo-scrim)",
  /** Fixed brand values the prototype hard-codes in both themes. */
  grad: "linear-gradient(135deg,#8B7A4E,#6B5C32)",
  gradIcon: "linear-gradient(145deg,#A08C5B,#6B5C32)",
  gold: "#8B7A4E",
  chev: "#B5AC9C",
  ph: "#9A9082",
} as const;

export const ST: Record<ProviderStatus, { l: string; c: string; b: string }> = {
  ACTIVE: { l: "Active", c: X.ok, b: X.okb },
  INACTIVE: { l: "Inactive", c: X.neu, b: X.neub },
  ON_LEAVE: { l: "On Leave", c: X.warn, b: X.warnb },
};

export const SH_CARD = `0 0 0 1px ${X.ring},0 12px 28px -16px ${X.shd}`;
export const SH_CARD_ON = `0 0 0 2px ${X.pri},0 12px 28px -16px ${X.shd}`;
export const SH_CONTROL = `0 0 0 1px ${X.ring},0 8px 22px -12px ${X.shd}`;
export const SH_SECTION = `0 0 0 1px ${X.ring},0 2px 4px ${X.ring},0 14px 30px -14px ${X.shd}`;
export const SH_ROUND = `0 0 0 1px ${X.ring},0 6px 16px -8px ${X.shd}`;

export const ROUND_BTN: CSSProperties = {
  width: 42, height: 42, borderRadius: "50%", background: X.card, border: "none", display: "flex", alignItems: "center",
  justifyContent: "center", flex: "none", padding: 0, cursor: "pointer", color: X.br, boxShadow: SH_ROUND, WebkitTapHighlightColor: "transparent",
};
export const PLUS_BTN: CSSProperties = {
  width: 42, height: 42, borderRadius: "50%", background: X.grad, border: "none", display: "flex", alignItems: "center",
  justifyContent: "center", flex: "none", padding: 0, cursor: "pointer", color: "#FFFFFF", boxShadow: "0 8px 18px -8px rgba(107,92,50,.65)",
  WebkitTapHighlightColor: "transparent",
};
export const LABEL: CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: 1, color: X.br };
export const CHIP_BTN = (on: boolean): CSSProperties => ({
  flex: "none", height: 34, padding: "0 13px", borderRadius: 999, border: "none", background: on ? "#6B5C32" : X.card,
  color: on ? "#FFFFFF" : X.ink, fontFamily: "inherit", fontSize: 12.5, fontWeight: on ? 700 : 600, display: "flex", alignItems: "center",
  gap: 6, whiteSpace: "nowrap", cursor: "pointer",
  boxShadow: on ? "0 6px 14px -6px rgba(107,92,50,.6)" : `0 1px 2px ${X.ring},0 4px 10px -6px ${X.shd}`,
});
export const SEG_BTN = (on: boolean): CSSProperties => ({
  height: "100%", borderRadius: 9, border: "none", background: on ? X.card : "transparent", color: on ? X.ink : X.sub,
  fontWeight: on ? 700 : 600, boxShadow: on ? `0 1px 2px ${X.ring},0 6px 14px -6px ${X.shd}` : "none", fontFamily: "inherit",
  fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, cursor: "pointer", minWidth: 0, whiteSpace: "nowrap",
});
export const DASHED_BTN: CSSProperties = {
  width: "100%", height: 44, borderRadius: 12, border: `1.5px dashed ${X.ln}`, background: X.tint, color: X.br, fontFamily: "inherit",
  fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, cursor: "pointer",
};
