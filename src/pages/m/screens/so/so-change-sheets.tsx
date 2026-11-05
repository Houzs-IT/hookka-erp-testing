// The sheets behind the Sales Order actions that open a form (desktop: CreateServiceCaseModal with the SO preset,
// CustomerEditModal, HubEditModal). Same requests, bodies, validation and wording as desktop; phone styling from the Delivery
// sheets. No new rules: what the server refuses (a locked order, a customer that is only a prospect, a hub of another customer…)
// comes back as its own error text and is shown inline.
//   Service case  POST  /api/service-cases                 service-cases:create (source SO, preset to this order)
//   Customer      PATCH /api/sales-orders/:id/customer     sales-orders:update; the hub of the NEW customer is picked here too
//   Hub           PATCH /api/sales-orders/:id/hub          sales-orders:update
import { useMemo, useRef, useState } from "react";
import { ImagePlus, Search, X } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { compressImage } from "@/lib/image-compress";
import { getCurrentUser } from "@/lib/auth";
import type { Customer } from "@/types";
import { Sheet } from "../../components";
import { M } from "../../theme";
import { mutateJson } from "../../config/mutate";
import { str } from "../../config/helpers";
import { INPUT, sem } from "../delivery/ui-tokens";
import { FieldLabel, SheetFooter, SheetSub } from "../delivery/ui";

type Row = Record<string, unknown>;
const area = { ...INPUT, height: 96, padding: "10px 13px", resize: "none" as const, lineHeight: 1.4 };
const err = (t: string) => <div role="alert" style={{ fontSize: 12.5, color: sem("danger"), marginTop: 8, overflowWrap: "anywhere" }}>{t}</div>;

// ---- Open Service Case ------------------------------------------------------------------------------------------
// The desktop labels (service-cases/detail.tsx ROOT_CAUSE_LABELS); the create form's category is optional.
const ROOT_CAUSES: [string, string][] = [
  ["PRODUCTION", "Production / workmanship"], ["DESIGN", "Design / R&D"], ["MATERIAL", "Material / supplier"], ["PROCESS", "Process / SOP gap"],
  ["CUSTOMER", "Customer (not our fault)"], ["TRANSPORT", "Transport / 3PL"], ["SALES", "Sales / order-taking error"], ["PICKING", "Picking / packing error"], ["OTHER", "Other"],
];
type Affected = { productId: string; code: string; name: string; qty: number | null };

export function ServiceCaseSheet({ open, orderId, companySO, items, onClose, onCreated }: { open: boolean; orderId: string; companySO: string; items: Row[]; onClose: () => void; onCreated: (caseId: string) => void }) {
  const [issue, setIssue] = useState("");
  const [cause, setCause] = useState("");
  const [picked, setPicked] = useState<Affected[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  // One pickable card per product (two lines of the same product are one affected product, quantities summed) — desktop's rule.
  const products = useMemo(() => {
    const byProduct = new Map<string, { productId: string; code: string; name: string; qty: number }>();
    for (const it of items) {
      const productId = str(it, "productId");
      if (!productId) continue;
      const q = Number(it.quantity) || 0;
      const prev = byProduct.get(productId);
      if (prev) prev.qty += q;
      else byProduct.set(productId, { productId, code: str(it, "productCode"), name: str(it, "productName"), qty: q });
    }
    return [...byProduct.values()];
  }, [items]);

  const toggle = (p: { productId: string; code: string; name: string; qty: number }) =>
    setPicked((prev) => (prev.some((x) => x.productId === p.productId) ? prev.filter((x) => x.productId !== p.productId) : [...prev, { productId: p.productId, code: p.code, name: p.name, qty: p.qty }]));

  const addPhotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setPhotoBusy(true);
    const out: string[] = [];
    for (const f of Array.from(files)) {
      try { out.push(await compressImage(f, { maxDim: 1280, quality: 0.85 })); } catch { setError(`Couldn't read ${f.name}`); }
    }
    if (out.length) setPhotos((p) => [...p, ...out]);
    setPhotoBusy(false);
  };

  const submit = async () => {
    if (busy) return;
    setError("");
    setBusy(true);
    const user = getCurrentUser();
    const r = await mutateJson<{ data?: { id?: string } }>("/api/service-cases", "POST", {
      sourceType: "SO",
      sourceId: orderId,
      issueDescription: issue || null,
      issuePhotos: photos,
      affectedProducts: picked.length > 0 ? picked : undefined,
      rootCauseCategory: cause || null,
      rootCauseNotes: null,
      createdBy: user?.id ?? null,
      createdByName: user?.displayName ?? user?.email ?? null,
    });
    setBusy(false);
    const id = r.body?.data?.id;
    if (!r.ok || !id) return setError(r.error || `Failed to create (HTTP ${r.status})`);
    onCreated(id);
  };

  return (
    <Sheet open={open} onClose={busy ? () => undefined : onClose} title="Open Service Case">
      <SheetSub>{`For ${companySO || "this order"}. Log a customer issue or complaint against it.`}</SheetSub>
      <FieldLabel>Issue description</FieldLabel>
      <textarea value={issue} onChange={(e) => setIssue(e.target.value)} aria-label="Issue description" style={area} />
      <div style={{ height: 12 }} />
      <FieldLabel>Root cause category (optional)</FieldLabel>
      <select value={cause} onChange={(e) => setCause(e.target.value)} aria-label="Root cause category" style={INPUT}>
        <option value="">Not decided yet</option>
        {ROOT_CAUSES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
      {products.length > 0 ? (
        <>
          <div style={{ height: 12 }} />
          <FieldLabel>Affected products (optional)</FieldLabel>
          <div style={{ background: M.card, borderRadius: 12, padding: "2px 12px" }}>
            {products.map((p, i) => (
              <label key={p.productId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: i ? `1px solid ${M.divider}` : "none", fontSize: 13, color: M.raisin }}>
                <input type="checkbox" checked={picked.some((x) => x.productId === p.productId)} onChange={() => toggle(p)} style={{ width: 18, height: 18, accentColor: "var(--m-taupe)" }} />
                <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}><b>{p.code}</b> {p.name}</span>
                <span style={{ color: M.muted }}>× {p.qty}</span>
              </label>
            ))}
          </div>
        </>
      ) : null}
      <div style={{ height: 12 }} />
      <FieldLabel>Photos (optional)</FieldLabel>
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { void addPhotos(e.target.files); e.target.value = ""; }} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {photos.map((src, i) => (
          <span key={i} style={{ position: "relative", width: 56, height: 56 }}>
            <img src={src} alt={`Photo ${i + 1}`} style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 10 }} />
            <button type="button" onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))} aria-label={`Remove photo ${i + 1}`} style={{ position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: 11, border: "none", background: M.raisin, color: M.paper, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><X size={12} aria-hidden="true" /></button>
          </span>
        ))}
        <button type="button" onClick={() => fileRef.current?.click()} disabled={photoBusy} style={{ width: 56, height: 56, borderRadius: 10, border: `1px dashed ${M.border}`, background: M.card, color: M.taupe, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }} aria-label="Add photos"><ImagePlus size={20} aria-hidden="true" /></button>
      </div>
      {error ? err(error) : null}
      <SheetFooter onCancel={onClose} onConfirm={() => void submit()} confirmLabel="Open Service Case" busy={busy || photoBusy} />
    </Sheet>
  );
}

// ---- Change customer ---------------------------------------------------------------------------------------------
type CustomerCascade = { productionOrdersUpdated?: number; deliveryOrdersUpdated?: number; invoicesUpdated?: number };

export function CustomerChangeSheet({ open, orderId, currentCustomerId, onClose, onSaved }: { open: boolean; orderId: string; currentCustomerId: string; onClose: () => void; onSaved: (message: string) => void }) {
  const { data } = useCachedJson<{ data?: Customer[] }>(open ? "/api/customers" : null, 300);
  const [q, setQ] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [hubId, setHubId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // A prospect cannot be billed (the server refuses it): hide them, as desktop does.
  const customers = useMemo(() => (data?.data ?? []).filter((c) => c.id !== currentCustomerId && (c.customerStage ?? "CONFIRMED") !== "POTENTIAL"), [data, currentCustomerId]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (t ? customers.filter((c) => `${c.code ?? ""} ${c.name ?? ""}`.toLowerCase().includes(t)) : customers).slice(0, 40);
  }, [customers, q]);
  const selected = customers.find((c) => c.id === customerId);
  const hubs = selected?.deliveryHubs ?? [];

  const save = async () => {
    if (!customerId) return setError("Pick a customer before saving.");
    if (hubs.length > 0 && !hubId) return setError("Pick a delivery hub for the new customer.");
    setBusy(true);
    setError("");
    const r = await mutateJson<{ cascade?: CustomerCascade }>(`/api/sales-orders/${encodeURIComponent(orderId)}/customer`, "PATCH", { customerId, hubId: hubId || undefined, reason: reason.trim() || undefined });
    setBusy(false);
    if (!r.ok) return setError(r.error || `Failed to update customer (HTTP ${r.status}).`);
    const c = r.body?.cascade;
    const parts: string[] = [];
    if (c) {
      if ((c.productionOrdersUpdated ?? 0) > 0) parts.push(`${c.productionOrdersUpdated} production order${c.productionOrdersUpdated === 1 ? "" : "s"}`);
      if ((c.deliveryOrdersUpdated ?? 0) > 0) parts.push(`${c.deliveryOrdersUpdated} draft DO${c.deliveryOrdersUpdated === 1 ? "" : "s"}`);
      if ((c.invoicesUpdated ?? 0) > 0) parts.push(`${c.invoicesUpdated} draft invoice${c.invoicesUpdated === 1 ? "" : "s"}`);
    }
    const hubName = hubs.find((h) => h.id === hubId)?.shortName || "";
    let msg = `Customer changed to ${selected?.name || "(new customer)"}${hubName ? ` (${hubName})` : ""}.`;
    if (parts.length) msg += ` Also updated: ${parts.join(", ")}.`;
    onSaved(msg);
  };

  return (
    <Sheet open={open} onClose={busy ? () => undefined : onClose} title="Change Customer">
      <SheetSub>Move this order to the right customer. Documents already raised for it are refreshed where the server allows. Editable until goods leave the warehouse or an invoice is issued.</SheetSub>
      <div style={{ position: "relative" }}>
        <Search size={15} strokeWidth={2} color={M.muted} style={{ position: "absolute", left: 12, top: 15 }} aria-hidden="true" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer code or name" aria-label="Search customers" style={{ ...INPUT, paddingLeft: 34 }} />
      </div>
      <div style={{ background: M.card, borderRadius: 12, padding: "0 12px", marginTop: 8, maxHeight: 220, overflowY: "auto" }}>
        {shown.length === 0 ? <div style={{ padding: "14px 0", fontSize: 13, color: M.ink }}>{data ? "No customer matches." : "Loading customers…"}</div> : null}
        {shown.map((c, i) => (
          <button key={c.id} type="button" onClick={() => { setCustomerId(c.id); setHubId(""); setError(""); }} aria-pressed={c.id === customerId} style={{ width: "100%", textAlign: "left", display: "block", padding: "9px 0", border: "none", borderTop: i ? `1px solid ${M.divider}` : "none", background: "none", fontFamily: "inherit", cursor: "pointer", fontWeight: c.id === customerId ? 700 : 500, fontSize: 13.5, color: M.raisin }}>
            {c.code ? `${c.code} · ` : ""}{c.name}{c.id === customerId ? "  ✓" : ""}
          </button>
        ))}
      </div>
      {hubs.length > 0 ? (
        <>
          <div style={{ height: 12 }} />
          <FieldLabel required>Delivery hub of the new customer</FieldLabel>
          <select value={hubId} onChange={(e) => setHubId(e.target.value)} aria-label="New delivery hub" style={INPUT}>
            <option value="">Pick the delivery hub</option>
            {hubs.map((h) => <option key={h.id} value={h.id}>{h.shortName}{h.state ? ` · ${h.state}` : ""}</option>)}
          </select>
        </>
      ) : null}
      <div style={{ height: 12 }} />
      <FieldLabel>Reason (optional)</FieldLabel>
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" style={{ ...area, height: 64 }} />
      {error ? err(error) : null}
      <SheetFooter onCancel={onClose} onConfirm={() => void save()} confirmLabel="Change Customer" busy={busy} disabled={!customerId} />
    </Sheet>
  );
}

// ---- Change delivery hub -----------------------------------------------------------------------------------------
type HubCascade = { deliveryOrdersUpdated?: number; invoicesUpdated?: number; productionOrdersUpdated?: number; warningDOs?: { doNo: string; reason: string }[] };

export function HubChangeSheet({ open, orderId, customerId, currentHubId, onClose, onSaved }: { open: boolean; orderId: string; customerId: string; currentHubId: string; onClose: () => void; onSaved: (message: string, warnings: string[]) => void }) {
  const { data } = useCachedJson<{ data?: Customer }>(open && customerId ? `/api/customers/${encodeURIComponent(customerId)}` : null);
  const hubs = data?.data?.deliveryHubs ?? [];
  const [hubId, setHubId] = useState(currentHubId);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!hubId) return setError("Pick a delivery hub.");
    if (hubId === currentHubId) return setError("That is already the order's delivery hub.");
    setBusy(true);
    setError("");
    const r = await mutateJson<{ cascade?: HubCascade }>(`/api/sales-orders/${encodeURIComponent(orderId)}/hub`, "PATCH", { hubId, reason: reason.trim() || undefined });
    setBusy(false);
    if (!r.ok) return setError(r.error || `Failed to update hub (HTTP ${r.status}).`);
    const c = r.body?.cascade;
    const parts: string[] = [];
    if (c) {
      if ((c.deliveryOrdersUpdated ?? 0) > 0) parts.push(`${c.deliveryOrdersUpdated} draft DO${c.deliveryOrdersUpdated === 1 ? "" : "s"}`);
      if ((c.invoicesUpdated ?? 0) > 0) parts.push(`${c.invoicesUpdated} draft invoice${c.invoicesUpdated === 1 ? "" : "s"}`);
    }
    let msg = `Hub updated to ${hubs.find((h) => h.id === hubId)?.shortName || "the new hub"}.`;
    if (parts.length) msg += ` Cascaded to: ${parts.join(", ")}.`;
    if (c && (c.productionOrdersUpdated ?? 0) > 0) msg += ` ${c.productionOrdersUpdated} production sheet${c.productionOrdersUpdated === 1 ? "" : "s"} will auto-update via join on next print.`;
    onSaved(msg, (c?.warningDOs ?? []).map((w) => `Did not update ${w.doNo} (${w.reason}). Please review manually.`));
  };

  return (
    <Sheet open={open} onClose={busy ? () => undefined : onClose} title="Change Delivery Hub">
      <SheetSub>Editable until goods leave the warehouse.</SheetSub>
      <FieldLabel required>Delivery hub</FieldLabel>
      <select value={hubId} onChange={(e) => { setHubId(e.target.value); setError(""); }} aria-label="Delivery hub" style={INPUT}>
        <option value="">{data ? "Pick the delivery hub" : "Loading hubs…"}</option>
        {hubs.map((h) => <option key={h.id} value={h.id}>{h.shortName}{h.state ? ` · ${h.state}` : ""}</option>)}
      </select>
      <div style={{ height: 12 }} />
      <FieldLabel>Reason (optional)</FieldLabel>
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" style={{ ...area, height: 64 }} />
      {error ? err(error) : null}
      <SheetFooter onCancel={onClose} onConfirm={() => void save()} confirmLabel="Change Hub" busy={busy} disabled={!hubId || hubId === currentHubId} />
    </Sheet>
  );
}
