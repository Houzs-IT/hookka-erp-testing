// ===========================================================================
// DeliveryDetailPhone — delivery order detail (/m/delivery/:id), phone AND
// tablet (the file name predates the tablet support; owner 2026-10-20).
//
// Visuals: Claude Design `Delivery.dc.html` detail scene; typography: the /m
// Sales screens. Every value is real data from the same reads desktop
// src/pages/delivery/detail.tsx makes — GET /api/delivery-orders/:id (+
// lockReason, linkedReturns) and /api/lorries. Actions are desktop's, per
// status (lib/do-mobile.ts doDetailActions), through the same writes
// (./actions.ts):
//   DRAFT        Load & Generate DO                         → LOADED
//   LOADED       Dispatch → IN_TRANSIT · Mark Delivered (secondary)
//   IN_TRANSIT   Mark Delivered (proof of delivery first if none)
//   DELIVERED    incomplete: Complete & invoice (/resolve-incomplete)
//                otherwise: Convert to Invoice — a STATUS update only; the
//                invoice itself is created on delivery (the confirm says so)
// Lorry: DRAFT / LOADED. Capture POD: LOADED / IN_TRANSIT / DELIVERED w/o POD.
// Customer notices follow a move to Dispatched / Delivered, as on the desktop
// list; a toast says "emailed" only when the server queued one.
// Edit / Cancel are desktop-only (desktop detail has neither either).
// Actions show only with delivery-orders:update; the API still decides.
//
// Responsive: phone column; tablet = a centred column, or the right pane of
// the split view. The action bar is a fixed dock that follows its pane.
// ===========================================================================
import { useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Box, Building2, CalendarCheck, CalendarClock, Check, ChevronRight, CircleCheck, ClipboardList, CloudOff, Download, Ellipsis,
  FileSignature, Files, Image, Lock, MapPin, MapPinned, Package, PackageCheck, PenLine, Phone, QrCode, ReceiptText, Send, Truck,
  TriangleAlert, Undo2, User,
} from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { usePermissions } from "@/lib/use-permission";
import type { ProofOfDelivery } from "@/types";
import { MobileHeader, QrModal, Sheet } from "../../components";
import { M, M_ACCENT } from "../../theme";
import { useResponsiveLayout } from "../../lib/responsive-layout";
import { resolveStatus, STATUS_MAPS } from "../../config/helpers";
import {
  ACTION_TARGET, actionConfirmLines, doDetailActions, doStatusLabel, fmtDate, fmtDateTime, fmtShort, m3, n, overdueBadgeDays,
  rows, s, timeline, totalM3, totalQty,
  type DoActionKey, type RawRow,
} from "../../lib/do-mobile";
import { notifyCustomers, noticeToast, putLorry, putPod, putStatus, refreshDeliveryCaches, resolveIncomplete, type WriteResult } from "./actions";
import { DeliveryPodSheet } from "./DeliveryPodSheet";
import { BottomDock, FlagPill, Notice, PrimaryButton, RadioRow, SecondaryButton, SheetFooter, SheetSub, Surface, TilePill } from "./ui";
import { DL, SHADOW_BLOCK, SHADOW_MENU, SHADOW_ROUND, SHADOW_SECTION, T, pill, sem, toneOf } from "./ui-tokens";
import { useConfirmSheet, useCreditOverride, useMobileToast } from "./ui-hooks";

type Envelope = { success?: boolean; data?: RawRow; lockReason?: string | null; linkedReturns?: RawRow[] } & RawRow;

const ITEMS_PREVIEW = 2;

const ACTION_ICON: Record<DoActionKey, typeof Send> = {
  LOAD: PackageCheck,
  DISPATCH: Send,
  DELIVER: CircleCheck,
  RESOLVE: CircleCheck,
  CONVERT_INVOICE: ReceiptText,
};

const CONFIRM_TITLE: Record<DoActionKey, string> = {
  LOAD: "Load & Generate DO",
  DISPATCH: "Dispatch",
  DELIVER: "Mark Delivered",
  RESOLVE: "Mark documents complete & invoice",
  CONVERT_INVOICE: "Convert to Invoice",
};

const CONFIRM_LABEL: Record<DoActionKey, string> = {
  LOAD: "Load & Generate DO",
  DISPATCH: "Dispatch",
  DELIVER: "Mark Delivered",
  RESOLVE: "Complete & invoice",
  CONVERT_INVOICE: "Convert to Invoice",
};

export function DeliveryDetailPhone() {
  const navigate = useNavigate();
  const { id = "" } = useParams();
  const layout = useResponsiveLayout();
  const tablet = layout.mode !== "phone";
  const url = `/api/delivery-orders/${encodeURIComponent(id)}`;
  const { data, loading, error, failure, refresh } = useCachedJson<Envelope>(url);
  const env = data ?? null;
  const doc: RawRow | null = env ? ((env.success && env.data ? env.data : env.data ?? null) as RawRow | null) : null;

  const { hasPermission } = usePermissions();
  const canUpdate = hasPermission("delivery-orders", "update");
  // POST /api/delivery-returns is gated on delivery-returns:update.
  const canReturn = hasPermission("delivery-returns", "update");

  const toast = useMobileToast();
  const confirmSheet = useConfirmSheet();
  const credit = useCreditOverride();
  const [busy, setBusy] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [podOpen, setPodOpen] = useState(false);
  const [photosOpen, setPhotosOpen] = useState(false);
  const [lorryOpen, setLorryOpen] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [allItems, setAllItems] = useState(false);

  const column = (children: ReactNode, pad = "2px 18px 28px") => (
    <div style={{ padding: pad, maxWidth: tablet && !layout.canSplitDetail ? 760 : undefined, margin: "0 auto", boxSizing: "border-box" }}>{children}</div>
  );

  const header = (title: string, withMore: boolean) => (
    <MobileHeader
      title={title}
      onBack={() => navigate(-1)}
      trailing={
        withMore ? (
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-label="Documents and more"
            aria-haspopup="dialog"
            style={{
              width: 42, height: 42, borderRadius: "50%", background: M.card, border: "none", display: "flex", alignItems: "center",
              justifyContent: "center", padding: 0, cursor: "pointer", color: M.taupe, boxShadow: SHADOW_ROUND,
            }}
          >
            <Ellipsis size={20} strokeWidth={2} />
          </button>
        ) : null
      }
    />
  );

  if (loading && !doc) {
    return (
      <>
        {header("Delivery Order", false)}
        {column(
          <div aria-busy="true" aria-label="Loading delivery order">
            {[90, 200, 150, 120].map((h, i) => (
              <div key={i} style={{ height: h, borderRadius: 20, background: M.card, boxShadow: SHADOW_BLOCK, marginTop: i ? 12 : 14, opacity: 0.7 }} />
            ))}
          </div>,
        )}
      </>
    );
  }
  // Only a 404 licenses "not found" (class C15): a timeout or 5xx is a load
  // failure, never an absent record.
  if (!doc && failure?.kind === "notFound") {
    return (
      <>
        {header("Delivery Order", false)}
        <div style={{ padding: "60px 18px", textAlign: "center", color: M.muted, ...T.body }}>Delivery order not found.</div>
      </>
    );
  }
  if (error && !doc) {
    return (
      <>
        {header("Delivery Order", false)}
        <div role="alert" style={{ padding: "56px 24px", textAlign: "center" }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "center", background: M_ACCENT.danger.bg }}>
            <CloudOff size={22} strokeWidth={1.9} color={M_ACCENT.danger.fg} />
          </div>
          <div style={{ ...T.cardTitle, color: M.raisin, marginTop: 14 }}>Couldn’t load this delivery order</div>
          <div style={{ ...T.meta, color: M.ink, marginTop: 4 }}>Check your connection and try again.</div>
          <button
            type="button"
            onClick={() => refresh()}
            style={{ marginTop: 16, height: 44, padding: "0 22px", borderRadius: 9999, border: "none", background: M.taupe, color: "var(--m-text-on-accent)", fontFamily: "inherit", fontSize: "var(--m-type-button-size)", fontWeight: 700, cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      </>
    );
  }
  if (!doc) {
    return (
      <>
        {header("Delivery Order", false)}
        <div style={{ padding: "60px 18px", textAlign: "center", color: M.muted, ...T.body }}>This delivery order could not be shown.</div>
      </>
    );
  }

  const docId = s(doc, "id") || id;
  const doNo = s(doc, "doNo") || "Delivery Order";
  const status = s(doc, "status");
  const tone = toneOf(resolveStatus(status, STATUS_MAPS.delivery).style);
  const incomplete = doc.deliveryIncomplete === true;
  const pod = (doc.proofOfDelivery ?? null) as ProofOfDelivery | null;
  const podPhotos = pod?.photoDataUrls ?? [];
  const acts = doDetailActions(status, incomplete, !!pod);
  const overdue = overdueBadgeDays(doc);
  const steps = timeline(doc);
  const items = rows(doc.items);
  const shownItems = allItems ? items : items.slice(0, ITEMS_PREVIEW);
  const lockReason = (env?.lockReason ?? null) as string | null;
  const returns = rows(env?.linkedReturns);
  const soNos = Array.from(new Set(items.map((i) => s(i, "salesOrderNo")).filter(Boolean)));
  if (!soNos.length && s(doc, "companySOId", "companySO")) soNos.push(s(doc, "companySOId", "companySO"));

  const after = async (res: WriteResult, okMsg: (st: string) => string, notify?: "DISPATCHED" | "DELIVERED") => {
    if (!res.ok) {
      if (res.error) toast.show(res.error, "error");
      return false;
    }
    refreshDeliveryCaches();
    refresh();
    const st = s(res.data, "status");
    toast.show(res.warning ?? okMsg(st), res.warning ? "warning" : "success");
    if (notify) {
      void notifyCustomers([res.data ?? doc], notify).then((queued) => {
        const msg = noticeToast(queued, notify);
        if (msg) toast.show(msg, "success");
      });
    }
    return true;
  };

  const run = async (key: DoActionKey) => {
    if (busy) return;
    if (key === "DELIVER" && !pod) {
      setPodOpen(true);
      return;
    }
    const ok = await confirmSheet.confirm({ title: CONFIRM_TITLE[key], sub: doNo, lines: actionConfirmLines(key), confirmLabel: CONFIRM_LABEL[key] });
    if (!ok) return;
    setBusy(true);
    if (key === "RESOLVE") {
      const res = await resolveIncomplete(docId);
      setBusy(false);
      await after(res, (st) => (st === "INVOICED" ? "Documents marked complete — invoice created." : "Documents marked complete."));
      return;
    }
    const res = await putStatus(docId, ACTION_TARGET[key], credit.ask);
    setBusy(false);
    const msg: Record<Exclude<DoActionKey, "RESOLVE">, (st: string) => string> = {
      LOAD: () => `${doNo} dispatched`,
      DISPATCH: () => `${doNo} in transit`,
      DELIVER: (st) => (st === "INVOICED" ? `${doNo} delivered — invoice created` : `${doNo} delivered`),
      CONVERT_INVOICE: () => `${doNo} marked Invoiced`,
    };
    await after(res, msg[key], key === "LOAD" ? "DISPATCHED" : key === "DELIVER" ? "DELIVERED" : undefined);
  };

  const submitPod = async (p: ProofOfDelivery) => {
    const already = status === "DELIVERED";
    const res = await putPod(docId, p, already, credit.ask);
    if (!res.ok) return { ok: false, error: res.error || "Couldn't save the proof of delivery." };
    await after(
      res,
      (st) => (already ? "Proof saved" : st === "INVOICED" ? `${doNo} delivered — invoice auto-created` : `${doNo} delivered`),
      already ? undefined : "DELIVERED",
    );
    return { ok: true };
  };

  const openQr = async () => {
    setMoreOpen(false);
    try {
      const r = await fetch(`/api/delivery-orders/${encodeURIComponent(docId)}/qr-token`);
      const j = (await r.json().catch(() => ({}))) as { success?: boolean; data?: { url?: string }; error?: string };
      if (!r.ok || !j.success || !j.data?.url) {
        toast.show(j.error || "Failed to load the QR code.", "error");
        return;
      }
      setQrUrl(j.data.url);
    } catch {
      toast.show("Network error. Please try again.", "error");
    }
  };

  const printExtras = async () => {
    try {
      const r = await fetch(`/api/delivery-orders/${encodeURIComponent(docId)}/print-extras`);
      const j = (await r.json()) as { success?: boolean; data?: import("@/lib/generate-do-pdf").DOPrintExtras };
      return j?.success && j.data ? j.data : {};
    } catch {
      return {};
    }
  };
  const downloadDo = async () => {
    setMoreOpen(false);
    const { downloadUnifiedDoPdf } = await import("@/lib/unified-doc-download");
    await downloadUnifiedDoPdf(doc, await printExtras());
  };
  const printPacking = async () => {
    setMoreOpen(false);
    const { generatePackingListPdf } = await import("@/lib/generate-packing-pdf");
    generatePackingListPdf(doc as unknown as import("@/types").DeliveryOrder, await printExtras());
  };

  const hubLine = [s(doc, "hubName"), s(doc, "hubState", "customerState")].filter(Boolean).join(" · ");
  const driverContact = [s(doc, "driverContactPerson"), s(doc, "driverPhone")].filter(Boolean).join(" · ");
  const vehicle = [s(doc, "vehicleNo"), s(doc, "vehicleType")].filter(Boolean).join(" · ");
  const contact = [s(doc, "contactPerson"), s(doc, "contactPhone")].filter(Boolean).join(" · ");
  const showActions = canUpdate && !!acts.primary;
  const viewOnly = !canUpdate && !["CANCELLED", "INVOICED"].includes(status);
  const dockScope = layout.canSplitDetail ? "detail" : "content";

  // Prototype rows (3PL provider · Driver · Vehicle · Contact · Dispatched ·
  // Delivered) + desktop detail's Lorry row. driverName = the 3PL company.
  const logistics: { icon: typeof Truck; k: string; v: string }[] = [
    { icon: Building2, k: "3PL provider", v: s(doc, "driverName") },
    { icon: User, k: "Driver", v: driverContact },
    { icon: Truck, k: "Vehicle", v: vehicle },
    { icon: Truck, k: "Lorry", v: s(doc, "lorryName") },
    { icon: Phone, k: "Contact", v: contact },
    { icon: Send, k: "Dispatched", v: fmtDateTime(s(doc, "dispatchedAt")) },
    { icon: CircleCheck, k: "Delivered", v: fmtDateTime(s(doc, "deliveredAt")) },
  ];

  // Related documents chain: SO(s) → this DO → Sales Invoice (+ returns).
  type Node = { label: string; doc: string; sub: string; state: "linked" | "current" | "pending"; onClick?: () => void };
  const chain: Node[] = [
    ...soNos.map<Node>((no) => ({ label: "Sales Order", doc: no, sub: "Source order", state: "linked", onClick: () => navigate(`/m/sales/${encodeURIComponent(no)}`) })),
    { label: "Delivery Order", doc: doNo, sub: "This delivery order", state: "current" },
    lockReason
      ? { label: "Sales Invoice", doc: "Invoice raised", sub: "Open Invoices to find it", state: "linked", onClick: () => navigate("/m/invoices") }
      : {
          label: "Sales Invoice",
          doc: "Not created",
          sub: status === "CANCELLED" ? "Not applicable" : status === "DELIVERED" && incomplete ? "On hold until the paperwork is complete" : "Created on delivery",
          state: "pending",
        },
    ...returns.map<Node>((r) => ({
      label: "Delivery Returns",
      doc: s(r, "returnNo") || "Return",
      sub: [s(r, "status"), fmtDate(s(r, "returnedAt", "createdAt"))].filter(Boolean).join(" · ") || "Linked return",
      state: "linked",
      onClick: () => navigate(`/delivery-returns/${encodeURIComponent(s(r, "id"))}`),
    })),
  ];

  return (
    <>
      {header(doNo, true)}
      {column(
        <>
          {/* 1 · Header */}
          <section aria-label="Header" style={{ padding: "0 2px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <TilePill tone={tone} label={doStatusLabel(status)} size="md" dot />
              {overdue ? <FlagPill tone="danger" label={`${overdue}d overdue`} size="md" /> : null}
            </div>
            <h1 style={{ margin: "10px 0 0", fontSize: "var(--m-type-section-heading-size)", lineHeight: "var(--m-type-section-heading-line-height)", fontWeight: 700, letterSpacing: "var(--m-type-section-heading-tracking)", color: M.raisin, wordBreak: "break-word" }}>
              {s(doc, "customerName") || "—"}
            </h1>
            {hubLine ? (
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, ...T.meta, color: M.ink, minWidth: 0 }}>
                <MapPin size={13} strokeWidth={1.9} color={DL.icon} aria-hidden style={{ flex: "none" }} />
                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{hubLine}</span>
              </div>
            ) : null}
            {status === "DELIVERED" && incomplete ? (
              <Banner tone="warning" icon={TriangleAlert} title="Delivered with issues — invoice on hold">
                Goods arrived but the paperwork was marked incomplete. No invoice has been created yet.
              </Banner>
            ) : null}
            {lockReason ? (
              <Banner tone="info" icon={Lock} title="Locked">
                {lockReason}
              </Banner>
            ) : null}
          </section>

          {/* 2 · Overview + timeline */}
          <Surface ariaLabel="Delivery overview" radius={20} shadow={SHADOW_SECTION} style={{ marginTop: 16, padding: "16px 16px 14px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "14px 16px" }}>
              <Fact icon={CalendarCheck} k="Delivery date" v={fmtDate(s(doc, "deliveryDate"))} warn={overdue > 0} />
              <Fact icon={CalendarClock} k="Expected DD" v={fmtDate(s(doc, "hookkaExpectedDD"))} />
              <Fact icon={Package} k="Total qty" v={String(totalQty(doc))} />
              <Fact icon={Box} k="Total M³" v={m3(totalM3(doc))} />
            </div>
            <div style={{ height: 1, background: DL.track, margin: "16px -16px 14px" }} />
            {steps ? (
              <ol aria-label="Delivery timeline" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}>
                {steps.map((st, i) => {
                  const done = st.state === "done";
                  const cur = st.state === "current";
                  const pend = st.state === "pending";
                  const lineL = i === 0 ? "transparent" : !pend ? sem("success") : DL.line;
                  const lineR = i === steps.length - 1 ? "transparent" : done ? sem("success") : DL.line;
                  return (
                    <li key={st.status} aria-current={cur ? "step" : undefined} style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", minWidth: 0 }}>
                      <span aria-hidden style={{ position: "absolute", top: 12, left: 0, width: "50%", height: 2, background: lineL }} />
                      <span aria-hidden style={{ position: "absolute", top: 12, right: 0, width: "50%", height: 2, background: lineR }} />
                      <span
                        style={{
                          position: "relative", width: 26, height: 26, boxSizing: "border-box", borderRadius: "50%",
                          background: done ? sem("success") : cur ? M.taupe : M.card,
                          boxShadow: cur ? "0 0 0 4px rgba(201,169,97,.35)" : pend ? `inset 0 0 0 1.5px ${DL.dotRing}` : "none",
                          display: "flex", alignItems: "center", justifyContent: "center", color: pend ? DL.stepNum : "#FFFFFF", fontSize: 11, fontWeight: 700,
                        }}
                      >
                        {done ? <Check size={13} strokeWidth={3} /> : cur ? <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#FFFFFF" }} /> : i + 1}
                      </span>
                      <span style={{ marginTop: 7, maxWidth: "100%", textAlign: "center", fontSize: 10.5, lineHeight: 1.3, fontWeight: cur ? 700 : 600, color: pend ? M.ink : M.raisin }}>
                        {st.label}
                      </span>
                      {st.when ? <span style={{ marginTop: 2, fontSize: 10, color: M.ink, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{fmtShort(st.when)}</span> : null}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <div style={{ display: "flex", gap: 11, alignItems: "flex-start", padding: "11px 12px", borderRadius: 12, background: M.paper }}>
                <span aria-hidden style={{ width: 10, height: 10, flex: "none", borderRadius: "50%", background: sem("danger"), marginTop: 4 }} />
                <div style={{ fontSize: 12.5, lineHeight: 1.45, color: DL.body }}>
                  <span style={{ fontWeight: 700, color: M.raisin }}>Cancelled.</span> Terminal status — its production orders were released for future delivery orders.
                </div>
              </div>
            )}
          </Surface>

          {/* 3 · Logistics */}
          <Surface ariaLabel="Logistics" style={{ marginTop: 12, padding: "4px 15px" }}>
            {logistics.map((l, i) => (
              <div key={l.k} style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 50, borderTop: i ? `1px solid ${DL.track}` : "none" }}>
                <l.icon size={16} strokeWidth={1.9} color={DL.icon} aria-hidden style={{ flex: "none" }} />
                <span style={{ flex: "none", fontSize: 12.5, color: M.ink }}>{l.k}</span>
                <span style={{ flex: 1, minWidth: 0, textAlign: "right", fontSize: 13.5, fontWeight: 600, color: l.v ? M.raisin : M.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                  {l.v || "—"}
                </span>
              </div>
            ))}
            {s(doc, "deliveryAddress") ? (
              <div style={{ display: "flex", gap: 12, padding: "13px 0", borderTop: `1px solid ${DL.track}` }}>
                <MapPinned size={16} strokeWidth={1.9} color={DL.icon} aria-hidden style={{ flex: "none", marginTop: 1 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: M.ink }}>Delivery address</div>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: M.raisin, marginTop: 3, whiteSpace: "pre-line", overflowWrap: "anywhere" }}>{s(doc, "deliveryAddress")}</div>
                </div>
              </div>
            ) : null}
            {canUpdate && acts.canAssignLorry ? (
              <button
                type="button"
                onClick={() => setLorryOpen(true)}
                style={{ width: "100%", height: 44, border: "none", borderTop: `1px solid ${DL.track}`, background: "none", fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: M.taupe, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              >
                <Truck size={15} strokeWidth={2} aria-hidden /> Assign lorry
              </button>
            ) : null}
          </Surface>

          {/* 4 · Proof of delivery */}
          <Surface ariaLabel="Proof of delivery" style={{ marginTop: 12, padding: "14px 15px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <FileSignature size={16} strokeWidth={1.9} color={M.taupe} aria-hidden />
              <span style={{ flex: 1, ...T.cardTitle, color: M.raisin }}>Proof of delivery</span>
            </div>
            {pod ? (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, marginTop: 12 }}>
                  <PodFact k="Receiver" v={pod.receiverName} />
                  <PodFact k="IC / ID" v={pod.receiverIC || "—"} />
                  <PodFact k="Delivered at" v={fmtDateTime(pod.deliveredAt) || "—"} />
                  <PodFact k="Captured by" v={pod.capturedBy || "—"} />
                </div>
                {pod.remarks ? <div style={{ fontSize: 12.5, color: M.raisin, marginTop: 10, lineHeight: 1.45 }}>{pod.remarks}</div> : null}
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <div style={{ flex: 1, height: 64, borderRadius: 10, background: M.paper, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 12, color: M.ink, overflow: "hidden" }}>
                    {pod.signatureDataUrl ? (
                      <img src={pod.signatureDataUrl} alt="Receiver signature" className="m-no-invert" style={{ maxHeight: 56, maxWidth: "92%", objectFit: "contain", background: "#FFFFFF", borderRadius: 6 }} />
                    ) : (
                      <>
                        <PenLine size={15} strokeWidth={1.9} color={DL.icon} aria-hidden />
                        No signature
                      </>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => podPhotos.length && setPhotosOpen(true)}
                    disabled={!podPhotos.length}
                    aria-label={podPhotos.length ? `View ${podPhotos.length} delivery photo${podPhotos.length === 1 ? "" : "s"}` : "No photos"}
                    style={{ flex: 1, height: 64, borderRadius: 10, border: "none", background: M.paper, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontFamily: "inherit", fontSize: 12, color: M.ink, cursor: podPhotos.length ? "pointer" : "default" }}
                  >
                    <Image size={15} strokeWidth={1.9} color={DL.icon} aria-hidden />
                    {podPhotos.length} photo{podPhotos.length === 1 ? "" : "s"}
                  </button>
                </div>
              </>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                <span style={{ flex: 1, fontSize: 12.5, color: M.ink }}>No proof captured yet</span>
                {canUpdate && acts.canCapturePod ? (
                  <button
                    type="button"
                    onClick={() => setPodOpen(true)}
                    style={{ height: 36, padding: "0 13px", borderRadius: 10, border: "none", background: M.paper, color: M.taupe, fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                  >
                    Capture POD
                  </button>
                ) : null}
              </div>
            )}
          </Surface>

          {/* 5 · Items */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "26px 2px 10px", flexWrap: "wrap" }}>
            <Package size={16} strokeWidth={1.9} color={M.taupe} aria-hidden />
            <span style={{ ...T.cardTitle, color: M.raisin }}>Items</span>
            <span style={{ fontSize: 12.5, color: M.ink, fontVariantNumeric: "tabular-nums" }}>
              {items.length} line{items.length === 1 ? "" : "s"} · {totalQty(doc)} qty · {m3(totalM3(doc))} m³
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 10 }}>
            {shownItems.map((it) => (
              <ItemCard key={s(it, "id") || s(it, "poNo")} it={it} />
            ))}
            {items.length === 0 ? <div style={{ fontSize: 12.5, color: M.ink }}>No items on this delivery order.</div> : null}
          </div>
          {items.length > ITEMS_PREVIEW ? (
            <button
              type="button"
              onClick={() => setAllItems((v) => !v)}
              style={{ marginTop: 10, width: "100%", height: 44, borderRadius: 12, border: "none", background: M.card, color: M.taupe, fontFamily: "inherit", fontSize: 13.5, fontWeight: 700, cursor: "pointer", boxShadow: "0 1px 2px rgba(31,29,27,.05),0 6px 16px -10px rgba(31,29,27,.18)" }}
            >
              {allItems ? "Show fewer items" : `View all ${items.length} items`}
            </button>
          ) : null}

          {/* 6 · Related documents */}
          <Surface ariaLabel="Related documents" style={{ marginTop: 26, padding: "14px 15px 6px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Files size={16} strokeWidth={1.9} color={M.taupe} aria-hidden />
              <span style={{ ...T.cardTitle, color: M.raisin }}>Related documents</span>
            </div>
            <ol style={{ listStyle: "none", margin: "8px 0 0", padding: 0 }}>
              {chain.map((c, i) => (
                <ChainRow key={`${c.label}-${c.doc}-${i}`} node={c} nextPending={chain[i + 1]?.state === "pending"} last={i === chain.length - 1} />
              ))}
            </ol>
          </Surface>

          {/* 7 · Remarks */}
          {s(doc, "remarks") ? (
            <Surface style={{ marginTop: 12, padding: "13px 15px" }} radius={16}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe }}>REMARKS</div>
              <div style={{ fontSize: 13, lineHeight: 1.55, color: M.raisin, marginTop: 5, whiteSpace: "pre-line", overflowWrap: "anywhere" }}>{s(doc, "remarks")}</div>
            </Surface>
          ) : null}

          {/* Room for the fixed action bar. */}
          {showActions || viewOnly ? <div aria-hidden style={{ height: 84 }} /> : null}
        </>,
      )}

      {showActions && acts.primary ? (
        <BottomDock variant="detail" scope={dockScope}>
          {acts.secondary ? (
            <SecondaryButton onClick={() => void run(acts.secondary!.key)} disabled={busy}>
              {acts.secondary.label}
            </SecondaryButton>
          ) : null}
          <PrimaryButton icon={ACTION_ICON[acts.primary.key]} iconSize={17} onClick={() => void run(acts.primary!.key)} disabled={busy} style={{ flex: 1.4 }}>
            {busy ? "Working…" : acts.primary.label}
          </PrimaryButton>
        </BottomDock>
      ) : viewOnly ? (
        <BottomDock variant="detail" scope={dockScope}>
          <div style={{ flex: 1, textAlign: "center", fontSize: 12, color: M.ink, padding: "4px 0" }}>View only — actions depend on your permissions.</div>
        </BottomDock>
      ) : null}

      {/* Documents & more */}
      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="Documents & more">
        <div style={{ background: M.card, borderRadius: 16, overflow: "hidden", boxShadow: SHADOW_MENU }}>
          <MenuRow icon={QrCode} label="QR code" onClick={() => void openQr()} first />
          <MenuRow icon={Download} label="Download DO PDF" onClick={() => void downloadDo()} />
          <MenuRow icon={ClipboardList} label="Print packing list" onClick={() => void printPacking()} />
          {acts.canConvertToReturn && canReturn ? (
            <MenuRow
              icon={Undo2}
              label="Convert to Delivery Return"
              onClick={() => {
                setMoreOpen(false);
                navigate(`/delivery-returns?createFrom=${encodeURIComponent(docId)}`);
              }}
            />
          ) : null}
        </div>
      </Sheet>

      <Sheet open={photosOpen} onClose={() => setPhotosOpen(false)} title="Delivery photos">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
          {podPhotos.map((p, i) => (
            <a key={i} href={p} target="_blank" rel="noopener noreferrer" aria-label={`Open delivery photo ${i + 1}`}>
              <img src={p} alt={`Delivery photo ${i + 1}`} className="m-no-invert" style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", borderRadius: 10, display: "block" }} />
            </a>
          ))}
        </div>
      </Sheet>

      <QrModal
        open={!!qrUrl}
        onClose={() => setQrUrl(null)}
        title="Delivery status QR"
        choices={qrUrl ? [{ label: doNo, code: doNo, value: qrUrl }] : []}
        downloadName={`${doNo}-delivery-qr`}
      />

      <DeliveryPodSheet
        open={podOpen}
        onClose={() => setPodOpen(false)}
        onSubmit={submitPod}
        subtitle={`${doNo} · ${s(doc, "customerName")}`}
        confirmLabel={status === "DELIVERED" ? "Save proof" : "Save & mark delivered"}
      />

      <LorrySheet
        open={lorryOpen}
        doNo={doNo}
        current={s(doc, "lorryId")}
        onClose={() => setLorryOpen(false)}
        onAssign={async (lorryId) => {
          const res = await putLorry(docId, lorryId, credit.ask);
          if (res.ok) {
            setLorryOpen(false);
            await after(res, () => "Lorry assigned");
            return null;
          }
          return res.error || "Failed to assign the lorry";
        }}
      />

      {confirmSheet.node}
      {credit.node}
      {toast.node}
    </>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------
function Banner({ tone, icon: Icon, title, children }: { tone: "warning" | "info"; icon: typeof Lock; title: string; children: ReactNode }) {
  const c = pill(tone);
  return (
    <div role="status" style={{ display: "flex", gap: 11, alignItems: "flex-start", marginTop: 12, padding: "12px 14px", borderRadius: 14, background: c.bg }}>
      <Icon size={17} strokeWidth={2} color={c.fg} aria-hidden style={{ flex: "none", marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...T.label, fontWeight: 700, color: c.fg }}>{title}</div>
        <div style={{ fontSize: 12.5, lineHeight: 1.45, color: DL.body, marginTop: 2, wordBreak: "break-word" }}>{children}</div>
      </div>
    </div>
  );
}

function Fact({ icon: Icon, k, v, warn }: { icon: typeof Package; k: string; v: string; warn?: boolean }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: M.ink, whiteSpace: "nowrap" }}>
        <Icon size={14} strokeWidth={1.9} color={DL.icon} aria-hidden />
        {k}
      </div>
      <div style={{ ...T.cardTitle, color: warn ? sem("danger") : v ? M.raisin : M.muted, marginTop: 4, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {v || "—"}
      </div>
    </div>
  );
}

function PodFact({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11.5, color: M.ink }}>{k}</div>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: M.raisin, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</div>
    </div>
  );
}

function ItemCard({ it }: { it: RawRow }) {
  const qty = n(it, "quantity");
  const packed = s(it, "packingStatus") === "PACKED";
  const spec = [s(it, "sizeLabel"), s(it, "fabricCode"), s(it, "poNo")].filter(Boolean).join(" · ");
  const warn = pill("warning");
  return (
    <div style={{ background: M.card, borderRadius: 16, padding: "13px 14px", boxShadow: SHADOW_BLOCK }}>
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: M.raisin, lineHeight: 1.35, overflowWrap: "anywhere" }}>{s(it, "productName") || s(it, "productCode") || "—"}</div>
          {s(it, "productCode") ? <div style={{ fontSize: 12, fontWeight: 600, color: M.taupe, marginTop: 3 }}>{s(it, "productCode")}</div> : null}
          {spec ? <div style={{ fontSize: 12.5, color: M.ink, marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{spec}</div> : null}
        </div>
        <div style={{ flex: "none", textAlign: "right" }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap" }}>Qty {qty}</div>
          <div style={{ fontSize: 12, color: M.ink, marginTop: 3, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{m3(n(it, "itemM3") * qty)} m³</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
        {s(it, "salesOrderNo") ? (
          <span style={{ height: 24, display: "inline-flex", alignItems: "center", padding: "0 9px", borderRadius: 8, background: DL.tile, fontSize: 11.5, color: M.ink, whiteSpace: "nowrap" }}>
            <span style={{ color: M.taupe, fontWeight: 700, marginRight: 5 }}>SO</span>
            {s(it, "salesOrderNo")}
          </span>
        ) : null}
        {s(it, "rackingNumber") ? (
          <span style={{ height: 24, display: "inline-flex", alignItems: "center", gap: 4, padding: "0 9px", borderRadius: 8, background: warn.bg, color: warn.fg, fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap" }}>
            <MapPinned size={12} strokeWidth={2} aria-hidden />
            {s(it, "rackingNumber")}
          </span>
        ) : null}
        <TilePill tone={packed ? "success" : "neutral"} label={packed ? "Packed" : "Pending"} />
      </div>
    </div>
  );
}

/** Prototype document-chain row: dot + vertical connector to the next node. */
function ChainRow({ node, nextPending, last }: { node: { label: string; doc: string; sub: string; state: "linked" | "current" | "pending"; onClick?: () => void }; nextPending: boolean; last: boolean }) {
  const linked = node.state === "linked";
  const current = node.state === "current";
  const dotBg = linked ? DL.linked : current ? M.taupe : M.card;
  const labelColor = linked ? DL.linked : current ? M.taupe : M.ink;
  const lineColor = last ? "transparent" : nextPending ? DL.line : DL.linkedLine;
  const content = (
    <>
      <span
        aria-hidden
        style={{
          width: 24, height: 24, flex: "none", boxSizing: "border-box", borderRadius: "50%", background: dotBg,
          border: node.state === "pending" ? `1.5px dashed ${DL.disabled}` : "none", color: "#FFFFFF",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        {linked ? <Check size={13} strokeWidth={3} /> : current ? <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#FFFFFF" }} /> : null}
      </span>
      <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
        <span style={{ display: "block", fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: labelColor }}>{node.label}</span>
        <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: M.raisin, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{node.doc}</span>
        <span style={{ display: "block", fontSize: 12, color: M.ink, marginTop: 1 }}>{node.sub}</span>
      </span>
      {node.onClick ? <ChevronRight size={17} strokeWidth={1.9} color={DL.icon} aria-hidden style={{ flex: "none" }} /> : null}
    </>
  );
  const base = { position: "relative" as const, display: "flex", alignItems: "center", gap: 12, width: "100%", minHeight: 56, padding: "6px 0" };
  return (
    <li style={{ position: "relative" }}>
      <span aria-hidden style={{ position: "absolute", left: 11, top: 34, bottom: -6, width: 2, background: lineColor }} />
      {node.onClick ? (
        <button type="button" onClick={node.onClick} style={{ ...base, background: "none", border: "none", fontFamily: "inherit", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
          {content}
        </button>
      ) : (
        <div style={base}>{content}</div>
      )}
    </li>
  );
}

function MenuRow({ icon: Icon, label, onClick, first }: { icon: typeof QrCode; label: string; onClick: () => void; first?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, minHeight: 54, padding: "0 15px", background: "none", border: "none", borderTop: first ? "none" : `1px solid ${DL.track}`, fontFamily: "inherit", cursor: "pointer", textAlign: "left" }}
    >
      <span style={{ width: 34, height: 34, flex: "none", borderRadius: 10, background: DL.tile, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon size={17} strokeWidth={1.9} color={M.taupe} />
      </span>
      <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: M.raisin }}>{label}</span>
    </button>
  );
}

function LorrySheet({
  open,
  doNo,
  current,
  onClose,
  onAssign,
}: {
  open: boolean;
  doNo: string;
  current: string;
  onClose: () => void;
  onAssign: (lorryId: string) => Promise<string | null>;
}) {
  const lorries = useCachedJson<{ success?: boolean; data?: RawRow[] } | RawRow[]>(open ? "/api/lorries" : null);
  const list = Array.isArray(lorries.data) ? (lorries.data as RawRow[]) : rows((lorries.data as { data?: RawRow[] } | null)?.data);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    setPick("");
    setErr(null);
  }
  const chosen = pick || current;
  return (
    <Sheet open={open} onClose={busy ? () => undefined : onClose} title="Assign lorry">
      <SheetSub>{doNo}</SheetSub>
      {lorries.loading && !lorries.data ? (
        <div style={{ fontSize: 12.5, color: M.ink }}>Loading lorries…</div>
      ) : list.length === 0 ? (
        <Notice>No lorries set up. Add them on desktop.</Notice>
      ) : (
        <div role="radiogroup" aria-label="Lorry" style={{ display: "grid", gap: 6 }}>
          {list.map((l) => (
            <RadioRow
              key={s(l, "id")}
              on={chosen === s(l, "id")}
              label={[s(l, "name"), s(l, "plateNumber")].filter(Boolean).join(" — ") || "Lorry"}
              sub={[s(l, "driverName"), n(l, "capacity") ? `${n(l, "capacity")} m³` : ""].filter(Boolean).join(" · ")}
              onClick={() => setPick(s(l, "id"))}
            />
          ))}
        </div>
      )}
      {err ? <div role="alert" style={{ marginTop: 10, fontSize: 12.5, fontWeight: 600, color: sem("danger") }}>{err}</div> : null}
      <SheetFooter
        onCancel={onClose}
        confirmLabel="Assign"
        busy={busy}
        onConfirm={async () => {
          if (!chosen) {
            setErr("Pick a lorry");
            return;
          }
          if (chosen === current) {
            onClose();
            return;
          }
          setBusy(true);
          const e = await onAssign(chosen);
          setBusy(false);
          if (e) setErr(e);
        }}
      />
    </Sheet>
  );
}
