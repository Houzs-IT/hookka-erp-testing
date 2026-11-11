// Style constants and the chart scrub hook of the /m Home dashboard (Home v10).
// Visual source of truth: design_handoff_home_v10/Home v10.dc.html. Colours come
// from the M.* tokens in components; the DATA colours below are data / status
// colours (series, status), like M_ACCENT / M_DELTA, and are the desktop's own.
import { useRef, type CSSProperties } from "react";
import { M } from "../../theme";

export const SHADOW_CARD = "0 1px 2px rgba(31,29,27,.05),0 12px 28px -16px rgba(31,29,27,.22)";
export const SHADOW_SMALL = "0 1px 2px rgba(31,29,27,.06),0 4px 10px -6px rgba(31,29,27,.16)";
export const SHADOW_CHIP_ON = "0 6px 14px -6px rgba(107,92,50,.6)";

/** Data colours. Series colours are the desktop Command Center's (dashboard-b C_SO / C_PROD / C_INV). */
export const DATA = {
  so: "#6B5C32", prod: "#C9A24B", inv: "#A8A29A",
  green: "#15803D", moss: "#4F7C3A", amber: "#9C6F1E", red: "#9A3A2D", teal: "#3E6570",
  gold: "#C9A961", noTarget: "#A39E93", future: "#E3DED5",
} as const;

/** Unselected chip text: Home v10 uses #3A352C (a warm dark between the raisin and body tones); the mix keeps it readable in dark mode. */
export const CHIP_TEXT = `color-mix(in srgb, ${M.raisin} 40%, ${M.ink})`;
export const TNUM: CSSProperties = { fontVariantNumeric: "tabular-nums" };
export const NOWRAP_ELLIPSIS: CSSProperties = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };

/** Row button of a v10 list card (customer / state / category / seller rows). */
export const rowBtn = (min: number): CSSProperties => ({
  width: "100%", display: "flex", alignItems: "center", gap: 10, minHeight: min, padding: 0, border: "none", borderTop: `1px solid ${M.divider}`,
  background: "none", fontFamily: "inherit", textAlign: "left", WebkitTapHighlightColor: "transparent",
});
export const swatch = (c: string): CSSProperties => ({ width: 10, height: 10, flex: "none", borderRadius: 3, backgroundColor: c });
export const amt: CSSProperties = { flex: "none", fontSize: 14, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", ...TNUM };
export const pctCell: CSSProperties = { flex: "none", width: 48, textAlign: "right", fontSize: 12, color: M.ink, ...TNUM };

/** Press-and-drag reader for the revenue chart (pointer events; keeps vertical page scroll). */
export function useScrub(n: number, onIndex: (i: number | null) => void, current: number | null) {
  const state = useRef<{ down: boolean; moved: boolean; start: number | null; i: number; rect: DOMRect | null }>({ down: false, moved: false, start: null, i: 0, rect: null });
  const idxAt = (clientX: number, rect: DOMRect) =>
    Math.max(0, Math.min(n - 1, Math.round(((clientX - rect.left) / Math.max(1, rect.width)) * (n - 1))));
  return {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const i = idxAt(e.clientX, rect);
      state.current = { down: true, moved: false, start: current, i, rect };
      onIndex(i);
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      const s = state.current;
      if (!s.down || !s.rect) return;
      const i = idxAt(e.clientX, s.rect);
      if (i !== s.i) { s.moved = true; s.i = i; onIndex(i); }
    },
    onPointerUp: () => {
      const s = state.current;
      // A tap on the point that was already selected clears it.
      if (s.down && !s.moved && s.start === s.i) onIndex(null);
      s.down = false;
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
      const cur = current ?? -1;
      if (e.key === "ArrowRight") { e.preventDefault(); onIndex(Math.min(n - 1, cur + 1)); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); onIndex(Math.max(0, cur < 0 ? n - 1 : cur - 1)); }
      else if (e.key === "Escape") onIndex(null);
    },
  };
}
