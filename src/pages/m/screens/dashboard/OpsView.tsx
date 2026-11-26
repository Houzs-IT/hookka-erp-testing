// Home v10 · the Operations view: Overview and Output & Cost sub-tabs (desktop OPS_SUBS). The Overview follows the approved
// Home Operations v3 order (Daily Report, Plant Load, Department Backlog, Department Revenue, Daily production revenue, Overdue, Due soon).
// Owns the data hook (ops-data.ts) and hands each card its slice; every card decides for itself
// between loading, error, permission-denied and data. Nothing is computed here.
import type { ReactNode } from "react";
import { useResponsiveLayout } from "../../lib/responsive-layout";
import type { Period } from "../../../dashboards/dashboard-shared-lib";
import { DailyReportCard, DeptRevenueCard } from "./HomeOpsA";
import { DailyProductionRevenueCard } from "./HomeOpsD";
import { DueSoonCard, OverdueCard } from "./HomeOpsW";
import { DeptBacklogCard, PlantLoadCard } from "./HomeOpsP";
import { CostingCard, PlanCard } from "./HomeOpsB";
import { FabricCard, PurchasingCard, ShortageCard } from "./HomeOpsC";
import { useOpsData, type OpsAccess } from "./ops-data";

export type OpsSubKey = "overview" | "production";

export function OpsView({
  access, period, periodKey, sub, today, onPeriod,
}: { access: OpsAccess; period: Period; periodKey: string; sub: OpsSubKey; today: string; onPeriod: (p: Period) => void }) {
  const d = useOpsData({ periodKey, period, sub, access, today });
  const curYm = today.slice(0, 7);
  // The design lays both tabs out in two columns on a tablet: Daily Report, Department Revenue and Daily production revenue span both
  // on the Overview; Costing, Plan vs actual and Material shortage span both on Output & Cost (Purchasing and Fabric sit side by side).
  const phone = useResponsiveLayout().mode === "phone";
  const cell = (node: ReactNode, full?: boolean) => <div style={{ minWidth: 0, ...(full && !phone ? { gridColumn: "1 / -1" } : null) }}>{node}</div>;
  return (
    <div style={{ padding: "14px 16px 120px", display: "grid", gridTemplateColumns: phone ? "minmax(0,1fr)" : "repeat(2,minmax(0,1fr))", gap: 16, alignItems: "start" }} data-testid="ops-view" data-ops-sub={sub}>
      {sub === "overview" ? (
        <>
          {cell(<DailyReportCard d={d} />, true)}
          {cell(<PlantLoadCard d={d} period={period} periodKey={periodKey} curYm={curYm} />)}
          {cell(<DeptBacklogCard d={d} />)}
          {cell(<DeptRevenueCard d={d} period={period} onPeriod={onPeriod} />, true)}
          {cell(<DailyProductionRevenueCard d={d} period={period} today={today} onPeriod={onPeriod} />, true)}
          {cell(<OverdueCard d={d} />)}
          {cell(<DueSoonCard d={d} />)}
        </>
      ) : (
        <>
          {cell(<CostingCard d={d} period={period} today={today} />, true)}
          {cell(<PlanCard d={d} period={period} onPeriod={onPeriod} today={today} />, true)}
          {cell(<PurchasingCard d={d} period={period} today={today} canPo={access.purchaseOrders} />)}
          {cell(<FabricCard d={d} period={period} />)}
          {cell(<ShortageCard d={d} />, true)}
        </>
      )}
    </div>
  );
}
