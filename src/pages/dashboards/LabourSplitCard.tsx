import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency, roundSen } from "@/lib/utils";
import type { LabourMonth } from "@/lib/labour-to-date";
import { sumLabourMonths } from "@/lib/labour-to-payroll";
import { DashModal } from "./DashModal";
import { CHART_GOLD, CHART_INK, fmtN } from "./dashboard-shared-lib";
import { deptName } from "./ops-floor-lib";

// ---------------------------------------------------------------------------
// Labour cost (owner 2026-11-06): total labour, split into direct labour
// (outsource included) and non-production labour, each with RM and %. The same
// figures as Costing and the Labor Cost page's Payroll Reconciliation: they all
// come from LabourMonth. Layer 2 lists every department and person.
// ---------------------------------------------------------------------------
type Person = { id: string; name: string | null; dept: string | null; empNo?: string | null };

const rm = (sen: number) => formatCurrency(roundSen(sen));
const COST_CENTRE: Record<string, string> = { WAREHOUSING: "Warehousing", REPAIR: "Repair", MAINTENANCE: "Maintenance", R_AND_D: "R&D", PRODUCTION_SHORTFALL: "Shortfall", OTHER: "Other" };
const labelOf = (code: string) => COST_CENTRE[code] ?? deptName(code);
const share = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "—");

function Side({ label, value, pct, color, children }: { label: string; value: string; pct: string; color: string; children?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg bg-[#F7F4EF] px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color }} />
        <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">{label}</p>
        <span className="ml-auto text-sm font-bold tabular-nums text-[#1F1D1B]">{pct}</span>
      </div>
      <p className="mt-1 text-xl font-bold tabular-nums text-[#1F1D1B] max-sm:text-lg">{value}</p>
      <div className="mt-1 space-y-0.5 text-[11.5px] text-[#6B7280]">{children}</div>
    </div>
  );
}

const Row = ({ k, v }: { k: string; v: number }) => (
  <p className="flex justify-between gap-3"><span className="truncate">{k}</span><span className="shrink-0 tabular-nums">{rm(v)}</span></p>
);

export function LabourSplitCard({ months, label, people, revenueSen }: { months: readonly LabourMonth[]; label: string; people: Person[]; revenueSen: number | null }) {
  const [open, setOpen] = useState(false);
  const t = useMemo(() => sumLabourMonths(months), [months]);
  const nameOf = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const depts = useMemo(() => {
    const m = new Map<string, { workers: number; costSen: number; outsourceSen: number }>();
    for (const mo of months) for (const d of mo.byDept) {
      const r = m.get(d.departmentCode) ?? { workers: 0, costSen: 0, outsourceSen: 0 };
      r.workers = Math.max(r.workers, d.workers);
      r.costSen += d.costSen;
      r.outsourceSen += d.outsourceSen ?? 0;
      m.set(d.departmentCode, r);
    }
    return [...m.entries()].sort((a, b) => b[1].costSen - a[1].costSen);
  }, [months]);
  const outsourceDepts = useMemo(() => depts.filter(([, d]) => d.outsourceSen !== 0).map(([code, d]) => [code, d.outsourceSen] as const), [depts]);
  const nonProd = useMemo(() => {
    const m = new Map<string, number>();
    for (const mo of months) for (const l of mo.split.nonProductionLines ?? []) m.set(l.departmentCode, (m.get(l.departmentCode) ?? 0) + l.sen);
    return [...m.entries()].filter(([, v]) => v !== 0).sort((a, b) => b[1] - a[1]);
  }, [months]);
  const staff = useMemo(() => {
    const m = new Map<string, { costSen: number; directSen: number; nonProductionSen: number }>();
    for (const mo of months) for (const w of mo.workers) {
      const r = m.get(w.id) ?? { costSen: 0, directSen: 0, nonProductionSen: 0 };
      r.costSen += w.costSen; r.directSen += w.directSen; r.nonProductionSen += w.nonProductionSen;
      m.set(w.id, r);
    }
    return [...m.entries()].filter(([, r]) => r.costSen !== 0).sort((a, b) => b[1].costSen - a[1].costSen);
  }, [months]);
  if (months.length === 0 || t.totalSen === 0) return null;

  const running = months.some((m) => !m.finished);
  const directPct = t.totalSen > 0 ? (t.directSen / t.totalSen) * 100 : 0;
  const status = running
    ? { text: "Labour to date · payroll not finished", bg: "#EEF1F4", fg: "#5B6675" }
    : t.draft > 0
      ? { text: `${fmtN(t.draft)} payslips still draft`, bg: "#FBF0DC", fg: "#9C6F1E" }
      : { text: "From approved payroll", bg: "#EEF3E4", fg: "#4F7C3A" };

  return (
    <Card>
      <CardContent className="space-y-3 p-5 max-sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-xs font-semibold text-[#6B7280]">Labour cost · {label}</p>
            <p className="text-3xl font-bold tabular-nums text-[#1F1D1B] max-sm:text-2xl">{rm(t.totalSen)}</p>
            {revenueSen != null && revenueSen > 0 && <p className="text-xs text-[#6B7280]">{share(t.totalSen, revenueSen)} of production revenue</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: status.bg, color: status.fg }}>{status.text}</span>
            <button type="button" onClick={() => setOpen(true)} className="rounded-md border border-[#E2DDD8] bg-white px-2.5 py-1 text-xs font-medium text-[#5A5550] hover:bg-[#F7F5F3]">By department and person ›</button>
          </div>
        </div>
        <div className="flex h-3 overflow-hidden rounded-full bg-[#F0ECE6]" role="img" aria-label={`Direct ${directPct.toFixed(1)} percent, non-production ${(100 - directPct).toFixed(1)} percent`}>
          <div style={{ width: `${directPct}%`, background: CHART_INK }} />
          <div style={{ width: `${100 - directPct}%`, background: CHART_GOLD }} />
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Side label="Direct labour" value={rm(t.directSen)} pct={share(t.directSen, t.totalSen)} color={CHART_INK}>
            <Row k="Own production staff" v={t.directSen - t.outsourceSen} />
            <Row k="Outsource" v={t.outsourceSen} />
            {outsourceDepts.map(([code, sen]) => <Row key={code} k={`  in ${deptName(code)}`} v={sen} />)}
          </Side>
          <Side label="Non-production labour" value={rm(t.nonProductionSen)} pct={share(t.nonProductionSen, t.totalSen)} color={CHART_GOLD}>
            {nonProd.map(([code, sen]) => <Row key={code} k={labelOf(code)} v={sen} />)}
            {t.underRecordedSen !== 0 && <Row k="Paid, hours not logged" v={t.underRecordedSen} />}
          </Side>
        </div>
      </CardContent>
      {open && (
        <DashModal wide title={`Labour cost · ${label}`} subtitle={`${rm(t.totalSen)} · gross pay plus employer EPF, SOCSO and EIS`} onClose={() => setOpen(false)}>
          <div className="max-h-[65vh] space-y-4 overflow-y-auto">
            <table className="w-full text-[12.5px]">
              <thead><tr className="text-left text-[10.5px] uppercase tracking-wide text-[#9CA3AF] shadow-[inset_0_-1px_0_#E2DDD8]"><th className="py-1.5">Home department</th><th className="py-1.5 text-right">People</th><th className="py-1.5 text-right">Of which outsource</th><th className="py-1.5 text-right">Cost</th><th className="py-1.5 text-right">Share</th></tr></thead>
              <tbody>
                {depts.map(([code, d]) => (
                  <tr key={code} className="border-b border-[#F0ECE6]"><td className="py-1.5">{labelOf(code)}</td><td className="py-1.5 text-right tabular-nums text-[#6B7280]">{fmtN(d.workers)}</td><td className="py-1.5 text-right tabular-nums text-[#6B7280]">{d.outsourceSen ? rm(d.outsourceSen) : "—"}</td><td className="py-1.5 text-right tabular-nums font-semibold">{rm(d.costSen)}</td><td className="py-1.5 text-right tabular-nums text-[#6B7280]">{share(d.costSen, t.totalSen)}</td></tr>
                ))}
              </tbody>
            </table>
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px] max-sm:min-w-[520px]">
                <thead><tr className="text-left text-[10.5px] uppercase tracking-wide text-[#9CA3AF] shadow-[inset_0_-1px_0_#E2DDD8]"><th className="py-1.5">Person</th><th className="py-1.5">Home department</th><th className="py-1.5 text-right">Direct</th><th className="py-1.5 text-right">Non-production</th><th className="py-1.5 text-right">Total</th></tr></thead>
                <tbody>
                  {staff.map(([id, r]) => {
                    const p = nameOf.get(id);
                    return (
                      <tr key={id} className="border-b border-[#F0ECE6]"><td className="py-1.5">{p?.name ?? id}</td><td className="py-1.5 text-[#6B7280]">{p?.dept ? labelOf(p.dept) : "—"}</td><td className="py-1.5 text-right tabular-nums">{rm(r.directSen)}</td><td className="py-1.5 text-right tabular-nums text-[#6B7280]">{r.nonProductionSen ? rm(r.nonProductionSen) : "—"}</td><td className="py-1.5 text-right tabular-nums font-semibold">{rm(r.costSen)}</td></tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </DashModal>
      )}
    </Card>
  );
}
