// ---------------------------------------------------------------------------
// Cash Flow on the phone (finance v2 mobile, part B). Reads the desktop
// statement (/api/accounting/cashflow-statement), one month at a time — the
// engine's own rows and the figure in that month's column. A month the engine
// did not send a column for says so; another month's figures are never shown.
// ---------------------------------------------------------------------------
import { useMemo, useState } from "react";
import { useCachedJson } from "@/lib/cached-fetch";
import { todayYmdMY } from "@/lib/utils";
import { COMPANY } from "@/lib/constants";
import { monthOptions, periodLabel } from "@/lib/finance-reports";
import { MobileCard } from "../../components";
import { M } from "../../theme";
import { FinanceHeader, FinanceNote, FinanceStepper } from "./finance-shell";
import { cfColumnIndex, fmtMoney } from "./m-finance-lib";

type CfRow = {
  kind: "section" | "group" | "line" | "subtotal" | "result" | "total" | "bf" | "cf" | "gap";
  label: string;
  depth: number;
  values: (number | null)[];
};
type CfResp = { success?: boolean; error?: string; data?: { period: string; columns: { key: string; label: string; accum?: boolean }[]; rows: CfRow[] } };

export function CashFlowScreen() {
  const today = todayYmdMY();
  const months = useMemo(() => monthOptions(today.slice(0, 7), 18), [today]);
  const [at, setAt] = useState(0);
  const period = months[at];
  const { data, loading, error } = useCachedJson<CfResp>(`/api/accounting/cashflow-statement?period=${period}`);
  const stmt = data?.success ? data.data : undefined;
  const ci = stmt ? cfColumnIndex(stmt.columns, period) : -1;
  const label = periodLabel(period, today);
  const failed = !!error || data?.success === false;

  return (
    <>
      <FinanceHeader title="Cash Flow" />
      <div style={{ padding: "12px 14px 28px", display: "flex", flexDirection: "column", gap: 12 }}>
        <FinanceStepper
          label={label.replace(" · so far", "")}
          note={label.includes("so far") ? "so far" : undefined}
          onPrev={at < months.length - 1 ? () => setAt(at + 1) : undefined}
          onNext={at > 0 ? () => setAt(at - 1) : undefined}
        />
        {loading && !data ? (
          <FinanceNote>Loading…</FinanceNote>
        ) : failed ? (
          <FinanceNote tone="error">{data?.error || error || "Couldn't load the cash flow."}</FinanceNote>
        ) : !stmt || ci < 0 || stmt.rows.length === 0 ? (
          <FinanceNote>No cash flow for {label}.</FinanceNote>
        ) : (
          <MobileCard padded={false} radius={14} style={{ border: "1px solid #7A6E5E", overflow: "hidden" }}>
            <div style={{ textAlign: "center", padding: "10px 12px 8px" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: M.raisin, letterSpacing: 0.3 }}>{COMPANY.HOOKKA.name}</div>
              <div style={{ fontSize: 12, color: M.muted }}>Statement Of Cash Flow · {label}</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 8, padding: "7px 12px", background: "#E2E8F0", borderTop: "1px solid #CBD5E1", borderBottom: "1.5px solid #7A6E5E", fontSize: 12, fontWeight: 700, color: "#1F2937" }}>
              <span>Item</span>
              <span style={{ textAlign: "right" }}>RM</span>
            </div>
            {stmt.rows.map((r, i) => {
              if (r.kind === "gap") return <div key={`g${i}`} style={{ height: 6 }} />;
              const v = r.values[ci];
              const strong = r.kind !== "line";
              const band = r.kind === "section";
              const final = r.kind === "cf";
              return (
                <div
                  key={`${r.label}-${i}`}
                  data-m-fin={`cf-${r.kind}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0,1fr) auto",
                    gap: 8,
                    alignItems: "center",
                    minHeight: 38,
                    padding: "6px 12px",
                    fontSize: 13.5,
                    fontVariantNumeric: "tabular-nums",
                    fontWeight: strong ? 700 : 400,
                    color: M.raisin,
                    background: band ? "#F7F4EF" : final ? "#F7F7F5" : undefined,
                    borderTop: strong ? "1px solid #CBD5E1" : `1px solid ${M.hairline}`,
                    borderBottom: final ? "3px double #1F1D1B" : undefined,
                  }}
                >
                  <span style={{ paddingLeft: r.kind === "line" ? 12 + r.depth * 10 : r.depth * 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
                  <span style={{ textAlign: "right", color: (v ?? 0) < 0 ? "#9A3A2D" : v === 0 ? "#C4BDB3" : undefined }}>
                    {v === null || v === undefined ? "" : v === 0 ? "-" : fmtMoney(v)}
                  </span>
                </div>
              );
            })}
          </MobileCard>
        )}
      </div>
    </>
  );
}
