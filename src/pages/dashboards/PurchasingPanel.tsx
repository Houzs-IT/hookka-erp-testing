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
//   • what we owe suppliers now, and how much of it is past due
//   • six months of spend with its % of production revenue
//   • top suppliers by invoiced amount, with their share
// Supplier invoices are read once (GET /api/purchase-invoices, cancelled out).
// ---------------------------------------------------------------------------
type Pi = { piNo?: string | null; invoiceDate: string | null; dueDate: string | null; amountSen: number | string | null; paidAmountSen: number | string | null; status: string; supplierName: string | null };
type Po = { poNo?: string | null; supplierName?: string | null; orderDate?: string | null; expectedDate?: string | null; totalSen?: number | string | null; status: string };
type Aging = { supplierName: string; notDueSen: number; d30Sen: number; d60Sen: number; d90Sen: number; d120Sen: number; over120Sen: number; totalSen: number };
type Drill = "spend" | "share" | "po" | "owe" | null;

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
  // What we owe suppliers = accounting's own figure (owner audit 2026-10-17):
  // the trade-creditors control net of advances already paid, past due from
  // its aging. Summing unpaid invoices ourselves read RM 377k against the
  // ledger's RM 347k — it missed RM 22.7k of advances. Roles without
  // accounting access fall back to the invoice sum, labelled as such.
  const { data: apResp } = useCachedJson<{ data?: { netOutstandingSen?: number; aging?: Aging[] } }>("/api/accounting/ap-control");
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
          {apResp?.data?.netOutstandingSen != null ? (() => {
            const aging = apResp.data.aging ?? [];
            const total = apResp.data.netOutstandingSen ?? 0;
            const pastDue = aging.reduce((a, r) => a + (r.totalSen - r.notDueSen), 0);
            return <Stat label="We owe suppliers" onClick={() => setDrill("owe")} value={rm(total)} sub={`${rm(pastDue)} past due · trade creditors, net of advances`} tone={pastDue > 0 ? "bad" : undefined} />;
          })() : (
            <Stat label="We owe suppliers" value={piResp ? rm(calc.owed) : "…"} sub={piResp ? `${rm(calc.overdue)} past due · from unpaid invoices` : undefined} tone={calc.overdue > 0 ? "bad" : undefined} />
          )}
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
            title={drill === "spend" ? `Supplier invoices · ${label}` : drill === "share" ? "Purchases vs production revenue · by month" : drill === "po" ? "Outstanding purchase orders" : "What we owe suppliers · aging"}
            subtitle={drill === "spend" ? `${calc.periodPis.length} invoices · ${rm(calc.spend)}` : drill === "owe" ? "Trade creditors, net of advances — accounting's own aging" : undefined}
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
                {drill === "owe" && (
                  <>
                    <thead><tr className="sticky top-0 bg-white text-left text-[10.5px] uppercase tracking-wide text-[#9CA3AF] shadow-[inset_0_-1px_0_#E2DDD8]"><th className="py-1.5">Supplier</th><th className="py-1.5 text-right">Not due</th><th className="py-1.5 text-right">1–30 d</th><th className="py-1.5 text-right">31–60 d</th><th className="py-1.5 text-right">61–90 d</th><th className="py-1.5 text-right">90+ d</th><th className="py-1.5 text-right">Total</th></tr></thead>
                    <tbody>{[...(apResp?.data?.aging ?? [])].sort((a, b) => b.totalSen - a.totalSen).map((a) => (
                      <tr key={a.supplierName} className="border-b border-[#F0ECE6]"><td className="py-1.5">{a.supplierName}</td><td className="py-1.5 text-right tabular-nums text-[#6B7280]">{rm(a.notDueSen)}</td><td className="py-1.5 text-right tabular-nums">{rm(a.d30Sen)}</td><td className="py-1.5 text-right tabular-nums">{rm(a.d60Sen)}</td><td className="py-1.5 text-right tabular-nums">{rm(a.d90Sen)}</td><td className="py-1.5 text-right tabular-nums text-[#9A3A2D]">{rm(a.d120Sen + a.over120Sen)}</td><td className="py-1.5 text-right tabular-nums font-semibold">{rm(a.totalSen)}</td></tr>
                    ))}</tbody>
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
