// ===========================================================================
// InvoicesScreen — L1 /m/invoices, phone AND tablet (owner 2026-10-21/22).
//
// Visuals: Claude Design `docs/design/invoices-v2/Invoices v2.dc.html` (the
// two-tab handoff); typography: the sibling /m screens (Procurement /
// Delivery). Rules: ../../lib/invoices-mobile.ts.
//
// Two tabs on the shared segmented switch:
//   Invoices  GET /api/invoices        → v2 invoice card, status chips, summary,
//                                        search + Scan QR, "+" (no Filter & sort:
//                                        owner 2026-10-22; newest invoice first)
//   AR Aging  GET /api/invoices/aging  → summary, customer cards, customer sheet;
//                                        customer-name search only. Server
//                                        buckets (SEN), never recomputed here.
//                                        Shown only when canUseArAging allows
//                                        (BUG-2026-10-22-349); otherwise the tab
//                                        is hidden and nothing is fetched.
// Both need `invoices:read` (TAB_READ_RESOURCE). A 403 reads "no access", not a
// connection error. The five former tabs (Payments … e-Invoice) left this UI
// only: their invoicesConfig sources stay (global search), and an old
// `?tab=payments` falls back to Invoices (pickTab).
// No list request is paged, so chips / totals / search see every row the
// caller may read; totals are shown only when the payload says it is whole.
// Read-only: the screen never writes. "+" opens the existing New Invoice form.
// ===========================================================================
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { BarChart3, List } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { useUrlBatch, useUrlState } from "@/lib/use-url-state";
import { todayYmdMY } from "@/lib/utils";
import { usePermissions } from "@/lib/use-permission";
import { MobileHeader, FormSheet, ScanSheet } from "../../components";
import { M } from "../../theme";
import { invoicesConfig } from "../../config/modules";
import { createSpecFor } from "../../config/forms";
import { applySort } from "../../config/helpers";
import type { ColumnDef, DataSource } from "../../config/types";
import type { FormSpec } from "../../config/form-types";
import { useResponsiveLayout } from "../../lib/responsive-layout";
import { useDebounced } from "../../lib/use-debounced";
import {
  AGING_SERVER_SCOPED, INVOICE_STATUSES, agingList, canUseArAging, agingTotals, allowedTabs, filterAging, filterInvoices, invoiceList, invoiceTone,
  isForbidden, meRole, pickTab, statusCounts, summarize, type RawRow,
} from "../../lib/invoices-mobile";
import { s } from "../../lib/do-mobile";
import { EmptyCard } from "../delivery/DeliveryCards";
import { useMobileToast } from "../delivery/ui-hooks";
import { ErrorCard, HeaderPlus, SkeletonCards } from "../procurement/parts";
import { CountLine, InvoiceCard, ModuleSwitch, SearchPill, StatusChips, SummaryCard } from "./parts";
import { AgingCustomerCard, AgingCustomerSheet, AgingSummaryCard } from "./aging-parts";

type Sort = { key: string; dir: "asc" | "desc" } | null;

const PAGE_SIZE = 40;
const SHADOW_CONTROL = "0 1px 2px rgba(31,29,27,.05),0 8px 22px -10px rgba(31,29,27,.18)";
const AGING_URL = "/api/invoices/aging";

/** The Invoices list source (the first of the six invoicesConfig sources). */
const INVOICE_SOURCE: DataSource =
  invoicesConfig.sources.find((src) => src.subTabs.some((t) => t.key === "invoices")) ?? invoicesConfig.sources[0];

/** Handoff tabs + icons (desktop's List / BarChart3). AR Aging only when canUseArAging. */
const ALL_TABS = [
  { key: "invoices", label: "Invoices", icon: List },
  { key: "aging", label: "AR Aging", icon: BarChart3 },
];
const NO_AGING_TABS = ALL_TABS.filter((t) => t.key !== "aging");

// Columns the Invoices list sorts by (fixed: newest invoice date first). The
// Filter & sort sheet was removed from this screen (owner 2026-10-22, two-tab
// design); status is filtered by the chips. Labels follow the desktop grid.
const sd = (r: RawRow, ...k: string[]) => s(r, ...k).slice(0, 10);
const num = (r: RawRow, ...k: string[]) => {
  for (const key of k) {
    const v = Number(r[key]);
    if (Number.isFinite(v)) return v;
  }
  return 0;
};
const INVOICE_COLUMNS: ColumnDef[] = [
  { key: "invoiceNo", label: "Invoice No", type: "text", value: (r) => s(r, "invoiceNo", "invoice_no") },
  { key: "customer", label: "Customer", type: "text", value: (r) => s(r, "customerName", "customer_name") },
  { key: "doNo", label: "DO No", type: "text", value: (r) => s(r, "doNo", "do_no") },
  { key: "companySOId", label: "SO No", type: "text", value: (r) => s(r, "companySOId", "company_so_id") },
  { key: "customerPOId", label: "Customer PO", type: "text", value: (r) => s(r, "customerPOId", "customer_po_id") },
  { key: "invoiceDate", label: "Invoice Date", type: "date", value: (r) => sd(r, "invoiceDate", "invoice_date") },
  { key: "dueDate", label: "Due Date", type: "date", value: (r) => sd(r, "dueDate", "due_date") },
  { key: "amount", label: "Total", type: "number", value: (r) => num(r, "totalSen", "total_sen") },
  { key: "outstanding", label: "Balance", type: "number", value: (r) => num(r, "totalSen", "total_sen") - num(r, "paidAmount", "paid_amount") },
];
const INVOICE_DEFAULT_SORT: Sort = { key: "invoiceDate", dir: "desc" };

const STATUS_CHIPS = [{ key: "", label: "All" }, ...INVOICE_STATUSES.map((x) => ({ ...x, tone: invoiceTone(x.key) }))];

const ME_URL = "/api/auth/me";

/**
 * users.role, read fresh from the server on mount — never from a cache or the
 * login blob kept in browser storage (lib/auth.ts), so a role changed since login
 * cannot open AR Aging. null while loading and on ANY failure (401, 5xx,
 * network, bad body): the caller treats null as "not confirmed" → hidden.
 */
function useVerifiedAccountRole(): string | null {
  const [role, setRole] = useState<string | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    fetch(ME_URL, { cache: "no-store", credentials: "same-origin", signal: ctrl.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => { if (!ctrl.signal.aborted) setRole(meRole(body)); })
      .catch(() => { if (!ctrl.signal.aborted) setRole(null); });
    return () => ctrl.abort();
  }, []);
  return role;
}

export function InvoicesScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id: openId } = useParams();
  const layout = useResponsiveLayout();
  const tablet = layout.mode !== "phone";
  const inPane = layout.canSplitDetail && !!openId;
  const gridCols = tablet && !inPane ? "repeat(auto-fill, minmax(320px, 1fr))" : "minmax(0, 1fr)";

  // ---- tab / chip / past-due live in the URL (survive opening a detail) ----
  const [tabRaw] = useUrlState<string>("tab", "");
  const [statusRaw] = useUrlState<string>("status", "");
  const [dueRaw] = useUrlState<string>("due", "");
  const setUrl = useUrlBatch();
  // Each tab only with its API's read permission. While the permission set is
  // loading nothing is treated as denied: the screen waits. An EMPTY set after
  // loading means it could not be read (every role holds at least Settings),
  // so that is "couldn't confirm", never "no access".
  const { hasPermission, permissions, loading: permLoading } = usePermissions();
  const accountRole = useVerifiedAccountRole();
  // AR Aging: permissions loaded AND invoices:read AND ("*" confirmed by the
  // fresh users.role ∈ SUPER_ADMIN / ADMIN) until BUG-2026-10-22-349 is fixed.
  const agingOk = canUseArAging({
    canRead: !permLoading && hasPermission("invoices", "read"),
    wildcard: !permLoading && permissions.has("*"),
    accountRole,
    serverScoped: AGING_SERVER_SCOPED,
  });
  const TABS = agingOk ? ALL_TABS : NO_AGING_TABS;
  const allowed = allowedTabs(TABS, (resource) => hasPermission(resource, "read"));
  const permUnknown = !permLoading && permissions.size === 0;
  const picked = pickTab(allowed, tabRaw); // a removed tab (?tab=payments) → first allowed
  const noTab = picked == null;
  const tabKey = picked?.key ?? "invoices";
  const isInv = !noTab && tabKey === "invoices";
  const isAging = !noTab && tabKey === "aging";
  const chip = isInv && STATUS_CHIPS.some((c) => c.key === statusRaw) ? statusRaw : "";
  const pastDue = isInv && dueRaw === "past";

  const [q, setQ] = useState("");
  const dq = useDebounced(q).trim();

  const sort = INVOICE_DEFAULT_SORT;

  // ---- data: each tab fetches only while it is active ----
  const invResp = useCachedJson<unknown>(isInv ? INVOICE_SOURCE.url : null);
  const agingResp = useCachedJson<unknown>(agingOk && isAging ? AGING_URL : null);
  const active = isAging ? agingResp : invResp;
  const today = todayYmdMY();

  // Invoices pipeline (unchanged): filter-sheet scope → chips + summary; search does not.
  const inv = useMemo(() => (isInv ? invoiceList(invResp.data) : null), [isInv, invResp.data]);
  const scoped = useMemo(() => inv?.rows ?? [], [inv]);
  const complete = !!inv?.complete;
  const counts = useMemo(() => (isInv && complete ? statusCounts(scoped) : null), [isInv, complete, scoped]);
  const sum = useMemo(() => (isInv && complete ? summarize(scoped, chip, today) : null), [isInv, complete, scoped, chip, today]);
  const shownInvoices = useMemo(
    () => (isInv ? applySort(filterInvoices(scoped, { chip, pastDue, q: dq, today }), INVOICE_COLUMNS, sort) : []),
    [isInv, scoped, chip, pastDue, dq, today, sort],
  );

  // AR Aging pipeline: server rows → customer-name filter → summed (as the HTML).
  const aging = useMemo(() => (isAging ? agingList(agingResp.data) : null), [isAging, agingResp.data]);
  const shownAging = useMemo(() => (aging?.ok ? filterAging(aging.rows, dq) : []), [aging, dq]);
  const agingSum = useMemo(() => agingTotals(shownAging), [shownAging]);
  const [sheetKey, setSheetKey] = useState<string | null>(null);
  const sheetRow = shownAging.find((r) => r.key === sheetKey) ?? null;

  // Paint in pages (a long book must not freeze a phone); reset when the set changes.
  const shownCount = isAging ? shownAging.length : shownInvoices.length;
  const [visible, setVisible] = useState(PAGE_SIZE);
  const resetKey = `${tabKey}|${chip}|${pastDue}|${dq}`;
  const [lastKey, setLastKey] = useState(resetKey);
  if (resetKey !== lastKey) {
    setLastKey(resetKey);
    setVisible(PAGE_SIZE);
  }
  const hidden = Math.max(0, shownCount - visible);

  // ---- create / scan / feedback ----
  const toast = useMobileToast();
  const [createSpec, setCreateSpec] = useState<FormSpec | null>(null);
  const canCreate = createSpecFor(invoicesConfig.slug) != null;
  const [scanOpen, setScanOpen] = useState(false);

  // Switching tab resets search and the status chip to All (handoff §2.2).
  const goTab = (k: string) => {
    setUrl({ tab: k === allowed[0]?.key ? null : k, status: null, due: null });
    setQ("");
    setSheetKey(null);
  };
  const goChip = (k: string) => setUrl({ status: k || null });
  const togglePastDue = () => setUrl({ due: pastDue ? null : "past" });
  const openPath = (to: string) => navigate({ pathname: to, search: location.search });

  const hasData = active.data != null;
  const showSkeleton = active.loading && !hasData;
  // A 403 is "no access", not a connection problem.
  const forbidden = !hasData && isForbidden(active.failure);
  // AR Aging: a wrong-shaped / error envelope is an error too — never "No outstanding invoices".
  const failed = (!!active.error && !hasData && !forbidden) || (isAging && hasData && !aging?.ok);
  const summaryTitle = chip ? (INVOICE_STATUSES.find((x) => x.key === chip)?.label ?? chip).toUpperCase() : "ALL INVOICES";

  const header = (
    <MobileHeader
      title={invoicesConfig.title}
      onBack={() => navigate(-1)}
      menu
      glass
      trailing={canCreate && !noTab ? <HeaderPlus label="New Invoice" onClick={() => setCreateSpec(createSpecFor(invoicesConfig.slug))} /> : null}
    />
  );

  // No readable tab: still loading / couldn't confirm / genuinely no access.
  if (noTab) {
    return (
      <>
        {header}
        <div style={{ padding: "14px 18px 32px" }}>
          {permLoading ? (
            <SkeletonCards maxColumns={1} />
          ) : permUnknown ? (
            <EmptyCard text="Couldn’t confirm your access to Invoices right now. Reopen this screen to try again." />
          ) : (
            <EmptyCard text="You don’t have access to invoices." />
          )}
        </div>
      </>
    );
  }

  const countText = showSkeleton || failed || forbidden
    ? ""
    : isAging
      ? `${shownCount} CUSTOMER${shownCount === 1 ? "" : "S"}`
      : `${shownCount} INVOICE${shownCount === 1 ? "" : "S"}`;
  const emptyText = isAging
    ? dq ? "No customers match this filter." : "No outstanding invoices found."
    : dq || chip || pastDue ? "No records match." : "Nothing here yet.";

  return (
    <>
      {header}

      {/* Shared segmented switch; shown only when more than one tab is open to this user. */}
      {allowed.length > 1 ? <ModuleSwitch tabs={allowed} active={tabKey} onChange={goTab} /> : null}

      {/* HTML search pill. Invoices keeps Scan QR inside it (no Filter & sort,
          owner 2026-10-22); AR Aging is a customer-name filter only (handoff §2.2). */}
      {isAging ? (
        <SearchPill q={q} setQ={setQ} placeholder="Filter by customer" />
      ) : (
        <SearchPill
          q={q}
          setQ={setQ}
          placeholder="Search invoice, customer, DO, SO"
          onScan={() => setScanOpen(true)}
        />
      )}

      {isInv && !forbidden ? (
        <>
          <StatusChips chips={STATUS_CHIPS} value={chip} counts={counts} onPick={goChip} pastDue={pastDue} onClearPastDue={togglePastDue} />
          {failed ? null : <SummaryCard title={summaryTitle} sum={sum} ready={complete} pastDueOn={pastDue} onPastDue={togglePastDue} />}
          {hasData && !complete && !failed ? (
            <div role="status" style={{ margin: "8px 20px 0", fontSize: 12, color: M.ink }}>
              Totals and counts are hidden because the invoice list came back incomplete. Reopen Invoices, or check them in the desktop app.
            </div>
          ) : null}
        </>
      ) : null}

      {isAging && aging?.ok && !showSkeleton ? <AgingSummaryCard totals={agingSum} /> : null}

      <CountLine text={countText} />

      <div style={{ padding: "0 18px 32px" }}>
        {showSkeleton ? (
          <SkeletonCards maxColumns={tablet && !inPane ? undefined : 1} />
        ) : forbidden ? (
          <EmptyCard text={`You don’t have access to ${isAging ? "AR Aging" : "Invoices"}. Ask an administrator if you need it.`} />
        ) : failed ? (
          <ErrorCard
            text={isAging ? "Couldn’t load the aging report. Check your connection and try again." : "Couldn’t load this list. Check your connection and try again."}
            onRetry={() => active.refresh()}
          />
        ) : shownCount === 0 ? (
          <EmptyCard text={emptyText} />
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: gridCols, gap: 10 }}>
              {isAging
                ? shownAging.slice(0, visible).map((r) => <AgingCustomerCard key={r.key} row={r} onOpen={() => setSheetKey(r.key)} />)
                : shownInvoices.slice(0, visible).map((r, i) => {
                    const vm = INVOICE_SOURCE.toVM(r);
                    const dest = invoicesConfig.detailPath?.(vm, r) ?? null;
                    return (
                      <InvoiceCard
                        key={vm.id || i}
                        r={r}
                        today={today}
                        current={inPane && vm.id === openId}
                        onOpen={() => (dest ? openPath(dest) : toast.show("This invoice has no detail page.", "info"))}
                      />
                    );
                  })}
            </div>
            {hidden > 0 ? (
              <button
                type="button"
                onClick={() => setVisible((v) => v + PAGE_SIZE)}
                style={{ marginTop: 12, width: "100%", height: 44, borderRadius: 12, border: "none", background: M.card, color: M.taupe, fontFamily: "inherit", fontSize: 13.5, fontWeight: 700, cursor: "pointer", boxShadow: SHADOW_CONTROL }}
              >
                Show more ({hidden} more)
              </button>
            ) : null}
          </>
        )}
      </div>

      {isAging ? <AgingCustomerSheet row={sheetRow} onClose={() => setSheetKey(null)} /> : null}

      {/* "+" — the existing New Invoice form; on save, open the new document. */}
      <FormSheet
        open={createSpec != null}
        onClose={() => setCreateSpec(null)}
        spec={createSpec}
        onSaved={(to) => {
          setCreateSpec(null);
          if (to) navigate(to);
        }}
      />

      {/* QR scanner — same handling as the generic list: same-origin links open in-app. */}
      <ScanSheet
        open={scanOpen && isInv}
        onClose={() => setScanOpen(false)}
        onResult={(value) => {
          setScanOpen(false);
          try {
            const url = new URL(value, window.location.origin);
            if (url.origin === window.location.origin && url.pathname.startsWith("/")) {
              navigate(url.pathname + url.search);
              return;
            }
          } catch {
            // not a URL — fall through to the toast
          }
          toast.show(`Scanned: ${value.length > 60 ? `${value.slice(0, 60)}…` : value}`, "info");
        }}
      />
      {toast.node}
    </>
  );
}
