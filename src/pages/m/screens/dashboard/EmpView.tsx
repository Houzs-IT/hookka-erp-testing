// Home v10 · the Employees view, in the section order of the approved Home Employees 2 HTML. Owns the model hook
// (emp-model.ts) and hands each card its slice; nothing is computed here. A reader without the feed's employee section
// sees a permission message, not an empty dashboard.
import { useResponsiveLayout } from "../../lib/responsive-layout";
import type { Period } from "../../../dashboards/dashboard-shared-lib";
import type { EmpAccess } from "./emp-data";
import { useEmpModel } from "./emp-model";
import { ChartCard, Headline } from "./HomeEmpA";
import { AttendanceCard, DeptCard, NonProdCard, RankCard, WorkersControls } from "./HomeEmpB";
import { EmpSheets } from "./HomeEmpSheets";
import { SectionState } from "./home-ui";
import { StatusBlock } from "./ops-ui";

export function EmpView({ access, period, today, logSignal }: { access: EmpAccess; period: Period; today: string; logSignal: number }) {
  const m = useEmpModel({ access, period, today, logSignal });
  const wide = useResponsiveLayout().mode !== "phone";
  const { status } = m.feed;
  if (status === "loading") return <div style={{ padding: "14px 16px 120px" }}><SectionState kind="loading" minHeight={240} /></div>;
  if (status !== "ready") {
    return (
      <div style={{ padding: "14px 16px 120px" }}>
        <StatusBlock status={status} what="The Employees dashboard" need="workers access" reason={m.feed.reason} onRetry={m.feed.refresh} minHeight={240} />
      </div>
    );
  }
  const col = (children: React.ReactNode) => <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 12 }}>{children}</div>;
  return (
    <div data-testid="emp-view" style={{ padding: "14px 16px 120px", display: "grid", gridTemplateColumns: wide ? "repeat(2,minmax(0,1fr))" : "minmax(0,1fr)", gap: 16, alignItems: "start" }}>
      <Headline m={m} />
      <ChartCard m={m} />
      <section aria-label="Workers and departments" style={{ gridColumn: wide ? "1 / -1" : "auto" }}>
        {col(<><WorkersControls m={m} /><DeptCard m={m} /><RankCard m={m} /><NonProdCard m={m} /><AttendanceCard m={m} /></>)}
      </section>
      <EmpSheets m={m} />
    </div>
  );
}
