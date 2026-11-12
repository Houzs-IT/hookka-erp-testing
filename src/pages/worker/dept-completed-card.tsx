// "Department completed today" — top of the worker Scan screen (owner
// 2026-11-12, design https://claude.ai/artifact/VGJkETK2UuzsMjcYqMZshE).
// The department's count (bedframe units / sofa sets) beside its average over
// the last 12 working days; several departments = one row each, the one scanned into now first.
// Tap = Department history (any month). Data: GET /api/worker/dept-completed.
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { workerFetch } from "@/layouts/WorkerLayout";
import { useT } from "@/lib/worker-i18n";

type Dept = { code: string; name: string; bedframeUnits: number; sofaSets: number; usualBedframe: number; usualSofa: number };
type Day = { dept: string; date: string; bedframeUnits: number; sofaSets: number };
export type DeptCompletedData = {
  today: string;
  shownDate: string;
  isWorkDay: boolean;
  now: string | null;
  isLeader: boolean;
  depts: Dept[];
  month: string;
  days: Day[];
};

const shiftMonth = (ym: string, by: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
};
const monthLabel = (ym: string) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

async function load(month?: string): Promise<DeptCompletedData | null> {
  try {
    const res = await workerFetch(`/api/worker/dept-completed${month ? `?month=${month}` : ""}`);
    const j = (await res.json()) as { success?: boolean; data?: DeptCompletedData };
    return j.success && j.data ? j.data : null;
  } catch {
    return null;
  }
}

function Figure({ label, n, usual }: { label: string; n: number; usual: number }) {
  return (
    <span className="flex items-baseline justify-between gap-1.5 rounded-[10px] bg-[#F3EFE9] px-2.5 py-1.5">
      <span className="text-[10px] font-bold text-[#6B5C32]">{label}</span>
      <span className="flex items-baseline gap-1">
        <span className="text-xl font-extrabold tabular-nums">{n}</span>
        <span className="text-[11px] text-[#8A8680]">/ {Math.round(usual)}</span>
      </span>
    </span>
  );
}

export function DeptCompletedCard() {
  const t = useT();
  const [data, setData] = useState<DeptCompletedData | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    void load().then((d) => { if (alive) setData(d); });
    return () => { alive = false; };
  }, []);
  // An extra on the Scan screen: nothing to show (or an error) → no card.
  if (!data || data.depts.length === 0) return null;
  const single = data.depts.length === 1;
  const d0 = data.depts[0];
  const hasBed = (d: Dept) => d.bedframeUnits > 0 || d.usualBedframe > 0;
  const hasSofa = (d: Dept) => d.sofaSets > 0 || d.usualSofa > 0;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="flex w-full flex-col gap-1.5 rounded-xl border-2 border-dashed border-[#CDBE98] bg-white px-3 py-2.5 text-left"
      >
        <span className="flex w-full items-baseline justify-between">
          <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#8A8680]">
            {data.isWorkDay ? t("deptDone.title") : `${t("deptDone.lastWorkDay")} · ${dayLabel(data.shownDate)}`}
          </span>
          <span className="text-[11px] font-bold text-[#6B5C32]">{t("deptDone.history")} ›</span>
        </span>
        {single ? (
          <>
            <span className="text-sm font-extrabold leading-tight text-[#6B5C32]">{d0.name}</span>
            <span className={`grid w-full gap-2 ${hasBed(d0) && hasSofa(d0) ? "grid-cols-2" : "grid-cols-1"}`}>
              {hasBed(d0) && <Figure label={t("deptDone.bedframe")} n={d0.bedframeUnits} usual={d0.usualBedframe} />}
              {hasSofa(d0) && <Figure label={t("deptDone.sofa")} n={d0.sofaSets} usual={d0.usualSofa} />}
            </span>
          </>
        ) : (
          <span className="flex w-full flex-col">
            {data.depts.map((d, i) => {
              const on = d.code === (data.now ?? data.depts[0].code);
              return (
                <span key={d.code} className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 ${on ? "bg-[#F3EFE9]" : ""} ${i ? "border-t border-[#EAE6DF]" : ""}`}>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className={`truncate text-[13px] ${on ? "font-extrabold text-[#6B5C32]" : "font-semibold text-[#3D3A36]"}`}>{d.name}</span>
                    {d.code === data.now && <span className="rounded-full bg-[#2F6B3F] px-1.5 text-[9px] font-bold text-white">{t("deptDone.now")}</span>}
                  </span>
                  <span className="flex gap-3 whitespace-nowrap tabular-nums">
                    {hasBed(d) && <span className="text-xs text-[#5A5550]">{t("deptDone.bedShort")} <b className="text-[15px] text-[#1F1D1B]">{d.bedframeUnits}</b><span className="text-[10px] text-[#8A8680]"> /{Math.round(d.usualBedframe)}</span></span>}
                    {hasSofa(d) && <span className="text-xs text-[#5A5550]">{t("deptDone.sofaShort")} <b className="text-[15px] text-[#1F1D1B]">{d.sofaSets}</b><span className="text-[10px] text-[#8A8680]"> /{Math.round(d.usualSofa)}</span></span>}
                  </span>
                </span>
              );
            })}
          </span>
        )}
      </button>
      {open && <DeptHistory first={data} onClose={() => setOpen(false)} />}
    </>
  );
}

function DeptHistory({ first, onClose }: { first: DeptCompletedData; onClose: () => void }) {
  const t = useT();
  const [data, setData] = useState(first);
  const [month, setMonth] = useState(first.month);
  const [dept, setDept] = useState(first.now ?? first.depts[0].code);
  const [busy, setBusy] = useState(false);
  const go = useCallback(async (m: string) => {
    setBusy(true);
    const d = await load(m);
    setBusy(false);
    if (d) { setData(d); setMonth(d.month); }
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const d = data.depts.find((x) => x.code === dept) ?? data.depts[0];
  const rows = data.days.filter((x) => x.dept === d.code).sort((a, b) => (a.date < b.date ? 1 : -1));
  const bedTotal = rows.reduce((s, r) => s + r.bedframeUnits, 0);
  const sofaTotal = rows.reduce((s, r) => s + r.sofaSets, 0);
  const canNext = month < data.today.slice(0, 7);
  return (
    <div role="dialog" aria-modal="true" aria-label={t("deptDone.historyTitle")} className="fixed inset-0 z-50 flex flex-col bg-[#F0ECE9]">
      <div className="flex h-14 flex-none items-center gap-2 bg-[#1F1D1B] px-2 text-white">
        <button type="button" onClick={onClose} aria-label={t("common.back")} className="flex h-11 w-11 items-center justify-center">
          <ChevronLeft className="h-6 w-6" />
        </button>
        <span className="text-[15px] font-bold">{t("deptDone.historyTitle")}</span>
      </div>
      <div className="mx-auto w-full max-w-md flex-1 space-y-2.5 overflow-y-auto px-4 py-3.5">
        {data.depts.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {data.depts.map((x) => (
              <button
                key={x.code}
                type="button"
                onClick={() => setDept(x.code)}
                className={`h-9 rounded-full border px-3 text-xs ${x.code === d.code ? "border-[#1F1D1B] bg-[#1F1D1B] font-bold text-white" : "border-[#D8D2CC] bg-white text-[#5A5550]"}`}
              >
                {x.name}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between rounded-xl border border-[#D8D2CC] bg-white p-1">
          <button type="button" onClick={() => void go(shiftMonth(month, -1))} disabled={busy} aria-label={t("deptDone.prevMonth")} className="flex h-10 w-10 items-center justify-center text-[#5A5550] disabled:opacity-40">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <span className="text-sm font-bold">{monthLabel(month)}</span>
          <button type="button" onClick={() => void go(shiftMonth(month, 1))} disabled={busy || !canNext} aria-label={t("deptDone.nextMonth")} className="flex h-10 w-10 items-center justify-center text-[#5A5550] disabled:opacity-30">
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-2 rounded-xl border border-[#D8D2CC] bg-white px-3.5 py-3">
          <div className="text-base font-extrabold text-[#6B5C32]">{d.name}</div>
          <div className="grid grid-cols-2 gap-2">
            {[
              [t("deptDone.bedMonth"), bedTotal, d.usualBedframe],
              [t("deptDone.sofaMonth"), sofaTotal, d.usualSofa],
            ].map(([label, total, usual]) => (
              <div key={label as string} className="rounded-[10px] bg-[#F3EFE9] px-2.5 py-2">
                <div className="text-[10px] font-bold text-[#6B5C32]">{label as string}</div>
                <div className="text-xl font-extrabold tabular-nums">{total as number}</div>
                <div className="text-[11px] text-[#8A8680]">
                  {t("deptDone.usual")} {usual as number}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="overflow-hidden rounded-xl border border-[#D8D2CC] bg-white">
          <div className="grid grid-cols-[minmax(0,1fr)_76px_64px] bg-[#FAF8F6] px-3.5 py-2 text-[11px] text-[#8A8680]">
            <span>{t("deptDone.day")}</span><span className="text-right">{t("deptDone.bedframe")}</span><span className="text-right">{t("deptDone.sofa")}</span>
          </div>
          {rows.length === 0 ? (
            <div className="px-3.5 py-4 text-sm text-[#8A8680]">{busy ? t("common.loading") : t("deptDone.nothing")}</div>
          ) : (
            rows.map((r) => (
              <div key={r.date} className="grid grid-cols-[minmax(0,1fr)_76px_64px] items-center border-t border-[#F0ECE9] px-3.5 py-2.5 text-sm">
                <span className="text-[#3D3A36]">{dayLabel(r.date)}{r.date === data.today ? ` · ${t("deptDone.today")}` : ""}</span>
                <span className={`text-right tabular-nums ${"font-semibold"}`}>{r.bedframeUnits || "—"}</span>
                <span className={`text-right tabular-nums ${"font-semibold"}`}>{r.sofaSets || "—"}</span>
              </div>
            ))
          )}
        </div>
        <p className="text-[11px] text-[#8A8680]">{t("deptDone.note")}</p>
      </div>
    </div>
  );
}
