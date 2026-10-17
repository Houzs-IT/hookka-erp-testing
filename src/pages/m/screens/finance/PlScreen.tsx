// ---------------------------------------------------------------------------
// Profit & Loss on the phone (finance v2 mobile, part B). Reads the desktop
// statement (/api/accounting/pl-statement), one month at a time, for Overall /
// Sofa / Bedframe. The Gross / Net Profit cards are the statement's own result
// rows; the table folds like the desktop one (an open group closes on its own
// total line). Figures are never recomputed here.
// ---------------------------------------------------------------------------
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { todayYmdMY } from "@/lib/utils";
import { COMPANY } from "@/lib/constants";
import { foldStatementRows, fmtPctOfSales, monthOptions, periodLabel } from "@/lib/finance-reports";
import { MobileCard } from "../../components";
import { M } from "../../theme";
import { FinanceHeader, FinanceNote, FinanceStepper, FinanceSwitch } from "./finance-shell";
import { fmtMoney, plHeadline } from "./m-finance-lib";

type Line = "all" | "sofa" | "bedframe";
type StmtRow = {
  kind: "group" | "line" | "total" | "grandtotal" | "gap";
  depth: number;
  label: string;
  periodSen?: number;
  groupId?: string;
  totalLabel?: string;
  estSen?: number;
};
type StmtResp = { success?: boolean; error?: string; data?: { rows: StmtRow[]; netSalesSen: number } };

const LINES: { key: Line; label: string }[] = [
  { key: "all", label: "Overall" },
  { key: "sofa", label: "Sofa" },
  { key: "bedframe", label: "Bedframe" },
];

function Statement({ rows, net, title }: { rows: StmtRow[]; net: number; title: string }) {
  // Open the top sections; deeper groups start folded (the phone's L2).
  const [folded, setFolded] = useState<Set<string>>(
    () => new Set(rows.filter((r) => r.kind === "group" && r.depth >= 1 && r.groupId).map((r) => r.groupId as string)),
  );
  const shown = foldStatementRows(rows, folded);
  const lastGrand = [...rows].reverse().find((r) => r.kind === "grandtotal");
  const amt = (v: number | undefined) => (v === undefined ? "" : v === 0 ? "-" : fmtMoney(v));
  const toggle = (id: string) => setFolded((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <MobileCard padded={false} radius={14} style={{ border: "1px solid #7A6E5E", overflow: "hidden" }}>
      <div style={{ textAlign: "center", padding: "10px 12px 8px" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: M.raisin, letterSpacing: 0.3 }}>{COMPANY.HOOKKA.name}</div>
        <div style={{ fontSize: 12, color: M.muted }}>{title}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto 52px", gap: 8, padding: "7px 12px", background: "#E2E8F0", borderTop: "1px solid #CBD5E1", borderBottom: "1.5px solid #7A6E5E", fontSize: 12, fontWeight: 700, color: "#1F2937" }}>
        <span>Item</span>
        <span style={{ textAlign: "right" }}>RM</span>
        <span style={{ textAlign: "right" }}>% Sales</span>
      </div>
      {shown.map(({ row, close }, i) => {
        if (row.kind === "gap") return <div key={`g${i}`} style={{ height: 6 }} />;
        const isGroup = row.kind === "group" && !close;
        const open = isGroup && !!row.groupId && !folded.has(row.groupId);
        const strong = close || row.kind === "total" || row.kind === "grandtotal";
        const grand = row.kind === "grandtotal";
        const label = close ? row.totalLabel ?? `TOTAL ${row.label}` : row.label;
        const value = isGroup ? (open ? undefined : row.periodSen) : row.periodSen;
        const neg = (value ?? 0) < 0;
        const content = (
          <>
            <span style={{ display: "flex", alignItems: "center", gap: 4, paddingLeft: row.depth * 12, overflow: "hidden" }}>
              {isGroup && (open ? <ChevronDown size={14} color={M.taupe} /> : <ChevronRight size={14} color={M.faint} />)}
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
              {!!row.estSen && !isGroup && <span style={{ fontSize: 10, fontWeight: 600, color: "#7A5B12", background: "#FBF3E4", borderRadius: 4, padding: "0 4px" }}>est.</span>}
            </span>
            <span style={{ textAlign: "right", color: neg ? "#9A3A2D" : undefined }}>{amt(value)}</span>
            <span style={{ textAlign: "right", color: M.muted, fontSize: 11.5 }}>{value === undefined ? "" : fmtPctOfSales(value, net)}</span>
          </>
        );
        const style = {
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) auto 52px",
          gap: 8,
          alignItems: "center",
          minHeight: 40,
          padding: "6px 12px",
          fontSize: 13.5,
          fontVariantNumeric: "tabular-nums" as const,
          fontWeight: strong || isGroup ? 700 : 400,
          color: M.raisin,
          background: grand ? "#F7F7F5" : undefined,
          borderTop: strong ? "1px solid #CBD5E1" : `1px solid ${M.hairline}`,
          borderBottom: grand && row === lastGrand ? "3px double #1F1D1B" : undefined,
        };
        return isGroup && row.groupId ? (
          <button key={`${row.groupId}-${i}`} type="button" onClick={() => toggle(row.groupId as string)} aria-expanded={open} style={{ ...style, width: "100%", border: "none", borderTop: style.borderTop, textAlign: "left", cursor: "pointer", background: "transparent" }}>
            {content}
          </button>
        ) : (
          <div key={`${row.label}-${i}`} data-m-fin={grand ? "grand" : undefined} style={style}>
            {content}
          </div>
        );
      })}
    </MobileCard>
  );
}

export function PlScreen() {
  const today = todayYmdMY();
  const months = useMemo(() => monthOptions(today.slice(0, 7), 18), [today]);
  const [at, setAt] = useState(0);
  const [line, setLine] = useState<Line>("all");
  const period = months[at];
  const { data, loading, error } = useCachedJson<StmtResp>(`/api/accounting/pl-statement?period=${period}&line=${line}`);
  const rows = data?.success ? data.data?.rows ?? [] : [];
  const net = data?.success ? data.data?.netSalesSen ?? 0 : 0;
  const head = plHeadline(rows, net);
  const label = periodLabel(period, today);
  const failed = !!error || data?.success === false;

  const card = (title: string, h: { sen: number; pct: number | null } | null) => (
    <MobileCard style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: M.muted }}>{title}</div>
      <div data-m-fin={title} style={{ fontSize: 20, fontWeight: 700, color: (h?.sen ?? 0) < 0 ? "#9A3A2D" : M.raisin, fontVariantNumeric: "tabular-nums", marginTop: 2 }}>
        {h ? fmtMoney(h.sen) : "—"}
      </div>
      <div style={{ fontSize: 11.5, color: M.muted }}>{h && h.pct !== null ? `${h.pct.toFixed(1)}% of sales` : ""}</div>
    </MobileCard>
  );

  return (
    <>
      <FinanceHeader title="Profit & Loss" />
      <div style={{ padding: "12px 14px 28px", display: "flex", flexDirection: "column", gap: 12 }}>
        <FinanceStepper
          label={label.replace(" · so far", "")}
          note={label.includes("so far") ? "so far" : undefined}
          onPrev={at < months.length - 1 ? () => setAt(at + 1) : undefined}
          onNext={at > 0 ? () => setAt(at - 1) : undefined}
        />
        <FinanceSwitch label="Product line" options={LINES} value={line} onChange={setLine} />
        {loading && !data ? (
          <FinanceNote>Loading…</FinanceNote>
        ) : failed ? (
          <FinanceNote tone="error">{data?.error || error || "Couldn't load the statement."}</FinanceNote>
        ) : rows.length === 0 ? (
          <FinanceNote>No figures for {label}.</FinanceNote>
        ) : (
          <>
            <div style={{ display: "flex", gap: 10 }}>
              {card("Gross Profit", head.gross)}
              {card("Net Profit", head.net)}
            </div>
            <Statement key={`${period}|${line}`} rows={rows} net={net} title={`Profit & Loss · ${label}`} />
          </>
        )}
      </div>
    </>
  );
}
