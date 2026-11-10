// ===========================================================================
// LegacyOrderDetail — Legacy Repair Order (table service_orders) detail at
// /m/serviceorders/:id. Header card with ONE primary action, pills Overview · Affected items ·
// Returns, ⋯ menu, resolution-mode sheet, log-return form and confirmations.
//
// Rules come from the backend / desktop (see legacy-logic.ts), not from the prototype:
//   • status moves through PUT /:id/status; the server re-validates and its 409 text is shown
//   • no "returns must be repaired first" gate exists, so none is added
//   • the parent Service Case is read-only navigation: nothing here updates, closes or cancels it
//   • Stock swap and Scrap are TEMPORARILY UNAVAILABLE on mobile (FG batch id mismatch): shown
//     disabled, never sent
// ===========================================================================
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowUpRight, Ban, Check, ChevronLeft, CircleCheck, CircleHelp, Ellipsis, Eye, Hourglass, Info, Lock, PackageCheck, PackageOpen, Plus, RefreshCw, Route, Trash2, Truck, Undo2, Unlink, Wrench } from "lucide-react";
import { isUnknownOutcome, useCachedJson } from "@/lib/cached-fetch";
import { getCurrentUser } from "@/lib/auth";
import { usePermissions } from "@/lib/use-permission";
import { RecordLoadError } from "@/components/ui/record-load-error";
import { MobileHeader } from "../../components";
import { useResponsiveLayout } from "../../lib/responsive-layout";
import { M } from "../../theme";
import { mutateJson, refreshList, refreshOne, type MutateResult } from "../../config/mutate";
import { CC, SH_CARD } from "../cases/case-style";
import { Btn, Chip, IconBtn, Msg, Note, Pill, RefChip } from "../cases/case-ui";
import { useCaseToast } from "../cases/case-hooks";
import { LEGACY_MODE_LABEL, LEGACY_STATUS_LABEL, RETURN_CONDITION_LABEL, SCRAP_UNAVAILABLE_NOTE, casePath, fmtDM, fmtDMY, legacyTone } from "./order-model";
import {
  CONFLICT_COPY, LEGACY_LIST_PATH, approvalStateFromMessage, conflictText, canCancel, canLogReturn, cancelSubline, classifyConflict, confirmCopy, logReturnBody,
  markRepairedBody, modeConfirmCopy, normalizeLegacyOrder, pathIndex, primaryAction, repairPath, returnActions, undoTarget,
  type ConfirmCopy, type LegacyOrder, type LegacyReturn, type PrimaryAction, type ReturnForm,
} from "./legacy-logic";
import { LegacyConfirm, LegacyInfoSheet, LegacyMenuSheet, LegacyModeSheet, LegacyReturnSheet, type InfoState, type MenuItem } from "./legacy-sheets";

type Tab = "overview" | "items" | "returns";
type Confirm =
  | { kind: "STATUS"; to: "READY_TO_SHIP" | "DELIVERED" | "CLOSED" | "CANCELLED" | string; copy: ConfirmCopy }
  | { kind: "MODE"; mode: "REPRODUCE" | "REPAIR"; copy: ConfirmCopy }
  | { kind: "REPAIRED"; ret: LegacyReturn; copy: ConfirmCopy };
type Sheet = "menu" | "mode" | "return" | null;

const HEADER_H = 52;

export function LegacyOrderDetail() {
  const { id = "" } = useParams();
  // Keyed so switching orders (tablet split view / deep link) starts clean.
  return <DetailInner key={id} id={id} />;
}

function DetailInner({ id }: { id: string }) {
  const navigate = useNavigate();
  // Keep the family in the URL so the tablet split view's left pane (ServiceOrdersScreen reads ?fam=) stays on
  // Legacy. A bare deep link (/m/serviceorders/<id>) is fixed up in place (replace: no extra history entry).
  const [sp, setSp] = useSearchParams();
  useEffect(() => {
    if (sp.get("fam") === "legacy") return;
    const next = new URLSearchParams(sp);
    next.set("fam", "legacy");
    setSp(next, { replace: true });
  }, [sp, setSp]);
  const { mode: layout } = useResponsiveLayout();
  const tablet = layout !== "phone";
  const { hasPermission } = usePermissions();
  const perms = { create: hasPermission("service-orders", "create"), update: hasPermission("service-orders", "update") };
  const viewOnly = !perms.create && !perms.update;
  const toast = useCaseToast();

  const url = id ? `/api/service-orders/${encodeURIComponent(id)}` : null;
  const { data, loading, failure, refresh } = useCachedJson<{ data?: Record<string, unknown> }>(url);
  const order = useMemo(() => (data?.data ? normalizeLegacyOrder(data.data) : null), [data]);

  // Case number + pending-approval lookup (read-only; either may legitimately 403/404 — then we just omit them).
  const { data: caseData } = useCachedJson<{ data?: { caseNo?: string } }>(order?.caseId ? `/api/service-cases/${encodeURIComponent(order.caseId)}` : null);
  const caseNo = caseData?.data?.caseNo ?? "";
  const needsApprovalLookup = !!order && order.status === "OPEN" && !order.mode;
  const { data: pendingData } = useCachedJson<{ data?: { id?: string; kind?: string }[] }>(needsApprovalLookup ? "/api/service-cases/approvals" : null);
  const pendingOnCase = !!order && (Array.isArray(pendingData?.data) ? pendingData.data : []).some((a) => a.id === order.caseId && (!a.kind || a.kind === "EXCHANGE"));
  // The case payload carries no approval state, so what a 409 told us in this session is remembered too.
  const [hint, setHint] = useState<"PENDING" | "REJECTED" | null>(null);
  const approval: "PENDING" | "REJECTED" | null = hint ?? (pendingOnCase ? "PENDING" : null);

  const [tab, setTab] = useState<Tab>("overview");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [info, setInfo] = useState<InfoState | null>(null);
  const [busy, setBusy] = useState(false);
  const [retErr, setRetErr] = useState("");

  const back = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx;
    if (typeof idx === "number" && idx > 0) navigate(-1); else navigate(LEGACY_LIST_PATH);
  };

  if (!id) return <Msg icon={Unlink} text="No repair order selected" />;
  if (!order && failure?.status === 403) {
    return (<><MobileHeader title="Repair order" onBack={back} /><Msg icon={Ban} tone="danger" text="Not allowed" sub={failure.message || "Your role can’t open this repair order."} /></>);
  }
  if (loading && !order) {
    return (<><MobileHeader title="Repair order" onBack={back} /><div style={{ padding: "8px 18px" }} aria-busy="true"><div style={{ height: 180, borderRadius: 16, background: "#EFEAE1" }} /></div></>);
  }
  // A timeout / network / 5xx proves nothing about the record; only the server's 404 means it is absent.
  if (!order && failure && isUnknownOutcome(failure)) {
    return (<><MobileHeader title="Repair order" onBack={back} /><RecordLoadError subject="repair order" failure={failure} onRetry={refresh} backTo={LEGACY_LIST_PATH} backLabel="Service Orders" /></>);
  }
  if (!order) {
    return (<><MobileHeader title="Repair order" onBack={back} /><Msg icon={Unlink} text={failure?.kind === "notFound" ? "Repair order not found" : "Loading…"} /></>);
  }

  const o = order;
  const tone = legacyTone(o.status);
  const primary = primaryAction(o, perms);
  const logOk = canLogReturn(o, perms);
  const cancelOk = canCancel(o, perms);
  const sourceHref = o.sourceType === "SO" && o.sourceId ? `/m/sales/${encodeURIComponent(o.sourceId)}` : null;
  const user = getCurrentUser();
  const actor = { id: user?.id ?? null, name: user?.displayName ?? user?.email ?? null };

  const reload = (extra: string[] = []) => {
    refreshOne(url ?? "");
    refreshList("/api/service-orders", "/api/service-cases", ...extra);
    refresh();
  };
  const failWith = (r: MutateResult, fallback: string) => {
    const text = r.error || fallback;
    const kind = classifyConflict(r.status, text);
    if (kind === "approval") setHint(approvalStateFromMessage(text) ?? "PENDING");
    if (kind === "transition") reload();
    const c = CONFLICT_COPY[kind];
    setInfo({
      title: c.title,
      text: conflictText(kind, text),
      icon: kind === "transition" ? "refresh" : kind === "stock" ? "stock" : kind === "approval" ? "warn" : "warn",
      warn: kind === "approval" || kind === "transition",
    });
  };

  const ask = (c: Confirm) => { setSheet(null); setConfirm(c); };
  const askStatus = (kind: "READY_TO_SHIP" | "DELIVERED" | "CLOSED" | "CANCEL" | "UNDO") =>
    ask({ kind: "STATUS", to: kind === "CANCEL" ? "CANCELLED" : kind === "UNDO" ? undoTarget(o) : kind, copy: confirmCopy(kind, o, caseNo) });
  const onPrimary = (a: PrimaryAction) => {
    if (a.kind === "choose-mode") setSheet("mode");
    else if (a.kind === "log-return") { setRetErr(""); setSheet("return"); }
    else if (a.kind === "undo-cancel") askStatus("UNDO");
    else askStatus(a.to);
  };

  const go = async () => {
    const c = confirm;
    if (!c || busy) return;
    setBusy(true);
    if (c.kind === "STATUS") {
      const r = await mutateJson(`/api/service-orders/${encodeURIComponent(o.id)}/status`, "PUT", { status: c.to });
      setBusy(false); setConfirm(null);
      if (!r.ok) return failWith(r, "Status update failed. Nothing changed.");
      reload(c.to === "CANCELLED" || o.status === "CANCELLED" ? ["/api/production-orders", "/api/inventory"] : []);
      toast.show(`${o.no} → ${LEGACY_STATUS_LABEL[c.to] ?? c.to}`);
    } else if (c.kind === "MODE") {
      const r = await mutateJson(`/api/service-orders/${encodeURIComponent(o.id)}/mode`, "PUT", { mode: c.mode });
      setBusy(false); setConfirm(null);
      if (!r.ok) return failWith(r, "Couldn’t set the resolution mode. Nothing changed.");
      setHint(null);
      reload(["/api/production-orders"]);
      toast.show(c.mode === "REPAIR" ? "Mode set to Repair" : "Reproduction started");
    } else {
      const r = await mutateJson(`/api/service-orders/${encodeURIComponent(o.id)}/returns/${encodeURIComponent(c.ret.id)}`, "PUT", markRepairedBody(actor, new Date().toISOString()));
      setBusy(false); setConfirm(null);
      if (!r.ok) return failWith(r, "Couldn’t record the repair. Nothing changed.");
      reload();
      toast.show("Repair recorded");
    }
  };

  const saveReturn = async (f: ReturnForm) => {
    if (busy) return;
    setBusy(true); setRetErr("");
    const r = await mutateJson(`/api/service-orders/${encodeURIComponent(o.id)}/returns`, "POST", logReturnBody(f, o.lines, actor));
    setBusy(false);
    if (!r.ok) { setRetErr(r.error || `Couldn’t record the returned unit (HTTP ${r.status}). Nothing was created.`); return; }
    const auto = o.status === "OPEN" && o.mode === "REPAIR" && o.returns.length === 0;
    setSheet(null);
    reload();
    setTab("returns");
    toast.show(auto ? "Return logged · now In repair" : "Return logged");
  };

  const menu: MenuItem[] = [
    ...(o.caseId ? [{ key: "case", label: "Open parent case", sub: caseNo || "Service case", icon: Wrench, onTap: () => { setSheet(null); navigate(casePath(o.caseId)); } }] : []),
    { key: "ret", label: "Log return", sub: "Record a defective unit sent back", icon: PackageOpen, disabled: !logOk, onTap: () => { setRetErr(""); setSheet("return"); } },
    ...(["OPEN", "IN_PRODUCTION", "RESERVED", "IN_REPAIR"].includes(o.status) ? [{ key: "cancel", label: "Cancel order", sub: cancelSubline(o.mode), icon: Ban, danger: true, disabled: !cancelOk, onTap: () => askStatus("CANCEL") }] : []),
    { key: "refresh", label: "Refresh", sub: "Reload this order", icon: RefreshCw, onTap: () => { setSheet(null); reload(); } },
  ];

  const banners: { key: string; icon: typeof Info; bg: string; fg: string; title: string; text: string }[] = [];
  if (viewOnly) banners.push({ key: "ro", icon: Eye, bg: CC.sep, fg: M.ink, title: "View only.", text: "You can review this repair order but not change it." });
  if (o.status === "OPEN" && !o.mode) banners.push({ key: "mode", icon: CircleHelp, bg: CC.warnBg, fg: CC.warnFg, title: "Mode pending.", text: "Choose Reproduce, Stock swap or Repair." });
  if (o.status === "OPEN" && !o.mode && approval === "PENDING") banners.push({ key: "ap", icon: Hourglass, bg: CC.warnBg, fg: CC.warnFg, title: "Exchange approval pending", text: `on ${caseNo || "the parent case"}. Reproduce and Stock swap wait for it; Repair does not.` });
  if (o.status === "OPEN" && !o.mode && approval === "REJECTED") banners.push({ key: "ar", icon: Ban, bg: "#F9E1DA", fg: CC.danger, title: "Exchange approval rejected.", text: "Repair is still possible." });
  if (o.status === "CANCELLED") banners.push({ key: "x", icon: Ban, bg: "#F9E1DA", fg: CC.danger, title: "Cancelled.", text: `Was ${LEGACY_STATUS_LABEL[o.preCancelStatus || "OPEN"] ?? "Open"}.` });
  if (o.status === "CLOSED") banners.push({ key: "c", icon: Lock, bg: CC.sep, fg: M.ink, title: "Closed.", text: "It can’t be reopened." });

  const PRIMARY_UI: Record<PrimaryAction["kind"], { label: string; icon: typeof Route }> = {
    "choose-mode": { label: "Choose resolution mode", icon: Route },
    "log-return": { label: "Log return", icon: PackageOpen },
    status: { label: "", icon: PackageCheck },
    "undo-cancel": { label: "Undo cancel", icon: Undo2 },
  };
  const primaryUi = primary
    ? primary.kind === "status"
      ? { label: { READY_TO_SHIP: "Mark ready to ship", DELIVERED: "Mark delivered", CLOSED: "Close order" }[primary.to], icon: { READY_TO_SHIP: PackageCheck, DELIVERED: Truck, CLOSED: CircleCheck }[primary.to] }
      : PRIMARY_UI[primary.kind]
    : null;

  const path = repairPath(o.mode);
  const cur = pathIndex(o);
  const colsTwo = tablet ? "repeat(2,minmax(0,1fr))" : "minmax(0,1fr)";
  const tabs: [Tab, string, number][] = [["overview", "Overview", 0], ["items", "Affected items", o.lines.length], ["returns", "Returns", o.returns.length]];
  const created = fmtDMY(o.createdAt);

  return (
    <>
      {/* Header: back · SVC number + status pill · ⋯ */}
      <div style={{ position: "sticky", top: 0, zIndex: 40, background: "rgba(250,248,244,.95)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, height: HEADER_H, padding: "0 14px 0 12px", boxSizing: "border-box" }}>
          <button type="button" onClick={back} aria-label="Back" style={{ width: 44, height: 44, marginLeft: -10, background: "none", border: "none", padding: 0, flex: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: M.raisin }}>
            <ChevronLeft size={24} strokeWidth={1.9} />
          </button>
          <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ minWidth: 0, fontSize: 18, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontVariantNumeric: "tabular-nums" }}>{o.no}</span>
            <Pill label={LEGACY_STATUS_LABEL[o.status] ?? o.status} tone={tone} dot={tone.rail} />
          </div>
          <IconBtn label="More actions" onClick={() => setSheet("menu")}><Ellipsis size={20} strokeWidth={2} /></IconBtn>
        </div>
      </div>

      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        {/* Header card */}
        <div style={{ padding: "2px 18px 0" }}>
          <div style={{ background: M.card, borderRadius: 16, boxShadow: SH_CARD, padding: "14px 15px" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: M.raisin, lineHeight: 1.35, overflowWrap: "anywhere" }}>{o.customerName || "—"}</div>
            <div style={{ fontSize: 12.5, color: M.ink, marginTop: 3 }}>Created {fmtDM(o.createdAt) || "—"}{o.createdByName ? ` · ${o.createdByName}` : ""}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
              {o.caseId ? (
                <button type="button" onClick={() => navigate(casePath(o.caseId))} style={{ height: 26, boxSizing: "border-box", display: "inline-flex", alignItems: "center", gap: 5, padding: "0 9px", border: "none", borderRadius: 7, background: CC.tile, fontFamily: "inherit", fontSize: 11.5, color: M.ink, cursor: "pointer", whiteSpace: "nowrap" }}>
                  <Wrench size={12} strokeWidth={2.2} color={CC.brown} /><span style={{ color: "#6B6252" }}>Case</span><span style={{ fontWeight: 700, color: M.raisin }}>{caseNo || "Open case"}</span><ArrowUpRight size={12} strokeWidth={2.2} color={CC.brown} />
                </button>
              ) : null}
              <span style={{ height: 26, boxSizing: "border-box", display: "inline-flex", alignItems: "center", gap: 5, padding: "0 9px", borderRadius: 7, fontSize: 11.5, fontWeight: 700, background: o.mode ? CC.tile : CC.warnBg, color: o.mode ? M.ink : CC.warnFg, whiteSpace: "nowrap" }}>
                {o.mode ? <Route size={12} strokeWidth={2.2} /> : <CircleHelp size={12} strokeWidth={2.2} />}{o.mode ? LEGACY_MODE_LABEL[o.mode] ?? o.mode : "Mode pending"}
              </span>
              {o.sourceType === "EXTERNAL"
                ? <RefChip k="External" v={o.sourceNo || "—"} h={26} fs={11.5} />
                : o.sourceType ? <RefChip k={o.sourceType} v={o.sourceNo || "—"} h={26} fs={11.5} onClick={sourceHref ? () => navigate(sourceHref) : undefined} icon={sourceHref ? <ArrowUpRight size={12} strokeWidth={2.2} color={CC.brown} /> : undefined} /> : null}
            </div>
            {banners.length ? (
              <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                {banners.map((b) => (
                  <Note key={b.key} icon={b.icon} bg={b.bg} fg={b.fg} color="#3A352C"><b>{b.title}</b> {b.text}</Note>
                ))}
              </div>
            ) : null}
            {primary && primaryUi ? (
              <div style={{ marginTop: 12 }}>
                <Btn full disabled={busy} icon={<primaryUi.icon size={16} strokeWidth={2} />} onClick={() => onPrimary(primary)}>{primaryUi.label}</Btn>
              </div>
            ) : null}
            {o.status === "OPEN" && o.mode === "REPAIR" && !o.returns.length && !primary ? (
              <div style={{ fontSize: 12, color: M.ink, marginTop: 10 }}>Waiting for the first returned unit — logging it moves this order to In repair.</div>
            ) : null}
          </div>
        </div>

        {/* Section pills */}
        <div role="tablist" aria-label="Repair order sections" style={{ position: "sticky", top: `calc(${HEADER_H}px + env(safe-area-inset-top, 0px))`, zIndex: 5, display: "flex", gap: 8, overflowX: "auto", padding: "12px 18px 10px", background: M.paper, scrollbarWidth: "none" }}>
          {tabs.map(([k, l, c]) => <Chip key={k} role="tab" label={l} on={tab === k} count={c || undefined} onClick={() => setTab(k)} />)}
        </div>

        <div style={{ padding: "4px 18px 40px", display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 14 }}>
          {tab === "overview" ? (
            <>
              <section aria-label="Status" style={{ background: M.card, borderRadius: 16, boxShadow: SH_CARD, padding: "14px 15px" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1px", color: CC.brown }}>STATUS</span>
                  <span style={{ fontSize: 11.5, color: M.ink }}>{path.note}</span>
                </div>
                <ol style={{ listStyle: "none", margin: "10px 0 0", padding: 0 }}>
                  {path.steps.map((k, i) => {
                    const done = cur > i, here = cur === i, last = i === path.steps.length - 1;
                    return (
                      <li key={k} aria-current={here ? "step" : undefined} style={{ position: "relative", display: "flex", alignItems: "center", gap: 11, minHeight: 34 }}>
                        {!last ? <span aria-hidden style={{ position: "absolute", left: 8, top: 24, height: 14, width: 2, background: done ? "#4F7C3A" : "#E6E0D9" }} /> : null}
                        <span aria-hidden style={{ width: 18, height: 18, flex: "none", boxSizing: "border-box", borderRadius: "50%", background: done ? "#4F7C3A" : here ? CC.brown : "#fff", boxShadow: cur >= i ? "none" : "inset 0 0 0 1.5px #D9D2C6", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>{done ? <Check size={11} strokeWidth={3} /> : null}</span>
                        <span style={{ fontSize: 13.5, fontWeight: here ? 700 : 500, color: cur >= i ? M.raisin : "#9A9082" }}>{LEGACY_STATUS_LABEL[k]}</span>
                        {here ? <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: CC.brown }}>Current</span> : null}
                      </li>
                    );
                  })}
                </ol>
              </section>

              <section aria-label="Details" style={{ background: M.card, borderRadius: 16, boxShadow: SH_CARD, padding: "4px 15px" }}>
                {([
                  ["Customer", o.customerName || "—"],
                  ["Source", o.sourceType === "EXTERNAL" ? `External · ${o.sourceNo || "—"}` : o.sourceNo || o.sourceType || "—"],
                  ["Parent case", caseNo || (o.caseId ? "Service case" : "—")],
                  ["Resolution", o.mode ? LEGACY_MODE_LABEL[o.mode] ?? o.mode : "Mode pending"],
                  ["Created", created ? `${created}${o.createdByName ? ` · ${o.createdByName}` : ""}` : "—"],
                ] as [string, string][]).map(([k, v], i) => (
                  <div key={k} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, padding: "11px 0", borderTop: i ? `1px solid ${CC.sep}` : "none" }}>
                    <span style={{ flex: "none", fontSize: 12.5, color: M.ink }}>{k}</span>
                    <span style={{ minWidth: 0, textAlign: "right", fontSize: 13.5, fontWeight: 700, color: M.raisin, overflowWrap: "anywhere", fontVariantNumeric: "tabular-nums" }}>{v}</span>
                  </div>
                ))}
              </section>

              <section aria-label="Notes" style={{ background: M.card, borderRadius: 16, boxShadow: SH_CARD, padding: "14px 15px" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1px", color: CC.brown }}>NOTES</span>
                  <span style={{ fontSize: 11.5, color: "#9A9082" }}>Read-only, as on desktop</span>
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.55, color: o.notes ? M.raisin : "#9A9082", marginTop: 8, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{o.notes || "No notes on this order."}</div>
              </section>
            </>
          ) : null}

          {tab === "items" ? (
            <section aria-label="Affected items" style={{ display: "grid", gridTemplateColumns: colsTwo, gap: 14 }}>
              {o.lines.length === 0 ? <div style={{ background: M.card, borderRadius: 16, boxShadow: SH_CARD, padding: "24px 18px", textAlign: "center", fontSize: 13, color: M.ink }}>No items on this order.</div> : (
                o.lines.map((l) => {
                  const refs = [l.resolutionProductionOrderId && ["Resolution production order", l.resolutionProductionOrderId], l.resolutionFgBatchId && ["FG batch", l.resolutionFgBatchId]].filter(Boolean) as [string, string][];
                  return (
                    <div key={l.id} style={{ background: M.card, borderRadius: 16, boxShadow: SH_CARD, padding: "14px 15px" }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14.5, fontWeight: 700, color: M.raisin, lineHeight: 1.35, overflowWrap: "anywhere" }}>{l.productName || l.productCode || "Item"}</div>
                          <div style={{ fontSize: 12, fontWeight: 600, marginTop: 3, color: l.productId ? CC.brown : CC.warnFg, overflowWrap: "anywhere" }}>{l.productId ? l.productCode : "Free-text item · Repair only"}</div>
                        </div>
                        <span style={{ flex: "none", fontSize: 13.5, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap" }}>Qty {l.qty}</span>
                      </div>
                      <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 12, background: M.paper }}>
                        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".5px", color: CC.brown }}>ISSUE</div>
                        <div style={{ fontSize: 13, lineHeight: 1.45, color: M.raisin, marginTop: 3, overflowWrap: "anywhere" }}>{l.issueSummary || "—"}</div>
                      </div>
                      {refs.map(([k, v]) => (
                        <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 10, fontSize: 12.5 }}><span style={{ color: M.ink }}>{k}</span><span style={{ fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere", textAlign: "right" }}>{v}</span></div>
                      ))}
                      {!refs.length ? <div style={{ marginTop: 10, fontSize: 12, color: "#9A9082" }}>{o.mode === "REPAIR" ? "Repair — no production or FG batch" : "No resolution reference yet"}</div> : null}
                    </div>
                  );
                })
              )}
            </section>
          ) : null}

          {tab === "returns" ? (
            <section aria-label="Returns" style={{ display: "grid", gap: 14 }}>
              {o.returns.length === 0 ? (
                <div style={{ background: M.card, borderRadius: 16, boxShadow: SH_CARD, padding: "24px 18px", textAlign: "center" }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: M.raisin }}>No defective units received yet</div>
                  <div style={{ fontSize: 12.5, lineHeight: 1.5, color: M.ink, marginTop: 5 }}>{o.mode === "REPAIR" && o.status === "OPEN" ? "Logging the first return moves this order to In repair." : "Defective units sent back by the customer appear here."}</div>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: colsTwo, gap: 14 }}>
                  {o.returns.map((r) => (
                    <ReturnCard key={r.id} r={r} o={o} actions={returnActions(r, o.status, perms)} busy={busy}
                      onMarkRepaired={() => ask({ kind: "REPAIRED", ret: r, copy: { title: "Mark repaired?", text: "Records today and you as the repairer. The condition stays Repairable — Repaired isn’t a separate condition, and FG stock isn’t restored automatically.", go: "Mark repaired", danger: false } })} />
                  ))}
                </div>
              )}
              {logOk ? (
                <button type="button" onClick={() => { setRetErr(""); setSheet("return"); }} style={{ height: 46, border: "none", borderRadius: 12, background: M.card, color: CC.brown, fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, boxShadow: SH_CARD }}><Plus size={16} strokeWidth={2.2} />Log return</button>
              ) : null}
              <div style={{ fontSize: 11.5, color: "#9A9082", textAlign: "center", lineHeight: 1.45 }}>
                Conditions: Pending decision · Repairable · Scrapped. “Repaired” is a date and person, not a condition.
                {perms.update && o.returns.some((r) => r.condition === "PENDING_DECISION") ? <><br />{SCRAP_UNAVAILABLE_NOTE}</> : null}
              </div>
            </section>
          ) : null}
        </div>
      </div>

      <LegacyMenuSheet open={sheet === "menu"} onClose={() => setSheet(null)} subtitle={o.no} viewOnly={viewOnly} items={menu} />
      <LegacyModeSheet
        open={sheet === "mode"}
        onClose={() => setSheet(null)}
        no={o.no}
        approval={approval}
        onPick={(m) => { if (m === "STOCK_SWAP") return; ask({ kind: "MODE", mode: m, copy: modeConfirmCopy(m, o) }); }}
      />
      {sheet === "return" ? <LegacyReturnSheet order={o} busy={busy} error={retErr} onClose={() => setSheet(null)} onSave={(f) => void saveReturn(f)} /> : null}
      {confirm ? <LegacyConfirm copy={confirm.copy} busy={busy} onKeep={() => setConfirm(null)} onGo={() => void go()} /> : null}
      <LegacyInfoSheet info={info} onClose={() => setInfo(null)} />
      {toast.node}
    </>
  );
}

function ReturnCard({ r, o, actions, busy, onMarkRepaired }: {
  r: LegacyReturn; o: LegacyOrder; actions: { action: string; blocked: boolean }[]; busy: boolean; onMarkRepaired: () => void;
}) {
  const line = o.lines.find((l) => l.id === r.serviceOrderLineId);
  const name = line?.productName || line?.productCode || r.productCode || "—";
  const ck = r.condition === "SCRAPPED" ? CC.danger : r.condition === "REPAIRABLE" ? "#3E6570" : "#6B7280";
  const ctone = r.condition === "SCRAPPED" ? { bg: "#F9E1DA", fg: CC.danger } : r.condition === "REPAIRABLE" ? { bg: "#E0EDF0", fg: "#3E6570" } : { bg: "#EEEBE6", fg: "#4B5260" };
  const received = fmtDM(r.receivedAt);
  return (
    <div style={{ background: M.card, borderRadius: 16, boxShadow: SH_CARD, padding: "14px 15px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: M.raisin, lineHeight: 1.35, overflowWrap: "anywhere" }}>{name}</div>
          <div style={{ fontSize: 12, color: M.ink, marginTop: 3 }}>Received {received || "—"}{r.receivedByName ? ` · by ${r.receivedByName}` : ""}</div>
        </div>
        <Pill label={RETURN_CONDITION_LABEL[r.condition] ?? r.condition} tone={ctone} dot={ck} />
      </div>
      {r.notes ? <div style={{ fontSize: 12.5, lineHeight: 1.45, color: "#3A352C", marginTop: 8, overflowWrap: "anywhere" }}>{r.notes}</div> : null}
      {r.condition === "REPAIRABLE" && r.repairedAt ? <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, fontSize: 12.5, color: "#4F7C3A", fontWeight: 600 }}><CircleCheck size={14} strokeWidth={2} />Repaired {fmtDM(r.repairedAt)}{r.repairedByName ? ` · ${r.repairedByName}` : ""}</div> : null}
      {r.condition === "SCRAPPED" && r.scrappedViaAdjustmentId ? <div style={{ fontSize: 12, color: M.ink, marginTop: 8, fontVariantNumeric: "tabular-nums" }}>Adjustment {r.scrappedViaAdjustmentId}</div> : null}
      {actions.length ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
          {actions.map((a) => {
            if (a.action === "mark-repaired") return <RowBtn key={a.action} primary label="Mark repaired" icon={<CircleCheck size={14} strokeWidth={2} />} disabled={busy} onClick={onMarkRepaired} />;
            return <RowBtn key={a.action} danger label="Scrap…" icon={<Trash2 size={14} strokeWidth={2} />} disabled onClick={() => undefined} title={SCRAP_UNAVAILABLE_NOTE} />;
          })}
        </div>
      ) : null}
    </div>
  );
}

function RowBtn({ label, icon, onClick, disabled, primary, danger, title }: { label: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean; danger?: boolean; title?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-disabled={disabled} title={title} style={{ height: 36, minWidth: 44, padding: "0 13px", border: "none", borderRadius: 10, display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1, background: primary ? M.taupe : danger ? "#F9E1DA" : CC.tile, color: primary ? "var(--m-text-on-accent)" : danger ? CC.danger : CC.brown, WebkitTapHighlightColor: "transparent" }}>
      {icon}{label}
    </button>
  );
}
