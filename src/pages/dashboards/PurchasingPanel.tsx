import { useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useCachedJson } from "@/lib/cached-fetch";
import { formatCurrency } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useProductionRevenue } from "./use-production-revenue";
import { DashModal } from "./DashModal";
import { useSeriesToggle } from "./use-series-toggle";
import { CC_AXIS_LINE, CC_TICK, fmtN, fmtRMAxis, monthLabel, shiftMonth, widgetPeriod, ymd, type Period } from "./dashboard-shared-lib";
import { parseDashPeriod } from "../../api/lib/dash-period";
import type { Overview } from "./dashboard-widgets-lib";

// ---------------------------------------------------------------------------
// Purchasing (owner 2026-10-17: "再帮我优化一下，看还有什么数据可以支撑进来").
// Replaces the Command Center's text-only card on Output & Cost:
//   • supplier-invoice spend for the period vs the period before
//   • purchases as a % of production revenue (same base as Costing)
//   • open POs, goods waiting to arrive, GRNs waiting for QC (from the overview)
//   • raw-material stock on hand at the last stock take (owner 2026-10-18:
//     "we owe suppliers change to raw material 的 stock balance") — the P&L's
//     closing stock, not the live system balance, which is unreliable until
//     the BOMs are complete (owner ruling 2026-10-17)
//   • six months of spend with its % of production revenue
//   • top suppliers by invoiced amount, with their share
// Supplier invoices are read once (GET /api/purchase-invoices, cancelled out).
// ---------------------------------------------------------------------------
type Pi = { piNo?: string | null; invoiceDate: string | null; dueDate: string | null; amountSen: number | string | null; paidAmountSen: number | string | null; status: string; supplierName: string | null };
type Po = { poNo?: string | null; supplierName?: string | null; orderDate?: string | null; expectedDate?: string | null; totalSen?: number | string | null; status: string };
type Drill = "spend" | "share" | "po" | "stock" | null;
type CostStructure = { data?: { cols?: string[]; groups?: { group?: string; description?: string; months?: ({ opening?: number; purchase?: number; closing?: number } | null)[] }[] } };

const INK = "#6B5C32";
const GOLD = "#C9A24B";
const rm = (sen: number) => formatCurrency(Math.round(sen));
const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);

function Stat({ label, value, sub, tone, onClick }: { label: string; value: string; sub?: string; tone?: "bad" | "good"; onClick?: () => void }) {
  return (
    <div
      className={`min-w-0 rounded-lg bg-[#F7F4EF] px-3 py-2 ${onClick ? "cursor-pointer transition-colors hover:bg-[#EFE9DF]" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      title={onClick ? "Click for the detail" : undefined}
    >
      <p className="truncate text-[10.5px] uppercase tracking-wide text-[#9CA3AF]">{label}</p>
      <p className={`truncate text-lg font-bold tabular-nums ${tone === "bad" ? "text-[#9A3A2D]" : tone === "good" ? "text-[#4F7C3A]" : "text-[#1F1D1B]"}`}>{value}</p>
      {sub && <p className="truncate text-[11px] text-[#6B7280]">{sub}</p>}
    </div>
  );
}

export function PurchasingPanel({ period }: { period: Period }) {
  const [today] = useState(() => ymd(new Date()));
  const key = widgetPeriod(period);
  const { months, prevMonths, dp } = useMemo(() => {
    const d = parseDashPeriod(key);
    return {
      dp: d,
      months: d.months.length ? d.months.filter((m) => m <= today.slice(0, 7)) : [today.slice(0, 7)],
      prevMonths: d.prevMonths.length ? d.prevMonths : [shiftMonth(today.slice(0, 7), -1)],
    };
  }, [key, today]);
  const lastYm = months[months.length - 1];
  const trendMonths = useMemo(() => Array.from({ length: 6 }, (_, i) => shiftMonth(lastYm, i - 5)), [lastYm]);
  const revMonths = useMemo(() => [...new Set([...[1, 2, 3].map((i) => shiftMonth(trendMonths[0], -i)), ...trendMonths, ...months, ...prevMonths])].filter((m) => m <= today.slice(0, 7)).sort(), [trendMonths, months, prevMonths, today]);

  const { data: ov } = useCachedJson<Overview>(`/api/dashboard/overview?period=${key}`);
  const { data: piResp } = useCachedJson<{ data?: Pi[] }>("/api/purchase-invoices");
  // Raw-material stock = the P&L's closing stock from the latest stock take
  // (GET /api/accounting/cost-structure, the source Costing uses).
  const { data: csResp } = useCachedJson<CostStructure>("/api/accounting/cost-structure");
  // Layer 2 (owner 2026-10-17: "点到那个数据都可以深挖"): each tile opens its rows.
  const [drill, setDrill] = useState<Drill>(null);
  const { data: poResp } = useCachedJson<{ data?: Po[] }>(drill === "po" ? "/api/purchase-orders" : null);
  const prodRev = useProductionRevenue(revMonths);
  const t = useSeriesToggle();

  const calc = useMemo(() => {
    const pis = (piResp?.data ?? []).filter((p) => p.status !== "CANCELLED");
    const spendBy = new Map<string, number>();
    const supplier = new Map<string, { sen: number; n: number }>();
    let owed = 0;
    let overdue = 0;
    let overdueN = 0;
    for (const p of pis) {
      const amt = Number(p.amountSen) || 0;
      const ym = String(p.invoiceDate ?? "").slice(0, 7);
      spendBy.set(ym, (spendBy.get(ym) ?? 0) + amt);
      if (months.includes(ym)) {
        const k = p.supplierName || "—";
        const s = supplier.get(k) ?? { sen: 0, n: 0 };
        s.sen += amt;
        s.n += 1;
        supplier.set(k, s);
      }
      const left = amt - (Number(p.paidAmountSen) || 0);
      if (left > 0 && p.status !== "PAID") {
        owed += left;
        if (p.dueDate && String(p.dueDate).slice(0, 10) < today) { overdue += left; overdueN += 1; }
      }
    }
    const revOf = (ms: string[]) => ms.reduce((a, m) => {
      let s = 0;
      for (const [d, v] of prodRev?.byDay ?? []) if (d.startsWith(m)) s += v.total;
      return a + s;
    }, 0);
    const spend = months.reduce((a, m) => a + (spendBy.get(m) ?? 0), 0);
    const prevSpend = prevMonths.reduce((a, m) => a + (spendBy.get(m) ?? 0), 0);
    const rev = revOf(months);
    const prevRev = revOf(prevMonths);
    // Expected spend (owner 2026-10-17: compare with a forecast built from
    // production revenue, or a light / heavy month reads wrong): that month's
    // production revenue × the purchase % of the three months before it.
    const shareOf = (m: string) => { const r = revOf([m]); return r > 0 ? (spendBy.get(m) ?? 0) / r : null; };
    const trend = trendMonths.map((m) => {
      const r = revOf([m]);
      const s = spendBy.get(m) ?? 0;
      const prior = [1, 2, 3].map((i) => shareOf(shiftMonth(m, -i))).filter((x): x is number => x != null);
      const rate = prior.length ? prior.reduce((a, b) => a + b, 0) / prior.length : null;
      return {
        m: monthLabel(m).slice(0, 3),
        Spend: Math.round(s / 100),
        "Expected from production": rate == null ? null : Math.round((r * rate) / 100),
        "% of production revenue": r > 0 ? Math.round((s / r) * 1000) / 10 : null,
      };
    });
    const top = [...supplier.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.sen - a.sen).slice(0, 6);
    const periodPis = pis.filter((p) => months.includes(String(p.invoiceDate ?? "").slice(0, 7))).sort((a, b) => String(b.invoiceDate).localeCompare(String(a.invoiceDate)));
    const monthRows = trendMonths.map((m) => ({ m, spend: spendBy.get(m) ?? 0, rev: revOf([m]) }));
    return {
      spend, prevSpend, rev, prevRev, owed, overdue, overdueN, trend, top, periodPis, monthRows,
      change: prevSpend > 0 ? ((spend - prevSpend) / prevSpend) * 100 : null,
      share: rev > 0 ? (spend / rev) * 100 : null,
      prevShare: prevRev > 0 ? (prevSpend / prevRev) * 100 : null,
    };
  }, [piResp, prodRev, months, prevMonths, trendMonths, today]);

  // Latest finished month that has a stock take, and the one before it.
  const stock = useMemo(() => {
    const cols = csResp?.data?.cols ?? [];
    const groups = csResp?.data?.groups ?? [];
    const closingAt = (i: number) => {
      let sum = 0;
      let any = false;
      for (const g of groups) {
        const m = g.months?.[i];
        if (m?.closing != null && m.closing !== 0) { sum += m.closing; any = true; }
      }
      return any ? sum : null;
    };
    const taken = cols.map((ym, i) => ({ ym, i, sen: ym < today.slice(0, 7) ? closingAt(i) : null })).filter((x): x is { ym: string; i: number; sen: number } => x.sen != null);
    const last = taken[taken.length - 1];
    if (!last) return null;
    const prev = taken[taken.length - 2] ?? null;
    const lines = groups
      .map((g) => ({ name: g.description || g.group || "—", sen: g.months?.[last.i]?.closing ?? 0, prevSen: prev ? g.months?.[prev.i]?.closing ?? 0 : null }))
      .filter((l) => l.sen || l.prevSen)
      .sort((a, b) => b.sen - a.sen);
    return { ym: last.ym, sen: last.sen, prevYm: prev?.ym ?? null, prevSen: prev?.sen ?? null, lines };
  }, [csResp, today]);

  const pur = ov?.purchasing;
  const label = key === dp.key && dp.kind !== "month" ? (dp.kind === "year" ? key : `Q${key.slice(6)} ${key.slice(0, 4)}`) : monthLabel(lastYm);
  const isLive = lastYm === today.slice(0, 7);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Purchasing · {label}</CardTitle>
        <p className="mt-0.5 text-xs text-[#9CA3AF]">Supplier invoices by invoice date{isLive ? " (to date)" : ""} · % = share of production revenue, the same base as Costing</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Stat
            label="Invoiced spend"
            onClick={() => setDrill("spend")}
            value={rm(calc.spend)}
            sub={calc.change == null ? "no previous period" : `${calc.change >= 0 ? "▲" : "▼"} ${Math.abs(calc.change).toFixed(0)}% vs ${rm(calc.prevSpend)} before`}
          />
          <Stat
            label="% of production revenue"
            onClick={() => setDrill("share")}
            value={prodRev ? pct(calc.share) : "…"}
            sub={calc.prevShare == null ? undefined : `previous period ${pct(calc.prevShare)}`}
            tone={calc.share != null && calc.prevShare != null ? (calc.share > calc.prevShare ? "bad" : "good") : undefined}
          />
          <Stat label="Outstanding POs" onClick={() => setDrill("po")} value={pur ? rm(pur.outstandingPOValueSen) : "…"} sub={pur ? `${fmtN(pur.openPOCount)} POs open · ${fmtN(pur.itemsPendingReceipt)} items still to arrive` : undefined} />
          <Stat
            label="Raw material stock"
            onClick={stock ? () => setDrill("stock") : undefined}
            value={stock ? rm(stock.sen) : csResp ? "—" : "…"}
            sub={stock
              ? `stock take ${monthLabel(stock.ym)}${stock.prevSen ? ` · ${stock.sen >= stock.prevSen ? "▲" : "▼"} ${Math.abs(((stock.sen - stock.prevSen) / stock.prevSen) * 100).toFixed(0)}% vs ${monthLabel(stock.prevYm ?? "").slice(0, 3)}` : ""}`
              : csResp ? "no stock take recorded yet" : undefined}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
          <div className="xl:col-span-3">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Spend vs expected from production · last 6 months</p>
            <div className="select-none [&_*]:outline-none" style={{ width: "100%", height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={calc.trend} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke="#F0ECE6" />
                  <XAxis dataKey="m" tick={CC_TICK} axisLine={CC_AXIS_LINE} tickLine={false} />
                  <YAxis yAxisId="rm" tick={CC_TICK} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => fmtRMAxis(Number(v))} />
                  <YAxis yAxisId="pct" orientation="right" tick={CC_TICK} axisLine={false} tickLine={false} width={36} tickFormatter={(v) => `${v}%`} />
                  <Tooltip contentStyle={{ background: "#FFFFFF", border: "1px solid #E2DDD8", borderRadius: 8, fontSize: 12 }} formatter={(v, n) => (n === "% of production revenue" ? [`${v}%`, n] : [rm(Number(v) * 100), n])} />
                  <Legend {...t.legend} />
                  <Bar yAxisId="rm" dataKey="Spend" hide={t.hide("Spend")} fill={INK} radius={[4, 4, 0, 0]} maxBarSize={30} isAnimationActive={false} />
                  <Line yAxisId="rm" type="monotone" dataKey="Expected from production" hide={t.hide("Expected from production")} stroke="#3E6570" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3, fill: "#FFFFFF", stroke: "#3E6570", strokeWidth: 2 }} connectNulls isAnimationActive={false} />
                  <Line yAxisId="pct" type="monotone" dataKey="% of production revenue" hide={t.hide("% of production revenue")} stroke={GOLD} strokeWidth={2.5} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="xl:col-span-2">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Top suppliers · share of spend</p>
            {calc.top.length === 0 ? (
              <p className="py-6 text-center text-xs text-[#9CA3AF]">No supplier invoices in this period.</p>
            ) : (
              calc.top.map((s) => {
                const share = calc.spend > 0 ? (s.sen / calc.spend) * 100 : 0;
                return (
                  <div key={s.name} className="border-t border-[#F0ECE6] py-1.5 text-[12.5px]">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[#1F1D1B]">{s.name} <span className="text-[#9CA3AF]">· {s.n} PI</span></span>
                      <span className="shrink-0 tabular-nums font-semibold">{rm(s.sen)} <span className="font-normal text-[#9CA3AF]">{share.toFixed(0)}%</span></span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-[#F0ECE6]"><div className="h-1.5 rounded-full" style={{ width: `${share}%`, background: INK }} /></div>
                  </div>
                );
              })
            )}
          </div>
        </div>
        {drill && (
          <DashModal
            wide
            title={drill === "spend" ? `Supplier invoices · ${label}` : drill === "share" ? "Purchases vs production revenue · by month" : drill === "po" ? "Outstanding purchase orders" : `Raw material stock · stock take ${stock ? monthLabel(stock.ym) : ""}`}
            subtitle={drill === "spend" ? `${calc.periodPis.length} invoices · ${rm(calc.spend)}` : drill === "stock" ? "Closing stock per P&L account, from the month-end stock take" : undefined}
            onClose={() => setDrill(null)}
          >
            <div className="max-h-[60vh] overflow-y-auto">
              <table className="w-full text-[12.5px]">
                {drill === "spend" && (
                  <>
                    <thead><tr className="sticky top-0 bg-white text-left text-[10.5px] uppercase tracking-wide text-[#9CA3AF] shadow-[inset_0_-1px_0_#E2DDD8]"><th className="py-1.5">Date</th><th className="py-1.5">PI</th><th className="py-1.5">Supplier</th><th className="py-1.5">Status</th><th className="py-1.5 text-right">Amount</th></tr></thead>
                    <tbody>{calc.periodPis.map((p, i) => (
                      <tr key={(p.piNo ?? "") + i} className="border-b border-[#F0ECE6]"><td className="py-1.5 text-[#6B7280]">{String(p.invoiceDate ?? "").slice(0, 10)}</td><td className="py-1.5 font-mono">{p.piNo ?? "—"}</td><td className="py-1.5">{p.supplierName ?? "—"}</td><td className="py-1.5 text-[#6B7280]">{p.status}</td><td className="py-1.5 text-right tabular-nums font-semibold">{rm(Number(p.amountSen) || 0)}</td></tr>
                    ))}</tbody>
                  </>
                )}
                {drill === "share" && (
                  <>
                    <thead><tr className="sticky top-0 bg-white text-left text-[10.5px] uppercase tracking-wide text-[#9CA3AF] shadow-[inset_0_-1px_0_#E2DDD8]"><th className="py-1.5">Month</th><th className="py-1.5 text-right">Purchases</th><th className="py-1.5 text-right">Production revenue</th><th className="py-1.5 text-right">%</th></tr></thead>
                    <tbody>{calc.monthRows.map((r) => (
                      <tr key={r.m} className="border-b border-[#F0ECE6]"><td className="py-1.5">{monthLabel(r.m)}</td><td className="py-1.5 text-right tabular-nums">{rm(r.spend)}</td><td className="py-1.5 text-right tabular-nums">{rm(r.rev)}</td><td className="py-1.5 text-right tabular-nums font-semibold">{r.rev > 0 ? pct((r.spend / r.rev) * 100) : "—"}</td></tr>
                    ))}</tbody>
                  </>
                )}
                {drill === "po" && (
                  <>
                    <thead><tr className="sticky top-0 bg-white text-left text-[10.5px] uppercase tracking-wide text-[#9CA3AF] shadow-[inset_0_-1px_0_#E2DDD8]"><th className="py-1.5">PO</th><th className="py-1.5">Supplier</th><th className="py-1.5">Ordered</th><th className="py-1.5">Status</th><th className="py-1.5 text-right">Value</th></tr></thead>
                    <tbody>
                      {!poResp && <tr><td colSpan={5} className="py-6 text-center text-[#9CA3AF]">Loading…</td></tr>}
                      {(poResp?.data ?? []).filter((o) => !["RECEIVED", "CLOSED", "CANCELLED"].includes(o.status)).sort((a, b) => String(b.orderDate).localeCompare(String(a.orderDate))).map((o, i) => (
                        <tr key={(o.poNo ?? "") + i} className="border-b border-[#F0ECE6]"><td className="py-1.5 font-mono">{o.poNo ?? "—"}</td><td className="py-1.5">{o.supplierName ?? "—"}</td><td className="py-1.5 text-[#6B7280]">{String(o.orderDate ?? "").slice(0, 10)}</td><td className="py-1.5 text-[#6B7280]">{o.status}</td><td className="py-1.5 text-right tabular-nums font-semibold">{rm(Number(o.totalSen) || 0)}</td></tr>
                      ))}
                    </tbody>
                  </>
                )}
                {drill === "stock" && stock && (
                  <>
                    <thead><tr className="sticky top-0 bg-white text-left text-[10.5px] uppercase tracking-wide text-[#9CA3AF] shadow-[inset_0_-1px_0_#E2DDD8]"><th className="py-1.5">Account</th>{stock.prevYm && <th className="py-1.5 text-right">{monthLabel(stock.prevYm)}</th>}<th className="py-1.5 text-right">{monthLabel(stock.ym)}</th></tr></thead>
                    <tbody>{stock.lines.map((l) => (
                      <tr key={l.name} className="border-b border-[#F0ECE6]"><td className="py-1.5">{l.name}</td>{stock.prevYm && <td className="py-1.5 text-right tabular-nums text-[#6B7280]">{rm(l.prevSen ?? 0)}</td>}<td className="py-1.5 text-right tabular-nums font-semibold">{rm(l.sen)}</td></tr>
                    ))}</tbody>
                    <tfoot><tr className="font-semibold"><td className="py-1.5">Total</td>{stock.prevYm && <td className="py-1.5 text-right tabular-nums">{rm(stock.prevSen ?? 0)}</td>}<td className="py-1.5 text-right tabular-nums">{rm(stock.sen)}</td></tr></tfoot>
                  </>
                )}
              </table>
            </div>
          </DashModal>
        )}
      </CardContent>
    </Card>
  );
}
