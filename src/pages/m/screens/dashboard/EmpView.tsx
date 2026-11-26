// Home v3 · the Employees view, in the section order of the approved Home Employees v3 HTML. Owns the model hook
// (emp-model.ts) and hands each card its slice; nothing is computed here. A reader without the feed's employee section
// sees a permission message, not an empty dashboard.
// Layout: phone = one column. Tablet (portrait and landscape) fills the width: Workforce and the chart on the left with Labour
// cost beside them (or Workforce beside the chart without payroll), then Workers & departments across, with Ranking and
// Non-production side by side.
import type { CSSProperties, ReactNode } from "react";
import { useResponsiveLayout } from "../../lib/responsive-layout";
import type { Period } from "../../../dashboards/dashboard-shared-lib";
import type { EmpAccess } from "./emp-data";
import { useEmpModel, type EmpDrill } from "./emp-model";
import { ChartCard, Workforce } from "./HomeEmpA";
import { AttendanceCard, DeptCard, NonProdCard, RankCard, WorkersControls } from "./HomeEmpB";
import { LabourCard } from "./HomeEmpLabour";
import { EmpSheets } from "./HomeEmpSheets";
import { SectionState } from "./home-ui";
import { StatusBlock } from "./ops-ui";

export function EmpView({ access, period, today, logSignal, drill }: { access: EmpAccess; period: Period; today: string; logSignal: number; drill?: EmpDrill }) {
  const m = useEmpModel({ access, period, today, logSignal, drill });
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
  const hasLabour = m.canSalary && m.labourSplit.show;
  const area = (a: string): CSSProperties => (wide ? { gridArea: a, minWidth: 0 } : { minWidth: 0 });
  const grid: CSSProperties = wide
    ? { display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gridTemplateAreas: hasLabour ? '"wf lc" "ch lc" "wd wd"' : '"wf ch" "wd wd"', gap: 16, alignItems: "start" }
    : { display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 16, alignItems: "start" };
  const pair = (a: ReactNode, b: ReactNode) => (wide ? <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12, alignItems: "start" }}>{a}{b}</div> : <>{a}{b}</>);
  return (
    <div data-testid="emp-view" style={{ padding: "14px 10px 120px", ...grid }}>
      <div style={area("wf")}><Workforce m={m} /></div>
      {hasLabour ? <div style={area("lc")}><LabourCard m={m} /></div> : null}
      <div style={area("ch")}><ChartCard m={m} /></div>
      <section aria-label="Workers and departments" style={{ ...area("wd"), display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 12 }}>
        <WorkersControls m={m} />
        <DeptCard m={m} />
        {pair(<RankCard m={m} />, <NonProdCard m={m} />)}
        <AttendanceCard m={m} />
      </section>
      <EmpSheets m={m} />
    </div>
  );
}
