// ---------------------------------------------------------------------------
// Balance Sheet on the phone (finance v2 mobile, part B). Reads the desktop
// sheet (/api/accounting/pl `balanceSheet`) as at a month end, in the desktop
// arrangement (owner 2026-10-17): Fixed Assets; Current Assets less Current
// Liabilities = Net Current Assets; Financed By — with the check comparing the
// two sides. Same entries, same sums as the desktop page (bsSides).
// ---------------------------------------------------------------------------
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { todayYmdMY } from "@/lib/utils";
import { COMPANY } from "@/lib/constants";
import { checkLabel, monthOptions, periodLabel } from "@/lib/finance-reports";
import type { BalanceSheetEntry } from "@/types";
import { MobileCard } from "../../components";
import { M } from "../../theme";
import { FinanceHeader, FinanceNote, FinanceStepper } from "./finance-shell";
import { bsSides, fmtMoney } from "./m-finance-lib";

type BsResp = { success?: boolean; error?: string; data?: { balanceSheet?: BalanceSheetEntry[] } };

const row = (strong: boolean) => ({
  display: "grid",
  gridTemplateColumns: "minmax(0,1fr) auto",
  gap: 8,
  alignItems: "center",
  minHeight: 38,
  padding: "6px 12px",
  fontSize: 13.5,
  fontVariantNumeric: "tabular-nums" as const,
  fontWeight: strong ? 700 : 400,
  color: M.raisin,
  borderTop: strong ? "1px solid #CBD5E1" : `1px solid ${M.hairline}`,
});
const money = (v: number) => <span style={{ textAlign: "right", color: v < 0 ? "#9A3A2D" : undefined }}>{fmtMoney(v)}</span>;

export function BalanceSheetScreen() {
  const today = todayYmdMY();
  const months = useMemo(() => monthOptions(today.slice(0, 7), 18), [today]);
  const [at, setAt] = useState(0);
  const period = months[at];
  const { data, loading, error } = useCachedJson<BsResp>(`/api/accounting/pl?period=${period}`);
  const entries = data?.success ? data.data?.balanceSheet ?? [] : [];
  const sides = bsSides(entries);
  const label = periodLabel(period, today);
  const failed = !!error || data?.success === false;
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setClosed((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const section = (key: string, title: string, category: string, total: number) => {
    const list = entries.filter((e) => e.category === category);
    const open = !closed.has(key);
    return (
      <div key={key}>
        <button type="button" onClick={() => toggle(key)} aria-expanded={open} style={{ ...row(true), width: "100%", border: "none", borderTop: "1px solid #CBD5E1", background: "transparent", textAlign: "left", cursor: "pointer" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {open ? <ChevronDown size={14} color={M.taupe} /> : <ChevronRight size={14} color={M.faint} />}
            {title}
          </span>
          {open ? <span /> : money(total)}
        </button>
        {open &&
          list.map((e) => (
            <div key={e.id} style={row(false)}>
              <span style={{ paddingLeft: 18, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.accountName}</span>
              {money(e.balance)}
            </div>
          ))}
        {open && (
          <div style={row(true)} data-m-fin={`bs-total-${key}`}>
            <span style={{ paddingLeft: 18 }}>Total {title.replace("Less: ", "")}</span>
            {money(total)}
          </div>
        )}
      </div>
    );
  };
  const band = (text: string) => (
    <div style={{ padding: "8px 12px", background: "#F7F4EF", borderTop: "1px solid #CBD5E1", fontSize: 12, fontWeight: 700, letterSpacing: 0.4, color: M.raisin }}>{text}</div>
  );
  const result = (text: string, v: number, key: string) => (
    <div data-m-fin={key} style={{ ...row(true), background: "#F7F7F5", borderBottom: "3px double #1F1D1B" }}>
      <span>{text}</span>
      {money(v)}
    </div>
  );

  return (
    <>
      <FinanceHeader title="Balance Sheet" />
      <div style={{ padding: "12px 14px 28px", display: "flex", flexDirection: "column", gap: 12 }}>
        <FinanceStepper
          label={label.replace(" · so far", "")}
          note={label.includes("so far") ? "as at end · so far" : "as at end"}
          onPrev={at < months.length - 1 ? () => setAt(at + 1) : undefined}
          onNext={at > 0 ? () => setAt(at - 1) : undefined}
        />
        {loading && !data ? (
          <FinanceNote>Loading…</FinanceNote>
        ) : failed ? (
          <FinanceNote tone="error">{data?.error || error || "Couldn't load the balance sheet."}</FinanceNote>
        ) : entries.length === 0 ? (
          <FinanceNote>No balance sheet for {label}.</FinanceNote>
        ) : (
          <>
            <div
              data-m-fin="bs-check"
              style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", borderRadius: 12, padding: "10px 12px", fontSize: 13, background: sides.diff === 0 ? "#EEF5E9" : "#FBEDEC" }}
            >
              <span style={{ color: M.raisin }}>Both sides <b style={{ fontVariantNumeric: "tabular-nums" }}>{fmtMoney(sides.left)}</b></span>
              <span style={{ marginLeft: "auto", fontWeight: 700, color: sides.diff === 0 ? "#27500A" : "#9A3A2D" }}>
                {sides.diff === 0 ? "Balanced ✓" : checkLabel(sides.diff)}
              </span>
            </div>
            <MobileCard padded={false} radius={14} style={{ border: "1px solid #7A6E5E", overflow: "hidden" }}>
              <div style={{ textAlign: "center", padding: "10px 12px 8px" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: M.raisin, letterSpacing: 0.3 }}>{COMPANY.HOOKKA.name}</div>
                <div style={{ fontSize: 12, color: M.muted }}>Balance Sheet · As At End Of {label}</div>
              </div>
              {section("FA", "Fixed Assets (Net)", "FIXED_ASSET", sides.fixed)}
              {band("CURRENT ASSETS LESS CURRENT LIABILITIES")}
              {section("CA", "Current Assets", "CURRENT_ASSET", sides.current)}
              {section("CL", "Less: Current Liabilities", "CURRENT_LIABILITY", sides.currentLiab)}
              <div style={row(true)} data-m-fin="bs-net-current">
                <span>Net Current Assets</span>
                {money(sides.netCurrent)}
              </div>
              {result("FIXED ASSETS + CURRENT ASSETS − CURRENT LIABILITIES", sides.left, "bs-left")}
              {band("FINANCED BY")}
              {section("EQ", "Equity", "EQUITY", sides.equity)}
              {section("LL", "Non-Current Liabilities", "LONG_TERM_LIABILITY", sides.longLiab)}
              {result("TOTAL EQUITY + NON-CURRENT LIABILITIES", sides.right, "bs-right")}
            </MobileCard>
          </>
        )}
      </div>
    </>
  );
}
