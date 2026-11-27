// ===========================================================================
// Inventory — colours and repeated style values. Owner decision I-3: the
// shared tokens, not the prototype's hex. Colours are the Batch 4 --xo-* set
// (../xops/xops-theme.css, light + dark) plus the shared M_CAT category tones
// (theme-vars.css). Only the brand gradient / gold hint stay fixed, as in
// every Batch 4 kit.
// ===========================================================================
import type { CSSProperties } from "react";
import { M_CAT } from "../../theme";
import type { Tone } from "../../lib/inventory-lib";

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
  badb: "var(--xo-badb)",
  info: "var(--xo-info)",
  infob: "var(--xo-infob)",
  note: "var(--xo-note)",
  inp: "var(--xo-inp)",
  nav: "var(--xo-nav-solid)",
  scrim: "var(--xo-scrim)",
  /** Fixed brand values the prototype uses in both themes (as in the Batch 4 kits). */
  grad: "linear-gradient(135deg,#8B7A4E,#6B5C32)",
  gold: "#8B7A4E",
  chev: "#B5AC9C",
  ph: "#9A9082",
  sofa: M_CAT.sofa.fg,
  sofab: M_CAT.sofa.bg,
  bed: M_CAT.bedframe.fg,
  bedb: M_CAT.bedframe.bg,
} as const;

export const TONE: Record<Tone, { c: string; b: string }> = {
  ok: { c: X.ok, b: X.okb },
  warn: { c: X.warn, b: X.warnb },
  bad: { c: X.bad, b: X.badb },
  neu: { c: X.neu, b: X.neub },
  info: { c: X.info, b: X.infob },
  br: { c: X.br, b: X.prit },
};

export const SH_CARD = `0 0 0 1px ${X.ring},0 12px 28px -16px ${X.shd}`;
export const SH_CARD_ON = `0 0 0 2px ${X.pri},0 12px 28px -16px ${X.shd}`;
export const SH_CONTROL = `0 0 0 1px ${X.ring},0 8px 22px -12px ${X.shd}`;
export const SH_TILE = `0 0 0 1px ${X.ring},0 6px 14px -10px ${X.shd}`;
export const SH_SECTION = `0 0 0 1px ${X.ring},0 10px 22px -14px ${X.shd}`;
export const SH_HERO = `0 0 0 1px ${X.ring},0 2px 4px ${X.ring},0 14px 30px -14px ${X.shd}`;

export const ROUND_BTN: CSSProperties = {
  width: 42, height: 42, borderRadius: "50%", background: X.card, border: "none", display: "flex", alignItems: "center",
  justifyContent: "center", flex: "none", padding: 0, cursor: "pointer", color: X.br, boxShadow: `0 0 0 1px ${X.ring},0 6px 16px -8px ${X.shd}`,
  WebkitTapHighlightColor: "transparent",
};
export const LABEL: CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: 1, color: X.br, whiteSpace: "nowrap" };
export const CHIP_BTN = (on: boolean): CSSProperties => ({
  flex: "none", height: 34, padding: "0 13px", borderRadius: 999, border: "none", background: on ? X.pri : X.card,
  color: on ? "#FFFFFF" : X.ink, fontFamily: "inherit", fontSize: 12.5, fontWeight: on ? 700 : 600, display: "flex", alignItems: "center",
  gap: 6, whiteSpace: "nowrap", cursor: "pointer",
  boxShadow: on ? "0 6px 14px -6px rgba(107,92,50,.6)" : `0 1px 2px ${X.ring},0 4px 10px -6px ${X.shd}`,
});
export const BTN_PRIMARY: CSSProperties = {
  height: 50, borderRadius: 14, border: "none", background: X.grad, color: "#FFFFFF", fontFamily: "inherit", fontSize: 15,
  fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
};
export const BTN_SECOND: CSSProperties = {
  height: 50, borderRadius: 14, border: "none", background: X.card, color: X.sub, fontFamily: "inherit", fontSize: 14,
  fontWeight: 700, cursor: "pointer", boxShadow: `0 0 0 1px ${X.ln}`,
};
