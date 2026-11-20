// Home v10 / v12 · Sales (part 2): Sales by Customer & Month, Sales by State &
// Category, Top Sellers, and the detail sheets behind them. Look = Home Sales v12
// (glass cards from sales-glass.tsx); data and behaviour are unchanged.
//
// Customer data note (BUG-2026-08-13-142 on desktop): the server sends only the
// TOP 12 customers (`aovByCustomer`), by all-category revenue, but the
// concentration figures (`customerConcentration`) cover EVERY customer. Shares
// divide by the server's total, never by the rows held here, and the 12 are
// never described as the whole customer base.
import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, MapPin, Trophy, Users } from "lucide-react";
import { M } from "../../theme";
import { CHART_SERIES } from "../../../dashboards/dashboard-shared-lib";
import type { SalesData } from "./home-data";
import { attribute, customerRows, pct1, rm, stateSlices, titleCase, topPlusOthers, type CustCat, type StateCatRow } from "./home-lib";
import { Donut } from "./HomeDonut";
import { MoreRow, SectionState } from "./home-ui";
import { NOWRAP_ELLIPSIS, TNUM, amt, pctCell, rowBtn } from "./home-style";
import { Chev, Dot, G, GCard, GHint, GLabel, GPanel, GSwitch } from "./sales-glass";
import type { SellerSheet } from "./home-sheets";

const PIE = ["#16425B", "#1F6E8C", "#2E8FA3", "#4FA8B8", "#7FB9C6", "#A9C7D0", "#C6CDD3"] as const;
const CATS = [["all", "All"], ["bedframe", "Bedframe"], ["sofa", "Sofa"]] as const;
const RANK = "#8B7A4E";

/** One row of a v12 list panel: 8px dot · name · amount · share · chevron. The first row has no top rule. */
const lrow = (min: number, i: number) => ({ ...rowBtn(min), borderTop: i ? `1px solid ${G.rule}` : "none" });
/** v12 inner list panel (rows sit inside a translucent panel with 12px side padding). */
const ListPanel = ({ children }: { children: ReactNode }) => (
  <GPanel pad="0 12px" style={{ marginTop: 10, overflow: "hidden" }}>{children}</GPanel>
);
/** TOTAL · period read-out under a donut, inside its panel. */
function TotalLine({ periodText, total, extra }: { periodText: string; total: number; extra?: string }) {
  return (
    <div style={{ padding: "0 8px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginTop: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe }}>{`TOTAL · ${periodText.toUpperCase()}`}</span>
        <span style={{ fontSize: 15, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", ...TNUM }}>{rm(total)}</span>
      </div>
      {extra ? <div style={{ fontSize: 12, color: M.ink, marginTop: 4, lineHeight: 1.45 }}>{extra}</div> : null}
    </div>
  );
}
const DONUT_PANEL = { marginTop: 10 } as const;

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
    const tappable = m.slices.filter((s) => s.tappable);
    return (
      <>
        <GPanel style={DONUT_PANEL} pad="8px 6px 12px">
          <Donut
            slices={m.slices} ariaLabel="Revenue share by customer — top six plus others" centreTitle={["LARGEST", "CUSTOMER"]}
            centreValue={m.conc?.largestPct != null ? `${m.conc.largestPct.toFixed(1)}%` : "—"} centreSub="of total revenue"
          />
          <TotalLine
            periodText={periodText} total={m.total}
            extra={m.conc && m.conc.top10Pct != null ? `Top 10 = ${m.conc.top10Pct.toFixed(1)}% of revenue · ${m.conc.customerCount} customers` : "Top 10 share not available for this period"}
          />
        </GPanel>
        <ListPanel>
          {tappable.map((s, i) => (
            <button key={s.name} type="button" onClick={() => onOpenCustomer(s.name)} style={{ ...lrow(44, i), cursor: "pointer" }} aria-label={`${s.name}: ${rm(s.sen)}. Monthly breakdown`}>
              <Dot color={s.color} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: M.raisin, ...NOWRAP_ELLIPSIS }}>{s.name}</span>
              <span style={amt}>{rm(s.sen)}</span>
              <span style={pctCell}>{pct1(s.sen, m.total)}</span>
              <Chev />
            </button>
          ))}
          {others ? (
            <div style={{ ...lrow(44, tappable.length), cursor: "default" }}>
              <Dot color={others.color} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: M.raisin, ...NOWRAP_ELLIPSIS }}>{othersCount ? `Others · ${othersCount} customers` : "Others"}</span>
              <span style={amt}>{rm(others.sen)}</span>
              <span style={pctCell}>{pct1(others.sen, m.total)}</span>
              <Chev hidden />
            </div>
          ) : null}
          <MoreRow label={`Compare customers · top ${m.rows.length}${m.count ? ` of ${m.count}` : ""}`} onClick={onOpenAll} />
        </ListPanel>
        <GHint>Tap a customer for its monthly breakdown</GHint>
      </>
    );
  };
  return (
    <GCard icon={Users} label="Sales by customer" title="Sales by Customer & Month" sub={periodText}>
      <GSwitch options={CATS} value={cat} onChange={onCat} aria="Customer category" />
      {body()}
    </GCard>
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
        <GPanel style={DONUT_PANEL} pad="8px 6px 12px">
          <Donut
            slices={slices} ariaLabel="Revenue share by state — top six plus others" centreTitle={["LARGEST", "STATE"]} centreValue={top ? `${(top.share * 100).toFixed(1)}%` : "—"} centreSub="of total revenue"
            selected={sel} onSlice={(n) => onSelect(sel === n ? null : n)}
          />
          <TotalLine periodText={periodText} total={attr.total} extra={`${attr.states.length} state${attr.states.length === 1 ? "" : "s"}`} />
        </GPanel>
        <ListPanel>
          {slices.map((s, i) => {
            const grouped = !s.tappable;
            // v12: tapping a state highlights its donut slice (the list rows stay full colour) and opens its products.
            return (
              <button key={s.name} type="button" disabled={grouped} onClick={() => { onSelect(sel === s.name ? null : s.name); onOpenState(s.name); }}
                style={{ ...lrow(44, i), cursor: grouped ? "default" : "pointer" }}
                aria-label={grouped ? undefined : `${s.name}: ${rm(s.sen)}. Products sold`}>
                <Dot color={s.color} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: M.raisin, ...NOWRAP_ELLIPSIS }}>{grouped ? `Others · ${attr.states.length - (slices.length - 1)} states` : s.name}</span>
                <span style={amt}>{rm(s.sen)}</span>
                <span style={pctCell}>{pct1(s.sen, attr.total)}</span>
                <Chev hidden={grouped} />
              </button>
            );
          })}
          {attr.states.length > slices.filter((s) => s.tappable).length ? <MoreRow label={`All ${attr.states.length} states`} onClick={onOpenAll} /> : null}
        </ListPanel>
        <GLabel>BY CATEGORY</GLabel>
        <GPanel pad="0 12px" style={{ overflow: "hidden" }}>
          {attr.categories.slice(0, 4).map((c, i) => (
            <button key={c.name} type="button" onClick={() => onOpenCategory(c.name)} style={{ ...lrow(48, i), cursor: "pointer" }} aria-label={`${titleCase(c.name)}: ${rm(c.revenueSen)}. Products sold`}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: M.raisin }}>{titleCase(c.name)}</span>
                <span style={{ display: "block", fontSize: 11.5, color: M.ink, marginTop: 1 }}>{c.qty.toLocaleString("en-MY")} sold</span>
              </span>
              <span style={amt}>{rm(c.revenueSen)}</span>
              <span style={pctCell}>{pct1(c.revenueSen, attr.total)}</span>
              <Chev />
            </button>
          ))}
        </GPanel>
        <GHint>Tap a state or category for its products</GHint>
      </>
    );
  };
  return (
    <GCard icon={MapPin} label="Sales by state and category" title="Sales by State & Category" sub={periodText}>
      {body()}
    </GCard>
  );
}

// ---------------------------------------------------------------------------
// Top sellers
// ---------------------------------------------------------------------------
export function TopSellersCard({
  data, periodText, cat, onCat, onOpen,
}: { data: SalesData; periodText: string; cat: "all" | "bedframe" | "sofa"; onCat: (c: "all" | "bedframe" | "sofa") => void; onOpen: (s: SellerSheet) => void }) {
  // v12: each group (Bedframe / Sofa) has its own Show top 10 / Show top 5.
  const [openG, setOpenG] = useState<{ bed: boolean; sofa: boolean }>({ bed: false, sofa: false });
  const ov = data.overview.data;
  const base = ov?.salesThisMonthSen ?? 0;
  const bed = ov?.topSellers?.BEDFRAME ?? [];
  const sofa = ov?.topSellers?.SOFA ?? [];
  const byCust = ov?.topSellersByCustomer;
  type R = { rank: number; name: string; q: number; sen: number; cust: number; open: SellerSheet };
  const bedRows: R[] = bed.slice(0, openG.bed ? 10 : 5).map((p, i) => ({ rank: i + 1, name: p.productCode, q: p.qtySold, sen: p.valueSen, cust: byCust?.BEDFRAME?.[p.productCode]?.length ?? 0, open: { t: "sellerCust", cat: "bedframe", code: p.productCode } }));
  const sofaRows: R[] = sofa.slice(0, openG.sofa ? 10 : 5).map((p, i) => ({ rank: i + 1, name: p.model, q: p.setsSold, sen: p.valueSen, cust: byCust?.SOFA?.[p.model]?.length ?? 0, open: { t: "sellerCust", cat: "sofa", code: p.model } }));
  const groups = [
    ...(cat !== "sofa" ? [{ key: "bed" as const, title: "BEDFRAME", qty: "UNITS", rows: bedRows, more: bed.length > 5 }] : []),
    ...(cat !== "bedframe" ? [{ key: "sofa" as const, title: "SOFA", qty: "SETS", rows: sofaRows, more: sofa.length > 5 }] : []),
  ];
  const body = () => {
    if (data.overview.loading && !ov) return <SectionState kind="loading" minHeight={220} />;
    if (!ov) return <SectionState kind="error" onRetry={data.refresh} text="Could not load top sellers." minHeight={140} />;
    if (bedRows.length === 0 && sofaRows.length === 0) return <SectionState kind="empty" text="No sales in this period." minHeight={120} />;
    return (
      <>
        {groups.map((g) => {
          const expanded = openG[g.key];
          return (
            <GPanel key={g.title} pad="0 12px" style={{ marginTop: 12, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0 8px", fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, color: M.taupe }}>
                <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap" }}>{g.title}</span>
                <span style={{ flex: "none", width: 44, textAlign: "right" }}>{g.qty}</span>
                <span style={{ flex: "none", width: 104, textAlign: "right" }}>REVENUE</span>
              </div>
              {g.rows.length === 0 ? <div style={{ padding: "10px 0", fontSize: 13, color: M.ink, borderTop: `1px solid ${G.rule}` }}>No {g.title.toLowerCase()} sales in this period.</div> : null}
              {g.rows.map((t) => {
                const can = t.cust > 0;
                return (
                  <button key={t.name} type="button" disabled={!can} onClick={() => onOpen(t.open)} aria-label={`${t.name}: ${t.q} ${g.qty.toLowerCase()}, ${rm(t.sen)}${can ? ". Customers" : ""}`}
                    style={{ ...rowBtn(50), padding: "6px 0", cursor: can ? "pointer" : "default" }}>
                    <span aria-hidden="true" style={{ width: 20, flex: "none", fontSize: 12, fontWeight: 700, color: RANK, textAlign: "left", ...TNUM }}>{String(t.rank).padStart(2, "0")}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: M.raisin, ...NOWRAP_ELLIPSIS }}>{t.name}</span>
                    <span style={{ flex: "none", width: 44, textAlign: "right", fontSize: 13, color: M.raisin, ...TNUM }}>{t.q.toLocaleString("en-MY")}</span>
                    <span style={{ flex: "none", width: 104, textAlign: "right" }}>
                      <span style={{ display: "block", fontSize: rm(t.sen).length > 14 ? 12.5 : 13.5, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", ...TNUM }}>{rm(t.sen)}</span>
                      <span style={{ display: "block", fontSize: 11.5, color: M.ink, marginTop: 2, ...TNUM }}>{base > 0 ? `${((t.sen / base) * 100).toFixed(1)}%` : ""}</span>
                    </span>
                  </button>
                );
              })}
              {g.more ? (
                <button type="button" onClick={() => setOpenG((o) => ({ ...o, [g.key]: !o[g.key] }))} aria-expanded={expanded}
                  style={{ width: "100%", height: 42, border: "none", borderTop: `1px solid ${G.rule}`, background: "none", fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: M.taupe, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                  {expanded ? "Show top 5" : "Show top 10"}
                  <span style={{ display: "flex", transform: expanded ? "rotate(180deg)" : "none" }}><ChevronDown size={15} strokeWidth={2} aria-hidden="true" /></span>
                </button>
              ) : null}
            </GPanel>
          );
        })}
      </>
    );
  };
  return (
    <GCard icon={Trophy} label="Top sellers" title="Top Sellers" sub={periodText}>
      <GSwitch options={CATS} value={cat} onChange={onCat} aria="Top seller category" />
      {body()}
    </GCard>
  );
}
