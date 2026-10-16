// ===========================================================================
// SalesDetailPhone — PHONE Sales Order detail (read-only).
//
// Owner 2026-10-16: follows Claude Design `Sales Order Detail.dc.html` for the
// visual layout only; every value is real ERP data from GET
// /api/sales-orders/:id (+ /api/audit-events, + /api/files for the Customer
// PO attachment, the same three reads desktop makes). Mapping lives in
// lib/so-detail.ts and mirrors src/pages/sales/detail.tsx.
//
// Read-only by decision: no action bar, no edit / confirm / cancel / issue
// DO; no Paid / Balance / Payments. Tablet keeps the original screen with its
// actions (SalesDetailScreen picks between the two).
//
// Order: header → overview → notes → progress (production + delivery) →
// items → documents / more details / history (collapsed).
// ===========================================================================
import { useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowRight,
  Ban,
  CalendarCheck,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  CirclePause,
  CloudOff,
  ExternalLink,
  Factory,
  FileText,
  Files,
  History,
  Info,
  MapPin,
  Package,
  TriangleAlert,
  Truck,
  Warehouse,
} from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { MobileHeader, MobileCard, SegmentedSwitch } from "../components";
import { M, M_ACCENT, titleCaseStatus, type SemanticStyle } from "../theme";
import { resolveStatus, STATUS_MAPS, str, num, money } from "../config/helpers";
import {
  auditEvents,
  deliverySummary,
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
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 9999,
        backgroundColor: tint(style.hex, 0.14),
        color: STATUS_TEXT[style.hex] ?? M.body,
        fontWeight: 600,
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
        padding: size === "sm" ? "2px 9px" : "4px 11px",
        fontSize: size === "sm" ? 11 : 12,
        lineHeight: 1.3,
      }}
    >
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
const PO_PREVIEW = 4;

export function SalesDetailPhone() {
  const navigate = useNavigate();
  const { id = "" } = useParams();
  const url = `/api/sales-orders/${encodeURIComponent(id)}`;
  const { data, loading, error, refresh } = useCachedJson<Envelope>(url);
  const doc = data?.data ?? null;
  // The route id may be a companySOId (the GET resolves it); audit + files
  // are keyed on the real row id, as desktop does.
  const docId = doc ? str(doc, "id") || id : "";

  const [notesOpen, setNotesOpen] = useState(false);
  const [prodOpen, setProdOpen] = useState(false);
  const [poAll, setPoAll] = useState(false);
  const [dlvOpen, setDlvOpen] = useState(false);
  const [allItems, setAllItems] = useState(false);
  const [openItems, setOpenItems] = useState<Record<string, boolean>>({});
  const [docsOpen, setDocsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [histTab, setHistTab] = useState<"status" | "audit">("status");

  // Fetched only once the section that needs them is opened.
  const audit = useCachedJson<ListResp>(
    historyOpen && histTab === "audit" && docId
      ? `/api/audit-events?resource=sales-orders&resourceId=${encodeURIComponent(docId)}`
      : null,
  );
  const files = useCachedJson<ListResp>(
    docsOpen && docId ? `/api/files?resourceType=SO&resourceId=${encodeURIComponent(docId)}` : null,
  );

  const header = (title: string) => <MobileHeader title={title} onBack={() => navigate(-1)} />;

  if (loading && !doc) {
    return (
      <>
        {header("Sales Order")}
        <div aria-busy="true" aria-label="Loading sales order" style={{ padding: "16px 16px 24px" }}>
          {[96, 190, 150, 120].map((h, i) => (
            <div
              key={i}
              style={{ height: h, borderRadius: 20, background: M.card, boxShadow: SHADOW_SM, marginTop: i ? 12 : 0, opacity: 0.7 }}
            />
          ))}
        </div>
      </>
    );
  }
  if (error && !doc) {
    return (
      <>
        {header("Sales Order")}
        <div role="alert" style={{ padding: "56px 24px", textAlign: "center" }}>
          <div
            style={{
              width: 48, height: 48, borderRadius: 14, margin: "0 auto",
              display: "flex", alignItems: "center", justifyContent: "center",
              background: M_ACCENT.danger.bg,
            }}
          >
            <CloudOff size={22} strokeWidth={1.9} color={M_ACCENT.danger.fg} />
          </div>
          <div style={{ ...T.cardTitle, color: M.raisin, marginTop: 14 }}>Couldn’t load this sales order</div>
          <div style={{ ...T.meta, color: M.ink, marginTop: 4 }}>Check your connection and try again.</div>
          <button
            type="button"
            onClick={() => refresh()}
            style={{
              marginTop: 16, height: 44, padding: "0 22px", borderRadius: 9999, border: "none",
              background: M.taupe, color: "var(--m-text-on-accent)", fontFamily: "inherit",
              fontSize: "var(--m-type-button-size)", fontWeight: 700, cursor: "pointer",
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
  const overrides = rows(env.priceOverrides);
  const history = rows(env.statusHistory);
  const notes = str(doc, "notes").trim();
  const banner = statusBanner(doc, history, fmtDateTime);
  const prod = productionSummary(pos);
  const dlvCounts = deliverySummary(dos);
  const shownItems = allItems ? items : items.slice(0, ITEMS_PREVIEW);
  const sortedPOs = sortPOs(pos);
  const shownPOs = poAll ? sortedPOs : sortedPOs.slice(0, PO_PREVIEW);

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

  return (
    <>
      {header(companySOId || "Sales Order")}
      <div style={{ padding: "14px 16px 28px" }}>
        {/* 1 · Header */}
        <section aria-label="Order header" style={{ padding: "0 2px" }}>
          <StatusChip style={pill.style} label={pill.label} size="md" />
          <h1
            style={{
              margin: "10px 0 0", fontSize: "var(--m-type-section-heading-size)",
              lineHeight: "var(--m-type-section-heading-line-height)", fontWeight: 700,
              letterSpacing: "var(--m-type-section-heading-tracking)", color: M.raisin, wordBreak: "break-word",
            }}
          >
            {str(doc, "customerName") || "—"}
          </h1>
          {str(doc, "customerState") ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, ...T.meta, color: M.ink }}>
              <MapPin size={13} strokeWidth={1.9} color={M.taupe} aria-hidden />
              {str(doc, "customerState")}
            </div>
          ) : null}
          {banner ? (
            <div
              role="status"
              style={{
                display: "flex", gap: 11, alignItems: "flex-start", marginTop: 12, padding: "12px 14px",
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
        </section>

        {/* 2 · Overview */}
        <Surface ariaLabel="Order overview" style={{ marginTop: 16, padding: "18px 18px 16px" }}>
          <div style={{ ...T.label, textTransform: "uppercase", color: M.taupe }}>Order total</div>
          <div
            style={{
              marginTop: 6, fontSize: "var(--m-type-business-value-size)", lineHeight: "var(--m-type-business-value-line-height)",
              fontWeight: 700, letterSpacing: "var(--m-type-business-value-tracking)", color: M.raisin,
              fontVariantNumeric: "tabular-nums", wordBreak: "break-word",
            }}
          >
            {money(num(doc, "totalSen"))}
          </div>
          <div style={{ height: 1, background: M.divider, margin: "16px 0 14px" }} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "14px 16px" }}>
            <DateFact icon={<CalendarCheck size={14} strokeWidth={1.9} color={M.taupe} aria-hidden />} label="Customer DD" value={fmtDate(str(doc, "customerDeliveryDate"))} />
            <DateFact icon={<CalendarClock size={14} strokeWidth={1.9} color={M.taupe} aria-hidden />} label="Hookka Expected DD" value={fmtDate(str(doc, "hookkaExpectedDD"))} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, padding: "11px 12px", borderRadius: 12, background: M.paper }}>
            <Warehouse size={16} strokeWidth={1.9} color={M.taupe} aria-hidden style={{ flex: "none" }} />
            <span style={{ flex: "none", ...T.meta, color: M.ink }}>Delivery Hub</span>
            {str(doc, "hubName") ? (
              <span style={{ flex: 1, minWidth: 0, textAlign: "right", ...T.label, letterSpacing: 0, color: M.raisin, wordBreak: "break-word" }}>
                {str(doc, "hubName")}
              </span>
            ) : (
              <span style={{ flex: 1, minWidth: 0, textAlign: "right", ...T.meta, color: M.muted }}>Not assigned</span>
            )}
          </div>
        </Surface>

        {/* 3 · Notes (hidden when empty) */}
        {notes ? (
          <Surface ariaLabel="Notes" style={{ marginTop: 12, padding: "14px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, ...T.label, textTransform: "uppercase", color: M.taupe }}>
              <FileText size={14} strokeWidth={1.9} aria-hidden /> Notes
            </div>
            <div
              style={{
                ...T.body, color: M.raisin, marginTop: 6, whiteSpace: "pre-wrap", wordBreak: "break-word",
                ...(notesOpen ? null : { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }),
              }}
            >
              {notes}
            </div>
            {notes.length > 70 || notes.includes("\n") ? (
              <TextButton onClick={() => setNotesOpen((v) => !v)} expanded={notesOpen}>
                {notesOpen ? "Show less" : "Read more"}
              </TextButton>
            ) : null}
          </Surface>
        ) : null}

        {/* 4 · Order progress */}
        <Surface ariaLabel="Order progress" style={{ marginTop: 12, padding: 0, overflow: "hidden" }}>
          {/* Production */}
          <ExpandRow
            expanded={prodOpen}
            onToggle={pos.length ? () => setProdOpen((v) => !v) : undefined}
            tile={M_ACCENT.info}
            icon={<Factory size={17} strokeWidth={1.9} color={M_ACCENT.info.fg} aria-hidden />}
            eyebrow="Production"
            eyebrowColor={TXT.INFO}
            headline={pos.length ? `${prod.completed} of ${prod.total} production orders completed` : "No production orders yet"}
          >
            {pos.length ? (
              <>
                <div aria-hidden style={{ display: "flex", gap: 3, marginTop: 12, height: 8 }}>
                  {prod.counts.flatMap((c) =>
                    Array.from({ length: c.count }, (_, i) => (
                      <span key={`${c.status}${i}`} style={{ flex: 1, borderRadius: 9999, background: poHex(c.status) }} />
                    )),
                  )}
                </div>
                {prod.counts.some((c) => c.status !== "COMPLETED") ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginTop: 9 }}>
                    {prod.counts.map((c) => (
                      <span key={c.status} style={{ display: "inline-flex", alignItems: "center", gap: 6, ...T.meta, color: M.raisin, whiteSpace: "nowrap" }}>
                        <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: poHex(c.status) }} />
                        {c.label} · {c.count}
                      </span>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
          </ExpandRow>
          {prodOpen && pos.length ? (
            <div style={{ padding: "0 16px 6px" }}>
              {shownPOs.map((p, i) => {
                const ps = resolveStatus(str(p, "status"), STATUS_MAPS.production);
                return (
                  <div key={str(p, "id") || i} style={{ padding: "10px 0", borderTop: `1px solid ${M.divider}` }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                      <span style={{ ...T.label, letterSpacing: 0, color: M.raisin, fontVariantNumeric: "tabular-nums", minWidth: 0, wordBreak: "break-all" }}>
                        {displaySoId(str(p, "poNo"), str(p, "itemCategory")) || "—"}
                      </span>
                      <StatusChip style={ps.style} label={ps.label} size="sm" />
                    </div>
                    <div style={{ ...T.meta, color: M.ink, marginTop: 3, wordBreak: "break-word" }}>
                      {[str(p, "productName"), num(p, "quantity") ? `Qty ${num(p, "quantity")}` : "", productionLabel(p, fmtDate)]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                );
              })}
              {sortedPOs.length > PO_PREVIEW ? (
                <TextButton onClick={() => setPoAll((v) => !v)} expanded={poAll}>
                  {poAll ? "Show fewer" : `View all ${sortedPOs.length} production orders`}
                </TextButton>
              ) : null}
            </div>
          ) : null}

          <div style={{ height: 1, background: M.divider }} />

          {/* Delivery */}
          <ExpandRow
            expanded={dlvOpen}
            onToggle={dos.length ? () => setDlvOpen((v) => !v) : undefined}
            tile={M_ACCENT.gold}
            icon={<Truck size={17} strokeWidth={1.9} color={M_ACCENT.gold.fg} aria-hidden />}
            eyebrow="Delivery"
            eyebrowColor={M.taupe}
            headline={dos.length ? `${dos.length} delivery order${dos.length === 1 ? "" : "s"} linked` : "No delivery orders yet"}
          >
            {dlvCounts.length ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 11 }}>
                {dlvCounts.map((c) => {
                  const ds = resolveStatus(c.status, STATUS_MAPS.delivery);
                  return <StatusChip key={c.status} style={ds.style} label={`${c.label} · ${c.count}`} size="sm" />;
                })}
              </div>
            ) : null}
          </ExpandRow>
          {dlvOpen && dos.length ? (
            <div style={{ padding: "0 8px 8px" }}>
              {dos.map((d, i) => {
                const ds = resolveStatus(str(d, "status"), STATUS_MAPS.delivery);
                const doId = str(d, "id");
                const facts = doFacts(d, fmtDate);
                return (
                  <LinkRow
                    key={doId || i}
                    onClick={doId ? () => navigate(`/m/delivery/${encodeURIComponent(doId)}`) : undefined}
                    title={str(d, "doNo") || "—"}
                    trailing={<StatusChip style={ds.style} label={doLabel(str(d, "status"))} size="sm" />}
                    sub={facts.join(" · ")}
                    ariaLabel={`Delivery order ${str(d, "doNo")}, ${doLabel(str(d, "status"))}`}
                  />
                );
              })}
            </div>
          ) : null}
        </Surface>

        {/* 5 · Items */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "26px 2px 10px" }}>
          <Package size={16} strokeWidth={1.9} color={M.taupe} aria-hidden />
          <span style={{ ...T.cardTitle, color: M.raisin }}>Order items</span>
        </div>
        {items.length === 0 ? (
          <Surface style={{ padding: 22, textAlign: "center", ...T.body, color: M.ink }} radius={16}>
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
              width: "100%", minHeight: 44, marginTop: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              borderRadius: 14, border: `1px solid ${M.border}`, background: M.card, color: M.taupe,
              fontFamily: "inherit", fontSize: "var(--m-type-button-size)", fontWeight: 700, cursor: "pointer",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {allItems ? "Show fewer items" : `View all ${items.length} items`}
            <ChevronDown size={16} strokeWidth={2} aria-hidden style={{ transform: allItems ? "rotate(180deg)" : "none" }} />
          </button>
        ) : null}

        {/* 6 · Documents (collapsed) */}
        <Collapsible
          title="Documents"
          icon={<Files size={16} strokeWidth={1.9} color={M.taupe} aria-hidden />}
          count={invoices.length ? `${invoices.length} invoice${invoices.length === 1 ? "" : "s"}` : undefined}
          open={docsOpen}
          onToggle={() => setDocsOpen((v) => !v)}
          style={{ marginTop: 22 }}
        >
          <SubLabel>Customer PO</SubLabel>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0 12px" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ ...T.label, letterSpacing: 0, color: customerPOId ? M.raisin : M.muted, wordBreak: "break-all" }}>
                {customerPOId || "Not recorded"}
              </div>
              <div style={{ ...T.meta, color: M.ink, marginTop: 2 }}>
                {poFile || poImage
                  ? "Original PO file attached"
                  : files.loading
                    ? "Checking for the PO file…"
                    : "No PO file attached"}
              </div>
            </div>
            {poFile || poImage ? (
              <button
                type="button"
                onClick={openCustomerPO}
                aria-label="View original customer PO"
                style={{
                  flex: "none", minHeight: 44, padding: "0 14px", display: "inline-flex", alignItems: "center", gap: 6,
                  borderRadius: 12, border: `1px solid ${M.border}`, background: M.card, color: M.taupe,
                  fontFamily: "inherit", fontSize: "var(--m-type-button-size)", fontWeight: 700, cursor: "pointer",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                View <ExternalLink size={15} strokeWidth={1.9} aria-hidden />
              </button>
            ) : null}
          </div>
          <div style={{ height: 1, background: M.divider }} />
          <SubLabel>Invoices</SubLabel>
          {invoices.length === 0 ? (
            <div style={{ ...T.meta, color: M.ink, padding: "6px 0 12px" }}>No invoice yet.</div>
          ) : (
            <div style={{ margin: "0 -8px", paddingBottom: 6 }}>
              {invoices.map((v, i) => {
                const invId = str(v, "id");
                return (
                  <LinkRow
                    key={invId || i}
                    title={str(v, "invoiceNo") || "—"}
                    onClick={invId.startsWith("inv-") ? () => navigate(`/m/invoices/${encodeURIComponent(invId)}`) : undefined}
                    ariaLabel={`Invoice ${str(v, "invoiceNo")}`}
                  />
                );
              })}
            </div>
          )}
        </Collapsible>

        {/* 7 · More details (collapsed) */}
        <Collapsible
          title="More details"
          icon={<Info size={16} strokeWidth={1.9} color={M.taupe} aria-hidden />}
          open={infoOpen}
          onToggle={() => setInfoOpen((v) => !v)}
        >
          {([
            ["Customer SO", str(doc, "customerSOId", "customerSO")],
            ["Reference", str(doc, "reference")],
            ["Order Date", fmtDate(str(doc, "companySODate"))],
          ] as [string, string][]).map(([k, v], i) => (
            <div
              key={k}
              style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 0", borderTop: i ? `1px solid ${M.divider}` : "none" }}
            >
              <span style={{ ...T.meta, color: M.ink, flex: "none" }}>{k}</span>
              <span style={{ ...T.label, letterSpacing: 0, color: v ? M.raisin : M.muted, textAlign: "right", minWidth: 0, wordBreak: "break-word" }}>
                {v || "—"}
              </span>
            </div>
          ))}
        </Collapsible>

        {/* 8 · History (collapsed) */}
        <Collapsible
          title="History"
          icon={<History size={16} strokeWidth={1.9} color={M.taupe} aria-hidden />}
          open={historyOpen}
          onToggle={() => setHistoryOpen((v) => !v)}
        >
          <SegmentedSwitch
            ariaLabel="History view"
            options={[
              { key: "status", label: "Status history" },
              { key: "audit", label: "Audit history" },
            ]}
            value={histTab}
            onChange={setHistTab}
          />
          {histTab === "status" ? (
            <Timeline
              empty="No status changes recorded yet."
              entries={statusEvents(history).map((e) => ({
                key: e.key,
                dot: e.override ? "#9C6F1E" : resolveStatus(e.to, STATUS_MAPS.so).style.hex,
                head: e.override ? (
                  <span style={{ ...T.label, letterSpacing: 0, color: TXT.WARNING }}>Edit lock override</span>
                ) : (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <StatusChip style={resolveStatus(e.from, STATUS_MAPS.so).style} label={e.from || "—"} size="sm" />
                    <ArrowRight size={13} strokeWidth={2} color={M.muted} aria-label="to" />
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
              empty="No audit events recorded yet."
              entries={auditEvents(rows(audit.data?.data)).map((e) => ({
                key: e.key,
                dot: "#8B7A4E",
                head: <span style={{ ...T.label, letterSpacing: 0, color: M.raisin }}>{e.title}</span>,
                detail: e.fields.length ? `Changed: ${e.fields.join(", ")}` : "",
                chips: [],
                meta: [fmtDateTime(e.at), e.by].filter(Boolean).join(" · "),
              }))}
            />
          )}
        </Collapsible>
      </div>
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

function DateFact({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, ...T.meta, color: M.ink }}>
        {icon}
        {label}
      </div>
      {value ? (
        <div style={{ ...T.cardTitle, color: M.raisin, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      ) : (
        // Same line box as a date, so the two columns stay aligned.
        <div style={{ ...T.cardTitle, fontSize: "var(--m-type-metadata-size)", fontWeight: 500, color: M.muted, marginTop: 4 }}>
          Not set
        </div>
      )}
    </div>
  );
}

function TextButton({ children, onClick, expanded }: { children: ReactNode; onClick: () => void; expanded: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      style={{
        minHeight: 44, padding: 0, display: "inline-flex", alignItems: "center", gap: 4, border: "none",
        background: "none", color: M.taupe, fontFamily: "inherit", fontSize: "var(--m-type-button-size)",
        fontWeight: 700, cursor: "pointer", WebkitTapHighlightColor: "transparent",
      }}
    >
      {children}
      <ChevronDown size={16} strokeWidth={2} aria-hidden style={{ transform: expanded ? "rotate(180deg)" : "none" }} />
    </button>
  );
}

/** One half of the progress card: icon tile, eyebrow, headline, summary
 *  children, and a chevron when there is a list to open. */
function ExpandRow({
  expanded,
  onToggle,
  tile,
  icon,
  eyebrow,
  eyebrowColor,
  headline,
  children,
}: {
  expanded: boolean;
  onToggle?: () => void;
  tile: { bg: string };
  icon: ReactNode;
  eyebrow: string;
  eyebrowColor: string;
  headline: string;
  children?: ReactNode;
}) {
  const inner = (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{ width: 34, height: 34, flex: "none", borderRadius: 10, background: tile.bg, display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          {icon}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...T.label, textTransform: "uppercase", color: eyebrowColor }}>{eyebrow}</div>
          <div style={{ ...T.label, fontSize: "var(--m-type-description-size)", fontWeight: 700, letterSpacing: 0, color: M.raisin, marginTop: 2 }}>
            {headline}
          </div>
        </div>
        {onToggle ? (
          <ChevronDown
            size={18}
            strokeWidth={1.9}
            color={M.taupe}
            aria-hidden
            style={{ flex: "none", transform: expanded ? "rotate(180deg)" : "none", transition: "transform .18s ease" }}
          />
        ) : null}
      </div>
      {children}
    </>
  );
  const pad = { padding: "14px 16px", display: "block", width: "100%", boxSizing: "border-box" } as const;
  return onToggle ? (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      style={{
        ...pad, textAlign: "left", background: "none", border: "none", fontFamily: "inherit", color: "inherit",
        cursor: "pointer", WebkitTapHighlightColor: "transparent",
      }}
    >
      {inner}
    </button>
  ) : (
    <div style={pad}>{inner}</div>
  );
}

function LinkRow({
  title,
  sub,
  trailing,
  onClick,
  ariaLabel,
}: {
  title: string;
  sub?: string;
  trailing?: ReactNode;
  onClick?: () => void;
  ariaLabel: string;
}) {
  const content = (
    <>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ ...T.label, letterSpacing: 0, color: M.raisin, fontVariantNumeric: "tabular-nums" }}>{title}</span>
          {trailing}
        </div>
        {sub ? <div style={{ ...T.meta, color: M.ink, marginTop: 3 }}>{sub}</div> : null}
      </div>
      {onClick ? <ChevronRight size={18} strokeWidth={1.9} color={M.taupe} aria-hidden style={{ flex: "none" }} /> : null}
    </>
  );
  const base = {
    display: "flex", alignItems: "center", gap: 10, width: "100%", minHeight: 52, boxSizing: "border-box",
    padding: "8px 8px", borderRadius: 12, textAlign: "left",
  } as const;
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      style={{ ...base, background: "none", border: "none", fontFamily: "inherit", color: "inherit", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}
    >
      {content}
    </button>
  ) : (
    <div style={base}>{content}</div>
  );
}

function SubLabel({ children }: { children: ReactNode }) {
  return <div style={{ ...T.label, textTransform: "uppercase", color: M.muted, paddingTop: 10 }}>{children}</div>;
}

function Collapsible({
  title,
  icon,
  count,
  open,
  onToggle,
  style,
  children,
}: {
  title: string;
  icon: ReactNode;
  count?: string;
  open: boolean;
  onToggle: () => void;
  style?: React.CSSProperties;
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
          <span style={{ flex: 1, ...T.cardTitle, color: M.raisin }}>{title}</span>
          {count ? <span style={{ ...T.meta, color: M.ink }}>{count}</span> : null}
          <ChevronDown
            size={18}
            strokeWidth={1.9}
            color={M.taupe}
            aria-hidden
            style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .18s ease" }}
          />
        </button>
        {open ? <div style={{ padding: "0 15px 10px" }}>{children}</div> : null}
      </MobileCard>
    </section>
  );
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
  const facts: [string, string, boolean?][] = [
    ["SO line", soLine],
    ["Category", titleCase(str(item, "itemCategory"))],
    ["Size", str(item, "sizeLabel")],
    ["Fabric", str(item, "fabricCode")],
    ["Unit price", money(num(item, "unitPriceSen")), !!override],
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
          <div style={{ ...T.cardTitle, color: M.raisin, wordBreak: "break-word" }}>{name}</div>
          {sku ? <div style={{ ...T.label, color: M.taupe, marginTop: 3, wordBreak: "break-all" }}>{sku}</div> : null}
          {specLine ? (
            <div style={{ ...T.meta, color: M.ink, marginTop: 5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {specLine}
            </div>
          ) : null}
        </div>
        <div style={{ flex: "none", textAlign: "right" }}>
          <div style={{ ...T.cardTitle, color: M.raisin, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
            {money(num(item, "lineTotalSen"))}
          </div>
          <div style={{ ...T.meta, color: M.ink, marginTop: 3, whiteSpace: "nowrap" }}>Qty {num(item, "quantity", "qty")}</div>
          <ChevronDown
            size={18}
            strokeWidth={1.9}
            color={M.taupe}
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
          {extras.length ? (
            <>
              <div style={{ ...T.meta, color: M.muted, padding: "8px 0 2px" }}>Included in unit price</div>
              {extras.map((x, i) => (
                <Fact key={`${x.label}${i}`} k={x.label} v={`+ ${money(x.sen)}`} />
              ))}
            </>
          ) : null}
          {chips.length ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              {chips.map((c) => (
                <span
                  key={c.key}
                  style={{
                    height: 24, display: "inline-flex", alignItems: "center", padding: "0 9px", borderRadius: 8,
                    background: CHIP_TONE[c.key].bg, color: CHIP_TONE[c.key].fg, fontSize: "var(--m-type-status-size)",
                    fontWeight: 600, whiteSpace: "nowrap",
                  }}
                >
                  {c.text}
                </span>
              ))}
            </div>
          ) : null}
          {lineNote ? (
            <div style={{ ...T.meta, color: M.raisin, marginTop: 10, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              <span style={{ color: M.ink }}>Line note: </span>
              {lineNote}
            </div>
          ) : null}
          {override ? (
            <div
              role="note"
              style={{
                display: "flex", gap: 8, marginTop: 10, padding: "9px 11px", borderRadius: 10,
                background: tint("#9C6F1E", 0.12), ...T.meta, color: M.raisin,
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
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0", ...T.meta }}>
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
  if (!entries.length) return <div style={{ ...T.meta, color: M.ink, padding: "14px 0 8px" }}>{empty}</div>;
  return (
    <ol style={{ listStyle: "none", margin: "14px 0 0", padding: 0 }}>
      {entries.map((e, i) => (
        <li key={e.key} style={{ position: "relative", display: "flex", gap: 12, paddingBottom: 16 }}>
          {i < entries.length - 1 ? (
            <span aria-hidden style={{ position: "absolute", left: 6, top: 16, bottom: 0, width: 2, background: M.divider }} />
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
              <div style={{ ...T.meta, color: M.raisin, marginTop: 4, wordBreak: "break-word" }}>{e.detail}</div>
            ) : null}
            {e.chips.length ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
                {e.chips.map((c, j) => (
                  <span
                    key={j}
                    style={{
                      minHeight: 22, display: "inline-flex", alignItems: "center", padding: "2px 8px", borderRadius: 6,
                      background: M_ACCENT.info.bg, color: M_ACCENT.info.fg, fontSize: "var(--m-type-status-size)", fontWeight: 600,
                    }}
                  >
                    {c}
                  </span>
                ))}
              </div>
            ) : null}
            {e.meta ? <div style={{ ...T.meta, color: M.ink, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{e.meta}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
