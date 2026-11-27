// ===========================================================================
// Planning v2 — Lead Times (CHANGES.md §4, VIEW ONLY). Editing lead times,
// scheduling a change and the auto-schedule switch stay on desktop. Reads
// GET /api/production-leadtimes + /history; the history API stores only the new
// value of a row and no actor, so "from → to" is derived (see
// ../../lib/planning-leadtimes.ts) and nobody is named.
// ===========================================================================
import { useMemo, useState } from "react";
import { CalendarClock, Monitor } from "lucide-react";
import { M } from "../../theme";
import { segmentTrack, segmentButton } from "../../lib/control-styles";
import { useLeadTimes } from "../../lib/planning-data";
import { buildLeadView } from "../../lib/planning-leadtimes";
import { longDate } from "../../lib/planning-schedule";
import { DL, SHADOW_CARD, SHADOW_SECTION } from "../delivery/ui-tokens";
import { DashLabel, ErrorState, Panel, Pill, SkeletonCards, EmptyState } from "./ui";

const HISTORY_PAGE = 30;

export function LeadTimesScreen() {
  const [cat, setCat] = useState<"BEDFRAME" | "SOFA">("BEDFRAME");
  const [limit, setLimit] = useState(HISTORY_PAGE);
  const { lead, history, loading, error, historyError, refresh } = useLeadTimes();
  const view = useMemo(() => buildLeadView(lead, history, cat), [lead, history, cat]);

  return (
    <div style={{ padding: "2px 18px 24px" }}>
      <ViewOnlyNote>View only. Editing lead times, scheduling changes and the auto-schedule setting stay on desktop.</ViewOnlyNote>

      {loading && !lead ? (
        <div style={{ marginTop: 12 }}>
          <SkeletonCards n={2} h={220} />
        </div>
      ) : error && !lead ? (
        <div style={{ marginTop: 12 }}>
          <ErrorState title="Could not load lead times" onRetry={refresh} />
        </div>
      ) : (
        <>
          <div style={{ marginTop: 12 }}>
            <div role="group" aria-label="Category" style={{ ...segmentTrack(2), height: 44, borderRadius: 12 }}>
              {(["BEDFRAME", "SOFA"] as const).map((c) => (
                <button key={c} type="button" aria-pressed={cat === c} onClick={() => setCat(c)} style={{ ...segmentButton(cat === c), borderRadius: 9 }}>
                  {c === "SOFA" ? "Sofa" : "Bedframe"}
                </button>
              ))}
            </div>
          </div>

          <Panel ariaLabel="Department lead days" style={{ marginTop: 12, padding: 16 }}>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <DashLabel>TOTAL LEAD TIME</DashLabel>
                <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginTop: 8 }}>
                  <span style={{ fontSize: 27, lineHeight: 1.1, fontWeight: 700, letterSpacing: -0.6, color: M.raisin, fontVariantNumeric: "tabular-nums" }}>{view.total}</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: M.ink }}>working days</span>
                </div>
              </div>
              <Pill tone={view.autoSchedule ? "success" : "neutral"} label={view.autoSchedule ? "Auto-schedule on" : "Auto-schedule off"} dot={false} />
            </div>
            <div style={{ marginTop: 14, boxShadow: `inset 0 1px 0 ${DL.track}` }}>
              {view.rows.map((r, i) => (
                <div key={r.code} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, boxShadow: i ? `inset 0 1px 0 ${DL.track}` : "none" }}>
                  <span style={{ width: 22, height: 22, flex: "none", borderRadius: 7, background: "var(--pl-chip)", color: M.taupe, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", fontVariantNumeric: "tabular-nums" }}>{r.n}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: M.raisin, fontWeight: 600 }}>{r.dept}</span>
                  <span style={{ flex: "none", fontSize: 14, fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums" }}>{dayText(r.days)}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, padding: "11px 12px", borderRadius: 12, background: "var(--pl-cell-qty)" }}>
              <CalendarClock size={16} strokeWidth={1.9} color={M.taupe} aria-hidden />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: M.raisin }}>Hookka DD buffer</span>
                <span style={{ display: "block", fontSize: 11.5, color: M.ink, marginTop: 1 }}>Days between production done and Hookka Expected DD</span>
              </span>
              <span style={{ flex: "none", fontSize: 14, fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums" }}>{view.buffer} day{view.buffer === 1 ? "" : "s"}</span>
            </div>
          </Panel>

          {view.pending.length > 0 ? (
            <>
              <Heading>SCHEDULED CHANGES</Heading>
              <div style={{ display: "grid", gap: 10 }}>
                {view.pending.map((h) => (
                  <div key={h.id} style={{ position: "relative", overflow: "hidden", background: M.card, borderRadius: 16, padding: "13px 14px 12px 17px", boxShadow: SHADOW_CARD }}>
                    <span aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: "var(--dl-sem-warning)" }} />
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: M.raisin }}>{h.title}</span>
                      <Pill tone="warning" label={`From ${longDate(h.from)}`} dot={false} />
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: M.raisin, marginTop: 6, fontVariantNumeric: "tabular-nums" }}>{h.change}</div>
                    {h.notes ? <div style={{ fontSize: 12, color: M.ink, marginTop: 4, lineHeight: 1.45 }}>{h.notes}</div> : null}
                  </div>
                ))}
              </div>
            </>
          ) : null}

          <Heading>HISTORY</Heading>
          {historyError && !history ? (
            <ErrorState title="Could not load the history" onRetry={refresh} />
          ) : view.history.length === 0 ? (
            <EmptyState title="No changes recorded" text="Lead-time changes will appear here." />
          ) : (
            <div style={{ background: M.card, borderRadius: 18, padding: "14px 15px 2px", boxShadow: SHADOW_SECTION }}>
              <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {view.history.slice(0, limit).map((ev, i, a) => (
                  <li key={ev.id} style={{ position: "relative", display: "flex", gap: 12, paddingBottom: 16 }}>
                    <span aria-hidden="true" style={{ position: "absolute", left: 6, top: 16, bottom: 0, width: 2, background: i === a.length - 1 ? "transparent" : DL.line }} />
                    <span aria-hidden="true" style={{ position: "relative", width: 14, height: 14, flex: "none", boxSizing: "border-box", borderRadius: "50%", marginTop: 3, background: M.card, border: `3px solid ${DL.icon}` }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: M.raisin }}>{ev.title}</div>
                      <div style={{ fontSize: 12.5, color: DL.body, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>{ev.change}</div>
                      {ev.notes ? <div style={{ fontSize: 12.5, lineHeight: 1.45, color: M.ink, marginTop: 3 }}>{ev.notes}</div> : null}
                      <div style={{ fontSize: 12, color: M.ink, marginTop: 4 }}>{longDate(ev.from)}</div>
                    </div>
                  </li>
                ))}
              </ol>
              {view.history.length > limit ? (
                <button type="button" onClick={() => setLimit((n) => n + HISTORY_PAGE)} style={{ width: "100%", height: 44, margin: "0 0 8px", border: "none", background: "none", color: M.taupe, fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                  Show more ({view.history.length - limit})
                </button>
              ) : null}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function dayText(n: number): string {
  return n === 0 ? "Same day" : `${n} day${n === 1 ? "" : "s"}`;
}

function Heading({ children }: { children: string }) {
  return <div style={{ padding: "20px 4px 8px", fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe }}>{children}</div>;
}

export function ViewOnlyNote({ children }: { children: string }) {
  return (
    <div role="note" style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "11px 13px", borderRadius: 14, background: "var(--pl-note)" }}>
      <span style={{ display: "flex", marginTop: 1 }}>
        <Monitor size={15} strokeWidth={2} color={M.taupe} aria-hidden />
      </span>
      <span style={{ fontSize: 12.5, lineHeight: 1.45, color: M.ink }}>{children}</span>
    </div>
  );
}
