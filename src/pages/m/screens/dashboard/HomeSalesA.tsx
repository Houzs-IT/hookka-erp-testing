// Home v10 · Sales (part 1): KPI tiles, Revenue, Order Pipeline, Sales Forecast.
// Presentation of figures the desktop already computes; see home-lib.ts for the
// maths and home-data.ts for the endpoints.
import { useMemo, useState } from "react";
import { Info, Lock, PackageOpen, Receipt, ShoppingCart, Truck, type LucideIcon } from "lucide-react";
import { M } from "../../theme";
import { useResponsiveLayout } from "../../lib/responsive-layout";
import type { Period } from "../../../dashboards/dashboard-shared-lib";
import type { RevCat } from "../../../dashboard-b/revenue-split";
import type { SalesAccess, SalesData } from "./home-data";
import {
  PIPELINE_STATUSES, axisK, buildForecast, fcTone, forecastUnit, niceAxis, perDayNote, perDayOf, pipelineOf, revenuePoints, rm, stateTile, type FcRow, type StateTile,
} from "./home-lib";
import { ChipRow, HCard, Label, LegendToggle, SectionState } from "./home-ui";
import { DATA, NOWRAP_ELLIPSIS, SHADOW_CARD, TNUM, useScrub } from "./home-style";

export type KpiKind = "sales" | "invoices" | "pending" | "outstanding";

const fitValue = (s: string): number => (s.length <= 13 ? 17 : s.length <= 16 ? 15 : 13);

// ---------------------------------------------------------------------------
// KPI tiles
// ---------------------------------------------------------------------------
type Tile = {
  kind: KpiKind; icon: LucideIcon; rail: string; tint: string; label: string; value: string; sub: string;
  tag: string; tagFg: string; tagRing: string; dot?: boolean; locked?: boolean;
};

function stateText(t: StateTile | null, loading: boolean, failed: boolean, liveNow: boolean) {
  if (t == null) {
    return {
      value: loading ? "…" : failed ? "—" : "…",
      tag: failed ? "UNAVAILABLE" : liveNow ? "LIVE" : "MONTH-END",
      dot: !failed && liveNow,
      sub: failed ? "Not available" : "Loading",
    };
  }
  if (t.kind === "live") return { value: rm(t.sen), tag: "LIVE", dot: true, sub: "" };
  if (t.kind === "saved") return { value: rm(t.sen), tag: "MONTH-END", dot: false, sub: t.asOf ? `Saved figure as of ${t.asOf}` : "Saved month-end figure" };
  return { value: "—", tag: "NO RECORD", dot: false, sub: "Nothing saved for this period" };
}

export function KpiSection({
  data, access, periodKey, periodText, curYm, onOpen,
}: { data: SalesData; access: SalesAccess; periodKey: string; periodText: string; curYm: string; onOpen: (k: KpiKind) => void }) {
  const ov = data.overview.data;
  const so = data.soStats.data;
  const wide = useResponsiveLayout().mode !== "phone";

  const livePending = data.pending.data && data.doStats.data
    ? (data.pending.data.pendingDeliveryValueSen ?? 0) + (data.doStats.data.valueByStatus?.DRAFT ?? 0)
      + (data.doStats.data.valueByStatus?.LOADED ?? 0) + (data.doStats.data.valueByStatus?.IN_TRANSIT ?? 0)
    : null;
  const liveOut = so ? (so.outstandingItemsSen ?? 0) : null;
  // Live periods need only their own endpoints (a failed `overview` must not hide them);
  // a finished period reads the saved month-end figure that rides on `overview`.
  const liveNow = stateTile(periodKey, null, null, 0, curYm).kind === "live";
  const pdTile: StateTile | null = liveNow
    ? (livePending != null ? { kind: "live", sen: livePending } : null)
    : ov ? stateTile(periodKey, ov.stateKpis?.pendingDeliverySen, ov.stateKpis?.asOf, 0, curYm) : null;
  const outTile: StateTile | null = liveNow
    ? (liveOut != null ? { kind: "live", sen: liveOut } : null)
    : ov ? stateTile(periodKey, ov.stateKpis?.outstandingSen, ov.stateKpis?.asOf, 0, curYm) : null;

  const ovLoading = data.overview.loading;
  const ovFail = !ov && !!data.overview.failure;
  const tag = (t: string) => ({ tag: t, tagFg: M.taupe, tagRing: M.hairline });
  const live = { tagFg: DATA.moss, tagRing: M.hairline };
  const pd = liveNow
    ? stateText(pdTile, data.pending.loading || data.doStats.loading, !!data.pending.failure || !!data.doStats.failure, true)
    : stateText(pdTile, ovLoading, ovFail, false);
  const out = liveNow
    ? stateText(outTile, data.soStats.loading, !!data.soStats.failure, true)
    : stateText(outTile, ovLoading, ovFail, false);

  const tiles: Tile[] = [
    {
      kind: "sales", icon: ShoppingCart, rail: DATA.so, tint: M.divider, label: "Sales", ...tag(periodText.toUpperCase()),
      value: ov ? rm(ov.salesThisMonthSen) : ovLoading ? "…" : "—", sub: "Confirmed SOs, by SO date"
    },
    access.invoices
      ? {
        kind: "invoices", icon: Receipt, rail: "#B8963F", tint: M.divider, label: "Invoices", ...tag(periodText.toUpperCase()),
        value: ov ? rm(ov.invoicesThisMonthSen) : ovLoading ? "…" : "—", sub: "By invoice date, excl. cancelled"
      }
      : {
        kind: "invoices", icon: Lock, rail: DATA.inv, tint: M.divider, label: "Invoices", ...tag("RESTRICTED"),
        value: "Restricted", sub: "Needs Invoices access", locked: true,
      },
    access.delivery
      ? { kind: "pending", icon: Truck, rail: DATA.moss, tint: M.divider, label: "Pending delivery", value: pd.value, sub: pd.sub || "Made / on DO, not yet delivered", tag: pd.tag, ...(pd.tag === "LIVE" ? live : tag(pd.tag)), dot: pd.dot }
      : { kind: "pending", icon: Lock, rail: DATA.inv, tint: M.divider, label: "Pending delivery", value: "Restricted", sub: "Needs Delivery access", locked: true, ...tag("RESTRICTED") },
    { kind: "outstanding", icon: PackageOpen, rail: DATA.red, tint: M.divider, label: "Outstanding", value: out.value, sub: out.sub || "Confirmed, not yet delivered", tag: out.tag, ...(out.tag === "LIVE" ? live : tag(out.tag)), dot: out.dot },
  ];

  return (
    <section aria-label="Sales totals" style={{ display: "grid", gridTemplateColumns: `repeat(${wide ? 4 : 2},minmax(0,1fr))`, gap: 10 }}>
      {tiles.map((t) => {
        const Icon = t.icon;
        const inner = (
          <>
            <span aria-hidden="true" style={{ position: "absolute", right: -26, top: -26, width: 76, height: 76, borderRadius: "50%", backgroundColor: t.tint, opacity: 0.65 }} />
            <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
              <span aria-hidden="true" style={{ width: 30, height: 30, flex: "none", borderRadius: 10, backgroundColor: t.rail, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 4px 10px -4px ${t.rail}` }}>
                <Icon size={15} strokeWidth={2} color="#FFFFFF" />
              </span>
              <span style={{ height: 20, display: "inline-flex", alignItems: "center", gap: 4, padding: "0 7px", borderRadius: 999, backgroundColor: M.card, color: t.tagFg, fontSize: 10, fontWeight: 700, letterSpacing: 0.3, whiteSpace: "nowrap", boxShadow: `0 0 0 1px ${t.tagRing}`, maxWidth: "100%", overflow: "hidden" }}>
                {t.dot ? <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: "50%", backgroundColor: t.tagFg }} /> : null}{t.tag}
              </span>
            </div>
            <div style={{ position: "relative", fontSize: 12, fontWeight: 700, color: M.ink, marginTop: 10, ...NOWRAP_ELLIPSIS }}>{t.label}</div>
            <div style={{ position: "relative", fontSize: fitValue(t.value), fontWeight: 700, letterSpacing: -0.6, color: t.locked ? M.muted : M.raisin, marginTop: 2, whiteSpace: "nowrap", ...TNUM }}>{t.value}</div>
            <div style={{ position: "relative", fontSize: 11.5, lineHeight: 1.35, color: M.ink, marginTop: 4 }}>{t.sub}</div>
          </>
        );
        const box = { position: "relative", overflow: "hidden", minWidth: 0, display: "flex", flexDirection: "column", backgroundColor: M.card, borderRadius: 16, padding: 12, boxShadow: SHADOW_CARD, textAlign: "left", font: "inherit", border: "none" } as const;
        return t.locked ? (
          <div key={t.kind} role="group" aria-label={`${t.label}, restricted`} style={box}>{inner}</div>
        ) : (
          <button key={t.kind} type="button" onClick={() => onOpen(t.kind)} aria-label={`${t.label}: ${t.value}. Open details`} style={{ ...box, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>{inner}</button>
        );
      })}
      {ovFail ? (
        <div role="alert" style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 12px", borderRadius: 12, backgroundColor: M.card, boxShadow: SHADOW_CARD, fontSize: 12, color: M.ink }}>
          <span>Could not load the Sales and Invoices totals.</span>
          <button type="button" onClick={data.refresh} style={{ flex: "none", height: 30, padding: "0 12px", border: "none", borderRadius: 999, backgroundColor: M.taupe, color: M.paper, fontFamily: "inherit", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Retry</button>
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Revenue
// ---------------------------------------------------------------------------
const SERIES = [["so", "Sales Orders", DATA.so], ["pr", "Production", DATA.prod], ["iv", "Invoices", DATA.inv]] as const;
type SKey = "so" | "pr" | "iv";
const CATS = [["all", "All"], ["bedframe", "Bedframe"], ["sofa", "Sofa"]] as const;

function smooth(pts: [number, number][]): string {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : "";
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = Math.min(186, p1[1] + (p2[1] - p0[1]) / 6);
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = Math.min(186, p2[1] - (p3[1] - p1[1]) / 6);
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

export function RevenueCard({ data, access }: { data: SalesData; access: SalesAccess }) {
  const [cat, setCat] = useState<RevCat>("all");
  const [hidden, setHidden] = useState<Record<SKey, boolean>>({ so: false, pr: false, iv: false });
  const [sel, setSel] = useState<number | null>(null);
  const ov = data.overview.data;
  const points = useMemo(() => revenuePoints(ov?.weeklyRevenue ?? [], data.split.data, cat), [ov, data.split.data, cat]);
  // Without invoice access the invoice series is withheld, not drawn (D1).
  const series = SERIES.filter(([k]) => access.invoices || k !== "iv");
  const vis = series.filter(([k]) => !hidden[k]);
  const n = points.length;
  const rawMax = Math.max(1, ...points.flatMap((p) => vis.map(([k]) => p[k])));
  const { step, max: mx } = niceAxis(rawMax);
  const X = (i: number) => (n === 1 ? 150 : (i / (n - 1)) * 300);
  const Y = (v: number) => 186 - (v / mx) * 180;
  // A single bucket (the 2nd day of a month) has no line to draw: its point and its
  // values are shown straight away. Nothing is interpolated or invented.
  const single = n === 1;
  const idx = single ? 0 : sel != null ? Math.min(sel, n - 1) : -1;
  const scrub = useScrub(n, setSel, sel);
  const pick = idx >= 0 ? points[idx] : null;
  const xi = n <= 5 ? points.map((_, i) => i) : [0, Math.round((n - 1) / 4), Math.round((n - 1) / 2), Math.round(((n - 1) * 3) / 4), n - 1];
  const pc = idx >= 0 ? (X(idx) / 300) * 100 : 0;
  // Readout position. Normally beside the selected point (left of it past the middle). A lone point sits
  // mid-chart, where "left" would cover the y-axis labels, so it is centred on the point instead, above the
  // dots when there is room and below them otherwise.
  const dotTopPx = single && vis.length ? (Math.min(...vis.map(([k]) => Y(points[0][k]))) / 190) * 210 : 0;
  const tipPos: React.CSSProperties = single
    ? { left: "50%", transform: "translateX(-50%)", ...(dotTopPx >= 100 ? { top: 4 } : { bottom: 14 }) }
    : { top: 4, left: `${pc}%`, transform: `translateX(${pc > 40 ? "calc(-100% - 8px)" : "8px"})` };

  const body = () => {
    if (data.overview.loading && !ov) return <SectionState kind="loading" minHeight={210} />;
    if (!ov) return <SectionState kind="error" onRetry={data.refresh} text="Could not load the revenue chart." />;
    if (cat !== "all" && !data.split.data && data.split.loading) return <SectionState kind="loading" minHeight={210} />;
    if (cat !== "all" && !data.split.data) return <SectionState kind="error" onRetry={data.refresh} text="Could not load the category split." />;
    if (n === 0 || !points.some((p) => p.so || p.iv || p.pr)) return <SectionState kind="empty" text="No revenue data for this period." minHeight={210} />;
    return (
      <>
        <div style={{ position: "relative", height: 210, marginTop: 16, paddingLeft: 34 }}>
          <div aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 30, fontSize: 11, color: M.ink, textAlign: "right", ...TNUM }}>
            {/* No series shown = no scale to label (five "0" ticks would read as data). */}
            {vis.length === 0 ? null : [0, 1, 2, 3, 4].map((i) => (
              <span key={i} style={{ position: "absolute", right: 0, top: `${((Y(step * i) / 190) * 100).toFixed(2)}%`, lineHeight: "10px", transform: "translateY(-5px)", whiteSpace: "nowrap" }}>{axisK((step * i) / 100)}</span>
            ))}
          </div>
          <div style={{ position: "relative", height: "100%" }}>
            {vis.length === 0 ? (
              <div role="status" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", fontSize: 12.5, color: M.ink, padding: "0 24px", zIndex: 1, pointerEvents: "none" }}>
                All series are hidden. Tap a legend to show one.
              </div>
            ) : null}
            <svg viewBox="0 0 300 190" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }} aria-hidden="true">
              <defs>
                {vis.filter(([k]) => k !== "iv").map(([k, , c]) => (
                  <linearGradient key={k} id={`m-rvg-${k}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={c} stopOpacity={k === "so" ? 0.1 : 0.08} />
                    <stop offset="100%" stopColor={c} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              {[0, 1, 2, 3].map((i) => <line key={i} x1={0} x2={300} y1={Y(step * (i + 1))} y2={Y(step * (i + 1))} style={{ stroke: M.divider }} strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
              <line x1={0} x2={300} y1={186} y2={186} style={{ stroke: M.hairline }} strokeWidth={1} vectorEffect="non-scaling-stroke" />
              {n > 1 ? vis.filter(([k]) => k !== "iv").map(([k]) => (
                <path key={`a${k}`} d={`${smooth(points.map((p, i) => [X(i), Y(p[k])]))} L300,186 L0,186 Z`} fill={`url(#m-rvg-${k})`} stroke="none" />
              )) : null}
              {idx >= 0 ? <line x1={X(idx)} x2={X(idx)} y1={0} y2={186} style={{ stroke: M.faint }} strokeWidth={1} vectorEffect="non-scaling-stroke" /> : null}
              {n > 1 ? vis.map(([k, , c]) => (
                <path key={k} d={smooth(points.map((p, i) => [X(i), Y(p[k])]))} fill="none" stroke={c} strokeWidth={2} strokeDasharray={k === "iv" ? "4 3" : undefined} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              )) : null}
              {/* A single bucket has no line to draw (day 1 of a month): show its points. */}
              {idx >= 0 ? vis.map(([k, , c]) => <circle key={`d${k}`} cx={X(idx)} cy={Y(points[idx][k])} r={single ? 4.5 : 3} style={{ fill: single ? c : M.card }} stroke={c} strokeWidth={2} vectorEffect="non-scaling-stroke" />) : null}
            </svg>
            <div
              role="slider" tabIndex={0} aria-label="Revenue — drag across to read each bucket" aria-valuemin={0} aria-valuemax={Math.max(0, n - 1)} aria-valuenow={Math.max(0, idx)}
              aria-valuetext={pick ? pick.label : "Period total"} {...scrub}
              style={{ position: "absolute", inset: "-6px 0", cursor: "crosshair", touchAction: "pan-y", outline: "none" }}
            />
            {pick && vis.length > 0 ? (
              <div role="status" style={{ position: "absolute", ...tipPos, zIndex: 2, backgroundColor: M.card, border: `1px solid ${M.border}`, borderRadius: 8, padding: "7px 9px", boxShadow: "0 6px 16px -8px rgba(31,29,27,.25)", pointerEvents: "none", whiteSpace: "nowrap" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: M.raisin, marginBottom: 3 }}>{pick.label}</div>
                {vis.map(([k, l, c]) => (
                  <div key={k} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, lineHeight: "16px", color: M.ink, ...TNUM }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: c }} />{l}
                    <span style={{ marginLeft: "auto", paddingLeft: 10, fontWeight: 700, color: M.raisin }}>{rm(Math.round(pick[k] / 100) * 100)}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <div style={{ position: "relative", height: 14, marginTop: 8, marginLeft: 34, fontSize: 11, color: M.ink, ...TNUM }}>
          {xi.map((i, j) => <span key={`${i}-${j}`} style={{ position: "absolute", left: `${((X(i) / 300) * 100).toFixed(2)}%`, transform: "translateX(-50%)", whiteSpace: "nowrap" }}>{points[i].label}</span>)}
        </div>
      </>
    );
  };

  return (
    <HCard label="Revenue" title="Revenue" sub="Sales Orders · Invoices · Production · tap a legend to toggle · tap or slide on the chart">
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 14px", marginTop: 16 }}>
        <ChipRow options={CATS} value={cat} onChange={(c) => { setCat(c); setSel(null); }} aria="Revenue category" />
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
          {series.map(([k, l, c]) => (
            <LegendToggle key={k} label={l} on={!hidden[k]} onToggle={() => setHidden((h) => ({ ...h, [k]: !h[k] }))} color={k === "pr" ? "#9A7B2E" : undefined}
              swatch={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: c }} />
          ))}
        </div>
      </div>
      {body()}
    </HCard>
  );
}

// ---------------------------------------------------------------------------
// Order Pipeline
// ---------------------------------------------------------------------------
export function PipelineCard({ data, periodKey, periodText }: { data: SalesData; periodKey: string; periodText: string }) {
  const ov = data.overview.data;
  const so = data.soStats.data;
  const pl = ov ? pipelineOf(ov.salesThisMonthSen ?? 0, ov.deliveredOfMonthOrdersSen ?? 0) : null;
  const perDay = useMemo(() => perDayOf(periodKey, ov?.weeklyRevenue ?? []), [periodKey, ov]);
  const rowsMain = pl
    ? ([
      ["Confirmed", pl.confirmed, DATA.so, "100%"],
      ["Outstanding", pl.outstanding, DATA.prod, pl.confirmed > 0 ? `${Math.round((pl.outstanding / pl.confirmed) * 100)}%` : "—"],
      ["Delivered", pl.delivered, DATA.green, pl.confirmed > 0 ? `${Math.round(pl.rate)}%` : "—"],
    ] as const)
    : null;
  const maxN = Math.max(1, ...PIPELINE_STATUSES.map(([k]) => so?.byStatus?.[k] ?? 0));
  const daysOf = (k: string, sen: number) => {
    const rate = k === "IN_PRODUCTION" ? perDay?.production : k === "READY_TO_SHIP" ? perDay?.invoiced : null;
    return rate && rate > 0 ? sen / rate : null;
  };
  const sep = <div style={{ height: 1, backgroundColor: M.divider, margin: "16px 0 14px" }} />;

  return (
    <HCard
      label="Order pipeline" title="Order Pipeline" sub={`${periodText} orders — shipped vs still to ship`}
      right={pl ? (
        <div style={{ flex: "none", textAlign: "right" }}>
          <Label style={{ whiteSpace: "nowrap" }}>DELIVERED RATE</Label>
          <div style={{ fontSize: 18, fontWeight: 700, lineHeight: "22px", color: DATA.green, marginTop: 2, ...TNUM }}>{pl.rate.toFixed(1)}%</div>
        </div>
      ) : null}
    >
      {!ov || !pl || !rowsMain ? (
        <SectionState kind={data.overview.loading ? "loading" : "error"} onRetry={data.refresh} minHeight={160} text={data.overview.loading ? undefined : "Could not load the pipeline."} />
      ) : (
        <>
          <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
            {rowsMain.map(([label, v, c, p]) => (
              <div key={label}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: M.raisin }}>{label}</span>
                  <span style={{ flex: "none", fontSize: 11.5, color: M.ink, ...TNUM }}>{p}</span>
                  <span style={{ flex: "none", minWidth: 96, textAlign: "right", fontSize: 14, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", ...TNUM }}>{rm(v)}</span>
                </div>
                <div style={{ height: 10, marginTop: 6, borderRadius: 999, backgroundColor: M.divider, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.max(3, (v / pl.max) * 100)}%`, borderRadius: 999, backgroundColor: c }} />
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: M.ink, lineHeight: 1.45 }}>{rm(pl.outstanding)} still to ship of {rm(pl.confirmed)} confirmed · {periodText}.</div>
          {sep}
          <Label>BY STATUS · LIVE, ALL ORDERS</Label>
          {so?.byStatus ? (
            <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
              {PIPELINE_STATUSES.map(([k, label]) => {
                const cnt = so.byStatus?.[k] ?? 0;
                if (cnt === 0) return null;
                const sen = so.revenueByStatus?.[k] ?? 0;
                const d = daysOf(k, sen);
                return (
                  <div key={k}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: M.raisin }}>{label}</span>
                      <span style={{ flex: "none", fontSize: 14, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", ...TNUM }}>{rm(sen)}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
                      <div style={{ flex: 1, height: 8, borderRadius: 999, backgroundColor: M.divider, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${Math.max(2.5, (cnt / maxN) * 100)}%`, borderRadius: 999, backgroundColor: k === "ON_HOLD" ? "#DC2626" : DATA.prod }} />
                      </div>
                      <span style={{ flex: "none", fontSize: 11.5, color: M.ink, whiteSpace: "nowrap", ...TNUM }}>{cnt.toLocaleString()} SO{d != null ? ` · ≈ ${d.toFixed(1)} d` : ""}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <SectionState kind={data.soStats.loading ? "loading" : "error"} onRetry={data.refresh} minHeight={80} text={data.soStats.loading ? undefined : "Could not load the status breakdown."} />
          )}
          {sep}
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
            <Label>PER WORKING DAY</Label>
            {perDay ? <span style={{ fontSize: 11.5, color: M.ink }}>avg over {perDay.days} day{perDay.days === 1 ? "" : "s"}</span> : null}
          </div>
          {perDay ? (
            <>
              <div style={{ marginTop: 6 }}>
                {([["Orders in", perDay.orders, DATA.so], ["Production", perDay.production, DATA.prod], ["Invoiced", perDay.invoiced, DATA.inv]] as const).map(([l, v, c]) => (
                  <div key={l} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 32 }}>
                    <span aria-hidden="true" style={{ width: 8, height: 8, flex: "none", borderRadius: "50%", backgroundColor: c }} />
                    <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: M.raisin }}>{l}</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", ...TNUM }}>{rm(v)}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: M.ink, lineHeight: 1.45 }}>{perDayNote(perDay)}</div>
            </>
          ) : (
            <div style={{ marginTop: 6, fontSize: 12, color: M.ink }}>No activity recorded in this period yet.</div>
          )}
        </>
      )}
    </HCard>
  );
}

// ---------------------------------------------------------------------------
// Sales Forecast
// ---------------------------------------------------------------------------
const TONE_COLOR: Record<ReturnType<typeof fcTone>, string> = { hit: DATA.moss, missed: DATA.amber, "so-far": DATA.so, none: DATA.noTarget, future: DATA.future };
const kRM = (sen: number) => `RM ${Math.round(sen / 100 / 1000).toLocaleString("en-MY")}k`;
const kRMexact = (sen: number) => `RM ${Math.round(sen / 100).toLocaleString("en-MY")}`;

export function ForecastCard({
  data, access, period, todayYmd, onLegend,
}: { data: SalesData; access: SalesAccess; period: Period; todayYmd: string; onLegend: () => void }) {
  const unit = forecastUnit(period);
  const [hide, setHide] = useState<{ act: boolean; need: boolean; tgt: boolean }>({ act: false, need: false, tgt: false });
  const [selIdx, setSelIdx] = useState<number | null>(null);
  const rows: FcRow[] = useMemo(
    () => buildForecast(unit, data.invoices.data?.data ?? [], data.forecast.data?.data?.months ?? {}, todayYmd),
    [unit, data.invoices.data, data.forecast.data, todayYmd],
  );
  const noTargetAccess = !access.accounting || (!data.forecast.data && !!data.forecast.failure);
  const noneKeyed = !!data.forecast.data && rows.every((r) => r.targetSen == null);
  const cur = rows.find((r) => r.inProgress) ?? null;
  const fsel = selIdx != null && selIdx < rows.length ? selIdx : rows.findIndex((r) => r.inProgress);
  const sel = fsel >= 0 ? rows[fsel] : rows[rows.length - 1];

  const sub =
    `By ${unit} · actual = invoiced · target = Forecast P&L` +
    (noTargetAccess ? " · the target needs Accounting access" : noneKeyed ? " · no sales keyed in Forecast P&L yet" : "");

  const body = () => {
    if (!access.invoices) return <SectionState kind="restricted" text="The forecast actuals need Invoices access." minHeight={140} />;
    if (data.invoices.loading && !data.invoices.data) return <SectionState kind="loading" minHeight={220} />;
    if (!data.invoices.data) return <SectionState kind="error" onRetry={data.refresh} text="Could not load invoiced sales." minHeight={140} />;
    if (rows.length === 0) return <SectionState kind="empty" text="No invoices yet." minHeight={140} />;
    const rawF = Math.max(1, ...rows.map((f) => Math.max(f.actualSen, f.targetSen ?? 0)));
    const { step, max: FM } = niceAxis(rawF);
    const tPts = rows.map((f, i) => (f.targetSen == null ? null : ([((i + 0.5) / rows.length) * 100, 100 - (f.targetSen / FM) * 100] as [number, number]))).filter((p): p is [number, number] => p != null);
    return (
      <>
        {cur && cur.targetSen != null ? (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
              <Label style={{ whiteSpace: "nowrap" }}>{`${cur.full} · INVOICED SO FAR`.toUpperCase()}</Label>
              <span style={{ fontSize: 14, fontWeight: 700, color: cur.actualSen >= cur.targetSen ? DATA.moss : M.taupe, ...TNUM }}>{Math.round((cur.actualSen / cur.targetSen) * 100)}%</span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
              <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.2, color: M.raisin, ...TNUM }}>{kRM(cur.actualSen)}</span>
              <span style={{ fontSize: 12, color: M.ink, ...TNUM }}>of {kRM(cur.targetSen)} target</span>
            </div>
            <div style={{ height: 8, marginTop: 8, borderRadius: 999, backgroundColor: M.divider, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.min(100, (cur.actualSen / cur.targetSen) * 100)}%`, borderRadius: 999, backgroundColor: cur.actualSen >= cur.targetSen ? DATA.moss : M.taupe }} />
            </div>
          </div>
        ) : null}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", marginTop: 14 }}>
          <LegendToggle label="Invoiced" on={!hide.act} onToggle={() => setHide((h) => ({ ...h, act: !h.act }))} swatch={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: DATA.moss }} />
          <LegendToggle label="Still needed" on={!hide.need} onToggle={() => setHide((h) => ({ ...h, need: !h.need }))} swatch={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: M.divider, boxShadow: `inset 0 0 0 1px ${M.hairline}` }} />
          {!noTargetAccess ? <LegendToggle label="Target" on={!hide.tgt} onToggle={() => setHide((h) => ({ ...h, tgt: !h.tgt }))} swatch={{ width: 16, height: 0, borderTop: `2px dashed ${DATA.teal}` }} /> : null}
        </div>
        <div style={{ position: "relative", height: 180, marginTop: 12, paddingLeft: 34 }}>
          <div aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 30, fontSize: 11, color: M.ink, textAlign: "right", ...TNUM }}>
            {[4, 3, 2, 1, 0].map((i) => <span key={i} style={{ position: "absolute", right: 0, top: `${(4 - i) * 25}%`, lineHeight: "10px", transform: "translateY(-5px)", whiteSpace: "nowrap" }}>{i ? axisK((step * i) / 100) : "0"}</span>)}
          </div>
          <div style={{ position: "relative", height: "100%" }}>
            <div aria-hidden="true" style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              {[4, 3, 2, 1, 0].map((i) => <span key={i} style={{ height: 1, backgroundColor: i ? M.divider : M.hairline }} />)}
            </div>
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "flex-end", gap: 6 }}>
              {rows.map((f, i) => {
                const on = i === fsel;
                const need = !hide.need && f.inProgress && f.targetSen != null && f.targetSen > f.actualSen ? f.targetSen - f.actualSen : 0;
                const base = hide.act ? 0 : f.projected ? (f.targetSen ?? 0) : f.actualSen;
                return (
                  <button key={f.iso} type="button" onClick={() => setSelIdx(i)} aria-pressed={on}
                    aria-label={`${f.full}: invoiced ${kRMexact(f.actualSen)}${f.targetSen != null ? `, target ${kRMexact(f.targetSen)}` : ", no target keyed"}`}
                    style={{ flex: 1, minWidth: 0, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", padding: 0, border: "none", borderRadius: 6, backgroundColor: on ? "rgba(107,92,50,.07)" : "transparent", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                    <span aria-hidden="true" style={{ display: "block", width: "70%", maxWidth: 24, height: `${(need / FM) * 100}%`, boxSizing: "border-box", border: `1px dashed ${M.faint}`, borderBottom: "none", borderRadius: "4px 4px 0 0", backgroundColor: M.divider }} />
                    <span style={{ display: "block", width: "70%", maxWidth: 24, height: `${(base / FM) * 100}%`, borderRadius: need ? 0 : "4px 4px 0 0", backgroundColor: TONE_COLOR[fcTone(f)] }} />
                  </button>
                );
              })}
            </div>
            {!hide.tgt && !noTargetAccess && tPts.length ? (
              <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }} aria-hidden="true">
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}>
                  <polyline points={tPts.map((p) => p.join(",")).join(" ")} fill="none" stroke={DATA.teal} strokeWidth={2} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
                </svg>
                {tPts.map((p, i) => <span key={i} style={{ position: "absolute", left: `${p[0]}%`, top: `${p[1]}%`, width: 7, height: 7, marginLeft: -3.5, marginTop: -3.5, borderRadius: "50%", backgroundColor: M.card, boxShadow: `0 0 0 2px ${DATA.teal}` }} />)}
              </div>
            ) : null}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 6, paddingLeft: 34 }}>
          {rows.map((f, i) => (
            <span key={f.iso} style={{ flex: 1, minWidth: 0, textAlign: "center", fontSize: 11, fontWeight: i === fsel ? 700 : 500, color: i === fsel ? M.raisin : M.ink, whiteSpace: "nowrap", overflow: "hidden" }}>
              {/* Home v10 labels month buckets with the short month only; the year is in the detail line below. */}
              {unit === "month" ? f.label.slice(0, 3) : f.label}
            </span>
          ))}
        </div>
        {sel ? (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${M.divider}` }}>
            <span aria-hidden="true" style={{ width: 8, height: 8, flex: "none", marginTop: 5, borderRadius: 2, backgroundColor: TONE_COLOR[fcTone(sel)] }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: M.raisin }}>{sel.full}{sel.inProgress ? " · in progress" : sel.projected ? " · projected" : ""}</div>
              <div style={{ fontSize: 12, color: M.ink, marginTop: 2, lineHeight: 1.4 }}>
                {noTargetAccess ? "Target needs Accounting access" : sel.targetSen != null ? `Target ${kRM(sel.targetSen)}${sel.inProgress && sel.targetSen > sel.actualSen ? ` · still needed ${kRM(sel.targetSen - sel.actualSen)}` : ""}` : "No target keyed in Forecast P&L"}
              </div>
              {!noTargetAccess ? (() => {
                const st = sel.projected ? ["Projected", M.divider, M.ink] : sel.targetSen == null ? ["No target keyed", M.divider, M.ink]
                  : sel.actualSen >= sel.targetSen ? ["On / above target", "#EEF3E4", "#3D6229"] : sel.inProgress ? ["In progress", "#F4EFE6", "#6B5C32"] : ["Below target", "#FAEFCB", "#85600F"];
                return (
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 5, height: 22, padding: "0 8px", borderRadius: 999, backgroundColor: st[1], color: st[2], fontSize: 11, fontWeight: 700 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: st[2] }} />{st[0]}
                  </div>
                );
              })() : null}
            </div>
            <span style={{ flex: "none", fontSize: 14, fontWeight: 700, color: !sel.inProgress && !sel.projected && sel.targetSen != null && sel.actualSen < sel.targetSen ? DATA.amber : M.raisin, whiteSpace: "nowrap", ...TNUM }}>{sel.projected ? "—" : kRM(sel.actualSen)}</span>
          </div>
        ) : null}
      </>
    );
  };

  return (
    <HCard
      label="Sales forecast" title="Sales Forecast" sub={sub}
      right={<button type="button" onClick={onLegend} aria-label="Chart key" style={{ flex: "none", width: 32, height: 32, margin: "-6px -8px 0 0", border: "none", background: "none", padding: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: M.gold }}><Info size={16} strokeWidth={2} aria-hidden="true" /></button>}
    >
      {body()}
    </HCard>
  );
}

