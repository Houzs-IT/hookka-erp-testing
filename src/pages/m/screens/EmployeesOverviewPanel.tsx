// Employees > Overview (HK-0125): department labour, efficiency, labour cost and
// salary for a period. It is the dashboard's Employees tab itself, so every
// figure here is the desktop's figure; lazy-loaded from modules.ts because it
// pulls in recharts.
import { useNavigate } from "react-router-dom";
import { usePermissions } from "@/lib/use-permission";
import { useDashboardFeed, useDashboardPeriod } from "./dashboard/hooks";
import { PeriodChip } from "./dashboard/PeriodChip";
import { PeopleTab } from "./dashboard/tabs/MergedTabs";
import { M } from "../theme";

export default function EmployeesOverviewPanel() {
  const navigate = useNavigate();
  const { dashboardTabs } = usePermissions();
  const { feed, months, loading } = useDashboardFeed();
  const { period, setPeriod } = useDashboardPeriod(months, "people");
  const latestDay = (feed?.sales?.byDay ?? []).reduce((m, d) => (d.date > m ? d.date : m), "");

  if (dashboardTabs && !dashboardTabs.includes("people")) {
    return <Note text="Your role cannot see the Employees dashboard." />;
  }
  if (loading && !feed) return <Note text="Loading…" />;

  return (
    <div style={{ margin: "0 -18px" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "4px 18px 8px" }}>
        <PeriodChip period={period} months={months} latestDay={latestDay} onChange={setPeriod} allowDay />
      </div>
      <PeopleTab
        period={period}
        setPeriod={setPeriod}
        months={months}
        openTab={(t) => navigate(`/m/dashboard/${t}`)}
      />
    </div>
  );
}

function Note({ text }: { text: string }) {
  return <div style={{ padding: "18px 0", textAlign: "center", fontSize: 13, color: M.muted }}>{text}</div>;
}
