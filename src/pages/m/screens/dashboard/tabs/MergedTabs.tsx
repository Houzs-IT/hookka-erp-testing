// The /m dashboard tabs ARE the desktop merged-dashboard views (owner
// 2026-10-17: "手机版本你也可以调整"). The phone used to carry its own copy of
// every tab (~2,800 lines) that had drifted from the desktop — different KPI
// definitions, no costing, no progressive revenue, the old Overview. Rendering
// the same components means a figure on the phone is the figure on the desktop,
// by construction. They are responsive (2-column tiles, scrolling tables), and
// sit on a light surface because their colours are the desktop palette.
// Sub-tabs keep the /m pill strip and the same ?sub= keys as the desktop.
import type { ReactNode } from "react";
import { SalesOrdersView } from "../../../../dashboards/SalesOrdersView";
import { OperationsView } from "../../../../dashboards/OperationsView";
import { EmployeesDashboard } from "../../../../dashboards/EmployeesDashboard";
import { ServiceView } from "../../../../dashboards/ServiceView";
import { FinanceView } from "../../../../dashboards/FinanceView";
import { OcrView } from "../../../../dashboards/OcrView";
import type { FinSub, OpsSub, ServiceSub } from "../../../../dashboards/dashboard-shared-lib";
import { useDashboardSub } from "../hooks";
import { MSubPills } from "../primitives";
import type { DashboardTabProps } from "../types";

function Surface({ children }: { children: ReactNode }) {
  return (
    <div
      // The desktop views style cards through [data-slot=card]; give them the
      // same look the desktop shell gives them, at phone padding.
      // p.truncate: tile labels and sub-lines wrap on the phone instead of
      // being cut ("Average per working…", "Closed within 3 d…").
      className="space-y-4 [--card-pad:1rem] [&_p.truncate]:whitespace-normal [&_p.truncate]:overflow-visible [&_[data-slot=card]]:rounded-xl [&_[data-slot=card]]:shadow-[0_1px_3px_rgba(0,0,0,0.08)] [&_[data-slot=card]_h3]:text-sm [&_[data-slot=card]_h3]:font-bold"
      style={{ padding: "12px 12px 28px", backgroundColor: "#F0ECE9", color: "#1F1D1B", minHeight: "60vh" }}
    >
      {children}
    </div>
  );
}

export function SalesTab({ period, setPeriod, months }: DashboardTabProps) {
  return <Surface><SalesOrdersView period={period} months={months} onPeriodChange={setPeriod} /></Surface>;
}

export function OperationsTab({ period, setPeriod }: DashboardTabProps) {
  const { sub, setSub, subs } = useDashboardSub("operations");
  return (
    <>
      <MSubPills subs={subs} active={sub} onChange={setSub} />
      <Surface><OperationsView period={period} sub={sub as OpsSub} onPeriodChange={setPeriod} /></Surface>
    </>
  );
}

export function PeopleTab({ period }: DashboardTabProps) {
  return <Surface><EmployeesDashboard period={period} /></Surface>;
}

export function ServiceTab({ period, setPeriod }: DashboardTabProps) {
  const { sub, setSub, subs } = useDashboardSub("service");
  return (
    <>
      <MSubPills subs={subs} active={sub} onChange={setSub} />
      <Surface><ServiceView period={period} sub={sub as ServiceSub} onPeriodChange={setPeriod} onSubChange={(k) => setSub(k)} /></Surface>
    </>
  );
}

export function FinanceTab({ period, setPeriod, months }: DashboardTabProps) {
  const { sub, setSub, subs } = useDashboardSub("finance");
  return (
    <>
      <MSubPills subs={subs} active={sub} onChange={setSub} />
      <Surface><FinanceView period={period} sub={sub as FinSub} months={months} onPeriodChange={setPeriod} /></Surface>
    </>
  );
}

export function OcrTab({ period }: DashboardTabProps) {
  return <Surface><OcrView period={period} /></Surface>;
}
