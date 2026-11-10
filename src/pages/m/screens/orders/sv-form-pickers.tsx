// Pickers for the SV service-order form: customer, delivery hub, product, fabric (bottom sheets, the prototype's
// option lists) and the full-screen SOURCE picker (copy from a sales order / consignment order / service case).
// Every list is real data: /api/customers, /api/products, /api/fabric-tracking, /api/sales-orders (isServiceOrder
// = false, the default), /api/consignment-orders, /api/service-cases — no free-text codes.
import { useMemo, useState, type ReactNode } from "react";
import { Check, ChevronRight } from "lucide-react";
import { useCachedJson, cachedFetchJson } from "@/lib/cached-fetch";
import type { Customer } from "@/types";
import { Sheet } from "../../components";
import { M } from "../../theme";
import { Overlay } from "../cases/case-overlay";
import { Btn, Card, SearchField, Stepper } from "../cases/case-ui";
import { CC, SH_CARD } from "../cases/case-style";

type Row = Record<string, unknown>;
const str = (v: unknown): string => (v == null ? "" : String(v).trim());

// ---- generic option row ----------------------------------------------------------------------------------
function OptionRow({ title, sub, on, onClick, last }: { title: string; sub?: string; on?: boolean; onClick: () => void; last?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={!!on} style={{ width: "100%", minHeight: 54, display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", border: "none", borderBottom: last ? "none" : `1px solid ${CC.sep}`, background: "none", fontFamily: "inherit", textAlign: "left", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 14, fontWeight: on ? 700 : 500, color: M.raisin, overflowWrap: "anywhere" }}>{title}</span>
        {sub ? <span style={{ display: "block", fontSize: 12, color: M.ink, marginTop: 1, overflowWrap: "anywhere" }}>{sub}</span> : null}
      </span>
      {on ? <Check size={18} strokeWidth={2.4} color={CC.brown} aria-hidden /> : null}
    </button>
  );
}
/** products.defaultVariants.seatHeight (desktop selectProduct `def.seatHeight`); the API may return an object or its JSON text. */
function defaultSeatOf(v: unknown): string {
  let o: unknown = v;
  if (typeof v === "string") { try { o = JSON.parse(v); } catch { o = null; } }
  return o && typeof o === "object" ? str((o as Row).seatHeight) : "";
}
const hint = (t: string, role?: "status") => <div role={role} style={{ padding: "18px 12px", textAlign: "center", fontSize: 13, color: M.ink }}>{t}</div>;
const listCard = (children: ReactNode, n = 1): ReactNode => n === 0 ? null : <div style={{ marginTop: 6, marginBottom: 12, background: M.card, borderRadius: 16, boxShadow: SH_CARD, overflow: "hidden" }}>{children}</div>;
const sheetSub = (t: string) => <div style={{ fontSize: 12, color: M.ink, marginTop: -8, marginBottom: 10 }}>{t}</div>;

// ---- customer --------------------------------------------------------------------------------------------------
export type PickedCustomer = { id: string; name: string; defaultCompany: string; hubs: { id: string; shortName: string; state?: string }[] };

export function CustomerPickerSheet({ open, onClose, currentId, onPick }: { open: boolean; onClose: () => void; currentId: string; onPick: (c: PickedCustomer) => void }) {
  const { data, loading } = useCachedJson<{ data?: Customer[] }>(open ? "/api/customers" : null, 300);
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    // A prospect cannot be billed — the server refuses it — so it is not offered (same as desktop).
    const all = (data?.data ?? []).filter((c) => (c.customerStage ?? "CONFIRMED") !== "POTENTIAL");
    const t = q.trim().toLowerCase();
    return (t ? all.filter((c) => `${c.code ?? ""} ${c.name ?? ""}`.toLowerCase().includes(t)) : all).slice(0, 40);
  }, [data, q]);
  return (
    <Sheet open={open} onClose={onClose} title="Customer">
      {sheetSub("Master customer records")}
      <div style={{ display: "flex" }}><SearchField value={q} onChange={setQ} placeholder="Search customer code or name" label="Search customers" /></div>
      {loading && !data ? hint("Loading customers…", "status") : null}
      {data && shown.length === 0 ? hint("No customer matches.", "status") : null}
      {listCard(<>
        {shown.map((c, i) => (
          <OptionRow key={c.id} title={c.name || c.code || c.id} sub={c.code || undefined} on={c.id === currentId} last={i === shown.length - 1}
            onClick={() => { onPick({ id: c.id, name: c.name || c.code || c.id, defaultCompany: String(c.defaultCompanyCode ?? ""), hubs: (c.deliveryHubs ?? []).map((h) => ({ id: h.id, shortName: h.shortName, state: h.state ?? undefined })) }); onClose(); setQ(""); }} />
        ))}
      </>, shown.length)}
    </Sheet>
  );
}

// ---- hub -----------------------------------------------------------------------------------------------------------
export function HubPickerSheet({ open, onClose, customerId, customerName, currentId, onPick }: { open: boolean; onClose: () => void; customerId: string; customerName?: string; currentId: string; onPick: (h: { id: string; name: string }) => void }) {
  const { data, loading } = useCachedJson<{ data?: Customer }>(open && customerId ? `/api/customers/${encodeURIComponent(customerId)}` : null);
  const hubs = data?.data?.deliveryHubs ?? [];
  return (
    <Sheet open={open} onClose={onClose} title="Delivery hub">
      {customerName ? sheetSub(customerName) : null}
      {loading && !data ? hint("Loading hubs…", "status") : null}
      {data && hubs.length === 0 ? hint("This customer has no delivery hubs.", "status") : null}
      {listCard(<>
        {hubs.map((h, i) => (
          <OptionRow key={h.id} title={h.shortName} sub={h.state || undefined} on={h.id === currentId} last={i === hubs.length - 1} onClick={() => { onPick({ id: h.id, name: h.shortName }); onClose(); }} />
        ))}
      </>, hubs.length)}
    </Sheet>
  );
}

// ---- product --------------------------------------------------------------------------------------------------------
export type PickedProduct = { id: string; code: string; name: string; category: string; baseModel: string; sizeCode: string; sizeLabel: string; defaultSeat: string };

export function ProductPickerSheet({ open, onClose, currentCode, onPick }: { open: boolean; onClose: () => void; currentCode: string; onPick: (p: PickedProduct) => void }) {
  const { data, loading } = useCachedJson<{ data?: Row[] }>(open ? "/api/products" : null, 300);
  const [q, setQ] = useState("");
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return (data?.data ?? []).filter((p) => `${str(p.code)} ${str(p.name)} ${str(p.baseModel)}`.toLowerCase().includes(t)).slice(0, 30);
  }, [q, data]);
  return (
    <Sheet open={open} onClose={onClose} title="Product">
      {sheetSub("Products with a category and model")}
      <div style={{ display: "flex" }}><SearchField value={q} onChange={setQ} placeholder="Search product code or name" label="Search products" /></div>
      {loading && !data ? hint("Loading products…", "status") : null}
      {!q.trim() && data ? hint("Type a code, name or model to search.") : null}
      {q.trim() && data && hits.length === 0 ? hint("No catalogue products match.", "status") : null}
      {listCard(<>
        {hits.map((p, i) => (
          <OptionRow key={str(p.id)} title={str(p.name) || str(p.code)} sub={[str(p.code), str(p.category).charAt(0).toUpperCase() + str(p.category).slice(1).toLowerCase(), str(p.sizeLabel)].filter(Boolean).join(" · ")} on={str(p.code) === currentCode} last={i === hits.length - 1}
            onClick={() => { onPick({ id: str(p.id), code: str(p.code), name: str(p.name), category: str(p.category), baseModel: str(p.baseModel), sizeCode: str(p.sizeCode), sizeLabel: str(p.sizeLabel), defaultSeat: defaultSeatOf(p.defaultVariants) }); onClose(); setQ(""); }} />
        ))}
      </>, hits.length)}
    </Sheet>
  );
}

// ---- fabric -----------------------------------------------------------------------------------------------------------
export function FabricPickerSheet({ open, onClose, currentCode, onPick }: { open: boolean; onClose: () => void; currentCode: string; onPick: (code: string) => void }) {
  // The fabric source of truth is raw_materials via /api/fabric-tracking (desktop create.tsx ~245).
  const { data, loading } = useCachedJson<{ data?: { id: string; fabricCode: string; fabricDescription?: string }[] }>(open ? "/api/fabric-tracking" : null, 300);
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const seen = new Set<string>();
    const all = (data?.data ?? []).filter((f) => f.fabricCode && !seen.has(f.fabricCode) && (seen.add(f.fabricCode), true));
    const t = q.trim().toLowerCase();
    return (t ? all.filter((f) => `${f.fabricCode} ${f.fabricDescription ?? ""}`.toLowerCase().includes(t)) : all).slice(0, 40);
  }, [data, q]);
  return (
    <Sheet open={open} onClose={onClose} title="Fabric">
      <div style={{ display: "flex" }}><SearchField value={q} onChange={setQ} placeholder="Search fabric code or name" label="Search fabrics" /></div>
      {loading && !data ? hint("Loading fabrics…", "status") : null}
      {data && shown.length === 0 ? hint("No fabric matches.", "status") : null}
      {listCard(<>
        {shown.map((f, i) => (
          <OptionRow key={f.id || f.fabricCode} title={f.fabricCode} sub={f.fabricDescription || undefined} on={f.fabricCode === currentCode} last={i === shown.length - 1} onClick={() => { onPick(f.fabricCode); onClose(); setQ(""); }} />
        ))}
      </>, shown.length)}
    </Sheet>
  );
}

// ---- source picker (full screen) ------------------------------------------------------------------------------------
export type SourceChoice =
  | { kind: "copy"; type: "SO" | "CO"; sourceId: string; sourceNo: string; lineItems: { id: string; qty: number }[] }
  | { kind: "case"; caseId: string };

type SourceLine = { id: string; productCode: string; productName: string; sizeLabel: string; fabricCode: string; quantity: number };

export function SourcePickerScreen({ pick, onCancel, onChoose }: { pick: "so" | "co" | "case"; onCancel: () => void; onChoose: (c: SourceChoice) => void }) {
  const url = pick === "so" ? "/api/sales-orders" : pick === "co" ? "/api/consignment-orders" : "/api/service-cases";
  const { data, loading, error } = useCachedJson<{ data?: Row[] }>(url, 60);
  const [q, setQ] = useState("");
  const [chosen, setChosen] = useState<{ id: string; no: string } | null>(null);
  const [lines, setLines] = useState<SourceLine[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [qty, setQty] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const label = pick === "so" ? "sales order" : pick === "co" ? "consignment order" : "service case";
  const rows = useMemo(() => {
    let all = data?.data ?? [];
    // A case can only hand off when it points at an order to copy, and is still being worked.
    if (pick === "case") all = all.filter((r) => (str(r.sourceType) === "SO" || str(r.sourceType) === "CO") && (str(r.status) === "OPEN" || str(r.status) === "IN_PROGRESS"));
    const t = q.trim().toLowerCase();
    if (t) all = all.filter((r) => [r.companySOId, r.companyCOId, r.caseNo, r.customerName, r.customerPOId, r.customerSOId, r.reference, r.sourceNo].map(str).join(" ").toLowerCase().includes(t));
    return all.slice(0, 40);
  }, [data, q, pick]);

  const titleOf = (r: Row) => str(r.companySOId) || str(r.companyCOId) || str(r.caseNo) || str(r.id);
  const subOf = (r: Row) => [str(r.customerName), pick === "case" ? str(r.sourceNo) || `${str(r.sourceType)} source` : str(r.status).replace(/_/g, " ").toLowerCase()].filter(Boolean).join(" · ");

  const open = async (r: Row) => {
    if (pick === "case") { onChoose({ kind: "case", caseId: str(r.id) }); return; }
    setBusy(true); setErr("");
    const detail = await cachedFetchJson<{ data?: Row }>(`${pick === "so" ? "/api/sales-orders" : "/api/consignment-orders"}/${encodeURIComponent(str(r.id))}`, 0).catch(() => null);
    setBusy(false);
    const items = (detail?.data?.items as Row[] | undefined) ?? [];
    if (!detail?.data) { setErr(`Couldn’t load that ${label}.`); return; }
    if (items.length === 0) { setErr(`That ${label} has no lines to copy.`); return; }
    const ls: SourceLine[] = items.map((it) => ({ id: str(it.id), productCode: str(it.productCode), productName: str(it.productName), sizeLabel: str(it.sizeLabel), fabricCode: str(it.fabricCode), quantity: Math.max(1, Math.floor(Number(it.quantity)) || 1) }));
    setChosen({ id: str(r.id), no: titleOf(r) });
    setLines(ls);
    setChecked(new Set(ls.map((l) => l.id)));
    setQty(Object.fromEntries(ls.map((l) => [l.id, l.quantity])));
  };

  const use = () => {
    if (!chosen || !lines) return;
    const lineItems = lines.filter((l) => checked.has(l.id)).map((l) => ({ id: l.id, qty: Math.max(1, Math.min(l.quantity, qty[l.id] ?? l.quantity)) }));
    if (lineItems.length === 0) { setErr("Pick at least one line to copy."); return; }
    onChoose({ kind: "copy", type: pick === "so" ? "SO" : "CO", sourceId: chosen.id, sourceNo: chosen.no, lineItems });
  };

  // Step 2: lines + quantities.
  if (chosen && lines) {
    const all = checked.size === lines.length;
    return (
      <Overlay title={`Lines from ${chosen.no}`} subtitle="Choose the lines and quantities to copy" onClose={() => { setChosen(null); setLines(null); setErr(""); }} closeLabel="Back"
        footer={(
          <div>
            {err ? <div role="alert" style={{ fontSize: 12.5, color: CC.danger, marginBottom: 8 }}>{err}</div> : null}
            <Btn full onClick={use} disabled={checked.size === 0}>{`Copy ${checked.size} line${checked.size === 1 ? "" : "s"}`}</Btn>
          </div>
        )}>
        <button type="button" onClick={() => setChecked(all ? new Set() : new Set(lines.map((l) => l.id)))} style={{ justifySelf: "start", height: 36, padding: "0 12px", border: "none", borderRadius: 999, background: CC.tile, color: CC.brown, fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>{all ? "Clear all" : "Select all"}</button>
        {lines.map((l) => {
          const on = checked.has(l.id);
          const q2 = qty[l.id] ?? l.quantity;
          return (
            <Card key={l.id}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button type="button" role="checkbox" aria-checked={on} aria-label={`Copy ${l.productName || l.productCode}`} onClick={() => setChecked((s) => { const n = new Set(s); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })}
                  style={{ width: 44, height: 44, margin: "-8px 0 -8px -8px", flex: "none", border: "none", background: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span aria-hidden style={{ width: 22, height: 22, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", background: on ? CC.brown : M.card, border: on ? "none" : "1.5px solid #C9BFAE" }}>{on ? <Check size={14} strokeWidth={3} color="#fff" /> : null}</span>
                </button>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: M.raisin, overflowWrap: "anywhere" }}>{l.productName || l.productCode}</span>
                  <span style={{ display: "block", fontSize: 12, color: M.ink, marginTop: 2, overflowWrap: "anywhere" }}>{[l.productCode, l.sizeLabel, l.fabricCode].filter(Boolean).join(" · ")}</span>
                </span>
                {on ? <Stepper label={`${l.productCode} quantity (max ${l.quantity})`} value={q2} decDisabled={q2 <= 1} incDisabled={q2 >= l.quantity} onDec={() => setQty((m) => ({ ...m, [l.id]: Math.max(1, q2 - 1) }))} onInc={() => setQty((m) => ({ ...m, [l.id]: Math.min(l.quantity, q2 + 1) }))} /> : null}
              </div>
              {on && l.quantity > 1 ? <div style={{ fontSize: 11.5, color: CC.hint, marginTop: 6, paddingLeft: 36 }}>Up to {l.quantity} on the source order</div> : null}
            </Card>
          );
        })}
      </Overlay>
    );
  }

  // Step 1: choose the source.
  const body: ReactNode = (
    <>
      <div style={{ display: "flex" }}><SearchField value={q} onChange={setQ} placeholder={pick === "case" ? "Search case number or customer" : "Search order number, customer or reference"} label={`Search ${label}s`} /></div>
      {pick === "case" ? <div style={{ fontSize: 12, color: M.ink }}>Only open cases whose source is a sales or consignment order can hand off. The affected products and quantities come from the case.</div> : null}
      {loading && !data ? hint(`Loading ${label}s…`, "status") : null}
      {error && !data ? <div role="alert" style={{ fontSize: 13, color: CC.danger }}>Couldn’t load the list. Try again.</div> : null}
      {data && rows.length === 0 ? hint(`No ${label} matches.`, "status") : null}
      {err ? <div role="alert" style={{ fontSize: 13, color: CC.danger }}>{err}</div> : null}
      {rows.length > 0 ? (
        <div style={{ background: M.card, borderRadius: 16, boxShadow: SH_CARD, overflow: "hidden" }}>
          {rows.map((r, i) => (
            <button key={str(r.id)} type="button" disabled={busy} onClick={() => void open(r)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, minHeight: 54, padding: "9px 14px", border: "none", borderTop: i ? `1px solid ${CC.sep}` : "none", background: "none", fontFamily: "inherit", textAlign: "left", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 14, fontWeight: 500, color: M.raisin, overflowWrap: "anywhere" }}>{titleOf(r)}</span>
                <span style={{ display: "block", fontSize: 12, color: M.ink, marginTop: 2, overflowWrap: "anywhere" }}>{subOf(r)}</span>
              </span>
              <ChevronRight size={17} strokeWidth={2.2} color={CC.brownSoft} aria-hidden />
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
  return (
    <Overlay title={pick === "case" ? "From a service case" : pick === "so" ? "Copy from sales order" : "Copy from consignment order"} subtitle={busy ? "Loading lines…" : "Choose the source"} onClose={onCancel} closeLabel="Close">
      {body}
    </Overlay>
  );
}
