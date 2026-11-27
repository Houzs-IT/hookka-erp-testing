// ===========================================================================
// InventoryScreen — /m/inventory (Final Batch 5, Claude Design "Inventory
// (standalone)"). Five tabs: Finished Goods · WIP · Raw Materials · Fabrics ·
// Adjustments, each with KPI tiles, search, sort, category chips and cards.
//
//   Finished Goods  /api/products + /api/inventory/fg-stock   → /m/inventory/fg.<productId>
//   WIP             /api/inventory/wip (lazy)                 → /m/inventory/wip.<id>
//   Raw Materials   /api/raw-materials                        → /m/inventory/<rm id> (old links keep working)
//   Fabrics         /api/fabric-tracking                      → read-only sheet
//   Adjustments     /api/stock-adjustments                    → read-only sheet
//
// Quantities only — no money anywhere (owner S-2). Options = Refresh (Add FG,
// Batch Import and Export are desktop-only). The module is gated on the
// desktop /inventory nav gate; Fabrics and Adjustments on their own gates.
// On a tablet with no item open, the list sits beside a placeholder pane
// (nothing is auto-opened, so browser back stays honest).
// ===========================================================================
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowDownUp, BedDouble, Boxes, CircleOff, Clock, CloudOff, Ellipsis, Hammer, Layers, Lock, PackageCheck, PackageOpen, RefreshCw,
  Ruler, Scissors, Search, SearchX, SlidersHorizontal, Sofa, Tags, TriangleAlert, X as XIcon, type LucideIcon,
} from "lucide-react";
import { MobileHeader, ResponsiveGrid } from "../../components";
import { PaneProvider, resolveContainerLayout, useContainerLayout, useResponsiveLayout } from "../../lib/responsive-layout";
import {
  ADJ_TYPES, ageLabel, ageTone, chipsFromData, dateLabel, DEFAULT_SORT, detailPath, fabricKpis, fabricTone, fgActive, fgKpis, fgSub,
  fgTone, matches, minStockLabel, parseDetailId, plainQty, PRODUCT_CATEGORIES, q2, reasonLabel, rmKpis, rmTone, searchAdj, searchFabric,
  searchFg, searchRm, searchWip, signed, sortAdj, sortFabric, sortFg, sortRm, sortWip, SORTS, TAB_OF_KIND, TABS, titleCase, wipAge,
  wipKpis, WIP_NEGATIVE_HINT, wipSub, wipTitle, withUom, type AdjRow, type FabricRow, type FgRow, type RmRow, type TabKey, type WipRow,
} from "../../lib/inventory-lib";
import { StateCard, TplSheet, TplStyles } from "../threepl/tpl-kit";
import { AdjSheet, FabricSheet } from "./InfoSheets";
import { useAdjList, useFabricList, useFgList, useInvPerms, useRmList, useWipList, type ListState } from "./inv-data";
import { KpiGrid, ListCard, MoreButton, Notice, Skeletons, type Amt, type BadgeSpec, type Kpi } from "./inv-kit";
import { CHIP_BTN, LABEL, ROUND_BTN, SH_CONTROL, TONE, X } from "./inv-style";
import { useInvToast } from "./inv-toast";

const PAGE = 40;
const TAB_ICON: Record<TabKey, LucideIcon> = { fg: PackageCheck, wip: Hammer, rm: Layers, fab: Scissors, adj: SlidersHorizontal };
const PH: Record<TabKey, string> = {
  fg: "Code, name or size",
  wip: "PO code, product or WIP type",
  rm: "Material code or description",
  fab: "Fabric code or description",
  adj: "Adjustment no., item or reason",
};
const UNIT: Record<TabKey, [string, string]> = { fg: ["SKU", "SKUs"], wip: ["WIP item", "WIP items"], rm: ["material", "materials"], fab: ["fabric", "fabrics"], adj: ["adjustment", "adjustments"] };
const EMPTY: Record<TabKey, string> = { fg: "No finished goods", wip: "No work in progress", rm: "No raw materials", fab: "No fabrics", adj: "No adjustments yet" };
const SECTION: Record<TabKey, string> = { fg: "finished goods stock", wip: "work in progress", rm: "raw materials", fab: "fabric tracking", adj: "stock adjustments" };

// The screen remounts when the tablet split opens / closes (the shell swaps
// layouts), so the tab, search, chip and sort live here, not only in state.
const memo: { tab: TabKey; q: string; cat: Record<TabKey, string>; sort: Record<TabKey, string> } = {
  tab: "fg",
  q: "",
  cat: { fg: "all", wip: "all", rm: "all", fab: "all", adj: "all" },
  sort: { ...DEFAULT_SORT },
};

type Info = { kind: "fab"; row: FabricRow } | { kind: "adj"; row: AdjRow } | null;

export function InventoryScreen() {
  const navigate = useNavigate();
  const { id: openRaw } = useParams();
  const openRef = openRaw ? parseDetailId(openRaw) : null;
  const layout = useResponsiveLayout();
  const container = useContainerLayout();
  const ownSplit = layout.canSplitDetail && !openRaw && container.pane === "full";
  const listPane = ownSplit || container.pane === "list";
  const perms = useInvPerms();
  const toast = useInvToast();

  const [tab, setTabState] = useState<TabKey>(() => (openRef ? TAB_OF_KIND[openRef.kind] : memo.tab));
  const [q, setQ] = useState(memo.q);
  const [cat, setCat] = useState(memo.cat);
  const [sort, setSort] = useState(memo.sort);
  const [page, setPage] = useState(PAGE);
  const [sheet, setSheet] = useState<"sort" | "opts" | null>(null);
  const [info, setInfo] = useState<Info>(null);
  const [spin, setSpin] = useState(false);
  const closeInfo = useCallback(() => setInfo(null), []);
  useEffect(() => {
    memo.tab = tab;
    memo.q = q;
    memo.cat = cat;
    memo.sort = sort;
  }, [tab, q, cat, sort]);

  // A detail opened from a link selects its own tab in the list pane.
  const openKind = openRef?.kind;
  const [seenKind, setSeenKind] = useState(openKind);
  if (openKind !== seenKind) {
    setSeenKind(openKind);
    if (openKind) setTabState(TAB_OF_KIND[openKind]);
  }

  const allowed = (k: TabKey) => perms.module && (k === "fab" ? perms.fabrics : k === "adj" ? perms.adjustments : true);
  const tabs = TABS.filter((t) => perms.loading || allowed(t.k));
  const active: TabKey = perms.loading || allowed(tab) ? tab : "fg";
  const on = (k: TabKey) => !perms.loading && allowed(k) && active === k;

  const fg = useFgList(on("fg"));
  const wip = useWipList(on("wip"));
  const rm = useRmList(on("rm"));
  const fab = useFabricList(on("fab"));
  const adj = useAdjList(on("adj"));
  const cur = { fg, wip, rm, fab, adj }[active] as ListState<unknown>;

  // Refresh: spin until the active tab's reads land again.
  const spinStamp = useRef<unknown>(null);
  const { show: showToast } = toast;
  useEffect(() => {
    if (!spin || cur.stamp === spinStamp.current) return;
    setSpin(false);
    if (cur.error) showToast(cur.error, "err");
    else showToast("Updated just now");
  }, [spin, cur.stamp, cur.error, showToast]);
  const refresh = () => {
    spinStamp.current = cur.stamp;
    setSpin(true);
    cur.refresh();
  };

  const setTab = (k: TabKey) => {
    setTabState(k);
    setQ("");
    setPage(PAGE);
    if (openRef && TAB_OF_KIND[openRef.kind] !== k) navigate("/m/inventory", { replace: true });
  };

  // ---- the active tab's rows, filtered + sorted ----
  const c = cat[active];
  const s = sort[active];
  const view = useMemo((): unknown[] => {
    const pick = <T,>(L: T[], catOf: (x: T) => string, hay: (x: T) => string) => L.filter((x) => (c === "all" || catOf(x) === c) && matches(hay(x), q));
    if (active === "fg") return sortFg(pick(fg.rows, (x) => x.category, searchFg), s);
    if (active === "wip") return sortWip(pick(wip.rows, (x) => x.category, searchWip), s);
    if (active === "rm") return sortRm(pick(rm.rows, (x) => x.itemGroup, searchRm), s);
    if (active === "fab") return sortFabric(pick(fab.rows, (x) => x.fabricCategory, searchFabric), s);
    return sortAdj(pick(adj.rows, (x) => x.type, searchAdj), s);
  }, [active, c, s, q, fg.rows, wip.rows, rm.rows, fab.rows, adj.rows]);
  const total = cur.rows.length;

  const chips = useMemo((): { k: string; l: string; n: number }[] => {
    const count = <T,>(L: T[], f: (x: T) => string, keys: string[], label: (k: string) => string) => [
      { k: "all", l: "All", n: L.length },
      ...keys.map((k) => ({ k, l: label(k), n: L.filter((x) => f(x) === k).length })),
    ];
    if (active === "fg") return count(fg.rows, (x) => x.category, PRODUCT_CATEGORIES, titleCase);
    if (active === "wip") return count(wip.rows, (x) => x.category, PRODUCT_CATEGORIES, titleCase);
    if (active === "rm") return count(rm.rows, (x) => x.itemGroup, chipsFromData(rm.rows.map((x) => x.itemGroup)), (k) => k);
    if (active === "fab") return count(fab.rows, (x) => x.fabricCategory, chipsFromData(fab.rows.map((x) => x.fabricCategory)), (k) => k);
    return count(adj.rows, (x) => x.type, ADJ_TYPES, (k) => k);
  }, [active, fg.rows, wip.rows, rm.rows, fab.rows, adj.rows]);

  const kpis = useMemo((): Kpi[] | null => {
    const T = TONE;
    if (active === "fg") {
      const k = fgKpis(fg.rows);
      return [
        { l: "Total SKUs", v: String(k.total), icon: Boxes, c: T.br.c, b: T.br.b },
        { l: "Available · On draft DO", v: `${q2(k.available)} / ${q2(k.draft)} pcs`, icon: PackageCheck, c: T.ok.c, b: T.ok.b },
        { l: "Bedframe SKUs", v: String(k.bedframe), icon: BedDouble, c: X.bed, b: X.bedb },
        { l: "Sofa SKUs", v: String(k.sofa), icon: Sofa, c: X.sofa, b: X.sofab },
      ];
    }
    if (active === "wip") {
      const k = wipKpis(wip.rows);
      return [
        { l: "Total WIP Items", v: String(k.total), icon: Hammer, c: T.br.c, b: T.br.b },
        { l: "Total Qty", v: `${plainQty(k.qty)} pcs`, icon: Layers, c: T.info.c, b: T.info.b },
        { l: "Oldest (days)", v: String(k.oldest), icon: Clock, c: T.warn.c, b: T.warn.b },
        { l: "More than 7 Days", v: String(k.over7), icon: TriangleAlert, c: T.bad.c, b: T.bad.b },
      ];
    }
    if (active === "rm") {
      const k = rmKpis(rm.rows);
      return [
        { l: "Total Materials", v: String(k.total), icon: Layers, c: T.br.c, b: T.br.b },
        { l: "Categories", v: String(k.groups), icon: Tags, c: T.info.c, b: T.info.b },
        { l: "Low Stock (<5)", v: String(k.low), icon: TriangleAlert, c: T.warn.c, b: T.warn.b },
        { l: "Zero Stock", v: String(k.zero), icon: CircleOff, c: T.bad.c, b: T.bad.b },
      ];
    }
    if (active === "fab") {
      const k = fabricKpis(fab.rows);
      return [
        { l: "Total Fabrics", v: String(k.total), icon: Scissors, c: T.br.c, b: T.br.b },
        { l: "Total Stock on Hand (m)", v: k.soh.toLocaleString("en-MY", { minimumFractionDigits: 1, maximumFractionDigits: 1 }), icon: Ruler, c: T.info.c, b: T.info.b },
      ];
    }
    return null;
  }, [active, fg.rows, wip.rows, rm.rows, fab.rows]);

  const kpiCols = kpis && kpis.length === 4 && !listPane && container.width >= 520 ? 4 : 2;
  const sortL = SORTS[active].find((x) => x.k === s)?.l ?? SORTS[active][0].l;
  const fN = s !== DEFAULT_SORT[active] ? 1 : 0;
  const clearFilters = () => {
    setQ("");
    setCat((m) => ({ ...m, [active]: "all" }));
    setPage(PAGE);
  };

  // ---- cards ----
  const openDetail = (kind: "fg" | "wip" | "rm", id: string) => navigate(detailPath({ kind, id }));
  const isCurrent = (kind: "fg" | "wip" | "rm", id: string) => !!openRef && openRef.kind === kind && openRef.id === id;
  const card = (x: unknown): ReactNode => {
    if (active === "fg") {
      const f = x as FgRow;
      const [l, t] = fgTone(f);
      const badges: BadgeSpec[] = [{ l, tone: t }, { l: fgActive(f) ? "Active" : titleCase(f.status), tone: fgActive(f) ? "br" : "neu" }];
      const amts: Amt[] = [
        { k: "Available", v: `${q2(f.stockQty)} pcs`, c: f.stockQty <= 0 ? X.bad : undefined },
        { k: "On draft DO", v: `${q2(f.reservedQty)} pcs`, c: f.reservedQty > 0 ? X.warn : X.mut },
      ];
      return <ListCard key={f.id} code={f.code} badges={badges} title={f.name} sub={fgSub(f)} amts={amts} rail={TONE[t].c} faded={!fgActive(f)} current={isCurrent("fg", f.id)} onTap={() => openDetail("fg", f.id)} aria={`${f.code}, ${f.name}`} />;
    }
    if (active === "wip") {
      const w = x as WipRow;
      const neg = w.totalQty < 0;
      const age = wipAge(w);
      const at = ageTone(age);
      const badges: BadgeSpec[] = [...(neg ? [{ l: "Negative qty", tone: "bad" as const }] : []), ...(age != null ? [{ l: `${ageLabel(age)} old`, tone: at }] : [])];
      const amts: Amt[] = [
        { k: "Total qty", v: `${plainQty(w.totalQty)} pcs`, c: neg ? X.bad : undefined },
        { k: "Source POs", v: String(w.sources.length) },
        { k: "FIFO age", v: ageLabel(age), c: at === "neu" ? undefined : TONE[at].c },
      ];
      return <ListCard key={w.id} code={w.wipCode || "—"} badges={badges} title={wipTitle(w)} sub={wipSub(w)} amts={amts} rail={neg ? X.bad : at === "neu" ? X.chev : TONE[at].c} warn={neg ? WIP_NEGATIVE_HINT : ""} current={isCurrent("wip", w.id)} onTap={() => openDetail("wip", w.id)} aria={`${w.wipCode}, ${wipTitle(w)}`} />;
    }
    if (active === "rm") {
      const r = x as RmRow;
      const [l, t] = rmTone(r);
      const amts: Amt[] = [
        { k: "Stock", v: withUom(r.balanceQty, r.baseUOM), c: t === "ok" ? undefined : TONE[t].c },
        { k: "Min stock", v: minStockLabel(r), c: r.minStock > 0 ? undefined : X.mut },
      ];
      return <ListCard key={r.id} code={r.itemCode} badges={[{ l, tone: t }]} title={r.description || "—"} sub={r.itemGroup} amts={amts} rail={TONE[t].c} current={isCurrent("rm", r.id)} onTap={() => openDetail("rm", r.id)} aria={`${r.itemCode}, ${r.description}`} />;
    }
    if (active === "fab") {
      const f = x as FabricRow;
      const [l, t] = fabricTone(f);
      const amts: Amt[] = [
        { k: "On hand", v: `${q2(f.soh)} m` },
        { k: "On PO", v: `${q2(f.poOutstanding)} m`, c: f.poOutstanding > 0 ? X.warn : undefined },
        { k: "Shortage", v: `${signed(f.shortage)} m`, c: f.shortage < 0 ? X.bad : X.ok },
      ];
      return <ListCard key={f.id} code={f.fabricCode} badges={[{ l, tone: t }]} title={f.fabricDescription || "—"} sub={f.fabricCategory} amts={amts} rail={TONE[t].c} current={info?.kind === "fab" && info.row.id === f.id} onTap={() => setInfo({ kind: "fab", row: f })} aria={`${f.fabricCode}, ${f.fabricDescription}`} />;
    }
    const a = x as AdjRow;
    const pos = a.qtyDelta > 0;
    const amts: Amt[] = [
      { k: "Change", v: signed(a.qtyDelta), c: pos ? X.ok : X.bad },
      { k: "Reason", v: reasonLabel(a.reason) },
      { k: "By", v: a.adjustedByName || "—", c: a.adjustedByName ? undefined : X.mut },
    ];
    return <ListCard key={a.id} code={a.adjNo || "—"} badges={[{ l: a.type || "—", tone: "br" }]} date={dateLabel(a.adjustedAt)} title={a.itemName || a.itemCode || "—"} sub={a.itemCode} amts={amts} rail={pos ? X.ok : X.bad} current={info?.kind === "adj" && info.row.id === a.id} onTap={() => setInfo({ kind: "adj", row: a })} aria={`${a.adjNo || "Adjustment"}, ${a.itemName || a.itemCode}`} />;
  };

  // ---- body by state ----
  let body: ReactNode;
  const restricted = !perms.loading && !perms.module;
  if (perms.loading) body = <Skeletons />;
  else if (restricted) {
    body = <StateCard icon={Lock} title="You can't see inventory" sub="Your role doesn't include inventory access. Ask an admin." />;
  } else if (cur.denied) {
    body = <StateCard icon={Lock} title="No access" sub={`Your role can't read ${SECTION[active]}. Ask an admin.`} />;
  } else if (cur.failed) {
    body = <StateCard icon={CloudOff} tone="bad" role="alert" title="Couldn't load inventory" sub={cur.error || "The inventory service didn't answer."} btn="Try again" onTap={cur.refresh} />;
  } else if (cur.loading) {
    body = <Skeletons />;
  } else if (!total) {
    body = <StateCard icon={PackageOpen} title={EMPTY[active]} sub="Items show here once they have stock records." />;
  } else if (!view.length) {
    body = <StateCard icon={SearchX} title="Nothing matches" sub="Try another search or filter." btn="Clear filters" onTap={clearFilters} />;
  } else {
    const shown = view.slice(0, page);
    const [one, many] = UNIT[active];
    body = (
      <>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 20px 6px" }}>
          <span style={LABEL}>{`${view.length} ${(view.length === 1 ? one : many).toUpperCase()}`}</span>
          <span style={{ flex: 1, height: 1, background: X.ln }} />
          <span style={{ flex: "none", fontSize: 11.5, color: X.mut, whiteSpace: "nowrap" }}>{sortL}</span>
        </div>
        <div style={{ padding: "0 16px" }}>
          <ResponsiveGrid maxColumns={listPane ? 1 : undefined} gap={8}>
            {shown.map(card)}
          </ResponsiveGrid>
        </div>
        {view.length > shown.length ? (
          <div style={{ padding: "10px 16px 0" }}>
            <MoreButton left={view.length - shown.length} onTap={() => setPage(shown.length + PAGE)} />
          </div>
        ) : null}
      </>
    );
  }
  const showTop = !perms.loading && !restricted && !cur.denied && !cur.failed && (total > 0 || cur.loading);

  const list = (
    <>
      <TplStyles />
      <MobileHeader
        title="Inventory"
        menu
        onBack={() => navigate(-1)}
        trailing={
          !restricted && !perms.loading ? (
            <button type="button" aria-label="Options" onClick={() => setSheet("opts")} style={ROUND_BTN}>
              <span className="tpl-anim" style={{ display: "flex", animation: spin ? "tpl-spin .8s linear infinite" : "none" }}>
                {spin ? <RefreshCw size={19} strokeWidth={2} /> : <Ellipsis size={19} strokeWidth={2} />}
              </span>
            </button>
          ) : null
        }
      />
      {!restricted ? (
        <div
          className="tpl-scroll"
          role="tablist"
          aria-label="Inventory sections"
          style={{ display: "flex", gap: 2, height: 46, boxSizing: "border-box", padding: "0 8px", overflowX: "auto", scrollbarWidth: "none", boxShadow: `inset 0 -1px 0 ${X.ln}` }}
        >
          {tabs.map((t) => {
            const sel = t.k === active;
            const Icon = TAB_ICON[t.k];
            return (
              <button
                key={t.k}
                type="button"
                role="tab"
                aria-selected={sel}
                onClick={() => setTab(t.k)}
                style={{
                  flex: "none", height: "100%", minWidth: 44, padding: "0 10px", border: "none", background: "none", color: sel ? X.ink : X.mut, fontWeight: sel ? 700 : 600,
                  boxShadow: sel ? `inset 0 -2.5px 0 ${X.pri}` : "none", fontFamily: "inherit", fontSize: 13, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
                }}
              >
                <Icon size={15} strokeWidth={1.9} />
                {t.l}
              </button>
            );
          })}
        </div>
      ) : null}
      {showTop ? (
        <>
          {kpis ? <KpiGrid items={kpis} loading={cur.loading} cols={kpiCols} /> : null}
          {cur.stale ? (
            <div style={{ padding: "12px 16px 0" }}>
              <Notice tone="warn">{`Showing saved figures. ${cur.error}`}</Notice>
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 8, padding: "12px 16px 0" }}>
            <label style={{ flex: 1, minWidth: 0, height: 44, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 9, padding: "0 6px 0 13px", background: X.card, borderRadius: 14, boxShadow: SH_CONTROL }}>
              <Search size={18} strokeWidth={1.75} color={X.ph} style={{ flex: "none" }} aria-hidden />
              <input
                className="tpl-in"
                type="text"
                inputMode="search"
                enterKeyHint="search"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(PAGE);
                }}
                placeholder={PH[active]}
                aria-label="Search"
                style={{ flex: 1, minWidth: 0, height: "100%", border: "none", outline: "none", background: "transparent", fontSize: 16, fontFamily: "inherit", color: X.ink, padding: 0, textOverflow: "ellipsis" }}
              />
              {q ? (
                <button type="button" onClick={() => setQ("")} aria-label="Clear search" style={{ width: 36, height: 36, border: "none", background: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: X.mut, flex: "none" }}>
                  <XIcon size={15} strokeWidth={2.2} />
                </button>
              ) : null}
            </label>
            <button
              type="button"
              onClick={() => setSheet("sort")}
              aria-label={fN ? "Sort, changed" : "Sort"}
              style={{ position: "relative", width: 44, height: 44, flex: "none", borderRadius: "50%", border: "none", background: X.card, color: X.br, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: SH_CONTROL }}
            >
              <ArrowDownUp size={17} strokeWidth={1.9} />
              {fN ? (
                <span style={{ position: "absolute", top: -2, right: -2, minWidth: 17, height: 17, padding: "0 4px", boxSizing: "border-box", borderRadius: 999, background: X.pri, color: "#FFFFFF", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{fN}</span>
              ) : null}
            </button>
          </div>
          <div className="tpl-scroll" role="group" aria-label="Category" style={{ display: "flex", gap: 8, overflowX: "auto", padding: "12px 16px 4px", scrollbarWidth: "none" }}>
            {chips.map((ch) => {
              const sel = c === ch.k;
              return (
                <button
                  key={ch.k}
                  type="button"
                  aria-pressed={sel}
                  onClick={() => {
                    setCat((m) => ({ ...m, [active]: ch.k }));
                    setPage(PAGE);
                  }}
                  style={CHIP_BTN(sel)}
                >
                  {ch.l}
                  {!cur.loading ? (
                    <span style={{ minWidth: 20, height: 20, padding: "0 6px", boxSizing: "border-box", borderRadius: 999, background: sel ? "rgba(255,255,255,.24)" : X.chip, color: sel ? "#FFFFFF" : X.sub, fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", fontVariantNumeric: "tabular-nums" }}>
                      {ch.n}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </>
      ) : null}
      {body}
      <div style={{ height: 24 }} />

      <TplSheet
        open={sheet === "sort"}
        title="Sort by"
        onClose={() => setSheet(null)}
        groups={[
          {
            t: `${total} ${UNIT[active][1].toUpperCase()}`,
            rows: SORTS[active].map((o) => ({
              key: o.k,
              l: o.l,
              check: s === o.k,
              pressed: s === o.k,
              onTap: () => {
                setSort((m) => ({ ...m, [active]: o.k }));
                setPage(PAGE);
                setSheet(null);
              },
            })),
          },
        ]}
      />
      <TplSheet
        open={sheet === "opts"}
        title="Options"
        onClose={() => setSheet(null)}
        groups={[
          {
            t: "ACTIONS",
            rows: [
              {
                key: "refresh",
                l: "Refresh",
                icon: RefreshCw,
                onTap: () => {
                  setSheet(null);
                  refresh();
                },
              },
            ],
          },
        ]}
      />
      <FabricSheet row={info?.kind === "fab" ? info.row : null} onClose={closeInfo} />
      <AdjSheet row={info?.kind === "adj" ? info.row : null} onClose={closeInfo} />
      {toast.node}
    </>
  );

  if (!ownSplit) return list;
  // Tablet, nothing open: the list beside the prototype's placeholder pane.
  return (
    <div data-inventory-split style={{ display: "flex", height: "100dvh", overflow: "hidden" }}>
      <div style={{ width: "clamp(320px, 38%, 340px)", flex: "none", borderRight: `1px solid ${X.ln}`, overflowY: "auto", overflowX: "hidden" }}>
        <PaneProvider value={resolveContainerLayout(layout.splitMasterWidth, "list")}>{list}</PaneProvider>
      </div>
      <section aria-label="Item detail" style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center", color: X.mut, fontSize: 13 }}>
        {restricted ? "" : "Pick an item to see its stock breakdown."}
      </section>
    </div>
  );
}
