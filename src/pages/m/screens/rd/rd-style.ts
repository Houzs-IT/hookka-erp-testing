// ===========================================================================
// R&D Projects — colour tokens and repeated style values. Colours are the
// shared Batch 4 tokens (../xops/xops-theme.css, --xo-*, light + dark) via the
// 3PL kit's X map; stage colours are desktop's STAGE_COLORS (rd-lib).
// ===========================================================================
import type { CSSProperties } from "react";
import { X } from "../threepl/tpl-style";
import { STATUS_TONE, type Status, type Tone } from "./rd-lib";

export const R = {
  ...X,
  info: "var(--xo-info)",
  infob: "var(--xo-infob)",
  badb: "var(--xo-badb)",
} as const;

/** Tone → [foreground, background]. */
export const TONE: Record<Tone, [string, string]> = {
  ok: [R.ok, R.okb],
  warn: [R.warn, R.warnb],
  bad: [R.bad, R.badb],
  neu: [R.neu, R.neub],
  info: [R.info, R.infob],
  br: [R.br, R.prit],
};
export const statusTone = (s: Status) => TONE[STATUS_TONE[s]];

export const SH_CARD = `0 0 0 1px ${R.ring},0 12px 28px -16px ${R.shd}`;
export const SH_CARD_ON = `0 0 0 2px ${R.pri},0 12px 28px -16px ${R.shd}`;
export const SH_CONTROL = `0 0 0 1px ${R.ring},0 8px 22px -12px ${R.shd}`;
export const SH_BLOCK = `0 0 0 1px ${R.ring},0 2px 4px ${R.ring},0 10px 24px -14px ${R.shd}`;

export const LABEL: CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: 1, color: R.br };
export const CARD: CSSProperties = { background: R.card, borderRadius: 16, boxShadow: SH_BLOCK, color: R.ink, minWidth: 0 };
export const TAB_BTN = (on: boolean): CSSProperties => ({
  flex: "none", height: 44, padding: "0 12px", border: "none", background: "none", fontFamily: "inherit", fontSize: 13.5,
  fontWeight: on ? 700 : 600, color: on ? R.ink : R.mut, display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
  boxShadow: on ? `inset 0 -2.5px 0 ${R.pri}` : "none", whiteSpace: "nowrap", WebkitTapHighlightColor: "transparent",
});
