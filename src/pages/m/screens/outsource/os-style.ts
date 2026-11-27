// ---------------------------------------------------------------------------
// Outsource Work (mobile): colour tokens and shared styles — the prototype's
// --xo-* variables (xops-theme.css, light + dark) and its literal brand brown.
// ---------------------------------------------------------------------------
import type { CSSProperties } from "react";
import { CircleCheck, CircleX, TriangleAlert, type LucideIcon } from "lucide-react";
import "../xops/xops-theme.css";
import type { FeedbackTone } from "@/pages/production/use-outsource-issue";

/** The prototype's literal brand brown (buttons, active chips) — the same in light and dark. */
export const BRAND = "#6B5C32";
export const MUTED_ICON = "#8B7A4E";
export const PLACEHOLDER = "#9A9082";

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
  prit: "var(--xo-prit)",
  ring: "var(--xo-ring)",
  shd: "var(--xo-shd)",
  ok: "var(--xo-ok)",
  okb: "var(--xo-okb)",
  warn: "var(--xo-warn)",
  warnb: "var(--xo-warnb)",
  neub: "var(--xo-neub)",
  bad: "var(--xo-bad)",
  badb: "var(--xo-badb)",
  info: "var(--xo-info)",
  infob: "var(--xo-infob)",
  inp: "var(--xo-inp)",
  nav: "var(--xo-nav-solid)",
} as const;

export const CARD_SH = `0 0 0 1px ${X.ring},0 2px 4px ${X.ring},0 14px 30px -14px ${X.shd}`;
export const LIST_SH = `0 0 0 1px ${X.ring},0 10px 22px -14px ${X.shd}`;
export const FIELD_SH = `0 0 0 1px ${X.ring},0 8px 22px -12px ${X.shd}`;
export const NUM: CSSProperties = { fontVariantNumeric: "tabular-nums" };
export const ELLIPSIS: CSSProperties = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };

export const KEYFRAMES =
  "@keyframes os-sheet{from{transform:translateY(24px);opacity:.6}to{transform:none;opacity:1}}" +
  "@keyframes os-page{from{transform:translateX(24px);opacity:.6}to{transform:none;opacity:1}}" +
  "@keyframes os-pop{from{transform:scale(.96);opacity:0}to{transform:none;opacity:1}}" +
  "@keyframes os-pulse{0%,100%{opacity:.5}50%{opacity:1}}" +
  "@keyframes os-spin{to{transform:rotate(360deg)}}" +
  "@keyframes os-sweep{0%{top:12%}50%{top:84%}100%{top:12%}}" +
  ".os-scroll::-webkit-scrollbar{display:none}" +
  ".os-input::placeholder{color:#9A9082}" +
  "@media (prefers-reduced-motion:reduce){[data-os] *{animation:none!important;transition:none!important}}";

export const TONE: Record<FeedbackTone, { icon: LucideIcon; c: string; bg: string; solid: string; ring: string }> = {
  success: { icon: CircleCheck, c: X.ok, bg: X.okb, solid: "#3E6A2C", ring: "#7FBF5E" },
  warning: { icon: TriangleAlert, c: X.warn, bg: X.warnb, solid: "#8A6416", ring: "#E3BF5E" },
  danger: { icon: CircleX, c: X.bad, bg: X.badb, solid: "#8E3326", ring: "#F08A78" },
};
/** The prototype's chip (active = brand brown). */
export function chipStyle(on: boolean): CSSProperties {
  return {
    flex: "none", height: 34, padding: "0 13px", borderRadius: 999, border: "none",
    background: on ? BRAND : X.card, color: on ? "#FFFFFF" : X.ink, fontWeight: on ? 700 : 600,
    boxShadow: on ? "0 6px 14px -6px rgba(107,92,50,.6)" : `0 1px 2px ${X.ring},0 4px 10px -6px ${X.shd}`,
    fontFamily: "inherit", fontSize: 12.5, display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", cursor: "pointer",
  };
}

export const SECONDARY_BTN: CSSProperties = {
  borderRadius: 14, border: "none", background: X.card, boxShadow: `0 0 0 1px ${X.ln}`, color: X.sub,
  fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
};
export const PRIMARY_BTN: CSSProperties = {
  borderRadius: 14, border: "none", background: BRAND, color: "#FFFFFF",
  fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
};

