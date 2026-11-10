// ===========================================================================
// CaseDetailScreen — L2 Service Case detail (Claude Design "Service Cases Phase 4").
// Header card (status actions) + six pages: Overview · Issue & evidence ·
// Service orders · Root cause · Action taken · Replacement parts.
//
// Case STATUS (OPEN/IN_PROGRESS/CLOSED/CANCELLED) and the derived 8-step STAGE
// are separate: stage comes from computeCasePipeline (desktop's one source),
// status buttons call PUT /api/service-cases/:id/status and the server enforces
// the transitions (Close is final; Cancel remembers the prior status; neither
// touches child orders or stock; nothing auto-closes the case).
// ===========================================================================
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SV_NEW_PATH } from "../orders/order-model";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowUpRight, Ban, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, Clock, Ellipsis, Eye, FileDown, Hourglass, Info,
  Lock, Package, PackageMinus, Paperclip, Phone, Play, Plus, RotateCcw, SearchCheck, Unlink, Wrench,
} from "lucide-react";
import { isUnknownOutcome, useCachedJson } from "@/lib/cached-fetch";
import { RecordLoadError } from "@/components/ui/record-load-error";
import { computeCasePipeline, caseDaysOpen, caseStageDays } from "@/lib/case-pipeline";
import { MobileHeader, Sheet } from "../../components";
import { useResponsiveLayout } from "../../lib/responsive-layout";
import { M } from "../../theme";
import { mutateJson, refreshList, refreshOne } from "../../config/mutate";
import {
  ALLOWED_TRANSITIONS, CASE_PIPELINE_STEPS, CATEGORY_TONE, DEFAULT_TONE, ROOT_CAUSE_SHORT, STAGE_TONE, STATUS_LABEL, STATUS_TONE,
  fmtDay, fmtDayYear, tc, type CaseOrder, type CaseStatus, type DeliveryOrderApi, type RootCause, type ServiceCaseApi,
} from "./case-model";
import { Caption, EditPill, EmptyCard, IconBtn, IconTile, Msg, Note, Pill, RefChip, SectionLabel, StageBar, Tag } from "./case-ui";
import { CC, SH_CARD, SH_CTRL, SH_PRIMARY } from "./case-style";
import { PhotoViewer } from "./case-overlay";
import { useCasePerms, useCaseToast } from "./case-hooks";
import { RelationshipMap } from "./RelationshipMap";
import { CausesSheet, IssueSheet, LogSheet, PhotosSheet, ProductsSheet, type EditKind } from "./CaseEditSheets";
import { FilesSheet, IssuePartSheet, LegacyOrderSheet } from "./CaseOpsSheets";
import { casePoRefs, downloadCasePdf, type CasePoRow, type CustomerRecord } from "./case-pdf";

type TabKey = "overview" | "issue" | "orders" | "cause" | "action" | "parts";
type ConfirmKind = "close" | "cancel" | "undo" | null;
type AdjRow = { id: string; adjNo: string; type: string; itemCode: string; itemName: string; qtyDelta: number; adjustedAt: string; adjustedByName: string; notes: string };

const ORDER_TONE: Record<string, { bg: string; fg: string }> = {
  OPEN: STATUS_TONE.OPEN, IN_PRODUCTION: STATUS_TONE.IN_PROGRESS, RESERVED: STATUS_TONE.IN_PROGRESS, IN_REPAIR: STATUS_TONE.IN_PROGRESS, CONFIRMED: STATUS_TONE.IN_PROGRESS,
  READY_TO_SHIP: { bg: "#DCEBDC", fg: "#3A6B3A" }, DELIVERED: { bg: "#DCEBDC", fg: "#3A6B3A" }, CLOSED: STATUS_TONE.CLOSED, DRAFT: STATUS_TONE.CLOSED, CANCELLED: STATUS_TONE.CANCELLED,
};
const DETAIL_LABELS: [string, string][] = [
  ["departmentName", "Department"], ["designDeptName", "Department unable to fulfil"], ["workerName", "Worker / PIC"], ["itemGroup", "Item group"],
  ["rawMaterialCode", "Raw material"], ["supplierName", "Supplier"], ["threePlCompany", "3PL company"], ["doNo", "DO no"], ["driverName", "Driver"],
  ["sopName", "SOP name"], ["salesPerson", "Salesperson"], ["notes", "Notes"], ["suggestedFix", "Suggested fix"],
];
const HEADER_H = 52;

export function CaseDetailScreen() {
  const { id = "" } = useParams();
  // Keyed so switching cases (tablet split view) starts on Overview with fresh sheet state.
  return <CaseDetailInner key={id} id={id} />;
}

function CaseDetailInner({ id }: { id: string }) {
  const navigate = useNavigate();
  const { mode } = useResponsiveLayout();
  const tablet = mode !== "phone";
  const perms = useCasePerms();
  const toast = useCaseToast();
  const caseUrl = id ? `/api/service-cases/${encodeURIComponent(id)}` : null;
  const { data, loading, failure, refresh } = useCachedJson<{ data?: ServiceCaseApi; success?: boolean }>(caseUrl);
  const raw = data?.data ?? null;
  const c = useMemo<ServiceCaseApi | null>(() => (raw ? { ...raw, orders: raw.orders ?? [], affectedProducts: raw.affectedProducts ?? [] } : null), [raw]);

  const { data: cust } = useCachedJson<{ success?: boolean; data?: CustomerRecord & { phone?: string } }>(c?.customerId ? `/api/customers/${encodeURIComponent(c.customerId)}` : null);
  const customer = cust?.success === false ? null : cust?.data ?? null;

  const svIds = useMemo(() => (c?.orders ?? []).filter((o) => o.isSv).map((o) => o.id), [c]);
  const scope = svIds.map(encodeURIComponent).join(",");
  const { data: doR } = useCachedJson<{ data?: DeliveryOrderApi[] }>(svIds.length ? `/api/delivery-orders?fields=case-pipeline&scope=${scope}` : null);
  const { data: poR } = useCachedJson<{ data?: CasePoRow[] }>(svIds.length ? `/api/production-orders?fields=minimal&include=jobCards&scope=${scope}` : null);
  const { data: adj, loading: adjLoading, error: adjError } = useCachedJson<{ data?: AdjRow[] }>(c ? `/api/stock-adjustments?caseId=${encodeURIComponent(c.id)}` : null);

  const pipe = useMemo(() => {
    if (!c) return null;
    return computeCasePipeline({
      caseStatus: c.status,
      createdAt: c.createdAt,
      investigatingAt: c.investigatingAt ?? null,
      closedAt: c.closedAt || null,
      orders: c.orders.map((o) => ({ isSv: o.isSv, status: o.status, createdAt: o.createdAt })),
      dos: doR?.data ?? [],
      pos: poR?.data ?? [],
      svOrderIds: svIds,
    });
  }, [c, doR, poR, svIds]);

  const [now] = useState(() => Date.now());
  const [tab, setTab] = useState<TabKey>("overview");
  const [edit, setEdit] = useState<EditKind | null>(null);
  const [confirm, setConfirm] = useState<ConfirmKind>(null);
  const [actions, setActions] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [legacyOpen, setLegacyOpen] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stagesOpen, setStagesOpen] = useState(false);
  const [viewer, setViewer] = useState<number | null>(null);
  const tabsRef = useRef<HTMLDivElement>(null);

  // Keep the selected section tab in view inside the horizontal strip (the strip scrolls, the page does not).
  useEffect(() => {
    const strip = tabsRef.current;
    const el = strip?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!strip || !el) return;
    const left = el.offsetLeft - (strip.clientWidth - el.offsetWidth) / 2;
    strip.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [tab, c?.id]);

  const back = () => navigate("/m/servicecases");
  if (!id) return <Msg icon={Unlink} text="No case selected" />;
  if (loading && !c) return (<><MobileHeader title="Service case" onBack={back} /><div style={{ padding: "8px 18px" }} aria-busy="true"><div style={{ height: 180, borderRadius: 16, background: "#EFEAE1" }} /></div></>);
  // A timeout / network / 5xx proves nothing about the record; only the server's 404 means it is absent.
  if (!c && failure && isUnknownOutcome(failure)) {
    return (
      <>
        <MobileHeader title="Service case" onBack={back} />
        <RecordLoadError subject="service case" failure={failure} onRetry={refresh} backTo="/m/servicecases" backLabel="Service Cases" />
      </>
    );
  }
  if (!c || !pipe) {
    return (<><MobileHeader title="Service case" onBack={back} /><Msg icon={Unlink} text={failure?.kind === "notFound" ? "Case not found" : "Loading…"} /></>);
  }

  const st = c.status;
  const active = st === "OPEN" || st === "IN_PROGRESS";
  const frozen = st === "CLOSED" || st === "CANCELLED" ? c.closedAt || null : null;
  const daysOpen = caseDaysOpen(c.createdAt, frozen, now);
  const stageDays = caseStageDays(pipe.enteredAt, frozen, now);
  const canWrite = perms.update;
  // Desktop: Edit is available for every status except CANCELLED (closed cases can still be corrected).
  const canEdit = canWrite && st !== "CANCELLED";
  const stageLabel = pipe.cancelled ? "Cancelled" : pipe.label;
  const refs = casePoRefs(poR?.data ?? [], svIds);
  const customerPO = refs.po || c.customerPO || "";
  const firstSv = c.orders.find((o) => o.isSv);
  const anchor = firstSv?.id ?? (c.sourceType === "SO" && c.sourceId ? c.sourceId : "");
  const sourceHref = c.sourceType === "SO" && c.sourceId ? `/m/sales/${encodeURIComponent(c.sourceId)}` : null;
  const causes: RootCause[] = c.rootCauses && c.rootCauses.length ? c.rootCauses : c.rootCauseCategory ? [{ category: c.rootCauseCategory, details: c.rootCauseDetails ?? {} }] : [];
  const phone = customer?.phone || customer?.mobile || "";
  const parts = adj?.data ?? [];
  const photos = c.issuePhotos ?? [];

  const setStatus = async (to: CaseStatus) => {
    setBusy(true);
    const r = await mutateJson(`/api/service-cases/${encodeURIComponent(c.id)}/status`, "PUT", { status: to });
    setBusy(false);
    setConfirm(null);
    if (!r.ok) return toast.show(r.error || "Status update failed. Nothing changed.", "error");
    refreshOne(`/api/service-cases/${encodeURIComponent(c.id)}`);
    refreshList("/api/service-cases");
    toast.show(`${c.caseNo} → ${STATUS_LABEL[to]}`);
  };
  const undoTarget: CaseStatus = c.preCancelStatus === "IN_PROGRESS" ? "IN_PROGRESS" : "OPEN";
  const openOrder = (o: CaseOrder) => navigate(o.isSv ? `/m/sales/${encodeURIComponent(o.id)}` : `/m/serviceorders/${encodeURIComponent(o.id)}`);

  const pdf = async () => {
    setActions(false);
    toast.show("Building PDF…", "info");
    try {
      await downloadCasePdf({ c, customer, pipe, pos: poR?.data ?? [] });
    } catch {
      toast.show("Couldn’t build the report — try again. Nothing was downloaded.", "error");
    }
  };

  const banner: { text: string; bg: string; fg: string; icon: typeof Info } | null = !canWrite
    ? { text: "View only — your role can’t change this case.", bg: CC.tile, fg: CC.brown, icon: Eye }
    : st === "CANCELLED"
      ? { text: "Cancelled · read-only. Undo cancel to make changes again.", bg: CC.errBg, fg: CC.dangerDark, icon: Ban }
      : st === "CLOSED"
        ? { text: "Closed · can’t be reopened. Details can still be corrected.", bg: CC.tile, fg: CC.brown, icon: Lock }
        : null;
  const sharedEdit = { c, onToast: (t: string, tone?: "success" | "error") => toast.show(t, tone ?? "success") };
  const tabs: [TabKey, string, number][] = [
    ["overview", "Overview", 0], ["issue", "Issue & evidence", 0], ["orders", "Service orders", c.orders.length],
    ["cause", "Root cause", causes.length], ["action", "Action taken", 0], ["parts", "Replacement parts", parts.length],
  ];
  const colsTwo = tablet ? "repeat(2,minmax(0,1fr))" : "minmax(0,1fr)";
  const edits = (k: EditKind, label: string) => (canEdit ? <EditPill onClick={() => setEdit(k)} aria={label} /> : null);

  return (
    <>
      {/* Header: back · case no + status pill · round "…" */}
      <div style={{ position: "sticky", top: 0, zIndex: 40, background: "rgba(250,248,244,.95)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, height: HEADER_H, padding: "0 14px 0 12px", boxSizing: "border-box" }}>
          <button type="button" onClick={back} aria-label="Back to Service Cases" style={{ width: 44, height: 44, marginLeft: -10, background: "none", border: "none", padding: 0, flex: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: M.raisin }}>
            <ChevronLeft size={24} strokeWidth={1.9} />
          </button>
          <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ minWidth: 0, fontSize: 18, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontVariantNumeric: "tabular-nums" }}>{c.caseNo}</span>
            <Pill label={STATUS_LABEL[st]} tone={STATUS_TONE[st]} dot={STATUS_TONE[st].fg} />
          </div>
          <IconBtn label="More actions" onClick={() => setActions(true)}><Ellipsis size={20} strokeWidth={2} /></IconBtn>
        </div>
      </div>

      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        {/* Header card */}
        <div style={{ padding: "2px 18px 0" }}>
          <div style={{ background: M.card, borderRadius: 16, boxShadow: SH_CARD, padding: "14px 15px" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: M.raisin, lineHeight: 1.35, wordBreak: "break-word" }}>{c.customerName}</div>
            {customer?.code || phone ? (
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 10px", marginTop: 3, fontSize: 12.5, color: M.ink, fontVariantNumeric: "tabular-nums" }}>
                {customer?.code ? <span>{customer.code}</span> : null}
                {phone ? <a href={`tel:${phone}`} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12.5, fontWeight: 600, color: CC.brown, textDecoration: "none", minHeight: 24 }}><Phone size={13} strokeWidth={2} />{phone}</a> : null}
              </div>
            ) : null}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
              {c.sourceType === "EXTERNAL"
                ? <RefChip k="External" v={c.externalRef || "—"} h={26} fs={11.5} />
                : <RefChip k={c.sourceType} v={c.sourceNo || "—"} h={26} fs={11.5} onClick={sourceHref ? () => navigate(sourceHref) : undefined} icon={sourceHref ? <ArrowUpRight size={12} strokeWidth={2.2} color={CC.brown} /> : undefined} />}
              <RefChip k="PO" v={customerPO || "—"} h={26} fs={11.5} />
            </div>
            <div style={{ fontSize: 12, color: M.ink, marginTop: 9 }}>Opened {fmtDayYear(c.createdAt)}{c.createdByName ? ` · by ${c.createdByName}` : ""}</div>
            {banner ? (
              <div style={{ marginTop: 12 }}><Note icon={banner.icon} bg={banner.bg} fg={banner.fg} color="#3A352C">{banner.text}</Note></div>
            ) : null}
            {canWrite && st !== "CLOSED" ? (
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                {st === "OPEN" ? <HeaderAction primary icon={<Play size={16} strokeWidth={2} />} disabled={busy} onClick={() => void setStatus("IN_PROGRESS")}>Mark in progress</HeaderAction> : null}
                {st === "OPEN" ? <HeaderAction icon={<CircleCheck size={16} strokeWidth={2} />} onClick={() => setConfirm("close")}>Close</HeaderAction> : null}
                {st === "IN_PROGRESS" ? <HeaderAction primary icon={<CircleCheck size={16} strokeWidth={2} />} onClick={() => setConfirm("close")}>Close case</HeaderAction> : null}
                {st === "CANCELLED" ? <HeaderAction primary icon={<RotateCcw size={16} strokeWidth={2} />} onClick={() => setConfirm("undo")}>Undo cancel</HeaderAction> : null}
              </div>
            ) : null}
          </div>
        </div>

        {/* Pinned section tabs */}
        <div ref={tabsRef} role="tablist" aria-label="Case sections" style={{ position: "sticky", top: `calc(${HEADER_H}px + env(safe-area-inset-top, 0px))`, zIndex: 5, display: "flex", gap: 8, overflowX: "auto", padding: "12px 18px 10px", background: M.paper, scrollbarWidth: "none" }}>
          {tabs.map(([k, l, n]) => {
            const on = tab === k;
            return (
              <button key={k} type="button" role="tab" aria-selected={on} onClick={() => setTab(k)} style={{ flex: "none", height: 34, padding: "0 13px", borderRadius: 999, border: "none", background: on ? CC.brown : M.card, color: on ? "#FFFFFF" : CC.chipText, fontFamily: "inherit", fontSize: 12.5, fontWeight: on ? 700 : 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", boxShadow: on ? "0 6px 14px -6px rgba(107,92,50,.6)" : SH_CTRL, WebkitTapHighlightColor: "transparent" }}>
                {l}{n ? <span style={{ fontVariantNumeric: "tabular-nums", opacity: 0.8 }}>{n}</span> : null}
              </button>
            );
          })}
        </div>

        <div style={{ padding: "4px 18px 40px", display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 14 }}>
          {tab === "overview" ? (
            <>
              <section aria-label="Progress" style={{ background: M.card, borderRadius: 16, boxShadow: SH_CARD, padding: 15 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ flex: 1, fontSize: 11, fontWeight: 700, letterSpacing: "1px", color: CC.brown }}>PROGRESS</span>
                  <span style={{ fontSize: 11.5, color: M.ink, whiteSpace: "nowrap" }}>Derived, not the case status</span>
                </div>
                <div style={{ marginTop: 12 }}><StageBar index={pipe.index} cancelled={pipe.cancelled} h={6} /></div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <Tag label={pipe.cancelled ? "Cancelled" : `${pipe.index + 1} of 8 · ${pipe.label}`} tone={STAGE_TONE[stageLabel] ?? DEFAULT_TONE} h={24} />
                  <span style={{ fontSize: 12.5, color: M.ink, fontVariantNumeric: "tabular-nums" }}>
                    {pipe.cancelled ? "Stage shown as cancelled" : st === "CLOSED" ? `Closed · open ${daysOpen} day${daysOpen === 1 ? "" : "s"}` : `In stage ${stageDays} day${stageDays === 1 ? "" : "s"}${pipe.enteredAt ? ` · since ${fmtDay(pipe.enteredAt)}` : ""}`}
                  </span>
                </div>
                <div style={{ fontSize: 11.5, lineHeight: 1.45, color: CC.hint, marginTop: 8 }}>Furthest step any order has reached — other orders may still be active.</div>
                <button type="button" onClick={() => setStagesOpen((v) => !v)} aria-expanded={stagesOpen} style={{ width: "100%", height: 40, margin: "8px 0 -6px", border: "none", borderTop: `1px solid ${CC.sep}`, background: "none", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, color: CC.brown, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                  {stagesOpen ? "Hide stages" : "View all 8 stages"}
                  <span style={{ display: "flex", transform: stagesOpen ? "rotate(180deg)" : "none" }}><ChevronDown size={15} strokeWidth={2} /></span>
                </button>
                {stagesOpen ? (
                  <ol style={{ listStyle: "none", margin: "12px 0 0", padding: 0 }}>
                    {CASE_PIPELINE_STEPS.map((s, i) => {
                      const done = pipe.doneFlags[i];
                      const here = i === pipe.index && !pipe.cancelled;
                      let date: string | null = null;
                      if (i === 0) date = c.createdAt || null;
                      else if (i === 1) date = c.investigatingAt ?? c.createdAt ?? null;
                      else if (i === 7) date = c.closedAt || null;
                      if (i === pipe.index && !date) date = pipe.enteredAt;
                      return (
                        <li key={s} style={{ position: "relative", display: "flex", gap: 11, paddingBottom: i === 7 ? 0 : 12 }}>
                          {i < 7 ? <span aria-hidden style={{ position: "absolute", left: 6, top: 15, bottom: 0, width: 2, background: done && pipe.doneFlags[i + 1] ? CC.brown : CC.track }} /> : null}
                          <span aria-hidden style={{ position: "relative", width: 14, height: 14, flex: "none", boxSizing: "border-box", borderRadius: "50%", marginTop: 2, background: done && !here ? CC.brown : "#fff", border: `2px solid ${done ? CC.brown : CC.track}` }} />
                          <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: here ? 700 : 500, color: done ? M.raisin : CC.hint }}>{s}</span>
                          <span style={{ flex: "none", fontSize: 12, color: M.ink, fontVariantNumeric: "tabular-nums" }}>{done ? fmtDay(date) : ""}</span>
                        </li>
                      );
                    })}
                  </ol>
                ) : null}
              </section>

              <section aria-label="Summary" style={{ background: M.card, borderRadius: 16, boxShadow: SH_CARD, overflow: "hidden" }}>
                <button type="button" onClick={() => setTab("issue")} style={{ width: "100%", display: "block", padding: "14px 15px", border: "none", background: "none", fontFamily: "inherit", textAlign: "left", cursor: "pointer" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ flex: 1, fontSize: 11, fontWeight: 700, letterSpacing: "1px", color: CC.brown }}>ISSUE</span>
                    <ChevronRight size={16} strokeWidth={2} color={CC.brownSoft} />
                  </div>
                  <div style={{ fontSize: 13.5, lineHeight: 1.5, color: M.raisin, marginTop: 6, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden", whiteSpace: "pre-wrap" }}>{c.issueDescription || "No description recorded."}</div>
                </button>
                {([["Affected products", c.affectedProducts.length, "issue", Package], ["Root causes", causes.length, "cause", SearchCheck], ["Service orders", c.orders.length, "orders", Wrench]] as [string, number, TabKey, typeof Package][]).map(([l, n, t, I]) => (
                  <button key={l} type="button" onClick={() => setTab(t)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, minHeight: 50, padding: "0 15px", border: "none", borderTop: `1px solid ${CC.sep}`, background: "none", fontFamily: "inherit", textAlign: "left", cursor: "pointer" }}>
                    <IconTile icon={I} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: M.raisin }}>{l}</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums" }}>{n}</span>
                    <ChevronRight size={16} strokeWidth={2} color={CC.brownSoft} />
                  </button>
                ))}
              </section>

              {!pipe.cancelled ? (() => {
                const cues: [typeof Clock, string, string][] = [];
                if (!causes.length) cues.push([SearchCheck, "No root cause recorded yet", "Add one in Root cause when known."]);
                if (active && daysOpen >= 7) cues.push([Clock, `Open for ${daysOpen} days`, "Days open counts from when the case was opened."]);
                if (active && stageDays >= 7) cues.push([Hourglass, `${stageDays} days at “${pipe.label}”`, "Time since the case reached its current stage."]);
                if (!c.orders.length) cues.push([Info, "No service order linked", "Fine if the case is resolved without one."]);
                if (!cues.length) return null;
                return (
                  <section aria-label="Review cues">
                    <SectionLabel hint="For your review — not errors">Review cues</SectionLabel>
                    <div style={{ background: M.card, borderRadius: 16, boxShadow: SH_CARD, padding: "4px 15px" }}>
                      {cues.map(([I, t, s], i) => (
                        <div key={t} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "11px 0", borderTop: i ? `1px solid ${CC.sep}` : "none" }}>
                          <span style={{ display: "flex", marginTop: 1 }}><I size={15} strokeWidth={2} color={CC.brownSoft} /></span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: M.raisin }}>{t}</div>
                            <div style={{ fontSize: 12, lineHeight: 1.45, color: M.ink, marginTop: 2 }}>{s}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                );
              })() : null}
            </>
          ) : null}

          {tab === "issue" ? (
            <>
              <section aria-label="Issue description">
                <SectionLabel right={edits("issue", "Edit issue description")}>Issue description</SectionLabel>
                <div style={{ background: M.card, borderRadius: 16, boxShadow: SH_CARD, padding: "14px 15px", fontSize: 13.5, lineHeight: 1.6, color: M.raisin, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {c.issueDescription || <span style={{ color: M.ink }}>No description recorded.</span>}
                </div>
              </section>
              <section aria-label="Issue photos">
                <SectionLabel count={photos.length} right={edits("photos", "Edit issue photos")}>Issue photos</SectionLabel>
                {photos.length === 0 ? <EmptyCard>No issue photos on this case.</EmptyCard> : (
                  <div style={{ display: "grid", gridTemplateColumns: `repeat(${tablet ? 5 : 3},minmax(0,1fr))`, gap: 8 }}>
                    {photos.map((src, i) => (
                      <button key={i} type="button" aria-label={`Open photo ${i + 1}`} onClick={() => setViewer(i)} style={{ aspectRatio: "1 / 1", border: "none", borderRadius: 12, padding: 0, cursor: "pointer", overflow: "hidden", background: "repeating-linear-gradient(135deg,#F4EFE6 0 8px,#EDE5D6 8px 16px)", color: CC.brown }}>
                        <img src={src} alt={`Issue photo ${i + 1}`} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                      </button>
                    ))}
                  </div>
                )}
                <Caption>Photos are case data. Adding or removing a photo saves immediately. Files in ⋯ are a separate store.</Caption>
              </section>
              <section aria-label="Affected products">
                <SectionLabel count={c.affectedProducts.length} right={edits("products", "Edit affected products")}>Affected products</SectionLabel>
                {c.affectedProducts.length === 0 ? <EmptyCard>No affected products recorded.</EmptyCard> : (
                  <div style={{ display: "grid", gridTemplateColumns: colsTwo, gap: 10 }}>
                    {c.affectedProducts.map((p) => (
                      <div key={p.productId || p.code} style={{ background: M.card, borderRadius: 16, boxShadow: SH_CARD, padding: "13px 15px" }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                          <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, color: M.raisin, overflowWrap: "anywhere" }}>{p.name || p.code}</span>
                          {p.qty ? <span style={{ flex: "none", fontSize: 12.5, color: M.ink, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>Qty {p.qty}</span> : null}
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: CC.brown, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{p.code}</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 9 }}>
                          {p.components?.length
                            ? p.components.map((x) => <Tag key={x.key} label={`${x.label}${x.qty > 1 ? ` ×${x.qty}` : ""}`} tone={{ bg: CC.errBg, fg: CC.dangerDark }} weight={600} />)
                            : <Tag label="Whole product" tone={{ bg: CC.sep, fg: "#5A5550" }} weight={600} />}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <Caption>Product and damaged-part changes save immediately. Parts come from the product’s BOM; none picked means the whole product.</Caption>
              </section>
            </>
          ) : null}

          {tab === "orders" ? (
            <>
              <section aria-label="Relationship map">
                <div style={{ margin: "0 2px 10px" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1px", color: CC.brown }}>RELATIONSHIP MAP</div>
                  <div style={{ fontSize: 12, lineHeight: 1.45, color: M.ink, marginTop: 3 }}>How this case’s order links to its sources and everything generated downstream. Grey means not created yet — the caption says when it will be.</div>
                </div>
                {anchor ? <RelationshipMap anchorId={anchor} anchorIsSv={!!firstSv} /> : (
                  <div style={{ background: M.card, borderRadius: 16, boxShadow: SH_CARD, padding: 16, display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <Unlink size={16} strokeWidth={2} color={CC.hint} style={{ flex: "none", marginTop: 1 }} />
                    <div style={{ fontSize: 12.5, lineHeight: 1.45, color: M.ink }}><b style={{ color: M.raisin }}>No relationship map</b><br />This case has no SV order and no source sales order, so there is nothing to anchor the map to.</div>
                  </div>
                )}
              </section>

              <section aria-label="Service orders">
                <SectionLabel count={c.orders.length}>Service orders</SectionLabel>
                {c.orders.length === 0 ? <EmptyCard>No service orders linked. A case can be resolved without one.</EmptyCard> : (
                  <div style={{ display: "grid", gridTemplateColumns: colsTwo, gap: 10 }}>
                    {c.orders.map((o) => {
                      const tone = ORDER_TONE[o.status] ?? DEFAULT_TONE;
                      return (
                        <div key={o.id} role="button" tabIndex={0} onClick={() => openOrder(o)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openOrder(o); } }} style={{ position: "relative", overflow: "hidden", minWidth: 0, background: M.card, borderRadius: 16, boxShadow: SH_CARD, padding: "13px 14px 12px 17px", cursor: "pointer" }}>
                          <span aria-hidden style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: tone.fg }} />
                          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                            <span style={{ minWidth: 0, fontSize: 14, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontVariantNumeric: "tabular-nums" }}>{o.serviceOrderNo}</span>
                            <Pill label={tc(o.status)} tone={tone} />
                            <span style={{ flex: 1 }} />
                            <ChevronRight size={18} strokeWidth={1.9} color={CC.brownSoft} />
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
                            <Tag label={o.isSv ? "SV service order" : "Legacy service order"} tone={o.isSv ? { bg: "#E0EAF4", fg: "#3A5670" } : { bg: CC.sep, fg: "#5A5550" }} />
                            <Tag label={o.isSv ? "Sales workflow" : o.mode ? tc(o.mode) : "No mode yet"} tone={{ bg: CC.tile, fg: M.ink }} weight={600} />
                          </div>
                          {o.createdAt ? <div style={{ fontSize: 12, color: M.ink, marginTop: 8 }}>Created {fmtDay(o.createdAt)}</div> : null}
                        </div>
                      );
                    })}
                  </div>
                )}
                {active && c.sourceType === "EXTERNAL" && perms.createServiceOrder ? (
                  <div style={{ background: M.card, borderRadius: 16, boxShadow: SH_CARD, padding: "13px 15px", marginTop: 10 }}>
                    <PrimaryButton icon={<Plus size={16} strokeWidth={2.2} />} onClick={() => setLegacyOpen(true)}>New legacy service order</PrimaryButton>
                    <div style={{ fontSize: 12, lineHeight: 1.45, color: M.ink, marginTop: 8 }}>External case → legacy order. Pick Reproduce, Stock swap or Repair. Reproduce and Stock swap need an approved exchange first.</div>
                  </div>
                ) : null}
                {active && c.sourceType !== "EXTERNAL" && perms.createSalesOrder ? (
                  <div style={{ background: M.card, borderRadius: 16, boxShadow: SH_CARD, padding: "13px 15px", marginTop: 10 }}>
                    <PrimaryButton icon={<Plus size={16} strokeWidth={2.2} />} onClick={() => navigate(`${SV_NEW_PATH}?fromCase=${encodeURIComponent(c.id)}`)}>New SV service order</PrimaryButton>
                    <div style={{ fontSize: 12, lineHeight: 1.45, color: M.ink, marginTop: 8 }}>Phone and tablet creation isn’t available yet. Tap to see how to create it for now.</div>
                  </div>
                ) : null}
                {!active ? <Caption>New service orders can’t be added to a closed or cancelled case.</Caption> : (c.sourceType === "EXTERNAL" ? !perms.createServiceOrder : !perms.createSalesOrder) ? <Caption>Your role can view service orders but not create them.</Caption> : null}
              </section>
            </>
          ) : null}

          {tab === "cause" ? (
            <>
              <section aria-label="Root causes">
                <SectionLabel count={causes.length} right={edits("causes", "Edit root causes")}>Root causes</SectionLabel>
                {causes.length === 0 ? <EmptyCard>No root cause recorded yet.</EmptyCard> : (
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 10 }}>
                    {causes.map((rc, i) => <CauseCard key={i} rc={rc} defaultOpen={i === 0} />)}
                  </div>
                )}
                <Caption>Worker / PIC is who is responsible for the issue — not an assigned technician.</Caption>
              </section>
              <section aria-label="Prevention">
                <SectionLabel right={edits("causes", "Edit prevention")}>Prevention</SectionLabel>
                <div style={{ background: M.card, borderRadius: 16, boxShadow: SH_CARD, padding: "4px 15px" }}>
                  {([["Prevention action", c.preventionAction], ["Owner", c.preventionOwner], ...(c.responsibleUnit ? [["Responsible unit", c.responsibleUnit]] : [])] as [string, string | null | undefined][]).map(([k, v], i) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 14, padding: "11px 0", borderTop: i ? `1px solid ${CC.sep}` : "none", fontSize: 12.5 }}>
                      <span style={{ flex: "none", color: M.ink }}>{k}</span>
                      <span style={{ minWidth: 0, textAlign: "right", fontWeight: 600, color: v ? M.raisin : CC.hint, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{v || "Not set"}</span>
                    </div>
                  ))}
                </div>
              </section>
            </>
          ) : null}

          {tab === "action" ? (
            <>
              <section aria-label="Action taken">
                <SectionLabel count={(c.actionLog ?? []).length} right={edits("log", "Edit action log")}>Action taken</SectionLabel>
                {(c.actionLog ?? []).length === 0 ? <EmptyCard>No actions recorded yet.</EmptyCard> : (
                  <div style={{ background: M.card, borderRadius: 16, boxShadow: SH_CARD, padding: "14px 15px 2px" }}>
                    <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
                      {(c.actionLog ?? []).map((a, i, all) => (
                        <li key={a.id ?? i} style={{ position: "relative", display: "flex", gap: 12, paddingBottom: 14 }}>
                          {i < all.length - 1 ? <span aria-hidden style={{ position: "absolute", left: 5, top: 14, bottom: 0, width: 2, background: CC.track }} /> : null}
                          <span aria-hidden style={{ position: "relative", width: 12, height: 12, flex: "none", boxSizing: "border-box", borderRadius: "50%", marginTop: 3, background: "#fff", border: `2.5px solid ${CC.brown}` }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: CC.brown, fontVariantNumeric: "tabular-nums" }}>{fmtDayYear(a.date)}{a.createdByName ? <span style={{ fontWeight: 500, color: M.ink }}> · {a.createdByName}</span> : null}</div>
                            <div style={{ fontSize: 13, lineHeight: 1.5, color: M.raisin, marginTop: 2, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{a.description}</div>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                <Caption>An editable log saved with the case — not a comment thread or audit history.</Caption>
              </section>
              {c.notes ? (
                <section aria-label="Notes">
                  <SectionLabel>Notes</SectionLabel>
                  <div style={{ background: M.card, borderRadius: 16, boxShadow: SH_CARD, padding: "14px 15px", fontSize: 13, lineHeight: 1.55, color: M.raisin, whiteSpace: "pre-wrap" }}>{c.notes}</div>
                </section>
              ) : null}
            </>
          ) : null}

          {tab === "parts" ? (
            <>
              <section aria-label="Issued parts">
                <SectionLabel count={parts.length}>Issued replacement parts</SectionLabel>
                {adjLoading && !adj ? <EmptyCard>Loading…</EmptyCard>
                : adjError && !adj ? <EmptyCard>Couldn’t load issued parts. This is a load failure, not an empty history.</EmptyCard>
                : parts.length === 0 ? <EmptyCard>No replacement parts issued for this case.</EmptyCard> : (
                  <div style={{ display: "grid", gridTemplateColumns: colsTwo, gap: 10 }}>
                    {parts.map((r) => (
                      <div key={r.id} style={{ background: M.card, borderRadius: 16, boxShadow: SH_CARD, padding: "13px 15px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <Tag label={r.type} tone={{ bg: CC.tile, fg: CC.brown }} h={20} />
                          <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.itemName || r.itemCode}</span>
                          <span style={{ flex: "none", fontSize: 14, fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums" }}>{Math.abs(r.qtyDelta)}</span>
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: CC.brown, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>{r.itemCode}</div>
                        <div style={{ fontSize: 12, color: M.ink, marginTop: 6 }}>{fmtDay(r.adjustedAt)}{r.adjustedByName ? ` · issued by ${r.adjustedByName}` : ""}</div>
                        {r.notes ? <div style={{ fontSize: 12, lineHeight: 1.45, color: "#3A352C", marginTop: 6, padding: "8px 10px", borderRadius: 10, background: M.paper }}>{r.notes}</div> : null}
                      </div>
                    ))}
                  </div>
                )}
              </section>
              <section aria-label="Issue part">
                {perms.inventoryCreate ? (
                  <>
                    <PrimaryButton h={46} icon={<PackageMinus size={16} strokeWidth={2} />} onClick={() => setIssueOpen(true)}>Issue replacement part</PrimaryButton>
                    <Caption>Issuing deducts live stock straight away. This is separate from creating a service order.</Caption>
                  </>
                ) : <Note>Issuing parts needs inventory create permission.</Note>}
              </section>
            </>
          ) : null}
        </div>
      </div>

      {/* Case actions */}
      <Sheet open={actions} onClose={() => setActions(false)} title="Case actions">
        <div style={{ background: M.card, borderRadius: 16, boxShadow: SH_CARD, overflow: "hidden", marginBottom: 24 }}>
          <ActionRow icon={FileDown} title="Download PDF" sub="Case report with photos, causes and orders" onClick={() => void pdf()} />
          <ActionRow icon={Paperclip} title="Files" sub="Separate from issue photos" onClick={() => { setActions(false); setFilesOpen(true); }} divider />
          {canWrite && ALLOWED_TRANSITIONS[st].includes("CANCELLED") ? <ActionRow icon={Ban} title="Cancel case" sub="You can undo this later" danger divider onClick={() => { setActions(false); setConfirm("cancel"); }} /> : null}
        </div>
      </Sheet>

      {/* Confirms */}
      <Sheet open={confirm !== null} onClose={() => setConfirm(null)} title={confirm === "close" ? "Close this case?" : confirm === "cancel" ? "Cancel this case?" : "Undo cancel?"}>
        <div style={{ background: M.card, borderRadius: 16, boxShadow: SH_CARD, padding: 15 }}>
          <div style={{ fontSize: 13.5, lineHeight: 1.55, color: M.raisin }}>
            {confirm === "close" ? `${c.caseNo} will be marked Closed.` : confirm === "cancel" ? `${c.caseNo} will be Cancelled and become read-only.` : `${c.caseNo} will go back to ${STATUS_LABEL[undoTarget]}.`}
          </div>
          {(confirm === "close" ? ["Closed cases can’t be reopened.", "Linked service orders are not checked or changed."] : confirm === "cancel" ? ["You can undo this later.", "Linked service orders and stock are not changed."] : ["Any service orders under it are unaffected."]).map((t) => (
            <div key={t} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 8, fontSize: 12.5, lineHeight: 1.45, color: M.ink }}>
              <Info size={14} strokeWidth={2} color={CC.brownSoft} style={{ flex: "none", marginTop: 1 }} /><span>{t}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, margin: "14px 0 24px" }}>
          <button type="button" onClick={() => setConfirm(null)} disabled={busy} style={{ flex: 1, height: 46, border: "none", borderRadius: 12, background: M.card, color: M.ink, fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: SH_CTRL }}>Keep as is</button>
          <button type="button" disabled={busy} onClick={() => void setStatus(confirm === "close" ? "CLOSED" : confirm === "cancel" ? "CANCELLED" : undoTarget)} style={{ flex: 1, height: 46, border: "none", borderRadius: 12, background: confirm === "cancel" ? CC.dangerDark : M.taupe, color: confirm === "cancel" ? "#fff" : "var(--m-text-on-accent)", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>
            {busy ? "Working…" : confirm === "close" ? "Close case" : confirm === "cancel" ? "Cancel case" : `Restore to ${STATUS_LABEL[undoTarget]}`}
          </button>
        </div>
      </Sheet>

      {/* Edit overlays / sheets */}
      <IssueSheet {...sharedEdit} open={edit === "issue"} onClose={() => setEdit(null)} />
      <PhotosSheet {...sharedEdit} open={edit === "photos"} onClose={() => setEdit(null)} />
      <ProductsSheet {...sharedEdit} open={edit === "products"} onClose={() => setEdit(null)} />
      <CausesSheet {...sharedEdit} open={edit === "causes"} onClose={() => setEdit(null)} />
      <LogSheet {...sharedEdit} open={edit === "log"} onClose={() => setEdit(null)} />

      <FilesSheet open={filesOpen} onClose={() => setFilesOpen(false)} c={c} canUpload={perms.filesCreate} />
      <LegacyOrderSheet open={legacyOpen} onClose={() => setLegacyOpen(false)} c={c} onCreated={(oid) => { setLegacyOpen(false); toast.show("Service order created"); navigate(`/m/serviceorders/${encodeURIComponent(oid)}`); }} />
      <IssuePartSheet open={issueOpen} onClose={() => setIssueOpen(false)} c={c} onDone={(m, t) => toast.show(m, t)} />

      {viewer !== null ? <PhotoViewer photos={photos} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} /> : null}
      {toast.node}
    </>
  );
}

function HeaderAction({ children, icon, onClick, primary, disabled }: { children: ReactNode; icon: ReactNode; onClick: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={{ flex: primary ? 1 : "none", minWidth: 0, height: 44, padding: "0 14px", border: "none", borderRadius: 12, background: primary ? M.taupe : M.card, color: primary ? "var(--m-text-on-accent)" : CC.brown, fontFamily: "inherit", fontSize: 13.5, fontWeight: 700, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.6 : 1, whiteSpace: "nowrap", boxShadow: primary ? SH_PRIMARY : SH_CTRL, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, WebkitTapHighlightColor: "transparent" }}>
      {icon}{children}
    </button>
  );
}

function PrimaryButton({ children, icon, onClick, h = 44 }: { children: ReactNode; icon: ReactNode; onClick: () => void; h?: number }) {
  return (
    <button type="button" onClick={onClick} style={{ width: "100%", height: h, border: "none", borderRadius: 12, background: M.taupe, color: "var(--m-text-on-accent)", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
      {icon}{children}
    </button>
  );
}

function ActionRow({ icon, title, sub, onClick, danger, divider }: { icon: typeof Info; title: string; sub: string; onClick: () => void; danger?: boolean; divider?: boolean }) {
  return (
    <button type="button" onClick={onClick} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, minHeight: 56, padding: "8px 15px", background: "none", border: "none", borderTop: divider ? `1px solid ${CC.sep}` : "none", fontFamily: "inherit", cursor: "pointer", textAlign: "left" }}>
      <IconTile icon={icon} size={34} r={10} iconSize={17} bg={danger ? CC.errBg : CC.tile} fg={danger ? CC.dangerDark : CC.brown} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: danger ? CC.dangerDark : M.raisin }}>{title}</span>
        <span style={{ display: "block", fontSize: 12, color: M.ink, marginTop: 2 }}>{sub}</span>
      </span>
    </button>
  );
}

function CauseCard({ rc, defaultOpen }: { rc: RootCause; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const d = rc.details ?? {};
  // details is an OBJECT keyed per category — never rendered as a string.
  const rows = DETAIL_LABELS.map(([k, label]) => [label, k === "workerName" && d.workerEmpNo ? `${String(d.workerName ?? "")} (${String(d.workerEmpNo)})` : typeof d[k] === "string" ? (d[k] as string) : ""] as [string, string]).filter(([, v]) => v.trim());
  const first = rows[0];
  return (
    <div style={{ background: M.card, borderRadius: 16, boxShadow: SH_CARD, overflow: "hidden" }}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, minHeight: 54, padding: "10px 15px", border: "none", background: "none", fontFamily: "inherit", textAlign: "left", cursor: "pointer" }}>
        <Tag label={ROOT_CAUSE_SHORT[rc.category] ?? rc.category} tone={CATEGORY_TONE[rc.category] ?? DEFAULT_TONE} upper />
        <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: first ? M.raisin : CC.hint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{first ? `${first[0]}: ${first[1]}` : "No details"}</span>
        <span style={{ display: "flex", transform: open ? "rotate(180deg)" : "none", color: CC.brownSoft }}><ChevronDown size={17} strokeWidth={2} /></span>
      </button>
      {open ? (
        <div style={{ padding: "0 15px 12px" }}>
          {rows.length === 0 ? <div style={{ fontSize: 12.5, color: CC.hint, padding: "9px 0", borderTop: `1px solid ${CC.sep}` }}>No details recorded.</div> : rows.map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 14, padding: "9px 0", borderTop: `1px solid ${CC.sep}`, fontSize: 12.5 }}>
              <span style={{ flex: "none", color: M.ink }}>{k}</span>
              <span style={{ minWidth: 0, textAlign: "right", fontWeight: 600, color: M.raisin, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{v}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

