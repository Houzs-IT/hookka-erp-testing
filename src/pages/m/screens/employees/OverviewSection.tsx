// OverviewSection — Employees → Overview (Employees 3.dc.html, HK-0125 Phase 3).
//
// "November 2026 · Month to date" (the real Malaysia month, no picker), the four summary cards, then NEEDS ACTION:
// Pending time adjustments (opens Working Hours, where the request list is) and Attendance exceptions (opens Attendance on
// the Off-site chip for the SAME month-to-date range). "No pending actions" appears only when both lists are accessible,
// loaded without error and empty; a failed request shows a load error instead. Layout, labels, colours and tap paths are the
// HTML's; the figures are the app's (overview-model.ts).
import { Activity, ChevronRight, CircleCheck, Clock, UserCheck, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { todayYmdMYForReads } from "@/lib/staging-today";
import { M } from "../../theme";
import { attendanceLink } from "./attendance-model";
import { monthToDate, needsAction, overviewLabel, buildCards, type CardTone, type OverviewCard } from "./overview-model";
import { TONE } from "./employees-styles";
import { useOverview } from "./use-overview";
import { rowsOf, type NonprodReq } from "./time-adjustments-model";
import type { AdjustmentList } from "./use-time-adjustments";
import { useCachedJson } from "@/lib/cached-fetch";

const ICONS = { Users, UserCheck, Clock, Activity } as const;
const VALUE_COLOR: Record<CardTone, string> = { ink: "#1F1D1B", green: "#4F7C3A", amber: "#9C6F1E", red: "#9A3A2D" };

type Target = "attendance" | "working-hours" | "efficiency";

export default function OverviewSection({
  pending,
  onGo,
}: {
  pending: AdjustmentList & { allowed: boolean };
  onGo: (section: Target) => void;
}) {
  const navigate = useNavigate();
  const today = todayYmdMYForReads();
  const data = useOverview(today);
  const range = monthToDate(today);
  const depts = useCachedJson<unknown>("/api/departments", 300);
  const deptName = (code: string) => rowsOf<{ code: string; name: string }>(depts.data).find((d) => d.code === code)?.name || code;

  // "Workers with logged hours" needs BOTH the roster and the hours summary; if either request failed it reads "—".
  const loggedSourcesOk = !data.workers.error && !data.hours.error;
  const cards = buildCards({ workers: data.workers.rows, totals: data.totals.value, hours: loggedSourcesOk ? data.hours.rows : null });
  const cardsError = data.canWorkers && (data.workers.error || data.totals.error || data.hours.error);
  const needs = needsAction(
    { allowed: pending.allowed, rows: pending.rows as NonprodReq[] | null, loading: pending.loading, error: !!pending.error },
    data.attendance,
    deptName,
  );

  const open = (key: "pending" | "attendance") =>
    key === "pending" ? onGo("working-hours") : navigate(attendanceLink({ loc: "offsite", from: range.from, to: range.to }));

  return (
    <>
      <div style={{ padding: "12px 18px 0" }}>
        <div style={{ marginTop: 2, fontSize: 12.5, color: M.ink }}>
          <span style={{ fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums" }}>{overviewLabel(today)}</span>
        </div>
        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gridAutoRows: "1fr", gap: 8 }}>
          {cards.map((c) => (
            <Card key={c.key} c={c} onTap={() => onGo(c.target)} />
          ))}
        </div>
        {cardsError ? (
          <div role="alert" style={{ marginTop: 8, fontSize: 12, color: "#9A3A2D" }}>
            Couldn't load the month-to-date figures.
          </div>
        ) : null}
      </div>

      {needs.hidden ? null : (
        <div style={{ padding: "4px 18px 0" }}>
          <section aria-label="Needs action" style={{ marginTop: 6 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "0 4px 8px" }}>
              <span style={{ whiteSpace: "nowrap", fontSize: 11, fontWeight: 700, letterSpacing: 1, color: "#9A3A2D" }}>NEEDS ACTION</span>
            </div>

            {needs.calm ? (
              <div role="status" style={{ ...SHEET, display: "flex", alignItems: "center", gap: 12, padding: 14 }}>
                <span style={{ width: 36, height: 36, flex: "none", borderRadius: "50%", background: TONE.green.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <CircleCheck size={18} strokeWidth={2} color={TONE.green.fg} />
                </span>
                <span>
                  <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: M.raisin }}>No pending actions</span>
                  <span style={{ display: "block", fontSize: 12, color: M.ink, marginTop: 2 }}>Nothing waiting for approval or follow-up.</span>
                </span>
              </div>
            ) : null}

            {needs.loading && needs.rows.length === 0 && needs.errors.length === 0 ? (
              <div role="status" style={{ ...SHEET, padding: 14, fontSize: 12.5, color: M.ink }}>
                Checking for pending actions…
              </div>
            ) : null}

            <div style={{ display: "grid", gap: 10 }}>
              {needs.rows.map((n) => {
                const tone = TONE[n.tone === "amber" ? "amber" : "red"];
                return (
                  <div key={n.key} style={{ ...SHEET, position: "relative", overflow: "hidden" }}>
                    <button
                      type="button"
                      onClick={() => open(n.key)}
                      style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 14px 8px 14px", border: "none", background: "none", fontFamily: "inherit", textAlign: "left", cursor: "pointer" }}
                    >
                      <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: M.raisin }}>{n.label}</span>
                      <span style={{ flex: "none", minWidth: 26, height: 24, boxSizing: "border-box", padding: "0 8px", borderRadius: 999, background: tone.bg, color: tone.fg, fontSize: 12.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {n.count}
                      </span>
                      <ChevronRight size={16} strokeWidth={2} color="#B5AC9C" />
                    </button>
                    {n.peek ? (
                      <div style={{ padding: "0 14px 12px 14px", display: "grid", gap: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: M.ink, minWidth: 0 }}>
                          <span style={{ flex: "none", fontWeight: 600, color: M.raisin }}>{n.peek.a}</span>
                          <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.peek.b}</span>
                          <span style={{ flex: "none", whiteSpace: "nowrap", fontWeight: 600, color: M.raisin, fontVariantNumeric: "tabular-nums" }}>{n.peek.c}</span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {needs.errors.map((e) => (
              <div key={e} role="alert" style={{ ...SHEET, marginTop: 10, padding: "12px 14px", fontSize: 12.5, color: "#9A3A2D" }}>
                {e}
              </div>
            ))}
          </section>
        </div>
      )}
    </>
  );
}

const SHEET = {
  background: M.card,
  borderRadius: 16,
  boxShadow: "0 1px 2px rgba(31,29,27,.05), 0 12px 28px -16px rgba(31,29,27,.22)",
} as const;

function Card({ c, onTap }: { c: OverviewCard; onTap: () => void }) {
  const Icon = ICONS[c.icon];
  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={`${c.label}: ${c.value}`}
      style={{ minWidth: 0, display: "block", boxSizing: "border-box", height: "100%", padding: "12px 14px", border: "none", borderRadius: 14, background: M.card, boxShadow: "0 0 0 1px rgba(31,29,27,.04), 0 2px 4px rgba(31,29,27,.06), 0 10px 24px -12px rgba(31,29,27,.28)", fontFamily: "inherit", textAlign: "left", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}
    >
      <span style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, lineHeight: 1.3, color: M.taupe, minHeight: 27 }}>
        <span style={{ display: "flex", flex: "none", marginTop: 1 }}>
          <Icon size={13} strokeWidth={2} color="#8B7A4E" />
        </span>
        <span style={{ minWidth: 0 }}>{c.label}</span>
      </span>
      <span style={{ display: "block", marginTop: 6, fontSize: 16, fontWeight: 700, lineHeight: 1.2, color: VALUE_COLOR[c.tone], fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{c.value}</span>
    </button>
  );
}
