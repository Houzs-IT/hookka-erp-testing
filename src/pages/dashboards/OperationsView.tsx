import { useMemo, useState } from "react";
import { useCachedJson } from "@/lib/cached-fetch";
import { Card, CardContent } from "@/components/ui/card";
import { fmtN, dayLabel, periodLabel, type Period, type OpsSub } from "./dashboard-shared-lib";
import { LiveBadge } from "./dashboard-shared";
import { DueSoonWorklist, type ProdOrderSummary } from "./OverdueCards";
import type { EmployeeSlice } from "./EmployeesInsights";
import { ProductionDailyPanels } from "./ProductionDailyPanels";
import { CostingPanel } from "./CostingPanel";
import { PurchasingPanel } from "./PurchasingPanel";
import { DashModal } from "./DashModal";
import { CommandCenterSections } from "./CommandCenterSections";
import { OverdueOrdersList } from "./OverdueOrdersList";
import { DailyProductionRevenueCard } from "./DailyProductionRevenueCard";

// Operations tab: the shop-floor report checklist (handed over on paper,
// 2026-09-17), redesigned 2026-09-18 for density: a single KPI strip, a 2-column chart split
// (overdue-by-dept / daily output), and a full-width filterable worklist for
// the due-soon early-warning list — instead of stacked, mostly-empty cards.
// Everything still reads the SAME cached GET /api/dashboard/prototype feed
// every other tab reads; no tab has an endpoint of its own.
type Feed = {
  success?: boolean;
  availability?: {
    production?: { live: boolean; reason?: string; costError?: string };
    inventory?: { live: boolean; reason?: string };
    employee?: { live: boolean; reason?: string };
  };
  production?: {
    orders: ProdOrderSummary[];
    overdueByDept: { department: string; count: number }[];
    dueSoon3Days: ProdOrderSummary[];
    dailyOutput: { date: string; orders: number; units: number }[];
    planVsActual: {
      rows: { poNo: string | null; productName: string | null; plan: string; actual: string; varianceDays: number }[];
      onTime: number;
      late: number;
      withBothDates: number;
      completedTotal: number;
    };
    // Optional, not just possibly-missing-in-theory: this key was added after
    // dashboard:prototype:* was already cached at a 60s TTL, so the first
    // request after a deploy can genuinely serve an old payload without it.
    productionCost?: {
      byDay: { date: string; materialSen: number; laborSen: number; overheadSen: number; totalSen: number; batches: number }[];
      totalBatches: number;
      batchesWithCost: number;
    };
  };
  inventory?: {
    materialShortage: { code: string | null; description: string | null; group: string | null; balanceQty: number }[];
  };
  employee?: EmployeeSlice;
};


export function OperationsView({
  period, sub, onPeriodChange,
}: { period: Period; sub: OpsSub; onPeriodChange: (p: Period) => void }) {
  const { data, loading, error } = useCachedJson<Feed>("/api/dashboard/prototype");

  const production = data?.production;
  const inventory = data?.inventory;
  const prodLive = data?.availability?.production?.live ?? false;
  const invLive = data?.availability?.inventory?.live ?? false;

  // Real shortages are NEGATIVE balances; a zero balance is mostly an item not
  // in use (old colours, maintenance parts) — 3 of the 284 "at zero /
  // negative" were actually short in Oct 2026.
  const [shortOpen, setShortOpen] = useState(false);
  const shortage = useMemo(() => {
    const all = [...(inventory?.materialShortage ?? [])].sort((a, b) => a.balanceQty - b.balanceQty);
    return { all, negative: all.filter((m) => m.balanceQty < 0).length, zero: all.filter((m) => m.balanceQty === 0).length };
  }, [inventory?.materialShortage]);

  if (loading) {
    return <div className="py-16 text-center text-sm text-[#6B7280]">Loading…</div>;
  }
  if (error || !data?.success) {
    return (
      <Card className="border-[#F0D9AE] bg-[#FDF3E4]">
        <CardContent className="p-3 text-sm text-[#B5701A]">
          Couldn't load Operations: {error ?? "unknown error"}
        </CardContent>
      </Card>
    );
  }


  return (
    <div className="space-y-4 max-md:space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-[#1F1D1B]">Operations</h2>
        <LiveBadge live={prodLive && invLive} />
        {!period.day && <span className="text-xs text-[#6B7280]">{periodLabel(period)}</span>}
        {period.day && (
          <button
            type="button"
            onClick={() => onPeriodChange({ ...period, day: undefined })}
            className="text-xs rounded-md border border-[#E5E0D8] bg-[#F7F5F3] px-2 py-0.5 text-[#6B5C32] hover:bg-white max-md:min-h-10 max-md:px-3 max-md:text-left"
          >
            Showing: {dayLabel(period.day)} — click to go back
          </button>
        )}
      </div>

      {sub === "overview" && (
        <>
            {/* Command Center cards (owner 2026-10-17: the old Overview UI).
                Department Revenue sits right above Department Status, and
                Plant Load beside it instead of stretched across the page.
                The overdue / due-soon counts live in "Today's problems" up
                top; its tiles scroll down to these two lists. */}
            <CommandCenterSections period={period} sections={["dailyReport", "deptRevenue"]} onPeriodChange={onPeriodChange} />
            <DailyProductionRevenueCard period={period} onPeriodChange={onPeriodChange} />
            {/* Stretch both to the taller one (owner 2026-10-17: the backlog
                card left a gap under it beside Plant Load). */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
              <div className="lg:col-span-2 min-w-0 [&>div]:h-full [&>div>div]:h-full [&>div>div>div]:h-full [&_[data-slot=card]]:h-full">
                <CommandCenterSections period={period} sections={["deptBacklog"]} />
              </div>
              <div className="min-w-0">
                <CommandCenterSections period={period} sections={["plantLoad"]} />
              </div>
            </div>

            <div id="ops-overdue" className="scroll-mt-48">
              <OverdueOrdersList orders={production?.orders ?? []} />
            </div>
            <div id="ops-due-soon" className="scroll-mt-48">
              <DueSoonWorklist orders={production?.dueSoon3Days ?? []} />
            </div>

        </>
      )}

      {/* Output & Cost, layer 1 (owner 2026-10-17: "Layer 1 越简单越好"):
          costing vs production revenue, plan vs actual, fabric + purchasing.
          The per-day Completed chart lives in Plant Load's Completed popup;
          the shortage list opens in a popup from its one-line row. */}
      {sub === "production" && (
        <>
          <CostingPanel period={period} costByDay={production?.productionCost?.byDay ?? []} onPeriodChange={onPeriodChange} />
          <ProductionDailyPanels period={period} sub="plan" onPeriodChange={onPeriodChange} />
          <PurchasingPanel period={period} />
          <CommandCenterSections period={period} sections={["fabric"]} />
          <button
            id="ops-shortage"
            type="button"
            onClick={() => setShortOpen(true)}
            className="scroll-mt-48 flex w-full items-center justify-between rounded-xl bg-white px-4 py-3 text-left shadow-[0_1px_3px_rgba(0,0,0,0.08)] hover:shadow-md"
          >
            <span className="text-sm text-[#1F1D1B]">
              <b className={shortage.negative ? "text-[#9A3A2D]" : "text-[#4F7C3A]"}>{fmtN(shortage.negative)}</b> materials below zero
              <span className="text-[#9CA3AF]"> · {fmtN(shortage.zero)} more at exactly zero (mostly not in use)</span>
            </span>
            <span className="text-xs font-semibold text-[#6B5C32]">View list ›</span>
          </button>
          {shortOpen && (
            <DashModal title="Material shortage" subtitle="Below zero first, then items at exactly zero · min stock is not set on raw materials, so this is a balance check" onClose={() => setShortOpen(false)}>
              <div className="max-h-[60vh] overflow-y-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="*:sticky *:top-0 *:bg-white text-left text-[10.5px] uppercase tracking-wide text-[#9CA3AF] shadow-[inset_0_-1px_0_#E2DDD8]">
                      <th className="py-2 pr-3">Code</th><th className="py-2 pr-3">Description</th><th className="py-2 pr-3">Group</th><th className="py-2 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shortage.all.map((m, i) => (
                      <tr key={m.code ?? i} className="border-b border-[#F0ECE6]">
                        <td className="py-1.5 pr-3 font-mono text-[#1F1D1B]">{m.code ?? "—"}</td>
                        <td className="py-1.5 pr-3 text-[#6B7280]">{m.description ?? "—"}</td>
                        <td className="py-1.5 pr-3 text-[#6B7280]">{m.group ?? "—"}</td>
                        <td className={`py-1.5 text-right tabular-nums font-semibold ${m.balanceQty < 0 ? "text-[#9A3A2D]" : "text-[#9CA3AF]"}`}>{m.balanceQty}</td>
                      </tr>
                    ))}
                    {shortage.all.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-[#6B7280]">Nothing at zero or below.</td></tr>}
                  </tbody>
                </table>
              </div>
            </DashModal>
          )}
        </>
      )}
    </div>
  );
}
