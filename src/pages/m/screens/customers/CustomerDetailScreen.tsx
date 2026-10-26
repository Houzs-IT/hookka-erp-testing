// ===========================================================================
// CustomerDetailScreen — L2 /m/customers/:id (Claude Design `Customers v3.dc.html`).
// Same reads as the old generic detail (customerDetail in config/modules.ts):
//   GET /api/customers/:id            customer + deliveryHubs[]
//   GET /api/sales-orders?fields=customer-mini, GET /api/invoices
//     → matched to this customer by id OR name, first 20 (unchanged rule)
//   GET /api/users                    salespersonUserId → name (as desktop)
// Tapping a hub still opens the existing Edit Hub form (hubFormSpec).
// Visual-only changes: no "⋯" menu, stacked credit rows, wrapping values.
// ===========================================================================
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BadgeCheck, Building2, ChevronDown, ChevronRight, FileText, MapPin, Pencil, Tags, Warehouse, Mail, Phone, User, type LucideIcon } from "lucide-react";
import { sofaSeatLabel } from "@/lib/sofa-seat-heights";
import { useCachedJson } from "@/lib/cached-fetch";
import { usePermissions } from "@/lib/use-permission";
import { MobileHeader, FormSheet, Sheet } from "../../components";
import { M } from "../../theme";
import { money, num, selectDocData, shortDate, dateOnly, str } from "../../config/helpers";
import { editSpecFor, hubFormSpec } from "../../config/forms";
import { customerDetail } from "../../config/modules";
import { segmentButton, segmentTrack, CHIP_COUNT } from "../../lib/control-styles";
import type { RawRow } from "../../config/types";
import type { FormSpec } from "../../config/form-types";
import { DetailColumn, HeaderMore, MenuGroup, MenuRow } from "../procurement/parts";
import {
  TONE_COLOR, priceRows, creditOf, hubsOf, invTone, isActive, soTone, stageOf, stateText, termsLabel, titleCase, stripRM, type DocTone,
} from "./customer-lib";

const SHADOW = "0 1px 2px rgba(31,29,27,.05),0 12px 28px -16px rgba(31,29,27,.22)";
const ICON_COLOR = "var(--m-taupe-icon, #8B7A4E)";
const DIV = `1px solid ${M.divider}`;
const PRICE_PAGE = 20;

// Overflow menu, kept minimal for phones: Edit customer (editSpecFor) and
// Export Catalogue (customerDetail.extraActions, handled by the products page's
// ?autoCustomerCatalogueId link). "Edit Hubs" and "Quotation PDF" are NOT
// offered here: both only open the desktop customers list (nothing reads their
// ?autoOpenCustomerId link), so they stay desktop-only. Hubs are still edited
// by tapping a hub row. Server-side RBAC still applies to everything.
const ACTION_ICONS: Record<string, LucideIcon> = { "file-text": FileText };
// The catalogue export reads /api/customer-quotation (quotations:read) plus the
// product list (products).
const ACTION_PERM: Record<string, [string, string][]> = {
  "Export Catalogue": [["products", "read"], ["quotations", "read"]],
};

export function CustomerDetailScreen() {
  const { id = "" } = useParams();
  return <CustomerDetail key={id} id={id} />;
}

type Doc = { id: string; code: string; status: string; tone: DocTone; sub: string; amount: string; href: string };

function CustomerDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const resp = useCachedJson<unknown>(id ? `/api/customers/${encodeURIComponent(id)}` : null);
  const doc = resp.data ? selectDocData(resp.data, id) : null;
  const so = useCachedJson<{ data?: RawRow[] }>(doc ? "/api/sales-orders?fields=customer-mini" : null);
  const inv = useCachedJson<{ data?: RawRow[] }>(doc ? "/api/invoices" : null);
  const users = useCachedJson<{ data?: Array<{ id?: string; displayName?: string; email?: string }> }>(doc ? "/api/users" : null);

  const [docTab, setDocTab] = useState<"orders" | "invoices">("orders");
  const [infoOpen, setInfoOpen] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [priceVisible, setPriceVisible] = useState(PRICE_PAGE);
  const [openSofa, setOpenSofa] = useState<Record<string, boolean>>({});
  // Same read and same date expression as the desktop Customer Products grid.
  // Fetched only once the card is opened: a customer can have 375+ SKUs.
  const priceCid = doc ? str(doc, "id") : "";
  const priceUrl = pricingOpen && priceCid
    ? `/api/customer-products?customerId=${encodeURIComponent(priceCid)}&asOf=${new Date().toISOString().slice(0, 10)}`
    : null;
  const prices = useCachedJson<{ success?: boolean; data?: RawRow[] }>(priceUrl);
  const [formSpec, setFormSpec] = useState<FormSpec | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const { hasPermission, loading: permLoading } = usePermissions();

  const back = () => navigate(-1);
  const header = (title: string, more = false) => (
    <MobileHeader title={title} onBack={back} glass trailing={more ? <HeaderMore label="More actions" onClick={() => setMoreOpen(true)} /> : null} />
  );

  if (!doc) {
    if (resp.loading || !resp.error) {
      return (
        <>
          {header("Customer")}
          <DetailColumn>
            <div aria-busy="true" aria-label="Loading customer">
              {[90, 210, 64, 150].map((h, i) => (
                <div key={i} style={{ height: h, borderRadius: 20, background: M.card, boxShadow: SHADOW, marginTop: i ? 12 : 14, opacity: 0.7 }} />
              ))}
            </div>
          </DetailColumn>
        </>
      );
    }
    return (
      <>
        {header("Customer")}
        <div style={{ padding: "60px 18px", textAlign: "center", color: M.muted, fontSize: 13.5 }}>
          {resp.failure?.kind === "notFound" ? "Customer not found." : "Couldn’t load this customer. Check your connection and try again."}
        </div>
      </>
    );
  }

  // ⋯ menu: shown only for actions this user may run; hidden while permissions load.
  const can = (p?: [string, string][]) => !permLoading && (p ?? []).every(([r, a]) => hasPermission(r, a));
  const canEditHubs = can([["customers", "update"]]);
  const editSpec = canEditHubs ? editSpecFor("customers", doc, id) : null;
  const extra = (customerDetail.extraActions?.(doc, id) ?? []).filter((a) => a.label in ACTION_PERM && can(ACTION_PERM[a.label]));
  const hasMenu = !!editSpec || extra.length > 0;
  const runExtra = (a: (typeof extra)[number]) => {
    setMoreOpen(false);
    if (a.formSpec) setFormSpec(a.formSpec());
    else if (a.onClick) void a.onClick(navigate);
    else if (a.to) navigate(a.to);
  };

  const cid = str(doc, "id");
  const cname = str(doc, "name");
  const code = str(doc, "code") || "—";
  const pot = stageOf(doc) === "POTENTIAL";
  const active = isActive(doc);
  const cr = creditOf(doc);
  const outSen = num(doc, "outstandingSen", "outstanding_sen");
  const limitSen = num(doc, "creditLimitSen", "credit_limit_sen");
  const hubs = hubsOf(doc);
  const priceList = prices.data?.success ? priceRows(prices.data.data ?? []) : null;
  const priceFailed = !priceList && !!prices.error && !prices.data;

  const spId = str(doc, "salespersonUserId", "salesperson_user_id");
  const spUser = (users.data?.data ?? []).find((u) => u.id && String(u.id) === spId);
  const salesperson = spUser ? String(spUser.displayName || "").trim() || String(spUser.email || "").trim() : "";

  const mine = (r: RawRow) => str(r, "customerId") === cid || str(r, "customerName") === cname;
  const orders: Doc[] = (so.data?.data ?? []).filter(mine).slice(0, 20).map((s) => {
    const st = str(s, "status");
    const rid = str(s, "id", "companySO");
    return {
      id: rid, code: str(s, "companySO", "companySOId") || "—", status: titleCase(st), tone: soTone(st),
      sub: `Ordered ${shortDate(dateOnly(s, "companySODate")) || "—"}`, amount: money(num(s, "totalSen")),
      href: `/m/sales/${encodeURIComponent(rid)}`,
    };
  });
  const invoices: Doc[] = (inv.data?.data ?? []).filter(mine).slice(0, 20).map((i) => {
    const st = str(i, "status");
    const rid = str(i, "id", "invoiceNo");
    return {
      id: rid, code: str(i, "invoiceNo") || "—", status: titleCase(st), tone: invTone(st),
      sub: `Due ${shortDate(dateOnly(i, "dueDate")) || "—"}`, amount: money(num(i, "totalSen")),
      href: `/m/invoices/${encodeURIComponent(rid)}`,
    };
  });
  const docs = docTab === "orders" ? orders : invoices;

  const phone = str(doc, "phone");
  const email = str(doc, "email");
  const contacts = [
    { k: "PIC", icon: User, v: str(doc, "contactName"), action: "", href: "" },
    { k: "PIC Contact", icon: Phone, v: phone, action: phone ? "Call" : "", href: phone ? `tel:${phone.replace(/\s+/g, "")}` : "" },
    { k: "Email", icon: Mail, v: email, action: email ? "Email" : "", href: email ? `mailto:${email}` : "" },
  ].filter((c) => c.v);

  const creditRows = [
    { k: "Credit limit", v: cr.has ? money(limitSen) : "No credit limit", fg: M.raisin },
    { k: cr.over ? "Over limit by" : "Available", v: cr.has ? money(Math.abs(cr.availSen)) : "—", fg: cr.has ? (cr.over ? "var(--m-inv-danger)" : "var(--m-inv-success)") : M.ink },
    { k: "Credit terms", v: termsLabel(str(doc, "creditTerms", "credit_terms")) || "—", fg: M.raisin },
  ];

  const infoRows: [string, string][] = [
    ["Customer code", code],
    ["SSM No", str(doc, "ssmNo") || "—"],
    ["Salesperson", salesperson || "—"],
    ["Billing address", str(doc, "companyAddress") || "—"],
  ];

  return (
    <>
      {header(code, hasMenu)}
      <DetailColumn>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)" }}>
          <section aria-label="Customer header" style={{ padding: "0 2px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Pill tone={active ? "success" : "neutral"} dot label={active ? "Active" : "Inactive"} size="lg" />
              {pot ? <span style={{ height: 26, display: "inline-flex", alignItems: "center", padding: "0 11px", borderRadius: 999, background: "var(--m-inv-gold-box)", color: M.taupe, fontSize: 12.5, fontWeight: 700 }}>Potential</span> : null}
            </div>
            <h1 style={{ margin: "10px 0 0", fontSize: 21, lineHeight: 1.3, fontWeight: 700, letterSpacing: "-0.3px", color: M.raisin, overflowWrap: "anywhere" }}>{cname || "—"}</h1>
            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "2px 6px", marginTop: 4, fontSize: 13, color: M.ink }}>
              {stateText(doc) ? (
                <>
                  <MapPin size={13} strokeWidth={1.9} color={ICON_COLOR} aria-hidden />
                  {stateText(doc)}
                  <span aria-hidden>·</span>
                </>
              ) : null}
              <BadgeCheck size={13} strokeWidth={1.9} color={ICON_COLOR} aria-hidden />
              {salesperson || "No salesperson"}
            </div>
          </section>

          <section aria-label="Credit overview" style={{ marginTop: 16, background: M.card, borderRadius: 20, padding: "18px 18px 16px", boxShadow: SHADOW }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe }}>
              <span aria-hidden style={{ width: 14, height: 3, borderRadius: 2, background: M.gold }} />
              OUTSTANDING
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginTop: 6 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: M.ink }}>RM</span>
              <span style={{ fontSize: 30, lineHeight: 1.1, fontWeight: 700, letterSpacing: "-0.6px", color: cr.pct > 80 ? "var(--m-inv-danger)" : M.raisin, fontVariantNumeric: "tabular-nums", minWidth: 0, overflowWrap: "anywhere" }}>
                {stripRM(money(outSen))}
              </span>
            </div>
            {cr.has ? (
              <>
                <div aria-hidden style={{ marginTop: 12, height: 8, borderRadius: 999, background: "var(--m-inv-line)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.min(cr.pct, 100).toFixed(0)}%`, borderRadius: 999, background: TONE_COLOR[cr.tone] }} />
                </div>
                <div style={{ fontSize: 12, color: M.ink, marginTop: 6 }}>
                  {cr.over ? `Over credit limit by ${money(Math.abs(cr.availSen))}` : `${cr.pct.toFixed(0)}% of credit limit used`}
                </div>
              </>
            ) : null}
            {/* Stacked full-width rows: label left, value right, never truncated. */}
            <div style={{ marginTop: 14, borderRadius: 14, background: M.paper, padding: "2px 13px" }}>
              {creditRows.map((r, i) => (
                <div key={r.k} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 44, borderTop: i ? DIV : "none" }}>
                  <span style={{ flex: "none", fontSize: 12.5, color: M.ink }}>{r.k}</span>
                  <span style={{ minWidth: 0, textAlign: "right", fontSize: 14, fontWeight: 700, color: r.fg, fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" }}>{r.v}</span>
                </div>
              ))}
            </div>
          </section>

          {contacts.length ? (
            <section aria-label="Contact" style={{ marginTop: 12, background: M.card, borderRadius: 20, padding: "6px 15px", boxShadow: SHADOW }}>
              {contacts.map((c, i) => {
                const inner = (
                  <>
                    <span style={{ width: 34, height: 34, flex: "none", borderRadius: "50%", background: "var(--m-inv-gold-box)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <c.icon size={16} strokeWidth={1.9} color={M.taupe} aria-hidden />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 11.5, color: M.ink }}>{c.k}</span>
                      <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: M.raisin, marginTop: 1, lineHeight: 1.35, overflowWrap: "anywhere" }}>{c.v}</span>
                    </span>
                    {c.action ? <span style={{ flex: "none", fontSize: 12.5, fontWeight: 700, color: M.taupe }}>{c.action}</span> : null}
                  </>
                );
                const base = { display: "flex", alignItems: "center", gap: 12, minHeight: 54, padding: "6px 0", borderTop: i ? DIV : "none", textDecoration: "none", color: "inherit" } as const;
                return c.href ? (
                  <a key={c.k} href={c.href} style={base}>{inner}</a>
                ) : (
                  <div key={c.k} style={base}>{inner}</div>
                );
              })}
            </section>
          ) : null}

          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "26px 2px 10px" }}>
            <Warehouse size={16} strokeWidth={1.9} color={M.taupe} aria-hidden />
            <span style={{ fontSize: 16, fontWeight: 700, color: M.raisin }}>Delivery hubs</span>
            <span style={{ fontSize: 12.5, color: M.ink }}>{hubs.length ? hubs.length : ""}</span>
          </div>
          {hubs.length === 0 ? (
            <div style={{ background: M.card, borderRadius: 16, padding: 18, textAlign: "center", fontSize: 13, color: M.ink, boxShadow: SHADOW }}>No delivery hubs yet.</div>
          ) : (
            <div style={{ background: M.card, borderRadius: 18, boxShadow: SHADOW, overflow: "hidden" }}>
              {hubs.map((h, i) => {
                const sub = [str(h, "state"), str(h, "contactName"), str(h, "phone")].filter(Boolean).join(" · ");
                const addr = str(h, "address");
                return (
                  <div
                    key={str(h, "id") || i}
                    // Editable only with customers:update; read-only users just see the hub.
                    {...(canEditHubs
                      ? {
                          role: "button",
                          tabIndex: 0,
                          onClick: () => setFormSpec(hubFormSpec(doc, cid, h)),
                          onKeyDown: (e: React.KeyboardEvent) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setFormSpec(hubFormSpec(doc, cid, h));
                            }
                          },
                        }
                      : {})}
                    style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 60, padding: "10px 15px", borderTop: i ? DIV : "none", cursor: canEditHubs ? "pointer" : "default" }}
                  >
                    <span style={{ width: 34, height: 34, flex: "none", borderRadius: 10, background: "var(--m-inv-info-bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <MapPin size={16} strokeWidth={1.9} color="var(--m-inv-info)" aria-hidden />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: M.raisin, overflowWrap: "anywhere" }}>{str(h, "shortName") || str(h, "code") || "Hub"}</div>
                      {sub ? <div style={{ fontSize: 12.5, color: M.ink, marginTop: 2, lineHeight: 1.4, overflowWrap: "anywhere" }}>{sub}</div> : null}
                      {addr ? <div style={{ fontSize: 12.5, color: M.ink, marginTop: 2, lineHeight: 1.4, overflowWrap: "anywhere" }}>{addr}</div> : null}
                    </div>
                    <span style={{ flex: "none", fontSize: 12, fontWeight: 700, color: M.taupe, fontVariantNumeric: "tabular-nums" }}>{str(h, "code")}</span>
                  </div>
                );
              })}
            </div>
          )}

          <section aria-label="Documents" style={{ marginTop: 26, background: M.card, borderRadius: 18, boxShadow: SHADOW, overflow: "hidden" }}>
            <div style={{ padding: "12px 12px 4px" }}>
              <div role="group" aria-label="Documents" style={segmentTrack(2)}>
                {([["orders", "Recent orders", orders.length], ["invoices", "Invoices", invoices.length]] as const).map(([k, label, n]) => (
                  <button key={k} type="button" aria-pressed={docTab === k} onClick={() => setDocTab(k)} style={segmentButton(docTab === k)}>
                    {label}
                    <span style={CHIP_COUNT}>{n}</span>
                  </button>
                ))}
              </div>
            </div>
            {docs.length === 0 ? (
              <div style={{ padding: "14px 15px 16px", fontSize: 12.5, color: M.ink }}>
                {docTab === "orders" ? "No sales orders for this customer." : "No invoices for this customer."}
              </div>
            ) : (
              docs.map((d, i) => (
                <div
                  key={d.id || i}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(d.href)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      navigate(d.href);
                    }
                  }}
                  style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 56, padding: "8px 15px", borderTop: DIV, cursor: "pointer" }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "4px 8px" }}>
                      <span style={{ fontSize: 13.5, fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" }}>{d.code}</span>
                      <Pill tone={d.tone} label={d.status} />
                    </div>
                    <div style={{ fontSize: 12, color: M.ink, marginTop: 3 }}>{d.sub}</div>
                  </div>
                  <span style={{ flex: "none", fontSize: 13.5, fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums" }}>{d.amount}</span>
                  <ChevronRight size={17} strokeWidth={1.9} color={ICON_COLOR} aria-hidden style={{ flex: "none" }} />
                </div>
              ))
            )}
          </section>

          <section aria-label="Customer pricing" style={{ marginTop: 12, background: M.card, borderRadius: 18, boxShadow: SHADOW, overflow: "hidden" }}>
            <button
              type="button"
              onClick={() => setPricingOpen((o) => !o)}
              aria-expanded={pricingOpen}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, minHeight: 56, padding: "0 15px", background: "none", border: "none", fontFamily: "inherit", cursor: "pointer", textAlign: "left" }}
            >
              <Tags size={16} strokeWidth={1.9} color={M.taupe} aria-hidden />
              <span style={{ flex: 1, fontSize: 16, fontWeight: 700, color: M.raisin }}>Customer pricing</span>
              <span style={{ fontSize: 12.5, color: M.ink }}>{priceList ? `${priceList.length} SKU${priceList.length === 1 ? "" : "s"}` : ""}</span>
              <span style={{ display: "flex", transform: pricingOpen ? "rotate(180deg)" : "none", transition: "transform .18s ease", color: ICON_COLOR }}>
                <ChevronDown size={18} strokeWidth={1.9} aria-hidden />
              </span>
            </button>
            {pricingOpen ? (
              <div style={{ padding: "0 15px 12px" }}>
                <div style={{ fontSize: 12, lineHeight: 1.45, color: M.ink, marginBottom: 6 }}>SKUs assigned to this customer with their customer-specific prices.</div>
                {prices.loading && !prices.data ? (
                  <div aria-busy="true" aria-label="Loading pricing">
                    {[0, 1, 2].map((i) => (
                      <div key={i} style={{ height: 52, borderTop: DIV, display: "flex", alignItems: "center" }}>
                        <div style={{ height: 14, width: "60%", borderRadius: 6, background: "var(--m-inv-line)", opacity: 0.7 }} />
                      </div>
                    ))}
                  </div>
                ) : priceFailed ? (
                  <div role="alert" style={{ borderTop: DIV, padding: "14px 0 4px", fontSize: 13, color: M.ink }}>
                    {prices.failure?.status === 403 ? "You don’t have access to customer pricing." : "Couldn’t load pricing. Check your connection and try again."}
                    {prices.failure?.status === 403 ? null : (
                      <button type="button" onClick={() => prices.refresh()} style={{ display: "block", marginTop: 8, height: 36, padding: "0 14px", borderRadius: 10, border: "none", background: M.paper, color: M.taupe, fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                        Retry
                      </button>
                    )}
                  </div>
                ) : priceList && priceList.length === 0 ? (
                  <div style={{ borderTop: DIV, padding: "14px 0 4px", fontSize: 12.5, color: M.ink }}>No SKUs assigned to this customer.</div>
                ) : (
                  <>
                    {(priceList ?? []).slice(0, priceVisible).map((p) => {
                      const sofa = p.kind === "SOFA";
                      const open = !!openSofa[p.id];
                      const head = (
                        <>
                          <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                            <div style={{ fontSize: 13.5, fontWeight: 700, color: M.raisin, lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere" }}>{p.name || p.code || "—"}</div>
                            <div style={{ fontSize: 12, color: M.taupe, fontWeight: 600, marginTop: 2, overflowWrap: "anywhere" }}>
                              {p.code} <span style={{ color: M.ink, fontWeight: 400 }}>· {titleCase(p.category || "other")}</span>
                            </div>
                          </div>
                          {sofa ? (
                            <span style={{ flex: "none", display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: M.ink }}>
                              {p.tiers.length ? p.tiers.map((t) => t.label).join(" ") : "—"}
                              <span style={{ display: "flex", transform: open ? "rotate(180deg)" : "none", transition: "transform .18s ease", color: ICON_COLOR }}>
                                <ChevronDown size={16} strokeWidth={1.9} aria-hidden />
                              </span>
                            </span>
                          ) : (
                            <div style={{ flex: "none", textAlign: "right" }}>
                              {p.lines.map((l) => (
                                <div key={l.label} style={{ marginTop: 2 }}>
                                  <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, color: M.taupe }}>{l.label.toUpperCase()} </span>
                                  <span style={{ fontSize: 13.5, fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums" }}>{l.sen == null ? "—" : money(l.sen)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      );
                      return (
                        <div key={p.id} style={{ borderTop: DIV }}>
                          {sofa ? (
                            <button
                              type="button"
                              aria-expanded={open}
                              onClick={() => setOpenSofa((s) => ({ ...s, [p.id]: !s[p.id] }))}
                              style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, minHeight: 52, padding: "6px 0", background: "none", border: "none", fontFamily: "inherit", cursor: "pointer" }}
                            >
                              {head}
                            </button>
                          ) : (
                            <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 52, padding: "6px 0" }}>{head}</div>
                          )}
                          {sofa && open ? (
                            <div style={{ paddingBottom: 10 }}>
                              {p.tiers.length === 0 ? (
                                <div style={{ fontSize: 12.5, color: M.ink }}>No seat-height prices set.</div>
                              ) : (
                                p.tiers.map((t) => (
                                  <div key={t.key} style={{ marginTop: 6, borderRadius: 12, background: M.paper, padding: "8px 10px" }}>
                                    <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, color: M.taupe }}>{t.label}</div>
                                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "4px 14px", marginTop: 4 }}>
                                      {t.cells.map((c) => (
                                        <div key={c.height} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, color: M.ink }}>
                                          <span>{sofaSeatLabel(c.height)}</span>
                                          <span style={{ fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums" }}>{money(c.sen)}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                    {priceList && priceList.length > priceVisible ? (
                      <button
                        type="button"
                        onClick={() => setPriceVisible((v) => v + PRICE_PAGE)}
                        style={{ marginTop: 8, width: "100%", height: 40, borderRadius: 12, border: "none", background: M.paper, color: M.taupe, fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                      >
                        Show more ({priceList.length - priceVisible} more)
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
          </section>

          <section aria-label="Company details" style={{ marginTop: 12, background: M.card, borderRadius: 18, boxShadow: SHADOW, overflow: "hidden" }}>
            <button
              type="button"
              onClick={() => setInfoOpen((o) => !o)}
              aria-expanded={infoOpen}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, minHeight: 56, padding: "0 15px", background: "none", border: "none", fontFamily: "inherit", cursor: "pointer", textAlign: "left" }}
            >
              <Building2 size={16} strokeWidth={1.9} color={M.taupe} aria-hidden />
              <span style={{ flex: 1, fontSize: 16, fontWeight: 700, color: M.raisin }}>Company details</span>
              <span style={{ display: "flex", transform: infoOpen ? "rotate(180deg)" : "none", transition: "transform .18s ease", color: ICON_COLOR }}>
                <ChevronDown size={18} strokeWidth={1.9} aria-hidden />
              </span>
            </button>
            {infoOpen ? (
              <div style={{ padding: "0 15px 10px" }}>
                {infoRows.map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, padding: "11px 0", borderTop: DIV }}>
                    <span style={{ flex: "none", fontSize: 12.5, color: M.ink }}>{k}</span>
                    <span style={{ minWidth: 0, fontSize: 13, fontWeight: 600, color: M.raisin, textAlign: "right", lineHeight: 1.45, overflowWrap: "anywhere" }}>{v}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        </div>
      </DetailColumn>

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More actions">
        <MenuGroup>
          {editSpec ? (
            <MenuRow
              icon={Pencil}
              label="Edit customer"
              first
              onClick={() => {
                setMoreOpen(false);
                setFormSpec(editSpec);
              }}
            />
          ) : null}
          {extra.map((a, i) => (
            <MenuRow key={a.label} icon={ACTION_ICONS[a.icon ?? "file-text"] ?? FileText} label={a.label} first={!editSpec && i === 0} onClick={() => runExtra(a)} />
          ))}
        </MenuGroup>
        <div style={{ height: 16 }} />
      </Sheet>

      <FormSheet
        open={formSpec != null}
        onClose={() => setFormSpec(null)}
        spec={formSpec}
        onSaved={(to) => {
          setFormSpec(null);
          resp.refresh();
          if (to) navigate(to);
        }}
      />
    </>
  );
}

function Pill({ tone, label, dot, size }: { tone: DocTone; label: string; dot?: boolean; size?: "lg" }) {
  const lg = size === "lg";
  return (
    <span style={{ height: lg ? 26 : 22, display: "inline-flex", alignItems: "center", gap: lg ? 6 : 5, padding: lg ? "0 11px" : "0 9px", borderRadius: 999, whiteSpace: "nowrap", background: `var(--m-inv-${tone}-bg)`, color: `var(--m-inv-${tone}-fg)`, fontSize: lg ? 12.5 : 11, fontWeight: 700 }}>
      {dot ? <span aria-hidden style={{ width: lg ? 7 : 6, height: lg ? 7 : 6, borderRadius: "50%", background: `var(--m-inv-${tone})` }} /> : null}
      {label}
    </span>
  );
}
