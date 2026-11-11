// ===========================================================================
// ServiceOrdersScreen — L1 "Service Orders" (Claude Design "Service Orders.dc.html").
// Two record families, never merged:
//   SV orders            GET /api/sales-orders?isServiceOrder=true  (this file)
//   Legacy repair orders GET /api/service-orders                    (LegacyOrderList)
// List state (family, tab, chip, search, sort/filter) lives in the URL, so opening an order and coming back keeps it.
// Logic is the desktop's: tabs/chips from src/lib/so-status.ts, bulk actions = the desktop Drafts bar (confirm / delete,
// each order reported on its own), no invented pricing gate (totals are shown as on desktop).
// ===========================================================================
import { todayYmdMY } from "@/lib/utils";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowDownUp, Archive, ChevronRight, CloudOff, Copy, Ellipsis, EllipsisVertical, Factory, Download, FileCheck, ListChecks, RefreshCw, FilePlus2, Info, LifeBuoy, Lock, Package, Plus, SearchX, Inbox, Wrench, X, Check } from "lucide-react";
import { cachedFetchJson, useCachedJson } from "@/lib/cached-fetch";
import { exportToCsv } from "@/lib/export-csv";
import { getCurrentUser } from "@/lib/auth";
import { usePermissions } from "@/lib/use-permission";
import { MobileHeader, ResponsiveActionDock, Sheet } from "../../components";
import { useResponsiveLayout } from "../../lib/responsive-layout";
import { useDebounced } from "../../lib/use-debounced";
import { money } from "../../config/helpers";
import { mutateJson, refreshList } from "../../config/mutate";
import { M } from "../../theme";
import { CC, SH_CARD, SH_CTRL, SH_FIELD, SH_ON } from "../cases/case-style";
import { Btn, Chip, IconBtn, IconTile, Msg, Note, Pill, RefChip, SearchField, SectionLabel } from "../cases/case-ui";
import { useConfirmSheet, useMobileToast } from "../delivery/ui-hooks";
import { SV_NEW_PATH, SV_STATUS_LABEL, casePath, fmtDM, svDetailPath, svRail, svTone } from "./order-model";
import {
  SV_CHIPS,
  SV_SORT_LABEL,
  caseCoverage,
  caseLinkNote,
  classifyListFailure,
  groupPosBySo,
  inChip,
  inTab,
  matchesSv,
  resolveCaseLink,
  sortSv,
  svFilterCount,
  svProduction,
  toSvRow,
  type PoLite,
  type SvCaseFilter,
  type SvChip,
  type SvFilters,
  type SvRow,
  type SvSort,
  type SvTab,
} from "./sv-list-model";
import { LegacyOrderList } from "./LegacyOrderList";

type Row = Record<string, unknown>;
const SV_URL = "/api/sales-orders?isServiceOrder=true";

export function ServiceOrdersScreen() {
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const family = sp.get("fam") === "legacy" ? "legacy" : "sv";
  const setFamily = (f: "sv" | "legacy") => {
    const next = new URLSearchParams(sp);
    if (f === "legacy") next.set("fam", "legacy");
    else next.delete("fam");
    setSp(next, { replace: true });
  };
  return (
    <>
      {family === "sv" ? <SvList sp={sp} setSp={setSp} family={family} setFamily={setFamily} /> : (
        <>
          <MobileHeader title="Service Orders" menu onBack={() => navigate(-1)} />
          <div style={{ maxWidth: 1100, margin: "0 auto" }}>
            <FamilySwitch family={family} setFamily={setFamily} />
            <LegacyOrderList />
          </div>
        </>
      )}
    </>
  );
}

function FamilySwitch({ family, setFamily }: { family: "sv" | "legacy"; setFamily: (f: "sv" | "legacy") => void }) {
  const opts: ["sv" | "legacy", string, typeof Wrench][] = [["sv", "SV orders", Wrench], ["legacy", "Legacy repair orders", Archive]];
  return (
    <div role="tablist" aria-label="Order type" style={{ margin: "10px 18px 0", display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 4, height: 48, boxSizing: "border-box", padding: 4, borderRadius: 14, background: CC.sep }}>
      {opts.map(([k, label, I]) => {
        const on = family === k;
        return (
          <button key={k} type="button" role="tab" aria-selected={on} onClick={() => setFamily(k)} style={{ minWidth: 0, height: "100%", borderRadius: 11, border: "none", background: on ? M.card : "transparent", color: on ? M.raisin : M.ink, fontFamily: "inherit", fontSize: 13, fontWeight: on ? 700 : 600, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "0 6px", cursor: "pointer", boxShadow: on ? SH_FIELD : "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            <I size={15} strokeWidth={1.9} />{label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
function SvList({ sp, setSp, family, setFamily }: { sp: URLSearchParams; setSp: (p: URLSearchParams, o?: { replace?: boolean }) => void; family: "sv" | "legacy"; setFamily: (f: "sv" | "legacy") => void }) {
  const navigate = useNavigate();
  const { mode } = useResponsiveLayout();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission("sales-orders", "create");
  const canConfirm = hasPermission("sales-orders", "confirm");
  const canDelete = hasPermission("sales-orders", "delete");
  const toast = useMobileToast();
  const confirmSheet = useConfirmSheet();

  const { data, loading, error, failure, refresh } = useCachedJson<{ data?: Row[] }>(SV_URL);
  const { data: caseResp, failure: caseFailure } = useCachedJson<{ data?: Row[] }>("/api/service-cases");

  // URL-backed list state.
  const tab: SvTab = sp.get("tab") === "drafts" ? "drafts" : "confirmed";
  const chip = (SV_CHIPS.find((c) => c.key === sp.get("chip"))?.key ?? "ALL") as SvChip;
  const filters: SvFilters = {
    sort: (Object.keys(SV_SORT_LABEL).includes(sp.get("sort") ?? "") ? sp.get("sort") : "newest") as SvSort,
    caseLink: (["linked", "standalone"].includes(sp.get("link") ?? "") ? sp.get("link") : "any") as SvCaseFilter,
  };
  const put = (k: string, v: string | null) => {
    const next = new URLSearchParams(sp);
    if (v == null || v === "") next.delete(k);
    else next.set(k, v);
    setSp(next, { replace: true });
  };
  const [q, setQ] = useState(sp.get("q") ?? "");
  const dq = useDebounced(q);
  useEffect(() => {
    if ((sp.get("q") ?? "") !== dq) put("q", dq || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq]);

  const [filterOpen, setFilterOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [cardMenu, setCardMenu] = useState<SvRow | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => (data?.data ?? []).map(toSvRow).filter((r) => r.id), [data]);
  // SV order id → parent case (the case list carries each case's child orders).
  const caseOf = useMemo(() => {
    const m = new Map<string, { id: string; no: string }>();
    for (const c of caseResp?.data ?? []) {
      const orders = Array.isArray(c.orders) ? (c.orders as Row[]) : [];
      for (const o of orders) if (o.isSv && o.id) m.set(String(o.id), { id: String(c.id), no: String(c.caseNo ?? "") });
    }
    return m;
  }, [caseResp]);
  const caseNoById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of caseResp?.data ?? []) m.set(String(c.id), String(c.caseNo ?? ""));
    return m;
  }, [caseResp]);
  const parentCase = (r: SvRow): { id: string; no: string } | null => {
    if (r.caseId) return { id: r.caseId, no: caseNoById.get(r.caseId) ?? "" };
    return caseOf.get(r.id) ?? null;
  };

  // How much of the case list we actually have. Only a loaded, below-cap list can prove an order is standalone.
  const coverage = caseCoverage({ loaded: Array.isArray(caseResp?.data), count: caseResp?.data?.length ?? 0, hasError: !!caseFailure });
  const linkOf = (r: SvRow) => resolveCaseLink(!!parentCase(r), coverage);

  // Production progress: scoped reads, chunked at 100 (same fetch the Service Cases list makes).
  const prodIds = useMemo(() => rows.filter((r) => !["DRAFT", "CANCELLED"].includes(r.status)).map((r) => r.id).sort(), [rows]);
  const [posBySo, setPosBySo] = useState<Map<string, PoLite[]>>(new Map());
  useEffect(() => {
    let off = false;
    const urls: string[] = [];
    for (let i = 0; i < prodIds.length; i += 100) urls.push("/api/production-orders?fields=minimal&include=jobCards&scope=" + prodIds.slice(i, i + 100).map(encodeURIComponent).join(","));
    void Promise.all(urls.map((u) => cachedFetchJson<{ data?: PoLite[] }>(u))).then((rs) => {
      if (!off) setPosBySo(groupPosBySo(rs.flatMap((r) => r?.data ?? [])));
    });
    return () => { off = true; };
  }, [prodIds]);

  const tabRows = useMemo(() => rows.filter((r) => inTab(r.status, tab)), [rows, tab]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const ch of SV_CHIPS) c[ch.key] = tabRows.filter((r) => inChip(r.status, ch.key)).length;
    return c;
  }, [tabRows]);
  const tabCount = { confirmed: rows.filter((r) => inTab(r.status, "confirmed")).length, drafts: rows.filter((r) => inTab(r.status, "drafts")).length };
  const shown = useMemo(
    () => sortSv(tabRows.filter((r) => (tab === "drafts" || inChip(r.status, chip)) && matchesSv(r, dq, filters, parentCase(r)?.no ?? "", linkOf(r))), filters.sort),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tabRows, tab, chip, dq, filters.sort, filters.caseLink, caseOf, caseNoById, coverage],
  );
  const fCount = svFilterCount(filters);
  const narrowed = !!dq.trim() || fCount > 0;
  // `error` is already humanized text; the status lives on `failure`.
  const forbidden = !data && classifyListFailure(failure) === "forbidden";
  const linkNote = caseLinkNote(filters.caseLink, coverage);
  const cols = mode === "phone" ? "minmax(0,1fr)" : "repeat(2,minmax(0,1fr))";
  const canBulk = tab === "drafts" ? canConfirm || canDelete : true;

  const exportCsv = (list: SvRow[]) => {
    exportToCsv<SvRow>({
      filename: `service-orders-${todayYmdMY()}`,
      columns: [
        { header: "SV No", accessor: (r) => r.no },
        { header: "Status", accessor: (r) => SV_STATUS_LABEL[r.status] ?? r.status },
        { header: "Customer", accessor: (r) => r.customerName },
        { header: "Customer PO", accessor: (r) => r.customerPO },
        { header: "Customer SO", accessor: (r) => r.customerSO },
        { header: "Reference", accessor: (r) => r.reference },
        { header: "Parent Case", accessor: (r) => parentCase(r)?.no ?? "" },
        { header: "Order Date", accessor: (r) => r.orderDate },
        { header: "Expected DD", accessor: (r) => r.expectedDD },
        { header: "Customer DD", accessor: (r) => r.customerDD },
        { header: "Lines", accessor: (r) => r.lines },
        { header: "Qty", accessor: (r) => r.qty },
        { header: "Total (MYR)", accessor: (r) => (r.totalSen / 100).toFixed(2) },
      ],
      rows: list,
    });
    setMoreOpen(false);
    toast.show(`CSV exported · ${list.length} order${list.length === 1 ? "" : "s"}`, "success");
  };

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const endSelect = () => { setSelecting(false); setSel(new Set()); };
  const picked = shown.filter((r) => sel.has(r.id));

  // Desktop Drafts bar: each order is processed and reported on its own (a linked DO / invoice blocks specific rows).
  const bulk = async (kind: "confirm" | "delete") => {
    if (busy || picked.length === 0) return;
    const ok = await confirmSheet.confirm(
      kind === "confirm"
        ? { title: `Confirm ${picked.length} draft${picked.length === 1 ? "" : "s"}?`, lines: [{ icon: "list", text: "Production orders are created for every line and each order becomes CONFIRMED." }, { icon: "warning", text: "It starts production and purchasing, so check the drafts first." }], confirmLabel: "Confirm orders" }
        : { title: `Delete ${picked.length} draft${picked.length === 1 ? "" : "s"}?`, lines: [{ icon: "warning", text: "Drafts are removed for good. Confirmed orders are never deleted — cancel them instead." }], confirmLabel: "Delete drafts" },
    );
    if (!ok) return;
    setBusy(true);
    let done = 0;
    const failed: string[] = [];
    let actor = "Admin";
    try { actor = getCurrentUser()?.displayName?.trim() || "Admin"; } catch { /* keep default */ }
    for (const r of picked) {
      const res = kind === "confirm"
        ? await mutateJson(`/api/sales-orders/${encodeURIComponent(r.id)}/confirm`, "POST", { changedBy: actor }, { "Idempotency-Key": crypto.randomUUID() })
        : await mutateJson(`/api/sales-orders/${encodeURIComponent(r.id)}`, "DELETE");
      if (res.ok) done += 1;
      else failed.push(`${r.no}: ${res.error || `HTTP ${res.status}`}`);
    }
    setBusy(false);
    refreshList("/api/sales-orders");
    refreshList("/api/production-orders");
    endSelect();
    refresh();
    if (failed.length === 0) toast.show(`${done} draft${done === 1 ? "" : "s"} ${kind === "confirm" ? "confirmed" : "deleted"}`, "success");
    else toast.show(`${done} done, ${failed.length} failed — ${failed[0]}`, "error");
  };

  const emptyCopy = narrowed
    ? { icon: SearchX, title: "No orders match", text: "Try a different search, status or filter." }
    : rows.length === 0
      ? { icon: Wrench, title: "No SV service orders yet", text: "New SV orders come from + New, Copy from SO/CO, or a Service Case." }
      : { icon: tab === "drafts" ? FileCheck : Inbox, title: tab === "drafts" ? "No drafts" : "No orders in this status", text: tab === "drafts" ? "Every SV order has been confirmed." : "Pick another status to see more." };

  return (
    <>
      <MobileHeader
        title="Service Orders"
        menu
        onBack={() => navigate(-1)}
        trailing={
          <div style={{ display: "flex", gap: 8 }}>
            <IconBtn label="More actions" onClick={() => setMoreOpen(true)} disabled={loading || !!error}><Ellipsis size={20} strokeWidth={2} /></IconBtn>
            {canCreate && !forbidden ? <IconBtn label="New SV service order" primary onClick={() => setNewOpen(true)}><Plus size={20} strokeWidth={2.2} /></IconBtn> : null}
          </div>
        }
      />
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <FamilySwitch family={family} setFamily={setFamily} />
        {forbidden ? (
          <Msg icon={Lock} text="You don’t have access to Service Orders" sub="SV orders use Sales Orders access. Ask an admin if you need it." />
        ) : error && !data ? (
          <Msg icon={CloudOff} tone="danger" text="Couldn’t load SV orders" sub="This is a load failure, not an empty list. Check your connection and try again." action={<Btn onClick={() => refresh()}>Try again</Btn>} />
        ) : (
          <>
            <div className="sv-search" style={{ display: "flex", gap: 8, padding: "14px 18px 4px" }}>
              {/* The field has its own clear button; hide the browser's second one. */}
              <style>{'.sv-search input[type="search"]::-webkit-search-cancel-button{-webkit-appearance:none;appearance:none;display:none}'}</style>
              <SearchField
                value={q}
                onChange={setQ}
                placeholder="Search SV no, customer, PO, SO, reference"
                label="Search SV orders"
                trailing={q ? <button type="button" aria-label="Clear search" onClick={() => setQ("")} style={{ flex: "none", width: 36, height: 44, border: "none", background: "none", color: M.muted, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 }}><span style={{ width: 22, height: 22, borderRadius: 999, background: "#F2EEE6", display: "flex", alignItems: "center", justifyContent: "center" }}><X size={13} strokeWidth={2.4} /></span></button> : null}
              />
            </div>
            <div role="tablist" aria-label="Order tab" style={{ margin: "10px 18px 0", display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 4, height: 44, boxSizing: "border-box", padding: 4, borderRadius: 12, background: CC.sep }}>
              {([["confirmed", "Confirmed"], ["drafts", "Drafts"]] as [SvTab, string][]).map(([k, l]) => {
                const on = tab === k;
                return (
                  <button key={k} type="button" role="tab" aria-selected={on} onClick={() => { put("tab", k === "confirmed" ? null : k); endSelect(); }} style={{ minWidth: 0, borderRadius: 9, border: "none", background: on ? M.card : "transparent", color: on ? M.raisin : M.ink, fontFamily: "inherit", fontSize: 13, fontWeight: on ? 700 : 600, cursor: "pointer", boxShadow: on ? SH_FIELD : "none", whiteSpace: "nowrap", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                    {l}<span style={{ fontVariantNumeric: "tabular-nums", opacity: 0.75 }}>{loading && !data ? "" : tabCount[k]}</span>
                  </button>
                );
              })}
            </div>
            {tab === "confirmed" ? (
              <div role="tablist" aria-label="Order status" style={{ display: "flex", gap: 8, overflowX: "auto", padding: "12px 18px 4px", scrollbarWidth: "none" }}>
                {SV_CHIPS.map((c) => (
                  <Chip role="tab" key={c.key} label={c.label} on={chip === c.key} count={loading && !data ? undefined : counts[c.key]} onClick={() => put("chip", c.key === "ALL" ? null : c.key)} dot={c.key === "ALL" ? undefined : c.key === "ON_HOLD" ? "#9C6F1E" : c.key === "CANCELLED" ? "#9A3A2D" : c.key === "COMPLETED" ? "#4F7C3A" : "#3A5670"} />
                ))}
              </div>
            ) : null}
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 18px 4px" }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1px", color: CC.brown, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{loading && !data ? "" : `${shown.length} `}{tab === "drafts" ? "DRAFT" : "SV ORDER"}{shown.length === 1 && !(loading && !data) ? "" : "S"}</span>
              <span style={{ flex: 1, minWidth: 8, height: 1, background: "#E6E0D9" }} />
              {canBulk && shown.length > 0 ? (
                <button type="button" onClick={() => (selecting ? endSelect() : setSelecting(true))} style={{ height: 32, padding: "0 12px", borderRadius: 999, border: "none", background: selecting ? CC.brown : M.card, color: selecting ? "#fff" : CC.brown, fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, cursor: "pointer", boxShadow: selecting ? SH_ON : SH_CTRL, flex: "none" }}>{selecting ? "Done" : "Select"}</button>
              ) : null}
              <button type="button" onClick={() => setFilterOpen(true)} aria-label={fCount ? `Sort and filter, ${fCount} active` : "Sort and filter"} title="Sort & filter" aria-haspopup="dialog" style={{ position: "relative", width: 38, height: 38, borderRadius: "50%", border: "none", padding: 0, flex: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", background: fCount ? CC.brown : M.card, color: fCount ? "#FFFFFF" : CC.brown, boxShadow: fCount ? SH_ON : SH_CTRL }}>
                <ArrowDownUp size={16} strokeWidth={1.9} />
                {fCount > 0 ? <span aria-hidden style={{ position: "absolute", top: -3, right: -3, minWidth: 17, height: 17, padding: "0 4px", boxSizing: "border-box", borderRadius: 999, background: CC.danger, color: "#fff", fontSize: 10, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 0 2px #FAF8F4" }}>{fCount}</span> : null}
              </button>
            </div>

            {fCount > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, padding: "6px 18px 2px" }}>
                {([
                  filters.sort !== "newest" ? [`Sort: ${SV_SORT_LABEL[filters.sort]}`, "sort"] : null,
                  filters.caseLink !== "any" ? [filters.caseLink === "linked" ? "Linked to a case" : "Standalone", "link"] : null,
                ].filter(Boolean) as [string, string][]).map(([label, key]) => (
                  <button key={key} type="button" aria-label={`Remove ${label}`} onClick={() => put(key, null)} style={{ height: 30, boxSizing: "border-box", display: "inline-flex", alignItems: "center", gap: 5, padding: "0 10px 0 12px", borderRadius: 999, border: "none", background: CC.tileWarm, color: CC.brown, fontFamily: "inherit", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer", boxShadow: "0 4px 12px -6px rgba(107,92,50,.45)" }}>{label}<X size={13} strokeWidth={2.2} /></button>
                ))}
                <button type="button" onClick={() => { const n = new URLSearchParams(sp); ["sort", "link"].forEach((k) => n.delete(k)); setSp(n, { replace: true }); }} style={{ height: 30, padding: "0 6px", border: "none", background: "transparent", color: CC.brown, fontFamily: "inherit", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Clear all</button>
              </div>
            ) : null}

            {linkNote ? <div style={{ padding: "6px 18px 0" }}><Note icon={Info}>{linkNote}</Note></div> : null}

            {loading && !data ? (
              <div aria-busy="true" aria-label="Loading SV orders" style={{ display: "grid", gridTemplateColumns: cols, gap: 11, padding: "10px 18px 120px" }}>
                {[0, 1, 2, 3].map((i) => <div key={i} style={{ height: 176, borderRadius: 16, background: "#EFEAE1" }} />)}
              </div>
            ) : shown.length === 0 ? (
              <Msg card={false} icon={emptyCopy.icon} text={emptyCopy.title} sub={emptyCopy.text} action={narrowed ? <Btn kind="secondary" onClick={() => { setQ(""); const n = new URLSearchParams(sp); ["q", "sort", "link"].forEach((k) => n.delete(k)); setSp(n, { replace: true }); }}>Reset search &amp; filters</Btn> : undefined} />
            ) : (
              <>
                <div style={{ padding: "6px 18px 0", display: "grid", gridTemplateColumns: cols, gap: 11 }}>
                  {shown.map((r) => (
                    <SvCard
                      key={r.id}
                      r={r}
                      pc={parentCase(r)}
                      prod={tab === "drafts" || r.status === "CANCELLED" ? null : svProduction(posBySo.get(r.id) ?? [])}
                      selecting={selecting}
                      selected={sel.has(r.id)}
                      onOpen={() => (selecting ? toggle(r.id) : navigate(svDetailPath(r.id)))}
                      onMenu={() => setCardMenu(r)}
                    />
                  ))}
                </div>
                <div style={{ margin: "14px 18px 0", textAlign: "center", fontSize: 11.5, color: "#9A9082" }}>{`${rows.length} SV order${rows.length === 1 ? "" : "s"} loaded. Search and export cover loaded orders.`}</div>
                <div style={{ height: selecting ? 190 : 120 }} />
              </>
            )}
          </>
        )}
      </div>

      {selecting ? (
        <ResponsiveActionDock scope="list" phoneBottom={64}>
          <div role="toolbar" aria-label="Selection actions" style={{ width: "100%", boxSizing: "border-box", background: "#FAF8F4", boxShadow: "0 -1px 0 #E6E0D9, 0 -10px 24px -12px rgba(31,29,27,.18)", padding: "10px 16px", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ flex: "none", fontSize: 13, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap" }}>{picked.length} selected</span>
            <button type="button" onClick={() => setSel(picked.length === shown.length ? new Set() : new Set(shown.map((r) => r.id)))} style={{ flex: "none", height: 42, padding: "0 10px", border: "none", background: "none", color: CC.brown, fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{picked.length === shown.length ? "Clear" : "All"}</button>
            <span style={{ flex: 1 }} />
            {tab === "drafts" ? (
              <>
                {canDelete ? <Btn kind="secondary" danger disabled={busy || picked.length === 0} onClick={() => void bulk("delete")}>Delete</Btn> : null}
                {canConfirm ? <Btn disabled={busy || picked.length === 0} onClick={() => void bulk("confirm")}>{picked.length ? `Confirm ${picked.length}` : "Confirm"}</Btn> : null}
              </>
            ) : (
              <Btn disabled={picked.length === 0} onClick={() => { exportCsv(picked); endSelect(); }}>Export</Btn>
            )}
          </div>
        </ResponsiveActionDock>
      ) : null}

      <Sheet open={filterOpen} onClose={() => setFilterOpen(false)} title="Sort & filter">
        <SectionLabel>Sort by</SectionLabel>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          {(Object.keys(SV_SORT_LABEL) as SvSort[]).map((k) => <Chip key={k} role="radio" label={SV_SORT_LABEL[k]} on={filters.sort === k} onClick={() => put("sort", k === "newest" ? null : k)} />)}
        </div>
        <SectionLabel>Parent case</SectionLabel>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          {([["any", "Any"], ["linked", "Linked to a case"], ["standalone", "Standalone"]] as [SvCaseFilter, string][]).map(([k, l]) => <Chip key={k} role="radio" label={l} on={filters.caseLink === k} onClick={() => put("link", k === "any" ? null : k)} />)}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {fCount > 0 ? <Btn kind="secondary" full onClick={() => { const n = new URLSearchParams(sp); ["sort", "link"].forEach((k) => n.delete(k)); setSp(n, { replace: true }); }}>Reset</Btn> : null}
          <Btn full onClick={() => setFilterOpen(false)}>Show {shown.length} order{shown.length === 1 ? "" : "s"}</Btn>
        </div>
      </Sheet>

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="SV orders">
        <div style={{ background: M.card, borderRadius: 16, overflow: "hidden", boxShadow: SH_CARD }}>
          {([
            ["Export", "CSV · current tab, status, search and filters", Download, shown.length === 0, () => exportCsv(shown)],
            ["Select orders", "For bulk actions and export", ListChecks, shown.length === 0 || !canBulk, () => { setMoreOpen(false); setSelecting(true); }],
            ["Refresh", "Reload the list", RefreshCw, false, () => { setMoreOpen(false); refresh(); }],
          ] as [string, string, typeof Copy, boolean, () => void][]).map(([t, sub, I, off, fn], i) => (
            <button key={t} type="button" onClick={fn} disabled={off} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, minHeight: 56, padding: "8px 15px", background: "none", border: "none", borderTop: i ? `1px solid ${CC.sep}` : "none", fontFamily: "inherit", textAlign: "left", cursor: off ? "default" : "pointer", opacity: off ? 0.5 : 1 }}>
              <IconTile icon={I} size={34} r={10} iconSize={17} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: M.raisin }}>{t}</span>
                <span style={{ display: "block", fontSize: 12, color: M.ink, marginTop: 2 }}>{sub}</span>
              </span>
            </button>
          ))}
        </div>
        <div style={{ margin: "12px 0 8px" }}><Note icon={Info}>Bulk actions and export follow the desktop list. Excel, Detail Listing, Saved Views and Column pickers stay on the desktop for now.</Note></div>
      </Sheet>

      <Sheet open={newOpen} onClose={() => setNewOpen(false)} title="New SV service order">
        <div style={{ fontSize: 12.5, color: M.ink, margin: "-16px 2px 10px" }}>Choose how to start</div>
        <div style={{ background: M.card, borderRadius: 16, overflow: "hidden", boxShadow: SH_CARD }}>
          {([
            ["Blank SV", "Start with an empty form", FilePlus2, SV_NEW_PATH],
            ["Copy from sales order", "Copies customer and lines", Copy, `${SV_NEW_PATH}?from=so`],
            ["Copy from consignment order", "Copies customer and lines", Package, `${SV_NEW_PATH}?from=co`],
            ["From a service case", "Keeps the case link · prefills affected items", LifeBuoy, `${SV_NEW_PATH}?from=case`],
          ] as [string, string, typeof Copy, string][]).map(([t, sub, , path], i) => (
            <button key={t} type="button" onClick={() => { setNewOpen(false); navigate(path); }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, minHeight: 58, padding: "8px 15px", background: "none", border: "none", borderTop: i ? `1px solid ${CC.sep}` : "none", fontFamily: "inherit", textAlign: "left", cursor: "pointer" }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: M.raisin }}>{t}</span>
                <span style={{ display: "block", fontSize: 12, color: M.ink, marginTop: 2 }}>{sub}</span>
              </span>
              <ChevronRight size={18} strokeWidth={1.9} color={CC.brownSoft} />
            </button>
          ))}
        </div>
      </Sheet>

      <Sheet open={!!cardMenu} onClose={() => setCardMenu(null)} title={cardMenu?.no ?? ""}>
        {cardMenu ? <div style={{ fontSize: 12.5, color: M.ink, margin: "-16px 2px 10px" }}>{`${SV_STATUS_LABEL[cardMenu.status] ?? cardMenu.status} · ${cardMenu.customerName}`}</div> : null}
        {cardMenu ? (
          <div style={{ background: M.card, borderRadius: 16, overflow: "hidden", boxShadow: SH_CARD }}>
            <MenuRow label="View" sub="Open the SV detail" onClick={() => { const id = cardMenu.id; setCardMenu(null); navigate(svDetailPath(id)); }} />
            {parentCase(cardMenu) ? <MenuRow label="Open parent case" sub={parentCase(cardMenu)?.no || "Service case"} onClick={() => { const c = parentCase(cardMenu); setCardMenu(null); if (c) navigate(casePath(c.id)); }} /> : null}
          </div>
        ) : null}
      </Sheet>
      {toast.node}
      {confirmSheet.node}
    </>
  );
}

function MenuRow({ label, sub, onClick }: { label: string; sub: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, minHeight: 56, padding: "8px 15px", background: "none", border: "none", borderTop: `1px solid ${CC.sep}`, fontFamily: "inherit", textAlign: "left", cursor: "pointer" }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: M.raisin }}>{label}</span>
        <span style={{ display: "block", fontSize: 12, color: M.ink, marginTop: 2 }}>{sub}</span>
      </span>
      <ChevronRight size={18} strokeWidth={1.9} color={CC.brownSoft} />
    </button>
  );
}

function SvCard({ r, pc, prod, selecting, selected, onOpen, onMenu }: { r: SvRow; pc: { id: string; no: string } | null; prod: ReturnType<typeof svProduction> | null; selecting: boolean; selected: boolean; onOpen: () => void; onMenu: () => void }) {
  const tone = svTone(r.status);
  const rail = svRail(r.status);
  const done = prod?.kind === "done";
  const refs: [string, string][] = [];
  if (r.customerPO) refs.push(["PO", r.customerPO]);
  if (r.customerSO) refs.push(["SO", r.customerSO]);
  if (r.reference) refs.push(["Ref", r.reference]);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${r.no}, ${r.customerName}, ${SV_STATUS_LABEL[r.status] ?? r.status}`}
      aria-pressed={selecting ? selected : undefined}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      style={{ position: "relative", minWidth: 0, background: M.card, borderRadius: 16, padding: "13px 10px 12px 17px", cursor: "pointer", overflow: "hidden", boxShadow: selected ? `0 0 0 2px ${CC.brown}, ${SH_CARD}` : SH_CARD, WebkitTapHighlightColor: "transparent" }}
    >
      <div aria-hidden style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: rail }} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        {selecting ? <span aria-hidden style={{ flex: "none", width: 22, height: 22, borderRadius: 7, border: selected ? "none" : "1.5px solid #CFC8BD", background: selected ? CC.brown : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>{selected ? <Check size={14} strokeWidth={3} color="#fff" /> : null}</span> : null}
        <span style={{ minWidth: 0, fontSize: 14, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontVariantNumeric: "tabular-nums" }}>{r.no || "—"}</span>
        <Pill label={SV_STATUS_LABEL[r.status] ?? r.status} tone={tone} dot={rail} />
        <span style={{ flex: 1 }} />
        <span style={{ flex: "none", fontSize: 11.5, color: M.ink, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{fmtDM(r.orderDate)}</span>
        {!selecting ? (
          <button type="button" aria-label={`More actions for ${r.no}`} onClick={(e) => { e.stopPropagation(); onMenu(); }} style={{ flex: "none", width: 32, height: 32, margin: "-6px -4px -6px -2px", border: "none", background: "none", color: CC.brownSoft, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 }}>
            <EllipsisVertical size={17} strokeWidth={2} aria-hidden />
          </button>
        ) : null}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 6, paddingRight: 6 }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 700, lineHeight: 1.35, color: M.raisin, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", wordBreak: "break-word" }}>{r.customerName || "—"}</div>
        {pc ? <span style={{ flex: "none", maxWidth: "46%", height: 20, display: "inline-flex", alignItems: "center", gap: 4, padding: "0 7px", borderRadius: 6, background: "#F4EFE3", color: CC.brown, fontSize: 10.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", alignSelf: "center" }}><LifeBuoy size={11} strokeWidth={2.2} style={{ flex: "none" }} />{pc.no || "Case"}</span> : null}
      </div>
      {refs.length ? <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 7, paddingRight: 6 }}>{refs.map(([k, v]) => <RefChip key={k} k={k} v={v} />)}</div> : null}
      {prod ? (
        <div style={{ marginTop: 10, paddingRight: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: M.ink, minWidth: 0 }}>
            <Factory size={12} strokeWidth={2} color={CC.brownSoft} style={{ flex: "none" }} />
            <span style={{ flex: "none" }}>Production</span>
            <span style={{ flex: 1, minWidth: 0, fontWeight: 700, color: done ? "#3A6B3A" : M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{prod.kind === "none" ? "Not started" : done ? "Done" : prod.dept || "In progress"}</span>
            {prod.kind === "progress" ? <span style={{ flex: "none", fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums" }}>{prod.pct}%</span> : null}
          </div>
          <div aria-hidden style={{ height: 5, borderRadius: 999, background: CC.trackMap, marginTop: 5, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${prod.kind === "none" ? 0 : prod.pct}%`, borderRadius: 999, background: done ? "#4F7C3A" : CC.brown }} />
          </div>
        </div>
      ) : null}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1.35fr)", marginTop: 10, padding: "8px 6px 0 0", borderTop: `1px solid ${CC.sep}` }}>
        <Metric label="EXPECTED" value={fmtDM(r.expectedDD) || "—"} first />
        <Metric label="CUSTOMER" value={fmtDM(r.customerDD) || "—"} />
        <Metric label="QTY" value={`${r.qty} · ${r.lines} line${r.lines === 1 ? "" : "s"}`} />
        <Metric label="TOTAL" value={money(r.totalSen)} right />
      </div>
    </div>
  );
}

function Metric({ label, value, first, right }: { label: string; value: string; first?: boolean; right?: boolean }) {
  return (
    <div style={{ minWidth: 0, paddingLeft: first ? 0 : 9, borderLeft: first ? "none" : `1px solid ${CC.sep}`, textAlign: right ? "right" : "left" }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".5px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: CC.brown }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: M.raisin, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}
