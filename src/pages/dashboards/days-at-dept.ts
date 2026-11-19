// How many days a production order has sat in its current department (owner
// 2026-11-19, the overdue-sets list: 「在这个部门stuck着多少天了」). It arrived
// when the last job card of ANOTHER department was completed; with none done
// yet (its first department), it counts from the order's start date.
export type DaysAtDeptLine = {
  status: string;
  currentDepartment: string;
  startDate?: string | null;
  jobCards?: { departmentCode: string; status: string; completedDate: string | null }[];
};

const dayNo = (ymd: string): number => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) / 86_400_000;

/** Whole days since it reached the current department, or null when unknown / not in a department. */
export function daysAtDept(line: DaysAtDeptLine, todayYmd: string): number | null {
  if (!line.currentDepartment || line.status === "COMPLETED" || line.status === "TRANSFERRED" || line.status === "CANCELLED") return null;
  let since: string | null = null;
  for (const jc of line.jobCards ?? []) {
    if (jc.status !== "COMPLETED" || !jc.completedDate || jc.departmentCode === line.currentDepartment) continue;
    const d = jc.completedDate.slice(0, 10);
    if (!since || d > since) since = d;
  }
  if (!since && line.startDate) since = line.startDate.slice(0, 10);
  if (!since || !/^\d{4}-\d{2}-\d{2}$/.test(since)) return null;
  return Math.max(0, Math.round(dayNo(todayYmd) - dayNo(since)));
}
