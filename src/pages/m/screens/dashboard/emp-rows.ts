// List-row specs of the /m Home Employees view (HTML workerRow / deptRow / npPersonRow / npDeptRow). Shared by the
// summary cards and the sheets so a row reads the same everywhere.
import { deptName } from "../../../dashboards/ops-floor-lib";
import { RED } from "../../../dashboards/dashboard-shared-lib";
import { avatarOf, costCentreName, effBar, overallText, poolEff, rowEff, effColor, floorSet, hrs, loggedUnder, NP_SHADE_SHARE, pct, pctOf, ratio, type DeptRow, type Row } from "./emp-lib";
import type { RowSpec } from "./emp-ui";
import type { EmpModel } from "./emp-model";

const bar = (m: EmpModel, v: number | null) => { const b = effBar(v, m.target); return b ? { ...b, c: effColor(v, m.target) } : null; };

export function workerRow(m: EmpModel, r: Row, i: number, start: number | null): RowSpec {
  const v = rowEff(r);
  return {
    key: r.id, av: avatarOf(r.name), bar: bar(m, v), rank: start != null ? String(start + i + 1) : undefined, title: r.name,
    lines: [`${deptName(r.dept)} · ${r.daysWorked} days · ${hrs(r.prod)} / ${hrs(r.work)}${m.canSalary ? ` · ${m.salaryText(r.cost)}` : ""}`],
    right: pct(v), rc: effColor(v, m.target), onTap: () => m.push({ type: "worker", id: r.id }),
  };
}

export function deptRow(m: EmpModel, r: DeptRow, summary: boolean): RowSpec {
  const v = poolEff(r);
  const floor = floorSet().has(r.dept);
  const lp = ratio(r.cost, r.bf + r.sofa);
  const lpText = labourPctText(m, lp);
  return {
    key: r.dept, bar: bar(m, v), title: costCentreName(r.dept), tc: floor ? undefined : "#9A9082",
    lines: summary
      ? [`${r.people.size} people · ${hrs(r.prod)} / ${hrs(r.work)}`, ...(overallText(r) ? [overallText(r)] : [])]
      : [`${r.people.size} people · working ${hrs(r.work)} · production ${hrs(r.prod)}`, ...(overallText(r) ? [overallText(r)] : []), `Output · Bedframe ${m.outText(r.bf)} · Sofa ${m.outText(r.sofa)}`, ...(m.canSalary ? [`Salary ${m.salaryText(r.cost)} · Labour % ${lpText}`] : [])],
    right: pct(v), rc: effColor(v, m.target), onTap: () => m.push({ type: "dept", dept: r.dept }),
  };
}

export function npPersonRow(m: EmpModel, r: { id: string; non: number; all: number; days: number }, i: number): RowSpec {
  const w = m.workerById.get(r.id);
  const name = w?.name ?? r.id;
  const sh = r.all > 0 ? r.non / r.all : 0;
  const shaded = sh >= NP_SHADE_SHARE;
  return {
    key: r.id, av: avatarOf(name), bar: { w: `${(Math.min(sh * 100, 40) / 40) * 100}%`, t: "50%", c: shaded ? RED : "#C2410C" }, rank: String(i + 1), title: name,
    lines: [`${deptName(w?.dept ?? "—")} · ${pctOf(r.non, r.all)} of clocked · ${r.days} days`, `Logged under: ${m.canSalary ? loggedUnder(m.hourEntries, m.W.winDates, r.id) || "—" : "needs payroll access"}`],
    right: hrs(r.non), rc: RED, bg: shaded ? "#FDF3F1" : undefined, rad: shaded ? 10 : 0,
  };
}

export function npDeptRow(m: EmpModel, d: { dept: string; non: number; all: number; people: number; top: { id: string; non: number } | null }): RowSpec {
  const share = d.all ? d.non / d.all : 0;
  return {
    key: d.dept, bar: { w: `${(Math.min(share * 100, 40) / 40) * 100}%`, t: "50%", c: d.all && share >= NP_SHADE_SHARE ? RED : "#C2410C" }, title: deptName(d.dept),
    lines: [`Clocked ${hrs(d.all)} · ${pctOf(d.non, d.all)} · ${d.people} people with any`, `Most: ${d.top && d.top.non > 0 ? `${m.workerById.get(d.top.id)?.name ?? d.top.id} · ${hrs(d.top.non)}` : "—"}`],
    right: hrs(d.non), rc: RED,
  };
}

/** Labour % needs BOTH the salary and the department output answered; any other state says which kind of gap it is. */
function labourPctText(m: EmpModel, lp: number | null): string {
  if (m.salaryStatus === "denied" || m.outStatus === "denied") return "No access";
  if (m.salaryStatus === "ready" && m.outStatus === "ready") return pct(lp);
  if (m.salaryStatus === "loading" || m.outStatus === "loading") return "…";
  return "—";
}
export function deptSub(m: EmpModel): string {
  const t = m.deptTotal;
  return `Total · ${t.people.size} people · output ${m.outText(t.bf + t.sofa)}${m.canSalary ? ` · labour ${labourPctText(m, ratio(t.cost, t.bf + t.sofa))}` : ""}`;
}
export const NP_LEGEND = [["h", "Non-production hours", "#D9705A", 8], ["p", "% of clocked", "#5C4A2E", 3]] as const;
