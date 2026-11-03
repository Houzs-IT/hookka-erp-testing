// Home v10 · Sales (part 2): Sales by Customer & Month, Sales by State &
// Category, Top Sellers, and the detail sheets behind them.
//
// Customer data note (BUG-2026-08-13-142 on desktop): the server sends only the
// TOP 12 customers (`aovByCustomer`), by all-category revenue, but the
// concentration figures (`customerConcentration`) cover EVERY customer. Shares
// divide by the server's total, never by the rows held here, and the 12 are
// never described as the whole customer base.
import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { M } from "../../theme";
import { CHART_SERIES } from "../../../dashboards/dashboard-shared-lib";
import type { SalesData } from "./home-data";
import { attribute, customerRows, pct1, rm, stateSlices, titleCase, topPlusOthers, type CustCat, type StateCatRow } from "./home-lib";
import { Donut } from "./HomeDonut";
import { Chevron, ChipRow, HCard, Label, MoreRow, SectionState } from "./home-ui";
import { NOWRAP_ELLIPSIS, TNUM, amt, pctCell, rowBtn, swatch } from "./home-style";
import type { SellerSheet } from "./home-sheets";

const PIE = ["#16425B", "#1F6E8C", "#2E8FA3", "#4FA8B8", "#7FB9C6", "#A9C7D0", "#C6CDD3"] as const;
const CATS = [["all", "All"], ["bedframe", "Bedframe"], ["sofa", "Sofa"]] as const;

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------
function useCustomerModel(data: SalesData, cat: CustCat) {
  const ov = data.overview.data;
  return useMemo(() => {
    const list = ov?.aovByCustomer ?? [];
    const rows = customerRows(list, cat);
    const conc = ov?.customerConcentration?.[cat] ?? null;
    // Pre-customerConcentration payloads fall back to the rows held (desktop does the same).
    const total = conc ? conc.totalSen : rows.reduce((s, r) => s + r.rev, 0);
    const slices = topPlusOthers(rows.map((r) => ({ name: r.a.customerName || "—", sen: r.rev })), total, PIE, 6, "Others");
    return { list, rows, conc, total, slices, count: conc?.customerCount ?? null, company: ov?.aovCompany ?? null };
  }, [ov, cat]);
}

export function CustomerCard({
  data, cat, onCat, periodText, onOpenCustomer, onOpenAll,
}: { data: SalesData; cat: CustCat; onCat: (c: CustCat) => void; periodText: string; onOpenCustomer: (name: string) => void; onOpenAll: () => void }) {
  const m = useCustomerModel(data, cat);
  const ov = data.overview.data;
  const body = () => {
    if (data.overview.loading && !ov) return <SectionState kind="loading" minHeight={260} />;
    if (!ov) return <SectionState kind="error" onRetry={data.refresh} text="Could not load customer sales." minHeight={160} />;
    if (m.rows.length === 0 || m.total <= 0) return <SectionState kind="empty" text="No customer sales in this period." minHeight={160} />;
    const others = m.slices.find((s) => !s.tappable);
    const othersCount = m.count != null && m.count > 6 ? m.count - 6 : null;
    return (
      <>
        <Donut
          slices={m.slices} ariaLabel="Revenue share by customer — top six plus others" centreTitle={["LARGEST", "CUSTOMER"]}
          centreValue={m.conc?.largestPct != null ? `${m.conc.largestPct.toFixed(1)}%` : "—"} centreSub="of total revenue"
        />
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginTop: 16 }}>
          <Label>{`TOTAL · ${periodText.toUpperCase()}`}</Label>
          <span style={{ fontSize: 15, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", ...TNUM }}>{rm(m.total)}</span>
        </div>
        <div style={{ fontSize: 12, color: M.ink, marginTop: 4, lineHeight: 1.45 }}>
          {m.conc && m.conc.top10Pct != null ? `Top 10 = ${m.conc.top10Pct.toFixed(1)}% of revenue · ${m.conc.customerCount} customers` : "Top 10 share not available for this period"}
        </div>
        <div style={{ marginTop: 12 }}>
          {m.slices.filter((s) => s.tappable).map((s) => (
            <button key={s.name} type="button" onClick={() => onOpenCustomer(s.name)} style={{ ...rowBtn(44), cursor: "pointer" }} aria-label={`${s.name}: ${rm(s.sen)}. Monthly breakdown`}>
              <span aria-hidden="true" style={swatch(s.color)} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: M.raisin, ...NOWRAP_ELLIPSIS }}>{s.name}</span>
              <span style={amt}>{rm(s.sen)}</span>
              <span style={pctCell}>{pct1(s.sen, m.total)}</span>
              <Chevron />
            </button>
          ))}
          {others ? (
            <div style={{ ...rowBtn(44), cursor: "default" }}>
              <span aria-hidden="true" style={swatch(others.color)} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: M.raisin, ...NOWRAP_ELLIPSIS }}>{othersCount ? `Others · ${othersCount} customers` : "Others"}</span>
              <span style={amt}>{rm(others.sen)}</span>
              <span style={pctCell}>{pct1(others.sen, m.total)}</span>
              <Chevron hidden />
            </div>
          ) : null}
        </div>
        <MoreRow label={`Compare customers · top ${m.rows.length}${m.count ? ` of ${m.count}` : ""}`} onClick={onOpenAll} />
      </>
    );
  };
  return (
    <HCard label="Sales by customer" title="Sales by Customer & Month" sub="Tap a customer for its monthly breakdown" padBottom={0}>
      <div style={{ display: "flex", marginTop: 12 }}><ChipRow options={CATS} value={cat} onChange={onCat} aria="Customer category" /></div>
      {body()}
    </HCard>
  );
}

// ---------------------------------------------------------------------------
// State & category
// ---------------------------------------------------------------------------
export function StateCategoryCard({
  data, rows, periodText, selected, onSelect, onOpenState, onOpenCategory, onOpenAll,
}: {
  data: SalesData; rows: StateCatRow[]; periodText: string; selected: string | null;
  onSelect: (name: string | null) => void; onOpenState: (name: string) => void; onOpenCategory: (name: string) => void; onOpenAll: () => void;
}) {
  const attr = useMemo(() => attribute(rows), [rows]);
  const slices = useMemo(() => stateSlices(attr.states, attr.total, CHART_SERIES), [attr]);
  // A highlight for a state that is not on this donut (absent, or folded into Others) is ignored,
  // so a stale pick can never dim every slice.
  const sel = selected && slices.some((x) => x.tappable && x.name === selected) ? selected : null;
  const body = () => {
    if (data.proto.loading && !data.proto.data) return <SectionState kind="loading" minHeight={260} />;
    if (!data.proto.data) return <SectionState kind="error" onRetry={data.refresh} text="Could not load state and category sales." minHeight={160} />;
    if (attr.total <= 0 || attr.states.length === 0) return <SectionState kind="empty" text="No orders in this period." minHeight={160} />;
    const top = slices[0];
    return (
      <>
        <Donut
          slices={slices} ariaLabel="Revenue share by state — top six plus others" centreTitle={["LARGEST", "STATE"]} centreValue={top ? `${(top.share * 100).toFixed(1)}%` : "—"} centreSub="of total revenue"
          selected={sel} onSlice={(n) => onSelect(sel === n ? null : n)}
        />
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginTop: 16 }}>
          <Label>{`TOTAL · ${periodText.toUpperCase()}`}</Label>
          <span style={{ fontSize: 15, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", ...TNUM }}>{rm(attr.total)}</span>
        </div>
        <div style={{ fontSize: 12, color: M.ink, marginTop: 4, lineHeight: 1.45 }}>{attr.states.length} state{attr.states.length === 1 ? "" : "s"}</div>
        <div style={{ marginTop: 12 }}>
          {slices.map((s) => {
            const grouped = !s.tappable;
            return (
              <button key={s.name} type="button" disabled={grouped} onClick={() => onOpenState(s.name)}
                style={{ ...rowBtn(44), cursor: grouped ? "default" : "pointer", opacity: sel && sel !== s.name && !grouped ? 0.45 : 1 }}
                aria-label={grouped ? undefined : `${s.name}: ${rm(s.sen)}. Products sold`}>
                <span aria-hidden="true" style={swatch(s.color)} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: M.raisin, ...NOWRAP_ELLIPSIS }}>{grouped ? `Others · ${attr.states.length - (slices.length - 1)} states` : s.name}</span>
                <span style={amt}>{rm(s.sen)}</span>
                <span style={pctCell}>{pct1(s.sen, attr.total)}</span>
                <Chevron hidden={grouped} />
              </button>
            );
          })}
        </div>
        {attr.states.length > slices.filter((s) => s.tappable).length ? <MoreRow label={`All ${attr.states.length} states`} onClick={onOpenAll} /> : null}
        <div style={{ marginTop: 4, paddingTop: 12, borderTop: `1px solid ${M.divider}` }}><Label>BY CATEGORY</Label></div>
        <div style={{ margin: "4px 0" }}>
          {attr.categories.slice(0, 4).map((c, i) => (
            <button key={c.name} type="button" onClick={() => onOpenCategory(c.name)} style={{ ...rowBtn(48), borderTop: i ? `1px solid ${M.divider}` : "none", cursor: "pointer" }} aria-label={`${titleCase(c.name)}: ${rm(c.revenueSen)}. Products sold`}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: M.raisin }}>{titleCase(c.name)}</span>
                <span style={{ display: "block", fontSize: 11.5, color: M.ink, marginTop: 1 }}>{c.qty.toLocaleString("en-MY")} sold</span>
              </span>
              <span style={amt}>{rm(c.revenueSen)}</span>
              <span style={pctCell}>{pct1(c.revenueSen, attr.total)}</span>
              <Chevron />
            </button>
          ))}
        </div>
        <div style={{ height: 6 }} />
      </>
    );
  };
  return (
    <HCard label="Sales by state and category" title="Sales by State & Category" sub="Tap a state or category for its products" padBottom={0}>
      {body()}
    </HCard>
  );
}

// ---------------------------------------------------------------------------
// Top sellers
// ---------------------------------------------------------------------------
export function TopSellersCard({
  data, periodText, cat, onCat, onOpen,
}: { data: SalesData; periodText: string; cat: "all" | "bedframe" | "sofa"; onCat: (c: "all" | "bedframe" | "sofa") => void; onOpen: (s: SellerSheet) => void }) {
  const [all, setAll] = useState(false);
  const ov = data.overview.data;
  const base = ov?.salesThisMonthSen ?? 0;
  const lim = all ? 10 : 5;
  const bed = ov?.topSellers?.BEDFRAME ?? [];
  const sofa = ov?.topSellers?.SOFA ?? [];
  const byCust = ov?.topSellersByCustomer;
  type R = { rank: number; name: string; q: number; sen: number; cust: number; open: SellerSheet };
  const bedRows: R[] = bed.slice(0, lim).map((p, i) => ({ rank: i + 1, name: p.productCode, q: p.qtySold, sen: p.valueSen, cust: byCust?.BEDFRAME?.[p.productCode]?.length ?? 0, open: { t: "sellerCust", cat: "bedframe", code: p.productCode } }));
  const sofaRows: R[] = sofa.slice(0, lim).map((p, i) => ({ rank: i + 1, name: p.model, q: p.setsSold, sen: p.valueSen, cust: byCust?.SOFA?.[p.model]?.length ?? 0, open: { t: "sellerCust", cat: "sofa", code: p.model } }));
  const groups = [
    ...(cat !== "sofa" ? [{ title: "BEDFRAME", qty: "UNITS", rows: bedRows }] : []),
    ...(cat !== "bedframe" ? [{ title: "SOFA", qty: "SETS", rows: sofaRows }] : []),
  ];
  const body = () => {
    if (data.overview.loading && !ov) return <SectionState kind="loading" minHeight={220} />;
    if (!ov) return <SectionState kind="error" onRetry={data.refresh} text="Could not load top sellers." minHeight={140} />;
    if (bedRows.length === 0 && sofaRows.length === 0) return <SectionState kind="empty" text="No sales in this period." minHeight={120} />;
    return (
      <>
        {groups.map((g) => (
          <div key={g.title} style={{ marginTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 8, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, color: M.taupe }}>
              <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap" }}>{g.title}</span>
              <span style={{ flex: "none", width: 44, textAlign: "right" }}>{g.qty}</span>
              <span style={{ flex: "none", minWidth: 104, textAlign: "right" }}>REVENUE</span>
            </div>
            {g.rows.length === 0 ? <div style={{ padding: "10px 0", fontSize: 13, color: M.ink, borderTop: `1px solid ${M.divider}` }}>No {g.title.toLowerCase()} sales in this period.</div> : null}
            {g.rows.map((t) => {
              const can = t.cust > 0;
              return (
                <button key={t.name} type="button" disabled={!can} onClick={() => onOpen(t.open)} aria-label={`${t.name}: ${t.q} ${g.qty.toLowerCase()}, ${rm(t.sen)}${can ? ". Customers" : ""}`}
                  style={{ ...rowBtn(52), padding: "6px 0", cursor: can ? "pointer" : "default" }}>
                  <span aria-hidden="true" style={{ width: 22, flex: "none", fontSize: 12.5, fontWeight: 700, color: t.rank <= 3 ? M.taupe : M.muted, ...TNUM }}>{t.rank}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: M.raisin, ...NOWRAP_ELLIPSIS }}>{t.name}</span>
                  <span style={{ flex: "none", width: 44, textAlign: "right", fontSize: 13, color: M.raisin, ...TNUM }}>{t.q.toLocaleString("en-MY")}</span>
                  <span style={{ flex: "none", minWidth: 104, textAlign: "right" }}>
                    <span style={{ display: "block", fontSize: rm(t.sen).length > 14 ? 12.5 : 14, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", ...TNUM }}>{rm(t.sen)}</span>
                    <span style={{ display: "block", fontSize: 11.5, color: M.ink, marginTop: 2, ...TNUM }}>{base > 0 ? `${((t.sen / base) * 100).toFixed(1)}%` : ""}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
        <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all} style={{ width: "100%", height: 46, border: "none", borderTop: `1px solid ${M.divider}`, background: "none", fontFamily: "inherit", fontSize: 14, fontWeight: 700, color: M.taupe, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4, marginTop: 4 }}>
          {all ? "Show top 5" : "Show top 10"}
          <span style={{ display: "flex", transform: all ? "rotate(180deg)" : "none" }}><ChevronDown size={15} strokeWidth={2} aria-hidden="true" /></span>
        </button>
      </>
    );
  };
  return (
    <HCard label="Top sellers" title="Top Sellers" sub={`${periodText} · % = share of the period’s sales · tap for customers`} padBottom={0}>
      <div style={{ display: "flex", marginTop: 12 }}><ChipRow options={CATS} value={cat} onChange={onCat} aria="Top seller category" /></div>
      {body()}
    </HCard>
  );
}

