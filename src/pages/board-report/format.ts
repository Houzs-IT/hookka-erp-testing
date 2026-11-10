// Board Report — colours and number formats shared by the pages and charts.
// The artifact's look: navy / gold / green / red. Money in sen.

export const C = {
  navy: "#13294B",
  gold: "#B7862C",
  green: "#1B7F5A",
  red: "#B4233C",
  grey: "#8A8F98",
  light: "#C9CED6",
  grid: "#E6E8EC",
  ink: "#1F2430",
  muted: "#6B7280",
};
export const PALETTE = [C.navy, C.gold, C.green, "#4E79A7", "#9C755F", "#76B7B2", C.grey, "#B07AA1"];

/** RM, no decimals, negatives in brackets. */
export const rm = (sen: number | null | undefined): string => {
  if (sen === null || sen === undefined || Number.isNaN(sen)) return "-";
  const v = Math.round(Math.abs(sen) / 100).toLocaleString("en-MY");
  return sen < 0 ? `(${v})` : v;
};
/** Axis label: 12k / 1.2m (ringgit). */
export const rmShort = (sen: number): string => {
  const v = sen / 100;
  const a = Math.abs(v);
  const s = a >= 1_000_000 ? `${(a / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}m` : a >= 1_000 ? `${Math.round(a / 1_000)}k` : `${Math.round(a)}`;
  return v < 0 ? `-${s}` : s;
};
export const pctText = (p: number | null | undefined, dp = 1): string => (p === null || p === undefined ? "-" : `${p.toFixed(dp)}%`);
