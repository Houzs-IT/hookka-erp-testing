// PayslipPage — the payslip detail of Employees → Payroll (Employees 3.dc.html `pyd`), VIEW-ONLY (HK-0125 Phase 6b): a full page with
// Back and "EMP-001 - Dept · month" under the worker's name (no Print), the Net Pay + status card ("Total Pay … Gross + employer EPF /
// SOCSO / EIS"), OT Calculation, Statutory Deductions, Pay Summary (with the advance / penalty chips where the permission allows) and
// Day Detail (absent, overtime, late / short days). Amounts are the server's; an OT multiplier and the hourly-rate formula appear only
// when they reproduce the server's figures (payslip-detail-model.ts). Piece wages appear only when the API sends them.
import { useEffect, type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { M } from "../../theme";
import { SHEET_CARD } from "./employees-styles";
import { dayGroups, head, hourlyFormula, otLines, pcbNote, statutoryRows, summaryRows, type DetailRow, type Kv } from "./payslip-detail-model";
import { formatRM } from "@/lib/utils";
import { statusTone } from "./payroll-model";
import { usePayslipDetail } from "./use-payslip-detail";

const SECTION: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: 1, color: "#6B5C32", textTransform: "uppercase", margin: "0 4px 8px" };

function KvCard({ rows, children }: { rows: Kv[]; children?: ReactNode }) {
  return (
    <div style={{ ...SHEET_CARD, padding: "4px 14px" }}>
      {rows.map((x, i) => (
        <div key={x.k} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, minHeight: 36, padding: "7px 0", borderTop: i ? "1px solid #EEE9E4" : "none", boxSizing: "border-box" }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: x.lc, fontWeight: x.lw }}>{x.k}</span>
          <span style={{ flex: "none", fontSize: 13, fontWeight: x.vw, color: x.vc, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{x.v}</span>
        </div>
      ))}
      {children}
    </div>
  );
}

export default function PayslipPage({ row, monthLabel, estimate, onClose }: { row: DetailRow; monthLabel: string; estimate: boolean; onClose: () => void }) {
  const extra = usePayslipDetail(row);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const h = head(row, monthLabel);
  const st = statusTone(row.status);
  const formula = hourlyFormula(row, extra.formulaCtx);
  const chips = [...extra.advanceChips, ...extra.penaltyChips];
  const note = pcbNote(row);

  return (
    <div role="dialog" aria-modal="true" aria-label="Payroll worker" style={{ position: "fixed", inset: 0, zIndex: 70, background: M.paper, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: "none", padding: "env(safe-area-inset-top, 0px) 14px 4px 8px", boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, height: 44 }}>
          <button type="button" onClick={onClose} aria-label="Back" style={{ width: 44, height: 44, border: "none", background: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: M.raisin }}>
            <ChevronLeft size={24} strokeWidth={1.9} />
          </button>
          <div style={{ flex: 1, minWidth: 0, fontSize: 17, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{h.name}</div>
        </div>
        <div style={{ marginLeft: 50, fontSize: 12, color: M.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{h.sub}</div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "4px 18px 40px", display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gridAutoRows: "max-content", gap: 16 }}>
        <div style={{ ...SHEET_CARD, padding: 14 }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#9A9082", textTransform: "uppercase", letterSpacing: 0.6 }}>Net Pay</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: h.netFg, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>{h.net}</div>
            </div>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {estimate ? <span style={{ height: 24, display: "inline-flex", alignItems: "center", padding: "0 9px", borderRadius: 999, background: "#FAEFCB", color: "#85600F", fontSize: 11.5, fontWeight: 700 }}>Estimate</span> : null}
              <span style={{ height: 24, display: "inline-flex", alignItems: "center", padding: "0 9px", borderRadius: 999, background: st.bg, color: st.fg, fontSize: 11.5, fontWeight: 700 }}>{st.label}</span>
            </span>
          </div>
          <div style={{ fontSize: 12, color: M.ink, marginTop: 6 }}>
            Total Pay <b style={{ color: "#6B5C32" }}>{h.total}</b> · Gross + employer EPF / SOCSO / EIS
          </div>
        </div>

        <div>
          <div style={SECTION}>OT Calculation</div>
          <div style={{ ...SHEET_CARD, padding: "10px 14px" }}>
            <div style={{ fontSize: 12, color: M.ink, lineHeight: 1.5 }}>
              {formula ? (
                <>
                  Hourly Rate: {formula} = <b style={{ color: M.raisin }}>{formatRM(Number(row.hourlyRate) || 0)}/hr</b>
                </>
              ) : (
                <>
                  Hourly Rate: <b style={{ color: M.raisin }}>{formatRM(Number(row.hourlyRate) || 0)}/hr</b>
                </>
              )}
            </div>
            <div style={{ height: 1, background: "#EEE9E4", margin: "8px 0" }} />
            {otLines(row).map((o) => (
              <div key={o.key} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "4px 0", fontSize: 12.5 }}>
                <span style={{ minWidth: 0, color: M.ink }}>
                  <b style={{ color: M.raisin }}>{o.key}</b> · {o.text}
                </span>
                <span style={{ flex: "none", fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums" }}>{o.amount}</span>
              </div>
            ))}
            <div style={{ height: 1, background: "#EEE9E4", margin: "8px 0" }} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700 }}>
              <span style={{ color: M.raisin }}>Total OT</span>
              <span style={{ color: "#6B5C32", fontVariantNumeric: "tabular-nums" }}>{formatRM(Number(row.totalOT) || 0)}</span>
            </div>
          </div>
        </div>

        <div>
          <div style={SECTION}>Statutory Deductions</div>
          <KvCard rows={statutoryRows(row)}>{note ? <div style={{ padding: "8px 0 10px", borderTop: "1px solid #EEE9E4", fontSize: 11.5, lineHeight: 1.45, color: "#9A3A2D" }}>{note}</div> : null}</KvCard>
        </div>

        <div>
          <div style={SECTION}>Pay Summary</div>
          <KvCard rows={summaryRows(row)} />
          {chips.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              {chips.map((c) => (
                <span key={c} style={{ padding: "3px 8px", borderRadius: 6, background: "#F5E9E7", color: "#9A3A2D", fontSize: 11.5, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{c}</span>
              ))}
            </div>
          ) : null}
        </div>

        <div>
          <div style={SECTION}>Day Detail</div>
          <div style={{ ...SHEET_CARD, padding: "12px 14px", display: "grid", gap: 10 }}>
            {dayGroups(row).map((d) => (
              <div key={d.k}>
                <div style={{ fontSize: 12, fontWeight: 700, color: d.fg }}>{d.k}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 5 }}>
                  {d.items.map((i) => (
                    <span key={i} style={{ padding: "3px 8px", borderRadius: 6, background: d.bg, color: d.fg, fontSize: 12, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{i}</span>
                  ))}
                  {d.items.length === 0 ? <span style={{ fontSize: 12, color: "#9CA3AF" }}>{d.none}</span> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
