// Edit a saved Sales Order on the phone. Same header fields and the same save as the desktop edit
// page (src/pages/sales/edit.tsx): PUT /api/sales-orders/:id with the whole order, then a read-back to
// prove the header took effect (lib/verified-save.ts). The lines go through lib/so-edit.ts, which sends
// every stored field back — the server replaces ALL lines on save, so anything left out would be lost.
// Colours / spacing: the same sheet pieces as the scan review.
import { useState } from "react";
import { useCachedJson } from "@/lib/cached-fetch";
import { verifiedSave, formatMismatchError } from "@/lib/verified-save";
import { M, M_ACCENT } from "../../theme";
import { SoLineEditor, Field } from "./so-ui";
import { card, ghost, input, primary, sectionLabel } from "./so-style";
import { SheetFrame } from "../dashboard/home-ui";
import { TNUM } from "../dashboard/home-style";
import { editHeaderFromDoc, editItemFromServer, soEditBlockers, soEditBody, splitSofaLine, type SoEditHeader } from "../../lib/so-edit";
import { rmToSen, type ReviewItem } from "../../lib/scan-so";

type Row = Record<string, unknown>;
const rm = (n: number) => `RM ${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function SoEditSheet({ doc, id, overrideToken, onClose, onSaved }: {
  doc: Row;
  /** The row id (the route id may be the SO number; the PUT wants the row id). */
  id: string;
  overrideToken: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [header, setHeader] = useState<SoEditHeader>(() => editHeaderFromDoc(doc));
  const [items, setItems] = useState<ReviewItem[]>(() => (Array.isArray(doc.items) ? (doc.items as Row[]) : []).map(editItemFromServer));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const customers = useCachedJson<{ data?: Row[] }>("/api/customers");
  const draft = String(doc.status ?? "") === "DRAFT";

  const options = (customers.data?.data ?? []).map((c) => ({ id: String(c.id ?? ""), name: String(c.name ?? c.code ?? c.id ?? "") }));
  // Keep the order's own customer selectable even when the list is unavailable to this role.
  if (header.customerId && !options.some((o) => o.id === header.customerId)) options.unshift({ id: header.customerId, name: String(doc.customerName ?? header.customerId) });

  const setH = (p: Partial<SoEditHeader>) => setHeader((h) => ({ ...h, ...p }));
  const patchItem = (key: string, p: Partial<ReviewItem>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)));
  const patchExtra = (key: string, p: Partial<NonNullable<ReviewItem["edit"]>>) => setItems((list) => list.map((i) => (i.key === key && i.edit ? { ...i, edit: { ...i.edit, ...p } } : i)));

  const stops = soEditBlockers(header, items);
  const total = items.reduce((s, i) => s + (Number(i.qty) > 0 ? Number(i.qty) * (rmToSen(i.priceRm) / 100) : 0), 0);

  const save = async () => {
    if (busy) return;
    if (stops.length) { setError(stops[0]); return; }
    setBusy(true);
    setError("");
    const url = `/api/sales-orders/${encodeURIComponent(id)}`;
    const result = await verifiedSave<Row>({
      endpoint: url,
      method: "PUT",
      body: soEditBody(header, items, overrideToken),
      readback: async () => {
        const r = await fetch(`${url}?_v=${Date.now()}`, { credentials: "include", cache: "no-store" });
        if (!r.ok) return null;
        const j = (await r.json()) as { data?: Row } | Row;
        return (j as { data?: Row }).data ?? (j as Row) ?? null;
      },
      expect: {
        customerId: header.customerId,
        customerPOId: header.customerPOId.trim(),
        customerSOId: header.customerSOId.trim(),
        reference: header.reference.trim(),
        companySODate: header.companySODate,
        customerDeliveryDate: header.customerDeliveryDate,
        hookkaExpectedDD: header.hookkaExpectedDD,
        notes: header.notes.trim(),
      },
    });
    setBusy(false);
    if (!result.ok) {
      if (result.reason === "mismatch") setError(formatMismatchError(result.diffs));
      else if (result.reason === "http") {
        let msg = result.body;
        try { const j = JSON.parse(result.body) as { error?: string }; if (j.error) msg = j.error; } catch { /* keep the raw body */ }
        setError(msg || `Failed to update the order (HTTP ${result.status}).`);
      } else if (result.reason === "unverified") {
        // The write itself succeeded; only the confirming read was cut off.
        onSaved();
        return;
      } else setError(`Save failed: ${result.details}`);
      return;
    }
    onSaved();
  };

  return (
    <SheetFrame open title={draft ? "Edit Draft" : "Edit Sales Order"} sub={String(doc.companySOId ?? doc.companySO ?? "")} onClose={onClose}>
      <div>
        <div style={{ ...sectionLabel, marginTop: 4 }}>DETAILS</div>
        <div style={{ ...card, padding: "4px 14px", marginTop: 8 }}>
          <Field first label="Customer" flag={header.customerId ? undefined : "missing"}>
            <select value={header.customerId} onChange={(e) => setH({ customerId: e.target.value })} aria-label="Customer" style={input(header.customerId ? undefined : "missing")}>
              <option value="">Choose the customer</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </Field>
          <Field label="Customer PO"><input value={header.customerPOId} onChange={(e) => setH({ customerPOId: e.target.value })} aria-label="Customer PO" style={input()} /></Field>
          <Field label="Customer SO"><input value={header.customerSOId} onChange={(e) => setH({ customerSOId: e.target.value })} aria-label="Customer SO" style={input()} /></Field>
          <Field label="Reference"><input value={header.reference} onChange={(e) => setH({ reference: e.target.value })} aria-label="Reference" style={input()} /></Field>
          <Field label="Order date"><input type="date" value={header.companySODate} onChange={(e) => setH({ companySODate: e.target.value })} aria-label="Order date" style={input()} /></Field>
          <Field label="Customer delivery date"><input type="date" value={header.customerDeliveryDate} onChange={(e) => setH({ customerDeliveryDate: e.target.value })} aria-label="Customer delivery date" style={input()} /></Field>
          <Field label="Expected delivery date"><input type="date" value={header.hookkaExpectedDD} onChange={(e) => setH({ hookkaExpectedDD: e.target.value })} aria-label="Expected delivery date" style={input()} /></Field>
          <Field label="Notes"><textarea value={header.notes} onChange={(e) => setH({ notes: e.target.value })} aria-label="Notes" style={{ ...input(), height: 72, padding: "8px 11px", resize: "none" }} /></Field>
        </div>

        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 14 }}>
          <span style={sectionLabel}>ORDER ITEMS</span>
          <span style={{ fontSize: 12, color: M.muted }}>{items.length} line{items.length === 1 ? "" : "s"}</span>
        </div>
        <div style={{ ...card, padding: "0 14px", marginTop: 8 }}>
          {items.length === 0 ? <div style={{ padding: "16px 0", fontSize: 13, color: M.ink }}>No items. An order needs at least one.</div> : null}
          {items.map((it, idx) => (
            <SoLineEditor
              key={it.key}
              item={it}
              index={idx}
              catalog={null}
              onChange={(p) => patchItem(it.key, p)}
              onChangeEdit={(p) => patchExtra(it.key, p)}
              onRemove={() => setItems((list) => list.filter((x) => x.key !== it.key))}
              onSplit={() => setItems((list) => splitSofaLine(list, it.key))}
            />
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginTop: 10, padding: "0 4px" }}>
          <span style={{ fontSize: 12.5, color: M.ink }}>Base total (before surcharges and discounts)</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: M.raisin, ...TNUM }}>{rm(total)}</span>
        </div>
        <div style={{ fontSize: 11.5, color: M.muted, marginTop: 10, textAlign: "center" }}>The server re-prices the order when you save, so the saved total can differ.</div>

        <div style={{ position: "sticky", bottom: 0, zIndex: 2, margin: "14px -16px 0", padding: "10px 16px 6px", borderTop: `1px solid ${M.border}`, backgroundColor: M.paper }}>
          {error || stops.length ? <div role="alert" style={{ fontSize: 12, color: M_ACCENT.danger.fg, marginBottom: 8, overflowWrap: "anywhere" }}>{error || stops[0]}</div> : null}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={onClose} disabled={busy} style={{ ...ghost, height: 46, padding: "0 16px", flex: "none" }}>Cancel</button>
            <button type="button" onClick={() => void save()} disabled={busy || stops.length > 0} style={{ ...primary, height: 46, flex: 1, minWidth: 0, opacity: busy || stops.length ? 0.55 : 1, cursor: busy || stops.length ? "default" : "pointer" }}>{busy ? "Saving…" : "Save changes"}</button>
          </div>
        </div>
      </div>
    </SheetFrame>
  );
}
