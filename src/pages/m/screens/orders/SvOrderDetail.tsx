// ===========================================================================
// SvOrderDetail — SV Service Order detail (Claude Design "Service Orders", Phase 2).
// Route: /m/serviceorders/sv/:id.  Record = sales_orders with isServiceOrder=true
// (GET /api/sales-orders/:id). Legacy Repair Orders (service_orders) are a different
// family and never shown here. Rules follow the DESKTOP (src/pages/sales/detail.tsx):
// see sv-actions.ts. Mutations go through the shared useSalesOrderActions hook; the
// parent Service Case is only linked to (read-only) — never changed here.
// ===========================================================================
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ChevronLeft, ChevronRight, ChevronDown, CloudOff, Download, Ellipsis, Eye, FileText, Lock, Package, Pencil, Truck, Unlink, ArrowUpRight, ArrowRight, Check, CircleCheck, Receipt,
  BadgePercent, Ban, CirclePause, CirclePlay, Copy, Paperclip, Trash2, Undo2, Wrench,
} from "lucide-react";
import { isUnknownOutcome, useCachedJson } from "@/lib/cached-fetch";
import { usePermissions } from "@/lib/use-permission";
import { parseRepairScope, REPAIR_DEPT_LABELS, REPAIR_SCOPE_PRESET_LABELS } from "@/lib/repair-scope";
import { Sheet } from "../../components";
import { useContainerLayout, useResponsiveLayout } from "../../lib/responsive-layout";
import { M } from "../../theme";
import { money, num, str } from "../../config/helpers";
import { useSalesOrderActions, type SoInfo } from "../../lib/use-so-actions";
import { soEditLocks } from "../../lib/so-actions";
import { BILL_TO_MESSAGE, downloadSoPdf, lookupBillTo, type BillTo } from "../../lib/so-pdf";
import { auditEvents, fmtDate, fmtDateTime, overrideForLine, rows, specChips, statusEvents, titleCase } from "../../lib/so-detail";
import { useConfirmSheet, useMobileToast } from "../delivery/ui-hooks";
import { HoldSheet, InfoSheet } from "../so/so-action-sheets";
import { CustomerChangeSheet, HubChangeSheet } from "../so/so-change-sheets";
import { QuickReport } from "../cases/QuickReport";
import { Btn, Card, EmptyCard, IconBtn, IconTile, Msg, Pill, RefChip, Tag } from "../cases/case-ui";
import { CC, SH_CARD, SH_CTRL } from "../cases/case-style";
import type { ServiceCaseApi } from "../cases/case-model";
import { ORDERS_LIST, SV_NEW_PATH, SV_STATUS_LABEL, casePath, fmtDMY, svEditPath, svTone } from "./order-model";
import { SV_CANCEL_COPY, svActionPlan, svRestoreTarget, svTapOutcome, type SvAction, type SvEligibility } from "./sv-actions";
import { SV_PATH, svChain, svCurrentDept, svProduction, svStageInfo } from "./sv-detail-model";

type Row = Record<string, unknown>;
type Envelope = { success?: boolean; data?: Row; lockReason?: string | null } & Record<string, unknown>;
type TabKey = "overview" | "items" | "production" | "fulfilment" | "history";
const HEADER_H = 52;
const TABS: [TabKey, string][] = [["overview", "Overview"], ["items", "Items & scope"], ["production", "Production"], ["fulfilment", "Fulfilment"], ["history", "History"]];
const CARD15 = { background: M.card, borderRadius: 16, boxShadow: SH_CARD, padding: 15, minWidth: 0 } as const;
const DONE_FG = "#3A6B3A";
const CHIP_TONE: Record<"gap" | "divan" | "leg" | "special", { bg: string; fg: string }> = {
  gap: { bg: "#E0EAF4", fg: "#3A5670" }, leg: { bg: "#FAEFCB", fg: "#85600F" }, divan: { bg: "#DCEBDC", fg: "#3A6B3A" }, special: { bg: CC.tile, fg: CC.chipText },
};
const STATUS_CODE_RE = /\b(?:DRAFT|CONFIRMED|IN_PRODUCTION|READY_TO_SHIP|SHIPPED|DELIVERED|INVOICED|CLOSED|ON_HOLD|CANCELLED)\b/g;
const SKEL = { background: "#EFEAE1" } as const;

export function SvOrderDetail() {
  const { id = "" } = useParams();
  // Keyed so switching orders (tablet split view) starts on Overview with fresh sheet state.
  return <SvOrderDetailInner key={id} id={id} />;
}

function SvOrderDetailInner({ id }: { id: string }) {
  const navigate = useNavigate();
  const { mode } = useResponsiveLayout();
  const container = useContainerLayout();
  const wide = mode !== "phone" && container.width >= 760;
  const toast = useMobileToast();
  const confirmSheet = useConfirmSheet();
  const { hasPermission } = usePermissions();
  const url = `/api/sales-orders/${encodeURIComponent(id)}`;
  const { data, loading, failure, refresh } = useCachedJson<Envelope>(id ? url : null);
  const doc = data?.data ?? null;
  const docId = doc ? str(doc, "id") || id : "";
  const status = doc ? str(doc, "status").toUpperCase() : "";

  const [tab, setTab] = useState<TabKey>("overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [info, setInfo] = useState<SoInfo | null>(null);
  const [lockSheet, setLockSheet] = useState<string | null>(null);
  const [filesOpen, setFilesOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [billTo, setBillTo] = useState<Extract<BillTo, { state: "missing" }> | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const tabsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const strip = tabsRef.current;
    const el = strip?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!strip || !el) return;
    strip.scrollTo({ left: Math.max(0, el.offsetLeft - (strip.clientWidth - el.offsetWidth) / 2), behavior: "smooth" });
  }, [tab, doc?.id]);

  // Edit lock verdict (server): production_started = any job card not WAITING / CANCELLED. Only in-flight orders need it.
  const eligibility = useCachedJson<NonNullable<SvEligibility>>(docId && (status === "CONFIRMED" || status === "IN_PRODUCTION") ? `${url}/edit-eligibility` : null);
  // Parent case: the order carries no case field; the case list carries each case's child orders.
  const cases = useCachedJson<{ data?: ServiceCaseApi[] }>(docId ? "/api/service-cases" : null);
  const caseRows = cases.data?.data;
  const parentRow = (caseRows ?? []).find((c) => (c.orders ?? []).some((o) => o.isSv && o.id === docId));
  const parentCase = parentRow ? { id: parentRow.id, no: parentRow.caseNo } : null;
  // Job cards for the progress figure (same scoped read the Service Cases screens make).
  const live = !!docId && !["DRAFT", "CANCELLED"].includes(status);
  const jcRes = useCachedJson<{ data?: Row[] }>(live ? `/api/production-orders?fields=minimal&include=jobCards&scope=${encodeURIComponent(docId)}` : null);
  const histTabOn = tab === "history" && !!docId;
  const audit = useCachedJson<{ data?: Row[] }>(histTabOn ? `/api/audit-events?resource=sales-orders&resourceId=${encodeURIComponent(docId)}` : null);
  const files = useCachedJson<{ data?: Row[] }>(filesOpen && docId ? `/api/files?resourceType=SO&resourceId=${encodeURIComponent(docId)}` : null);

  const actions = useSalesOrderActions({
    url,
    id,
    doc,
    notify: (t, tone) => toast.show(t, tone),
    // The shared hook words Cancel as "cannot be easily undone"; an SV order can be un-cancelled until it ships.
    // Resume / Undo cancel: the hook interpolates the raw status code (IN_PRODUCTION); show the label the rest of the screen uses.
    ask: (spec) => confirmSheet.confirm(
      spec.title === "Cancel Order" ? { ...spec, lines: [{ icon: "warning", text: SV_CANCEL_COPY }] }
        : spec.title === "Resume Order" || spec.title === "Undo Cancel" ? { ...spec, lines: spec.lines.map((l) => ({ ...l, text: l.text.replace(STATUS_CODE_RE, (m) => SV_STATUS_LABEL[m] ?? m) })) }
        : spec,
    ),
    info: setInfo,
    goDelivery: () => navigate("/m/delivery"),
    goInvoices: () => navigate("/m/invoices"),
    afterDelete: () => navigate(ORDERS_LIST, { replace: true }),
  });

  const back = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx;
    if (typeof idx === "number" && idx > 0) navigate(-1);
    else navigate(ORDERS_LIST);
  };
  const topBar = (title: string) => (
    <div style={{ position: "sticky", top: 0, zIndex: 40, background: "rgba(250,248,244,.95)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, height: HEADER_H, padding: "0 14px 0 12px", boxSizing: "border-box" }}>
        <BackBtn onClick={back} />
        <span style={{ fontSize: 18, fontWeight: 700, color: M.raisin }}>{title}</span>
      </div>
    </div>
  );

  if (!id) return <Msg icon={Unlink} text="No order selected" />;
  if (loading && !doc) {
    return (
      <>
        {topBar("Service order")}
        <div aria-busy="true" aria-label="Loading service order" style={{ display: "grid", gap: 14, padding: "8px 18px 40px", maxWidth: 720, margin: "0 auto" }}>
          <div style={{ ...SKEL, height: 190, borderRadius: 16 }} />
          <div style={{ ...SKEL, height: 34, borderRadius: 999 }} />
          <div style={{ ...SKEL, height: 150, borderRadius: 16 }} />
          <div style={{ ...SKEL, height: 200, borderRadius: 16 }} />
        </div>
      </>
    );
  }
  if (!doc && failure && failure.kind !== "notFound") {
    return (
      <>
        {topBar("Service order")}
        <Msg icon={CloudOff} tone="danger" text="Couldn’t load this service order" sub={isUnknownOutcome(failure) ? "Check your connection and try again. This does not mean the order is missing." : "Try again."} action={<Btn onClick={() => refresh()}>Try again</Btn>} />
      </>
    );
  }
  if (!doc) return <>{topBar("Service order")}<Msg icon={Unlink} text="Order not found" sub="It may have been deleted." action={<Btn kind="secondary" onClick={() => navigate(ORDERS_LIST)}>Back to Service Orders</Btn>} /></>;
  if (doc.isServiceOrder !== true) {
    return <>{topBar("Service order")}<Msg icon={Unlink} text="This is a regular sales order" action={<Btn kind="secondary" onClick={() => navigate(`/m/sales/${encodeURIComponent(docId)}`)}>Open sales order</Btn>} /></>;
  }

  const env = data as Envelope;
  const svNo = str(doc, "companySOId", "companySO") || docId;
  const items = rows(doc.items);
  const pos = rows(env.linkedPOs);
  const dos = rows(env.linkedDOs);
  const invoices = rows(env.linkedInvoices);
  const payments = rows(env.linkedPayments);
  const history = rows(env.statusHistory);
  const locks = soEditLocks(dos, invoices);
  const perms = {
    update: hasPermission("sales-orders", "update"),
    confirm: hasPermission("sales-orders", "confirm"),
    create: hasPermission("sales-orders", "create"),
    del: hasPermission("sales-orders", "delete"),
    deliveryCreate: hasPermission("delivery-orders", "create"),
    invoiceCreate: hasPermission("invoices", "create"),
    caseCreate: hasPermission("service-cases", "create"),
  };
  const plan = svActionPlan({ status, perms, eligibility: eligibility.data ?? null, lockReason: env.lockReason ?? null, locks });
  const jcByPo: Record<string, Row[]> = {};
  for (const p of jcRes.data?.data ?? []) jcByPo[str(p, "id")] = rows(p.jobCards);
  const prod = svProduction(pos, jcByPo);
  const totalQty = items.reduce((a, it) => a + num(it, "quantity"), 0);
  const overrides = rows(env.priceOverrides);
  const curDept = svCurrentDept(pos, jcByPo);
  const stageInfo = svStageInfo(status, history, svRestoreTarget(status, doc));
  const preLabel = stageInfo.pre ? SV_STATUS_LABEL[stageInfo.pre] ?? titleCase(stageInfo.pre) : "";
  const nextStatus = !stageInfo.off && !stageInfo.confirmed && stageInfo.index >= 0 ? SV_PATH[stageInfo.index + 1] : undefined;
  const stageLabel = stageInfo.off || stageInfo.confirmed || stageInfo.index < 0 ? SV_STATUS_LABEL[status] ?? titleCase(status) : `${stageInfo.index + 1} of ${SV_PATH.length} · ${SV_STATUS_LABEL[status] ?? titleCase(status)}`;
  const stageMeta = stageInfo.off ? (preLabel ? `Was ${preLabel}` : "") : stageInfo.confirmed ? "Production not started" : stageInfo.index < 0 ? "Outside the main path" : nextStatus ? `Next: ${SV_STATUS_LABEL[nextStatus]}` : "Complete";
  const statusList = statusEvents(history);
  const auditList = auditEvents(rows(audit.data?.data));
  const chain = svChain({ status, customerPO: str(doc, "customerPOId", "customerPO"), svNo, dos, invoices, payments, moneyFmt: money, titleCase });
  const busy = actions.busy;

  const run = (a: SvAction) => {
    const tap = svTapOutcome(a);
    if (tap.kind === "toast") return toast.show(tap.message, "error"); // keep the menu open and say why
    setMenuOpen(false);
    if (tap.kind === "lock-sheet") return setLockSheet(tap.message);
    switch (a.key) {
      case "confirm": return void actions.onConfirm();
      case "create-delivery": return actions.openIssueDo();
      case "generate-invoice": return actions.openGenerateInvoice();
      case "resume": return void actions.onResume();
      case "undo-cancel": return void actions.onUndoCancel();
      case "edit": return navigate(svEditPath(docId));
      case "hold": return actions.setHoldOpen(true);
      case "cancel": return void actions.onCancel();
      case "delete": return void actions.onDelete();
      case "clone": return navigate(`${SV_NEW_PATH}?clone=${encodeURIComponent(docId)}`);
      case "files": return setFilesOpen(true);
      case "change-customer": return actions.setCustomerOpen(true);
      case "change-hub": return actions.setHubOpen(true);
      case "open-case": return actions.setCaseOpen(true);
      case "pdf": return void downloadPdf();
    }
  };
  const downloadPdf = async () => {
    setPdfBusy(true);
    const found = await lookupBillTo(doc);
    if (found.state === "missing") { setPdfBusy(false); setBillTo(found); return; }
    const res = await downloadSoPdf(doc, found.address);
    setPdfBusy(false);
    if (!res.ok) toast.show(res.error, "error");
  };

  const p = plan.primary;
  const primaryIcon = p?.key === "confirm" ? <CircleCheck size={16} strokeWidth={2.1} /> : p?.key === "create-delivery" ? <Truck size={16} strokeWidth={2.1} /> : p?.key === "generate-invoice" ? <Receipt size={16} strokeWidth={2.1} /> : p?.key === "resume" ? <CirclePlay size={16} strokeWidth={2.1} /> : <Undo2 size={16} strokeWidth={2.1} />;
  const holdReason = str(doc, "holdReason");
  const menuSub = (a: SvAction): string => {
    if (a.lockedReason) return "Locked · tap to see why";
    if (a.reason) return a.reason;
    switch (a.key) {
      case "edit": return "Opens the edit form";
      case "hold": return "A reason is required";
      case "resume": return preLabel ? `Returns to ${preLabel}` : "Puts the order back in progress";
      case "cancel": return "Can be undone later";
      case "undo-cancel": return preLabel ? `Restores to ${preLabel}` : "Restores the order";
      case "change-customer": return "Pick another customer";
      case "change-hub": return "Pick another delivery hub";
      case "clone": return "New SV draft prefilled from this order";
      case "files": return "Files attached to this order";
      case "pdf": return "Built on this device";
      case "open-case": return "Report a new customer issue for this order";
      case "delete": return "Draft only · can’t be undone";
      default: return "";
    }
  };
  // Prototype banners: icon + bold lead ("On hold.") + text, stacked inside the header card, before the primary button.
  const banners: { icon: typeof Eye; bg: string; fg: string; title: string; text: string }[] = [];
  if (status === "ON_HOLD") banners.push({ icon: CirclePause, bg: CC.warnBg, fg: CC.warnFg, title: "On hold.", text: holdReason || "No reason recorded." });
  if (status === "CANCELLED") banners.push({ icon: Ban, bg: CC.errBg, fg: CC.dangerDark, title: "Cancelled.", text: "Undo cancel to make changes." });
  if (plan.editLock && !plan.viewOnly) banners.push({ icon: Lock, bg: "#F0ECE9", fg: "#4D4630", title: "Edits locked.", text: plan.editLock });
  if (plan.viewOnly) banners.push({ icon: Eye, bg: "#F0ECE9", fg: "#4D4630", title: "View only.", text: "Your role can’t change this order." });
  const tabCount = (k: TabKey) => (k === "items" ? items.length : k === "production" ? pos.length : k === "history" ? history.length : 0) || "";
  const cats = [...new Set(items.map((i) => str(i, "itemCategory")).filter(Boolean))].map(titleCase).join(" / ");

  return (
    <>
      <div style={{ position: "sticky", top: 0, zIndex: 40, background: "rgba(250,248,244,.95)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, height: HEADER_H, padding: "0 14px 0 12px", boxSizing: "border-box" }}>
          <BackBtn onClick={back} />
          <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ minWidth: 0, fontSize: 18, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontVariantNumeric: "tabular-nums" }}>{svNo}</span>
            <Pill label={SV_STATUS_LABEL[status] ?? titleCase(status)} tone={svTone(status)} dot={svTone(status).fg} />
          </div>
          <IconBtn label="More actions" onClick={() => setMenuOpen(true)}><Ellipsis size={20} strokeWidth={2} /></IconBtn>
        </div>
      </div>

      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <div style={{ padding: "2px 18px 0" }}>
          <Card>
            <div style={{ fontSize: 16, fontWeight: 700, color: M.raisin, lineHeight: 1.35, wordBreak: "break-word" }}>{str(doc, "customerName") || "—"}</div>
            <div style={{ fontSize: 12.5, color: M.ink, marginTop: 3 }}>
              {[str(doc, "salesOrgCode"), cats, fmtDMY(str(doc, "companySODate")) && `ordered ${fmtDMY(str(doc, "companySODate"))}`].filter(Boolean).join(" · ")}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
              {parentCase ? <button type="button" onClick={() => navigate(casePath(parentCase.id))} style={{ height: 26, boxSizing: "border-box", display: "inline-flex", alignItems: "center", gap: 5, padding: "0 9px", border: "none", borderRadius: 7, background: CC.tile, fontFamily: "inherit", fontSize: 11.5, color: M.ink, cursor: "pointer", whiteSpace: "nowrap" }}>
                <Wrench size={12} strokeWidth={2.2} color={CC.brown} /><span style={{ color: "#6B6252" }}>Case</span><span style={{ fontWeight: 700, color: M.raisin }}>{parentCase.no || "—"}</span><ArrowUpRight size={12} strokeWidth={2.2} color={CC.brown} />
              </button> : null}
              {str(doc, "customerPOId", "customerPO") ? <RefChip k="PO" v={str(doc, "customerPOId", "customerPO")} h={26} fs={11.5} /> : null}
              {str(doc, "customerSOId", "customerSO") ? <RefChip k="SO" v={str(doc, "customerSOId", "customerSO")} h={26} fs={11.5} /> : null}
            </div>
            {banners.map((b) => (
              <div key={b.title} role="note" style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 12, padding: "10px 12px", borderRadius: 12, background: b.bg, fontSize: 12.5, lineHeight: 1.45, color: "#3A352C" }}>
                <span style={{ display: "flex", marginTop: 1, flex: "none" }}><b.icon size={15} strokeWidth={2} color={b.fg} /></span>
                <span style={{ minWidth: 0, overflowWrap: "anywhere" }}><b style={{ color: M.raisin }}>{b.title}</b> {b.text}</span>
              </div>
            ))}
            {p ? (
              <div style={{ marginTop: 12 }}>
                <Btn full h={46} disabled={busy} icon={primaryIcon} onClick={() => run(p)}>{p.label}</Btn>
              </div>
            ) : null}
          </Card>
        </div>

        <div ref={tabsRef} role="tablist" aria-label="Order sections" style={{ position: "sticky", top: `calc(${HEADER_H}px + env(safe-area-inset-top, 0px))`, zIndex: 5, display: "flex", gap: 8, overflowX: "auto", padding: "12px 18px 10px", background: M.paper, scrollbarWidth: "none" }}>
          {TABS.map(([k, l]) => {
            const on = tab === k;
            return (
              <button key={k} type="button" role="tab" aria-selected={on} onClick={() => setTab(k)} style={{ flex: "none", height: 34, padding: "0 13px", borderRadius: 999, border: "none", background: on ? CC.brown : M.card, color: on ? "#FFFFFF" : CC.chipText, fontFamily: "inherit", fontSize: 12.5, fontWeight: on ? 700 : 600, cursor: "pointer", whiteSpace: "nowrap", boxShadow: on ? "0 6px 14px -6px rgba(107,92,50,.6)" : SH_CTRL, WebkitTapHighlightColor: "transparent" }}>
                {l}{tabCount(k) ? <span style={{ marginLeft: 6, fontVariantNumeric: "tabular-nums", opacity: 0.8 }}>{tabCount(k)}</span> : null}
              </button>
            );
          })}
        </div>

        <div style={{ padding: "4px 18px 40px", display: "grid", gridTemplateColumns: wide && tab === "overview" ? "repeat(2,minmax(0,1fr))" : "minmax(0,1fr)", gap: 14, alignItems: "start" }}>
          {tab === "overview" ? (
            <>
              <section aria-label="Order status" style={CARD15}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <Label flex>Operational overview</Label>
                  <span style={{ fontSize: 11.5, color: M.ink, whiteSpace: "nowrap" }}>Main path · not every status</span>
                </div>
                <div aria-hidden style={{ display: "grid", gridTemplateColumns: `repeat(${SV_PATH.length},minmax(0,1fr))`, gap: 3, marginTop: 12 }}>
                  {SV_PATH.map((st, i) => <span key={st} style={{ height: 6, borderRadius: 999, background: status === "CANCELLED" || stageInfo.index < 0 ? CC.track : i <= stageInfo.index ? (stageInfo.off ? "#C9A961" : CC.brown) : CC.track }} />)}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <Tag label={stageLabel} tone={svTone(status)} h={24} />
                  {stageMeta ? <span style={{ fontSize: 12.5, color: M.ink }}>{stageMeta}</span> : null}
                </div>
              </section>

              <button type="button" onClick={() => setTab("production")} aria-label="Production progress, open Production" style={{ ...CARD15, width: "100%", display: "block", border: "none", fontFamily: "inherit", textAlign: "left", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <Label flex>Production progress</Label>
                  <span style={{ fontSize: 11.5, color: M.ink, whiteSpace: "nowrap" }}>From job cards</span>
                  <ChevronRight size={16} strokeWidth={2} color={CC.brownSoft} style={{ alignSelf: "center" }} />
                </div>
                {prod.total === 0 ? (
                  <div style={{ fontSize: 13, color: M.ink, marginTop: 8 }}>{status === "DRAFT" ? "No production yet — production orders are created when the order is confirmed." : "No production orders linked."}</div>
                ) : (
                  <>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 10 }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: M.ink }}>{prod.done ? "All production orders completed" : curDept ? `At ${titleCase(curDept)}` : "Not started"}</span>
                      <span style={{ fontSize: 18, fontWeight: 700, color: prod.done ? DONE_FG : CC.brown, fontVariantNumeric: "tabular-nums" }}>{prod.done ? "Done" : `${prod.pct}%`}</span>
                    </div>
                    <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={prod.pct} aria-label="Production progress" style={{ height: 6, marginTop: 8, borderRadius: 999, background: CC.sep, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${prod.pct}%`, background: prod.done ? DONE_FG : CC.brown, borderRadius: 999 }} />
                    </div>
                    <div style={{ fontSize: 11.5, color: CC.hint, marginTop: 8 }}>{prod.total} production order{prod.total === 1 ? "" : "s"} · weighted by quantity · separate from order status</div>
                  </>
                )}
              </button>

              <section aria-label="Order information" style={{ ...CARD15, padding: "4px 15px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1px", color: CC.brown, padding: "12px 0 4px", textTransform: "uppercase" }}>Order information</div>
                <InfoRow k="Order date" v={fmtDate(str(doc, "companySODate"))} />
                <InfoRow k="Expected DD" v={fmtDate(str(doc, "hookkaExpectedDD"))} />
                <InfoRow k="Customer DD" v={fmtDate(str(doc, "customerDeliveryDate"))} />
                <InfoRow k="Company" v={str(doc, "salesOrgCode")} />
                <InfoRow k="Category" v={cats} />
                <InfoRow k="Customer PO" v={str(doc, "customerPOId", "customerPO")} />
                <InfoRow k="Customer SO" v={str(doc, "customerSOId", "customerSO")} />
                <InfoRow k="Reference" v={str(doc, "reference")} />
                <InfoRow k="Delivery hub" v={[str(doc, "hubName"), str(doc, "customerState")].filter(Boolean).join(" · ")} />
                <InfoRow k="Notes" v={str(doc, "notes").trim()} optional />
              </section>

              <section aria-label="Summary" style={CARD15}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1px", color: CC.brown, textTransform: "uppercase" }}>Summary</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", marginTop: 10 }}>
                  {([["Lines", String(items.length)], ["Total qty", String(totalQty)], ["Subtotal", money(num(doc, "subtotalSen"))]] as const).map(([k, v], i) => (
                    <div key={k} style={{ minWidth: 0, paddingLeft: i ? 12 : 0, borderLeft: i ? `1px solid ${CC.sep}` : "none" }}>
                      <div style={{ fontSize: 11.5, color: M.ink }}>{k}</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: M.raisin, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontVariantNumeric: "tabular-nums" }}>{v}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${CC.sep}` }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: M.raisin }}>Total</span>
                  <span style={{ fontSize: 20, fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums" }}>{money(num(doc, "totalSen"))}</span>
                </div>
                {num(doc, "totalSen") === 0 && items.length > 0 ? <div style={{ fontSize: 11.5, color: CC.hint, marginTop: 4 }}>No-charge service order — every line is {money(0)}.</div> : null}
              </section>
            </>
          ) : null}

          {tab === "items" ? (
            <>
              {items.length === 0 ? <EmptyCard>No items on this order.</EmptyCard> : null}
              {items.map((it, i) => {
                const scope = parseRepairScope(str(it, "repairScope", "repairscope") || null);
                const chips = specChips(it);
                const ov = overrideForLine(overrides, num(it, "lineNo") || i + 1);
                const editAct = plan.menu.find((m) => m.key === "edit");
                const comps = scope?.components ?? [];
                return (
                  <section key={str(it, "id") || i} style={{ ...CARD15, padding: "14px 15px" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14.5, fontWeight: 700, color: M.raisin, lineHeight: 1.35, wordBreak: "break-word" }}>{str(it, "productName", "productCode") || "Item"}</div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: CC.brown, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{str(it, "productCode")}</div>
                      </div>
                      <div style={{ flex: "none", textAlign: "right" }}>
                        <div style={{ fontSize: 14.5, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{money(num(it, "lineTotalSen"))}</div>
                        <div style={{ fontSize: 12, color: M.ink, marginTop: 2, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{num(it, "quantity")} × {money(num(it, "unitPriceSen"))}</div>
                      </div>
                    </div>
                    {str(it, "sizeLabel", "sizeCode") || str(it, "fabricCode") ? (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", marginTop: 8, fontSize: 12.5, color: M.ink }}>
                        {str(it, "sizeLabel", "sizeCode") ? <span>Size <b style={{ color: M.raisin, fontWeight: 600 }}>{str(it, "sizeLabel", "sizeCode")}</b></span> : null}
                        {str(it, "fabricCode") ? <span>Fabric <b style={{ color: M.raisin, fontWeight: 600 }}>{str(it, "fabricCode")}</b></span> : null}
                      </div>
                    ) : null}
                    {chips.length ? (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                        {chips.map((c) => <span key={c.key + c.text} style={{ height: 24, display: "inline-flex", alignItems: "center", padding: "0 9px", borderRadius: 8, background: CHIP_TONE[c.key].bg, color: CHIP_TONE[c.key].fg, fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap" }}>{c.text}</span>)}
                      </div>
                    ) : null}
                    <div style={{ marginTop: 12, padding: "11px 12px", borderRadius: 12, background: M.paper }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                        <span style={{ flex: 1, fontSize: 10.5, fontWeight: 700, letterSpacing: ".6px", color: CC.brown, textTransform: "uppercase" }}>Repair scope</span>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: M.raisin }}>{scope ? REPAIR_SCOPE_PRESET_LABELS[scope.preset] : REPAIR_SCOPE_PRESET_LABELS.FULL}</span>
                      </div>
                      {scope ? (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                          {scope.depts.map((d) => <span key={d} style={{ height: 24, display: "inline-flex", alignItems: "center", padding: "0 9px", borderRadius: 999, background: M.card, color: CC.chipText, fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap", boxShadow: "0 1px 2px rgba(31,29,27,.06)" }}>{REPAIR_DEPT_LABELS[d]}</span>)}
                        </div>
                      ) : null}
                      {comps.length ? (
                        <>
                          <div style={{ fontSize: 11.5, fontWeight: 700, color: M.ink, marginTop: 10 }}>Damaged components</div>
                          {comps.map((c) => (
                            <div key={c.key} style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 6, minWidth: 0 }}>
                              <span style={{ flex: 1, minWidth: 0 }}>
                                <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: M.raisin }}>{c.label || c.key}</span>
                                <span style={{ display: "block", fontSize: 11, color: CC.hint, overflowWrap: "anywhere" }}>{c.key}</span>
                              </span>
                              <span style={{ flex: "none", fontSize: 12.5, fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums" }}>× {c.qty}</span>
                            </div>
                          ))}
                        </>
                      ) : null}
                      <div style={{ fontSize: 11.5, color: CC.hint, marginTop: 8 }}>{comps.length ? "Only these components are rebuilt" : scope ? (scope.preset === "CUSTOM" ? "No component picks — all components in these departments" : "Preset departments · all components") : "No repair scope stored — every department, every component"}</div>
                    </div>
                    {ov ? (
                      <div role="note" style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10, padding: "9px 11px", borderRadius: 10, background: CC.warnBg, fontSize: 12.5, lineHeight: 1.45, color: CC.chipText }}>
                        <BadgePercent size={14} strokeWidth={2} color={CC.warnFg} style={{ flex: "none", marginTop: 2 }} />
                        <span style={{ minWidth: 0, wordBreak: "break-word" }}>Price overridden {money(num(ov, "originalPrice"))} → {money(num(ov, "overridePrice"))}{str(ov, "reason") ? ` · ${str(ov, "reason")}` : ""}{str(ov, "approvedBy") ? ` · approved by ${str(ov, "approvedBy")}` : ""}</span>
                      </div>
                    ) : null}
                    {str(it, "notes") ? <div style={{ fontSize: 12.5, color: M.ink, marginTop: 10, whiteSpace: "pre-wrap" }}>{str(it, "notes")}</div> : null}
                    {editAct ? (
                      <button type="button" onClick={() => run(editAct)} style={{ marginTop: 12, height: 40, padding: "0 13px", border: "none", borderRadius: 11, background: CC.tile, color: CC.brown, fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                        {editAct.lockedReason ? <Lock size={15} strokeWidth={2} /> : <Pencil size={15} strokeWidth={2} />}Edit item
                      </button>
                    ) : null}
                  </section>
                );
              })}
            </>
          ) : null}

          {tab === "production" ? (
            <>
              {pos.length === 0 ? (
                <div style={{ ...CARD15, padding: "22px 16px", textAlign: "center" }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: M.raisin }}>No production orders yet</div>
                  <div style={{ fontSize: 12.5, lineHeight: 1.5, color: M.ink, marginTop: 4 }}>{status === "DRAFT" ? "They’re created for every line when the order is confirmed." : "This order has no linked production orders."}</div>
                </div>
              ) : null}
              {pos.map((po) => {
                const pid = str(po, "id");
                const ps = str(po, "status").toUpperCase();
                const jcs = [...(jcByPo[pid] ?? [])].sort((a, b) => num(a, "sequence") - num(b, "sequence"));
                const pct = Math.round((prod.perPo[pid] ?? (ps === "COMPLETED" ? 1 : 0)) * 100);
                const open = !!expanded[pid];
                const dept = str(po, "currentDepartment") ? titleCase(str(po, "currentDepartment")) : "";
                const where = ps === "COMPLETED" ? "All departments done" : ps === "CANCELLED" ? "Cancelled" : ps === "PENDING" ? (dept ? `Waiting at ${dept}` : "Waiting") : dept ? `At ${dept}` : "In progress";
                const col = ps === "COMPLETED" ? DONE_FG : ps === "ON_HOLD" || ps === "PAUSED" ? CC.warnFg : CC.brown;
                return (
                  <section key={pid} style={{ ...CARD15, padding: 0, overflow: "hidden" }}>
                    <button type="button" onClick={() => setExpanded((x) => ({ ...x, [pid]: !x[pid] }))} aria-expanded={open} style={{ width: "100%", display: "block", padding: "14px 15px", border: "none", background: "none", fontFamily: "inherit", textAlign: "left", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontVariantNumeric: "tabular-nums" }}>{str(po, "poNo")}</span>
                        <Pill label={titleCase(str(po, "status"))} tone={poTone(str(po, "status"))} />
                        <span style={{ display: "flex", color: CC.brownSoft, transform: open ? "rotate(180deg)" : "none" }}><ChevronDown size={17} strokeWidth={2} /></span>
                      </div>
                      <div style={{ fontSize: 12.5, color: M.ink, marginTop: 3 }}>{[str(po, "productName"), `qty ${num(po, "quantity")}`].filter(Boolean).join(" · ")}</div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 10 }}>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: M.ink }}>{where}</span>
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: col, fontVariantNumeric: "tabular-nums" }}>{ps === "COMPLETED" ? "Done" : `${pct}%`}</span>
                      </div>
                      <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${str(po, "poNo")} progress`} style={{ height: 6, marginTop: 6, borderRadius: 999, background: CC.sep, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${pct}%`, background: col, borderRadius: 999 }} />
                      </div>
                    </button>
                    {open ? (
                      <div style={{ padding: "0 15px 14px" }}>
                        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".6px", color: CC.brown, paddingTop: 10, borderTop: `1px solid ${CC.sep}` }}>DEPARTMENTS</div>
                        {jcs.length === 0 ? <div style={{ fontSize: 12, color: CC.hint, marginTop: 6 }}>{jcRes.loading ? "Loading job cards…" : "No job card detail"}</div> : jcs.map((j, ji) => {
                          const js = str(j, "status").toUpperCase();
                          const doneJ = js === "COMPLETED";
                          const cur = js === "IN_PROGRESS";
                          const code = str(j, "departmentCode");
                          const nm = str(j, "departmentName") || REPAIR_DEPT_LABELS[code as keyof typeof REPAIR_DEPT_LABELS] || titleCase(code);
                          return (
                            <div key={str(j, "id") || ji} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 36 }}>
                              <span style={{ width: 10, height: 10, flex: "none", boxSizing: "border-box", borderRadius: "50%", background: doneJ ? DONE_FG : cur ? CC.brown : M.card, border: `2px solid ${doneJ ? DONE_FG : cur ? CC.brown : CC.track}` }} />
                              <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: cur ? 700 : 600, color: M.raisin }}>{nm}</span>
                              <span style={{ fontSize: 12, color: doneJ ? DONE_FG : cur ? CC.brown : M.ink, whiteSpace: "nowrap" }}>{doneJ ? (str(j, "completedDate") ? `Done · ${fmtDate(str(j, "completedDate"))}` : "Done") : titleCase(js || "Waiting")}</span>
                            </div>
                          );
                        })}
                        {ps === "COMPLETED" ? <div style={{ fontSize: 11.5, color: CC.hint, marginTop: 6 }}>Completed work can’t be changed.{str(po, "completedDate") ? ` Completed ${fmtDate(str(po, "completedDate"))}.` : ""}</div> : null}
                        {str(po, "deliveryDoNo") ? <div style={{ fontSize: 11.5, color: M.ink, marginTop: 6 }}>Delivery {str(po, "deliveryDoNo")}{str(po, "deliveryStatus") ? ` · ${titleCase(str(po, "deliveryStatus"))}` : ""}</div> : null}
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </>
          ) : null}

          {tab === "fulfilment" ? (
            <>
              <section aria-label="Document relationship" style={{ ...CARD15, padding: "6px 15px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1px", color: CC.brown, padding: "10px 0 2px" }}>DOCUMENT FLOW</div>
                <ol style={{ listStyle: "none", margin: 0, padding: "6px 0 4px" }}>
                  {chain.map((nd, i, arr) => {
                    const lc = nd.state === "pending" ? M.ink : nd.state === "linked" ? DONE_FG : CC.brown;
                    return (
                      <li key={nd.key} style={{ position: "relative" }}>
                        {i < arr.length - 1 ? <span aria-hidden style={{ position: "absolute", left: 11, top: 34, bottom: -6, width: 2, borderRadius: 2, background: arr[i + 1].state === "pending" ? "#E6E0D9" : "#B9D3B9" }} /> : null}
                        <button type="button" disabled={!nd.href} onClick={nd.href ? () => navigate(nd.href!) : undefined} aria-label={`${nd.label}: ${nd.value}, ${nd.sub}`} style={{ position: "relative", width: "100%", display: "flex", alignItems: "center", gap: 12, minHeight: 56, padding: "6px 0", background: "none", border: "none", fontFamily: "inherit", textAlign: "left", cursor: nd.href ? "pointer" : "default" }}>
                          <span aria-hidden style={{ width: 24, height: 24, flex: "none", boxSizing: "border-box", borderRadius: "50%", background: nd.state === "linked" ? DONE_FG : nd.state === "current" ? CC.brown : M.card, border: nd.state === "pending" ? "1.5px dashed #A8A196" : "none", color: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            {nd.state === "linked" ? <Check size={13} strokeWidth={3} /> : nd.state === "current" ? <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#FFFFFF" }} /> : null}
                          </span>
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ display: "block", fontSize: 11, fontWeight: 700, letterSpacing: ".8px", textTransform: "uppercase", color: lc }}>{nd.label}</span>
                            <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: nd.state === "pending" ? M.ink : M.raisin, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontVariantNumeric: "tabular-nums" }}>{nd.value}</span>
                            <span style={{ display: "block", fontSize: 12, color: M.ink, marginTop: 1 }}>{nd.sub}</span>
                          </span>
                          {nd.href ? <ChevronRight size={17} strokeWidth={1.9} color={CC.brownSoft} /> : null}
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </section>
              {p && (p.key === "create-delivery" || p.key === "generate-invoice") ? <Btn full h={46} disabled={busy} icon={primaryIcon} onClick={() => run(p)}>{p.label}</Btn> : null}
              <div style={{ fontSize: 11.5, lineHeight: 1.45, color: CC.hint, textAlign: "center" }}>Only documents linked to this order are shown.</div>
            </>
          ) : null}

          {tab === "history" ? (
            <>
              <section aria-label="Status history" style={{ ...CARD15, padding: "14px 15px 4px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1px", color: CC.brown }}>STATUS HISTORY</div>
                {statusList.length === 0 ? <div style={{ fontSize: 13, color: M.ink, padding: "10px 0 12px" }}>No status changes recorded.</div> : (
                  <ol style={{ listStyle: "none", margin: "12px 0 0", padding: 0 }}>
                    {statusList.map((e, i, arr) => {
                      const ft = svTone(e.from), tt = svTone(e.to);
                      return (
                        <li key={e.key} style={{ position: "relative", display: "flex", gap: 12, paddingBottom: 14 }}>
                          {i < arr.length - 1 ? <span aria-hidden style={{ position: "absolute", left: 6, top: 16, bottom: 0, width: 2, background: CC.trackMap }} /> : null}
                          <span aria-hidden style={{ position: "relative", width: 14, height: 14, flex: "none", boxSizing: "border-box", borderRadius: "50%", marginTop: 3, background: i ? M.card : tt.fg, border: `3px solid ${tt.fg}` }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                              {e.from ? <><Pill label={SV_STATUS_LABEL[e.from] ?? titleCase(e.from)} tone={ft} /><ArrowRight size={13} strokeWidth={2} color={CC.brownSoft} /></> : null}
                              <Pill label={SV_STATUS_LABEL[e.to] ?? titleCase(e.to)} tone={tt} />
                            </div>
                            {e.note ? <div style={{ fontSize: 12.5, lineHeight: 1.45, color: CC.chipText, marginTop: 5, overflowWrap: "anywhere" }}>{e.note}</div> : null}
                            {e.autoActions.length ? <div style={{ fontSize: 12, color: M.ink, marginTop: 4 }}>{e.autoActions.join(" · ")}</div> : null}
                            <div style={{ fontSize: 12, color: M.ink, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{[fmtDate(e.at), e.by].filter(Boolean).join(" · ")}</div>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>
              {overrides.length ? (
                <section aria-label="Price override history" style={CARD15}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1px", color: CC.brown }}>PRICE OVERRIDE HISTORY</div>
                  {overrides.map((v, i) => (
                    <div key={str(v, "id") || i} style={{ marginTop: 10, padding: "10px 12px", borderRadius: 12, background: M.paper }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: M.raisin }}>Line {num(v, "lineIndex") + 1}</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: CC.warnFg, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{money(num(v, "originalPrice"))} → {money(num(v, "overridePrice"))}</span>
                      </div>
                      {str(v, "reason") ? <div style={{ fontSize: 12.5, color: CC.chipText, marginTop: 4 }}>{str(v, "reason")}</div> : null}
                      <div style={{ fontSize: 12, color: M.ink, marginTop: 3 }}>{[str(v, "approvedBy") && `Approved by ${str(v, "approvedBy")}`, fmtDate(str(v, "timestamp"))].filter(Boolean).join(" · ")}</div>
                    </div>
                  ))}
                </section>
              ) : null}
              <section aria-label="Audit history" style={{ ...CARD15, padding: "4px 15px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1px", color: CC.brown, padding: "12px 0 4px" }}>AUDIT HISTORY</div>
                {audit.loading && !audit.data ? <div style={{ fontSize: 13, color: M.ink, padding: "6px 0 12px" }}>Loading…</div> : audit.error && !audit.data ? <div style={{ fontSize: 13, color: M.ink, padding: "6px 0 12px" }}>Couldn’t load the audit trail.</div> : auditList.length === 0 ? <div style={{ fontSize: 13, color: M.ink, padding: "6px 0 12px" }}>No audit events.</div> : auditList.map((e) => (
                  <div key={e.key} style={{ padding: "10px 0", borderTop: `1px solid ${CC.sep}` }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: M.raisin }}>{e.title}</div>
                    {e.fields.length ? <div style={{ fontSize: 12.5, color: CC.chipText, marginTop: 2 }}>Changed: {e.fields.join(", ")}</div> : null}
                    <div style={{ fontSize: 12, color: M.ink, marginTop: 2 }}>{[fmtDateTime(e.at), e.by].filter(Boolean).join(" · ")}</div>
                  </div>
                ))}
              </section>
            </>
          ) : null}
        </div>
      </div>

      {/* ⋯ menu */}
      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title={svNo}>
        <div style={{ fontSize: 12, color: M.ink, margin: "-2px 0 10px" }}>{[SV_STATUS_LABEL[status] ?? titleCase(status), str(doc, "customerName")].filter(Boolean).join(" · ")}</div>
        <div style={{ background: M.card, borderRadius: 16, overflow: "hidden", boxShadow: SH_CARD }}>
          {plan.menu.map((a, i) => (
            <button key={a.key} type="button" aria-disabled={a.disabled || (a.key === "pdf" && pdfBusy)} onClick={() => run(a)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, minHeight: 56, padding: "8px 15px", border: "none", borderTop: i ? `1px solid ${CC.sep}` : "none", background: "none", fontFamily: "inherit", textAlign: "left", cursor: a.disabled ? "default" : "pointer", opacity: a.disabled ? 0.55 : 1, WebkitTapHighlightColor: "transparent" }}>
              <IconTile icon={menuIcon(a.key)} size={34} r={10} bg={a.danger ? CC.errBg : CC.tile} fg={a.danger ? CC.dangerDark : CC.brown} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: a.danger ? CC.dangerDark : M.raisin }}>{a.key === "pdf" && pdfBusy ? "Preparing PDF…" : a.label}</span>
                <span style={{ display: "block", fontSize: 12, color: M.ink, marginTop: 2, lineHeight: 1.35, overflowWrap: "anywhere" }}>{menuSub(a)}</span>
              </span>
            </button>
          ))}
        </div>
        <div style={{ height: 16 }} />
      </Sheet>

      <Sheet open={lockSheet != null} onClose={() => setLockSheet(null)} title="Editing is locked">
        <div style={{ fontSize: 12, color: M.ink, margin: "-2px 0 10px" }}>{svNo}</div>
        <div style={{ fontSize: 13.5, lineHeight: 1.5, color: M.raisin, overflowWrap: "anywhere" }}>{lockSheet}</div>
        <div style={{ marginTop: 16 }}><Btn full kind="secondary" onClick={() => setLockSheet(null)}>OK</Btn></div>
      </Sheet>

      <Sheet open={filesOpen} onClose={() => setFilesOpen(false)} title="Files">
        <div style={{ fontSize: 12, color: M.ink, margin: "-2px 0 10px" }}>{svNo}</div>
        {files.loading && !files.data ? <div style={{ fontSize: 13, color: M.ink }}>Loading…</div> : rows(files.data?.data).length === 0 ? <div style={{ fontSize: 13, color: M.ink }}>No files attached to this order.</div> : (
          <div style={{ background: M.card, borderRadius: 16, overflow: "hidden", boxShadow: SH_CARD }}>
            {rows(files.data?.data).map((f, i) => (
              <a key={str(f, "id") || i} href={`/api/files/${encodeURIComponent(str(f, "id"))}/download?inline=1`} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 52, padding: "0 15px", borderTop: i ? `1px solid ${CC.sep}` : "none", textDecoration: "none", color: M.raisin }}>
                <IconTile icon={FileText} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, overflowWrap: "anywhere" }}>{str(f, "filename") || "File"}</span>
              </a>
            ))}
          </div>
        )}
        <div style={{ height: 16 }} />
      </Sheet>

      <Sheet open={billTo != null} onClose={() => setBillTo(null)} title="Bill To address missing">
        <div style={{ fontSize: 13.5, color: M.raisin }}>{billTo ? BILL_TO_MESSAGE[billTo.reason] : ""}</div>
        <div style={{ fontSize: 12, color: M.ink, marginTop: 6 }}>You can download the PDF without it, or cancel and fix the customer first.</div>
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <Btn kind="secondary" full onClick={() => setBillTo(null)}>Cancel</Btn>
          <Btn full onClick={async () => { setBillTo(null); setPdfBusy(true); const r = await downloadSoPdf(doc, ""); setPdfBusy(false); if (!r.ok) toast.show(r.error, "error"); }}>Download anyway</Btn>
        </div>
        <div style={{ height: 8 }} />
      </Sheet>

      <HoldSheet open={actions.holdOpen} busy={busy} onClose={() => actions.setHoldOpen(false)} onSubmit={(r) => void actions.submitHold(r)} />
      <InfoSheet info={info} onClose={() => setInfo(null)} />
      <CustomerChangeSheet open={actions.customerOpen} orderId={docId} currentCustomerId={str(doc, "customerId")} onClose={() => actions.setCustomerOpen(false)} onSaved={(msg) => { actions.setCustomerOpen(false); actions.reload(); toast.show(msg, "success"); }} />
      <HubChangeSheet open={actions.hubOpen} orderId={docId} customerId={str(doc, "customerId")} currentHubId={str(doc, "hubId")} onClose={() => actions.setHubOpen(false)} onSaved={(msg, warnings) => { actions.setHubOpen(false); actions.reload(); toast.show(msg, "success"); for (const w of warnings) toast.show(w, "error"); }} />
      <QuickReport open={actions.caseOpen} preset={{ sourceType: "SO", sourceId: docId, sourceNo: svNo, customerName: str(doc, "customerName") }} onClose={() => actions.setCaseOpen(false)} onCreated={(caseId) => { actions.setCaseOpen(false); toast.show("Service case opened", "success"); navigate(casePath(caseId)); }} />
      {confirmSheet.node}
      {toast.node}
    </>
  );
}

function BackBtn({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="Back" style={{ width: 44, height: 44, marginLeft: -10, background: "none", border: "none", padding: 0, flex: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: M.raisin }}>
      <ChevronLeft size={24} strokeWidth={1.9} />
    </button>
  );
}

function Label({ children, flex }: { children: ReactNode; flex?: boolean }) {
  return <div style={{ flex: flex ? 1 : undefined, minWidth: 0, fontSize: 11, fontWeight: 700, letterSpacing: "1px", color: CC.brown, textTransform: "uppercase" }}>{children}</div>;
}

/** Order-information row: a missing value shows "—" (as the prototype) unless the row is `optional`. */
function InfoRow({ k, v, optional }: { k: string; v: string; optional?: boolean }) {
  if (!v && optional) return null;
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 12, minHeight: 40, padding: "9px 0", boxSizing: "border-box", borderTop: `1px solid ${CC.sep}` }}>
      <span style={{ flex: "none", width: 110, fontSize: 12.5, color: M.ink }}>{k}</span>
      <span style={{ flex: 1, minWidth: 0, textAlign: "right", fontSize: 13.5, fontWeight: 600, color: v ? M.raisin : CC.hint, overflowWrap: "anywhere", fontVariantNumeric: "tabular-nums", whiteSpace: "pre-wrap" }}>{v || "—"}</span>
    </div>
  );
}

const PO_TONE: Record<string, { bg: string; fg: string }> = {
  COMPLETED: { bg: "#DCEBDC", fg: "#3A6B3A" }, IN_PROGRESS: { bg: "#E0EAF4", fg: "#3A5670" }, ON_HOLD: { bg: "#FAEFCB", fg: "#85600F" },
  PAUSED: { bg: "#FAEFCB", fg: "#85600F" }, CANCELLED: { bg: "#F5DCDC", fg: "#7A2E24" }, PENDING: { bg: "#E2DDD8", fg: "#5A5550" },
};
const poTone = (st: string) => PO_TONE[st.toUpperCase()] ?? PO_TONE.PENDING;

function menuIcon(k: SvAction["key"]) {
  switch (k) {
    case "edit": case "change-customer": case "change-hub": return Pencil;
    case "hold": return CirclePause;
    case "resume": return CirclePlay;
    case "cancel": return Ban;
    case "undo-cancel": return Undo2;
    case "clone": return Copy;
    case "files": return Paperclip;
    case "pdf": return Download;
    case "open-case": return Wrench;
    case "delete": return Trash2;
    case "confirm": return CircleCheck;
    case "create-delivery": return Truck;
    case "generate-invoice": return Receipt;
    default: return Package;
  }
}
