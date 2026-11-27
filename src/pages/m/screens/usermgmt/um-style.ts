// User Management — colours (the shared Batch 4 --xo-* tokens, light + dark,
// via the 3PL kit's X) and the few styles the screens repeat. Values only, so
// um-kit.tsx exports components only.
import type { CSSProperties } from "react";
import { X } from "../threepl/tpl-style";

export const U = {
  ...X,
  info: "var(--xo-info)",
  infob: "var(--xo-infob)",
} as const;

export type Tone = "brand" | "ok" | "warn" | "neu" | "info" | "bad";
export const TONE: Record<Tone, { c: string; b: string }> = {
  brand: { c: U.br, b: U.prit },
  ok: { c: U.ok, b: U.okb },
  warn: { c: U.warn, b: U.warnb },
  neu: { c: U.neu, b: U.neub },
  info: { c: U.info, b: U.infob },
  bad: { c: U.bad, b: U.badb },
};

/** Avatar colour pairs (shared tokens, not the prototype's hexes — owner I-3). */
export const AVATAR: { b: string; c: string }[] = [
  { b: U.tint, c: U.br },
  { b: U.infob, c: U.info },
  { b: U.okb, c: U.ok },
  { b: U.warnb, c: U.warn },
  { b: U.neub, c: U.neu },
];

export const SECTION: CSSProperties = {
  borderRadius: 16, background: U.card, boxShadow: `0 0 0 1px ${U.ring},0 12px 28px -16px ${U.shd}`, overflow: "hidden",
};
