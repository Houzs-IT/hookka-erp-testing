// Home Operations v3 · Output & Cost, part 2: Purchasing, Fabric Usage, Material shortage.
// Visual + interaction source: the approved Home Operations HTML (cards AND every opened detail). Data and rules: desktop
// dashboards/PurchasingPanel.tsx, dashboard-b/index.tsx (fabric), OperationsView.tsx (shortage). Purchasing spend / share / chart /
// suppliers read the supplier invoices, so they are shown only to a reader with invoices access (owner decision D1).
import { useMemo, useState, type ReactNode } from "react";
import { Boxes, ChevronRight, ClipboardList, PackageX, Percent, ReceiptText, Scissors, ShoppingBag, Building2, type LucideIcon } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { formatCurrency } from "@/lib/utils";
import { M } from "../../theme";
import { statusOf } from "../../lib/procurement-mobile";
import { dayLabel, monthLabel, widgetPeriodLabel, type Period } from "../../../dashboards/dashboard-shared-lib";
import { pill as tonePill } from "../delivery/ui-tokens";
import { SheetFrame } from "./home-ui";
import { TNUM } from "./home-style";
import type { OpsData } from "./ops-data";
import { axisRm, fabricRows, fabricTrend, n0, pct1, purchasingCalc, shortageSummary, stockTake, type FabGran, type FabMode } from "./ops-lib";
import { C, CAT } from "./ops-style";
import { StatusBlock } from "./ops-ui";
import { OGCard, LiveTag, ONote, PillButton } from "./ops-glass";
import { ChipRow, DCard, DCards, MiniChip, NoteList, SecRule, SumPanel, SumTile, TableCard, TileGrid } from "./ops-sheet-kit";
import { CapsLabel, ChartPanel, LegendToggle, OcSeg } from "./ops-oc-kit";
import { CREAM, OCHRE, ROW_LINE, mixInto } from "./ops-oc-style";
import { G } from "./sales-glass";

const rm = (sen: number) => formatCurrency(Math.round(sen));
type Po = { id?: string; poNo?: string | null; supplierName?: string | null; orderDate?: string | null; totalSen?: number | string | null; status: string };
type Tone = "info" | "success" | "warning" | "neutral" | "danger";
const RAIL: Record<Tone, string> = { info: "#3E6570", success: "#4F7C3A", warning: "#C9A24B", neutral: "#A08C5B", danger: "#9A3A2D" };
const date = (iso: string | null | undefined) => (iso ? dayLabel(String(iso).slice(0, 10)) : "—");

// ---------------------------------------------------------------------------
// Purchasing
// ---------------------------------------------------------------------------
function SpendChart({ trend, show, pctMax }: { trend: ReturnType<typeof purchasingCalc>["trend"]; show: { spend: boolean; exp: boolean; pct: boolean }; pctMax: number }) {
  const W = 340; const H = 160;
  const X0 = 36; const X1 = 306;
  const pmx = Math.max(1, ...trend.flatMap((t) => [t.spend, t.expected ?? 0])) * 1.12;
  const bw = (X1 - X0) / Math.max(trend.length, 1);
  const py = (v: number) => 8 + (H - 30) * (1 - v / pmx);
  const pp = (p: number) => 8 + (H - 30) * (1 - p / pctMax);
  const cx = (i: number) => X0 + i * bw + bw / 2;
  const line = (f: (t: (typeof trend)[number]) => number | null, y: (v: number) => number) => trend.map((t, i) => { const v = f(t); return v == null ? null : `${cx(i)},${y(v)}`; }).filter(Boolean).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={X0} x2={X1} y1={py(pmx * f)} y2={py(pmx * f)} stroke={M.divider} />
          <text x={X0 - 4} y={py(pmx * f) + 3} textAnchor="end" style={{ fontSize: "9px", fill: M.muted }}>{axisRm(pmx * f)}</text>
          <text x={X1 + 4} y={pp(pctMax * f) + 3} textAnchor="start" style={{ fontSize: "9px", fill: M.muted }}>{`${Math.round(pctMax * f)}%`}</text>
        </g>
      ))}
      {trend.map((t, i) => (
        <g key={t.ym}>
          {show.spend ? <rect x={X0 + i * bw + bw * 0.25} y={py(t.spend)} width={bw * 0.5} height={Math.max(0, H - 22 - py(t.spend))} rx={3} fill="#6B5C32" /> : null}
          <text x={cx(i)} y={154} textAnchor="middle" style={{ fontSize: "9px", fill: M.muted }}>{monthLabel(t.ym).slice(0, 3)}</text>
        </g>
      ))}
      {show.exp ? (
        <>
          <polyline points={line((t) => t.expected, py)} fill="none" stroke="#3E6570" strokeWidth={2} strokeDasharray="5 4" />
          {trend.map((t, i) => (t.expected == null ? null : <circle key={`e${t.ym}`} cx={cx(i)} cy={py(t.expected)} r={3} fill="#FFFFFF" stroke="#3E6570" strokeWidth={2} />))}
        </>
      ) : null}
      {show.pct ? (
        <>
          <polyline points={line((t) => t.share, pp)} fill="none" stroke="#C9A24B" strokeWidth={2.5} />
          {trend.map((t, i) => (t.share == null ? null : <circle key={`p${t.ym}`} cx={cx(i)} cy={pp(t.share)} r={3} fill="#C9A24B" />))}
        </>
      ) : null}
    </svg>
  );
}

type DRow = { key: string; title: string; pill?: { text: string; bg: string; fg: string }; sub?: string; bar?: { frac: number; color: string; label: string }; chips: { k: string; v: string; dot: string }[]; tone: Tone };

/** One rail-and-tint row card of a Purchasing detail (design: title + pill, supplier line, bar, two value chips). */
function PuRow({ r }: { r: DRow }) {
  return (
    <DCard rail={RAIL[r.tone]}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, color: M.raisin, overflowWrap: "anywhere", ...TNUM }}>{r.title}</span>
        {r.pill ? <span style={{ flex: "none", height: 22, display: "inline-flex", alignItems: "center", padding: "0 9px", borderRadius: 999, background: r.pill.bg, color: r.pill.fg, fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap", ...TNUM }}>{r.pill.text}</span> : null}
      </div>
      {r.sub ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, fontSize: 12, color: M.ink }}>
          <Building2 size={13} strokeWidth={2} color="#8B7A4E" aria-hidden="true" /><span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{r.sub}</span>
        </div>
      ) : null}
      {r.bar ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
          <span aria-hidden="true" style={{ flex: 1, height: 6, borderRadius: 999, background: M.divider, overflow: "hidden" }}><span style={{ display: "block", height: "100%", width: `${Math.max(0, Math.min(1, r.bar.frac)) * 100}%`, borderRadius: 999, background: r.bar.color }} /></span>
          <span style={{ flex: "none", fontSize: 11, color: M.ink, whiteSpace: "nowrap" }}>{r.bar.label}</span>
        </div>
      ) : null}
      <ChipRow cols={2}>{r.chips.map((c) => <MiniChip key={c.k} k={c.k} v={c.v} dot={c.dot} />)}</ChipRow>
    </DCard>
  );
}

/** The shared body of the four Purchasing details: summary panel, a titled list of row cards (first 5, then "Show all"), notes. */
function PuSheet({ icon, scope, scope2, tiles, head, sort, rows, none, notes, total }: {
  icon: LucideIcon; scope: string; scope2: string; tiles: { k: string; v: string; tone: string; color?: string }[]; head: string; sort: string;
  rows: DRow[]; none: string; notes: ReactNode[]; total?: { k: string; a: string; b: string };
}) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 5);
  return (
    <>
      <SumPanel icon={icon} scope={scope} scope2={scope2}>
        <TileGrid>{tiles.map((t) => <SumTile key={t.k} k={t.k} v={t.v} tone={t.tone} big={16} valueColor={t.color} />)}</TileGrid>
      </SumPanel>
      <SecRule label={head} hint={sort} />
      {rows.length === 0 ? <div style={{ padding: "22px 0", textAlign: "center", fontSize: 13, color: M.ink }}>{none}</div> : null}
      <DCards>{shown.map((r) => <PuRow key={r.key} r={r} />)}</DCards>
      {rows.length > 5 ? <PillButton label={all ? "Show fewer" : `Show all ${rows.length}`} expanded={all} onClick={() => setAll((v) => !v)} /> : null}
      {total ? (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto", gap: 12, alignItems: "center", marginTop: 10, padding: "12px 14px", borderRadius: 14, background: "#3A352C", color: "#FFFFFF", ...TNUM }}>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase" }}>{total.k}</span>
          <span style={{ fontSize: 12, color: "#D9D2C5", whiteSpace: "nowrap" }}>{total.a}</span>
          <span style={{ fontSize: 13.5, fontWeight: 800, whiteSpace: "nowrap" }}>{total.b}</span>
        </div>
      ) : null}
      <NoteList lines={notes} />
    </>
  );
}

function PoSheetBody({ allowed, count, items, valueSen }: { allowed: boolean; count: number | null; items: number | null; valueSen: number | null }) {
  const { data, failure } = useCachedJson<{ data?: Po[] }>(allowed ? "/api/purchase-orders" : null);
  if (!allowed) return <StatusBlock status="denied" what="The purchase-order list" need="purchase-orders access" />;
  if (!data) return <StatusBlock status={failure ? (failure.status === 403 ? "denied" : "error") : "loading"} what="The purchase-order list" need="purchase-orders access" />;
  const list = (data.data ?? []).filter((p) => !["RECEIVED", "CLOSED", "CANCELLED"].includes(p.status)).sort((a, b) => String(b.orderDate ?? "").localeCompare(String(a.orderDate ?? "")));
  const rows: DRow[] = list.map((p, i) => {
    const st = statusOf("po", p.status);
    const pl = tonePill(st.tone);
    return { key: `${p.poNo ?? i}`, title: p.poNo ?? "—", pill: { text: st.label, bg: pl.bg, fg: pl.fg }, sub: p.supplierName ?? "—", tone: st.tone, chips: [{ k: "Ordered", v: date(p.orderDate), dot: "#A08C5B" }, { k: "Value", v: rm(Number(p.totalSen) || 0), dot: "#6B5C32" }] };
  });
  return (
    <PuSheet icon={ClipboardList} scope="Open POs" scope2={items == null ? `${list.length} listed` : `${n0(items)} items still to arrive`}
      tiles={[{ k: "POs open", v: String(count ?? list.length), tone: "#3E6570" }, { k: "Outstanding value", v: valueSen == null ? "—" : rm(valueSen), tone: "#6B5C32" }]}
      head="PURCHASE ORDERS" sort="Newest first" rows={rows} none="No open purchase orders." notes={["Received, closed and cancelled POs are left out"]} />
  );
}

type Drill = "spend" | "share" | "po" | "stock" | null;

function PuTile({ icon: Icon, k, v, vc, c, tint, s1, s2, onClick, disabled }: { icon: LucideIcon; k: string; v: string; vc: string; c: string; tint: string; s1?: string; s2?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={`${k}: ${v}.${disabled ? "" : " View detail"}`}
      style={{ minWidth: 0, display: "grid", gridTemplateRows: "minmax(28px,auto) 20px auto", rowGap: 6, textAlign: "left", padding: "10px 10px 10px 12px", border: "none", borderRadius: 14, background: `linear-gradient(150deg,${M.card} 50%,${mixInto(tint, 12)})`, boxShadow: `inset 0 1px 0 ${M.card}, inset 0 0 0 1px rgba(31,29,27,.05), 0 8px 18px -14px rgba(107,92,50,.35)`, fontFamily: "inherit", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.85 : 1, WebkitTapHighlightColor: "transparent" }}>
      <span style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
        <span aria-hidden="true" style={{ flex: "none", display: "flex", height: 14, alignItems: "center" }}><Icon size={13} strokeWidth={2.2} color={c} /></span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 10.5, lineHeight: "14px", fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", color: M.taupe }}>{k}</span>
        {!disabled ? <span aria-hidden="true" style={{ flex: "none", display: "flex", height: 14, alignItems: "center" }}><ChevronRight size={14} strokeWidth={2.2} color={c} /></span> : null}
      </span>
      <span style={{ fontSize: 15, lineHeight: "20px", fontWeight: 800, color: vc, whiteSpace: "nowrap", ...TNUM }}>{v}</span>
      <span style={{ display: "flex", flexDirection: "column", gap: 1, fontSize: 11, lineHeight: "15px", color: M.ink }}><span>{s1}</span><span>{s2}</span></span>
    </button>
  );
}

export function PurchasingCard({ d, period, today, canPo }: { d: OpsData; period: Period; today: string; canPo: boolean }) {
  const [drill, setDrill] = useState<Drill>(null);
  const [show, setShow] = useState({ spend: true, exp: true, pct: true });
  const pm = d.pm;
  const invOk = d.pis.status === "ready";
  const revOk = d.revenue.status === "ready";
  const calc = useMemo(() => purchasingCalc({ pis: d.pis.rows, revByDay: revOk ? d.revenue.byDay : null, months: pm.months, prevMonths: pm.prevMonths, trendMonths: pm.trendMonths }), [d.pis.rows, d.revenue.byDay, revOk, pm]);
  const stock = useMemo(() => stockTake(d.cost.sets[1], today), [d.cost.sets, today]);
  const ov = d.overview.data?.purchasing;
  const label = widgetPeriodLabel(period);
  const live = !period.day && pm.months.includes(today.slice(0, 7));
  const pctMax = Math.max(60, Math.ceil(Math.max(0, ...calc.trend.map((t) => t.share ?? 0)) / 10) * 10);
  const close = () => setDrill(null);

  const word = (s: typeof d.pis.status, ok: string): string => (s === "ready" ? ok : s === "denied" ? "No access" : s === "error" ? "Couldn’t load" : "…");
  const need = (s: typeof d.pis.status, need: string): string | undefined => (s === "denied" ? `Needs ${need}` : s === "error" ? "Try again later" : undefined);
  const worse = invOk && revOk && calc.share != null && calc.prevShare != null && calc.share > calc.prevShare;
  const better = invOk && revOk && calc.share != null && calc.prevShare != null && calc.share <= calc.prevShare;
  const stockChange = stock?.prevSen ? `${stock.sen >= stock.prevSen ? "▲" : "▼"} ${Math.abs(((stock.sen - stock.prevSen) / stock.prevSen) * 100).toFixed(0)}% vs ${monthLabel(stock.prevYm ?? "").slice(0, 3)}` : undefined;

  return (
    <>
      <OGCard icon={ShoppingBag} title="Purchasing" sub={`Supplier invoices by invoice date${live ? " (to date)" : ""} · ${label}`} label="Purchasing" id="ops-purchasing">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>
          <PuTile icon={ReceiptText} k="Invoiced spend" v={word(d.pis.status, rm(calc.spend))} vc={M.raisin} c="#6B5C32" tint="#C9A961" disabled={!invOk} onClick={() => setDrill("spend")}
            s1={invOk ? (calc.change == null ? "no previous period" : `${calc.change >= 0 ? "▲" : "▼"} ${Math.abs(calc.change).toFixed(0)}% vs before`) : need(d.pis.status, "invoices access")} s2={invOk && calc.change != null ? rm(calc.prevSpend) : undefined} />
          <PuTile icon={Percent} k="% of production revenue" v={!invOk ? word(d.pis.status, "") : revOk ? pct1(calc.share) : word(d.revenue.status, "")} disabled={!invOk || !revOk} onClick={() => setDrill("share")}
            vc={worse ? C.danger : better ? C.ok : M.raisin} c={worse ? "#9A3A2D" : better ? "#4F7C3A" : "#6B5C32"} tint={worse ? "#9A3A2D" : better ? "#4F7C3A" : "#C9A961"}
            s1={invOk && revOk && calc.prevShare != null ? "previous period" : !invOk ? need(d.pis.status, "invoices access") : undefined} s2={invOk && revOk && calc.prevShare != null ? pct1(calc.prevShare) : undefined} />
          <PuTile icon={ClipboardList} k="Outstanding POs" v={d.overview.status !== "ready" ? word(d.overview.status, "") : ov ? rm(ov.outstandingPOValueSen) : "—"} vc={M.raisin} c="#3E6570" tint="#3E6570" disabled={d.overview.status !== "ready" || !ov} onClick={() => setDrill("po")}
            s1={ov ? `${n0(ov.openPOCount)} POs open` : d.overview.status === "ready" ? "not returned" : undefined} s2={ov ? `${n0(ov.itemsPendingReceipt)} items still to arrive` : undefined} />
          <PuTile icon={Boxes} k="Raw material stock" v={d.cost.status !== "ready" ? word(d.cost.status, "") : stock ? rm(stock.sen) : "—"} vc={M.raisin} c="#8A6A3B" tint="#8A6A3B" disabled={!stock} onClick={() => setDrill("stock")}
            s1={d.cost.status === "denied" ? "Needs accounting access" : d.cost.status === "ready" ? (stock ? `stock take ${monthLabel(stock.ym)}` : "no stock take recorded yet") : undefined} s2={stock ? stockChange : undefined} />
        </div>

        <ChartPanel pad="12px 10px 10px">
          <CapsLabel>SPEND VS EXPECTED FROM PRODUCTION · LAST 6 MONTHS</CapsLabel>
          {!invOk ? <StatusBlock status={d.pis.status === "ready" ? "loading" : d.pis.status} what="The spend chart" need="invoices access" minHeight={80} /> : !revOk ? <StatusBlock status={d.revenue.status === "ready" ? "loading" : d.revenue.status} what="Production revenue" minHeight={80} onRetry={d.revenue.refresh} /> : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 8, padding: "0 2px" }}>
                <LegendToggle label="Spend" color="#6B5C32" h={9} round={false} on={show.spend} onToggle={() => setShow((s) => ({ ...s, spend: !s.spend }))} />
                <LegendToggle label="Expected from production" color="#3E6570" h={2} round={false} on={show.exp} onToggle={() => setShow((s) => ({ ...s, exp: !s.exp }))} />
                <LegendToggle label="% of production revenue" color="#C9A24B" h={3} round={false} on={show.pct} onToggle={() => setShow((s) => ({ ...s, pct: !s.pct }))} />
              </div>
              <div role="img" aria-label="Purchasing spend vs expected, last 6 months" style={{ position: "relative", width: "100%", height: 160, marginTop: 8 }}><SpendChart trend={calc.trend} show={show} pctMax={pctMax} /></div>
            </>
          )}
        </ChartPanel>

        <CapsLabel top={12}>TOP SUPPLIERS · SHARE OF SPEND</CapsLabel>
        {!invOk ? <StatusBlock status={d.pis.status === "ready" ? "loading" : d.pis.status} what="Top suppliers" need="invoices access" minHeight={70} /> : calc.top.length === 0 ? (
          <div role="status" style={{ padding: "22px 0", textAlign: "center", fontSize: 13, color: M.ink }}>No supplier invoices in this period.</div>
        ) : (
          <div style={{ marginTop: 8, padding: "0 12px", borderRadius: 14, background: M.card, boxShadow: `inset 0 0 0 1px ${M.hairline}`, ...TNUM }}>
            {calc.top.map((s, i) => (
              <div key={s.name} style={{ padding: "10px 0", borderTop: i ? `1px solid ${ROW_LINE}` : "none" }}>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", columnGap: 12, rowGap: 2, alignItems: "baseline" }}>
                  <span style={{ minWidth: 0, fontSize: 12.5, lineHeight: 1.35, fontWeight: 600, color: M.raisin, overflowWrap: "anywhere" }}>{s.name}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", textAlign: "right" }}>{rm(s.sen)}</span>
                  <span style={{ fontSize: 11, color: M.ink }}>{s.n} PI</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: OCHRE, whiteSpace: "nowrap", textAlign: "right" }}>{calc.spend > 0 ? Math.round((s.sen / calc.spend) * 100) : 0}% of spend</span>
                </div>
                <div aria-hidden="true" style={{ height: 4, marginTop: 7, borderRadius: 999, background: M.divider, overflow: "hidden" }}><div style={{ height: "100%", width: `${calc.top[0].sen > 0 ? (s.sen / calc.top[0].sen) * 100 : 0}%`, borderRadius: 999, background: "#6B5C32" }} /></div>
              </div>
            ))}
          </div>
        )}
        <ONote>% = share of production revenue, the same base as Costing. Expected = that month’s production revenue × the purchase % of the 3 months before. Tap a tile for the detail; tap a legend to show or hide it.</ONote>
      </OGCard>

      {drill === "spend" && invOk ? (
        <SheetFrame open title={`Supplier invoices · ${label}`} sub={`${calc.periodPis.length} invoices · ${rm(calc.spend)}`} onClose={close}>
          <PuSheet icon={ReceiptText} scope="Supplier invoices" scope2={label}
            tiles={[{ k: "Invoices", v: String(calc.periodPis.length), tone: "#6B5C32" }, { k: "Invoiced spend", v: rm(calc.spend), tone: "#C9A961" }]}
            head="INVOICES" sort="Newest first" none="No supplier invoices in this period." notes={["By invoice date · cancelled invoices left out"]}
            rows={calc.periodPis.slice(0, 100).map((p, i) => { const st = statusOf("pi", p.status); const pl = tonePill(st.tone); return { key: `${p.piNo ?? i}-${i}`, title: p.piNo ?? "—", pill: { text: st.label, bg: pl.bg, fg: pl.fg }, sub: p.supplierName ?? "—", tone: st.tone, chips: [{ k: "Invoice date", v: date(p.invoiceDate), dot: "#A08C5B" }, { k: "Amount", v: rm(Number(p.amountSen) || 0), dot: "#6B5C32" }] }; })} />
        </SheetFrame>
      ) : null}
      {drill === "share" && invOk && revOk ? (
        <SheetFrame open title="Purchases vs production revenue" sub="By month · last 6 months" onClose={close}>
          <PuSheet icon={Percent} scope="% of production revenue" scope2="last 6 months"
            tiles={[{ k: "This period", v: pct1(calc.share), tone: worse ? "#9A3A2D" : "#4F7C3A", color: worse ? "#9A3A2D" : "#4F7C3A" }, { k: "Previous period", v: pct1(calc.prevShare), tone: "#6B5C32" }]}
            head="BY MONTH" sort="Newest first" none="" notes={["% = purchases ÷ production revenue, the same base as Costing"]}
            rows={[...calc.trend].reverse().map((t) => ({ key: t.ym, title: monthLabel(t.ym), pill: { text: pct1(t.share), bg: CREAM, fg: "#6B5C32" }, tone: "neutral" as Tone, bar: t.share == null ? undefined : { frac: t.share / pctMax, color: "#C9A24B", label: "of production revenue" }, chips: [{ k: "Purchases", v: rm(t.spend), dot: "#6B5C32" }, { k: "Production revenue", v: rm(t.rev), dot: "#3E6570" }] }))} />
        </SheetFrame>
      ) : null}
      {drill === "po" ? (
        <SheetFrame open title="Outstanding purchase orders" sub="Not yet received, closed or cancelled" onClose={close}>
          <PoSheetBody allowed={canPo} count={ov?.openPOCount ?? null} items={ov?.itemsPendingReceipt ?? null} valueSen={ov?.outstandingPOValueSen ?? null} />
        </SheetFrame>
      ) : null}
      {drill === "stock" && stock ? (
        <SheetFrame open title="Raw material stock" sub={`Stock take ${monthLabel(stock.ym)} · closing stock per P&L account`} onClose={close}>
          <PuSheet icon={Boxes} scope="Stock take" scope2={monthLabel(stock.ym)}
            tiles={[{ k: monthLabel(stock.ym), v: rm(stock.sen), tone: "#8A6A3B" }, ...(stock.prevYm ? [{ k: monthLabel(stock.prevYm), v: stock.prevSen == null ? "—" : rm(stock.prevSen), tone: "#6B5C32", color: M.ink }] : [])]}
            head="BY P&L ACCOUNT" sort="Largest first" none="No stock lines." notes={["From the month-end stock take (P&L closing stock)", "Not the live system balance"]}
            total={{ k: "Total", a: stock.prevYm && stock.prevSen != null ? rm(stock.prevSen) : "", b: rm(stock.sen) }}
            rows={stock.lines.map((l) => {
              const ch = l.prevSen ? ((l.sen - l.prevSen) / l.prevSen) * 100 : null;
              return { key: l.name, title: l.name, pill: ch == null ? undefined : { text: `${ch >= 0 ? "▲" : "▼"} ${Math.abs(ch).toFixed(0)}%`, bg: CREAM, fg: "#6B5C32" }, tone: "neutral" as Tone, bar: { frac: stock.sen > 0 ? l.sen / stock.sen : 0, color: "#8A6A3B", label: `${stock.sen > 0 ? Math.round((l.sen / stock.sen) * 100) : 0}% of stock` }, chips: [...(stock.prevYm ? [{ k: monthLabel(stock.prevYm), v: l.prevSen == null ? "—" : rm(l.prevSen), dot: "#D9D2C5" }] : []), { k: monthLabel(stock.ym), v: rm(l.sen), dot: "#8A6A3B" }] };
            })} />
        </SheetFrame>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Fabric usage
// ---------------------------------------------------------------------------
const FAB_CATS = [{ key: "BEDFRAME", label: "Bedframe fabric", title: "Bedframe Fabric", dot: CAT.bedframe, noun: "bedframe" }, { key: "SOFA", label: "Sofa fabric", title: "Sofa Fabric", dot: CAT.sofa, noun: "sofa" }] as const;
const shortLabel = (key: string): string => (/-Q\d$/.test(key) ? `Q${key.slice(6)} ${key.slice(2, 4)}` : `${monthLabel(key).slice(0, 3)} ${key.slice(2, 4)}`);

export function FabricCard({ d, period }: { d: OpsData; period: Period }) {
  const [mode, setMode] = useState<FabMode>("previous");
  const [gran, setGran] = useState<FabGran>("monthly");
  const [cat, setCat] = useState<"BEDFRAME" | "SOFA">("BEDFRAME");
  const { status, data } = d.overview;
  const info = FAB_CATS.find((c) => c.key === cat)!;
  const fab = data?.fabric?.[cat];
  const fc = data?.fabricCostPerMeterSen;
  const next = mode === "next";
  const rows = fabricRows(fab, mode);
  const trend = fabricTrend(fab, gran);
  const maxRowM = Math.max(1, ...rows.map((r) => (next ? r.next30Meters : r.meters)));
  const maxM = Math.max(1, ...trend.map((t) => t.meters));
  const avgCost = fc ? (cat === "BEDFRAME" ? fc.bedframe : fc.sofa) : null;
  const label = widgetPeriodLabel(period);
  // The forecast is metres only: there is no price for metres not yet cut, so no cost is shown for it (owner 2026-11-26).
  const priced = (sen: number | undefined) => (sen != null && sen > 0 ? rm(sen) : "—");

  return (
    <OGCard icon={Scissors} title="Fabric Usage — Bedframe vs Sofa" sub={`${next ? "Forecast — fabric needed next 30 days" : `History — fabric used · ${label}`} · ${gran === "quarterly" ? "quarterly" : "monthly"} trend`} label="Fabric usage" id="ops-fabric">
      {status !== "ready" || !data?.fabric ? (
        <StatusBlock status={status === "ready" ? "error" : status} what="Fabric usage" need="a dashboard view" reason={status === "ready" ? "no fabric figures returned" : undefined} onRetry={d.retryOverview} />
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>
            <OcSeg aria="Previous or next" value={mode} onChange={setMode} options={[["previous", "Previous"], ["next", "Next"]]} />
            <OcSeg aria="Trend" value={gran} onChange={setGran} options={[["monthly", "Monthly"], ["quarterly", "Quarterly"]]} />
          </div>
          {fc ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "14px 2px 8px" }}>
                <Scissors size={13} strokeWidth={2} color={M.taupe} aria-hidden="true" />
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe }}>FABRIC COST / METER</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>
                {[["Overall (all issued)", rm(fc.total), "#C9A961"], ["Excl. Bedframe & Sofa", fc.exclBedframeSofa > 0 ? rm(fc.exclBedframeSofa) : "—", "#8A6A3B"]].map(([l, v, tint]) => (
                  <div key={l} style={{ minWidth: 0, padding: "10px 12px", borderRadius: 14, background: `linear-gradient(150deg,${M.card} 50%,${mixInto(tint, 14)})`, boxShadow: `inset 0 1px 0 ${M.card}, inset 0 0 0 1px rgba(31,29,27,.05), 0 8px 18px -14px rgba(107,92,50,.35)` }}>
                    <div style={{ fontSize: 10.5, lineHeight: "14px", fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", color: M.taupe }}>{l}</div>
                    <div style={{ fontSize: 16, lineHeight: "20px", fontWeight: 800, color: M.raisin, marginTop: 4, whiteSpace: "nowrap", ...TNUM }}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, lineHeight: 1.4, color: M.ink, margin: "6px 2px 0" }}>Weighted avg of fabric actually issued to production (consumption).</div>
            </>
          ) : null}
          <div role="group" aria-label="Category" className="ops-chip-scroll" style={{ display: "flex", gap: 8, marginTop: 16, overflowX: "auto", scrollbarWidth: "none" }}>
            {FAB_CATS.map((c) => {
              const on = c.key === cat;
              return (
                <button key={c.key} type="button" aria-pressed={on} onClick={() => setCat(c.key)}
                  style={{ flex: "none", height: 34, padding: "0 13px", border: "none", borderRadius: 999, background: on ? M.taupe : M.card, color: on ? "#FFFFFF" : M.raisin, boxShadow: on ? "0 6px 14px -6px rgba(107,92,50,.6)" : "0 1px 2px rgba(31,29,27,.06),0 4px 10px -6px rgba(31,29,27,.16)", fontFamily: "inherit", fontSize: 12.5, fontWeight: on ? 700 : 600, cursor: "pointer", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6, WebkitTapHighlightColor: "transparent" }}>
                  <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: c.dot }} />{c.label}
                </button>
              );
            })}
          </div>
          <ChartPanel pad="12px">
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13.5, fontWeight: 700, color: M.raisin }}><span aria-hidden="true" style={{ width: 8, height: 8, flex: "none", borderRadius: "50%", background: info.dot }} />{info.title}</span>
                <span style={{ display: "block", fontSize: 11, lineHeight: 1.4, color: M.ink, marginTop: 2 }}>{next ? "Forecast — next 30 days · metres only" : `Used in ${label} · from Fabric Usage on cut orders · FIFO cost`}</span>
              </span>
              <span style={{ flex: "none", padding: "6px 10px", borderRadius: 10, background: CREAM, textAlign: "right" }}>
                <span style={{ display: "block", fontSize: 9.5, fontWeight: 700, letterSpacing: 0.4, color: M.taupe }}>FIFO COST /M</span>
                <span style={{ display: "block", fontSize: 13.5, fontWeight: 800, color: M.raisin, marginTop: 1, whiteSpace: "nowrap", ...TNUM }}>{next ? "—" : priced(avgCost ?? undefined)}</span>
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 0 8px" }}>
              <span style={{ flex: "none", fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe }}>{next ? "NEXT 30 DAYS · LIVE" : "USED"}</span>
              <span aria-hidden="true" style={{ flex: 1, height: 1, background: "rgba(31,29,27,.08)" }} />
              <span style={{ flex: "none", fontSize: 11, color: M.ink, whiteSpace: "nowrap" }}>Top 10 · most first</span>
            </div>
            {rows.length === 0 ? <div role="status" style={{ padding: "18px 0", textAlign: "center", fontSize: 13, color: M.ink }}>{next ? "No upcoming fabric demand." : "No fabric issued."}</div> : null}
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 8 }}>
              {rows.map((r) => {
                const m = next ? r.next30Meters : r.meters;
                return (
                  <div key={r.fabCode} style={{ padding: "10px 12px", borderRadius: 12, background: M.card, boxShadow: `inset 0 0 0 1px ${M.hairline}` }}>
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: M.raisin, overflowWrap: "anywhere" }}>{r.fabCode}</span>
                      <span style={{ flex: "none", textAlign: "right" }}>
                        <span style={{ display: "block", fontSize: 9.5, fontWeight: 700, letterSpacing: 0.3, color: M.taupe, whiteSpace: "nowrap" }}>{next ? "NEXT 30D · LIVE" : "USED"}</span>
                        <span style={{ display: "block", fontSize: 14, fontWeight: 800, color: next ? M.taupe : M.raisin, whiteSpace: "nowrap", ...TNUM }}>{n0(m)} m</span>
                      </span>
                    </div>
                    <div aria-hidden="true" style={{ height: 4, marginTop: 6, borderRadius: 999, background: M.divider, overflow: "hidden" }}><div style={{ height: "100%", width: `${(m / maxRowM) * 100}%`, borderRadius: 999, background: info.dot }} /></div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 6, marginTop: 8, ...TNUM }}>
                      {[["PAST 30D", `${n0(r.past30Meters)} m`, true, M.raisin], ["FIFO /M", next ? "—" : priced(r.fifoPerMeterSen), false, M.raisin], ["FIFO COST", next ? "—" : priced(r.costSen), false, M.ink]].map(([k, v, liveTag, col]) => (
                        <div key={String(k)} style={{ minWidth: 0, padding: "6px 8px", borderRadius: 8, background: M.paper }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 700, letterSpacing: 0.3, color: M.taupe, whiteSpace: "nowrap" }}>{k}{liveTag ? <span style={{ fontSize: 8.5, color: "#C9A961" }}>LIVE</span> : null}</div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: String(col), marginTop: 2, whiteSpace: "nowrap" }}>{v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "16px 0 4px" }}>
              <span style={{ flex: "none", fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe }}>{gran === "monthly" ? `MONTHLY METERS USED · LAST ${trend.length || 12}` : `QUARTERLY METERS USED · LAST ${trend.length || 0} QUARTER${trend.length === 1 ? "" : "S"}`}</span>
              <span aria-hidden="true" style={{ flex: 1, height: 1, background: "rgba(31,29,27,.08)" }} />
              <span style={{ flex: "none", fontSize: 11, color: M.ink, whiteSpace: "nowrap" }}>Newest first</span>
            </div>
            <div style={{ fontSize: 11, color: M.ink, marginBottom: 8 }}>Meters used · <span style={{ color: OCHRE, fontWeight: 600 }}>FIFO cost /m</span></div>
            {trend.length === 0 ? <div role="status" style={{ padding: "12px 0", textAlign: "center", fontSize: 13, color: M.ink }}>No data.</div> : (
              <div style={{ display: "grid", gap: 10 }}>
                {trend.map((t) => (
                  <div key={t.key} style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, ...TNUM }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: M.raisin, whiteSpace: "nowrap" }}>{shortLabel(t.key)}</span>
                      <span style={{ flex: "none", fontSize: 12.5, fontWeight: 800, color: M.raisin, whiteSpace: "nowrap" }}>{n0(t.meters)} m</span>
                      <span style={{ flex: "none", fontSize: 11, fontWeight: 600, color: OCHRE, whiteSpace: "nowrap" }}>{t.perM == null ? "—" : `${rm(t.perM)}/m`}</span>
                    </div>
                    <div aria-hidden="true" style={{ height: 6, marginTop: 4, borderRadius: 999, background: M.divider, overflow: "hidden" }}><div style={{ height: "100%", width: `${Math.max(2, (t.meters / maxM) * 100)}%`, borderRadius: 999, background: "#2B5797" }} /></div>
                  </div>
                ))}
              </div>
            )}
          </ChartPanel>
          <ONote>Meters = Fabric Usage on the {info.noun} orders cut that month. Cost is first-in-first-out, with the latest stock take as closing stock. Meters with no receipt behind them carry no cost.</ONote>
        </>
      )}
    </OGCard>
  );
}

// ---------------------------------------------------------------------------
// Material shortage
// ---------------------------------------------------------------------------
export function ShortageCard({ d }: { d: OpsData }) {
  const [open, setOpen] = useState(false);
  const { status, reason } = d.inventory;
  const sum = useMemo(() => shortageSummary(d.feed?.inventory?.materialShortage ?? []), [d.feed]);
  if (status !== "ready") {
    return (
      <OGCard icon={PackageX} title="Material shortage" label="Material shortage" id="ops-shortage" divider={false}>
        <div style={{ marginTop: 6 }}><StatusBlock status={status} what="Material shortage" need="inventory access" reason={reason} onRetry={d.retryFeed} minHeight={70} /></div>
      </OGCard>
    );
  }
  const neg = sum.negative > 0;
  const tone = neg ? C.danger : C.ok;
  return (
    <>
      <section id="ops-shortage" aria-label="Material shortage" style={{ margin: "0 -6px", minWidth: 0 }}>
        <button type="button" onClick={() => setOpen(true)} style={{ ...G.card, margin: 0, width: "100%", boxSizing: "border-box", display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", border: "none", fontFamily: "inherit", textAlign: "left", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
          <span aria-hidden="true" style={{ width: 36, height: 36, flex: "none", borderRadius: 11, background: neg ? C.dangerBg : C.okBg, display: "flex", alignItems: "center", justifyContent: "center", color: tone }}>
            <PackageX size={18} strokeWidth={1.9} />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: M.raisin, letterSpacing: -0.2 }}>Material shortage</span><LiveTag />
            </span>
            <span style={{ display: "block", fontSize: 12.5, color: M.ink, marginTop: 3 }}><b style={{ color: tone, ...TNUM }}>{n0(sum.negative)}</b> below zero · {n0(sum.zero)} at exactly zero</span>
          </span>
          <span style={{ flex: "none", fontSize: 13, fontWeight: 700, color: M.taupe, whiteSpace: "nowrap" }}>View list ›</span>
        </button>
      </section>
      {open ? (
        <SheetFrame open title="Material shortage" sub="" onClose={() => setOpen(false)}>
          <NoteList lines={["Below zero first, then items at exactly zero · min stock is not set on raw materials, so this is a balance check"]} />
          <div style={{ height: 12 }} />
          {sum.all.length === 0 ? (
            <div style={{ padding: 22, borderRadius: 14, background: M.card, boxShadow: `inset 0 0 0 1px ${M.hairline}`, textAlign: "center", fontSize: 13, color: M.ink }}>Nothing at zero or below.</div>
          ) : (
            <TableCard>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.05fr) minmax(0,1.3fr) 64px 46px", gap: 8, padding: "9px 12px", background: CREAM, borderBottom: `1px solid ${ROW_LINE}`, fontSize: 10, fontWeight: 700, letterSpacing: 0.4, color: M.taupe }}>
                <span>CODE</span><span>DESCRIPTION</span><span>GROUP</span><span style={{ textAlign: "right" }}>BALANCE</span>
              </div>
              {sum.all.map((m, i) => (
                <div key={`${m.code ?? "x"}-${i}`} style={{ display: "grid", gridTemplateColumns: "minmax(0,1.05fr) minmax(0,1.3fr) 64px 46px", gap: 8, alignItems: "center", padding: "9px 12px", borderTop: i ? `1px solid ${ROW_LINE}` : "none", fontSize: 12, lineHeight: 1.35, ...TNUM }}>
                  <span style={{ minWidth: 0, fontWeight: 600, color: M.raisin, overflowWrap: "anywhere" }}>{m.code ?? "—"}</span>
                  <span style={{ minWidth: 0, color: M.ink, overflowWrap: "anywhere" }}>{m.description ?? "—"}</span>
                  <span style={{ minWidth: 0, fontSize: 11, color: M.ink, overflowWrap: "anywhere" }}>{m.group ?? "—"}</span>
                  <span style={{ textAlign: "right", fontWeight: 700, color: m.balanceQty < 0 ? C.danger : M.muted }}>{String(m.balanceQty)}</span>
                </div>
              ))}
            </TableCard>
          )}
        </SheetFrame>
      ) : null}
    </>
  );
}
