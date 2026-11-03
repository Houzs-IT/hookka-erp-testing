// Employees > Payroll header (HK-0125): the latest payroll run's totals and
// its cost per department. Reads the same /api/payslips payload the Payroll
// list below it shows, so the totals are the sum of those rows.
import { useCachedJson } from "@/lib/cached-fetch";
import { M } from "../theme";
import { money, num, str } from "../config/helpers";
import { latestPayslips, PAYSLIPS_URL } from "../config/payroll";

type RawRow = Record<string, unknown>;

export function EmployeesPayrollPanel() {
  const { data } = useCachedJson<{ data?: RawRow[] }>(PAYSLIPS_URL);
  const { period, rows } = latestPayslips(Array.isArray(data?.data) ? data.data : []);
  if (!period) return null;

  const employer = (r: RawRow) => num(r, "epfEmployer") + num(r, "socsoEmployer") + num(r, "eisEmployer");
  const gross = rows.reduce((s, r) => s + num(r, "grossPay"), 0);
  const net = rows.reduce((s, r) => s + num(r, "netPay"), 0);
  const cost = rows.reduce((s, r) => s + num(r, "grossPay") + employer(r), 0);

  const byDept = new Map<string, { people: number; cost: number }>();
  for (const r of rows) {
    const d = str(r, "departmentCode") || "UNASSIGNED";
    const e = byDept.get(d) ?? { people: 0, cost: 0 };
    e.people += 1;
    e.cost += num(r, "grossPay") + employer(r);
    byDept.set(d, e);
  }
  const depts = [...byDept.entries()].sort((a, b) => b[1].cost - a[1].cost);

  return (
    <div style={{ background: M.card, border: `1px solid ${M.border}`, borderRadius: 15, padding: "12px 14px", marginBottom: 4 }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: M.muted }}>
        Payroll · {period} · {rows.length} people
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 9 }}>
        {([
          ["Gross", gross],
          ["Net pay", net],
          ["Cost to company", cost],
        ] as [string, number][]).map(([l, v]) => (
          <div key={l} style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, color: M.faint, fontWeight: 700 }}>{l}</div>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: M.ink, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{money(v)}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 10, color: M.faint, marginTop: 6 }}>Cost to company = gross + employer EPF, SOCSO and EIS.</div>
      <div style={{ borderTop: `1px solid ${M.divider}`, marginTop: 10, paddingTop: 6 }}>
        {depts.map(([d, e]) => (
          <div key={d} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "5px 0", fontSize: 12.5 }}>
            <span style={{ color: M.ink }}>
              {d}
              <span style={{ color: M.faint }}> · {e.people}</span>
            </span>
            <span style={{ fontWeight: 700, color: M.taupe, fontVariantNumeric: "tabular-nums" }}>{money(e.cost)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
