// ===========================================================================
// SalesOrderDetail — the Sales Order detail, ONE screen for phone, foldable and tablet.
//
// Owner 2026-10-16: follows Claude Design `Sales Order Detail.dc.html` for the visual
// layout only; every value is real ERP data from GET /api/sales-orders/:id (+
// /api/audit-events, + /api/files for the Customer PO attachment, the same three reads
// desktop makes). Mapping lives in lib/so-detail.ts and mirrors
// src/pages/sales/detail.tsx.
//
// PHONE (shell <= 719px): the approved read-only design, byte for byte (locked by
// tests/m-sales-phone-golden.test.mjs): no action bar, no Paid / Balance / Payments.
//
// WIDER (tablet, 2026-10-23, owner decision "Option A"): the SAME blocks in the same
// phone design language, plus what the tablet detail always had:
//   - a Payments block with Total / Paid / Balance (lib/so-financials.ts),
//   - the Customer PO Date row,
//   - the status actions (lib/so-actions.ts, lib/use-so-actions.ts): Edit Draft,
//     Confirm, Issue Delivery Order, Edit, Cancel, Undo Cancel, Back.
// Width decides ARRANGEMENT and the temporary phone-read-only rule above; it is not a
// permission rule: every action still goes to the same API, which enforces permissions.
// The container (the pane when in the split view) picks one column or two.
//
// Owner 2026-10-27 (Claude Design `Sales Order Detail v4`, visual only): status pill, customer
// and state on the page; a plain white overview card (ORDER TOTAL, dates, hub); On Hold /
// Cancelled banners under it; plain 16px section icons (no tinted tiles); and a "More actions"
// ⋯ menu in the header holding "Download PDF" (lib/so-pdf.ts, the desktop generateSOPdf).
// Typography here is local to this file; the shared tokens are untouched.
//
// Order: header → overview → payments → notes → progress (production + delivery) →
// items → documents / more details / history (collapsed).
// ===========================================================================
import { useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowRight,
  Ban,
  BedDouble,
  CalendarCheck,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  CirclePause,
  CloudOff,
  Download,
  ExternalLink,
  Factory,
  FileText,
  Files,
  History,
  Lamp,
  MapPin,
  Package,
  Route,
  Sofa,
  TriangleAlert,
  Truck,
  Wallet,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { useContainerLayout, useResponsiveLayout } from "../lib/responsive-layout";
import { useSalesOrderActions } from "../lib/use-so-actions";
import { hasBalanceDue, soFinancials, type SoFinancials } from "../lib/so-financials";
import { useMobileToast } from "./delivery/ui-hooks";
import { SalesOrderActionBar } from "./SalesOrderActionBar";
import { FormSheet, MobileHeader, MobileCard, Sheet } from "../components";
import { HeaderMore } from "./procurement/parts";
import { soCountdown, soStage } from "../lib/so-card";
import { localToday } from "../lib/so-filter-presets";
import { BILL_TO_MESSAGE, downloadSoPdf, lookupBillTo, type BillTo } from "../lib/so-pdf";
import { M, M_ACCENT, SEMANTIC, titleCaseStatus, type SemanticStyle } from "../theme";
import { resolveStatus, STATUS_MAPS, str, num, money } from "../config/helpers";
import {
  auditEvents,
  displaySoId,
  doFacts,
  doLabel,
  fmtDate,
  fmtDateTime,
  overrideForLine,
  productionLabel,
  productionSummary,
  rows,
  soLineRef,
  sortPOs,
  specChips,
  statusBanner,
  statusEvents,
  surcharges,
  titleCase,
  type SpecChip,
} from "../lib/so-detail";

type RawRow = Record<string, unknown>;
type Envelope = { success?: boolean; data?: RawRow } & Record<string, unknown>;
type ListResp = { data?: RawRow[] };

// Prototype surface: borderless card with a soft two-layer shadow.
const SHADOW = "0 1px 2px rgba(31,29,27,.05),0 12px 28px -16px rgba(31,29,27,.22)";
const SHADOW_SM = "0 1px 2px rgba(31,29,27,.05),0 10px 24px -14px rgba(31,29,27,.2)";

// Status text roles from the Mobile UI Foundation (theme-vars.css), dark-safe.
const TXT = {
  SUCCESS: "var(--m-text-status-success)",
  WARNING: "var(--m-text-status-warning)",
  DANGER: "var(--m-text-status-danger)",
  INFO: "var(--m-text-status-info)",
};

const T = {
  label: {
    fontSize: "var(--m-type-label-size)",
    fontWeight: "var(--m-type-label-weight)",
    letterSpacing: "var(--m-type-label-tracking)",
    lineHeight: "var(--m-type-label-line-height)",
  },
  meta: { fontSize: "var(--m-type-metadata-size)", lineHeight: "var(--m-type-metadata-line-height)" },
  body: { fontSize: "var(--m-type-description-size)", lineHeight: "var(--m-type-description-line-height)" },
  cardTitle: {
    fontSize: "var(--m-type-card-title-size)",
    fontWeight: 700,
    lineHeight: "var(--m-type-card-title-line-height)",
    letterSpacing: "var(--m-type-card-title-tracking)",
  },
} as const;

/** rgba tint of a semantic hex (as StatusPill does). */
function tint(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Semantic hex (design-tokens) → the Foundation's dark-safe status text role.
const STATUS_TEXT: Record<string, string> = {
  "#3E6570": TXT.INFO,
  "#4F7C3A": TXT.SUCCESS,
  "#9C6F1E": TXT.WARNING,
  "#9A3A2D": TXT.DANGER,
};

/** Borderless status chip (owner 2026-10-16, phone SO detail only): tinted
 *  background + readable text, same semantic colours and Title Case label as
 *  the shared StatusPill, which stays bordered for every other screen. */
function StatusChip({ style, label, size = "sm" }: { style: SemanticStyle; label: string; size?: "sm" | "md" }) {
  const md = size === "md";
  const fg = STATUS_TEXT[style.hex] ?? M.body;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: md ? 6 : 0,
        borderRadius: 9999,
        backgroundColor: tint(style.hex, 0.14),
        color: fg,
        fontWeight: md ? 700 : 600,
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
        padding: md ? "0 11px" : "2px 9px",
        height: md ? 26 : undefined,
        fontSize: md ? 12.5 : 11,
        lineHeight: 1.3,
      }}
    >
      {md ? <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: fg, flex: "none" }} /> : null}
      {titleCaseStatus(label)}
    </span>
  );
}

const CHIP_TONE: Record<SpecChip["key"], { bg: string; fg: string }> = {
  gap: M_ACCENT.info,
  divan: M_ACCENT.plum,
  leg: M_ACCENT.warning,
  special: M_ACCENT.danger,
};

const ITEMS_PREVIEW = 2;
// Order progress (Claude Design v4): the seven lifecycle stage names, the note shown for
// statuses outside them, and the production tile names. The stage POSITION comes from
// soStage (lib/so-card.ts), the same mapping the list card uses; nothing here is a status
// or a transition.
const STAGE_LABELS = ["Draft", "In Production", "Ready to Ship", "Shipped", "Delivered", "Invoiced", "Closed"];
const STAGE_DONE = "var(--m-inv-success)";
const OFF_FLOW_TEXT: Record<string, string> = {
  ON_HOLD: "On Hold is a special status outside the stage sequence. The stage reached before the hold isn’t shown here.",
  CANCELLED: "Cancelled is a special status outside the stage sequence. No further stages apply.",
  CONFIRMED: "Confirmed is a legacy transitional status and isn’t one of the tracker stages.",
};
const PROD_TILE_LABEL: Record<string, string> = {
  COMPLETED: "Completed", IN_PROGRESS: "In progress", PENDING: "Pending", ON_HOLD: "On hold", PAUSED: "Paused", CANCELLED: "Cancelled",
};
// Related documents chain: "linked" teal from the design; text and line mixes keep it readable in dark mode.
const CHAIN_LINKED = "#2F6E62";

/** Container width from which two phone-width columns fit (2 x ~358px content + 14px gap + side padding). */
const SO_TWO_COLUMN_MIN_WIDTH = 760;

export function SalesOrderDetail() {
  const navigate = useNavigate();
  const { id = "" } = useParams();
  const url = `/api/sales-orders/${encodeURIComponent(id)}`;
  const { data, loading, error, refresh } = useCachedJson<Envelope>(url);
  const doc = data?.data ?? null;
  // The route id may be a companySOId (the GET resolves it); audit + files
  // are keyed on the real row id, as desktop does.
  const docId = doc ? str(doc, "id") || id : "";

  const [prodSel, setProdSel] = useState<string | null>(null);
  const [stagesOpen, setStagesOpen] = useState(false);
  const [poAll, setPoAll] = useState(false);
  const [allItems, setAllItems] = useState(false);
  const [openItems, setOpenItems] = useState<Record<string, boolean>>({});
  const [docsOpen, setDocsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [histTab, setHistTab] = useState<"status" | "audit">("status");
  // ⋯ More actions → Download PDF (lib/so-pdf.ts). `billTo` holds a missing-address warning
  // until the user decides; nothing is downloaded without the address or that decision.
  const [moreOpen, setMoreOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [billTo, setBillTo] = useState<Extract<BillTo, { state: "missing" }> | null>(null);

  // Fetched only once the section that needs them is opened.
  const audit = useCachedJson<ListResp>(
    historyOpen && histTab === "audit" && docId
      ? `/api/audit-events?resource=sales-orders&resourceId=${encodeURIComponent(docId)}`
      : null,
  );
  const files = useCachedJson<ListResp>(
    infoOpen && docId ? `/api/files?resourceType=SO&resourceId=${encodeURIComponent(docId)}` : null,
  );

  // Wider screens: arrangement, the Payments block and the status actions (see the header).
  const wide = useResponsiveLayout().mode !== "phone";
  const container = useContainerLayout();
  const twoColumns = wide && container.width >= SO_TWO_COLUMN_MIN_WIDTH;
  const toast = useMobileToast();
  const actions = useSalesOrderActions({ url, id, doc, notify: (text, tone) => toast.show(text, tone) });

  const header = (title: string) => <MobileHeader title={title} onBack={() => navigate(-1)} />;

  if (loading && !doc) {
    // Claude Design v4 loading skeleton: status pill, customer line, then the overview and progress cards.
    const skel = { background: "var(--m-segment-track)", opacity: 0.8 } as const;
    return (
      <>
        {header("Sales Order")}
        <div aria-busy="true" aria-label="Loading sales order" style={{ display: "grid", gap: 14, padding: "8px 18px 120px" }}>
          <div style={{ ...skel, height: 22, width: 110, borderRadius: 999 }} />
          <div style={{ ...skel, height: 26, width: "72%", borderRadius: 8 }} />
          <div style={{ ...skel, height: 190, borderRadius: 20 }} />
          <div style={{ ...skel, height: 220, borderRadius: 20 }} />
        </div>
      </>
    );
  }
  if (error && !doc) {
    return (
      <>
        {header("Sales Order")}
        <div role="alert" style={{ margin: "40px 18px", background: M.card, borderRadius: 20, padding: "28px 22px", textAlign: "center", boxShadow: SHADOW }}>
          <div style={{ width: 48, height: 48, margin: "0 auto", borderRadius: "50%", background: "var(--m-inv-danger-bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <CloudOff size={22} strokeWidth={1.9} color="var(--m-inv-danger)" />
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: M.raisin, marginTop: 14 }}>Couldn’t load this sales order</div>
          <div style={{ fontSize: 13, lineHeight: 1.5, color: M.ink, marginTop: 6 }}>Check your connection and try again.</div>
          <button
            type="button"
            onClick={() => refresh()}
            style={{
              marginTop: 18, height: 44, padding: "0 22px", borderRadius: 12, border: "none", background: M.taupe, color: "var(--m-text-on-accent)",
              fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: "0 8px 18px -10px rgba(107,92,50,.7)",
              WebkitTapHighlightColor: "transparent",
            }}
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
        {header("Sales Order")}
        <div style={{ padding: "60px 18px", textAlign: "center", color: M.muted, ...T.body }}>Order not found.</div>
      </>
    );
  }

  const env = data as Envelope;
  const status = str(doc, "status");
  const pill = resolveStatus(status, STATUS_MAPS.so);
  const companySOId = str(doc, "companySOId", "companySO");
  const items = rows(doc.items);
  const pos = rows(env.linkedPOs);
  const dos = rows(env.linkedDOs);
  const invoices = rows(env.linkedInvoices);
  // Paid / Balance exist only on wider screens: the phone detail stays read-only and money-light.
  const payments = wide ? rows(env.linkedPayments) : [];
  const financials = soFinancials(num(doc, "totalSen"), payments);
  const overrides = rows(env.priceOverrides);
  const history = rows(env.statusHistory);
  const notes = str(doc, "notes").trim();
  const banner = statusBanner(doc, history, fmtDateTime);
  const prod = productionSummary(pos);
  const shownItems = allItems ? items : items.slice(0, ITEMS_PREVIEW);

  // Customer PO attachment: the durable SO file first, the legacy inline
  // render second (desktop's order, sales/detail.tsx).
  const fileList = rows(files.data?.data);
  const poFile =
    fileList.find((f) => str(f, "filename").toLowerCase().includes("po-original")) ??
    fileList.find((f) => /pdf|image/.test(str(f, "contentType"))) ??
    null;
  const poImage = str(doc, "customerPOImageB64");
  const customerPOId = str(doc, "customerPOId", "customerPO");
  const openCustomerPO = () => {
    if (poFile) {
      window.open(`/api/files/${encodeURIComponent(str(poFile, "id"))}/download?inline=1`, "_blank", "noopener");
      return;
    }
    if (!poImage) return;
    const w = window.open();
    if (!w) return;
    w.document.title = `Original PO — ${customerPOId || companySOId}`;
    w.document.body.style.cssText = "margin:0;background:#222;text-align:center";
    const img = w.document.createElement("img");
    img.src = poImage;
    img.style.cssText = "max-width:100%;height:auto";
    w.document.body.appendChild(img);
  };

  const headerBlock = (
    <>
            {/* 1 · Header — on the page, not in a card */}
            <section aria-label="Order header" style={{ padding: "0 2px" }}>
              <StatusChip style={pill.style} label={pill.label} size="md" />
              <h1
                style={{
                  margin: "10px 0 0", fontSize: 21, lineHeight: 1.3, fontWeight: 700, letterSpacing: "-0.3px",
                  color: M.raisin, wordBreak: "break-word",
                }}
              >
                {str(doc, "customerName") || "—"}
              </h1>
              {str(doc, "customerState") ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, fontSize: 13, color: M.ink }}>
                  <MapPin size={13} strokeWidth={1.9} color="var(--m-inv-icon)" aria-hidden />
                  {str(doc, "customerState")}
                </div>
              ) : null}
            </section>
    </>
  );

  const totalSplit = /^RM\s*(.*)$/.exec(money(num(doc, "totalSen")));
  // Display only: a countdown to Hookka Expected DD for Confirmed / In Production / Ready
  // to Ship, 0–7 days out (same rule as the list card). Never "late", never on Customer DD.
  const expectedCountdown = soCountdown(str(doc, "hookkaExpectedDD"), status, localToday()).text;

  const overviewBlock = (
    <>
            {/* 2 · Overview */}
            <Surface ariaLabel="Order overview" style={{ marginTop: 16, padding: "18px 18px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: M.taupe }}>
                <span aria-hidden="true" style={{ width: 14, height: 3, borderRadius: 2, background: M.gold, flex: "none" }} />
                Order total
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: 5, marginTop: 6 }}>
                {totalSplit ? <span style={{ fontSize: 15, fontWeight: 600, color: M.ink }}>RM</span> : null}
                <span
                  style={{
                    flex: "none", fontSize: 30, lineHeight: 1.1, fontWeight: 700, letterSpacing: "-0.6px", color: M.raisin,
                    fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
                  }}
                >
                  {totalSplit ? totalSplit[1] : money(num(doc, "totalSen"))}
                </span>
              </div>
              <div style={{ height: 1, background: M.divider, margin: "16px 0 14px" }} />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "14px 16px" }}>
                <DateFact icon={<CalendarCheck size={14} strokeWidth={1.9} color="var(--m-inv-icon)" aria-hidden />} label="Customer DD" value={fmtDate(str(doc, "customerDeliveryDate"))} />
                <DateFact
                  icon={<CalendarClock size={14} strokeWidth={1.9} color="var(--m-inv-icon)" aria-hidden />}
                  label="Hookka Expected DD"
                  value={fmtDate(str(doc, "hookkaExpectedDD"))}
                  countdown={expectedCountdown}
                />
                <DateFact
                  icon={<Warehouse size={14} strokeWidth={1.9} color="var(--m-inv-icon)" aria-hidden />}
                  label="Delivery Hub"
                  value={str(doc, "hubName")}
                  empty="Not assigned"
                  wrap
                  span
                />
              </div>
            </Surface>
            {banner ? (
              <div
                role="status"
                style={{
                  display: "flex", gap: 11, alignItems: "flex-start", marginTop: 10, padding: "12px 14px",
                  borderRadius: 14,
                  background: banner.tone === "warning" ? tint("#9C6F1E", 0.12) : tint("#9A3A2D", 0.1),
                }}
              >
                {banner.tone === "warning" ? (
                  <CirclePause size={17} strokeWidth={2} color={TXT.WARNING} style={{ flex: "none", marginTop: 1 }} aria-hidden />
                ) : (
                  <Ban size={17} strokeWidth={2} color={TXT.DANGER} style={{ flex: "none", marginTop: 1 }} aria-hidden />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ ...T.label, color: banner.tone === "warning" ? TXT.WARNING : TXT.DANGER }}>{banner.title}</div>
                  <div style={{ ...T.meta, color: M.raisin, marginTop: 2, wordBreak: "break-word" }}>{banner.text}</div>
                  {banner.meta ? <div style={{ ...T.meta, color: M.ink, marginTop: 2 }}>{banner.meta}</div> : null}
                </div>
              </div>
            ) : null}
    </>
  );

  // 4 · Order progress (Claude Design v4): lifecycle stepper (position from soStage — the
  // same mapping the list card uses), production tiles and delivery orders, all real data.
  const stage = soStage(status);
  const prodTiles = (["COMPLETED", "IN_PROGRESS", "PENDING", "ON_HOLD", "PAUSED", "CANCELLED"] as const)
    .map((k) => ({ status: k, n: prod.counts.find((c) => c.status === k)?.count ?? 0, label: PROD_TILE_LABEL[k] }))
    .filter((t) => t.n > 0 || t.status === "COMPLETED" || t.status === "IN_PROGRESS" || t.status === "PENDING");
  const prodSelActive = prodSel && prodTiles.some((t) => t.status === prodSel && t.n > 0) ? prodSel : null;
  const prodList = prodSelActive ? pos.filter((p) => str(p, "status").toUpperCase() === prodSelActive) : [];

  const progressBlock = (
    <>
            <Surface ariaLabel="Order progress" style={{ marginTop: 12, padding: "16px 16px 6px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Route size={16} strokeWidth={1.9} color={M.taupe} aria-hidden />
                <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap" }}>Order progress</span>
              </div>

              {stage ? (
                <div style={{ marginTop: 14 }}>
                  <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe }}>CURRENT STAGE</div>
                      <div style={{ fontSize: 17, fontWeight: 700, color: M.raisin, marginTop: 3, letterSpacing: "-0.2px" }}>{STAGE_LABELS[stage.n - 1]}</div>
                    </div>
                    <span style={{ flex: "none", fontSize: 12.5, fontWeight: 600, color: M.ink, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                      Stage {stage.n} of {stage.total}
                    </span>
                  </div>
                  <ol
                    aria-label="Sales order lifecycle"
                    style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "grid", gridTemplateColumns: "repeat(7,minmax(0,1fr))", gap: 4 }}
                  >
                    {STAGE_LABELS.map((l, i) => {
                      const n = i + 1;
                      const state = n < stage.n ? "done" : n === stage.n ? "current" : "upcoming";
                      return (
                        <li
                          key={l}
                          aria-label={`${l} — ${state === "done" ? "done" : state === "current" ? "current stage" : "upcoming"}`}
                          aria-current={state === "current" ? "step" : undefined}
                          style={{
                            height: 8, borderRadius: 999,
                            background: state === "done" ? STAGE_DONE : state === "current" ? M.taupe : "var(--m-inv-line)",
                            boxShadow: state === "current" ? "0 0 0 2px color-mix(in srgb, var(--m-gold) 45%, transparent)" : "none",
                          }}
                        />
                      );
                    })}
                  </ol>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 9, fontSize: 12, color: M.ink }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, minWidth: 0, whiteSpace: "nowrap" }}>
                      {stage.n > 1 ? (
                        <>
                          <Check size={13} strokeWidth={2.6} color={STAGE_DONE} aria-hidden />
                          Done: {STAGE_LABELS[stage.n - 2]}
                        </>
                      ) : null}
                    </span>
                    <span style={{ minWidth: 0, textAlign: "right", whiteSpace: "nowrap" }}>
                      {stage.n < stage.total ? `Next: ${STAGE_LABELS[stage.n]}` : "Final stage"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setStagesOpen((v) => !v)}
                    aria-expanded={stagesOpen}
                    style={{
                      marginTop: 10, width: "100%", height: 44, border: "none", borderRadius: 12, background: M.paper, color: M.taupe,
                      fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center",
                      justifyContent: "center", gap: 6, WebkitTapHighlightColor: "transparent",
                    }}
                  >
                    {stagesOpen ? "Hide stages" : "View all 7 stages"}
                    <ChevronDown size={16} strokeWidth={2} aria-hidden style={{ transform: stagesOpen ? "rotate(180deg)" : "none", transition: "transform .18s ease" }} />
                  </button>
                  {stagesOpen ? (
                    <ol style={{ listStyle: "none", margin: "10px 0 0", padding: 0 }}>
                      {STAGE_LABELS.map((l, i) => {
                        const n = i + 1;
                        const done = n < stage.n;
                        const cur = n === stage.n;
                        return (
                          <li key={l} style={{ position: "relative", display: "flex", alignItems: "center", gap: 12, minHeight: 38 }}>
                            {i < STAGE_LABELS.length - 1 ? (
                              <span aria-hidden style={{ position: "absolute", left: 11, top: 30, height: 16, width: 2, background: done ? STAGE_DONE : "var(--m-inv-line)" }} />
                            ) : null}
                            <span
                              style={{
                                position: "relative", width: 24, height: 24, flex: "none", boxSizing: "border-box", borderRadius: "50%",
                                background: done ? STAGE_DONE : cur ? M.taupe : M.card,
                                boxShadow: cur ? "0 0 0 3px color-mix(in srgb, var(--m-gold) 40%, transparent)" : done ? "none" : "inset 0 0 0 1.5px var(--m-inv-dot-ring)",
                                color: done || cur ? "var(--m-text-on-accent)" : M.ink, display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: 11, fontWeight: 700,
                              }}
                            >
                              {done ? <Check size={13} strokeWidth={3} aria-hidden /> : cur ? <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--m-text-on-accent)" }} /> : <span>{n}</span>}
                            </span>
                            <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: cur ? 700 : 500, color: M.raisin }}>{l}</span>
                            <span style={{ flex: "none", fontSize: 12, fontWeight: 700, color: done ? STAGE_DONE : cur ? M.taupe : M.ink }}>
                              {done ? "Done" : cur ? "Current" : "Upcoming"}
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  ) : null}
                </div>
              ) : (
                <div style={{ display: "flex", gap: 11, alignItems: "flex-start", marginTop: 14, padding: "12px 13px", borderRadius: 12, background: "var(--m-inv-note-bg)" }}>
                  <span aria-hidden style={{ width: 10, height: 10, flex: "none", borderRadius: "50%", background: STATUS_TEXT[pill.style.hex] ?? pill.style.hex, marginTop: 4 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: M.raisin }}>Current status: {titleCaseStatus(pill.label)}</div>
                    {OFF_FLOW_TEXT[status.toUpperCase()] ? (
                      <div style={{ fontSize: 12.5, lineHeight: 1.45, color: M.ink, marginTop: 2 }}>{OFF_FLOW_TEXT[status.toUpperCase()]}</div>
                    ) : null}
                  </div>
                </div>
              )}

              <div style={{ height: 1, background: M.divider, margin: "16px -16px 0" }} />
              {/* Production */}
              <div style={{ padding: "14px 0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span aria-hidden style={{ width: 34, height: 34, flex: "none", borderRadius: 10, background: "var(--m-inv-info-bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Factory size={17} strokeWidth={1.9} color="var(--m-inv-info)" />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: "var(--m-inv-info)" }}>PRODUCTION</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: M.raisin, marginTop: 2, lineHeight: 1.35 }}>
                      {pos.length ? `${prod.completed} of ${pos.length} Production Orders completed` : "No Production Orders linked yet"}
                    </div>
                  </div>
                </div>
                {pos.length ? (
                  <>
                    <div aria-hidden style={{ display: "flex", gap: 3, marginTop: 12, height: 8 }}>
                      {prod.counts.flatMap((c) =>
                        Array.from({ length: c.count }, (_, i) => (
                          <span key={`${c.status}${i}`} style={{ flex: 1, borderRadius: 9999, background: poHex(c.status) }} />
                        )),
                      )}
                    </div>
                    <div role="group" aria-label="Production Orders by status" style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 6, marginTop: 12 }}>
                      {prodTiles.map((t) => {
                        const on = prodSelActive === t.status;
                        const c = poHex(t.status);
                        return (
                          <button
                            key={t.status}
                            type="button"
                            aria-pressed={on}
                            aria-label={`${t.n} ${t.label}${t.n ? ", tap to list" : ""}`}
                            onClick={() => t.n > 0 && setProdSel(on ? null : t.status)}
                            style={{
                              minWidth: 0, minHeight: 56, padding: "8px 10px", border: "none", borderRadius: 12,
                              background: on ? M.card : M.paper,
                              boxShadow: on ? `inset 0 0 0 1.5px ${c}, 0 6px 14px -8px rgba(31,29,27,.25)` : "none",
                              fontFamily: "inherit", textAlign: "left", cursor: t.n ? "pointer" : "default",
                              display: "flex", flexDirection: "column", justifyContent: "center", gap: 2, WebkitTapHighlightColor: "transparent",
                            }}
                          >
                            <span style={{ fontSize: 18, lineHeight: 1.1, fontWeight: 700, color: t.n ? M.raisin : M.muted, fontVariantNumeric: "tabular-nums" }}>{t.n}</span>
                            <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, color: "var(--m-inv-body)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              <span aria-hidden style={{ width: 7, height: 7, flex: "none", borderRadius: "50%", background: t.n ? c : "var(--m-inv-dot-ring)" }} />
                              {t.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {prodSelActive && prodList.length ? (
                      <div style={{ marginTop: 8, borderRadius: 12, background: M.paper, padding: "4px 12px" }}>
                        {prodList.map((p, i) => {
                          const st = str(p, "status").toUpperCase();
                          const dept = str(p, "currentDepartment").replace(/_/g, " ");
                          const sub = [
                            str(p, "productName"),
                            st === "COMPLETED" && str(p, "completedDate") ? `Completed ${fmtDate(str(p, "completedDate"))}` : "",
                            st === "IN_PROGRESS" && dept ? `Current dept: ${titleCase(dept)}` : "",
                            str(p, "deliveryDoNo") ? `On ${str(p, "deliveryDoNo")}` : "",
                          ].filter(Boolean).join(" · ");
                          const pct = st === "IN_PROGRESS" && p.progress != null ? num(p, "progress") : null;
                          return (
                            <div key={str(p, "id") || i} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, padding: "6px 0", borderTop: i ? `1px solid ${M.divider}` : "none" }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums", wordBreak: "break-all" }}>
                                  {displaySoId(str(p, "poNo"), str(p, "itemCategory")) || "—"}
                                </div>
                                {sub ? <div style={{ fontSize: 12, color: M.ink, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div> : null}
                              </div>
                              {pct != null ? (
                                <span style={{ flex: "none", fontSize: 12, fontWeight: 700, color: "var(--m-inv-info)", fontVariantNumeric: "tabular-nums" }}>{pct}% overall</span>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
              <div style={{ height: 1, background: M.divider, margin: "0 -16px" }} />
              {/* Delivery */}
              <div style={{ padding: "14px 0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span aria-hidden style={{ width: 34, height: 34, flex: "none", borderRadius: 10, background: "var(--m-inv-tile-bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Truck size={17} strokeWidth={1.9} color={M.taupe} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe }}>DELIVERY</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: M.raisin, marginTop: 2, lineHeight: 1.35 }}>
                      {dos.length ? `${dos.length} Delivery Order${dos.length === 1 ? "" : "s"} linked` : "No Delivery Orders yet"}
                    </div>
                  </div>
                </div>
                {dos.length ? (
                  <div style={{ display: "grid", gap: 6, marginTop: 11 }}>
                    {dos.map((d, i) => {
                      const ds = resolveStatus(str(d, "status"), STATUS_MAPS.delivery);
                      const doId = str(d, "id");
                      const n = pos.filter((q) => str(q, "deliveryDoNo") && str(q, "deliveryDoNo") === str(d, "doNo")).length;
                      const sub = [
                        n ? `${n} Production Order${n === 1 ? "" : "s"}` : "",
                        str(d, "scheduledDate") ? `Expected ${fmtDate(str(d, "scheduledDate"))}` : "",
                      ].filter(Boolean).join(" · ");
                      return (
                        <button
                          key={doId || i}
                          type="button"
                          onClick={doId ? () => navigate(`/m/delivery/${encodeURIComponent(doId)}`) : undefined}
                          aria-label={`${str(d, "doNo")}, ${doLabel(str(d, "status"))}. Open delivery order`}
                          style={{
                            width: "100%", display: "flex", alignItems: "center", gap: 10, minHeight: 52, padding: "8px 12px", border: "none",
                            borderRadius: 12, background: M.paper, fontFamily: "inherit", textAlign: "left", cursor: doId ? "pointer" : "default",
                            WebkitTapHighlightColor: "transparent",
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                              <span style={{ fontSize: 13.5, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{str(d, "doNo") || "—"}</span>
                              <StatusChip style={ds.style} label={doLabel(str(d, "status"))} size="sm" />
                            </div>
                            {sub ? <div style={{ fontSize: 12, color: M.ink, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div> : null}
                          </div>
                          {doId ? <ChevronRight size={18} strokeWidth={1.9} color="var(--m-inv-icon)" aria-hidden /> : null}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </Surface>
    </>
  );

  // 5 · Order items (Claude Design v4)
  const totalQty = items.reduce((a, it) => a + num(it, "quantity", "qty"), 0);
  const itemsBlock = (
    <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "26px 2px 10px" }}>
              <Package size={16} strokeWidth={1.9} color={M.taupe} aria-hidden />
              <span style={{ fontSize: 16, fontWeight: 700, color: M.raisin }}>Order items</span>
              <span style={{ fontSize: 12.5, color: M.ink, fontVariantNumeric: "tabular-nums" }}>
                {items.length} {items.length === 1 ? "line" : "lines"} · {totalQty} qty
              </span>
            </div>
            {items.length === 0 ? (
              <Surface style={{ padding: 22, textAlign: "center", fontSize: 13, color: M.ink }} radius={16}>
                No line items on this order.
              </Surface>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 10 }}>
                {shownItems.map((it, i) => {
                  const key = str(it, "id") || String(i);
                  const lineNo = num(it, "lineNo") || i + 1;
                  return (
                    <ItemCard
                      key={key}
                      item={it}
                      soLine={soLineRef(companySOId, it)}
                      override={overrideForLine(overrides, lineNo)}
                      open={!!openItems[key]}
                      onToggle={() => setOpenItems((o) => ({ ...o, [key]: !o[key] }))}
                    />
                  );
                })}
              </div>
            )}
            {items.length > ITEMS_PREVIEW ? (
              <button
                type="button"
                onClick={() => setAllItems((v) => !v)}
                aria-expanded={allItems}
                style={{
                  marginTop: 10, width: "100%", height: 44, borderRadius: 12, border: "none", background: M.card, color: M.taupe,
                  fontFamily: "inherit", fontSize: 13.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center",
                  justifyContent: "center", gap: 6, boxShadow: "0 1px 2px rgba(31,29,27,.05),0 6px 16px -10px rgba(31,29,27,.18)",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                {allItems ? "Show fewer items" : `View all ${items.length} items`}
                <ChevronDown size={16} strokeWidth={2} aria-hidden style={{ transform: allItems ? "rotate(180deg)" : "none" }} />
              </button>
            ) : null}
    </>
  );

  // 6 · Related documents (Claude Design v4): the chain + grouped details, real linked documents only.
  const docNote = (text: string) => () => toast.show(text, "info");
  const chainNodes: {
    label: string; doc: string; sub: string; state: "linked" | "current" | "pending"; hint?: "ChevronRight" | "ChevronDown"; onTap?: () => void;
  }[] = [
    {
      label: "Customer PO",
      doc: customerPOId || "Not recorded",
      sub: customerPOId ? "Customer’s own reference" : "No reference on this order",
      state: customerPOId ? "linked" : "pending",
      onTap: docNote(customerPOId ? "Customer’s own document — the original PO file is under Additional information" : "No customer PO reference recorded"),
    },
    { label: "Sales Order", doc: companySOId || "—", sub: "This order", state: "current" },
    {
      label: dos.length > 1 ? "Delivery Orders" : "Delivery Order",
      doc: dos.length ? (dos.length === 1 ? str(dos[0], "doNo") || "—" : `${dos.length} linked`) : "Not created",
      sub: dos.length
        ? dos.length === 1 ? doLabel(str(dos[0], "status")) : dos.map((x) => str(x, "doNo")).filter(Boolean).join(", ")
        : "After confirmation",
      state: dos.length ? "linked" : "pending",
      hint: dos.length === 1 ? "ChevronRight" : dos.length ? "ChevronDown" : undefined,
      onTap:
        dos.length === 1 && str(dos[0], "id")
          ? () => navigate(`/m/delivery/${encodeURIComponent(str(dos[0], "id"))}`)
          : dos.length
            ? () => setDocsOpen(true)
            : docNote("No delivery order yet — created once goods are ready to ship"),
    },
    {
      label: invoices.length > 1 ? "Sales Invoices" : "Sales Invoice",
      doc: invoices.length ? (invoices.length === 1 ? str(invoices[0], "invoiceNo") || "—" : `${invoices.length} linked`) : "Not created",
      sub: invoices.length
        ? invoices.length === 1 ? titleCase(str(invoices[0], "status")) : invoices.map((x) => str(x, "invoiceNo")).filter(Boolean).join(", ")
        : "On delivery",
      state: invoices.length ? "linked" : "pending",
      hint: invoices.length ? "ChevronDown" : undefined,
      onTap: invoices.length ? () => setDocsOpen(true) : docNote("No invoice yet — raised from the delivery order"),
    },
  ];
  const poRowsAll = sortPOs(pos);
  const poRowsShown = poAll ? poRowsAll : poRowsAll.slice(0, 2);
  const docRow = (
    key: string,
    code: string,
    chip: ReactNode,
    sub: string,
    onTap?: () => void,
    label?: string,
  ) => (
    <div
      key={key}
      role={onTap ? "button" : undefined}
      tabIndex={onTap ? 0 : undefined}
      aria-label={onTap ? label : undefined}
      onClick={onTap}
      onKeyDown={onTap ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onTap(); } } : undefined}
      style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 52, padding: "7px 15px", cursor: onTap ? "pointer" : "default" }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{code}</span>
          {chip}
        </div>
        {sub ? <div style={{ fontSize: 12, color: M.ink, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div> : null}
      </div>
      {onTap ? <ChevronRight size={18} strokeWidth={1.9} color="var(--m-inv-icon)" aria-hidden /> : null}
    </div>
  );
  const docGroupTitle = (t: string) => (
    <div style={{ padding: "12px 15px 4px", fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe, textTransform: "uppercase" }}>{t}</div>
  );
  const docEmpty = <div style={{ padding: "2px 15px 12px", fontSize: 12.5, color: M.ink }}>None yet.</div>;

  const documentsBlock = (
    <>
            <section aria-label="Related documents" style={{ marginTop: 26 }}>
              <MobileCard padded={false} radius={18} style={{ border: "none", boxShadow: SHADOW_SM, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "15px 15px 4px" }}>
                  <Files size={16} strokeWidth={1.9} color={M.taupe} aria-hidden />
                  <span style={{ fontSize: 16, fontWeight: 700, color: M.raisin }}>Related documents</span>
                </div>
                <ol aria-label="Document relationship" style={{ listStyle: "none", margin: 0, padding: "8px 15px 4px" }}>
                  {chainNodes.map((c, i) => {
                    const dot = c.state === "linked" ? CHAIN_LINKED : c.state === "current" ? M.taupe : M.card;
                    const next = chainNodes[i + 1];
                    return (
                      <li key={c.label} style={{ position: "relative" }}>
                        {next ? (
                          <span
                            aria-hidden
                            style={{
                              position: "absolute", left: 11, top: 34, bottom: -6, width: 2, borderRadius: 2,
                              background: next.state === "pending" ? "var(--m-inv-line)" : `color-mix(in srgb, ${CHAIN_LINKED} 40%, ${M.card})`,
                            }}
                          />
                        ) : null}
                        <button
                          type="button"
                          onClick={c.onTap}
                          aria-label={`${c.label}: ${c.doc}, ${c.sub}`}
                          style={{
                            position: "relative", width: "100%", display: "flex", alignItems: "center", gap: 12, minHeight: 56, padding: "6px 0",
                            background: "none", border: "none", fontFamily: "inherit", textAlign: "left", cursor: c.onTap ? "pointer" : "default",
                            WebkitTapHighlightColor: "transparent",
                          }}
                        >
                          <span
                            aria-hidden
                            style={{
                              width: 24, height: 24, flex: "none", boxSizing: "border-box", borderRadius: "50%", background: dot,
                              border: c.state === "pending" ? "1.5px dashed var(--m-inv-dot-ring)" : "none", color: "#FFFFFF",
                              display: "flex", alignItems: "center", justifyContent: "center",
                            }}
                          >
                            {c.state === "linked" ? <Check size={13} strokeWidth={3} /> : null}
                            {c.state === "current" ? <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--m-text-on-accent)" }} /> : null}
                          </span>
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span
                              style={{
                                display: "block", fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase",
                                color: c.state === "linked" ? `color-mix(in srgb, ${CHAIN_LINKED} 60%, var(--m-raisin))` : c.state === "current" ? M.taupe : M.ink,
                              }}
                            >
                              {c.label}
                            </span>
                            <span
                              style={{
                                display: "block", fontSize: 14, fontWeight: 700, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden",
                                textOverflow: "ellipsis", fontVariantNumeric: "tabular-nums", color: c.state === "pending" ? M.ink : M.raisin,
                              }}
                            >
                              {c.doc}
                            </span>
                            <span style={{ display: "block", fontSize: 12, color: M.ink, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.sub}</span>
                          </span>
                          {c.hint === "ChevronRight" ? <ChevronRight size={17} strokeWidth={1.9} color="var(--m-inv-icon)" aria-hidden /> : null}
                          {c.hint === "ChevronDown" ? <ChevronDown size={17} strokeWidth={1.9} color="var(--m-inv-icon)" aria-hidden /> : null}
                        </button>
                      </li>
                    );
                  })}
                </ol>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", padding: "4px 15px 12px", fontSize: 11.5, color: M.ink }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span aria-hidden style={{ width: 10, height: 10, borderRadius: "50%", background: CHAIN_LINKED }} />Linked
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span aria-hidden style={{ width: 10, height: 10, borderRadius: "50%", background: M.taupe }} />This order
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span aria-hidden style={{ width: 10, height: 10, boxSizing: "border-box", borderRadius: "50%", border: "1.5px dashed var(--m-inv-dot-ring)" }} />Not created yet
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setDocsOpen((v) => !v)}
                  aria-expanded={docsOpen}
                  style={{
                    width: "100%", height: 46, border: "none", borderTop: `1px solid ${M.divider}`, background: "none", fontFamily: "inherit",
                    fontSize: 13, fontWeight: 700, color: M.taupe, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                    gap: 6, WebkitTapHighlightColor: "transparent",
                  }}
                >
                  {docsOpen ? "Hide document details" : "Show document details"}
                  <ChevronDown size={16} strokeWidth={2} aria-hidden style={{ transform: docsOpen ? "rotate(180deg)" : "none", transition: "transform .18s ease" }} />
                </button>
                {docsOpen ? (
                  <>
                    <div style={{ borderTop: `1px solid ${M.divider}` }}>
                      {docGroupTitle(`Production Orders · ${pos.length}`)}
                      {pos.length === 0 ? docEmpty : null}
                      {poRowsShown.map((p, i) => {
                        const ps = resolveStatus(str(p, "status"), STATUS_MAPS.production);
                        return docRow(
                          str(p, "id") || String(i),
                          displaySoId(str(p, "poNo"), str(p, "itemCategory")) || "—",
                          <StatusChip style={ps.style} label={ps.label} size="sm" />,
                          [str(p, "productName"), num(p, "quantity") ? `Qty ${num(p, "quantity")}` : "", productionLabel(p, fmtDate)].filter(Boolean).join(" · "),
                        );
                      })}
                      {poRowsAll.length > 2 ? (
                        <button
                          type="button"
                          onClick={() => setPoAll((v) => !v)}
                          style={{ width: "100%", height: 44, border: "none", background: "none", fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: M.taupe, cursor: "pointer" }}
                        >
                          {poAll ? "Show fewer" : `View all ${poRowsAll.length}`}
                        </button>
                      ) : null}
                      <div style={{ height: 4 }} />
                    </div>
                    <div style={{ borderTop: `1px solid ${M.divider}` }}>
                      {docGroupTitle(`Delivery Orders · ${dos.length}`)}
                      {dos.length === 0 ? docEmpty : null}
                      {dos.map((d, i) => {
                        const ds = resolveStatus(str(d, "status"), STATUS_MAPS.delivery);
                        const doId = str(d, "id");
                        return docRow(
                          doId || String(i),
                          str(d, "doNo") || "—",
                          <StatusChip style={ds.style} label={doLabel(str(d, "status"))} size="sm" />,
                          doFacts(d, fmtDate).join(" · "),
                          doId ? () => navigate(`/m/delivery/${encodeURIComponent(doId)}`) : undefined,
                          `Delivery order ${str(d, "doNo")}, ${doLabel(str(d, "status"))}`,
                        );
                      })}
                      <div style={{ height: 4 }} />
                    </div>
                    <div style={{ borderTop: `1px solid ${M.divider}` }}>
                      {docGroupTitle(`Invoices · ${invoices.length}`)}
                      {invoices.length === 0 ? docEmpty : null}
                      {invoices.map((v, i) => {
                        const invId = str(v, "id");
                        return docRow(
                          invId || String(i),
                          str(v, "invoiceNo") || "—",
                          str(v, "status") ? <StatusChip style={SEMANTIC.NEUTRAL} label={str(v, "status")} size="sm" /> : null,
                          money(num(v, "totalSen")),
                          invId.startsWith("inv-") ? () => navigate(`/m/invoices/${encodeURIComponent(invId)}`) : undefined,
                          `Invoice ${str(v, "invoiceNo")}`,
                        );
                      })}
                      <div style={{ height: 4 }} />
                    </div>
                  </>
                ) : null}
              </MobileCard>
            </section>
    </>
  );

  // 7 · Additional information (Claude Design v4): details, the original Customer PO, and the notes.
  const infoRows = ([
    ["Customer SO", str(doc, "customerSOId", "customerSO")],
    ["Reference", str(doc, "reference")],
    ["Order Date", fmtDate(str(doc, "companySODate"))],
    // Wider screens also carry the Customer PO Date the tablet detail always showed.
    ...(wide ? [["Customer PO Date", fmtDate(str(doc, "customerPODate"))] as [string, string]] : []),
  ] as [string, string][]);
  const moreBlock = (
    <>
            <Collapsible
              title="Additional information"
              icon={<FileText size={16} strokeWidth={1.9} color={M.taupe} aria-hidden />}
              open={infoOpen}
              onToggle={() => setInfoOpen((v) => !v)}
              bodyPad="0 15px 14px"
            >
              {infoRows.map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, minHeight: 42, borderTop: `1px solid ${M.divider}` }}>
                  <span style={{ flex: "none", fontSize: 12.5, color: M.ink }}>{k}</span>
                  <span style={{ minWidth: 0, fontSize: 13, fontWeight: 600, color: v ? M.raisin : M.muted, textAlign: "right", wordBreak: "break-word", fontVariantNumeric: "tabular-nums" }}>
                    {v || "—"}
                  </span>
                </div>
              ))}
              {poFile || poImage ? (
                <button
                  type="button"
                  onClick={openCustomerPO}
                  aria-label="View original customer PO"
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 11, marginTop: 6, minHeight: 52, padding: "8px 12px", border: "none",
                    borderRadius: 12, background: M.paper, fontFamily: "inherit", cursor: "pointer", textAlign: "left", WebkitTapHighlightColor: "transparent",
                  }}
                >
                  <span aria-hidden style={{ width: 34, height: 34, flex: "none", borderRadius: 10, background: M.card, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 2px rgba(31,29,27,.06)" }}>
                    <FileText size={17} strokeWidth={1.9} color={M.taupe} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: M.raisin }}>View original Customer PO</span>
                    {customerPOId ? <span style={{ display: "block", fontSize: 12, color: M.ink, marginTop: 1, wordBreak: "break-all" }}>PO {customerPOId}</span> : null}
                  </span>
                  <ExternalLink size={16} strokeWidth={1.9} color="var(--m-inv-icon)" aria-hidden />
                </button>
              ) : null}
              {notes ? (
                <div style={{ marginTop: 10, padding: "11px 12px", borderRadius: 12, background: M.paper }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe }}>NOTES</div>
                  <div style={{ fontSize: 13, lineHeight: 1.55, color: M.raisin, marginTop: 5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{notes}</div>
                </div>
              ) : null}
            </Collapsible>
    </>
  );

  // 8 · History (Claude Design v4): Status timeline / Audit history tabs + timeline.
  const historyBlock = (
    <>
            <Collapsible
              title="History"
              icon={<History size={16} strokeWidth={1.9} color={M.taupe} aria-hidden />}
              open={historyOpen}
              onToggle={() => setHistoryOpen((v) => !v)}
              bodyPad="0 15px 8px"
            >
              <div
                role="group"
                aria-label="History view"
                style={{
                  display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 4, height: 44, boxSizing: "border-box", padding: 4,
                  borderRadius: 12, background: "var(--m-segment-track)",
                }}
              >
                {([["status", "Status timeline"], ["audit", "Audit history"]] as const).map(([k, l]) => {
                  const on = histTab === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setHistTab(k)}
                      style={{
                        border: "none", borderRadius: 9, background: on ? M.card : "transparent",
                        boxShadow: on ? "0 1px 2px rgba(31,29,27,.08),0 4px 10px -4px rgba(31,29,27,.18)" : "none",
                        color: on ? M.raisin : M.ink, fontFamily: "inherit", fontSize: 13, fontWeight: on ? 700 : 600, cursor: "pointer",
                        WebkitTapHighlightColor: "transparent",
                      }}
                    >
                      {l}
                    </button>
                  );
                })}
              </div>
              {histTab === "audit" ? (
                <div style={{ fontSize: 12, lineHeight: 1.45, color: M.ink, marginTop: 10 }}>
                  Recorded audit events only — may not include every historical change.
                </div>
              ) : null}
              {histTab === "status" ? (
                <Timeline
                  empty="No status changes recorded yet"
                  entries={statusEvents(history).map((e) => ({
                    key: e.key,
                    dot: e.override ? "#9C6F1E" : resolveStatus(e.to, STATUS_MAPS.so).style.hex,
                    head: e.override ? (
                      <span style={{ fontSize: 13, fontWeight: 700, color: TXT.WARNING }}>Edit lock override</span>
                    ) : (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <StatusChip style={resolveStatus(e.from, STATUS_MAPS.so).style} label={e.from || "—"} size="sm" />
                        <ArrowRight size={13} strokeWidth={2} color="var(--m-inv-icon)" aria-label="to" />
                        <StatusChip style={resolveStatus(e.to, STATUS_MAPS.so).style} label={e.to || "—"} size="sm" />
                      </span>
                    ),
                    detail: e.note,
                    chips: e.autoActions,
                    meta: [fmtDateTime(e.at), e.by ? `by ${e.by}` : ""].filter(Boolean).join(" · "),
                  }))}
                />
              ) : audit.loading && !audit.data ? (
                <div style={{ ...T.meta, color: M.ink, padding: "14px 0 8px" }}>Loading audit history…</div>
              ) : audit.error && !audit.data ? (
                <div style={{ ...T.meta, color: TXT.DANGER, padding: "14px 0 8px" }}>Couldn’t load the audit history.</div>
              ) : (
                <Timeline
                  empty="No audit events recorded yet"
                  entries={auditEvents(rows(audit.data?.data)).map((e) => ({
                    key: e.key,
                    dot: "#8B7A4E",
                    head: <span style={{ fontSize: 13, fontWeight: 700, color: M.raisin }}>{e.title}</span>,
                    detail: e.fields.length ? `Changed: ${e.fields.join(", ")}` : "",
                    chips: [],
                    meta: [fmtDateTime(e.at), e.by].filter(Boolean).join(" · "),
                  }))}
                />
              )}
            </Collapsible>
    </>
  );

  const paymentsBlock = wide ? <PaymentsSurface financials={financials} payments={payments} /> : null;
  // One screen at every width. A phone (or a narrow pane) stacks the blocks exactly as
  // before; a container wide enough for two phone-width columns arranges the SAME blocks
  // side by side. Wider screens also show the Payments block and the status actions.
  const sections = twoColumns ? (
    <TwoColumns
      left={
        <>
          {overviewBlock}
          {paymentsBlock}
          {itemsBlock}
        </>
      }
      right={
        <>
          {progressBlock}
          {documentsBlock}
          {moreBlock}
          {historyBlock}
        </>
      }
    />
  ) : (
    <>
      {overviewBlock}
      {paymentsBlock}
      {progressBlock}
      {itemsBlock}
      {documentsBlock}
      {moreBlock}
      {historyBlock}
    </>
  );

  return (
    <>
      <MobileHeader
        title={companySOId || "Sales Order"}
        onBack={() => navigate(-1)}
        trailing={<HeaderMore label="More actions" onClick={() => setMoreOpen(true)} />}
      />
      <div style={{ padding: wide ? "14px 16px 108px" : "14px 16px 28px" }}>
        {headerBlock}
        {sections}
      </div>
      {wide ? (
        <>
          <SalesOrderActionBar
            status={status}
            busy={actions.busy}
            onEditDraft={actions.openEdit}
            onConfirm={actions.onConfirm}
            onUndoCancel={actions.onUndoCancel}
            onIssueDo={actions.openIssueDo}
            onEdit={actions.openEdit}
            onCancel={actions.onCancel}
            onBack={() => navigate(-1)}
          />
          <FormSheet
            open={actions.editSpec != null}
            onClose={() => actions.setEditSpec(null)}
            spec={actions.editSpec}
            onSaved={(to) => {
              actions.setEditSpec(null);
              actions.reload();
              if (to) navigate(to);
            }}
          />
        </>
      ) : null}
      {toast.node}

      {/* "⋯" — the only entry today is Download PDF (same generator as desktop). */}
      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="Sales order PDF">
        <div style={{ fontSize: 12, color: M.ink, margin: "-2px 0 10px", fontVariantNumeric: "tabular-nums" }}>{companySOId}</div>
        <div style={{ background: M.card, borderRadius: 16, overflow: "hidden", boxShadow: "0 1px 2px rgba(31,29,27,.05),0 8px 22px -12px rgba(31,29,27,.18)" }}>
          <button
            type="button"
            disabled={pdfBusy}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 12, minHeight: 60, padding: "0 15px", background: "none", border: "none",
              fontFamily: "inherit", cursor: pdfBusy ? "default" : "pointer", textAlign: "left", opacity: pdfBusy ? 0.5 : 1, WebkitTapHighlightColor: "transparent",
            }}
            onClick={async () => {
              setMoreOpen(false);
              setPdfBusy(true);
              const found = await lookupBillTo(doc);
              if (found.state === "missing") {
                setPdfBusy(false);
                setBillTo(found);
                return;
              }
              const res = await downloadSoPdf(doc, found.address);
              setPdfBusy(false);
              if (!res.ok) toast.show(res.error, "error");
            }}
          >
            <span aria-hidden style={{ width: 36, height: 36, flex: "none", borderRadius: 11, background: "var(--m-inv-tile-bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Download size={18} strokeWidth={1.9} color={M.taupe} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: M.raisin }}>{pdfBusy ? "Preparing PDF…" : "Download SO PDF"}</span>
              <span style={{ display: "block", fontSize: 12, color: M.ink, marginTop: 2 }}>Save the sales order PDF to this device</span>
            </span>
            <ChevronRight size={18} strokeWidth={1.9} color="var(--m-inv-icon)" aria-hidden />
          </button>
        </div>
        <div style={{ height: 16 }} />
      </Sheet>

      {/* Missing Bill To: never download an incomplete PDF without the user's say-so. */}
      <Sheet open={billTo != null} onClose={() => setBillTo(null)} title="Bill To address missing">
        <div style={{ ...T.body, color: M.raisin }}>{billTo ? BILL_TO_MESSAGE[billTo.reason] : ""}</div>
        <div style={{ ...T.meta, color: M.ink, marginTop: 6 }}>
          You can download the PDF without it, or cancel and fix the customer first.
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button
            type="button"
            onClick={() => setBillTo(null)}
            style={{ flex: 1, height: 46, border: "none", borderRadius: 12, background: M.card, color: M.body, fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: SHADOW_SM }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={async () => {
              setBillTo(null);
              setPdfBusy(true);
              const res = await downloadSoPdf(doc, "");
              setPdfBusy(false);
              if (!res.ok) toast.show(res.error, "error");
            }}
            style={{ flex: 1.4, height: 46, border: "none", borderRadius: 12, background: M.taupe, color: "var(--m-text-on-accent)", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
          >
            Download without address
          </button>
        </div>
        <div style={{ height: 8 }} />
      </Sheet>
    </>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function poHex(status: string): string {
  return resolveStatus(status, STATUS_MAPS.production).style.hex;
}

function Surface({
  children,
  style,
  ariaLabel,
  radius = 20,
}: {
  children: ReactNode;
  style?: React.CSSProperties;
  ariaLabel?: string;
  radius?: number;
}) {
  const card = (
    <MobileCard padded={false} radius={radius} style={{ border: "none", boxShadow: SHADOW, ...style }}>
      {children}
    </MobileCard>
  );
  return ariaLabel ? <section aria-label={ariaLabel}>{card}</section> : card;
}

/** Wider screens: Total / Paid / Balance and the linked payments (the tablet detail's money block). */
function PaymentsSurface({ financials, payments }: { financials: SoFinancials; payments: RawRow[] }) {
  const due = hasBalanceDue(financials);
  return (
    <Surface ariaLabel="Payments" style={{ marginTop: 12, padding: "16px 16px 4px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, ...T.label, textTransform: "uppercase", color: M.taupe }}>
          <Wallet size={14} strokeWidth={1.9} aria-hidden /> Payments
        </span>
        <span style={{ ...T.meta, color: M.ink }}>{payments.length}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginTop: 12 }}>
        <MoneyFigure label="Total" value={money(financials.total)} color={M.raisin} />
        <MoneyFigure label="Paid" value={money(financials.paid)} color={TXT.SUCCESS} />
        <MoneyFigure label="Balance" value={money(financials.balance)} color={due ? TXT.DANGER : TXT.SUCCESS} />
      </div>
      <div style={{ height: 1, background: M.divider, margin: "14px 0 0" }} />
      {payments.length === 0 ? (
        <div style={{ ...T.meta, color: M.ink, padding: "12px 0" }}>No payments recorded</div>
      ) : (
        payments.map((p, i) => (
          <div
            key={str(p, "id") || i}
            style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "11px 0", borderTop: i ? `1px solid ${M.divider}` : "none" }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ ...T.label, letterSpacing: 0, color: M.raisin, wordBreak: "break-word" }}>
                {str(p, "paymentMethod", "method", "receiptNumber") || "Payment"}
              </div>
              <div style={{ ...T.meta, color: M.ink, marginTop: 2, wordBreak: "break-word" }}>
                {[fmtDate(str(p, "paymentDate", "createdAt")), str(p, "accountName"), str(p, "receivedBy")].filter(Boolean).join(" · ")}
              </div>
            </div>
            <div style={{ ...T.label, letterSpacing: 0, color: M.taupe, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
              {money(num(p, "amount", "amountSen"))}
            </div>
          </div>
        ))
      )}
    </Surface>
  );
}

function MoneyFigure({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ ...T.label, textTransform: "uppercase", color: M.muted }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 15, fontWeight: 700, color, fontVariantNumeric: "tabular-nums", wordBreak: "break-word" }}>{value}</div>
    </div>
  );
}

/** Two equal columns of the same blocks; the right column starts level with the left. */
function TwoColumns({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", columnGap: 16, alignItems: "start" }}>
      <div style={{ minWidth: 0 }}>{left}</div>
      {/* The first right-hand block's top margin is 12px against the left's 16px. */}
      <div style={{ minWidth: 0, paddingTop: 4 }}>{right}</div>
    </div>
  );
}

function DateFact({
  icon,
  label,
  value,
  countdown,
  empty = "Not set",
  wrap,
  span,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  countdown?: string;
  empty?: string;
  wrap?: boolean;
  span?: boolean;
}) {
  return (
    <div style={{ minWidth: 0, gridColumn: span ? "1 / -1" : undefined }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: M.ink }}>
        {icon}
        {label}
      </div>
      {value ? (
        <div
          style={{
            fontSize: 15, fontWeight: 700, color: M.raisin, marginTop: 4, fontVariantNumeric: "tabular-nums",
            ...(wrap ? { wordBreak: "break-word" } : { whiteSpace: "nowrap" }),
          }}
        >
          {value}
        </div>
      ) : (
        // Same line box as a value, so the columns stay aligned.
        <div style={{ fontSize: 15, lineHeight: 1.4, fontWeight: 500, color: M.muted, marginTop: 4 }}>{empty}</div>
      )}
      {countdown ? (
        <div style={{ fontSize: 12, fontWeight: 700, color: TXT.WARNING, marginTop: 2, whiteSpace: "nowrap" }}>{countdown}</div>
      ) : null}
    </div>
  );
}

function Collapsible({
  title,
  icon,
  count,
  open,
  onToggle,
  style,
  bodyPad = "0 15px 10px",
  children,
}: {
  title: string;
  icon: ReactNode;
  count?: string;
  open: boolean;
  onToggle: () => void;
  style?: React.CSSProperties;
  bodyPad?: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} style={{ marginTop: 12, ...style }}>
      <MobileCard padded={false} radius={18} style={{ border: "none", boxShadow: SHADOW_SM, overflow: "hidden" }}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          style={{
            width: "100%", minHeight: 56, display: "flex", alignItems: "center", gap: 8, padding: "0 15px",
            background: "none", border: "none", fontFamily: "inherit", cursor: "pointer", textAlign: "left",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          {icon}
          <span style={{ flex: 1, ...T.cardTitle, fontSize: 16, color: M.raisin }}>{title}</span>
          {count ? <span style={{ ...T.meta, color: M.ink }}>{count}</span> : null}
          <ChevronDown
            size={18}
            strokeWidth={1.9}
            color="var(--m-inv-icon)"
            aria-hidden
            style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .18s ease" }}
          />
        </button>
        {open ? <div style={{ padding: bodyPad }}>{children}</div> : null}
      </MobileCard>
    </section>
  );
}

/** Category tile / pill (design CT map) on the shared --m-cat-* tokens, dark-safe. */
function categoryTone(category: string): { bg: string; fg: string; Icon: LucideIcon; label: string } {
  const k = category.toUpperCase();
  if (k === "SOFA") return { bg: "var(--m-cat-sofa-bg)", fg: "var(--m-cat-sofa-fg)", Icon: Sofa, label: "SOFA" };
  if (k === "BEDFRAME") return { bg: "var(--m-cat-bedframe-bg)", fg: "var(--m-cat-bedframe-fg)", Icon: BedDouble, label: "BEDFRAME" };
  if (k === "ACCESSORY") return { bg: "var(--m-cat-accessory-bg)", fg: "var(--m-cat-accessory-fg)", Icon: Lamp, label: "ACCESSORY" };
  return { bg: "var(--m-cat-other-bg)", fg: "var(--m-cat-other-fg)", Icon: Package, label: (titleCase(category) || "Other").toUpperCase() };
}

function ItemCard({
  item,
  soLine,
  override,
  open,
  onToggle,
}: {
  item: RawRow;
  soLine: string;
  override: RawRow | null;
  open: boolean;
  onToggle: () => void;
}) {
  const name = str(item, "productName", "description", "productCode") || "—";
  const sku = str(item, "productCode");
  const specLine = [str(item, "sizeLabel"), str(item, "fabricCode")].filter(Boolean).join(" · ");
  const chips = specChips(item);
  const extras = surcharges(item);
  const discount = num(item, "discountSen");
  const lineNote = str(item, "notes").trim();
  const cat = categoryTone(str(item, "itemCategory"));
  const CatIcon = cat.Icon;
  const base = num(item, "basePriceSen");
  const facts: [string, string, boolean?][] = [
    ["SO line", soLine],
    ["Category", titleCase(str(item, "itemCategory"))],
    ["Size", str(item, "sizeLabel")],
    ["Fabric", str(item, "fabricCode")],
    ["Base price", base > 0 ? money(base) : ""],
    ...extras.map((x) => [`${x.label} surcharge`, `+ ${money(x.sen)}`] as [string, string]),
    ["Unit price", money(num(item, "unitPriceSen")), !!override],
    ["Line total", money(num(item, "lineTotalSen"))],
  ];
  return (
    <MobileCard padded={false} radius={16} style={{ border: "none", boxShadow: SHADOW_SM, overflow: "hidden" }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          width: "100%", display: "flex", alignItems: "flex-start", gap: 10, textAlign: "left", background: "none",
          border: "none", padding: "14px 14px 13px 15px", minHeight: 44, fontFamily: "inherit", cursor: "pointer",
          color: "inherit", WebkitTapHighlightColor: "transparent",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <span
              aria-hidden
              style={{ width: 36, height: 36, flex: "none", borderRadius: 11, background: cat.bg, display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <CatIcon size={17} strokeWidth={1.8} color={cat.fg} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: M.raisin, lineHeight: 1.35, letterSpacing: "-0.15px", wordBreak: "break-word" }}>{name}</div>
              <div
                style={{
                  display: "inline-flex", alignItems: "center", height: 20, marginTop: 3, padding: "0 7px", borderRadius: 6,
                  background: cat.bg, color: cat.fg, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3,
                }}
              >
                {cat.label}
              </div>
            </div>
          </div>
          {sku ? (
            <div style={{ fontSize: 12, fontWeight: 600, color: M.taupe, marginTop: 3, paddingLeft: 46, letterSpacing: 0.2, wordBreak: "break-all" }}>{sku}</div>
          ) : null}
          {specLine ? (
            <div style={{ paddingLeft: 46, fontSize: 12.5, color: M.ink, marginTop: 5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {specLine}
            </div>
          ) : null}
        </div>
        <div style={{ flex: "none", textAlign: "right" }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
            {money(num(item, "lineTotalSen"))}
          </div>
          <div style={{ fontSize: 12, color: M.ink, marginTop: 3, whiteSpace: "nowrap" }}>Qty {num(item, "quantity", "qty")}</div>
          <ChevronDown
            size={18}
            strokeWidth={1.9}
            color="var(--m-inv-icon)"
            aria-hidden
            style={{ marginTop: 4, transform: open ? "rotate(180deg)" : "none", transition: "transform .18s ease" }}
          />
        </div>
      </button>
      {open ? (
        <div style={{ padding: "0 15px 14px" }}>
          <div style={{ height: 1, background: M.divider, marginBottom: 6 }} />
          {facts
            .filter(([, v]) => v)
            .map(([k, v, warn]) => (
              <Fact key={k} k={k} v={v} warn={warn} />
            ))}
          {discount > 0 ? <Fact k="Line discount" v={`− ${money(discount)}`} /> : null}
          {chips.length ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              {chips.map((c) => (
                <span
                  key={c.key}
                  style={{
                    height: 24, display: "inline-flex", alignItems: "center", padding: "0 9px", borderRadius: 8,
                    background: CHIP_TONE[c.key].bg, color: CHIP_TONE[c.key].fg, fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap",
                  }}
                >
                  {c.text}
                </span>
              ))}
            </div>
          ) : null}
          {lineNote ? (
            <div style={{ fontSize: 12.5, color: M.raisin, marginTop: 10, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              <span style={{ color: M.ink }}>Line note: </span>
              {lineNote}
            </div>
          ) : null}
          {override ? (
            <div
              role="note"
              style={{
                display: "flex", gap: 8, marginTop: 10, padding: "9px 11px", borderRadius: 10,
                background: tint("#9C6F1E", 0.12), fontSize: 12.5, lineHeight: 1.45, color: "var(--m-inv-body)",
              }}
            >
              <TriangleAlert size={14} strokeWidth={2} color={TXT.WARNING} aria-hidden style={{ flex: "none", marginTop: 2 }} />
              <span style={{ minWidth: 0, wordBreak: "break-word" }}>
                Price override: {money(num(override, "originalPrice"))} → {money(num(override, "overridePrice"))}
                {str(override, "reason") ? ` · ${str(override, "reason")}` : ""}
                {str(override, "approvedBy") ? ` · approved by ${str(override, "approvedBy")}` : ""}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </MobileCard>
  );
}

function Fact({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0", fontSize: 12.5 }}>
      <span style={{ color: M.ink, minWidth: 0 }}>{k}</span>
      <span
        style={{
          display: "flex", alignItems: "center", gap: 5, fontWeight: 600, color: M.raisin, textAlign: "right",
          fontVariantNumeric: "tabular-nums", minWidth: 0, wordBreak: "break-word",
        }}
      >
        {warn ? <TriangleAlert size={13} strokeWidth={2} color={TXT.WARNING} aria-label="Price overridden" /> : null}
        {v}
      </span>
    </div>
  );
}

type Entry = { key: string; dot: string; head: ReactNode; detail: string; chips: string[]; meta: string };

function Timeline({ entries, empty }: { entries: Entry[]; empty: string }) {
  if (!entries.length) {
    return (
      <ol style={{ listStyle: "none", margin: "14px 0 0", padding: 0 }}>
        <li style={{ display: "flex", gap: 12, paddingBottom: 16 }}>
          <span aria-hidden style={{ width: 14, height: 14, flex: "none", boxSizing: "border-box", borderRadius: "50%", marginTop: 3, background: "var(--m-inv-dot-ring)", border: "3px solid var(--m-inv-dot-ring)" }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: M.raisin }}>{empty}</span>
        </li>
      </ol>
    );
  }
  return (
    <ol style={{ listStyle: "none", margin: "14px 0 0", padding: 0 }}>
      {entries.map((e, i) => (
        <li key={e.key} style={{ position: "relative", display: "flex", gap: 12, paddingBottom: 16 }}>
          {i < entries.length - 1 ? (
            <span aria-hidden style={{ position: "absolute", left: 6, top: 16, bottom: 0, width: 2, background: "var(--m-inv-line)" }} />
          ) : null}
          <span
            aria-hidden
            style={{
              position: "relative", width: 14, height: 14, flex: "none", boxSizing: "border-box", borderRadius: "50%",
              marginTop: 3, background: i === 0 ? e.dot : M.card, border: `3px solid ${e.dot}`,
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div>{e.head}</div>
            {e.detail ? (
              <div style={{ fontSize: 12.5, lineHeight: 1.45, color: "var(--m-inv-body)", marginTop: 4, wordBreak: "break-word", fontVariantNumeric: "tabular-nums" }}>{e.detail}</div>
            ) : null}
            {e.chips.length ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
                {e.chips.map((c, j) => (
                  <span
                    key={j}
                    style={{
                      height: 22, display: "inline-flex", alignItems: "center", padding: "0 8px", borderRadius: 6,
                      background: "var(--m-inv-info-bg)", color: "var(--m-inv-info)", fontSize: 11, fontWeight: 600,
                    }}
                  >
                    {c}
                  </span>
                ))}
              </div>
            ) : null}
            {e.meta ? <div style={{ fontSize: 12, color: M.ink, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{e.meta}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
