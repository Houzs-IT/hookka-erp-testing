// ---------------------------------------------------------------------------
// Floor Live › each department card's "Completed" strip (owner 2026-11-12,
// design https://claude.ai/artifact/VGJkETK2UuzsMjcYqMZshE approved).
// Bedframe = units, sofa = sets; "/ 38" = the department's best day on
// record (green when today reaches it; red when behind the 9-hour pace
// toward it, today only). Click = every day of the month.
// Data: GET /api/dashboard/floor-live/completed (src/api/lib/dept-completed.ts).
// ---------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import type { DeptCompletedResponse } from "./floor-live-lib";
import { behindPace, deptCompletedFor, deptCompletedDays, myNowMin } from "./floor-live-lib";

export function DeptCompletedStrip({ code, name, data, label, showBest, live, today }: {
  code: string;
  name: string;
  data: DeptCompletedResponse | null | undefined;
  /** Small heading; the dashboard passes none (owner 2026-11-12: no "Completed today" words). */
  label?: string;
  showBest: boolean;
  /** Today, live: a number behind the time-based pace turns red. */
  live: boolean;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const c = deptCompletedFor(data, code);
  if (!c) return null;
  const hasBed = c.bedframeUnits > 0 || c.bestBedframe.n > 0;
  const hasSofa = c.sofaSets > 0 || c.bestSofa.n > 0;
  if (!hasBed && !hasSofa) return null;
  const record = (v: number, best: number) => showBest && best > 0 && v >= best;
  const nowMin = myNowMin();
  const tone = (v: number, best: number) =>
    record(v, best) ? "text-[#2F6B3F]" : live && behindPace(v, best, nowMin) ? "text-[#DC2626]" : "text-[#1F1D1B]";
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Completed by ${name}, every day this month`}
        className="mx-2 mt-2 flex min-h-11 w-[calc(100%-1rem)] items-center justify-between gap-2 rounded-md border border-dashed border-[#CDBE98] bg-[#F4EFE6] px-2.5 py-1.5 text-left hover:bg-[#EFE7D6]"
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          {label && <span className="text-[10px] font-bold uppercase tracking-[0.05em] text-[#6B5C32]">{label}</span>}
          <span className="flex flex-wrap items-baseline gap-x-3 text-xs text-[#4B5563]">
            {hasBed && (
              <span>
                Bedframe <b className={`text-sm tabular-nums ${tone(c.bedframeUnits, c.bestBedframe.n)}`}>{c.bedframeUnits}</b>
                {showBest && <span className="text-[10px] text-[#6B7280]"> / {c.bestBedframe.n}</span>}
              </span>
            )}
            {hasSofa && (
              <span>
                Sofa <b className={`text-sm tabular-nums ${tone(c.sofaSets, c.bestSofa.n)}`}>{c.sofaSets}</b>
                {showBest && <span className="text-[10px] text-[#6B7280]"> / {c.bestSofa.n}</span>}
              </span>
            )}
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-[#6B5C32]" aria-hidden="true" />
      </button>
      {open && <DeptCompletedModal code={code} name={name} data={data} today={today} onClose={() => setOpen(false)} />}
    </>
  );
}

function DeptCompletedModal({ code, name, data, today, onClose }: {
  code: string;
  name: string;
  data: DeptCompletedResponse | null | undefined;
  today: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // ‹ › pages the days month by month (owner 2026-11-12: last month too).
  const baseMonth = (data?.to ?? today).slice(0, 7);
  const [month, setMonth] = useState(baseMonth);
  const other = useCachedJson<DeptCompletedResponse>(
    month !== baseMonth && data ? `/api/dashboard/floor-live/completed?from=${data.from}&to=${data.to}&month=${month}` : null,
    0,
  );
  const shown = month === baseMonth ? data : other.data;
  const c = deptCompletedFor(data, code);
  const { days, bedTotal, sofaTotal, bedAvg, sofaAvg } = deptCompletedDays(shown, code, today);
  const max = Math.max(1, ...days.map((d) => d.bedframeUnits + d.sofaSets));
  const step = (by: number) => {
    const [y, m] = month.split("-").map(Number);
    setMonth(new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7));
  };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`${name} — completed · ${month}`} className="my-8 w-full max-w-3xl rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-[#E2DDD8] px-6 py-4">
          <div>
            <h3 className="text-base font-bold text-[#1F1D1B]">{name} — completed · {month}</h3>
            <p className="mt-0.5 text-xs text-[#9CA3AF]">Counted when this department&apos;s last job card for an order closes · outsourced work not counted</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-[#5A5550] hover:bg-[#F5F2ED]" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 px-6 py-4">
          <div className="flex items-center justify-between rounded-lg border border-[#E2DDD8] p-1">
            <button type="button" onClick={() => step(-1)} aria-label="Previous month" className="flex h-8 w-8 items-center justify-center rounded text-[#5A5550] hover:bg-[#F5F2ED]">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-semibold">{month}{month !== baseMonth && other.loading ? " · loading…" : ""}</span>
            <button type="button" onClick={() => step(1)} disabled={month >= today.slice(0, 7)} aria-label="Next month" className="flex h-8 w-8 items-center justify-center rounded text-[#5A5550] hover:bg-[#F5F2ED] disabled:opacity-30">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              [`Bedframe units · ${month}`, bedTotal.toLocaleString(), null],
              [`Sofa sets · ${month}`, sofaTotal.toLocaleString(), null],
              ["Best day · bedframe (30 d)", `${c?.bestBedframe.n ?? 0}`, `${c?.bestBedframe.date ?? "—"} · avg ${bedAvg.toFixed(1)}`],
              ["Best day · sofa (30 d)", `${c?.bestSofa.n ?? 0}`, `${c?.bestSofa.date ?? "—"} · avg ${sofaAvg.toFixed(1)}`],
            ].map(([k, v, sub]) => (
              <div key={k} className="rounded-lg bg-[#F7F4EF] px-3 py-2">
                <div className="text-[10px] font-semibold uppercase text-[#6B7280]">{k}</div>
                <div className="text-lg font-bold tabular-nums text-[#1F1D1B]">{v}</div>
                {sub && <div className="text-[10px] text-[#6B7280]">{sub}</div>}
              </div>
            ))}
          </div>
          {days.length === 0 ? (
            <p className="text-xs text-[#9CA3AF]">Nothing completed this month yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E2DDD8] text-left text-xs text-[#9CA3AF]">
                    <th className="py-1.5 font-medium">Date</th>
                    <th className="py-1.5 font-medium" aria-hidden="true" />
                    <th className="py-1.5 text-right font-medium">Bedframe units</th>
                    <th className="py-1.5 text-right font-medium">Sofa sets</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => (
                    <tr key={d.date} className="border-b border-[#F0ECE9]">
                      <td className="py-1.5 whitespace-nowrap">{d.date}{d.date === today ? " · today" : ""}</td>
                      <td className="w-1/2 px-3 py-1.5" aria-hidden="true">
                        <span className="flex h-2 overflow-hidden rounded bg-[#F0ECE9]">
                          <span className="bg-[#6B5C32]" style={{ width: `${(d.bedframeUnits / max) * 100}%` }} />
                          <span className="bg-[#CDBE98]" style={{ width: `${(d.sofaSets / max) * 100}%` }} />
                        </span>
                      </td>
                      <td className="py-1.5 text-right font-semibold tabular-nums">{d.bedframeUnits || "—"}</td>
                      <td className="py-1.5 text-right font-semibold tabular-nums">{d.sofaSets || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-[#6B7280]">Average over this month&apos;s finished days with completions (today left out). Bedframe counts every piece (headboard, divan); sofa counts 1 order as 1 set — same as Active Jobs and Completed.</p>
        </div>
      </div>
    </div>
  );
}
