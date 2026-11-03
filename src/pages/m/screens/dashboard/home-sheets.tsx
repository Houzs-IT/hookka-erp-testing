// Detail sheets behind the Home v10 customer / state / top-seller cards.
// Pure builders: each returns the title, subtitle and body of one sheet; SalesView
// owns which one is open.
import { useMemo, type ReactNode } from "react";
import { M } from "../../theme";
import { CHART_SERIES, inFocus, type Period } from "../../../dashboards/dashboard-shared-lib";
import type { SalesData } from "./home-data";
import { attribute, catRev, customerRows, pct1, productsSold, rm, titleCase, ymLabelShort, type Aov, type CustCat } from "./home-lib";
import { Chevron, SheetCard, SheetNote, SheetTable } from "./home-ui";
import { NOWRAP_ELLIPSIS, TNUM, amt, rowBtn, swatch } from "./home-style";

export type SheetSpec = { title: string; sub?: ReactNode; body: ReactNode; backTo?: unknown };
export type CustSheet = { t: "customers" } | { t: "custMonthly"; name: string; fromList: boolean };
export type StateSheet = { t: "states" } | { t: "prods"; kind: "state" | "category"; key: string; fromList: boolean };
export type SellerSheet = { t: "sellerCust"; cat: "bedframe" | "sofa"; code: string };

const line = (a: Aov, cat: CustCat) =>
  [
    cat !== "sofa" && (a.bedframeUnits ? `Bedframe ${rm(a.bedframeAvgSen)} avg · ${a.bedframeUnits} units` : "Bedframe —"),
    cat !== "bedframe" && (a.sofaSets ? `Sofa ${rm(a.sofaAvgSen)} avg · ${a.sofaSets} sets` : "Sofa —"),
  ].filter(Boolean).join(" · ");

export function customerSheet(s: CustSheet, a: { data: SalesData; cat: CustCat; periodText: string; open: (s: CustSheet) => void }): SheetSpec {
  const m = customerModelOf(a.data, a.cat);
  const catWord = a.cat === "bedframe" ? "Bedframe only" : a.cat === "sofa" ? "Sofa only" : "All categories";
  if (s.t === "customers") {
    const co = m.company;
    return {
      title: "Compare customers",
      sub: `${a.periodText} · ${catWord} · top ${m.rows.length} by revenue${m.count ? ` of ${m.count} customers` : ""} · tap a customer for the monthly breakdown`,
      body: (
        <>
          <SheetCard pad="0">
            {co ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 56, padding: "8px 13px", backgroundColor: M.divider }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: M.raisin }}>All customers · company AOV</span>
                  <span style={{ display: "block", fontSize: 11.5, color: M.ink, marginTop: 2, lineHeight: 1.4 }}>
                    {line({ customerName: "", bedframeAvgSen: co.bedframeAvgSen, bedframeUnits: co.bedframeUnits, sofaAvgSen: co.sofaAvgSen, sofaSets: co.sofaSets, totalSen: co.totalSen }, a.cat)}
                  </span>
                </span>
                <span style={amt}>{rm(m.total)}</span>
              </div>
            ) : null}
            {m.rows.map(({ a: c, rev }) => (
              <button key={c.customerName} type="button" onClick={() => a.open({ t: "custMonthly", name: c.customerName, fromList: true })} style={{ ...rowBtn(56), padding: "8px 13px", cursor: "pointer", boxSizing: "border-box" }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: M.raisin, ...NOWRAP_ELLIPSIS }}>{c.customerName}</span>
                  <span style={{ display: "block", fontSize: 11.5, color: M.ink, marginTop: 2, lineHeight: 1.4 }}>{line(c, a.cat)}</span>
                </span>
                <span style={amt}>{rm(rev)}</span>
                <Chevron />
              </button>
            ))}
          </SheetCard>
          <SheetNote>The server sends the top 12 customers by total revenue. Shares are taken over every customer in the period, not over these rows.</SheetNote>
        </>
      ),
    };
  }
  const c = m.list.find((x) => x.customerName === s.name);
  const monthly = a.data.overview.data?.aovMonthlyByCustomer?.[s.name] ?? [];
  const co = m.company;
  const coB = co && co.bedframeUnits ? rm(co.bedframeAvgSen) : "—";
  const coS = co && co.sofaSets ? rm(co.sofaAvgSen) : "—";
  const tot = c ? catRev(c, a.cat) : 0;
  // Months come from the server (all months, by SO date). With none, the single
  // row is the PERIOD figure and says so (desktop labels it "All-time").
  const rows: ReactNode[][] = monthly.length
    ? monthly.map((r) => [ymLabelShort(r.month), r.bedframeUnits ? rm(r.bedframeAvgSen) : "—", r.bedframeUnits ? String(r.bedframeUnits) : "—", r.sofaSets ? rm(r.sofaAvgSen) : "—", r.sofaSets ? String(r.sofaSets) : "—"])
    : c ? [[a.periodText, c.bedframeUnits ? rm(c.bedframeAvgSen) : "—", c.bedframeUnits ? String(c.bedframeUnits) : "—", c.sofaSets ? rm(c.sofaAvgSen) : "—", c.sofaSets ? String(c.sofaSets) : "—"]] : [];
  return {
    title: s.name,
    sub: c
      ? `${a.periodText} total ${rm(tot)} · Bedframe ${c.bedframeUnits ? `${rm(c.bedframeAvgSen)} × ${c.bedframeUnits} units` : "—"} (company avg ${coB}) · Sofa ${c.sofaSets ? `${rm(c.sofaAvgSen)} × ${c.sofaSets} sets` : "—"} (company avg ${coS}) · monthly AOV by SO date`
      : "Monthly AOV by SO date",
    backTo: s.fromList ? ({ t: "customers" } as CustSheet) : undefined,
    body: <SheetTable grid="minmax(0,1fr) auto auto auto auto" head={["Month", "Bed AOV", "Units", "Sofa AOV", "Sets"]} rows={rows} empty="No monthly history for this customer." />,
  };
}
// customerSheet is called while rendering, so the model is built without a hook.
function customerModelOf(data: SalesData, cat: CustCat) {
  const ov = data.overview.data;
  const list = ov?.aovByCustomer ?? [];
  const rows = customerRows(list, cat);
  const conc = ov?.customerConcentration?.[cat] ?? null;
  const total = conc ? conc.totalSen : rows.reduce((s, r) => s + r.rev, 0);
  return { list, rows, total, count: conc?.customerCount ?? null, company: ov?.aovCompany ?? null };
}

export function useStateRows(data: SalesData, period: Period) {
  const all = data.proto.data?.sales?.byStateCategory;
  return useMemo(() => (all ?? []).filter((r) => inFocus(period, r.date)), [all, period]);
}

export function stateSheet(s: StateSheet, a: { rows: ReturnType<typeof useStateRows>; periodText: string; open: (s: StateSheet) => void }): SheetSpec {
  const attr = attribute(a.rows);
  if (s.t === "states") {
    const states = attr.states;
    return {
      title: "Sales by state & category",
      sub: `${a.periodText} · tap a state or category for products sold`,
      body: (
        <>
          <SheetCard>
            {states.map((st, i) => (
              <button key={st.name} type="button" onClick={() => a.open({ t: "prods", kind: "state", key: st.name, fromList: true })} style={{ ...rowBtn(46), gap: 9, borderTop: i ? `1px solid ${M.divider}` : "none", cursor: "pointer" }}>
                <span aria-hidden="true" style={{ ...swatch(CHART_SERIES[Math.min(i, 6) % 7]), width: 9, height: 9, borderRadius: 2 }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: M.raisin, ...NOWRAP_ELLIPSIS }}>{st.name}</span>
                <span style={amt}>{rm(st.revenueSen)}</span>
                <span style={{ flex: "none", width: 44, textAlign: "right", fontSize: 11.5, color: M.muted, ...TNUM }}>{pct1(st.revenueSen, attr.total)}</span>
              </button>
            ))}
          </SheetCard>
          <div style={{ marginTop: 10 }}>
            <SheetCard>
              {attr.categories.map((c, i) => (
                <button key={c.name} type="button" onClick={() => a.open({ t: "prods", kind: "category", key: c.name, fromList: true })} style={{ ...rowBtn(44), gap: 9, borderTop: i ? `1px solid ${M.divider}` : "none", cursor: "pointer" }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: M.raisin }}>{titleCase(c.name)}</span>
                  <span style={{ flex: "none", fontSize: 12, color: M.muted }}>{c.qty.toLocaleString("en-MY")} sold</span>
                  <span style={amt}>{rm(c.revenueSen)}</span>
                </button>
              ))}
            </SheetCard>
          </div>
        </>
      ),
    };
  }
  const list = productsSold(a.rows, s.kind, s.key);
  const sum = list.reduce((t, x) => t + x.revenueSen, 0) || 1;
  const total = list.reduce((t, x) => t + x.revenueSen, 0);
  return {
    title: `${s.kind === "category" ? titleCase(s.key) : s.key} · ${a.periodText}`,
    sub: `Products sold in this ${s.kind === "state" ? "state" : "category"} · ${rm(total)}`,
    backTo: s.fromList ? ({ t: "states" } as StateSheet) : undefined,
    body: (
      <SheetCard pad="0 14px">
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0 8px", fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, color: M.taupe }}>
          <span style={{ flex: 1 }}>PRODUCT</span><span style={{ flex: "none", width: 44, textAlign: "right" }}>QTY</span><span style={{ flex: "none", minWidth: 104, textAlign: "right" }}>REVENUE</span>
        </div>
        {list.length === 0 ? <div style={{ padding: "18px 0", textAlign: "center", fontSize: 13, color: M.ink }}>No products in this selection.</div> : null}
        {list.map((p) => (
          <div key={p.sku} style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 56, padding: "6px 0", borderTop: `1px solid ${M.divider}` }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: M.raisin, lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p.name}</div>
              <div style={{ fontSize: 11.5, color: M.ink, marginTop: 2, ...NOWRAP_ELLIPSIS }}>{s.kind === "state" ? titleCase(p.other) : p.other}</div>
            </div>
            <div style={{ flex: "none", width: 44, textAlign: "right", fontSize: 13, color: M.raisin, ...TNUM }}>{p.qty.toLocaleString("en-MY")}</div>
            <div style={{ flex: "none", minWidth: 104, textAlign: "right" }}>
              <div style={{ fontSize: rm(p.revenueSen).length > 14 ? 12.5 : 14, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", ...TNUM }}>{rm(p.revenueSen)}</div>
              <div style={{ fontSize: 11.5, color: M.ink, marginTop: 2, ...TNUM }}>{((p.revenueSen / sum) * 100).toFixed(1)}%</div>
            </div>
          </div>
        ))}
      </SheetCard>
    ),
  };
}

export function sellerSheet(s: SellerSheet, a: { data: SalesData; periodText: string }): SheetSpec {
  const ov = a.data.overview.data;
  const bed = s.cat === "bedframe";
  const rows = (bed ? ov?.topSellersByCustomer?.BEDFRAME?.[s.code] : ov?.topSellersByCustomer?.SOFA?.[s.code]) ?? [];
  return {
    // Home v10 wording: "<product> · <period>" with "Customers who bought it" under it.
    title: `${s.code} · ${a.periodText}`,
    sub: "Customers who bought it",
    body: (
      <SheetTable
        grid="minmax(0,1fr) auto auto" head={["Customer", bed ? "Units" : "Sets", "Value"]}
        rows={rows.map((c) => [c.customer, String("qty" in c ? c.qty : c.sets), rm(c.valueSen)])}
        empty="No customer breakdown for this product."
      />
    ),
  };
}
