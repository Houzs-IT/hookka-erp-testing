// Home Employees v3 · the cream-headed tables shared by the cards and their sheets (department efficiency, workers, non-production).
// Visual source: the approved Home Employees v3 HTML. Every figure comes from emp-lib / emp-rows (the desktop's maths).
import { M } from "../../theme";
import { RED } from "../../../dashboards/dashboard-shared-lib";
import { deptName } from "../../../dashboards/ops-floor-lib";
import { NameCell, Num, OutBar, RankDot, ROW_DIV, TBox, THead, TRow } from "./emp-glass";
import { TOTAL_BG, WASH, medal } from "./emp-glass-style";
import { costCentreName, effColor, floorSet, hrs, kfmt, NP_SHADE_SHARE, overallText, pct, pctOf, poolEff, ratio, rowEff, loggedUnder, type DeptRow, type Row } from "./emp-lib";
import { labourPctText } from "./emp-rows";
import type { EmpModel } from "./emp-model";

const MUTED_NAME = "#9A9082";
const SOFT_RAIL = "#C9BFAE";

// ---------------------------------------------------------------------------
// Department efficiency: Department · Eff. · Output (Bedframe / Sofa / Accessory bar) · Labour (% + RM)
// ---------------------------------------------------------------------------
type DeptLike = Pick<DeptRow, "people" | "work" | "prod" | "hw" | "hp" | "cost" | "bf" | "sofa" | "acc"> & { dept?: string };

export function DeptTable({ m, rows, total }: { m: EmpModel; rows: DeptRow[]; total: DeptLike | null }) {
  const sal = m.canSalary;
  const grid = sal ? "minmax(0,1fr) 50px 84px 58px" : "minmax(0,1fr) 50px 84px";
  const out = (sen: number) => (m.outStatus === "ready" ? kfmt(sen) : m.outText(sen));
  const labK = (sen: number) => (m.salaryStatus === "ready" ? kfmt(sen) : m.salaryText(sen));
  const floor = floorSet();
  const line = (r: DeptLike, isT: boolean, i: number) => {
    const v = poolEff(r);
    const code = r.dept ?? "";
    const fl = isT || floor.has(code);
    const o = r.bf + r.sofa; // sofa already holds accessory (output total = bf + sofa)
    const helpers = overallText(r);
    return (
      <TRow key={isT ? "total" : code} grid={grid} first={i === 0} rail={isT ? undefined : fl ? effColor(v, m.target) : SOFT_RAIL} bg={isT ? TOTAL_BG : undefined}
        borderTop={isT ? `1.5px solid ${M.hairline}` : undefined} onTap={isT ? undefined : () => m.push({ type: "dept", dept: code })} aria={isT ? undefined : costCentreName(code)}>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 12.5, fontWeight: isT ? 800 : 600, color: fl ? M.raisin : MUTED_NAME, lineHeight: 1.3 }}>{isT ? "Total" : costCentreName(code)}</span>
          <span style={{ display: "block", fontSize: 10.5, lineHeight: 1.35, color: M.muted, marginTop: 1 }}>{r.people.size} ppl<br />{hrs(r.prod)} / {hrs(r.work)}{helpers ? <><br />{helpers}</> : null}</span>
        </span>
        <span style={{ textAlign: "right", fontSize: 12.5, fontWeight: 800, color: fl ? effColor(v, m.target) : M.muted, whiteSpace: "nowrap" }}>{pct(v)}</span>
        <span style={{ minWidth: 0, textAlign: "right" }}>
          <span style={{ display: "block", fontSize: 12, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap" }}>{out(o)}</span>
          <OutBar bf={r.bf} sofa={Math.max(0, r.sofa - r.acc)} acc={r.acc} />
        </span>
        {sal ? (
          <span style={{ textAlign: "right" }}>
            <span style={{ display: "block", fontSize: 12, fontWeight: 700, color: M.taupe, whiteSpace: "nowrap" }}>{labourPctText(m, ratio(r.cost, o))}</span>
            <span style={{ display: "block", fontSize: 10.5, color: M.muted, marginTop: 1, whiteSpace: "nowrap" }}>{labK(r.cost)}</span>
          </span>
        ) : null}
      </TRow>
    );
  };
  return (
    <TBox>
      <THead grid={grid} cols={["Department", "Eff.", "Output", ...(sal ? ["Labour"] : [])]} />
      {rows.map((r, i) => line(r, false, i))}
      {total ? line(total, true, rows.length) : null}
    </TBox>
  );
}

// ---------------------------------------------------------------------------
// Workers: Worker · Working · Prod. · Eff. (ranking card, ranking sheet, department sheet)
// ---------------------------------------------------------------------------
export const WG = "minmax(0,1fr) 58px 58px 52px";
export type WorkerLine = { r: Row; rank?: number; gold?: boolean; rail?: string; bg?: string; s?: string };

function workerSub(m: EmpModel, r: Row) {
  return `${deptName(r.dept)} · ${r.daysWorked} ${r.daysWorked === 1 ? "day" : "days"}${m.canSalary ? ` · ${m.salaryText(r.cost)}` : ""}`;
}
export function WorkerTable({ m, lines, head = "Worker", top }: { m: EmpModel; lines: WorkerLine[]; head?: string; top?: number }) {
  return (
    <TBox top={top}>
      <THead grid={WG} pad="8px 12px" cols={[head, "Working", "Prod.", "Eff."]} />
      {lines.map(({ r, rank, gold, rail, bg, s }, i) => {
        const v = rowEff(r);
        return (
          <TRow key={r.id} grid={WG} first={i === 0} pad="9px 12px" rail={rail} bg={bg} onTap={() => m.push({ type: "worker", id: r.id })} aria={r.name}>
            <NameCell n={r.name} s={s ?? workerSub(m, r)} rank={rank != null ? <RankDot n={String(rank)} m={gold ? medal(rank) : undefined} style={{ marginTop: -2 }} /> : undefined} />
            <Num>{hrs(r.work)}</Num>
            <Num>{hrs(r.prod)}</Num>
            <Num color={effColor(v, m.target)} weight={800}>{pct(v)}</Num>
          </TRow>
        );
      })}
    </TBox>
  );
}


// ---------------------------------------------------------------------------
// Non-production: Worker / Department · Non-prod · % · Clocked
// ---------------------------------------------------------------------------
const NG = "minmax(0,1fr) 56px 50px 56px";
type NpPerson = { id: string; non: number; all: number; days: number };
type NpDept = { dept: string; non: number; all: number; people: number; top: { id: string; non: number } | null };

export function NpTable({ m, people, depts, top }: { m: EmpModel; people?: NpPerson[]; depts?: NpDept[]; top?: number }) {
  const byP = !!people;
  const red = (n: number, a: number) => a > 0 && n / a >= NP_SHADE_SHARE;
  const cells = (non: number, all: number) => {
    const r = red(non, all);
    return (
      <>
        <Num color={RED} weight={800}>{hrs(non)}</Num>
        <Num color={r ? RED : M.ink} weight={r ? 800 : 600}>{pctOf(non, all)}</Num>
        <Num>{hrs(all)}</Num>
      </>
    );
  };
  return (
    <TBox top={top}>
      <THead grid={NG} cols={[byP ? "Worker" : "Department", "Non-prod", "%", "Clocked"]} />
      {byP
        ? people!.map((r, i) => {
          const w = m.workerById.get(r.id);
          const shade = red(r.non, r.all);
          const under = m.canSalary ? loggedUnder(m.hourEntries, m.W.winDates, r.id) || "—" : "needs payroll access";
          return (
            <TRow key={r.id} grid={NG} first={i === 0} rail={shade ? RED : undefined} bg={shade ? WASH.red : undefined} borderTop={i ? `1px solid ${ROW_DIV}` : "none"}>
              <NameCell n={w?.name ?? r.id} s={`${deptName(w?.dept ?? "—")} · ${r.days} ${r.days === 1 ? "day" : "days"}`} s2={`Logged under: ${under}`} rank={<RankDot n={String(i + 1)} size={20} />} />
              {cells(r.non, r.all)}
            </TRow>
          );
        })
        : depts!.map((d, i) => {
          const shade = red(d.non, d.all);
          const topName = d.top && d.top.non > 0 ? `${m.workerById.get(d.top.id)?.name ?? d.top.id} · ${hrs(d.top.non)}` : "";
          return (
            <TRow key={d.dept} grid={NG} first={i === 0} rail={shade ? RED : undefined} bg={shade ? WASH.red : undefined}>
              <NameCell n={deptName(d.dept)} s={`${d.people} ${d.people === 1 ? "person" : "people"} with any`} s2={topName ? `Most: ${topName}` : undefined} />
              {cells(d.non, d.all)}
            </TRow>
          );
        })}
    </TBox>
  );
}
