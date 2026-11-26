// Home Operations v3 · Overview: Daily production revenue. Rules: desktop dashboards/DailyProductionRevenueCard.tsx (an
// order's value on the day its Upholstery cards complete, from the same revenue-split reads as Costing). One bar per day,
// Bedframe / Sofa / Other stacked, the dashed line = average per working day, a Year view rolls up per month.
import { useMemo, useState, type CSSProperties } from "react";
import { CalendarDays, ChartColumn, ChartLine, ChartPie, Trophy, Wallet } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { M } from "../../theme";
import { dayLabel, widgetPeriodLabel, type Period } from "../../../dashboards/dashboard-shared-lib";
import { TNUM } from "./home-style";
import type { OpsData } from "./ops-data";
import { prodRevenueView } from "./ops-lib";
import { StatusBlock } from "./ops-ui";
import { OGCard, ONote, StatTile } from "./ops-glass";
import { panelStyle } from "./ops-glass-style";

const rm = (sen: number) => formatCurrency(Math.round(sen));
const SERIES = [
  { key: "bedframe", label: "Bedframe", color: "#2B5797" },
  { key: "sofa", label: "Sofa", color: "#D19A32" },
  { key: "other", label: "Other", color: "#D9D2C5" },
] as const;
type SKey = (typeof SERIES)[number]["key"];

export function DailyProductionRevenueCard({ d, period, today, onPeriod }: { d: OpsData; period: Period; today: string; onPeriod: (p: Period) => void }) {
  const [hidden, setHidden] = useState<ReadonlySet<SKey>>(new Set());
  const { status, data } = d.dailyRev;
  const v = useMemo(() => (data ? prodRevenueView(data, period, today) : null), [data, period, today]);
  const unit = v?.byMonth ? "month" : "day";
  const on = (k: SKey) => !hidden.has(k);
  const toggle = (k: SKey) => setHidden((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const heightOf = (r: { bedframe: number; sofa: number; other: number }) => (on("bedframe") ? r.bedframe : 0) + (on("sofa") ? r.sofa : 0) + (on("other") ? r.other : 0);
  const max = Math.max(1, ...(v?.rows ?? []).map(heightOf));
  const selKey = v && !v.byMonth ? period.day : undefined;
  const selRow = v && selKey ? v.rows.find((r) => r.key === selKey) : undefined;
  const pick = (key: string) => onPeriod({ ...period, day: period.day === key ? undefined : key });
  const delta = selRow && v && v.avg > 0 ? Math.round(((selRow.total - v.avg) / v.avg) * 100) : null;

  return (
    <OGCard icon={ChartColumn} title="Daily production revenue" label="Daily production revenue" id="ops-daily-production-revenue"
      sub={`Value finished each ${unit} · ${widgetPeriodLabel(period)}`}>
      {status !== "ready" ? (
        <StatusBlock status={status} what="Daily production revenue" need="a dashboard operations view" onRetry={d.dailyRev.retry} />
      ) : !v || v.rows.length === 0 ? (
        <div role="status" style={{ padding: "24px 0", textAlign: "center", fontSize: 13, color: M.muted }}>No production revenue in this period.</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>
            <StatTile icon={Wallet} label="Total" value={rm(v.total)} sub={`${v.workDays} working day${v.workDays === 1 ? "" : "s"}`} color="#6B5C32" />
            <StatTile icon={ChartLine} label={`Avg / working ${unit}`} value={rm(v.avg)} sub="idle days left out" color="#3E6570" />
            <StatTile icon={Trophy} label={`Best ${unit}`} value={v.best ? rm(v.best[1]) : "—"} sub={v.best ? (v.byMonth ? v.best[0] : dayLabel(v.best[0])) : ""} color="#4F7C3A" valueColor="#4F7C3A" />
            <StatTile icon={ChartPie} label="Bedframe / Sofa" value={v.bfShare == null ? "—" : `${v.bfShare}% / ${100 - v.bfShare}%`} sub="share of value" color="#2B5797" />
          </div>

          <div style={{ ...panelStyle({ padding: 12 }), marginTop: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              {SERIES.map((s) => (
                <button key={s.key} type="button" aria-pressed={on(s.key)} onClick={() => toggle(s.key)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "2px 0", border: "none", background: "none", fontFamily: "inherit", fontSize: 12, fontWeight: 600, color: M.raisin, cursor: "pointer", opacity: on(s.key) ? 1 : 0.45, textDecoration: on(s.key) ? "none" : "line-through", whiteSpace: "nowrap", WebkitTapHighlightColor: "transparent" }}>
                  <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: 3, background: s.color }} />{s.label}
                </button>
              ))}
              <span style={{ flex: 1 }} />
              <span style={{ flex: "none", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: M.muted, whiteSpace: "nowrap" }}><span aria-hidden="true" style={{ width: 12, borderTop: "1.5px dashed #3E6570" }} />Avg</span>
            </div>
            <div role="img" aria-label={`Production revenue per ${unit}`} style={{ position: "relative", display: "flex", alignItems: "flex-end", gap: 3, height: 110, marginTop: 12 }}>
              {!v.byMonth && v.avg > 0 ? <span aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: `${Math.min(100, (v.avg / max) * 100)}%`, borderTop: "1.5px dashed #3E6570", opacity: 0.8, pointerEvents: "none" }} /> : null}
              {v.rows.map((r) => {
                const isSel = r.key === selKey;
                const dim = selKey && !isSel ? 0.45 : 1;
                const seg = (val: number, k: SKey, color: string, top?: boolean) => (on(k) && val > 0 ? <span style={{ width: "100%", height: `${(val / max) * 100}%`, background: color, borderRadius: top ? "3px 3px 0 0" : 0 }} /> : null);
                const stack = (<>{seg(r.other, "other", "#D9D2C5", true)}{seg(r.sofa, "sofa", "#D19A32")}{seg(r.bedframe, "bedframe", "#2B5797")}</>);
                const label = `${v.byMonth ? r.label : dayLabel(r.key)}: ${rm(heightOf(r))}`;
                const box: CSSProperties = { flex: 1, minWidth: 0, height: "100%", padding: 0, border: "none", background: "none", display: "flex", flexDirection: "column", justifyContent: "flex-end", opacity: dim, boxShadow: isSel ? "0 0 0 1.5px #6B5C32" : "none", borderRadius: 3 };
                return v.byMonth
                  ? <span key={r.key} aria-label={label} style={box}>{stack}</span>
                  : <button key={r.key} type="button" aria-label={label} aria-pressed={isSel} onClick={() => pick(r.key)} style={{ ...box, cursor: "pointer" }}>{stack}</button>;
              })}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5, fontSize: 10.5, color: M.muted, ...TNUM }}>
              <span>{v.byMonth ? v.rows[0].label : dayLabel(v.rows[0].key)}</span>
              <span>{v.byMonth ? v.rows[v.rows.length - 1].label : dayLabel(v.rows[v.rows.length - 1].key)}</span>
            </div>
            {selRow ? (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(31,29,27,.07)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <CalendarDays size={14} strokeWidth={2} color="#8B7A4E" aria-hidden="true" />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap" }}>{dayLabel(selRow.key)}</span>
                  {delta == null ? null : (
                    <span style={{ flex: "none", height: 22, display: "inline-flex", alignItems: "center", gap: 3, padding: "0 8px", borderRadius: 999, background: delta >= 0 ? "#EEF3E4" : "#FBE7E3", color: delta >= 0 ? "#4F7C3A" : "#9A3A2D", fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap", ...TNUM }}>
                      {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}% vs average day
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginTop: 8 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, color: M.taupe }}>TOTAL</span>
                  <span style={{ fontSize: 17, fontWeight: 800, color: M.raisin, whiteSpace: "nowrap", ...TNUM }}>{rm(selRow.total)}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 6, marginTop: 8 }}>
                  {SERIES.map((s) => (
                    <div key={s.key} style={{ minWidth: 0, padding: "7px 9px", borderRadius: 10, background: M.card, boxShadow: "inset 0 0 0 1px rgba(31,29,27,.07)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 600, color: M.muted, whiteSpace: "nowrap" }}>
                        <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 2, background: s.color }} />{s.label}
                      </div>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: M.raisin, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", ...TNUM }}>{rm(selRow[s.key])}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          <ONote>An order counts on the day its Upholstery cards complete. Tap a bar to see that {unit}; tap a legend to show or hide it.</ONote>
        </>
      )}
    </OGCard>
  );
}
