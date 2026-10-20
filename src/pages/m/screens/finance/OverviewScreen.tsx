// ---------------------------------------------------------------------------
// The Finance Overview on the phone (finance v2 mobile, part B). Reads the
// desktop Overview's trend (/api/accounting/overview-trend?months=3|6|12) and
// draws the same five figures, one card each, with the latest month on top:
// sales orders vs invoices, gross and net profit with their % of sales, and
// raw material and direct labour as a % of sales (shareOfSales, as the
// desktop). A month before the books opened shows "—", never 0. Each month's
// point on a percentage chart carries its figure (owner 2026-10-20 「手机版的
// overview 每个月份的点没有percentage」) — a phone has no hover.
// ---------------------------------------------------------------------------
import { useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { useCachedJson } from "@/lib/cached-fetch";
import { shareOfSales, type OverviewMonth } from "@/lib/overview-trend";
import { fmtPct } from "@/lib/finance-money";
import { MobileCard } from "../../components";
import { M } from "../../theme";
import { FinanceHeader, FinanceNote, FinanceSwitch } from "./finance-shell";
import { fmtMoney, pctPointLabel } from "./m-finance-lib";

type Range = "3" | "6" | "12";
const RANGES: { key: Range; label: string }[] = [
  { key: "3", label: "3 months" },
  { key: "6", label: "6 months" },
  { key: "12", label: "12 months" },
];
const SAND = "#F2B47E";
const NAVY = "#1F2A44";
const PROFIT = "#5AA49B";
const LOSS = "#9A3A2D";
const tick = { fontSize: 11, fill: "#4B5563" };
const monthShort = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleString("en", { month: "short", timeZone: "UTC" });
const monthLong = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleString("en", { month: "short", year: "numeric", timeZone: "UTC" });
const pct = (v: number | null) => (v === null ? "—" : fmtPct(v));
const rm = (sen: number | null | undefined) => (sen === null || sen === undefined ? null : sen / 100);
const compact = (v: number) => {
  const a = Math.abs(v);
  return a >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : a >= 1e3 ? `${Math.round(v / 1e3)}k` : String(Math.round(v));
};

function OverviewCard({ title, sub, value, note, children }: { title: string; sub: string; value: string; note?: string; children: ReactNode }) {
  return (
    <MobileCard>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: M.raisin }}>{title}</span>
        <span style={{ fontSize: 11, color: M.muted, whiteSpace: "nowrap" }}>{sub}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
        <span data-m-fin={title} style={{ fontSize: 22, fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums" }}>{value}</span>
        {note && <span style={{ fontSize: 12.5, color: M.muted }}>{note}</span>}
      </div>
      <div style={{ height: 160, marginTop: 8 }}>{children}</div>
    </MobileCard>
  );
}

export function OverviewScreen() {
  const [range, setRange] = useState<Range>("3");
  const { data: resp, loading, error } = useCachedJson<{ success?: boolean; error?: string; data?: { months: OverviewMonth[] } }>(
    `/api/accounting/overview-trend?months=${range}`,
  );
  const months = resp?.success ? resp.data?.months ?? [] : [];
  const last = months[months.length - 1];
  const lp = last?.pnl ?? null;
  const sub = last ? `${monthLong(last.ym)}${last.running ? " so far" : ""}` : "";
  const data = months.map((m) => {
    const p = m.pnl;
    return {
      ym: m.ym,
      label: `${monthShort(m.ym)}${m.running ? "*" : ""}`,
      so: rm(m.so.sen),
      inv: rm(m.inv.sen),
      gp: rm(p?.grossProfitSen),
      np: rm(p?.netProfitSen),
      rmPct: p ? shareOfSales(p.rm.usedSen, p.netSalesSen) : null,
      dlPct: p ? shareOfSales(p.labourSen, p.netSalesSen) : null,
    };
  });
  const failed = !!error || resp?.success === false;
  const ofSales = (sen: number | undefined) => (lp && sen !== undefined ? shareOfSales(sen, lp.netSalesSen) : null);
  const profitBars = (key: "gp" | "np") => (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="#EEF1F5" />
        <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} />
        <YAxis tick={tick} axisLine={{ stroke: "#CBD5E1" }} tickLine={false} tickFormatter={compact} width={38} />
        <Bar dataKey={key} radius={[3, 3, 0, 0]} maxBarSize={36} isAnimationActive={false}>
          {data.map((d) => <Cell key={d.ym} fill={(d[key] ?? 0) < 0 ? LOSS : PROFIT} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
  const pctLine = (key: "rmPct" | "dlPct", color: string) => (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 20, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="#EEF1F5" />
        <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} padding={{ left: 22, right: 22 }} />
        <YAxis tick={tick} axisLine={{ stroke: "#CBD5E1" }} tickLine={false} tickFormatter={(v: number) => `${v}%`} width={38} />
        <Line type="monotone" dataKey={key} stroke={color} strokeWidth={2} dot={{ r: 3 }} connectNulls isAnimationActive={false}>
          <LabelList dataKey={key} position="top" offset={8} formatter={pctPointLabel} style={{ fontSize: 11, fontWeight: 600, fill: color }} />
        </Line>
      </LineChart>
    </ResponsiveContainer>
  );

  return (
    <>
      <FinanceHeader title="Overview" />
      <div style={{ padding: "12px 14px 28px", display: "flex", flexDirection: "column", gap: 12 }}>
        <FinanceSwitch label="Months shown" options={RANGES} value={range} onChange={setRange} />
        {loading && !resp ? (
          <FinanceNote>Loading…</FinanceNote>
        ) : failed ? (
          <FinanceNote tone="error">{resp?.error || error || "Couldn't load the overview."}</FinanceNote>
        ) : !last ? (
          <FinanceNote>No months to show.</FinanceNote>
        ) : (
          <>
            <OverviewCard
              title="Sales Orders vs Invoices"
              sub={sub}
              value={fmtMoney(last.inv.sen)}
              note={last.so.sen > 0 ? `${((last.inv.sen / last.so.sen) * 100).toFixed(1)}% of ${fmtMoney(last.so.sen)} ordered` : undefined}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#EEF1F5" />
                  <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} />
                  <YAxis tick={tick} axisLine={{ stroke: "#CBD5E1" }} tickLine={false} tickFormatter={compact} width={38} />
                  <Bar dataKey="so" name="Sales orders" fill={SAND} radius={[3, 3, 0, 0]} maxBarSize={26} isAnimationActive={false} />
                  <Bar dataKey="inv" name="Sales invoices" fill={NAVY} radius={[3, 3, 0, 0]} maxBarSize={26} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </OverviewCard>
            <OverviewCard title="Gross Profit" sub={sub} value={lp ? fmtMoney(lp.grossProfitSen) : "—"} note={lp ? `${pct(ofSales(lp.grossProfitSen))} of sales` : undefined}>
              {profitBars("gp")}
            </OverviewCard>
            <OverviewCard title="Net Profit" sub={sub} value={lp ? fmtMoney(lp.netProfitSen) : "—"} note={lp ? `${pct(ofSales(lp.netProfitSen))} of sales` : undefined}>
              {profitBars("np")}
            </OverviewCard>
            <OverviewCard title="Raw Material · % of Sales" sub={sub} value={pct(ofSales(lp?.rm.usedSen))} note={lp ? `${fmtMoney(lp.rm.usedSen)} used` : undefined}>
              {pctLine("rmPct", "#9C6F1E")}
            </OverviewCard>
            <OverviewCard title="Direct Labour · % of Sales" sub={sub} value={pct(ofSales(lp?.labourSen))} note={lp ? fmtMoney(lp.labourSen) : undefined}>
              {pctLine("dlPct", "#3E6570")}
            </OverviewCard>
          </>
        )}
      </div>
    </>
  );
}
