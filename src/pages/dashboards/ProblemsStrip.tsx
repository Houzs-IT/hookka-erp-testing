import { useMemo } from "react";
import { useCachedJson } from "@/lib/cached-fetch";
import { deptName } from "./ops-floor-lib";
import { CUR_YM, type Overview } from "./dashboard-widgets-lib";

// ---------------------------------------------------------------------------
// "Today's problems" (owner 2026-10-17): management opens the dashboard every
// day to see what is wrong, so the things that need someone's action sit above
// the tabs on every tab, each one opening the tab that holds its detail. All
// read the same cached GET /api/dashboard/prototype feed the tabs already
// load — no extra request. A tile whose tab this role cannot open, or whose
// feed section is not available to it, is not shown.
// ---------------------------------------------------------------------------

type Feed = {
  production?: {
    overdueByDept?: { department: string; count: number }[];
    dueSoon3Days?: { daysToDD: number | null }[];
    bottleneck?: { dept: string; cards: number; orders: number } | null;
  } | null;
  service?: { cases: { daysOverdue: number; approvalStatus: string | null }[] } | null;
  inventory?: { materialShortage?: { balanceQty: number }[] } | null;
  employee?: { performance?: { byDay?: { date: string; workers?: { workerId: string; workingMinutes: number; productionMinutes: number }[] }[] } } | null;
};

type Tone = "bad" | "warn" | "ok" | "info";
type Tile = { key: string; tab: string; sub?: string; anchor?: string; value: string; label: string; hint?: string; tone: Tone };

const TONE: Record<Tone, { bar: string; value: string }> = {
  bad: { bar: "#DC2626", value: "#B91C1C" },
  warn: { bar: "#C9A24B", value: "#9A7B2E" },
  ok: { bar: "#15803D", value: "#15803D" },
  info: { bar: "#6B5C32", value: "#1F1D1B" },
};

const LOW_EFF_PCT = 75;

export function ProblemsStrip({ visibleTabs, onOpen }: { visibleTabs: readonly string[]; onOpen: (tab: string, sub?: string, anchor?: string) => void }) {
  const { data } = useCachedJson<Feed>("/api/dashboard/prototype");
  // Bottleneck = the department with the most DAYS of queue (backlog ÷ its
  // own daily capacity), the Command Center's Department Backlog definition —
  // the card count alone named Fabric Sewing while Department Backlog put
  // Webbing first (owner 2026-10-17 review). Backlog is live state, so the
  // current month's payload carries it.
  const { data: ov } = useCachedJson<Overview>(`/api/dashboard/overview?period=${CUR_YM}`);
  const tiles = useMemo<Tile[]>(() => {
    if (!data) return [];
    const out: Tile[] = [];
    const prod = data.production;
    if (prod?.overdueByDept) {
      const n = prod.overdueByDept.reduce((a, d) => a + d.count, 0);
      const worst = prod.overdueByDept[0];
      out.push({ key: "overdue", tab: "operations", sub: "overview", anchor: "ops-overdue", value: String(n), label: "Production orders overdue", hint: n && worst ? `most at ${deptName(worst.department)} (${worst.count})` : "none", tone: n ? "bad" : "ok" });
    }
    if (prod?.dueSoon3Days) {
      const today = prod.dueSoon3Days.filter((o) => o.daysToDD === 0).length;
      const n = prod.dueSoon3Days.length;
      out.push({ key: "due", tab: "operations", sub: "overview", anchor: "ops-due-soon", value: String(today), label: "Due today", hint: `${n} within 3 days`, tone: today ? "warn" : n ? "info" : "ok" });
    }
    if (data.service?.cases) {
      const late = data.service.cases.filter((c) => c.daysOverdue > 0).length;
      const pending = data.service.cases.filter((c) => c.approvalStatus === "PENDING").length;
      out.push({ key: "svc", tab: "service", sub: "overdue", value: String(late), label: "Service cases overdue", tone: late ? "bad" : "ok" });
      out.push({ key: "appr", tab: "service", sub: "overdue", value: String(pending), label: "Approvals waiting", tone: pending ? "warn" : "ok" });
    }
    const byDay = data.employee?.performance?.byDay;
    if (byDay && byDay.length) {
      const latest = [...byDay].filter((d) => (d.workers ?? []).some((w) => w.workingMinutes > 0)).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
      if (latest) {
        const low = (latest.workers ?? []).filter((w) => w.workingMinutes >= 60 && (w.productionMinutes / w.workingMinutes) * 100 < LOW_EFF_PCT).length;
        out.push({ key: "eff", tab: "people", value: String(low), label: `Workers under ${LOW_EFF_PCT}%`, hint: `on ${latest.date.slice(5)}`, tone: low ? "warn" : "ok" });
      }
    }
    if (data.inventory?.materialShortage) {
      const n = data.inventory.materialShortage.filter((m) => m.balanceQty < 0).length;
      const zero = data.inventory.materialShortage.filter((m) => m.balanceQty === 0).length;
      out.push({ key: "short", tab: "operations", sub: "production", anchor: "ops-shortage", value: String(n), label: "Materials below zero", hint: `${zero} more at zero`, tone: n ? "bad" : "ok" });
    }
    const backlog = ov?.production?.backlogByDept ?? [];
    const neck = [...backlog].filter((d) => d.backlogDays != null).sort((a, b) => (b.backlogDays ?? 0) - (a.backlogDays ?? 0))[0];
    if (neck) {
      out.push({ key: "neck", tab: "operations", sub: "overview", value: deptName(neck.dept), label: "Bottleneck department", hint: `${neck.backlogDays?.toFixed(1)} days of queue`, tone: (neck.backlogDays ?? 0) > 12 ? "bad" : "info" });
    }
    return out.filter((t) => visibleTabs.includes(t.tab));
  }, [data, ov, visibleTabs]);

  if (tiles.length === 0) return null;
  return (
    <section aria-label="Today's problems" className="space-y-2">
      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#6B5C32]">Today's problems</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        {tiles.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => onOpen(t.tab, t.sub, t.anchor)}
            className="min-w-0 rounded-xl bg-white p-3 text-left shadow-[0_1px_3px_rgba(0,0,0,0.08)] transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#6B5C32]"
            style={{ borderTop: `3px solid ${TONE[t.tone].bar}` }}
          >
            <p className="truncate text-xl font-bold tabular-nums" style={{ color: TONE[t.tone].value }}>{t.value}</p>
            <p className="truncate text-xs font-medium text-[#1F1D1B]">{t.label}</p>
            {t.hint && <p className="truncate text-[11px] text-[#9CA3AF]">{t.hint}</p>}
          </button>
        ))}
      </div>
    </section>
  );
}
