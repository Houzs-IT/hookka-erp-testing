// Home Employees v3 · Labour cost card and its "By department and person" sheet. Visual source: the approved Home Employees v3
// HTML. Data and rules: the desktop LabourSplitCard (emp-labour.ts) over the payroll months of the period — never the design's
// sample split. Payroll access only (the card is not drawn without it, as on the desktop).
import { useMemo, type CSSProperties } from "react";
import { Wallet } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { M } from "../../theme";
import { periodLabel } from "../../../dashboards/dashboard-shared-lib";
import { TNUM } from "./home-style";
import { BLUE, ECardG, MorePill, ROW_DIV, TBox, THead, TRow } from "./emp-glass";
import { tint } from "./emp-glass-style";
import { labourLabel, share } from "./emp-labour";
import type { EmpModel } from "./emp-model";

const GOLD = "#C9A24B";
const STATUS_TONE = { running: "#5B6675", draft: "#9C6F1E", approved: "#4F7C3A" } as const;

function Side({ label, color, value, pct, perPerson, ofRevenue, rows }: { label: string; color: string; value: string; pct: string; perPerson: string; ofRevenue: string; rows: [string, string][] }) {
  const cell = (k: string, v: string) => (
    <div style={{ minWidth: 0, padding: "6px 8px", borderRadius: 8, background: tint("#C9A961", 6) }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: M.muted }}>{k}</div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: M.raisin, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", ...TNUM }}>{v}</div>
    </div>
  );
  return (
    <div style={{ minWidth: 0, padding: 12, borderRadius: 14, background: M.card, boxShadow: `0 0 0 1px ${M.hairline}, 0 8px 18px -14px rgba(107,92,50,.35)` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span aria-hidden="true" style={{ width: 9, height: 9, flex: "none", borderRadius: 2, background: color }} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3, color: M.taupe, textTransform: "uppercase" }}>{label}</span>
        <span style={{ flex: "none", fontSize: 13, fontWeight: 800, color: M.raisin, ...TNUM }}>{pct}</span>
      </div>
      <div style={{ fontSize: 18, lineHeight: "24px", fontWeight: 800, color: M.raisin, marginTop: 4, ...TNUM }}>{value}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 6, marginTop: 8 }}>
        {cell("AVG / PERSON", perPerson)}{cell("OF PROD. REVENUE", ofRevenue)}
      </div>
      <div style={{ display: "grid", gap: 3, marginTop: 8, fontSize: 11.5, color: M.ink, ...TNUM }}>
        {rows.map(([k, v]) => <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><span style={{ minWidth: 0 }}>{k}</span><span style={{ flex: "none" }}>{v}</span></div>)}
      </div>
    </div>
  );
}

export function LabourCard({ m, style }: { m: EmpModel; style?: CSSProperties }) {
  const s = m.labourSplit;
  if (!m.canSalary || !s.show) return null;
  const { t } = s;
  const rm = m.rm;
  const fte = m.periodTotals.fte;
  // Both sides over the same full-time people, so they add up to the Avg labour cost / person tile (desktop rule).
  const perPerson = (sen: number) => (fte > 0 ? rm(sen / fte) : "—");
  const revenue = m.revStatus === "ready" ? m.periodTotals.revenue : null;
  const ofRevenue = (sen: number) => (revenue != null && revenue > 0 ? share(sen, revenue) : m.revStatus === "denied" ? "No access" : m.revStatus === "loading" ? "…" : "—");
  const st = STATUS_TONE[s.status.tone];
  return (
    <ECardG icon={Wallet} title={`Labour cost · ${periodLabel(m.period)}`} sub="Direct labour (outsource included) vs non-production labour" divider label="Labour cost" style={style}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 24, lineHeight: "30px", fontWeight: 800, letterSpacing: -0.5, color: M.raisin, ...TNUM }}>{rm(t.totalSen)}</div>
          {revenue != null && revenue > 0 ? <div style={{ fontSize: 12, color: M.ink, marginTop: 1 }}>{share(t.totalSen, revenue)} of production revenue</div> : null}
        </div>
        <span style={{ height: 24, display: "inline-flex", alignItems: "center", padding: "0 10px", borderRadius: 999, background: tint(st, 12), color: st, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{s.status.text}</span>
      </div>
      <div role="img" aria-label={`Direct ${s.directPct.toFixed(1)} percent, non-production ${(100 - s.directPct).toFixed(1)} percent`}
        style={{ display: "flex", gap: 2, height: 10, marginTop: 12, borderRadius: 999, overflow: "hidden", background: `color-mix(in srgb, ${M.divider} 80%, transparent)` }}>
        <span style={{ width: `${s.directPct}%`, background: BLUE }} /><span style={{ width: `${100 - s.directPct}%`, background: GOLD }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 8, marginTop: 12 }}>
        <Side label="Direct labour" color={BLUE} value={rm(t.directSen)} pct={share(t.directSen, t.totalSen)} perPerson={perPerson(t.directSen)} ofRevenue={ofRevenue(t.directSen)}
          rows={[["Own production staff", rm(t.directSen - t.outsourceSen)], ...s.outsourceDepts.map(([code, sen]) => [`Outsource · ${labourLabel(code)}`, rm(sen)] as [string, string])]} />
        <Side label="Non-production labour" color={GOLD} value={rm(t.nonProductionSen)} pct={share(t.nonProductionSen, t.totalSen)} perPerson={perPerson(t.nonProductionSen)} ofRevenue={ofRevenue(t.nonProductionSen)}
          rows={[...s.nonProd.map(([code, sen]) => [labourLabel(code), rm(sen)] as [string, string]), ...(t.underRecordedSen !== 0 ? [["Paid, hours not logged", rm(t.underRecordedSen)] as [string, string]] : [])]} />
      </div>
      <MorePill label="By department and person" onClick={() => m.open({ type: "labour" })} top={12} />
    </ECardG>
  );
}

const DG = "minmax(0,1fr) 40px 86px 46px";
const PG = "minmax(0,1fr) 72px 64px 78px";
type WorkerLite = { id: string; name?: string | null; departmentCode?: string | null };

/** "By department and person" (desktop modal): every home department, then every payslip. */
export function LabourSheetBody({ m }: { m: EmpModel }) {
  const s = m.labourSplit;
  // Names: the workers list useLabourCost already read (same cached request), then the feed's workers.
  const wk = useCachedJson<{ data?: WorkerLite[] }>(m.canSalary ? "/api/workers" : null);
  const nameOf = useMemo(() => {
    const out = new Map<string, { name: string; dept: string | null }>();
    for (const w of m.employee.workers) out.set(w.id, { name: w.name ?? w.id, dept: w.dept });
    for (const w of wk.data?.data ?? []) out.set(w.id, { name: w.name ?? out.get(w.id)?.name ?? w.id, dept: w.departmentCode ?? out.get(w.id)?.dept ?? null });
    return out;
  }, [m.employee.workers, wk.data]);
  const rm = m.rm;
  const { t } = s;
  return (
    <>
      <TBox top={0} r={14}>
        <THead grid={DG} pad="9px 12px" gap={8} cols={["Home department", "People", "Cost", "Share"]} />
        {s.depts.map(([code, d], i) => (
          <TRow key={code} grid={DG} first={i === 0} pad="9px 12px" gap={8}>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontWeight: 600, color: M.raisin }}>{labourLabel(code)}</span>
              <span style={{ display: "block", fontSize: 11, color: M.muted, marginTop: 1 }}>Outsource {d.outsourceSen ? rm(d.outsourceSen) : "—"}</span>
            </span>
            <span style={{ textAlign: "right", color: M.ink }}>{d.workers.toLocaleString("en-MY")}</span>
            <span style={{ textAlign: "right", fontWeight: 700, color: M.raisin, whiteSpace: "nowrap" }}>{rm(d.costSen)}</span>
            <span style={{ textAlign: "right", color: M.ink }}>{share(d.costSen, t.totalSen)}</span>
          </TRow>
        ))}
      </TBox>
      <TBox top={14} r={14}>
        <THead grid={PG} pad="9px 12px" cols={["Person", "Direct", "Non-prod.", "Total"]} />
        {s.staff.map(([id, r], i) => {
          const p = nameOf.get(id);
          return (
            <TRow key={id} grid={PG} first={i === 0} pad="9px 12px" fontSize={12} borderTop={i ? `1px solid ${ROW_DIV}` : "none"}>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontWeight: 600, color: M.raisin, overflowWrap: "anywhere" }}>{p?.name ?? id}</span>
                <span style={{ display: "block", fontSize: 11, color: M.muted, marginTop: 1 }}>{p?.dept ? labourLabel(p.dept) : "—"}</span>
              </span>
              <span style={{ textAlign: "right", color: M.raisin, whiteSpace: "nowrap" }}>{rm(r.directSen)}</span>
              <span style={{ textAlign: "right", color: M.muted, whiteSpace: "nowrap" }}>{r.nonProductionSen ? rm(r.nonProductionSen) : "—"}</span>
              <span style={{ textAlign: "right", fontWeight: 700, color: M.raisin, whiteSpace: "nowrap" }}>{rm(r.costSen)}</span>
            </TRow>
          );
        })}
      </TBox>
    </>
  );
}
