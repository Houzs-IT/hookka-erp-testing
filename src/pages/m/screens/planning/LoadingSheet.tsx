// ===========================================================================
// Planning v2 — Capacity Loading sheet (CHANGES.md §2, "Loading sheet").
// One department: the past 14 working days (produced, by completion date) and
// the next 21 (planned, by job-card due date), against the rolling daily
// capacity. Same data and colours as the desktop Capacity Loading tab. A future
// day lists its jobs (each opens its production order); a past day shows the
// produced hours only — the per-worker breakdown stays on desktop.
// ===========================================================================
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import { Sheet } from "../../components";
import { M } from "../../theme";
import { segmentTrack, segmentButton } from "../../lib/control-styles";
import { buildLoading, futureBarTone, hoursLabel, pastBarTone, PLAN_DEPARTMENTS, type LoadingCategory, type PlanOrder } from "../../lib/planning-capacity";
import { longDate } from "../../lib/planning-schedule";
import { SHADOW_MENU, SHADOW_SECTION, DL, sem, type Tone } from "../delivery/ui-tokens";
import { laneTone } from "./tones";

const H = 96;
const BAR_W = 26;
const GAP = 4;
const CATS: { key: LoadingCategory; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "BEDFRAME", label: "Bedframe" },
  { key: "SOFA", label: "Sofa" },
];

export function LoadingSheet({
  deptCode,
  deptName,
  orders,
  holidays,
  onClose,
  onOpenOrder,
}: {
  deptCode: string | null;
  /** Database name of the department (desktop shows it); falls back to the fixed list. */
  deptName?: string;
  orders: PlanOrder[];
  holidays: Set<string>;
  onClose: () => void;
  onOpenOrder: (orderId: string) => void;
}) {
  const [cat, setCat] = useState<LoadingCategory>("ALL");
  const [sel, setSel] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const open = !!deptCode;
  const name = deptName || (PLAN_DEPARTMENTS.find((d) => d.code === deptCode)?.name ?? deptCode ?? "");

  const data = useMemo(() => (deptCode ? buildLoading(orders, deptCode, cat, holidays) : null), [orders, deptCode, cat, holidays]);

  // Reset when a different department opens; start on the first plan day (today).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the selection when another department opens
    setCat("ALL");
    setSel(null);
  }, [deptCode]);

  // Opens scrolled to today (the first future bar): 14 past bars sit to its left.
  useEffect(() => {
    if (!open || !data) return;
    const id = requestAnimationFrame(() => {
      const el = scroller.current;
      if (el) el.scrollLeft = Math.max(0, data.past.length * (BAR_W + GAP) - 90);
    });
    return () => cancelAnimationFrame(id);
  }, [open, data?.deptCode, data?.past.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !data) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;

  const bars = [
    ...data.past.map((d) => ({ ...d, isPast: true })),
    ...data.future.map((d) => ({ ...d, isPast: false })),
  ];
  const selected = bars.find((b) => b.date === sel) ?? data.future[0] ?? bars[bars.length - 1];
  const selDate = selected?.date ?? "";
  const selIsPast = data.past.some((d) => d.date === selDate);
  const maxPct = Math.max(130, ...bars.map((b) => b.utilization));
  const hasCap = data.dailyCapacityMinutes > 0;
  const toneOf = (b: { isPast: boolean; utilization: number }): Tone => (b.isPast ? pastBarTone(b.utilization) : futureBarTone(b.utilization));
  const jobs = selIsPast ? [] : (data.future.find((d) => d.date === selDate)?.jobs ?? []);

  return (
    <Sheet open onClose={onClose} title={`${name} · Loading`} bare>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 16px 4px" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: M.raisin }}>{name} · Loading</div>
          <div style={{ fontSize: 12, color: M.ink, marginTop: 2 }}>Mon–Sat working days · tap a day for its jobs</div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" style={{ flex: "none", background: "none", border: "none", width: 44, height: 44, marginRight: -10, padding: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: M.ink }}>
          <X size={20} strokeWidth={1.75} />
        </button>
      </div>

      <div style={{ padding: "4px 16px 28px" }}>
        <div role="group" aria-label="Category" style={{ ...segmentTrack(3), height: 40, borderRadius: 12 }}>
          {CATS.map((c) => (
            <button key={c.key} type="button" aria-pressed={cat === c.key} onClick={() => setCat(c.key)} style={{ ...segmentButton(cat === c.key), borderRadius: 9, fontSize: 12.5 }}>
              {c.label}
            </button>
          ))}
        </div>

        <div style={{ marginTop: 12, background: M.card, borderRadius: 16, padding: "12px 12px 10px", boxShadow: SHADOW_MENU }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: M.taupe, whiteSpace: "nowrap" }}>
            <span>◂ PAST {data.past.length} · PRODUCED</span>
            <span>NEXT {data.future.length} · PLANNED ▸</span>
          </div>
          <div ref={scroller} className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden" style={{ overflowX: "auto", marginTop: 8 }}>
            <div style={{ position: "relative", display: "flex", alignItems: "flex-end", gap: GAP, height: 118, width: "max-content", paddingTop: 4 }}>
              {hasCap ? (
                <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: Math.round((100 / maxPct) * H) + 16, borderTop: "1.5px dashed var(--pl-ref-line)", pointerEvents: "none" }} />
              ) : null}
              {bars.map((b) => {
                const on = b.date === selDate;
                const isToday = b.date === data.future[0]?.date;
                const tone = toneOf(b);
                return (
                  <button
                    key={b.date}
                    type="button"
                    onClick={() => setSel(b.date)}
                    aria-pressed={on}
                    aria-label={`${longDate(b.date)} ${b.isPast ? "produced" : "planned"} ${hoursLabel(b.minutes)}${hasCap ? `, ${b.utilization}%` : ""}`}
                    style={{ position: "relative", flex: "none", width: BAR_W, height: "100%", border: "none", background: "none", padding: 0, cursor: "pointer", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", gap: 3, WebkitTapHighlightColor: "transparent" }}
                  >
                    <span
                      style={{
                        width: 20, height: Math.max(3, Math.round((b.utilization / maxPct) * H)), borderRadius: "6px 6px 3px 3px",
                        background: b.minutes === 0 && !hasCap ? DL.track : sem(tone), opacity: b.isPast && !on ? 0.6 : 1,
                        boxShadow: on ? `0 0 0 2px ${M.card}, 0 0 0 4px ${M.raisin}` : "none",
                      }}
                    />
                    <span style={{ fontSize: 9.5, fontWeight: on || isToday ? 800 : 500, color: isToday ? M.taupe : M.ink, fontVariantNumeric: "tabular-nums" }}>{Number(b.date.slice(8))}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 11.5, color: M.ink }}>
            <span aria-hidden="true" style={{ width: 14, borderTop: "1.5px dashed var(--pl-ref-line)" }} />
            {hasCap ? `100% = rolling daily capacity (${hoursLabel(data.dailyCapacityMinutes)}/day)` : "No completed work in the last 14 working days — no capacity to compare against"}
          </div>
        </div>

        {selected ? (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "16px 4px 8px" }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe, whiteSpace: "nowrap" }}>{`${selIsPast ? "PRODUCED" : "PLANNED"} · ${longDate(selDate).toUpperCase()}`}</span>
              {hasCap ? (
                <span style={{ fontSize: 12, fontWeight: 700, color: selIsPast ? M.ink : sem(toneOf({ isPast: false, utilization: selected.utilization })), whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                  {selected.utilization}% of capacity
                </span>
              ) : null}
            </div>
            {selIsPast ? (
              <div style={{ background: M.card, borderRadius: 14, padding: "13px 14px", fontSize: 13, color: DL.body, lineHeight: 1.5, boxShadow: SHADOW_MENU }}>
                Produced <b style={{ color: M.raisin }}>{hoursLabel(selected.minutes)}</b>
                {hasCap ? ` against ${hoursLabel(data.dailyCapacityMinutes)}/day` : ""}. Per-worker and per-job breakdown for past days is on desktop.
              </div>
            ) : jobs.length === 0 ? (
              <div style={{ background: M.card, borderRadius: 14, padding: 18, textAlign: "center", fontSize: 13, color: M.ink, boxShadow: SHADOW_MENU }}>No jobs due this day.</div>
            ) : (
              <div style={{ background: M.card, borderRadius: 14, overflow: "hidden", boxShadow: SHADOW_SECTION }}>
                {jobs.map((j, i) => (
                  <button
                    key={`${j.orderId}-${i}`}
                    type="button"
                    onClick={() => onOpenOrder(j.orderId)}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, minHeight: 56, padding: "8px 14px", background: "none", border: "none", boxShadow: i ? `inset 0 1px 0 ${DL.track}` : "none", fontFamily: "inherit", cursor: "pointer", textAlign: "left" }}
                  >
                    <span aria-hidden="true" style={{ width: 8, height: 8, flex: "none", borderRadius: "50%", background: sem(laneTone(j.category === "BEDFRAME" ? "BEDFRAME" : j.category === "SOFA" ? "SOFA" : null)) }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontVariantNumeric: "tabular-nums" }}>{j.poNo}</span>
                      <span style={{ display: "block", fontSize: 12, color: M.ink, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {[j.productName || "—", j.customerName].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span style={{ flex: "none", fontSize: 13, fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums" }}>{Math.round(j.minutes)} min</span>
                    <ChevronRight size={16} strokeWidth={1.9} color={DL.icon} aria-hidden />
                  </button>
                ))}
              </div>
            )}
          </>
        ) : null}
      </div>
    </Sheet>
  );
}
