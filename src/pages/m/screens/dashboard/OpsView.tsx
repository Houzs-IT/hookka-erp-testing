// Home v10 · the Operations view: Overview and Output & Cost sub-tabs (desktop OPS_SUBS), in the section order of the approved
// Home Operations HTML. Owns the data hook (ops-data.ts) and hands each card its slice; every card decides for itself
// between loading, error, permission-denied and data. Nothing is computed here.
import type { Period } from "../../../dashboards/dashboard-shared-lib";
import { DailyReportCard, DeptRevenueCard, DueSoonCard, OverdueCard } from "./HomeOpsA";
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
  return (
    <div style={{ padding: "14px 16px 120px", display: "flex", flexDirection: "column", gap: 16 }} data-testid="ops-view" data-ops-sub={sub}>
      {sub === "overview" ? (
        <>
          <DailyReportCard d={d} />
          <PlantLoadCard d={d} period={period} periodKey={periodKey} curYm={curYm} />
          <DeptBacklogCard d={d} />
          <DeptRevenueCard d={d} period={period} onPeriod={onPeriod} />
          <OverdueCard d={d} />
          <DueSoonCard d={d} />
        </>
      ) : (
        <>
          <CostingCard d={d} period={period} today={today} />
          <PlanCard d={d} period={period} onPeriod={onPeriod} today={today} />
          <PurchasingCard d={d} period={period} today={today} canPo={access.purchaseOrders} />
          <FabricCard d={d} period={period} />
          <ShortageCard d={d} />
        </>
      )}
    </div>
  );
}
