// ListCardShell — the shared phone list card (owner 2026-10-27, Sales Orders v4):
// the Invoices v2 card and the Sales Orders card are the SAME component; only the
// labels, the pill and the middle bar differ.
//
// Presentational only: no data access, no routing. Callers pass already-derived
// values. Layout, top to bottom:
//   4px status rail · code + pill + chevron · party (max 2 lines) · ref chips ·
//   optional middle slot (paid bar / stage bar) · left box + right (amount) box.
//
// Colours are the Invoices tokens (--m-inv-*, light = prototype hex, dark = lifted),
// so both lists read the same in dark mode. The Invoices card renders through this
// with byte-identical markup (tests/m-list-card-shell.test.mjs).
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { M } from "../theme";
import { CARD_LABEL } from "../lib/list-card-styles";

const SHADOW_CARD = "0 1px 2px rgba(31,29,27,.05),0 12px 28px -16px rgba(31,29,27,.22)";
const SHADOW_SELECTED = "0 0 0 2px var(--m-taupe), 0 12px 28px -16px rgba(31,29,27,.22)";

function onKey(fn?: () => void) {
  return (e: KeyboardEvent) => {
    if (!fn) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  };
}

export function ListCardShell({
  rail,
  code,
  codeStyle,
  pill,
  party,
  partyGap = 5,
  refs,
  middle,
  left,
  right,
  current,
  ariaLabel,
  onOpen,
}: {
  /** Rail colour (any CSS colour / var). */
  rail: string;
  code: string;
  /** Overrides for the code text (defaults: 12/700 taupe, the Invoices look). */
  codeStyle?: CSSProperties;
  pill: ReactNode;
  party: string;
  /** margin-top of the party line (Invoices 5, Sales 6). */
  partyGap?: number;
  refs: { k: string; v: string }[];
  /** The bar slot under the chips (Invoices: paid bar, Sales: stage bar). */
  middle?: ReactNode;
  /** Left box: its background and contents (label + value are the caller's). */
  left: { bg: string; children: ReactNode };
  /** Right box: gold, right-aligned (Invoices BALANCE/TOTAL, Sales AMOUNT). */
  right: { label: string; value: string };
  /** Marks the card open in the split-view list pane. */
  current?: boolean;
  ariaLabel: string;
  onOpen: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={current ? "true" : undefined}
      aria-label={ariaLabel}
      onClick={onOpen}
      onKeyDown={onKey(onOpen)}
      style={{
        position: "relative", overflow: "hidden", minWidth: 0, background: M.card, borderRadius: 16, padding: "13px 14px 12px 17px",
        cursor: "pointer", boxShadow: current ? SHADOW_SELECTED : SHADOW_CARD, WebkitTapHighlightColor: "transparent",
      }}
    >
      <span aria-hidden style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: rail }} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 700, color: M.taupe, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", ...codeStyle }}>{code}</span>
        {pill}
        <span style={{ flex: 1 }} />
        <ChevronRight size={18} strokeWidth={1.9} color="var(--m-inv-icon)" aria-hidden style={{ flexShrink: 0 }} />
      </div>
      <div
        style={{
          fontSize: 15, fontWeight: 700, color: M.raisin, marginTop: partyGap, lineHeight: 1.35, letterSpacing: "-0.2px",
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", wordBreak: "break-word",
        }}
      >
        {party}
      </div>
      {refs.length ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 7 }}>
          {refs.map((x) => (
            <span
              key={x.k}
              style={{ height: 22, display: "inline-flex", alignItems: "center", gap: 4, padding: "0 8px", borderRadius: 7, background: "var(--m-inv-tile-bg)", fontSize: 11, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", maxWidth: "100%", overflow: "hidden" }}
            >
              <span style={{ color: "var(--m-inv-ref-key)" }}>{x.k}</span>
              <span style={{ fontWeight: 700, color: M.raisin, overflow: "hidden", textOverflow: "ellipsis" }}>{x.v}</span>
            </span>
          ))}
        </div>
      ) : null}
      {middle}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, marginTop: 10 }}>
        <div style={{ flex: 1, minWidth: 0, padding: "7px 10px", borderRadius: 10, background: left.bg }}>{left.children}</div>
        <div style={{ flex: "none", textAlign: "right", padding: "7px 10px", borderRadius: 10, background: "var(--m-inv-gold-box)" }}>
          <div style={{ ...CARD_LABEL, fontWeight: 700, color: M.taupe }}>{right.label}</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: M.raisin, marginTop: 2, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{right.value}</div>
        </div>
      </div>
    </div>
  );
}
