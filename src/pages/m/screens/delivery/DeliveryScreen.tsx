// ===========================================================================
// DeliveryScreen — L1 /m/delivery, phone AND tablet (owner 2026-10-20).
//
// Visuals: Claude Design `Delivery.dc.html` (the source of truth for all but
// type); typography: the /m Sales screens. Real data only, the same reads
// desktop src/pages/delivery/index.tsx makes:
//   • tab counts      GET /api/delivery-orders/stats (byStatus) +
//                     /ready-planning (planning / ready) + /api/packing-lists
//   • DO tabs         GET /api/delivery-orders?status=…&page&limit=50 (per tab)
//   • search          GET /api/delivery-orders?search=…&limit=2000 (all
//                     statuses; jumps to the tab when every match is on one)
//   • Planning / Pending Delivery = PRODUCTION ORDERS from /ready-planning;
//     Pending Delivery cards are always selectable (prototype + desktop) and
//     the fixed bar offers Packing List (n) + Create DO (n)
//   • Packing List    GET /api/packing-lists + the 200 live DOs its buttons move
//   • 3PL Providers   GET /api/drivers (read-only; editing stays on desktop)
// Actions call desktop's endpoints with desktop's rules (./DeliverySheets.tsx,
// ./actions.ts) and show only with delivery-orders:create / :update — the API
// still decides.
//
// Responsive: one screen. Phone = the prototype column. Tablet = the same
// cards in a grid; in the split view (list pane beside the DO detail) a single
// column with the open DO ringed. The bulk bar is a fixed dock that follows
// its pane (ResponsiveActionDock).
// ===========================================================================
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, CircleCheck, PackageCheck, Search, Send, X } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { usePermissions } from "@/lib/use-permission";
import { useUrlBatch, useUrlState, useUrlStateNumber } from "@/lib/use-url-state";
import { pageSlice } from "@/lib/delivery-list-filters";
import { MobileHeader } from "../../components";
import { M } from "../../theme";
import { useResponsiveLayout } from "../../lib/responsive-layout";
import { useDebounced } from "../../lib/use-debounced";
import {
  DELIVERY_TABS, DO_PAGE_SIZE, PO_SEARCH_KEYS, PO_TABS, TAB_DO_STATUSES,
  bulkConfirmLines, bulkEligible, doBrowseUrl, doSearchUrl, m3, matchesSearch, oneCustomerError, plNoneEligibleMessage, poSelectable,
  rows, s, searchJumpTab, tabCounts, tabForStatus, totalM3,
  type BulkTarget, type DeliveryTab, type RawRow,
} from "../../lib/do-mobile";
import { DoCard, EmptyCard, PlCard, PoCard, ProviderCard } from "./DeliveryCards";
import { CreateDoSheet, PlFirstSheet, PlFromDosSheet } from "./DeliverySheets";
import { ProviderDetail } from "./ProviderDetail";
import { notifyCustomers, noticeToast, runBulk } from "./actions";
import { BottomDock, Notice, PrimaryButton, SecondaryButton, SectionSwitch } from "./ui";
import { SHADOW_CARD, SHADOW_CONTROL, sem, type Tone } from "./ui-tokens";
import { SEGMENT_WRAP, CHIP_ROW, CHIP_ROW_CLASS, CHIP_COUNT, chip as chipStyle, chipDot } from "../../lib/control-styles";
import { useConfirmSheet, useCreditOverride, useMobileToast } from "./ui-hooks";

const DEFAULT_TAB: DeliveryTab = "pending_dispatch";
const PO_KEYS = [...PO_SEARCH_KEYS, "productCode", "productName"];
// Prototype TABS_DEF: a status dot on the four DO tabs.
const TAB_DOT: Partial<Record<DeliveryTab, Tone>> = {
  pending_dispatch: "neutral",
  dispatched: "info",
  delivered: "success",
  cancelled: "danger",
};

type Envelope = { success?: boolean; data?: RawRow[]; total?: number };

export function DeliveryScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id: openId } = useParams();
  const layout = useResponsiveLayout();
  const tablet = layout.mode !== "phone";
  // In the tablet split view this list renders beside /m/delivery/:id.
  const inPane = layout.canSplitDetail && !!openId;
  const gridCols = tablet && !inPane ? "repeat(auto-fill, minmax(320px, 1fr))" : "minmax(0, 1fr)";

  const [section] = useUrlState<string>("section", "deliveries");
  const [tabRaw] = useUrlState<string>("tab", DEFAULT_TAB);
  const [page] = useUrlStateNumber("page", 1);
  const setUrl = useUrlBatch();
  const tab: DeliveryTab = (DELIVERY_TABS.some((t) => t.key === tabRaw) ? tabRaw : DEFAULT_TAB) as DeliveryTab;
  const isDel = section !== "3pl";
  const isPO = PO_TABS.has(tab);
  const isPL = tab === "packing_list";
  const doTabStatuses = TAB_DO_STATUSES[tab];

  const [q, setQ] = useState("");
  const dq = useDebounced(q).trim();
  const searching = !!dq;

  const { hasPermission } = usePermissions();
  const canCreate = hasPermission("delivery-orders", "create");
  const canUpdate = hasPermission("delivery-orders", "update");

  // ---- reads (desktop's) ----
  const stats = useCachedJson<{ byStatus?: Record<string, number> }>(isDel ? "/api/delivery-orders/stats" : null);
  const rp = useCachedJson<{ ready?: RawRow[]; planning?: RawRow[] }>(isDel ? "/api/delivery-orders/ready-planning" : null);
  const browse = useCachedJson<Envelope>(isDel && !searching ? doBrowseUrl(tab, page) : isDel && isPL ? doBrowseUrl(tab, 1) : null);
  const found = useCachedJson<Envelope>(isDel && searching ? doSearchUrl(dq) : null);
  const pls = useCachedJson<Envelope>(isDel && !isPO ? "/api/packing-lists" : null);
  const providers = useCachedJson<Envelope>(!isDel ? "/api/drivers" : null);

  const planning = useMemo(() => rows(rp.data?.planning), [rp.data]);
  const ready = useMemo(() => rows(rp.data?.ready), [rp.data]);
  const packingLists = useMemo(() => rows(pls.data?.data), [pls.data]);
  const browseRows = useMemo(() => rows(browse.data?.data).filter((d) => !s(d, "id").startsWith("virt-")), [browse.data]);
  const foundRows = useMemo(() => rows(found.data?.data).filter((d) => !s(d, "id").startsWith("virt-")), [found.data]);
  const inPackingList = useMemo(() => {
    const m = new Map<string, string>();
    for (const pl of packingLists) for (const id of (pl.doIds as string[] | undefined) ?? []) m.set(id, s(pl, "packingNo"));
    return m;
  }, [packingLists]);

  // ---- per-tab rows ----
  const poAll = tab === "planning" ? planning : ready;
  const poMatches = useMemo(() => (isPO ? poAll.filter((p) => matchesSearch(p, PO_KEYS, dq)) : []), [isPO, poAll, dq]);
  const poShown = useMemo(() => pageSlice(poMatches, page, DO_PAGE_SIZE, searching), [poMatches, page, searching]);
  const doShown = useMemo(() => {
    if (!doTabStatuses) return [];
    if (searching) return foundRows.filter((d) => (doTabStatuses as string[]).includes(s(d, "status")));
    return browseRows;
  }, [doTabStatuses, searching, foundRows, browseRows]);
  const plShown = useMemo(
    () => (isPL ? packingLists.filter((p) => matchesSearch({ ...p, states: Array.isArray(p.states) ? (p.states as string[]).join(" ") : "" }, ["packingNo", "states", "remarks"], dq)) : []),
    [isPL, packingLists, dq],
  );
  const providerRows = useMemo(
    () => rows(providers.data?.data).filter((p) => matchesSearch(p, ["name", "contactPerson", "phone"], dq)),
    [providers.data, dq],
  );

  // ---- counts (whole table; per-tab match counts while searching) ----
  const counts = useMemo(() => {
    if (!searching) {
      return tabCounts({ byStatus: stats.data?.byStatus, planning: rp.data ? planning.length : undefined, ready: rp.data ? ready.length : undefined, packingLists: pls.data ? packingLists.length : undefined });
    }
    const c = tabCounts({});
    c.planning = planning.filter((p) => matchesSearch(p, PO_KEYS, dq)).length;
    c.pending_delivery = ready.filter((p) => matchesSearch(p, PO_KEYS, dq)).length;
    for (const d of foundRows) {
      const t = tabForStatus(s(d, "status"));
      if (t) c[t] += 1;
    }
    c.packing_list = packingLists.filter((p) => matchesSearch(p, ["packingNo", "remarks"], dq)).length;
    return c;
  }, [searching, stats.data, rp.data, planning, ready, pls.data, packingLists, foundRows, dq]);
  const countsKnown = searching || !!stats.data || !!rp.data;

  // ---- selection (scoped to the tab it was made on) ----
  const [selPo, setSelPo] = useState<Set<string>>(new Set());
  const [selectingTab, setSelectingTab] = useState<string | null>(null);
  const selecting = selectingTab === tab;
  const [selDo, setSelDo] = useState<Set<string>>(new Set());
  const clearSelection = () => {
    setSelPo(new Set());
    setSelDo(new Set());
    setSelectingTab(null);
  };
  const goTab = (k: DeliveryTab) => {
    setUrl({ tab: k === DEFAULT_TAB ? null : k, page: null });
    clearSelection();
  };
  const goSection = (k: string) => {
    setUrl({ section: k === "deliveries" ? null : k, page: null });
    setQ("");
    clearSelection();
  };
  const goPage = (p: number) => {
    setUrl({ page: p <= 1 ? null : String(p) });
    window.scrollTo(0, 0);
  };

  // Desktop search jump: every match on exactly one tab → go there (once per term).
  const jumped = useRef("");
  const searchReady = searching && !!found.data && !!rp.data;
  useEffect(() => {
    if (!searchReady || jumped.current === dq) return;
    jumped.current = dq;
    const tabs: (DeliveryTab | null)[] = [
      ...foundRows.map((d) => tabForStatus(s(d, "status"))),
      ...planning.filter((p) => matchesSearch(p, PO_KEYS, dq)).map(() => "planning" as DeliveryTab),
      ...ready.filter((p) => matchesSearch(p, PO_KEYS, dq)).map(() => "pending_delivery" as DeliveryTab),
    ];
    const target = searchJumpTab(tabs);
    if (target && target !== tab) setUrl({ tab: target === DEFAULT_TAB ? null : target, page: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- jump once per settled search term
  }, [searchReady, dq]);

  // ---- sheets / feedback ----
  const toast = useMobileToast();
  const confirmSheet = useConfirmSheet();
  const credit = useCreditOverride();
  const [createOpen, setCreateOpen] = useState(false);
  const [plFirstOpen, setPlFirstOpen] = useState(false);
  const [plFromDos, setPlFromDos] = useState<RawRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [provider, setProvider] = useState<RawRow | null>(null);

  const selectedPos = useMemo(
    () => (tab === "pending_delivery" ? ready.filter((p) => selPo.has(s(p, "id"))) : []),
    [tab, ready, selPo],
  );
  const selectedDos = useMemo(() => (selecting ? doShown.filter((d) => selDo.has(s(d, "id"))) : []), [selecting, doShown, selDo]);

  const runMoves = async (dos: RawRow[], target: BulkTarget, verb: string) => {
    setBusy("bulk");
    const { succeeded, failures } = await runBulk(dos, target, credit.ask);
    setBusy(null);
    if (failures.length) toast.show(`${failures.length} of ${dos.length} failed: ${failures[0]}`, "error");
    else {
      toast.show(`${dos.length} delivery order${dos.length === 1 ? "" : "s"} ${verb}`, "success");
      clearSelection();
    }
    browse.refresh();
    stats.refresh();
    pls.refresh();
    if (succeeded.length) {
      const kind = target === "LOADED" ? "DISPATCHED" : "DELIVERED";
      void notifyCustomers(succeeded, kind).then((queued) => {
        const msg = noticeToast(queued, kind);
        if (msg) toast.show(msg, "success");
      });
    }
  };

  const bulkMove = async () => {
    const target: BulkTarget = tab === "dispatched" ? "DELIVERED" : "LOADED";
    const eligible = bulkEligible(selectedDos, target);
    if (!eligible.length) {
      toast.show(target === "LOADED" ? "None of the selected DOs are pending dispatch." : "None of the selected DOs are dispatched.", "error");
      return;
    }
    const delivering = target === "DELIVERED";
    const ok = await confirmSheet.confirm({
      title: delivering ? "Mark delivered" : "Mark dispatched",
      sub: `${eligible.length} delivery order${eligible.length === 1 ? "" : "s"}`,
      lines: bulkConfirmLines(target, false),
      confirmLabel: delivering ? "Mark delivered" : "Mark dispatched",
    });
    if (ok) await runMoves(eligible, target, delivering ? "marked delivered" : "marked dispatched");
  };

  const plMove = async (pl: RawRow, target: BulkTarget) => {
    if (busy) return;
    const ids = new Set((pl.doIds as string[] | undefined) ?? []);
    const eligible = bulkEligible(browseRows.filter((d) => ids.has(s(d, "id"))), target);
    const packingNo = s(pl, "packingNo");
    if (!eligible.length) {
      toast.show(plNoneEligibleMessage(packingNo, target), "error");
      return;
    }
    const n = eligible.length;
    const delivering = target === "DELIVERED";
    const ok = await confirmSheet.confirm({
      title: delivering ? `Mark ${packingNo} delivered` : `Dispatch ${packingNo}`,
      sub: delivering ? `${n} dispatched DO${n === 1 ? "" : "s"} → Delivered` : `${n} pending DO${n === 1 ? "" : "s"} → Dispatched`,
      lines: bulkConfirmLines(target, true),
      confirmLabel: delivering ? `Mark ${n} delivered` : `Dispatch ${n}`,
    });
    if (ok) await runMoves(eligible, target, delivering ? "marked delivered" : "marked dispatched");
  };

  const openCreateDo = () => {
    const guard = oneCustomerError(selectedPos);
    if (guard) {
      toast.show(guard, "error");
      return;
    }
    setCreateOpen(true);
  };

  const openPlFromDos = () => {
    const fresh = selectedDos.filter((d) => !inPackingList.has(s(d, "id")));
    if (!fresh.length) {
      toast.show("All selected delivery orders are already in a packing list.", "error");
      return;
    }
    setPlFromDos(fresh);
  };

  const togglePo = (po: RawRow) => {
    if (!poSelectable(po)) {
      toast.show("Sofa set incomplete — all compartments must be ready before it can go on a DO", "warning");
      return;
    }
    const id = s(po, "id");
    setSelPo((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleDo = (id: string) =>
    setSelDo((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (provider) {
    return <ProviderDetail provider={provider} onBack={() => setProvider(null)} />;
  }

  // ---- list state ----
  const source = !isDel ? providers : isPO ? rp : isPL ? pls : searching ? found : browse;
  const loading = source.loading && !source.data;
  const failed = !!source.error && !source.data;
  const listCount = !isDel ? providerRows.length : isPO ? poMatches.length : isPL ? plShown.length : searching ? doShown.length : (browse.data?.total ?? doShown.length);
  const noun = !isDel ? "PROVIDER" : isPO ? "PRODUCTION ORDER" : isPL ? "PACKING LIST" : "DELIVERY ORDER";
  const pages = isPO
    ? searching ? 1 : Math.max(1, Math.ceil(poMatches.length / DO_PAGE_SIZE))
    : doTabStatuses && !searching
      ? Math.max(1, Math.ceil((browse.data?.total ?? doShown.length) / DO_PAGE_SIZE))
      : 1;
  // Total M³ only when every row of the bucket is on screen (no partial sums).
  const m3Total = doTabStatuses && pages === 1 && doShown.length ? doShown.reduce((a, d) => a + totalM3(d), 0) : 0;
  const canSelectDos = isDel && canUpdate && (tab === "pending_dispatch" || tab === "dispatched") && doShown.length > 0;
  const poSelectableTab = isDel && tab === "pending_delivery" && canCreate;
  const note =
    isDel && tab === "planning"
      ? "Production orders still in production — they move to Pending Delivery when ready."
      : isDel && tab === "pending_delivery"
        ? poSelectableTab
          ? "Select ready production orders to create a Delivery Order. Incomplete sofa sets can’t be selected."
          : "Ready production orders waiting for a Delivery Order."
        : "";
  const searchPh = !isDel ? "Search providers" : isPO ? "Search SO, PO, customer, product" : "Search DO, SO, customer, vehicle";
  const showPoBar = poSelectableTab && selectedPos.length > 0;
  const showDoBar = canSelectDos && selectedDos.length > 0;
  const dockScope = inPane ? "list" : "content";

  return (
    <>
      <MobileHeader title="Delivery" onBack={() => navigate(-1)} menu />

      <div style={SEGMENT_WRAP}>
        <SectionSwitch value={isDel ? "deliveries" : "3pl"} onChange={goSection} />
      </div>

      <SearchRow q={q} setQ={setQ} placeholder={searchPh} />

      {isDel ? <Chips tab={tab} counts={counts} showCounts={countsKnown} onPick={goTab} /> : null}

      {note ? (
        <div style={{ margin: "10px 18px 0" }}>
          <Notice>{note}</Notice>
        </div>
      ) : null}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 20px 8px", minHeight: 24 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
          {loading ? "" : `${listCount} ${noun}${listCount === 1 ? "" : "S"}`}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {m3Total ? (
            <span style={{ fontSize: 12.5, color: M.ink, whiteSpace: "nowrap" }}>
              Total M³ <span style={{ fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums" }}>{m3(m3Total)}</span>
            </span>
          ) : null}
          {canSelectDos ? (
            <button
              type="button"
              onClick={() => {
                setSelectingTab(selecting ? null : tab);
                setSelDo(new Set());
              }}
              style={{ height: 32, padding: "0 4px", border: "none", background: "none", fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: M.taupe, cursor: "pointer" }}
            >
              {selecting ? "Cancel" : "Select"}
            </button>
          ) : null}
        </div>
      </div>

      <div style={{ padding: `0 18px ${showPoBar || showDoBar ? 140 : 32}px` }}>
        {loading ? (
          <div style={{ display: "grid", gridTemplateColumns: gridCols, gap: 10 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} aria-hidden style={{ height: 118, borderRadius: 16, background: M.card, opacity: 0.7, boxShadow: SHADOW_CARD }} />
            ))}
          </div>
        ) : failed ? (
          <div role="alert" style={{ margin: "12px 0", padding: "24px 18px", textAlign: "center", background: M.card, borderRadius: 16, boxShadow: SHADOW_CARD }}>
            <div style={{ fontSize: 13.5, color: M.raisin, fontWeight: 600 }}>Couldn’t load this list.</div>
            <button type="button" onClick={() => source.refresh()} style={{ marginTop: 10, minHeight: 40, padding: "0 18px", borderRadius: 999, border: "none", background: M.taupe, color: "var(--m-text-on-accent)", fontFamily: "inherit", fontWeight: 700, cursor: "pointer" }}>
              Try again
            </button>
          </div>
        ) : listCount === 0 ? (
          <EmptyCard text={searching ? "No matches for your search." : "Nothing here yet."} />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: gridCols, gap: 10 }}>
            {!isDel
              ? providerRows.map((p) => <ProviderCard key={s(p, "id")} p={p} onClick={() => setProvider(p)} />)
              : isPO
                ? poShown.map((po) => (
                    <PoCard
                      key={s(po, "id")}
                      po={po}
                      mode={tab === "planning" ? "planning" : "pending"}
                      selectable={poSelectableTab}
                      checked={selPo.has(s(po, "id"))}
                      onToggle={() => togglePo(po)}
                    />
                  ))
                : isPL
                  ? plShown.map((pl) => (
                      <PlCard
                        key={s(pl, "id")}
                        pl={pl}
                        canAct={canUpdate}
                        busy={!!busy}
                        onDispatch={() => void plMove(pl, "LOADED")}
                        onDeliver={() => void plMove(pl, "DELIVERED")}
                      />
                    ))
                  : doShown.map((d) => (
                      <DoCard
                        key={s(d, "id")}
                        d={d}
                        selecting={selecting}
                        checked={selDo.has(s(d, "id"))}
                        current={inPane && s(d, "id") === openId}
                        onClick={() =>
                          selecting
                            ? toggleDo(s(d, "id"))
                            : navigate({ pathname: `/m/delivery/${encodeURIComponent(s(d, "id"))}`, search: location.search })
                        }
                      />
                    ))}
          </div>
        )}

        {!loading && !failed && pages > 1 ? <Pager page={Math.min(page, pages)} pages={pages} onPage={goPage} /> : null}
      </div>

      {showPoBar ? (
        <BottomDock variant="list" scope={dockScope}>
          <SecondaryButton onClick={() => setPlFirstOpen(true)}>Packing List ({selectedPos.length})</SecondaryButton>
          <PrimaryButton icon={PackageCheck} onClick={openCreateDo}>
            Create DO ({selectedPos.length})
          </PrimaryButton>
        </BottomDock>
      ) : null}
      {showDoBar ? (
        <BottomDock variant="list" scope={dockScope}>
          {canCreate ? <SecondaryButton onClick={openPlFromDos} disabled={!!busy}>Packing list</SecondaryButton> : null}
          <PrimaryButton icon={tab === "dispatched" ? CircleCheck : Send} onClick={() => void bulkMove()} disabled={!!busy}>
            {busy ? "Working…" : tab === "dispatched" ? `Mark Delivered (${selectedDos.length})` : `Mark Dispatched (${selectedDos.length})`}
          </PrimaryButton>
        </BottomDock>
      ) : null}

      <CreateDoSheet
        open={createOpen}
        pos={selectedPos}
        onClose={() => setCreateOpen(false)}
        askCredit={credit.ask}
        onCreated={(msg) => {
          setCreateOpen(false);
          clearSelection();
          rp.refresh();
          stats.refresh();
          toast.show(msg, "success");
        }}
      />
      <PlFirstSheet
        open={plFirstOpen}
        pos={selectedPos}
        onClose={() => setPlFirstOpen(false)}
        askCredit={credit.ask}
        onCreated={(msg) => {
          setPlFirstOpen(false);
          clearSelection();
          rp.refresh();
          stats.refresh();
          goTab("packing_list");
          toast.show(msg, "success");
        }}
      />
      <PlFromDosSheet
        open={!!plFromDos}
        dos={plFromDos ?? []}
        onClose={() => setPlFromDos(null)}
        onWarn={(msg) => toast.show(msg, "warning")}
        onCreated={(msg) => {
          setPlFromDos(null);
          clearSelection();
          goTab("packing_list");
          toast.show(msg, "success");
        }}
      />
      {confirmSheet.node}
      {credit.node}
      {toast.node}
    </>
  );
}

// ---------------------------------------------------------------------------
// Pieces (prototype search bar, chips, pager).
// ---------------------------------------------------------------------------
function SearchRow({ q, setQ, placeholder }: { q: string; setQ: (v: string) => void; placeholder: string }) {
  return (
    <div style={{ padding: "12px 18px 0" }}>
      <label
        style={{
          display: "flex", alignItems: "center", gap: 9, height: 44, padding: "0 13px", boxSizing: "border-box",
          background: M.card, borderRadius: 14, boxShadow: SHADOW_CONTROL,
        }}
      >
        <Search size={18} strokeWidth={1.75} color={M.faint} style={{ flexShrink: 0 }} aria-hidden />
        <input
          className="dl-input"
          type="text"
          inputMode="search"
          enterKeyHint="search"
          value={q}
          placeholder={placeholder}
          aria-label="Search"
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1, minWidth: 0, padding: 0, border: "none", outline: "none", background: "transparent", fontFamily: "inherit", fontSize: 16, color: M.raisin, textOverflow: "ellipsis" }}
        />
        {q ? (
          <button
            type="button"
            onClick={() => setQ("")}
            aria-label="Clear search"
            style={{ width: 32, height: 32, marginRight: -6, flexShrink: 0, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", color: M.faint, cursor: "pointer" }}
          >
            <X size={16} strokeWidth={2} />
          </button>
        ) : null}
      </label>
    </div>
  );
}

function Chips({ tab, counts, showCounts, onPick }: { tab: DeliveryTab; counts: Record<DeliveryTab, number>; showCounts: boolean; onPick: (k: DeliveryTab) => void }) {
  // Handoff filter chips (lib/control-styles.ts, owner 2026-10-21).
  return (
    <div role="group" aria-label="Delivery stage" className={CHIP_ROW_CLASS} style={CHIP_ROW}>
      {DELIVERY_TABS.map((t) => {
        const on = t.key === tab;
        const dot = TAB_DOT[t.key];
        return (
          <button key={t.key} type="button" aria-pressed={on} onClick={() => onPick(t.key)} style={chipStyle(on)}>
            {dot ? <span aria-hidden style={chipDot(sem(dot))} /> : null}
            {t.label}
            {showCounts ? <span style={CHIP_COUNT}>{counts[t.key] ?? 0}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  const btn = (enabled: boolean) => ({
    width: 44, height: 44, borderRadius: 12, border: "none", background: M.card, color: enabled ? M.taupe : "var(--dl-disabled)",
    display: "flex", alignItems: "center", justifyContent: "center", cursor: enabled ? "pointer" : "default", boxShadow: SHADOW_CONTROL,
  });
  return (
    <nav aria-label="Pages" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, marginTop: 14 }}>
      <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)} style={btn(page > 1)}>
        <ChevronLeft size={18} strokeWidth={2} />
      </button>
      <span style={{ fontSize: 12.5, color: M.ink, fontVariantNumeric: "tabular-nums" }}>
        Page {page} of {pages}
      </span>
      <button type="button" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)} style={btn(page < pages)}>
        <ChevronRight size={18} strokeWidth={2} />
      </button>
    </nav>
  );
}
