import { useMemo } from "react";
import { useCachedJson } from "@/lib/cached-fetch";
import { deptName } from "./ops-floor-lib";
import { isOutsourced } from "./dashboard-shared-lib";

// "Today's problems" tiles — shared by the desktop strip (ProblemsStrip.tsx)
// and the phone (/m) strip so both say the same thing.
type Feed = {
  production?: {
    overdueByDept?: { department: string; count: number }[];
    orders?: { risk?: string; stagesDone: number; stagesTotal: number; currentDept: string | null }[];
  } | null;
  service?: { cases: { daysOverdue: number }[] } | null;
  employee?: {
    workers?: { id: string; name: string | null; empNo?: string | null; countsToHeadcount: boolean }[];
    attendance?: { employeeId: string | null; date: string | null; clockIn: string | null; clockOut: string | null }[];
    performance?: { byDay?: { date: string; workers?: { workerId: string; workingMinutes: number; productionMinutes: number }[] }[] };
  } | null;
};

export type Tone = "bad" | "warn" | "ok" | "info";
export type Tile = { key: string; tab: string; sub?: string; anchor?: string; value: string; label: string; hint?: string; tone: Tone };

export const TONE: Record<Tone, { bar: string; value: string }> = {
  bad: { bar: "#DC2626", value: "#B91C1C" },
  warn: { bar: "#C9A24B", value: "#9A7B2E" },
  ok: { bar: "#15803D", value: "#15803D" },
  info: { bar: "#6B5C32", value: "#1F1D1B" },
};

const LOW_EFF_PCT = 75;

/** The tiles, shared by the desktop strip and the phone (/m) strip so both say the same thing. */
// Four tiles only (owner 2026-10-17: "show overdue order, 几个人没来, 效率,
// service case overdue"): production orders overdue, people not in on the
// latest attendance day, that day's efficiency, service cases overdue.
export function useProblemTiles(visibleTabs: readonly string[]): Tile[] {
  const { data } = useCachedJson<Feed>("/api/dashboard/prototype");
  return useMemo<Tile[]>(() => {
    if (!data) return [];
    const out: Tile[] = [];
    const prod = data.production;
    // Overdue = past the customer's date AND still being made. An order whose
    // every stage is finished is done on the floor — its status just hasn't
    // been closed — so it is counted apart (owner audit 2026-10-17: 10 of 68).
    if (prod?.orders) {
      const late = prod.orders.filter((o) => o.risk === "critical");
      const done = late.filter((o) => o.stagesTotal > 0 && o.stagesDone >= o.stagesTotal);
      const live = late.filter((o) => !(o.stagesTotal > 0 && o.stagesDone >= o.stagesTotal));
      const by = new Map<string, number>();
      for (const o of live) by.set(o.currentDept ?? "—", (by.get(o.currentDept ?? "—") ?? 0) + 1);
      const worst = [...by.entries()].sort((x, y) => y[1] - x[1])[0];
      out.push({
        key: "overdue", tab: "operations", sub: "overview", anchor: "ops-overdue", value: String(live.length), label: "Production orders overdue",
        hint: [live.length && worst ? `most at ${deptName(worst[0])} (${worst[1]})` : "", done.length ? `+${done.length} finished, not closed` : ""].filter(Boolean).join(" · ") || "none",
        tone: live.length ? "bad" : "ok",
      });
    } else if (prod?.overdueByDept) {
      const n = prod.overdueByDept.reduce((a, d) => a + d.count, 0);
      out.push({ key: "overdue", tab: "operations", sub: "overview", anchor: "ops-overdue", value: String(n), label: "Production orders overdue", tone: n ? "bad" : "ok" });
    }
    const emp = data.employee;
    // Not in: headcount workers (not outsourced, has ever clocked in — a
    // view-only login is not a worker) with no clock record on the latest
    // day anyone clocked in. Same rule as the Employees attendance log.
    if (emp?.attendance && emp.workers) {
      const clocked = emp.attendance.filter((r) => r.date && (r.clockIn || r.clockOut));
      const day = clocked.reduce((m, r) => (r.date! > m ? r.date! : m), "");
      if (day) {
        const ever = new Set(clocked.map((r) => r.employeeId));
        const inDay = new Set(clocked.filter((r) => r.date === day).map((r) => r.employeeId));
        const roster = emp.workers.filter((w) => w.countsToHeadcount && !isOutsourced(w) && ever.has(w.id));
        const absent = roster.filter((w) => !inDay.has(w.id));
        out.push({
          key: "absent", tab: "people", anchor: "emp-attendance", value: `${absent.length}`,
          label: `Not in · ${day.slice(5)}`,
          hint: absent.length ? absent.map((w) => w.name).slice(0, 2).join(", ") + (absent.length > 2 ? ` +${absent.length - 2}` : "") : `all ${roster.length} in`,
          tone: absent.length ? "bad" : "ok",
        });
      }
    }
    const byDay = emp?.performance?.byDay;
    if (byDay && byDay.length) {
      const latest = [...byDay].filter((d) => (d.workers ?? []).some((w) => w.workingMinutes > 0)).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
      if (latest) {
        const ws = latest.workers ?? [];
        const work = ws.reduce((a, w) => a + w.workingMinutes, 0);
        const prodMin = ws.reduce((a, w) => a + w.productionMinutes, 0);
        const eff = work > 0 ? (prodMin / work) * 100 : null;
        const low = ws.filter((w) => w.workingMinutes >= 60 && (w.productionMinutes / w.workingMinutes) * 100 < LOW_EFF_PCT).length;
        out.push({
          key: "eff", tab: "people", value: eff == null ? "—" : `${eff.toFixed(0)}%`,
          label: `Efficiency · ${latest.date.slice(5)}`,
          hint: `${low} worker${low === 1 ? "" : "s"} under ${LOW_EFF_PCT}%`,
          tone: eff == null ? "info" : eff >= 100 ? "ok" : eff >= 85 ? "warn" : "bad",
        });
      }
    }
    if (data.service?.cases) {
      const late = data.service.cases.filter((c) => c.daysOverdue > 0).length;
      out.push({ key: "svc", tab: "service", sub: "overdue", value: String(late), label: "Service cases overdue", tone: late ? "bad" : "ok" });
    }
    return out.filter((t) => visibleTabs.includes(t.tab));
  }, [data, visibleTabs]);
}

