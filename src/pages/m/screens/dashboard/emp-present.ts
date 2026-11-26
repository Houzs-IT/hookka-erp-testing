// Home Employees v3 · helpers of the "Present on <day>" sheet (kept out of HomeEmpPresent.tsx, which only exports components).
import { isOutsourced } from "../../../dashboards/dashboard-shared-lib";
import { dLab } from "./emp-lib";
import type { EmpModel } from "./emp-model";

/** Workers the employment rule marks outsourced (their punches are listed with "(outsourced)"; they are never "not in"). */
export function outsourcedIds(m: EmpModel) {
  return new Set(m.employee.workers.filter((w) => isOutsourced(w)).map((w) => w.id));
}
export function presentTitle(m: EmpModel) {
  const day = m.W.anchor;
  const out = outsourcedIds(m);
  const rows = m.punches.status === "ready" ? m.punches.rows : [];
  const ext = rows.some((r) => out.has(r.employeeId));
  return {
    title: `Present on ${day ? dLab(day) : "—"}`,
    sub: `${m.pres.present} of ${m.roster.length} staff clocked in${ext ? ` · ${rows.length} punches incl. outsourced` : ""}`,
  };
}
