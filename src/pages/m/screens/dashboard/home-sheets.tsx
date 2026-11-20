// Detail sheets behind the Home v10 / v12 customer / state / top-seller cards.
// Pure builders: each returns the title, subtitle and body of one sheet; SalesView
// owns which one is open and the sheet frame. v12 look: summary strip (GSummary) on
// top, white card tables below (11px taupe header, first column bold, rows 48px).
import { useMemo, type ReactNode } from "react";
import { M } from "../../theme";
import { CHART_SERIES, inFocus, type Period } from "../../../dashboards/dashboard-shared-lib";
import type { SalesData } from "./home-data";
import { attribute, catRev, customerRows, pct1, productsSold, rm, titleCase, ymLabelShort, type Aov, type CustCat } from "./home-lib";
import { SheetCard, SheetNote } from "./home-ui";
import { NOWRAP_ELLIPSIS, TNUM, amt, rowBtn } from "./home-style";
import { Chev, Dot, GSummary, GTable, type Cell } from "./sales-glass";

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
            {m.rows.map(({ a: c, rev }, i) => (
              <button key={c.customerName} type="button" onClick={() => a.open({ t: "custMonthly", name: c.customerName, fromList: true })} style={{ ...rowBtn(56), borderTop: co || i ? `1px solid ${M.divider}` : "none", padding: "8px 13px", cursor: "pointer", boxSizing: "border-box" }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: M.raisin, ...NOWRAP_ELLIPSIS }}>{c.customerName}</span>
                  <span style={{ display: "block", fontSize: 11.5, color: M.ink, marginTop: 2, lineHeight: 1.4 }}>{line(c, a.cat)}</span>
                </span>
                <span style={amt}>{rm(rev)}</span>
                <Chev />
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
  // v12 month row: Month · Bedframe AOV (value + units) · Sofa AOV (value + sets).
  const bed = (avg: number, n: number): Cell => (n ? { v: rm(avg), v2: `${n} units` } : "—");
  const sofa = (avg: number, n: number): Cell => (n ? { v: rm(avg), v2: `${n} sets` } : "—");
  // Months come from the server (all months, by SO date). With none, the single
  // row is the PERIOD figure and says so (desktop labels it "All-time").
  const rows: Cell[][] = monthly.length
    ? monthly.map((r) => [ymLabelShort(r.month), bed(r.bedframeAvgSen, r.bedframeUnits), sofa(r.sofaAvgSen, r.sofaSets)])
    : c ? [[a.periodText, bed(c.bedframeAvgSen, c.bedframeUnits), sofa(c.sofaAvgSen, c.sofaSets)]] : [];
  return {
    title: s.name,
    sub: `${a.periodText} · monthly AOV by SO date`,
    backTo: s.fromList ? ({ t: "customers" } as CustSheet) : undefined,
    body: (
      <>
        {c ? (
          <GSummary
            total={rm(tot)}
            stats={[
              { k: "Bedframe", v: c.bedframeUnits ? rm(c.bedframeAvgSen) : "—", n: c.bedframeUnits ? `${c.bedframeUnits} units` : undefined, n2: c.bedframeUnits ? `Company avg ${coB}` : undefined },
              { k: "Sofa", v: c.sofaSets ? rm(c.sofaAvgSen) : "—", n: c.sofaSets ? `${c.sofaSets} sets` : undefined, n2: c.sofaSets ? `Company avg ${coS}` : undefined },
            ]}
          />
        ) : null}
        <GTable grid="64px minmax(0,1fr) minmax(0,1fr)" head={["Month", "Bedframe AOV", "Sofa AOV"]} rows={rows} empty="No monthly history for this customer." />
      </>
    ),
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
                <Dot color={CHART_SERIES[Math.min(i, 6) % 7]} style={{ width: 9, height: 9 }} />
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
  const qty = list.reduce((t, x) => t + x.qty, 0);
  return {
    title: `${s.kind === "category" ? titleCase(s.key) : s.key} · ${a.periodText}`,
    sub: "Products sold",
    backTo: s.fromList ? ({ t: "states" } as StateSheet) : undefined,
    body: (
      <>
        <GSummary total={rm(total)} stats={[{ k: "Products", v: String(list.length) }, { k: "Qty", v: qty.toLocaleString("en-MY") }]} />
        <SheetCard pad="0 14px">
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0 8px", fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: M.taupe }}>
            <span style={{ flex: 1 }}>PRODUCT</span><span style={{ flex: "none", width: 44, textAlign: "right" }}>QTY</span><span style={{ flex: "none", width: 104, textAlign: "right" }}>REVENUE</span>
          </div>
          {list.length === 0 ? <div style={{ padding: "18px 0", textAlign: "center", fontSize: 13, color: M.ink }}>No products in this selection.</div> : null}
          {list.map((p) => (
            <div key={p.sku} style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 56, padding: "6px 0", borderTop: `1px solid ${M.divider}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: M.raisin, lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p.name}</div>
                <div style={{ fontSize: 11.5, color: M.ink, marginTop: 2, ...NOWRAP_ELLIPSIS }}>{s.kind === "state" ? titleCase(p.other) : p.other}</div>
              </div>
              <div style={{ flex: "none", width: 44, textAlign: "right", fontSize: 13, color: M.raisin, ...TNUM }}>{p.qty.toLocaleString("en-MY")}</div>
              <div style={{ flex: "none", width: 104, textAlign: "right" }}>
                <div style={{ fontSize: rm(p.revenueSen).length > 14 ? 12.5 : 14, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", ...TNUM }}>{rm(p.revenueSen)}</div>
                <div style={{ fontSize: 11.5, color: M.ink, marginTop: 2, ...TNUM }}>{((p.revenueSen / sum) * 100).toFixed(1)}%</div>
              </div>
            </div>
          ))}
        </SheetCard>
      </>
    ),
  };
}

export function sellerSheet(s: SellerSheet, a: { data: SalesData; periodText: string }): SheetSpec {
  const ov = a.data.overview.data;
  const bed = s.cat === "bedframe";
  const rows = (bed ? ov?.topSellersByCustomer?.BEDFRAME?.[s.code] : ov?.topSellersByCustomer?.SOFA?.[s.code]) ?? [];
  // The product's own totals come from the Top Sellers list (what the card row shows); the customer rows are the split.
  const own = bed ? ov?.topSellers?.BEDFRAME?.find((p) => p.productCode === s.code) : ov?.topSellers?.SOFA?.find((p) => p.model === s.code);
  const qtyOf = (c: (typeof rows)[number]) => Number("qty" in c ? c.qty : c.sets);
  const totalSen = own ? own.valueSen : rows.reduce((t, c) => t + c.valueSen, 0);
  const qty = own ? ("qtySold" in own ? own.qtySold : own.setsSold) : rows.reduce((t, c) => t + qtyOf(c), 0);
  const unit = bed ? "Units" : "Sets";
  return {
    // v12 wording: "<product> · <period>" with "<Category> · customers who bought it" under it.
    title: `${s.code} · ${a.periodText}`,
    sub: `${bed ? "Bedframe" : "Sofa"} · customers who bought it`,
    body: (
      <>
        <GSummary total={rm(totalSen)} stats={[{ k: unit, v: qty.toLocaleString("en-MY") }, { k: "Customers", v: String(rows.length) }]} />
        <GTable
          grid="minmax(0,1fr) 48px 116px" head={["Customer", unit, "Value"]}
          rows={rows.map((c) => [c.customer, String(qtyOf(c)), rm(c.valueSen)])}
          empty="No customer breakdown for this product."
        />
      </>
    ),
  };
}
