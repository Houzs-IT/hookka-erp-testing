// ===========================================================================
// SupplierDetailScreen — L2 /m/suppliers/:id (Batch 4, Claude Design
// "Suppliers (standalone)", approved). Header card + Info · Pricing · History
// · POs, the More sheet (Edit supplier, Quotation PDF) and the edit form.
// Reads (each only when its tab is open and the user holds its permission):
//   GET /api/suppliers/:id                          header + Info
//   GET /api/organisations                          purchase company name
//   GET /api/supplier-scorecards/:id                Info scorecard + POs tab   (supplier-scorecards:read)
//   GET /api/supplier-materials?supplierId=         Pricing + Quotation PDF    (supplier-materials:read)
//   GET /api/price-history?supplierId=              History → Price changes    (price-history:read)
//   GET /api/purchase-orders                        History → PO lines         (purchase-orders:read)
//       (no supplier filter server-side: filtered here by supplierId, as desktop
//        src/pages/suppliers/detail.tsx does; line total = the item's totalSen)
// Write: PUT /api/suppliers/:id via the form (suppliers:update).
// A restricted surface shows the prototype's restricted card — also on a 403.
// No bank / TIN / SST fields and no SKU price editing (desktop keeps those).
// ===========================================================================
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Building2, CalendarClock, ChartNoAxesColumn, CircleCheck, Clock, CloudOff, Coins, FileBadge, FileText, History, Landmark, Lock, Mail, Mails, MapPin,
  PackageOpen, Pencil, Phone, SearchX, Send, ShoppingBag, TriangleAlert, UserRound,
} from "lucide-react";
import { cachedFetchJson, useCachedJson, type CachedFetchFailure } from "@/lib/cached-fetch";
import { todayYmdMY } from "@/lib/utils";
import { useResponsiveLayout } from "../../lib/responsive-layout";
import {
  BottomSheet, Card, DetailBody, DocCard, InfoSection, MenuList, MoreButton, Note, Pill, ScoreCards, SectionLabel, Seg, SelectRow, Skeleton, SmallSearch,
  StateBlock, Stars, SupFrame, Tabs, TopBar, type MenuItemV, type StateV,
} from "./sup-kit";
import { C } from "./sup-style";
import {
  STATUS, approvalOf, bindingCurrency, changePct, deliveryTag, dl, money, n, poLinesOf, poStatus, price, qty, rowsOf, s, termsLabel, toSupplier, ymd,
  type Row, type Supplier,
} from "./sup-lib";
import { useOrgOptions, useSupPerms, type SupPerms } from "./sup-data";
import { SupplierForm } from "./SupplierForm";
import { useSupToast } from "./sup-toast";

type Tab = "info" | "pricing" | "history" | "pos";
type Hv = "lines" | "changes";

export function SupplierDetailScreen() {
  const { id = "" } = useParams();
  return <SupplierDetail key={id} id={id} />;
}

const RESTRICTED_PRICING: StateV = { icon: Lock, t: "You can't see this", s: "Supplier pricing and history need extra access. Ask an admin.", c: C.neu, bg: C.neub };
const RESTRICTED_SCORE: StateV = { icon: Lock, t: "You can't see this", s: "Supplier scorecards and purchase orders need extra access. Ask an admin.", c: C.neu, bg: C.neub };
const loadError = (what: string, retry: () => void): StateV => ({ icon: CloudOff, t: `Couldn't load ${what}`, s: "Check your connection and try again.", c: C.bad, bg: C.badb, btn: "Try again", onTap: retry, alert: true });
const is403 = (f: CachedFetchFailure | null) => f?.status === 403;

/** A gated read: null url when the user lacks the permission or the tab is closed. */
function useGated<T>(url: string | null) {
  const r = useCachedJson<T>(url);
  // No data and no failure yet = still loading (also covers the first render after the url is set,
  // before the hook flips its own loading flag) — so "Couldn't load" never flashes during a load.
  return { ...r, loading: !!url && r.data == null && !r.failure, failed: !!url && r.data == null && !!r.failure };
}

function SupplierDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const layout = useResponsiveLayout();
  const perms = useSupPerms();
  const orgs = useOrgOptions();
  const toast = useSupToast();
  const enc = encodeURIComponent(id);

  const [tab, setTab] = useState<Tab>("info");
  const [hv, setHv] = useState<Hv>("lines");
  const [pq, setPq] = useState("");
  const [hPo, setHPo] = useState("all");
  const [hMat, setHMat] = useState("all");
  const [more, setMore] = useState(false);
  const [editing, setEditing] = useState(false);

  // A toast handed over by the Add form (the list may have unmounted).
  const handed = (location.state as { supToast?: string } | null)?.supToast;
  const showToast = toast.show;
  useEffect(() => {
    if (handed) {
      showToast(handed);
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [handed, showToast, navigate, location.pathname]);

  const resp = useCachedJson<{ data?: Row }>(id ? `/api/suppliers/${enc}` : null);
  const doc = (resp.data?.data ?? null) as Row | null;
  const sup = useMemo(() => (doc ? toSupplier(doc) : null), [doc]);

  const wantScore = perms.scorecards && !!sup && (tab === "info" || tab === "pos");
  const wantMat = perms.materials && !!sup && (tab === "pricing" || (tab === "history" && hv === "changes"));
  const score = useGated<{ data?: Row }>(wantScore ? `/api/supplier-scorecards/${enc}` : null);
  const mats = useGated<unknown>(wantMat ? `/api/supplier-materials?supplierId=${enc}` : null);
  const hist = useGated<unknown>(perms.priceHistory && sup && tab === "history" && hv === "changes" ? `/api/price-history?supplierId=${enc}` : null);
  const pos = useGated<unknown>(perms.poLines && sup && tab === "history" && hv === "lines" ? "/api/purchase-orders" : null);

  const back = layout.canSplitDetail ? null : () => navigate("/m/suppliers");
  const header = (title: string, withMore: boolean) => (
    <TopBar title={title} numeric onBack={back} backLabel="Back to suppliers" right={withMore ? <MoreButton onTap={() => setMore(true)} /> : null} />
  );

  if (!sup) {
    const notFound = resp.failure?.kind === "notFound";
    const failed = !resp.loading && !!resp.failure;
    return (
      <SupFrame label="Supplier">
        {header("Supplier", false)}
        <DetailBody>
          {!failed ? (
            <Skeleton n={4} h={96} pad="0" />
          ) : notFound ? (
            <StateBlock v={{ icon: SearchX, t: "Supplier not found", s: "It may have been removed, or the link is wrong.", c: C.br, bg: C.tint, btn: "Back to suppliers", onTap: () => navigate("/m/suppliers") }} />
          ) : is403(resp.failure) ? (
            <StateBlock v={{ icon: Lock, t: "You can't see this", s: "Your role doesn't include suppliers. Ask an admin.", c: C.neu, bg: C.neub }} />
          ) : (
            <StateBlock v={loadError("this supplier", () => resp.refresh())} />
          )}
        </DetailBody>
      </SupFrame>
    );
  }

  const orgName = orgs.find((o) => o.code === sup.org)?.name || sup.org;
  const bindings = rowsOf(mats.data);
  const nameByCode = new Map<string, string>();
  for (const b of bindings) { const c = s(b, "materialCode"); if (c && !nameByCode.has(c)) nameByCode.set(c, s(b, "materialName")); }

  const quote = async () => {
    setMore(false);
    const resp2 = await cachedFetchJson<unknown>(`/api/supplier-materials?supplierId=${enc}`);
    if (!resp2 || (resp2 as { success?: boolean }).success === false) {
      toast.show("Couldn't load the price list. Try again.", "error");
      return;
    }
    const list = rowsOf(resp2);
    try {
      const { generateSupplierQuotationPdf } = await import("@/lib/generate-supplier-quotation-pdf");
      generateSupplierQuotationPdf(
        { code: sup.code, name: sup.name, address: sup.address, contactPerson: sup.contact, email: sup.email, phone: sup.phone, purchaseOrgCode: sup.org },
        list.map((b) => ({
          materialCode: s(b, "materialCode"), materialName: s(b, "materialName"), supplierSku: s(b, "supplierSku"), supplierDescription: s(b, "supplierDescription"),
          unitPriceSen: n(b, "unitPrice"), currency: s(b, "currency") || "MYR", leadTimeDays: n(b, "leadTimeDays"), moq: n(b, "moq"),
          effectiveFrom: s(b, "effectiveFrom", "priceValidFrom") || undefined,
        })),
      );
      toast.show("Quotation PDF downloading", "file");
    } catch {
      toast.show("Couldn't make the PDF. Try again.", "error");
    }
  };
  const menu: MenuItemV[] = [
    ...(perms.update ? [{ k: "edit", l: "Edit supplier", icon: Pencil, onTap: () => { setMore(false); setEditing(true); } }] : []),
    ...(perms.materials ? [{ k: "quote", l: "Quotation PDF", icon: FileText, onTap: () => void quote() }] : []),
  ];

  const st = STATUS[sup.status];
  let body: ReactNode;
  if (perms.loading) body = <Skeleton n={2} h={96} pad="0" />;
  else if (tab === "info") body = <InfoTab sup={sup} orgName={orgName} perms={perms} score={score} />;
  else if (tab === "pricing") body = <PricingTab perms={perms} mats={mats} pq={pq} setPq={setPq} />;
  else if (tab === "history") {
    body = <HistoryTab perms={perms} hv={hv} setHv={(v) => { setHv(v); setHMat("all"); }} supplierId={sup.id} pos={pos} hist={hist} nameByCode={nameByCode} matsLoading={mats.loading}
      hPo={hPo} setHPo={setHPo} hMat={hMat} setHMat={setHMat} />;
  } else body = <PosTab perms={perms} score={score} open={(poId) => navigate(`/m/procurement/${encodeURIComponent(poId)}`)} />;

  return (
    <SupFrame label={sup.name || sup.code}>
      <div style={{ animation: layout.canSplitDetail ? undefined : "sup-page .2s ease-out" }}>
        {header(sup.code || "Supplier", !perms.loading && menu.length > 0)}
        <DetailBody>
          <Card label="Supplier header">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Pill st={st} size="lg" />
              <span style={{ flex: 1 }} />
              <Stars rating={sup.rating} />
            </div>
            <h1 style={{ margin: "10px 0 0", fontSize: 21, lineHeight: 1.3, fontWeight: 700, letterSpacing: "-.3px", textWrap: "pretty", overflowWrap: "anywhere" } as CSSProperties}>{sup.name || "—"}</h1>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 14px", marginTop: 4, fontSize: 13, color: C.sub }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, overflowWrap: "anywhere" }}><UserRound size={13} strokeWidth={1.9} color={C.gold} aria-hidden style={{ flex: "none" }} />{sup.contact || "No contact"}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}><CalendarClock size={13} strokeWidth={1.9} color={C.gold} aria-hidden />{termsLabel(sup.terms)}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Building2 size={13} strokeWidth={1.9} color={C.gold} aria-hidden />{sup.org}</span>
            </div>
          </Card>
          <Tabs label="Supplier sections" value={tab} onChange={setTab}
            items={[{ k: "info", l: "Info" }, { k: "pricing", l: "Pricing" }, { k: "history", l: "History" }, { k: "pos", l: "POs" }]} />
          {body}
        </DetailBody>
      </div>

      <BottomSheet open={more} onClose={() => setMore(false)} title={sup.name || sup.code} sub="Supplier actions" label="Supplier actions">
        <MenuList items={menu} />
      </BottomSheet>
      {editing ? (
        <SupplierForm editing={sup} orgs={orgs} onClose={() => setEditing(false)} onSaved={({ message }) => { setEditing(false); toast.show(message); }} />
      ) : null}
      {toast.node}
    </SupFrame>
  );
}

type Gated = ReturnType<typeof useGated<unknown>>;

// ---- Info ------------------------------------------------------------------------------
function InfoTab({ sup, orgName, perms, score }: { sup: Supplier; orgName: string; perms: SupPerms; score: Gated }) {
  const sc = (score.data as { data?: Row } | null)?.data ?? null;
  let scoreBlock: ReactNode;
  if (!perms.scorecards || is403(score.failure)) scoreBlock = <StateBlock v={RESTRICTED_SCORE} />;
  else if (score.loading) scoreBlock = <Skeleton n={1} h={78} pad="0" />;
  else if (score.failed || !sc) scoreBlock = <StateBlock v={loadError("the scorecard", () => score.refresh())} />;
  else {
    const rec = n(sc, "receivedPOs"), cnt = n(sc, "onTimeCount");
    if (rec === 0) {
      scoreBlock = <StateBlock v={{ icon: ChartNoAxesColumn, t: "No scorecard yet", s: "There aren't enough received POs to work out on-time, defect or lead figures.", c: C.br, bg: C.tint }} />;
    } else {
      const otr = n(sc, "onTimeRate"), dfr = n(sc, "defectRate"), lead = n(sc, "averageLeadDays");
      scoreBlock = (
        <>
          <ScoreCards cards={[
            { l: "On-Time Rate", v: otr.toFixed(1), u: "%", icon: CircleCheck, icC: C.ok, c: otr >= 90 ? C.ok : otr >= 75 ? C.warn : C.bad },
            { l: "Defect Rate", v: dfr.toFixed(2), u: "%", icon: TriangleAlert, icC: C.bad, c: dfr <= 1 ? C.ok : dfr <= 3 ? C.warn : C.bad },
            { l: "Average Lead Days", v: lead.toFixed(1), u: "d", icon: Clock, icC: C.info, c: C.info },
          ]} />
          <Note t={`${cnt} of ${rec} received PO${rec === 1 ? "" : "s"} on time.`} />
        </>
      );
    }
  }
  const tel = sup.phone ? `tel:${sup.phone.replace(/[^\d+]/g, "")}` : "";
  const mail = (v: string) => (v ? `mailto:${v}` : "");
  return (
    <>
      {scoreBlock}
      <InfoSection title="Contact" icon={UserRound} rows={[
        { k: "Contact person", v: sup.contact, icon: UserRound },
        { k: "Phone", v: sup.phone, icon: Phone, href: tel, act: Phone, aria: `Call ${sup.phone}` },
        { k: "Email", v: sup.email, icon: Mail, href: mail(sup.email), act: Send, aria: `Email ${sup.email}` },
        { k: "Email 2 · Cc on POs", v: sup.email2, icon: Mails, href: mail(sup.email2), act: Send, aria: `Email ${sup.email2}` },
        { k: "Email 3 · Cc on POs", v: sup.email3, icon: Mails, href: mail(sup.email3), act: Send, aria: `Email ${sup.email3}` },
      ]} />
      <InfoSection title="Purchasing" icon={ShoppingBag} rows={[
        { k: "Payment terms", v: sup.terms ? termsLabel(sup.terms) : "", icon: CalendarClock },
        { k: "Currency", v: sup.currency, icon: Coins },
        { k: "Purchase company", v: orgName, icon: Building2 },
      ]} />
      <InfoSection title="Company" icon={Landmark} rows={[
        { k: "Registration no. (SSM)", v: sup.ssm, icon: FileBadge },
        { k: "Address", v: sup.address, icon: MapPin },
      ]} />
    </>
  );
}

// ---- Pricing ---------------------------------------------------------------------------
function PricingTab({ perms, mats, pq, setPq }: { perms: SupPerms; mats: Gated; pq: string; setPq: (v: string) => void }) {
  if (!perms.materials || is403(mats.failure)) return <StateBlock v={RESTRICTED_PRICING} />;
  if (mats.loading) return <Skeleton n={3} h={120} pad="0" />;
  if (mats.failed) return <StateBlock v={loadError("the price list", () => mats.refresh())} />;
  const all = rowsOf(mats.data);
  const q = pq.trim().toLowerCase();
  const L = all.filter((b) => !q || `${s(b, "materialCode")} ${s(b, "materialName")} ${s(b, "supplierSku")} ${s(b, "supplierDescription")}`.toLowerCase().includes(q));
  const today = todayYmdMY();
  return (
    <>
      <SmallSearch v={pq} on={setPq} ph="Search material or supplier SKU" />
      <SectionLabel pad="4px 4px 0" t={`${L.length} SKU BINDING${L.length === 1 ? "" : "S"}`} r="Read-only" />
      {!all.length ? (
        <StateBlock v={{ icon: PackageOpen, t: "No SKUs bound", s: "No materials are linked to this supplier yet.", c: C.br, bg: C.tint }} />
      ) : !L.length ? (
        <StateBlock v={{ icon: SearchX, t: "No SKUs match", s: "Try another code or name.", c: C.br, bg: C.tint }} />
      ) : null}
      {L.map((b, i) => {
        const main = b.isMainSupplier === true || b.isMainSupplier === 1;
        const eff = ymd(s(b, "effectiveFrom", "priceValidFrom"));
        const scheduled = !!eff && eff > today;
        const cur = bindingCurrency(s(b, "currency"));
        const sub = [s(b, "supplierSku"), s(b, "supplierDescription")].filter(Boolean).join(" · ");
        return (
          <DocCard key={s(b, "id") || i} d={{
            code: s(b, "materialCode") || "—", st: main ? { l: "Main supplier", c: C.br, b: C.prit } : null, date: eff ? `From ${dl(eff)}` : "",
            title: s(b, "materialName") || s(b, "materialCode") || "—", sub,
            tags: [
              { k: "Lead", v: `${n(b, "leadTimeDays")} d`, bg: C.tint, c: C.ink },
              { k: "MOQ", v: qty(n(b, "moq")), bg: C.tint, c: C.ink },
              ...(scheduled ? [{ k: "", v: "Scheduled", bg: C.infob, c: C.info }] : []),
            ],
            amts: [{ k: "Unit price", v: price(n(b, "unitPrice"), cur), bg: C.amt, c: C.ink }],
            rail: main ? "#C9A24B" : "#CDBE98",
          }} />
        );
      })}
    </>
  );
}

// ---- History ---------------------------------------------------------------------------
function HistoryTab({ perms, hv, setHv, supplierId, pos, hist, nameByCode, matsLoading, hPo, setHPo, hMat, setHMat }: {
  perms: SupPerms; hv: Hv; setHv: (v: Hv) => void; supplierId: string; pos: Gated; hist: Gated; nameByCode: Map<string, string>; matsLoading: boolean;
  hPo: string; setHPo: (v: string) => void; hMat: string; setHMat: (v: string) => void;
}) {
  const seg = <Seg label="History view" value={hv} onChange={setHv} items={[{ k: "lines", l: "PO lines" }, { k: "changes", l: "Price changes" }]} />;
  if (hv === "lines") {
    if (!perms.poLines || is403(pos.failure)) return <>{seg}<StateBlock v={RESTRICTED_PRICING} /></>;
    if (pos.loading) return <>{seg}<Skeleton n={3} h={110} pad="0" /></>;
    if (pos.failed) return <>{seg}<StateBlock v={loadError("PO lines", () => pos.refresh())} /></>;
    const lines = poLinesOf(rowsOf(pos.data), supplierId);
    const poNos = [...new Set(lines.map((l) => l.poNo))];
    const mats = [...new Set(lines.map((l) => l.code).filter(Boolean))];
    const L = lines.filter((l) => (hPo === "all" || l.poNo === hPo) && (hMat === "all" || l.code === hMat));
    return (
      <>
        {seg}
        {lines.length ? (
          <SelectRow sels={[
            { v: hPo, on: setHPo, aria: "PO number", opts: [{ v: "all", l: "All POs" }, ...poNos.map((x) => ({ v: x, l: x }))] },
            { v: hMat, on: setHMat, aria: "Material", opts: [{ v: "all", l: "All materials" }, ...mats.map((x) => ({ v: x, l: x }))] },
          ]} />
        ) : null}
        {!L.length ? (
          <StateBlock v={{ icon: History, t: lines.length ? "No lines match" : "No PO lines yet", s: lines.length ? "Try another PO or material." : "Lines show here once POs are raised to this supplier.", c: C.br, bg: C.tint }} />
        ) : null}
        {L.map((l) => (
          <DocCard key={l.key} d={{
            code: l.poNo || "—", date: dl(l.date), title: l.name || l.code || "—", sub: l.name ? l.code : "", rail: "#A08C5B",
            amts: [
              { k: "Qty", v: qty(l.qty), bg: C.bg, c: C.ink },
              { k: "Unit price", v: price(l.unitSen), bg: C.bg, c: C.ink },
              { k: "Line total", v: money(l.totalSen), bg: C.amt, c: C.ink },
            ],
          }} />
        ))}
      </>
    );
  }
  if (!perms.priceHistory || is403(hist.failure)) return <>{seg}<StateBlock v={RESTRICTED_PRICING} /></>;
  if (hist.loading || (matsLoading && perms.materials)) return <>{seg}<Skeleton n={3} h={110} pad="0" /></>;
  if (hist.failed) return <>{seg}<StateBlock v={loadError("price changes", () => hist.refresh())} /></>;
  const changes = [...rowsOf(hist.data)].sort((a, b) =>
    (s(b, "effectiveFrom") || s(b, "changedDate")).localeCompare(s(a, "effectiveFrom") || s(a, "changedDate")) || s(b, "changedDate").localeCompare(s(a, "changedDate")));
  const mats = [...new Set(changes.map((c) => s(c, "materialCode")).filter(Boolean))];
  const L = changes.filter((c) => hMat === "all" || s(c, "materialCode") === hMat);
  return (
    <>
      {seg}
      {changes.length ? (
        <SelectRow sels={[{ v: hMat, on: setHMat, aria: "Material", opts: [{ v: "all", l: "All materials" }, ...mats.map((x) => ({ v: x, l: x }))] }]} />
      ) : null}
      {!L.length ? (
        <StateBlock v={{ icon: History, t: changes.length ? "No changes match" : "No price changes yet", s: changes.length ? "Try another material." : "Price changes to this supplier's SKUs show here.", c: C.br, bg: C.tint }} />
      ) : null}
      {L.map((c, i) => {
        const code = s(c, "materialCode");
        const cur = bindingCurrency(s(c, "currency"));
        const o = n(c, "oldPrice"), nw = n(c, "newPrice");
        const pct = changePct(o, nw);
        const ap = approvalOf(s(c, "approvalStatus"));
        const by = s(c, "changedBy");
        return (
          <DocCard key={s(c, "id") || i} d={{
            code: code || "—", st: ap, date: dl(s(c, "effectiveFrom") || s(c, "changedDate")), title: nameByCode.get(code) || code || "—",
            sub: by ? `Changed by ${by}` : "", rail: ap.c,
            amts: [
              { k: "Old", v: o ? price(o, cur) : "—", bg: C.bg, c: C.mut },
              { k: "New", v: price(nw, cur), bg: C.amt, c: C.ink },
              { k: "Change", v: pct.t, bg: pct.up == null ? C.bg : pct.up ? C.badb : C.okb, c: pct.up == null ? C.mut : pct.up ? C.bad : C.ok },
            ],
          }} />
        );
      })}
    </>
  );
}

// ---- POs ------------------------------------------------------------------------------------
function PosTab({ perms, score, open }: { perms: SupPerms; score: Gated; open: (poId: string) => void }) {
  if (!perms.scorecards || is403(score.failure)) return <StateBlock v={RESTRICTED_SCORE} />;
  if (score.loading) return <Skeleton n={3} h={120} pad="0" />;
  const sc = (score.data as { data?: Row } | null)?.data ?? null;
  if (score.failed || !sc) return <StateBlock v={loadError("purchase orders", () => score.refresh())} />;
  const list = (Array.isArray(sc.last10POs) ? (sc.last10POs as Row[]) : []).slice(0, 10);
  const total = n(sc, "totalPOs");
  return (
    <>
      <SectionLabel pad="4px 4px 0" t="LAST 10 PURCHASE ORDERS" r={`${list.length} of ${Math.max(total, list.length)}`} />
      {!list.length ? <StateBlock v={{ icon: FileText, t: "No purchase orders", s: "POs raised to this supplier show here.", c: C.br, bg: C.tint }} /> : null}
      {list.map((p, i) => {
        const st = poStatus(s(p, "status"));
        const exp = s(p, "expectedDate"), rec = s(p, "receivedDate");
        const tag = deliveryTag(exp, rec);
        const ord = n(p, "orderedQty"), got = n(p, "receivedQty");
        const poId = s(p, "id");
        return (
          <DocCard key={poId || i} d={{
            code: s(p, "poNo") || "—", st, rail: st.c, title: money(n(p, "totalSen")),
            sub: `${exp ? `Expected ${dl(exp)}` : "No expected date"}${rec ? ` · received ${dl(rec)}` : ""}`,
            tags: tag ? [{ k: "", v: tag.l, bg: tag.b, c: tag.c }] : null,
            amts: [
              { k: "Ordered", v: qty(ord), bg: C.bg, c: C.ink },
              { k: "Received", v: qty(got), bg: C.bg, c: got < ord ? C.warn : C.ink },
            ],
            onTap: poId ? () => open(poId) : undefined, aria: `${s(p, "poNo")}, ${st.l}, open purchase order`,
          }} />
        );
      })}
    </>
  );
}
