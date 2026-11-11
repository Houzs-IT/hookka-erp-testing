// Home Operations · Output & Cost, part 2: Purchasing, Fabric Usage, Material shortage.
// Visual + interaction source: the approved Home Operations HTML. Data and rules: desktop dashboards/PurchasingPanel.tsx,
// dashboard-b/index.tsx (fabric), OperationsView.tsx (shortage). Purchasing spend / share / chart / suppliers read the
// supplier invoices, so they are shown only to a reader with invoices access (owner decision D1).
import { useMemo, useState } from "react";
import { PackageX } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { formatCurrency } from "@/lib/utils";
import { M } from "../../theme";
import { monthLabel, widgetPeriodLabel, type Period } from "../../../dashboards/dashboard-shared-lib";
import { SheetFrame } from "./home-ui";
import { NOWRAP_ELLIPSIS, TNUM } from "./home-style";
import type { OpsData } from "./ops-data";
import { axisRm, fabricRows, fabricTrend, n0, pct1, purchasingCalc, shortageSummary, stockTake, type FabGran, type FabMode } from "./ops-lib";
import { C, CAT, SHADOW_SECTION } from "./ops-style";
import { Bar, Chev, ChipScroll, IconTile, LegendPill, OCard, OHead, PeriodText, SectionLabel, Seg, StatusBlock, TableSheet, Tag } from "./ops-ui";

const rm = (sen: number) => formatCurrency(Math.round(sen));
const num = (sen: number) => rm(sen).replace(/^RM\s*/, "");
type Po = { poNo?: string | null; supplierName?: string | null; orderDate?: string | null; totalSen?: number | string | null; status: string };

// ---------------------------------------------------------------------------
// Purchasing
// ---------------------------------------------------------------------------
function SpendChart({ trend, show }: { trend: ReturnType<typeof purchasingCalc>["trend"]; show: { spend: boolean; exp: boolean; pct: boolean } }) {
  const W = 340; const H = 150;
  const pmx = Math.max(1, ...trend.flatMap((t) => [t.spend, t.expected ?? 0])) * 1.12;
  const pctMax = Math.max(60, Math.ceil(Math.max(0, ...trend.map((t) => t.share ?? 0)) / 10) * 10);
  const pbw = (W - 40) / trend.length;
  const ppy = (v: number) => 8 + (H - 28) * (1 - v / pmx);
  const ppp = (p: number) => 8 + (H - 28) * (1 - p / pctMax);
  const line = (f: (t: (typeof trend)[number]) => number | null, y: (v: number) => number) => trend.map((t, i) => { const v = f(t); return v == null ? null : `${34 + i * pbw + pbw / 2},${y(v)}`; }).filter(Boolean).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={34} x2={334} y1={ppy(pmx * f)} y2={ppy(pmx * f)} stroke={M.divider} />
          <text x={30} y={ppy(pmx * f) + 3} textAnchor="end" style={{ fontSize: "9px", fill: M.muted }}>{axisRm(pmx * f)}</text>
        </g>
      ))}
      {trend.map((t, i) => (
        <g key={t.ym}>
          {show.spend ? <rect x={34 + i * pbw + pbw * 0.25} y={ppy(t.spend)} width={pbw * 0.5} height={Math.max(0, H - 20 - ppy(t.spend))} rx={3} fill="#1F1D1B" /> : null}
          <text x={34 + i * pbw + pbw / 2} y={145} textAnchor="middle" style={{ fontSize: "9px", fill: M.muted }}>{monthLabel(t.ym).slice(0, 3)}</text>
        </g>
      ))}
      {show.exp ? <polyline points={line((t) => t.expected, ppy)} fill="none" stroke={C.teal} strokeWidth={2} strokeDasharray="5 4" /> : null}
      {show.pct ? <polyline points={line((t) => t.share, ppp)} fill="none" stroke="#C9A961" strokeWidth={2.5} /> : null}
    </svg>
  );
}

function PoSheet({ allowed }: { allowed: boolean }) {
  const { data, failure } = useCachedJson<{ data?: Po[] }>(allowed ? "/api/purchase-orders" : null);
  if (!allowed) return <StatusBlock status="denied" what="The purchase-order list" need="purchase-orders access" />;
  if (!data) return <StatusBlock status={failure ? (failure.status === 403 ? "denied" : "error") : "loading"} what="The purchase-order list" need="purchase-orders access" />;
  const rows = (data.data ?? []).filter((p) => !["RECEIVED", "CLOSED", "CANCELLED"].includes(p.status));
  return (
    <TableSheet grid="auto minmax(0,1fr) auto auto" head={[{ t: "PO" }, { t: "Supplier" }, { t: "Ordered", right: true }, { t: "Value", right: true }]} none="No open purchase orders."
      rows={rows.map((p) => ({ cells: [{ t: p.poNo ?? "—", w: 600 }, { t: p.supplierName ?? "—" }, { t: String(p.orderDate ?? "").slice(5, 10), right: true }, { t: rm(Number(p.totalSen) || 0), right: true, w: 700 }] }))} />
  );
}

type Drill = "spend" | "share" | "po" | "stock" | null;
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

  const word = (s: typeof d.pis.status, ok: string): string => (s === "ready" ? ok : s === "denied" ? "No access" : s === "error" ? "Couldn’t load" : "…");
  const subOf = (s: typeof d.pis.status, ok: string | undefined, need: string): string | undefined => (s === "denied" ? `Needs ${need}` : s === "error" ? "Try again later" : s === "ready" ? ok : undefined);

  const tiles: { l: string; v: string; c: string; s?: string; on?: () => void; disabled?: boolean }[] = [
    { l: "Invoiced spend", v: word(d.pis.status, rm(calc.spend)), c: M.raisin, disabled: !invOk, on: () => setDrill("spend"),
      s: subOf(d.pis.status, calc.change == null ? "no previous period" : `${calc.change >= 0 ? "▲" : "▼"} ${Math.abs(calc.change).toFixed(0)}% vs ${rm(calc.prevSpend)} before`, "invoices access") },
    { l: "% of production revenue", v: !invOk ? word(d.pis.status, "") : revOk ? pct1(calc.share) : word(d.revenue.status, ""), disabled: !invOk || !revOk, on: () => setDrill("share"),
      c: invOk && revOk && calc.share != null && calc.prevShare != null ? (calc.share > calc.prevShare ? C.danger : C.ok) : M.raisin,
      s: invOk && revOk && calc.prevShare != null ? `previous period ${pct1(calc.prevShare)}` : !invOk ? subOf(d.pis.status, undefined, "invoices access") : undefined },
    { l: "Outstanding POs", v: d.overview.status !== "ready" ? word(d.overview.status, "") : ov ? rm(ov.outstandingPOValueSen) : "—", c: M.raisin, disabled: d.overview.status !== "ready" || !ov, on: () => setDrill("po"),
      s: ov ? `${n0(ov.openPOCount)} POs open · ${n0(ov.itemsPendingReceipt)} items still to arrive` : d.overview.status === "ready" ? "not returned" : undefined },
    { l: "Raw material stock", v: d.cost.status !== "ready" ? word(d.cost.status, "") : stock ? rm(stock.sen) : "—", c: M.raisin, disabled: !stock, on: () => setDrill("stock"),
      s: d.cost.status === "denied" ? "Needs accounting access" : d.cost.status === "ready" ? (stock ? `stock take ${monthLabel(stock.ym)}${stock.prevSen ? ` · ${stock.sen >= stock.prevSen ? "▲" : "▼"} ${Math.abs(((stock.sen - stock.prevSen) / stock.prevSen) * 100).toFixed(0)}% vs ${monthLabel(stock.prevYm ?? "").slice(0, 3)}` : ""}` : "no stock take recorded yet") : undefined },
  ];
  const topMax = calc.top[0]?.sen ?? 1;

  return (
    <>
      <OCard label="Purchasing" id="ops-purchasing">
        <OHead title="Purchasing" right={<PeriodText>{label}</PeriodText>} subLeading={1.45} sub="Supplier invoices by invoice date · % of production revenue" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8, marginTop: 12 }}>
          {tiles.map((t) => (
            <button key={t.l} type="button" onClick={t.on} disabled={t.disabled} style={{ minWidth: 0, display: "block", textAlign: "left", padding: "10px 12px", border: "none", borderRadius: 12, backgroundColor: M.paper, fontFamily: "inherit", cursor: t.disabled ? "default" : "pointer", opacity: t.disabled ? 0.85 : 1, WebkitTapHighlightColor: "transparent" }}>
              <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: M.ink, ...NOWRAP_ELLIPSIS }}>{t.l}</span>
                {!t.disabled ? <Chev size={13} color={C.chevronGold} /> : null}
              </span>
              <span style={{ display: "block", fontSize: 15, fontWeight: 700, color: t.c, marginTop: 3, whiteSpace: "nowrap", ...TNUM }}>{t.v}</span>
              {t.s ? <span style={{ display: "block", fontSize: 11.5, lineHeight: 1.35, color: M.ink, marginTop: 2 }}>{t.s}</span> : null}
            </button>
          ))}
        </div>

        <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${M.divider}` }}><SectionLabel>SPEND VS EXPECTED · LAST 6 MONTHS</SectionLabel></div>
        {!invOk ? <StatusBlock status={d.pis.status === "ready" ? "loading" : d.pis.status} what="The spend chart" need="invoices access" minHeight={80} /> : !revOk ? <StatusBlock status={d.revenue.status === "ready" ? "loading" : d.revenue.status} what="Production revenue" minHeight={80} onRetry={d.revenue.refresh} /> : (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              <LegendPill label="Spend" color="#1F1D1B" on={show.spend} onToggle={() => setShow((s) => ({ ...s, spend: !s.spend }))} h={9} w={10} height={28} weight={600} />
              <LegendPill label="Expected from production" color={C.teal} on={show.exp} onToggle={() => setShow((s) => ({ ...s, exp: !s.exp }))} h={2} w={10} height={28} weight={600} />
              <LegendPill label="% of production revenue" color="#C9A961" on={show.pct} onToggle={() => setShow((s) => ({ ...s, pct: !s.pct }))} h={3} w={10} height={28} weight={600} />
            </div>
            <div role="img" aria-label="Purchasing spend trend" style={{ position: "relative", width: "100%", height: 150, marginTop: 8 }}><SpendChart trend={calc.trend} show={show} /></div>
          </>
        )}

        <div style={{ marginTop: 14, padding: "12px 0 4px", borderTop: `1px solid ${M.divider}` }}><SectionLabel>TOP SUPPLIERS · SHARE OF SPEND</SectionLabel></div>
        {!invOk ? <StatusBlock status={d.pis.status === "ready" ? "loading" : d.pis.status} what="Top suppliers" need="invoices access" minHeight={70} /> : calc.top.length === 0 ? (
          <div role="status" style={{ padding: "14px 0", textAlign: "center", fontSize: 13, color: M.muted }}>No supplier invoices in this period.</div>
        ) : calc.top.map((s, i) => (
          <div key={s.name} style={{ padding: "9px 0", borderTop: i ? `1px solid ${M.divider}` : "none" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: M.raisin, ...NOWRAP_ELLIPSIS }}>{s.name}</span>
              <span style={{ flex: "none", fontSize: 14, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", ...TNUM }}>{rm(s.sen)}</span>
              <span style={{ flex: "none", width: 38, textAlign: "right", fontSize: 12, color: M.ink, ...TNUM }}>{calc.spend > 0 ? Math.round((s.sen / calc.spend) * 100) : 0}%</span>
            </div>
            <div style={{ fontSize: 11.5, color: M.muted, marginTop: 1 }}>{s.n} PI</div>
            <Bar frac={s.sen / topMax} color={CAT.bedframe} h={4} track="#F4EFE6" inset="5px 0 0" />
          </div>
        ))}
      </OCard>

      {drill === "spend" && invOk ? (
        <SheetFrame open title={`Invoiced spend · ${label}`} sub="Supplier invoices by invoice date" onClose={() => setDrill(null)}>
          <TableSheet grid="auto minmax(0,1fr) auto" head={[{ t: "Date" }, { t: "Supplier" }, { t: "Amount", right: true }]} none="No supplier invoices in this period."
            rows={calc.periodPis.slice(0, 100).map((p) => ({ cells: [{ t: String(p.invoiceDate ?? "").slice(5, 10) }, { t: p.supplierName ?? "—" }, { t: rm(Number(p.amountSen) || 0), right: true, w: 700 }] }))} />
        </SheetFrame>
      ) : null}
      {drill === "share" && invOk && revOk ? (
        <SheetFrame open title="Purchases as % of production revenue" sub="Last 6 months" onClose={() => setDrill(null)}>
          <TableSheet grid="auto minmax(0,1fr) minmax(0,1fr) auto" head={[{ t: "Month" }, { t: "Spend", right: true }, { t: "Prod. revenue", right: true }, { t: "%", right: true }]}
            rows={calc.trend.map((t) => ({ cells: [{ t: monthLabel(t.ym).slice(0, 3), w: 600 }, { t: rm(t.spend), right: true }, { t: rm(t.rev), right: true }, { t: pct1(t.share), right: true, w: 700 }] }))} />
        </SheetFrame>
      ) : null}
      {drill === "po" ? (
        <SheetFrame open title="Outstanding POs" sub="Open purchase orders" onClose={() => setDrill(null)}><PoSheet allowed={canPo} /></SheetFrame>
      ) : null}
      {drill === "stock" && stock ? (
        <SheetFrame open title="Raw material stock" sub="P&L closing stock at the last stock take" onClose={() => setDrill(null)}>
          <TableSheet grid="minmax(0,1fr) auto auto" head={[{ t: "Account" }, ...(stock.prevYm ? [{ t: monthLabel(stock.prevYm).slice(0, 3), right: true }] : []), { t: monthLabel(stock.ym).slice(0, 3), right: true }]}
            rows={stock.lines.map((l) => ({ cells: [{ t: l.name }, ...(stock.prevYm ? [{ t: l.prevSen == null ? "—" : rm(l.prevSen), right: true }] : []), { t: rm(l.sen), right: true, w: 700 }] }))} />
        </SheetFrame>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Fabric usage
// ---------------------------------------------------------------------------
const FAB_CATS = [{ key: "BEDFRAME", label: "Bedframe fabric", dot: CAT.bedframe }, { key: "SOFA", label: "Sofa fabric", dot: CAT.sofa }] as const;
const shortLabel = (key: string): string => (/-Q\d$/.test(key) ? `Q${key.slice(6)} ${key.slice(2, 4)}` : `${monthLabel(key).slice(0, 3)} ${key.slice(2, 4)}`);

export function FabricCard({ d, period }: { d: OpsData; period: Period }) {
  const [mode, setMode] = useState<FabMode>("previous");
  const [gran, setGran] = useState<FabGran>("monthly");
  const [cat, setCat] = useState<"BEDFRAME" | "SOFA">("BEDFRAME");
  const { status, data } = d.overview;
  const fab = data?.fabric?.[cat];
  const fc = data?.fabricCostPerMeterSen;
  const rows = fabricRows(fab, mode);
  const trend = fabricTrend(fab, gran);
  const maxM = Math.max(1, ...trend.map((t) => t.meters));
  const avgCost = fc ? (cat === "BEDFRAME" ? fc.bedframe : fc.sofa) : null;
  const dot = cat === "BEDFRAME" ? CAT.bedframe : CAT.sofa;

  return (
    <OCard label="Fabric usage" id="ops-fabric">
      <OHead title="Fabric Usage" right={<Tag kind="own">OWN PERIOD</Tag>} sub={mode === "next" ? "Forecast — fabric needed next 30 days" : `History — fabric used · ${widgetPeriodLabel(period)}`} />
      {status !== "ready" || !data?.fabric ? (
        <div style={{ marginTop: 12 }}><StatusBlock status={status === "ready" ? "error" : status} what="Fabric usage" need="a dashboard view" reason={status === "ready" ? "no fabric figures returned" : undefined} onRetry={d.retryOverview} /></div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8, marginTop: 12 }}>
            <Seg aria="Previous or next" value={mode} onChange={setMode} options={[["previous", "Previous"], ["next", "Next"]]} />
            <Seg aria="Trend" value={gran} onChange={setGran} options={[["monthly", "Monthly"], ["quarterly", "Quarterly"]]} />
          </div>
          {fc ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", marginTop: 14, padding: "10px 0", borderTop: `1px solid ${M.divider}`, borderBottom: `1px solid ${M.divider}` }}>
                {[["Overall (all issued)", rm(fc.total)], ["Excl. Bedframe & Sofa", fc.exclBedframeSofa > 0 ? rm(fc.exclBedframeSofa) : "—"]].map(([l, v], i) => (
                  <div key={l} style={{ minWidth: 0, padding: "0 8px", textAlign: "center", borderLeft: i ? `1px solid ${M.divider}` : "none" }}>
                    <div style={{ fontSize: 11, color: M.ink }}>{l}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: M.raisin, marginTop: 2, whiteSpace: "nowrap", ...TNUM }}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: M.muted, marginTop: 6, textAlign: "center" }}>Fabric cost per metre</div>
            </>
          ) : null}
          <div style={{ marginTop: 14 }}><ChipScroll aria="Fabric category" margin="0 -16px" value={cat} onChange={setCat} options={FAB_CATS.map((c) => ({ key: c.key, label: c.label, dot: c.dot }))} /></div>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginTop: 12, paddingBottom: 4 }}>
            <SectionLabel>{mode === "next" ? "NEXT 30 DAYS · LIVE" : "USED"}</SectionLabel>
            <span style={{ fontSize: 11, color: M.muted, whiteSpace: "nowrap" }}>{avgCost != null && avgCost > 0 ? `avg cost ${rm(avgCost)}/m` : ""}</span>
          </div>
          {rows.length === 0 ? <div role="status" style={{ padding: "18px 0", textAlign: "center", fontSize: 13, color: M.muted }}>{mode === "next" ? "No upcoming fabric demand." : "No fabric issued."}</div> : null}
          {rows.map((r) => (
            <div key={r.fabCode} style={{ padding: "10px 0", borderTop: `1px solid ${M.divider}` }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, color: M.raisin, ...NOWRAP_ELLIPSIS }}>{r.fabCode}</span>
                <span style={{ flex: "none", fontSize: 14, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", ...TNUM }}>{n0(mode === "next" ? r.next30Meters : r.meters)} m</span>
              </div>
              <div style={{ fontSize: 11.5, color: M.ink, marginTop: 3, ...TNUM }}>Past 30d {n0(r.past30Meters)} m · Avg buy {rm(r.buyAvgSen)} · {rm(r.buyMinSen)}–{num(r.buyMaxSen)}</div>
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginTop: 14, paddingTop: 12, borderTop: `1px solid ${M.divider}` }}>
            <SectionLabel>{gran === "monthly" ? "MONTHLY METERS POSTED · LAST 12" : "QUARTERLY METERS POSTED · LAST 8"}</SectionLabel>
            <span style={{ fontSize: 11, color: M.muted }}>avg cost / m</span>
          </div>
          {trend.length === 0 ? <div role="status" style={{ padding: "12px 0", textAlign: "center", fontSize: 13, color: M.muted }}>No data.</div> : (
            <div style={{ display: "grid", gap: 7, marginTop: 8 }}>
              {trend.map((t) => (
                <div key={t.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ flex: "none", width: 44, fontSize: 11.5, color: M.ink, ...TNUM }}>{shortLabel(t.key)}</span>
                  <span style={{ flex: 1, minWidth: 0 }}><Bar frac={Math.max(0.02, t.meters / maxM)} color={dot} h={8} /></span>
                  <span style={{ flex: "none", width: 58, textAlign: "right", fontSize: 11.5, fontWeight: 700, color: M.raisin, ...TNUM }}>{n0(t.meters)} m</span>
                  <span style={{ flex: "none", width: 62, textAlign: "right", fontSize: 11, color: M.taupe, ...TNUM }}>{t.perM == null ? "—" : `${rm(t.perM)}/m`}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </OCard>
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
      <OCard label="Material shortage" id="ops-shortage">
        <OHead title="Material shortage" />
        <div style={{ marginTop: 6 }}><StatusBlock status={status} what="Material shortage" need="inventory access" reason={reason} onRetry={d.retryFeed} minHeight={70} /></div>
      </OCard>
    );
  }
  const neg = sum.negative > 0;
  return (
    <>
      <section id="ops-shortage" aria-label="Material shortage">
        <button type="button" onClick={() => setOpen(true)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", border: "none", borderRadius: 16, backgroundColor: M.card, boxShadow: SHADOW_SECTION, fontFamily: "inherit", textAlign: "left", cursor: "pointer", boxSizing: "border-box" }}>
          <IconTile icon={PackageX} bg={neg ? C.dangerBg : C.okBg} fg={neg ? C.danger : C.ok} size={36} radius={10} iconSize={18} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: M.raisin, letterSpacing: -0.2 }}>Material shortage</span><Tag kind="live">LIVE</Tag>
            </span>
            <span style={{ display: "block", fontSize: 12.5, color: M.ink, marginTop: 3 }}><b style={{ color: neg ? C.danger : C.ok, ...TNUM }}>{n0(sum.negative)}</b> below zero · {n0(sum.zero)} at exactly zero</span>
          </span>
          <span style={{ flex: "none", fontSize: 13, fontWeight: 700, color: M.taupe, whiteSpace: "nowrap" }}>View list ›</span>
        </button>
      </section>
      {open ? (
        <SheetFrame open title="Material shortage" sub="Below zero first, then items at exactly zero · min stock is not set on raw materials, so this is a balance check" onClose={() => setOpen(false)}>
          <TableSheet grid="auto minmax(0,1fr) auto auto" head={[{ t: "Code" }, { t: "Description" }, { t: "Group" }, { t: "Balance", right: true }]} none="Nothing at zero or below."
            rows={sum.all.map((m) => ({ cells: [{ t: m.code ?? "—", w: 600 }, { t: m.description ?? "—" }, { t: m.group ?? "—" }, { t: String(m.balanceQty), right: true, w: 700, color: m.balanceQty < 0 ? C.danger : M.muted }] }))} />
        </SheetFrame>
      ) : null}
    </>
  );
}
