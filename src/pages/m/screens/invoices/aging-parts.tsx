// ===========================================================================
// AR Aging pieces of the Invoices v2 screen (two-tab handoff, owner 2026-10-22).
//
// Visuals: Claude Design `docs/design/invoices-v2/Invoices v2.dc.html` (AR
// Aging summary, customer card, customer sheet). Typography: the sibling /m
// screens (owner rule). Colours: M.* + the --m-age-* bucket tokens
// (theme-vars.css; light = the handoff hex, dark measured ≥ 4.5:1 for text).
// Data: rows from GET /api/invoices/aging, SEN, buckets computed by the server.
// The sheet is the shared Sheet in `bare` mode (Esc, scrim, focus trap kept).
// ===========================================================================
import type { CSSProperties } from "react";
import { ChevronRight, X } from "lucide-react";
import { M } from "../../theme";
import { Sheet } from "../../components";
import { money } from "../../config/helpers";
import {
  AGING_BUCKETS, agingAmount, agingSegments, oldestBucket, oldestLabel,
  type AgingKey, type AgingRowVM,
} from "../../lib/invoices-mobile";

const SHADOW_CARD = "0 1px 2px rgba(31,29,27,.05),0 12px 28px -16px rgba(31,29,27,.22)";
const tone = (t: string) => `var(--m-age-${t})`;
const toneBg = (t: string) => `var(--m-age-${t}-bg)`;
const toneFg = (t: string) => `var(--m-age-${t}-fg)`;
const toneOf = (k: AgingKey) => AGING_BUCKETS.find((b) => b.key === k)!.tone;
const EYEBROW: CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe };
/** Money is never clipped: it may wrap, never ellipsize (owner Q1–Q3). */
const MONEY_BIG: CSSProperties = { minWidth: 0, fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" };

/** Proportional bucket bar (display only — not a metric). */
export function AgingBar({ data, height, label }: { data: Record<AgingKey, number>; height: number; label?: string }) {
  const segs = agingSegments(data);
  return (
    <div
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ display: "flex", gap: 2, height, borderRadius: 999, overflow: "hidden", background: "var(--m-segment-track)" }}
    >
      {segs.map((g) => (
        <span key={g.key} style={{ flex: g.sen, background: tone(g.tone) }} />
      ))}
    </div>
  );
}

/** One bucket row: dot · label · amount (en dash when zero). Amount never truncates. */
function BucketRow({ k, sen, first, minHeight, size }: { k: AgingKey; sen: number; first: boolean; minHeight: number; size: number }) {
  const b = AGING_BUCKETS.find((x) => x.key === k)!;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight, borderTop: first ? "none" : "1px solid var(--m-age-divider)" }}>
      <span aria-hidden style={{ width: 8, height: 8, flex: "none", borderRadius: "50%", background: tone(b.tone) }} />
      <span style={{ flex: 1, minWidth: 0, fontSize: size - 1, color: "var(--m-inv-body)" }}>{b.label}</span>
      <span
        style={{
          flex: "none", minWidth: 96, textAlign: "right", fontSize: size, fontWeight: 700, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
          color: sen > 0 ? M.raisin : "var(--m-inv-ref-key)",
        }}
      >
        {agingAmount(sen)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary card.
// ---------------------------------------------------------------------------
export function AgingSummaryCard({ totals }: { totals: Record<AgingKey, number> & { total: number; count: number } }) {
  const barLabel = AGING_BUCKETS.map((b) => `${b.label} ${money(totals[b.key])}`).join(", ");
  return (
    <section aria-label="Accounts receivable aging summary" style={{ margin: "12px 18px 4px", background: M.card, borderRadius: 20, padding: "16px 16px 14px", boxShadow: SHADOW_CARD }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={{ ...EYEBROW, display: "flex", alignItems: "center", gap: 7, whiteSpace: "nowrap" }}>
          <span aria-hidden style={{ width: 14, height: 3, borderRadius: 2, background: M.gold }} />
          AR AGING
        </span>
        <span style={{ fontSize: 12, color: M.ink, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
          {totals.count} customer{totals.count === 1 ? "" : "s"}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginTop: 6 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: M.ink }}>RM</span>
        <span style={{ ...MONEY_BIG, fontSize: 28, lineHeight: 1.1, letterSpacing: "-0.6px" }}>{money(totals.total).replace(/^RM\s*/, "")}</span>
      </div>
      <div style={{ fontSize: 12, color: M.ink, marginTop: 2 }}>Total outstanding</div>
      <div style={{ marginTop: 14 }}>
        <AgingBar data={totals} height={10} label={barLabel} />
      </div>
      <div style={{ marginTop: 12, borderRadius: 12, background: M.paper, padding: "2px 12px" }}>
        {AGING_BUCKETS.map((b, i) => (
          <BucketRow key={b.key} k={b.key} sen={totals[b.key]} first={i === 0} minHeight={40} size={13.5} />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Customer card (the whole card is a button → the customer sheet).
// ---------------------------------------------------------------------------
export function AgingCustomerCard({ row, onOpen }: { row: AgingRowVM; onOpen: () => void }) {
  const oldest = oldestBucket(row);
  const t = oldest ? toneOf(oldest) : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={`${row.name}, total outstanding ${money(row.total)}`}
      style={{
        position: "relative", overflow: "hidden", width: "100%", textAlign: "left", border: "none", fontFamily: "inherit", cursor: "pointer",
        background: M.card, borderRadius: 16, padding: "13px 14px 13px 17px", boxShadow: SHADOW_CARD, WebkitTapHighlightColor: "transparent",
      }}
    >
      <span aria-hidden style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: t ? tone(t) : "var(--m-inv-line)" }} />
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div
          style={{
            flex: 1, minWidth: 0, fontSize: 15, fontWeight: 700, color: M.raisin, lineHeight: 1.35, letterSpacing: "-0.2px",
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", wordBreak: "break-word",
          }}
        >
          {row.name}
        </div>
        <ChevronRight size={18} strokeWidth={1.9} color="var(--m-inv-icon)" aria-hidden style={{ flexShrink: 0 }} />
      </div>
      {/* Wraps instead of squeezing in a narrow pane — the total is never truncated. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", columnGap: 10, rowGap: 6, marginTop: 8 }}>
        <span
          style={{
            height: 22, display: "inline-flex", alignItems: "center", gap: 5, padding: "0 9px", borderRadius: 999, whiteSpace: "nowrap",
            background: t ? toneBg(t) : "var(--m-segment-track)", color: t ? toneFg(t) : M.ink, fontSize: 11, fontWeight: 600,
          }}
        >
          <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", background: t ? tone(t) : M.ink }} />
          {oldestLabel(oldest)}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 15, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{money(row.total)}</span>
      </div>
      <div style={{ marginTop: 10 }}>
        <AgingBar data={row} height={6} />
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Customer breakdown sheet (shared Sheet, bare mode, handoff header).
// ---------------------------------------------------------------------------
export function AgingCustomerSheet({ row, onClose }: { row: AgingRowVM | null; onClose: () => void }) {
  return (
    <Sheet open={row != null} onClose={onClose} title={row ? `AR Aging · ${row.name}` : "AR Aging"} bare>
      {row ? (
        <div style={{ paddingBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "center", paddingTop: 8 }}>
            <div aria-hidden style={{ width: 40, height: 4, borderRadius: 999, background: M.hairline }} />
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 16px 0" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={EYEBROW}>AR AGING</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: M.raisin, lineHeight: 1.35, marginTop: 3, wordBreak: "break-word" }}>{row.name}</div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{ width: 44, height: 44, margin: "-6px -10px 0 0", flex: "none", background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: M.ink }}
            >
              <X size={20} strokeWidth={1.75} />
            </button>
          </div>
          <div style={{ margin: "12px 16px 0", background: M.card, borderRadius: 18, padding: "15px 15px 12px", boxShadow: SHADOW_CARD }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: M.taupe }}>TOTAL OUTSTANDING</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginTop: 4 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: M.ink }}>RM</span>
              <span style={{ ...MONEY_BIG, fontSize: 26, lineHeight: 1.1, letterSpacing: "-0.5px" }}>{money(row.total).replace(/^RM\s*/, "")}</span>
            </div>
            <div style={{ marginTop: 12 }}>
              <AgingBar data={row} height={8} />
            </div>
            <div style={{ marginTop: 8 }}>
              {AGING_BUCKETS.map((b, i) => (
                <BucketRow key={b.key} k={b.key} sen={row[b.key]} first={i === 0} minHeight={44} size={14} />
              ))}
            </div>
          </div>
          <div style={{ padding: "12px 18px 0", fontSize: 11.5, lineHeight: 1.45, color: M.ink }}>
            Buckets come from the server aging report. Open invoices for this customer are on the Invoices tab.
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}
