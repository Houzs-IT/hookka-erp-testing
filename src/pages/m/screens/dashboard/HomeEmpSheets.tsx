// Home Employees · every bottom sheet of the approved HTML, driven by one stack so Back returns to the sheet it came from
// (Department efficiency → Department → Worker → days, Ranking → Worker, Attendance log → Row). The view switcher
// sheet is the shared Home one (HomeDashboard).
import type { ReactNode } from "react";
import { M } from "../../theme";
import { AMBER, RED } from "../../../dashboards/dashboard-shared-lib";
import { deptName } from "../../../dashboards/ops-floor-lib";
import { SheetFrame } from "./home-ui";
import { TNUM } from "./home-style";
import { Empty, LegendChip, RowList, Segment, type RowSpec } from "./emp-ui";
import { sheetCard as sheetPanel } from "./ops-style";
import { avatarOf, costCentreName, daysInPeriod, dayLog, dLab, eff, effColor, hLog, hhmm, hrs, lateMin, pct, pctOf, type Row } from "./emp-lib";
import { NP_LEGEND, deptRow, npDeptRow, npPersonRow, workerRow } from "./emp-rows";
import { NpChart } from "./HomeEmpB";
import type { EmpModel, LogPick } from "./emp-model";

const Note = ({ children }: { children: ReactNode }) => <div style={{ fontSize: 11, lineHeight: 1.45, color: M.muted, marginTop: 10 }}>{children}</div>;
const Panel = ({ rows, empty }: { rows: RowSpec[]; empty?: string }) => (
  rows.length ? <div style={{ ...sheetPanel, padding: "4px 14px" }}><div style={{ marginTop: -6 }}><RowList rows={rows} /></div></div>
    : empty ? <div style={{ ...sheetPanel, padding: 16, textAlign: "center", fontSize: 13, color: M.muted }}>{empty}</div> : null
);
function KV({ rows }: { rows: [string, string, string?][] }) {
  return (
    <div style={{ ...sheetPanel, padding: "2px 14px", marginBottom: 10 }}>
      {rows.map(([k, v, c], i) => (
        <div key={k} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, padding: "11px 0", borderTop: i ? `1px solid ${M.divider}` : "none" }}>
          <span style={{ fontSize: 12.5, color: M.ink }}>{k}</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: c ?? M.raisin, textAlign: "right", ...TNUM }}>{v}</span>
        </div>
      ))}
    </div>
  );
}
const stPill = (absent: boolean, lm: number) => (absent ? { l: "Not in", bg: "#FBE7E3", fg: RED } : lm > 0 ? { l: `Late ${lm}m`, bg: "#FAEFCB", fg: "#85600F" } : { l: "On time", bg: M.divider, fg: M.ink });

export function EmpSheets({ m }: { m: EmpModel }) {
  const top = m.stack[m.stack.length - 1];
  if (!top) return null;
  const W = m.W;
  const frame = (title: string, sub: ReactNode | undefined, body: ReactNode) => (
    <SheetFrame open title={title} sub={sub} onBack={m.stack.length > 1 ? m.back : undefined} onClose={m.close}>{body}</SheetFrame>
  );

  if (top.type === "tile") {
    const sal = top.kind === "salary";
    const list = [...m.rows].sort((a, b) => (sal ? b.cost - a.cost : (eff(a.prod, a.work) ?? 0) - (eff(b.prod, b.work) ?? 0)));
    const rows = list.map((r, i) => {
      const x = workerRow(m, r, i, null);
      if (sal) { x.right = m.salaryText(r.cost); x.rc = M.raisin; x.lines = [`${deptName(r.dept)} · ${r.daysWorked} days · working ${hrs(r.work)} · production ${hrs(r.prod)} · ${pct(eff(r.prod, r.work))}`]; }
      return x;
    });
    return frame(sal ? `Salary by worker · ${W.label}` : `Efficiency by worker · ${W.label}`,
      sal ? `Total ${m.salaryText(m.head.winSalary)} · Labor Cost rate` : `Overall ${pct(eff(m.totals.prod, m.totals.work))} · production ÷ working hours`,
      <><Panel rows={rows} empty="No one clocked an hour in this window." /><Note>Tap a worker for each day. {sal ? "Highest salary first." : "Lowest efficiency first."}</Note></>);
  }

  if (top.type === "depts") {
    const t = m.deptTotal;
    const tv = eff(t.prod, t.work);
    const total: RowSpec = { key: "total", title: "Total", bar: { w: `${(Math.min(tv ?? 0, 130) / 130) * 100}%`, t: `${(Math.min(m.target, 130) / 130) * 100}%`, c: effColor(tv, m.target) }, bg: M.paper, rad: 10, right: pct(tv), rc: effColor(tv, m.target),
      lines: [`${t.people.size} people · ${hrs(t.prod)} / ${hrs(t.work)} · output ${m.outText(t.bf + t.sofa)}`] };
    const rows = [total, ...m.deptRows.map((r) => deptRow(m, r, false))];
    return frame("Department efficiency", `${W.label} · ${t.people.size} people`,
      <><Panel rows={m.deptRows.length ? rows : []} empty="No hours in this window." /><Note>Non-production cost centres (warehousing, R&amp;D, repair …) are listed after the production departments, in grey.</Note></>);
  }

  if (top.type === "dept") {
    const hh = m.hourEntries;
    const logged = new Set(hh.filter((e) => W.winDates.has(e.date) && e.departmentCode === top.dept).map((e) => e.workerId));
    const hours = new Map<string, number>();
    for (const e of hh) if (W.winDates.has(e.date) && e.departmentCode === top.dept) hours.set(e.workerId, (hours.get(e.workerId) ?? 0) + (Number(e.hours) || 0));
    const list = m.rows.filter((r) => r.dept === top.dept || logged.has(r.id)).sort((a, b) => (hours.get(b.id) ?? 0) - (hours.get(a.id) ?? 0));
    const rows: RowSpec[] = list.map((r) => {
      const v = eff(r.prod, r.work);
      const w = workerRow(m, r, 0, null);
      return { ...w, bar: w.bar, lines: [`Home dept ${deptName(r.dept)} · hours logged here ${hours.has(r.id) ? `${(hours.get(r.id) ?? 0).toFixed(1)} h` : "—"}`, `Working ${hrs(r.work)} · production ${hrs(r.prod)}${m.canSalary ? ` · salary ${m.salaryText(r.cost)}` : ""}`], right: pct(v), rc: effColor(v, m.target), rank: undefined };
    });
    return frame(`${costCentreName(top.dept)} · ${W.label}`, "Home department or hours logged here · tap a worker for each day", <Panel rows={rows} empty="No workers in this window." />);
  }

  if (top.type === "worker") {
    const w = m.workerById.get(top.id);
    const r: Row = m.rows.find((x) => x.id === top.id) ?? { id: top.id, name: w?.name ?? top.id, dept: w?.dept ?? "—", work: 0, prod: 0, cost: 0, daysWorked: 0, byDay: [] };
    const rows: RowSpec[] = r.byDay.filter((d) => d.work > 0).map((d) => {
      const v = eff(d.prod, d.work);
      return { key: d.date, title: dLab(d.date), lines: [`Working ${hrs(d.work)} · production ${hrs(d.prod)}${m.canSalary ? ` · salary ${m.salaryText(d.cost)}` : ""}`], right: pct(v), rc: effColor(v, m.target) };
    });
    return frame(`${r.name} · ${deptName(r.dept)}`, `${W.label} · ${r.daysWorked} days · efficiency ${pct(eff(r.prod, r.work))}`, <Panel rows={rows} empty="No days in this window." />);
  }

  if (top.type === "rank") {
    const up = top.half === "upper";
    const { split } = m;
    const list = up ? split.upper : split.lower;
    const note = [split.unranked.length ? `${split.unranked.length} with under an hour clocked are not ranked.` : "", split.outsourcedRows.length ? `Outsourced, not ranked or counted as people: ${split.outsourcedRows.map((r) => r.name).join(", ")}.` : ""].filter(Boolean).join(" ");
    return frame(up ? `Upper half · ${split.upper.length} workers` : `Lower half · ${split.lower.length} workers · needs attention`,
      `Ranked by efficiency over ${W.label}; tap a worker for each day’s hours${m.canSalary ? ", efficiency and salary" : " and efficiency"}.`,
      <>
        <div style={{ marginBottom: 10 }}>
          <Segment h={36} aria="Ranking half" value={top.half} options={[["upper", `Upper half · ${split.upper.length}`], ["lower", `Lower half · ${split.lower.length}`]] as const}
            onChange={(k) => { m.setRkHalf(k); m.replaceTop({ type: "rank", half: k }); }} />
        </div>
        <Panel rows={list.map((r, i) => workerRow(m, r, i, up ? 0 : split.half))} empty="No one clocked an hour in this window." />
        {note ? <Note>{note}</Note> : null}
      </>);
  }

  if (top.type === "np") {
    const { np, npView, npHide } = m;
    const byP = npView === "people";
    const rows = (byP ? np.people.map((r, i) => npPersonRow(m, r, i)) : np.depts.map((d) => npDeptRow(m, d))).map((r) => ({ ...r, onTap: undefined }));
    return frame(`Non-production hours · ${W.label}`,
      `Clocked but logged outside the production departments (R&D, warehousing, repair …) · ${hrs(np.total)} = ${pctOf(np.total, np.clocked)} of ${hrs(np.clocked)} clocked`,
      <>
        {m.npPoints.length ? (
          <div style={{ ...sheetPanel, padding: 12, marginBottom: 10 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {NP_LEGEND.map(([k, l, c, h]) => <LegendChip key={k} label={l} color={c} h={h} on={!npHide[k]} onToggle={() => m.setNpHide((x) => ({ ...x, [k]: !x[k] }))} />)}
            </div>
            <div role="img" aria-label="Non-production hours per day" style={{ position: "relative", width: "100%", marginTop: 10 }}><NpChart m={m} points={m.npPoints} /></div>
          </div>
        ) : null}
        <div style={{ marginBottom: 10 }}>
          <Segment h={36} aria="Non-production view" value={npView} onChange={m.setNpView} options={[["people", "By person"], ["dept", "By department"]] as const} />
        </div>
        <Panel rows={rows} empty="No non-production hours in this window." />
        <Note>Rows shaded red: 20% or more of the person’s clocked time was non-production. “Logged under” needs payroll access (it reads the hour entries).</Note>
      </>);
  }

  if (top.type === "log") {
    const month = m.logPick === "month";
    const chips: [LogPick & string, string][] = [["today", "Today"], ["yday", "Yesterday"], ["month", "This month"]];
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
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          {chips.map(([k, l]) => {
            const on = m.logPick === k;
            return (
              <button key={k} type="button" aria-pressed={on} onClick={() => m.setLogPick(on ? null : k)}
                style={{ flex: "none", height: 32, padding: "0 12px", border: "none", borderRadius: 999, backgroundColor: on ? M.taupe : M.card, color: on ? "#FFFFFF" : "#3A352C", boxShadow: on ? "0 6px 14px -6px rgba(107,92,50,.6)" : "0 1px 2px rgba(31,29,27,.06),0 4px 10px -6px rgba(31,29,27,.16)", fontFamily: "inherit", fontSize: 12.5, fontWeight: on ? 700 : 600, cursor: "pointer", whiteSpace: "nowrap" }}>{l}</button>
            );
          })}
        </div>
        <Panel rows={rows} empty="No attendance recorded in this period." />
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
  if (!r) return frame("Attendance log", undefined, <Empty>No data.</Empty>);
  return frame(r.name, `This month · ${m.monthYm}`, (
    <KV rows={[["Department", r.dept ? deptName(r.dept) : "—"], ["Days in", String(r.daysIn)], ["Not in", String(r.notIn), r.notIn ? RED : undefined], ["Times late", String(r.late), r.late ? AMBER : undefined], ["Minutes late", `${r.lateMin}m`]]} />
  ));
}
