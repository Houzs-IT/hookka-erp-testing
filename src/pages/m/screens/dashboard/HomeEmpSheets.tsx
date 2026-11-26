// Home Employees v3 · every bottom sheet of the approved HTML, driven by one stack so Back returns to the sheet it came from
// (Department efficiency → Department → Worker → days, Ranking → Worker, Attendance log → Row, Present → punch detail / photo).
// Visual source: the approved Home Employees v3 HTML. Data and rules: emp-lib.ts / emp-labour.ts (the desktop's maths).
import type { ReactNode } from "react";
import { M } from "../../theme";
import { AMBER, RED, periodLabel } from "../../../dashboards/dashboard-shared-lib";
import { deptName } from "../../../dashboards/ops-floor-lib";
import { SheetFrame } from "./home-ui";
import { TNUM } from "./home-style";
import { NoteList } from "./ops-sheet-kit";
import { BLUE, Num, OutLegend, RankDot, SheetChips, SheetEmpty, SheetKpis, SheetPanel, TBox, THead, TRow, type SheetKpi } from "./emp-glass";
import { RAIL, WASH, tint } from "./emp-glass-style";
import { RowList, LegendChip, Segment, type RowSpec } from "./emp-ui";
import { DeptTable, NpTable, WorkerTable } from "./emp-tables";
import { LOW_EFF_MIN_WORK, LOW_EFF_PCT, avatarOf, costCentreName, daysInPeriod, dayLog, dLab, eff, effColor, hLog, hhmm, hrs, lateMin, overallText, pct, pctOf, poolEff, rowEff, type Row } from "./emp-lib";
import { NP_LEGEND, workerRow } from "./emp-rows";
import { NpChart } from "./HomeEmpB";
import { LabourSheetBody } from "./HomeEmpLabour";
import { PresentSheetBody } from "./HomeEmpPresent";
import { presentTitle } from "./emp-present";
import type { EmpModel, LogPick } from "./emp-model";

const Note = ({ children }: { children: ReactNode }) => <NoteList lines={[children]} />;
function KV({ rows }: { rows: [string, string, string?][] }) {
  return (
    <SheetPanel pad="2px 14px" style={{ marginBottom: 10 }}>
      {rows.map(([k, v, c], i) => (
        <div key={k} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, padding: "11px 0", borderTop: i ? `1px solid ${M.divider}` : "none" }}>
          <span style={{ fontSize: 12.5, color: M.ink }}>{k}</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: c ?? M.raisin, textAlign: "right", ...TNUM }}>{v}</span>
        </div>
      ))}
    </SheetPanel>
  );
}
const Rows = ({ rows, empty }: { rows: RowSpec[]; empty?: string }) => (
  rows.length ? <SheetPanel pad="4px 14px"><div style={{ marginTop: -6 }}><RowList rows={rows} /></div></SheetPanel> : empty ? <SheetEmpty>{empty}</SheetEmpty> : null
);
const stPill = (absent: boolean, lm: number) => (absent ? { l: "Not in", bg: "#FBE7E3", fg: RED } : lm > 0 ? { l: `Late ${lm}m`, bg: "#FAEFCB", fg: "#85600F" } : { l: "On time", bg: M.divider, fg: M.ink });

// ---------------------------------------------------------------------------
// The design's ranked table (salary / efficiency by worker, a worker's days): rank chip, name, sub, a bar, 3 numbers, Total row
// ---------------------------------------------------------------------------
type CtRow = { key: string; rank: string; blue?: boolean; n: string; s?: string; bw: string; bc: string; a: string; b: string; bcol?: string; bw8?: boolean; c: string; cc?: string; onTap?: () => void };
function CtTable({ grid, head, rows, tot }: { grid: string; head: string[]; rows: CtRow[]; tot: [string, string, string] }) {
  return (
    <TBox top={0} r={14}>
      <THead grid={grid} pad="9px 12px" cols={head} />
      {rows.map((t, i) => (
        <TRow key={t.key} grid={grid} first={i === 0} pad="10px 12px" onTap={t.onTap} aria={t.n}>
          <span style={{ minWidth: 0, display: "flex", alignItems: "flex-start", gap: 8 }}>
            <RankDot n={t.rank} m={t.blue ? { bg: tint(BLUE, 14), fg: BLUE, sh: "none" } : undefined} />
            <span style={{ minWidth: 0, flex: 1 }}>
              <span style={{ display: "block", fontWeight: 700, color: M.raisin, lineHeight: 1.3 }}>{t.n}</span>
              {t.s ? <span style={{ display: "block", fontSize: 10.5, color: M.muted, marginTop: 1 }}>{t.s}</span> : null}
              <span style={{ display: "block", height: 4, marginTop: 5, borderRadius: 999, background: M.divider, overflow: "hidden" }}><span style={{ display: "block", height: "100%", width: t.bw, borderRadius: 999, background: t.bc }} /></span>
            </span>
          </span>
          <Num>{t.a}</Num>
          <Num color={t.bcol ?? M.raisin} weight={700}>{t.b}</Num>
          <Num color={t.cc ?? M.raisin} weight={800}>{t.c}</Num>
        </TRow>
      ))}
      <div style={{ display: "grid", gridTemplateColumns: grid, gap: 6, alignItems: "center", padding: "10px 12px", background: `color-mix(in srgb, #C9A961 14%, ${M.card})`, borderTop: `1px solid ${M.hairline}`, color: M.taupe, fontSize: 12.5, fontWeight: 700, ...TNUM }}>
        <span style={{ textTransform: "uppercase", letterSpacing: 0.4, fontSize: 11 }}>Total</span>
        <span style={{ textAlign: "right", whiteSpace: "nowrap", color: M.ink }}>{tot[0]}</span>
        <span style={{ textAlign: "right", whiteSpace: "nowrap", color: M.ink }}>{tot[1]}</span>
        <span style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 800, color: M.raisin }}>{tot[2]}</span>
      </div>
    </TBox>
  );
}
const effW = (v: number | null) => `${Math.min(100, Math.round((v ?? 0) / 1.3))}%`;

export function EmpSheets({ m }: { m: EmpModel }) {
  const top = m.stack[m.stack.length - 1];
  const split = m.labourSplit;
  if (!top) return null;
  const W = m.W;
  const frame = (title: string, sub: ReactNode | undefined, body: ReactNode) => (
    <SheetFrame open title={title} sub={sub} onBack={m.stack.length > 1 ? m.back : undefined} onClose={m.close}><div style={{ paddingBottom: 28 }}>{body}</div></SheetFrame>
  );

  if (top.type === "present") {
    const t = presentTitle(m);
    return frame(t.title, t.sub, <PresentSheetBody m={m} />);
  }

  if (top.type === "labour") {
    return frame(`Labour cost · ${periodLabel(m.period)}`, `${m.rm(split.t.totalSen)} · gross pay plus employer EPF, SOCSO and EIS`, <LabourSheetBody m={m} />);
  }

  if (top.type === "tile") {
    const sal = top.kind === "salary";
    const list = [...m.rows].sort((a, b) => (sal ? b.cost - a.cost : (rowEff(a) ?? 0) - (rowEff(b) ?? 0)));
    const ov = poolEff(m.totals);
    const maxC = Math.max(1, ...list.map((r) => r.cost || 0));
    const kpis: SheetKpi[] = sal
      ? [{ k: "Total salary", v: m.salaryText(m.head.winSalary), c: BLUE, full: true }, { k: "Workers", v: String(list.length) }, { k: "Efficiency", v: pct(ov), c: effColor(ov, m.target) }]
      : [{ k: "Overall", v: pct(ov), c: effColor(ov, m.target) }, { k: "Workers", v: String(list.length) }];
    const rows: CtRow[] = list.map((r, i) => {
      const v = rowEff(r);
      const ec = effColor(v, m.target);
      return {
        key: r.id, rank: String(i + 1), blue: sal && i < 3, n: r.name, s: `${deptName(r.dept)} · ${r.daysWorked} ${r.daysWorked === 1 ? "day" : "days"}`,
        bw: sal ? `${Math.round(((r.cost || 0) / maxC) * 100)}%` : effW(v), bc: sal ? BLUE : ec,
        a: hrs(r.work), b: sal ? pct(v) : hrs(r.prod), bcol: sal ? ec : M.raisin, c: sal ? m.salaryText(r.cost) : pct(v), cc: sal ? M.raisin : ec,
        onTap: () => m.push({ type: "worker", id: r.id }),
      };
    });
    const helpers = overallText(m.totals);
    return frame(sal ? `Salary by worker · ${W.label}` : `Efficiency by worker · ${W.label}`, sal ? "From payroll · highest first" : "Production ÷ working hours · lowest first",
      <>
        <SheetKpis items={kpis} />
        {list.length ? <CtTable grid={sal ? "minmax(0,1fr) 46px 46px 86px" : "minmax(0,1fr) 52px 48px 70px"} head={sal ? ["Worker", "Hours", "Eff.", "Salary"] : ["Worker", "Working", "Prod.", "Eff."]} rows={rows}
          tot={sal ? [hrs(m.totals.work), pct(ov), m.salaryText(m.head.winSalary)] : [hrs(m.totals.work), hrs(m.totals.prod), pct(ov)]} /> : <SheetEmpty>No one clocked an hour in this window.</SheetEmpty>}
        <Note>Tap a worker for each day. {sal ? "Highest salary first." : "Lowest efficiency first."}{helpers ? ` Production efficiency leaves helpers out; ${helpers}.` : ""}</Note>
      </>);
  }

  if (top.type === "depts") {
    return frame(`Department efficiency · ${W.label}`, undefined,
      <>
        {m.deptRows.length ? <><DeptTable m={m} rows={m.deptRows} total={m.deptTotal} /><OutLegend /></> : <SheetEmpty>No hours in this window.</SheetEmpty>}
        <Note>Output = Department Revenue: an order’s full value when this department’s last card for it closes (same as Floor Live and Department Revenue). Total = production revenue (the Upholstery row){m.canSalary ? " · labour % = labour ÷ output" : ""}. Tap a department for its workers.</Note>
      </>);
  }

  if (top.type === "dept") {
    const hh = m.hourEntries;
    const logged = new Set(hh.filter((e) => W.winDates.has(e.date) && e.departmentCode === top.dept).map((e) => e.workerId));
    const hours = new Map<string, number>();
    for (const e of hh) if (W.winDates.has(e.date) && e.departmentCode === top.dept) hours.set(e.workerId, (hours.get(e.workerId) ?? 0) + (Number(e.hours) || 0));
    const list = m.rows.filter((r) => r.dept === top.dept || logged.has(r.id)).sort((a, b) => (hours.get(b.id) ?? 0) - (hours.get(a.id) ?? 0));
    return frame(`${costCentreName(top.dept)} · ${W.label}`, "Home department or hours logged here · tap a worker for each day",
      list.length ? <WorkerTable m={m} top={0} lines={list.map((r) => ({ r, rail: effColor(rowEff(r), m.target), s: `Here ${hours.has(r.id) ? `${(hours.get(r.id) ?? 0).toFixed(1)} h` : "—"}${m.canSalary ? ` · ${m.salaryText(r.cost)}` : ""}` }))} />
        : <SheetEmpty>No workers in this window.</SheetEmpty>);
  }

  if (top.type === "worker") {
    const w = m.workerById.get(top.id);
    const r: Row = m.rows.find((x) => x.id === top.id) ?? { id: top.id, name: w?.name ?? top.id, dept: w?.dept ?? "—", work: 0, prod: 0, cost: 0, daysWorked: 0, byDay: [] };
    const days = r.byDay.filter((d) => d.work > 0);
    const rv = rowEff(r);
    const kpis: SheetKpi[] = [{ k: "Days", v: String(r.daysWorked) }, { k: "Working", v: hrs(r.work) }, { k: "Production", v: hrs(r.prod) }, { k: "Efficiency", v: pct(rv), c: effColor(rv, m.target) }, ...(m.canSalary ? [{ k: "Labour", v: m.salaryText(r.cost) }] : [])];
    const rows: CtRow[] = days.map((d) => {
      const v = r.isHelper ? null : eff(d.prod, d.work);
      const ec = effColor(v, m.target);
      return { key: d.date, rank: String(Number(d.date.slice(8, 10))), n: dLab(d.date), s: m.canSalary ? `Labour ${m.salaryText(d.cost)}` : undefined, bw: effW(v), bc: ec, a: hrs(d.work), b: hrs(d.prod), c: pct(v), cc: ec };
    });
    return frame(`${r.name} · ${deptName(r.dept)}`, `${W.label}${r.isHelper ? " · helper: left out of production efficiency" : ""}`,
      <>
        <SheetKpis items={kpis} />
        {rows.length ? <CtTable grid="minmax(0,1fr) 52px 48px 70px" head={["Day", "Working", "Prod.", "Eff."]} rows={rows} tot={[hrs(r.work), hrs(r.prod), pct(rv)]} /> : <SheetEmpty>No days in this window.</SheetEmpty>}
      </>);
  }

  if (top.type === "rank") {
    const up = top.half === "upper";
    const { split: sp } = m;
    const list = up ? sp.upper : sp.lower;
    const note = [sp.unranked.length ? `${sp.unranked.length} with under an hour clocked are not ranked.` : "", sp.outsourcedRows.length ? `Outsourced, not ranked or counted as people: ${sp.outsourcedRows.map((r) => r.name).join(", ")}.` : ""].filter(Boolean).join(" ");
    return frame(up ? `Upper half · ${sp.upper.length} workers` : `Lower half · ${sp.lower.length} workers · needs attention`,
      `Ranked by efficiency over ${W.label}; tap a worker for each day’s hours${m.canSalary ? ", efficiency and salary" : " and efficiency"}.`,
      <>
        <div style={{ marginBottom: 10 }}>
          <Segment h={36} aria="Ranking half" value={top.half} options={[["upper", `Upper half · ${sp.upper.length}`], ["lower", `Lower half · ${sp.lower.length}`]] as const}
            onChange={(k) => { m.setRkHalf(k); m.replaceTop({ type: "rank", half: k }); }} />
        </div>
        {list.length ? <WorkerTable m={m} top={0} lines={list.map((r, i) => {
          const hot = up ? i < 3 : i >= list.length - 3;
          return { r, rank: (up ? 0 : sp.half) + i + 1, gold: up, rail: hot ? (up ? RAIL.green : RAIL.red) : undefined, bg: hot ? (up ? WASH.green : WASH.red) : undefined };
        })} /> : <SheetEmpty>No one clocked an hour in this window.</SheetEmpty>}
        {note ? <Note>{note}</Note> : null}
      </>);
  }

  if (top.type === "np") {
    const { np, npView, npHide } = m;
    const byP = npView === "people";
    const kpis: SheetKpi[] = [{ k: "Non-prod", v: hrs(np.total), c: RED }, { k: "% of clocked", v: pctOf(np.total, np.clocked) }, { k: "People with any", v: String(np.people.length) }];
    const none = (byP ? np.people : np.depts).length === 0;
    return frame(`Non-production hours · ${W.label}`,
      `Clocked but logged outside the production departments (R&D, warehousing, repair …) · ${hrs(np.total)} = ${pctOf(np.total, np.clocked)} of ${hrs(np.clocked)} clocked`,
      <>
        <div style={{ marginBottom: 10 }}>
          <Segment h={36} aria="Non-production view" value={npView} onChange={m.setNpView} options={[["people", "By person"], ["dept", "By department"]] as const} />
        </div>
        {m.npPoints.length ? (
          <SheetPanel pad={12} style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {NP_LEGEND.map(([k, l, c, h]) => <LegendChip key={k} label={l} color={c} h={h} on={!npHide[k]} onToggle={() => m.setNpHide((x) => ({ ...x, [k]: !x[k] }))} />)}
            </div>
            <div role="img" aria-label="Non-production hours per day" style={{ position: "relative", width: "100%", marginTop: 10 }}><NpChart m={m} points={m.npPoints} /></div>
          </SheetPanel>
        ) : null}
        <SheetKpis items={kpis} />
        {none ? <SheetEmpty>No non-production hours in this window.</SheetEmpty> : <NpTable m={m} top={0} people={byP ? np.people : undefined} depts={byP ? undefined : np.depts} />}
        {none ? null : (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, padding: "0 4px", fontSize: 11, color: M.ink }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: WASH.red, boxShadow: `inset 3px 0 0 ${RED}` }} />20% or more of clocked time was non-production
          </div>
        )}
        <Note>Rows shaded red: 20% or more of the person’s clocked time was non-production. “Logged under” needs payroll access (it reads the hour entries).</Note>
      </>);
  }

  if (top.type === "lowEff") {
    const { rows: low, considered, overall } = m.lowEff;
    const list: RowSpec[] = low.map((r, i) => {
      const row: Row = { id: r.id, name: r.name, dept: r.dept ?? "", work: r.work, prod: r.prod, cost: 0, daysWorked: 1, byDay: [] };
      return { ...workerRow(m, row, i, null), onTap: undefined, lines: [`${r.dept ? deptName(r.dept) : "—"} · production ${hrs(r.prod)} / working ${hrs(r.work)}`] };
    });
    return frame(`Workers under ${LOW_EFF_PCT}% · ${dLab(top.date)}`,
      `${low.length} of ${considered} people · helpers left out · at least ${LOW_EFF_MIN_WORK} min working · overall ${pct(overall)}`,
      <>
        {low.length === 0 ? <div role="status" style={{ marginBottom: 10, padding: "10px 12px", borderRadius: 12, background: tint("#4F7C3A", 12), color: "#4F7C3A", fontSize: 13, fontWeight: 700 }}>No one is under {LOW_EFF_PCT}% on {dLab(top.date)}.</div> : null}
        <Rows rows={list} empty={considered === 0 ? "No working hours recorded on this day." : undefined} />
        <Note>Efficiency = production ÷ working minutes of that day. Lowest first. Same rule as the Today’s problems Efficiency tile.</Note>
      </>);
  }

  if (top.type === "log") {
    const month = m.logPick === "month";
    const chips = [["today", "Today"], ["yday", "Yesterday"], ["month", "This month"]] as const;
    let rows: RowSpec[] = [];
    if (month && m.monthL) {
      rows = m.monthL.rows.map((r) => ({
        key: r.id, av: avatarOf(r.name), title: r.name, lines: [`${r.dept ? deptName(r.dept) : "—"} · ${r.daysIn} days in · ${r.notIn} not in · late ${r.late}× (${r.lateMin}m)`],
        pill: r.notIn > 0 ? { l: `${r.notIn} day${r.notIn > 1 ? "s" : ""} not in`, bg: "#FBE7E3", fg: RED } : r.late > 0 ? { l: `Late ${r.late}×`, bg: "#FAEFCB", fg: "#85600F" } : { l: "Every day on time", bg: M.divider, fg: M.ink },
        onTap: () => m.push({ type: "logm", id: r.id }),
      }));
    } else if (m.dayL && m.logDay) {
      const day = m.logDay;
      rows = m.dayL.rows.map((r) => ({
        key: r.key, av: avatarOf(r.name), title: r.name, lines: [r.absent ? `${r.dept ? deptName(r.dept) : "—"} · no clock-in` : `${r.dept ? deptName(r.dept) : "—"} · ${hhmm(r.clockIn)} – ${hhmm(r.clockOut)}`],
        pill: stPill(r.absent, r.absent ? 0 : r.late), onTap: () => m.push({ type: "logRow", id: r.id, name: r.name, date: day }),
      }));
    }
    const sub = month && m.monthL ? `${m.monthYm} · ${m.monthL.workDays} working days so far · most absent first, then most late` : m.dayL && m.logDay ? `${dLab(m.logDay)} · ${m.dayL.absent} not in · ${m.dayL.late} late · not in first, late second, on time last` : "";
    return frame("Attendance log", sub, (
      <>
        <SheetChips options={chips} value={m.logPick} onChange={(k) => m.setLogPick(k as LogPick)} />
        {!month && m.dayL && m.logDay && m.dayL.absent === 0 && rows.length > 0 ? (
          <div role="status" style={{ marginBottom: 10, padding: "10px 12px", borderRadius: 12, background: tint("#4F7C3A", 12), color: "#4F7C3A", fontSize: 13, fontWeight: 700 }}>All {m.dayL.on + m.dayL.late} in on {dLab(m.logDay)}: no one is absent.</div>
        ) : null}
        <Rows rows={rows} empty="No attendance recorded in this period." />
        <Note>Tap the lit chip again to return to {dLab(W.anchor || m.today)} (the day picked above).</Note>
      </>
    ));
  }

  if (top.type === "logRow") {
    const row = dayLog(m.employee, top.date).rows.find((r) => (top.id ? r.id === top.id : r.name === top.name));
    const lm = row && !row.absent ? lateMin(row.clockIn) : 0;
    const sp = stPill(!row || row.absent, lm);
    const ev = row?.eff ?? null;
    return frame(top.name, `${row?.dept ? deptName(row.dept) : "—"} · ${dLab(top.date)}`, (
      <KV rows={[
        ["Date", dLab(top.date)], ["Clock in", hhmm(row?.clockIn ?? null)], ["Clock out", hhmm(row?.clockOut ?? null)],
        ["Hours worked", hLog(row?.working ?? null)], ["Earned time", hLog(row?.prod ?? null)], ["Non-prod hours", hLog(row?.nonProd ?? null)],
        ["Efficiency", ev == null ? "—" : `${ev.toFixed(1)}%`, ev == null ? M.muted : ev >= 90 ? "#4F7C3A" : "#B5701A"],
        ["Total days", top.id ? String(daysInPeriod(m.employee, top.id, m.period)) : "—"], ["Status", sp.l, sp.fg],
      ]} />
    ));
  }

  // logm
  const r = m.monthL?.rows.find((x) => x.id === top.id);
  if (!r) return frame("Attendance log", undefined, <SheetEmpty>No data.</SheetEmpty>);
  return frame(r.name, `This month · ${m.monthYm}`, (
    <KV rows={[["Department", r.dept ? deptName(r.dept) : "—"], ["Days in", String(r.daysIn)], ["Not in", String(r.notIn), r.notIn ? RED : undefined], ["Times late", String(r.late), r.late ? AMBER : undefined], ["Minutes late", `${r.lateMin}m`]]} />
  ));
}

