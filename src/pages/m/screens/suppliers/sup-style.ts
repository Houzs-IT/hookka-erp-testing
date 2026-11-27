// Suppliers kit colours (the prototype's --xo-* variables plus its few fixed
// hexes) and the chip / segment styles. Values only, so the kit file exports
// components only.
export const C = {
  page: "var(--xo-page)", bg: "var(--xo-bg)", card: "var(--xo-card)", ink: "var(--xo-ink)", sub: "var(--xo-sub)", mut: "var(--xo-mut)",
  ln: "var(--xo-ln)", chip: "var(--xo-chip)", tint: "var(--xo-tint)", br: "var(--xo-br)", prit: "var(--xo-prit)", ring: "var(--xo-ring)",
  shd: "var(--xo-shd)", ok: "var(--xo-ok)", okb: "var(--xo-okb)", warn: "var(--xo-warn)", warnb: "var(--xo-warnb)", neu: "var(--xo-neu)",
  neub: "var(--xo-neub)", bad: "var(--xo-bad)", badb: "var(--xo-badb)", info: "var(--xo-info)", infob: "var(--xo-infob)", note: "var(--xo-note)",
  inp: "var(--xo-inp)", scrim: "var(--xo-scrim)", star: "var(--xo-star)", amt: "var(--sup-amt)",
  gold: "#8B7A4E", grad: "linear-gradient(135deg,#8B7A4E,#6B5C32)", faint: "#9A9082",
};
export const chipS = (on: boolean) => ({
  background: on ? "#6B5C32" : C.card, color: on ? "#FFFFFF" : C.ink,
  boxShadow: on ? "0 6px 14px -6px rgba(107,92,50,.6)" : `0 1px 2px ${C.ring},0 4px 10px -6px ${C.shd}`, fontWeight: on ? 700 : 600,
});
export const segS = (on: boolean) => ({
  background: on ? C.card : "transparent", color: on ? C.ink : C.sub,
  boxShadow: on ? `0 1px 2px ${C.ring},0 6px 14px -6px ${C.shd}` : "none", fontWeight: on ? 700 : 600,
});
