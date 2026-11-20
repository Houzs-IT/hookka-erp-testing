// Home v10 · the Sales view: card stack + every detail sheet. Owns the sheet
// state machine (one <Sheet> stays mounted, so Back and nested sheets never
// remount). Data comes from home-data.ts; nothing is computed here.
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Receipt, RefreshCw, ShoppingCart, Truck, type LucideIcon } from "lucide-react";
import { useResponsiveLayout } from "../../lib/responsive-layout";
import { useCachedJson } from "@/lib/cached-fetch";
import { usePermissions } from "@/lib/use-permission";
import { M } from "../../theme";
import type { Period } from "../../../dashboards/dashboard-shared-lib";
import { parseDashPeriod } from "../../../../api/lib/dash-period";
import type { SalesAccess, SalesData } from "./home-data";
import { rm, titleCase, type CustCat } from "./home-lib";
import { ForecastCard, KpiSection, PipelineCard, RevenueCard, type KpiKind } from "./HomeSalesA";
import { CustomerOverdueCard } from "./HomeSalesOverdue";
import { CustomerCard, StateCategoryCard, TopSellersCard } from "./HomeSalesB";
import { customerSheet, sellerSheet, stateSheet, useStateRows, type CustSheet, type SellerSheet, type SheetSpec, type StateSheet } from "./home-sheets";
import { SheetCard } from "./home-ui";
import { NOWRAP_ELLIPSIS, TNUM } from "./home-style";
import { Dot, GLabel, GListCard, GLinkButton, GOption, GPanel, GSheetFrame, GTotalBar } from "./sales-glass";
import { resolveStatus, STATUS_MAPS, PAYMENT_STATUS_MAP } from "../../config/helpers";

type Sheet = { t: "kpi"; kind: KpiKind } | { t: "legend" } | CustSheet | StateSheet | SellerSheet;

// ---------------------------------------------------------------------------
// KPI drill sheets (desktop dashboard-b/KpiDrills.tsx: the rows a tile adds up)
// ---------------------------------------------------------------------------
type DocRow = { id: string; no: string; party: string; date: string; status: string; total: number };

type SortKey = "date" | "amount" | "customer";
const SORTS: readonly (readonly [SortKey, string])[] = [["date", "Newest first"], ["amount", "Highest amount"], ["customer", "Customer A–Z"]];
const TOP_ROWS = 4;

/** Sheet list (Sales / Invoices): sticky TOTAL, sort + status filter (client-side, over the rows loaded), top 4 + Show all. */
function DocList({
  rows, loading, failed, kind, note, onOpen,
}: { rows: DocRow[]; loading: boolean; failed: boolean; kind: "sales" | "invoices"; note?: ReactNode; onOpen: (() => void) | null }) {
  const [sort, setSort] = useState<SortKey>("date");
  const [st, setSt] = useState("all");
  const [all, setAll] = useState(false);
  const [menu, setMenu] = useState(false);
  const statuses = useMemo(() => [...new Set(rows.map((r) => r.status))], [rows]);
  const filtered = useMemo(() => {
    const f = st === "all" ? rows.slice() : rows.filter((r) => r.status === st);
    // Rows arrive newest first (by document date); "date" keeps that order.
    if (sort === "amount") f.sort((a, b) => b.total - a.total);
    else if (sort === "customer") f.sort((a, b) => a.party.localeCompare(b.party));
    return f;
  }, [rows, sort, st]);
  const map = kind === "sales" ? STATUS_MAPS.so : PAYMENT_STATUS_MAP;
  if (loading) return <div style={{ padding: "26px 0", textAlign: "center", fontSize: 13, color: M.ink }}>Loading…</div>;
  if (failed) return <div role="alert" style={{ padding: "26px 0", textAlign: "center", fontSize: 13, color: M.ink }}>Could not load this list.</div>;
  // TOTAL is always the whole period's total; a status filter never changes it, the filtered figure is shown beside it.
  const total = rows.reduce((a, r) => a + r.total, 0);
  const isFiltered = st !== "all";
  const shown = all ? filtered : filtered.slice(0, TOP_ROWS);
  const noun = kind === "sales" ? "orders" : "invoices";
  const sortLabel = (SORTS.find(([k]) => k === sort) ?? SORTS[0])[1] + (isFiltered ? ` · ${titleCase(st)}` : "");
  const link: { icon: LucideIcon; label: string } = kind === "sales" ? { icon: ShoppingCart, label: "Open Sales Orders" } : { icon: Receipt, label: "Open Invoices" };
  return (
    <>
      <GTotalBar
        total={rm(total)} count={`${rows.length} ${noun}`} menuOpen={menu} onMenu={() => setMenu((m) => !m)} active={isFiltered || sort !== "date"}
        note={isFiltered ? `Showing ${filtered.length} of ${rows.length} · ${rm(filtered.reduce((a, r) => a + r.total, 0))}` : undefined}
      />
      {menu ? (
        <GPanel pad={12} style={{ display: "grid", gap: 10 }}>
          <GLabel>SORT BY</GLabel>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {SORTS.map(([k, l]) => <GOption key={k} on={sort === k} label={l} onClick={() => setSort(k)} />)}
          </div>
          <GLabel>STATUS</GLabel>
          <div style={{ display: "flex", gap: 6, overflowX: "auto", scrollbarWidth: "none" }}>
            {["all", ...statuses].map((x) => <GOption key={x} on={st === x} label={x === "all" ? "All" : titleCase(x)} onClick={() => { setSt(x); setAll(false); }} />)}
          </div>
        </GPanel>
      ) : null}
      <GLabel>{sortLabel.toUpperCase()}</GLabel>
      <GListCard>
        {filtered.length === 0 ? <div style={{ padding: "22px 0", textAlign: "center", fontSize: 13, color: M.ink }}>Nothing here.</div> : null}
        {shown.map((r, i) => {
          const hex = resolveStatus(r.status, map).style.hex;
          return (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 56, padding: "8px 0", borderTop: i ? `1px solid ${M.divider}` : "none" }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: M.raisin, ...NOWRAP_ELLIPSIS }}>{r.party}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3, fontSize: 11.5, color: M.ink, whiteSpace: "nowrap", ...TNUM }}>
                  <span style={NOWRAP_ELLIPSIS}>{r.no}</span><span aria-hidden="true">·</span><span>{r.date}</span>
                </span>
              </span>
              <span style={{ flex: "none", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", ...TNUM }}>{rm(r.total)}</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: hex, whiteSpace: "nowrap" }}><Dot color={hex} style={{ width: 6, height: 6 }} />{titleCase(r.status)}</span>
              </span>
            </div>
          );
        })}
        {filtered.length > TOP_ROWS ? (
          <button type="button" onClick={() => setAll((a) => !a)} style={{ width: "100%", height: 44, border: "none", borderTop: `1px solid ${M.divider}`, background: "none", fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: M.taupe, cursor: "pointer" }}>
            {all ? "Show fewer" : `Show all ${filtered.length}`}
          </button>
        ) : null}
      </GListCard>
      {note ? <div style={{ fontSize: 11.5, lineHeight: 1.45, color: M.ink, padding: "0 4px" }}>{note}</div> : null}
      {onOpen ? <GLinkButton icon={link.icon} label={link.label} onClick={onOpen} /> : null}
    </>
  );
}

function SoListDrill({ periodKey, onOpen }: { periodKey: string; onOpen: (() => void) | null }) {
  const { data, loading, failure } = useCachedJson<{ data?: { id: string; companySOId?: string | null; companySO?: string | null; customerName?: string | null; companySODate?: string | null; createdAt?: string | null; status: string; totalSen?: number | null }[] }>("/api/sales-orders");
  const dp = useMemo(() => parseDashPeriod(periodKey), [periodKey]);
  const rows = useMemo<DocRow[]>(
    () => (data?.data ?? [])
      .filter((o) => !["DRAFT", "CANCELLED", "ON_HOLD"].includes(o.status) && dp.inYm(o.companySODate ?? o.createdAt))
      .sort((a, b) => String(b.companySODate ?? b.createdAt).localeCompare(String(a.companySODate ?? a.createdAt)))
      .map((o) => ({ id: o.id, no: o.companySOId ?? o.companySO ?? o.id, party: o.customerName ?? "—", date: String(o.companySODate ?? o.createdAt ?? "").slice(0, 10), status: o.status, total: o.totalSen ?? 0 })),
    [data, dp],
  );
  return <DocList kind="sales" rows={rows} loading={loading && !data} failed={!data && !!failure} onOpen={onOpen} note="This list leaves out service orders; the Sales tile includes them, so the tile can be a little higher." />;
}

function InvoiceListDrill({ periodKey, onOpen }: { periodKey: string; onOpen: (() => void) | null }) {
  const { data, loading, failure } = useCachedJson<{ data?: { id?: string; invoiceNo?: string | null; customerName?: string | null; invoiceDate?: string | null; status: string; totalSen?: number | null }[] }>("/api/invoices");
  const dp = useMemo(() => parseDashPeriod(periodKey), [periodKey]);
  const rows = useMemo<DocRow[]>(
    () => (data?.data ?? [])
      .filter((i) => i.status !== "CANCELLED" && dp.inYm(i.invoiceDate))
      .sort((a, b) => String(b.invoiceDate).localeCompare(String(a.invoiceDate)))
      .map((i, n) => ({ id: i.id ?? `${i.invoiceNo}-${n}`, no: i.invoiceNo ?? i.id ?? "—", party: i.customerName ?? "—", date: String(i.invoiceDate ?? "").slice(0, 10), status: i.status, total: i.totalSen ?? 0 })),
    [data, dp],
  );
  return <DocList kind="invoices" rows={rows} loading={loading && !data} failed={!data && !!failure} onOpen={onOpen} />;
}

/** Stage / status table of a sheet (v12: white list card, bold first column, taupe foot row) + the "Open …" link. */
function TableDrill({ rows, foot, note, link, onOpen }: { rows: { a: ReactNode; b?: string; v: string }[]; foot: [string, string]; note: string; link: { icon: LucideIcon; label: string }; onOpen: (() => void) | null }) {
  return (
    <>
      <GListCard>
        {rows.map((r, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 48, padding: "7px 0", borderTop: i ? `1px solid ${M.divider}` : "none" }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: M.raisin }}>{r.a}</span>
              {r.b ? <span style={{ display: "block", fontSize: 11, color: M.ink, marginTop: 1 }}>{r.b}</span> : null}
            </span>
            <span style={{ flex: "none", fontSize: 13.5, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", ...TNUM }}>{r.v}</span>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, minHeight: 46, alignItems: "center", borderTop: `1px solid ${M.hairline}`, fontSize: 13.5, fontWeight: 700, color: M.taupe }}>
          <span>{foot[0]}</span><span style={{ whiteSpace: "nowrap", ...TNUM }}>{foot[1]}</span>
        </div>
      </GListCard>
      <div style={{ fontSize: 11.5, lineHeight: 1.45, color: M.ink, padding: "0 4px" }}>{note}</div>
      {onOpen ? <GLinkButton icon={link.icon} label={link.label} onClick={onOpen} /> : null}
    </>
  );
}

function PendingDrill({ data, onOpen }: { data: SalesData; onOpen: (() => void) | null }) {
  const pend = data.pending.data?.pendingDeliveryValueSen;
  const v = data.doStats.data?.valueByStatus ?? {};
  if (pend == null || !data.doStats.data) return <div style={{ padding: "26px 0", textAlign: "center", fontSize: 13, color: M.ink }}>{data.pending.loading || data.doStats.loading ? "Loading…" : "Could not load the delivery stages."}</div>;
  const stages = [
    ["Made, not on a DO", "finished, waiting for a delivery order", pend],
    ["On a draft DO", "delivery order raised, not dispatched", v.DRAFT ?? 0],
    ["On the road", "dispatched / in transit, not yet delivered", (v.LOADED ?? 0) + (v.IN_TRANSIT ?? 0)],
  ] as const;
  return (
    <TableDrill
      rows={stages.map(([a, b, c]) => ({ a, b, v: rm(c) }))} foot={["Total", rm(stages.reduce((s, x) => s + x[2], 0))]}
      note="These stages are live figures. For a finished period the tile shows the saved month-end figure instead, so the two can differ."
      link={{ icon: Truck, label: "Open Delivery Orders" }} onOpen={onOpen}
    />
  );
}

function OutstandingDrill({ data, onOpen }: { data: SalesData; onOpen: (() => void) | null }) {
  const s = data.soStats.data;
  if (!s) return <div style={{ padding: "26px 0", textAlign: "center", fontSize: 13, color: M.ink }}>{data.soStats.loading ? "Loading…" : "Could not load the order totals."}</div>;
  const order = ["CONFIRMED", "IN_PRODUCTION", "READY_TO_SHIP", "SHIPPED", "DELIVERED", "INVOICED", "CLOSED"];
  const rows: { a: ReactNode; b?: string; v: string }[] = order
    .filter((k) => (s.revenueByStatus?.[k] ?? 0) > 0)
    .map((k) => ({ a: <>{titleCase(k)} <span style={{ color: M.muted, fontWeight: 500 }}>· {s.byStatus?.[k] ?? 0} orders</span></>, v: rm(s.revenueByStatus?.[k] ?? 0) }));
  rows.push({ a: "= Confirmed value", v: rm(s.csRevenueSen ?? 0) });
  rows.push({ a: "− Delivered value", v: `− ${rm(s.deliveredItemsSen ?? 0)}` });
  return (
    <TableDrill
      rows={rows} foot={["Outstanding", rm(s.outstandingItemsSen ?? 0)]}
      note="Live, whatever the period: every confirmed order ever, less what has been delivered — what we still owe customers in goods."
      link={{ icon: ShoppingCart, label: "Open Sales Orders" }} onOpen={onOpen}
    />
  );
}

function LegendSheet() {
  const items: [string, string, string?][] = [
    ["Hit target", "#4F7C3A"], ["Missed target", "#9C6F1E"], ["Invoiced so far (current)", "#6B5C32"], ["No target keyed", "#A39E93"],
    ["Still needed for target", M.divider, `1px dashed ${M.faint}`], ["Future (target only)", "#E3DED5"],
  ];
  return (
    <>
      <SheetCard pad="4px 13px">
        {items.map(([label, c, b], i) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 11, minHeight: 42, borderTop: i ? `1px solid ${M.divider}` : "none" }}>
            <Dot color={c} style={{ width: 10, height: 10, boxSizing: "border-box", border: b ?? "none" }} />
            <span style={{ fontSize: 13, color: M.raisin }}>{label}</span>
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 11, minHeight: 42, borderTop: `1px solid ${M.divider}` }}>
          <span aria-hidden="true" style={{ width: 16, height: 0, flex: "none", borderTop: "3px solid #3E6570" }} /><span style={{ fontSize: 13, color: M.raisin }}>Target</span>
        </div>
      </SheetCard>
    </>
  );
}

// ---------------------------------------------------------------------------
export function SalesView({
  data, access, period, periodKey, periodText, curYm, todayYmd, onRefresh, refreshedAt,
}: { data: SalesData; access: SalesAccess; period: Period; periodKey: string; periodText: string; curYm: string; todayYmd: string; onRefresh: () => void; refreshedAt: Date | null }) {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  // The "Open …" links only show for a role that may read that module (the drill itself follows the dashboard access).
  const open = (resource: string, to: string) => (hasPermission(resource, "read") ? () => navigate(to) : null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [custCat, setCustCat] = useState<CustCat>("all");
  const [sellCat, setSellCat] = useState<CustCat>("all");
  // The highlighted state belongs to the period it was picked in: another period starts clean.
  const [stateSelRaw, setStateSelRaw] = useState<{ p: string; n: string } | null>(null);
  const stateSel = stateSelRaw && stateSelRaw.p === periodKey ? stateSelRaw.n : null;
  // Leaving the period drops the pick for good (returning to it later does not bring the dimming back).
  if (stateSelRaw && stateSelRaw.p !== periodKey) setStateSelRaw(null);
  const setStateSel = (n: string | null) => setStateSelRaw(n == null ? null : { p: periodKey, n });
  const rows = useStateRows(data, period);
  // Tablets: the same cards, two to a row (KPIs, revenue and top sellers stay full width).
  const wide = useResponsiveLayout().mode !== "phone";
  const full = wide ? { gridColumn: "1 / -1" } : undefined;
  const cell: React.CSSProperties = { display: "grid", minWidth: 0 };
  const close = useCallback(() => setSheet(null), []);

  const spec: (SheetSpec & { back?: Sheet }) | null = (() => {
    if (!sheet) return null;
    switch (sheet.t) {
      case "kpi": {
        const k = sheet.kind;
        if (k === "sales") return { title: `Sales · ${periodText}`, sub: "Confirmed orders (not draft, cancelled or on hold), by SO date", body: <SoListDrill periodKey={periodKey} onOpen={open("sales-orders", "/m/sales")} /> };
        if (k === "invoices") return { title: `Invoices · ${periodText}`, sub: "Invoices excluding cancelled, by invoice date", body: <InvoiceListDrill periodKey={periodKey} onOpen={open("invoices", "/m/invoices")} /> };
        if (k === "pending") return { title: "Pending delivery", sub: "Made, on a delivery order, or on the road — not yet delivered", body: <PendingDrill data={data} onOpen={open("delivery-orders", "/m/delivery")} /> };
        return { title: "Outstanding", sub: "Confirmed order value less delivered value", body: <OutstandingDrill data={data} onOpen={open("sales-orders", "/m/sales")} /> };
      }
      case "legend": return { title: "Sales forecast key", sub: "How to read the bars", body: <LegendSheet /> };
      case "customers":
      case "custMonthly": {
        const s = customerSheet(sheet, { data, cat: custCat, periodText, open: setSheet });
        return { ...s, back: s.backTo as Sheet | undefined };
      }
      case "states":
      case "prods": {
        const s = stateSheet(sheet, { rows, periodText, open: setSheet });
        return { ...s, back: s.backTo as Sheet | undefined };
      }
      case "sellerCust": return sellerSheet(sheet, { data, periodText });
    }
  })();

  return (
    <div style={{ padding: "14px 16px 120px", display: "grid", gridTemplateColumns: wide ? "repeat(2,minmax(0,1fr))" : "minmax(0,1fr)", gap: 20 }}>
      {!access.view ? null : (
        <>
          <div style={{ ...cell, ...full }}><KpiSection data={data} access={access} periodKey={periodKey} periodText={periodText} curYm={curYm} onOpen={(kind) => setSheet({ t: "kpi", kind })} /></div>
          <div style={{ ...cell, ...full }}><CustomerOverdueCard enabled={access.view} /></div>
          <div style={{ ...cell, ...full }}><RevenueCard data={data} access={access} /></div>
          <div style={cell}><PipelineCard data={data} periodKey={periodKey} periodText={periodText} /></div>
          <div style={cell}><ForecastCard data={data} access={access} period={period} todayYmd={todayYmd} onLegend={() => setSheet({ t: "legend" })} /></div>
          <div style={cell}><CustomerCard data={data} cat={custCat} onCat={setCustCat} periodText={periodText} onOpenCustomer={(name) => setSheet({ t: "custMonthly", name, fromList: false })} onOpenAll={() => setSheet({ t: "customers" })} /></div>
          <div style={cell}>
            <StateCategoryCard
              data={data} rows={rows} periodText={periodText} selected={stateSel} onSelect={setStateSel}
              onOpenState={(name) => { setStateSel(stateSel === name ? null : name); setSheet({ t: "prods", kind: "state", key: name, fromList: false }); }}
              onOpenCategory={(name) => setSheet({ t: "prods", kind: "category", key: name, fromList: false })}
              onOpenAll={() => setSheet({ t: "states" })}
            />
          </div>
          <div style={{ ...cell, ...full }}><TopSellersCard data={data} periodText={periodText} cat={sellCat} onCat={setSellCat} onOpen={setSheet} /></div>
          <div style={{ display: "flex", justifyContent: "center", ...full }}>
            <button type="button" onClick={onRefresh} style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 36, padding: "0 14px", border: "none", borderRadius: 999, background: "none", color: M.ink, fontFamily: "inherit", fontSize: 12, cursor: "pointer" }}>
              <RefreshCw size={13} strokeWidth={1.9} color={M.taupe} aria-hidden="true" />
              Refresh data{refreshedAt ? ` · requested ${refreshedAt.toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" })}` : ""}
            </button>
          </div>
        </>
      )}
      {spec ? (
        <GSheetFrame open title={spec.title} sub={spec.sub} onBack={spec.back ? () => setSheet(spec.back!) : undefined} onClose={close}>
          {spec.body}
        </GSheetFrame>
      ) : null}
    </div>
  );
}
