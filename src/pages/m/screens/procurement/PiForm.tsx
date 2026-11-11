// ===========================================================================
// PiForm — full-screen New Purchase Invoice + Edit Purchase Invoice.
//
// New (desktop pi/create.tsx + components/convert-to-pi-modal.tsx):
//   Supplier * → import a goods receipt (one per PI; lines carry grnItemId,
//   capped at availableQty) or purchase orders (several may be appended), or
//   add items from the supplier's price bindings → POST status DRAFT. No due
//   date (the server sets the last day of next month); no currency (PI
//   create has none — mobile PIs are MYR). Opened from a PO / GRN detail's
//   "Create Invoice" it prefills like desktop's ?poId= / ?grnId= deep link.
// Edit (desktop PurchaseInvoiceDetail.tsx, DRAFT + CONFIRMED): header
//   fields + line qty / unit price / tax, remove line; a CONFIRMED invoice
//   whose total changes asks first.
// ===========================================================================
import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { usePermissions } from "@/lib/use-permission";
import { Sheet } from "../../components";
import { M } from "../../theme";
import { money } from "../../config/helpers";
import {
  grnDeepLinkLines, grnImportCandidates, importLines, importRows, isForeign, lineFromBinding, lineUid, materialPickerRows, mergeImport, n, piCreateBody,
  piCreateError, piEditBody, piEditError, piEditLines, piEditNeedsConfirm, piEditTotals, piLineSen, piMismatchError, poDeepLinkLines,
  poImportCandidates, rows, s, statusOf, supplierLabel, todayIso,
  type PiEditLine, type PiLine, type RawRow,
} from "../../lib/procurement-mobile";
import { CheckBox, FieldLabel, Notice, RadioRow, SelectField, SheetFooter, SheetSub } from "../delivery/ui";
import { pill } from "../delivery/ui-tokens";
import { useConfirmSheet } from "../delivery/ui-hooks";
import { putPi, refreshProcurementCaches, send } from "./actions";
import { AreaInput, FormIntro, FormLineCard, FullScreenForm, GhostAddButton, MoneyBox, NumberBox, QtyBox, RateBox, SearchRow, TextInput } from "./parts";

type Org = { code: string; name: string; isActive?: boolean };
export type PiSource = { kind: "po"; doc: RawRow } | { kind: "grn"; doc: RawRow };

const withUid = (l: PiLine): PiLine => ({ ...l, uid: lineUid() });
const PICK_CAP = 60;

// ---------------------------------------------------------------------------
// New Purchase Invoice.
// ---------------------------------------------------------------------------
export function PiForm({
  open,
  source,
  onClose,
  onDone,
}: {
  open: boolean;
  source: PiSource | null;
  onClose: () => void;
  onDone: (message: string, newId: string | null) => void;
}) {
  const { hasPermission } = usePermissions();
  const supResp = useCachedJson<{ data?: RawRow[] }>(open ? "/api/suppliers" : null);
  const orgResp = useCachedJson<{ organisations?: Org[] }>(open ? "/api/organisations" : null);
  const invResp = useCachedJson<{ success?: boolean; data?: { rawMaterials?: RawRow[] } }>(open ? "/api/inventory?buckets=rawMaterials" : null);
  const bindResp = useCachedJson<{ data?: RawRow[] } | RawRow[]>(open ? "/api/supplier-materials" : null);
  const grnList = useCachedJson<{ data?: RawRow[] }>(open && hasPermission("grn", "read") ? "/api/grn" : null);
  const poList = useCachedJson<{ data?: RawRow[] }>(open && hasPermission("purchase-orders", "read") ? "/api/purchase-orders" : null);

  const suppliers = useMemo(() => rows(supResp.data?.data), [supResp.data]);
  const active = useMemo(() => suppliers.filter((x) => s(x, "status") === "ACTIVE"), [suppliers]);
  const activeIds = useMemo(() => new Set(active.map((x) => s(x, "id"))), [active]);
  const orgs = useMemo(() => (orgResp.data?.organisations ?? []).filter((o) => o.isActive !== false), [orgResp.data]);
  const rms = useMemo(() => (invResp.data?.success ? rows(invResp.data.data?.rawMaterials) : []), [invResp.data]);
  const bindings = useMemo(() => {
    const b = (bindResp.data as { data?: RawRow[] } | null)?.data ?? bindResp.data;
    return Array.isArray(b) ? (b as RawRow[]) : [];
  }, [bindResp.data]);
  const supName = (id: string) => s(suppliers.find((x) => s(x, "id") === id) ?? {}, "name");

  const [lastOpen, setLastOpen] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [orgCode, setOrgCode] = useState("HOOKKA");
  const [invoiceDate, setInvoiceDate] = useState(todayIso());
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState("");
  const [supplierDoNo, setSupplierDoNo] = useState("");
  const [remarks, setRemarks] = useState("");
  const [lines, setLines] = useState<PiLine[]>([]);
  const [sourceGrnId, setSourceGrnId] = useState<string | null>(null);
  const [sourcePoId, setSourcePoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [importKind, setImportKind] = useState<"grn" | "po" | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addQ, setAddQ] = useState("");

  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setError(null);
      setBusy(false);
      setInvoiceDate(todayIso());
      setSupplierInvoiceNo("");
      setSupplierDoNo("");
      if (source?.kind === "po") {
        const po = source.doc;
        setSupplierId(s(po, "supplierId"));
        setRemarks(`Created from PO ${s(po, "poNo")}`);
        setSourcePoId(s(po, "id"));
        setSourceGrnId(null);
        setOrgCode(s(po, "purchaseOrgCode") || "HOOKKA");
        setLines(poDeepLinkLines(po).map(withUid));
      } else if (source?.kind === "grn") {
        const g = source.doc;
        setSupplierId(s(g, "supplierId"));
        setRemarks(`From GRN ${s(g, "grnNumber")}`);
        setSourceGrnId(s(g, "id"));
        setSourcePoId(s(g, "poId") || null);
        setOrgCode(s(g, "purchaseOrgCode") || "HOOKKA");
        setLines(grnDeepLinkLines(g).map(withUid));
      } else {
        setSupplierId("");
        setRemarks("");
        setSourceGrnId(null);
        setSourcePoId(null);
        setOrgCode("HOOKKA");
        setLines([]);
      }
    }
  }

  const pickSupplier = (id: string) => {
    setSupplierId(id);
    const sup = suppliers.find((x) => s(x, "id") === id);
    if (sup && s(sup, "purchaseOrgCode")) setOrgCode(s(sup, "purchaseOrgCode"));
    setError(null);
  };

  /** pi/create.tsx handleConvert. */
  const applyImport = (src: "grn" | "po", doc: RawRow, picked: PiLine[]) => {
    const resSupplier = s(doc, "supplierId");
    const hasLines = lines.some((l) => l.materialName.trim() || l.qty > 0);
    if (hasLines && supplierId && resSupplier && resSupplier !== supplierId) {
      setError(piMismatchError(supName(supplierId), s(doc, "supplierName")));
      return false;
    }
    setSupplierId(resSupplier);
    const label = src === "grn" ? s(doc, "grnNumber") : s(doc, "poNo");
    const merged = mergeImport(lines, picked.map(withUid), { source: src, hasGrnSource: !!sourceGrnId, prevRemarks: remarks, docLabel: label });
    if (src === "grn") setSourceGrnId(s(doc, "id"));
    const headerPo = src === "grn" ? s(doc, "poId") || null : s(doc, "id");
    if (!merged.appended || !sourcePoId) setSourcePoId(headerPo);
    const sup = suppliers.find((x) => s(x, "id") === resSupplier);
    if (sup && s(sup, "purchaseOrgCode")) setOrgCode(s(sup, "purchaseOrgCode"));
    setRemarks(merged.remarks);
    setLines(merged.lines);
    setError(null);
    return true;
  };

  const submit = async () => {
    if (busy) return;
    // Desktop: `if (!supplier) "Select a supplier"` — the supplier RECORD must resolve.
    const supplier = suppliers.find((x) => s(x, "id") === supplierId);
    const err = piCreateError(supplier ? supplierId : "", lines);
    if (err) {
      setError(err);
      return;
    }
    setBusy(true);
    const body = piCreateBody({
      supplierId,
      supplierName: supName(supplierId),
      invoiceDate,
      remarks,
      purchaseOrgCode: orgCode,
      supplierInvoiceNo,
      supplierDoNo,
      purchaseOrderId: sourcePoId,
      grnId: sourceGrnId,
      lines,
    });
    const r = await send("/api/purchase-invoices", "POST", body);
    setBusy(false);
    if (!r.ok) {
      setError(r.error || "Failed to create invoice");
      return;
    }
    refreshProcurementCaches();
    const data = (r.body?.data ?? null) as RawRow | null;
    const piNo = data ? s(data, "piNo") : "";
    onDone(piNo ? `Invoice ${piNo} created` : "Purchase invoice created", data ? s(data, "id") || null : null);
  };

  const total = lines.reduce((a, l) => a + piLineSen(l), 0);
  const orgOptions = orgs.length ? orgs : [{ code: "HOOKKA", name: "HOOKKA" }];
  const canAdd = !sourceGrnId;
  const canImportGrn = hasPermission("grn", "read") && !sourceGrnId;
  const canImportPo = hasPermission("purchase-orders", "read") && !sourceGrnId;

  return (
    <>
      <FullScreenForm open={open} title="New Purchase Invoice" onClose={onClose} submitLabel="Create Invoice" onSubmit={() => void submit()} busy={busy} error={error}>
        <FormIntro>Pick a supplier, then import a goods receipt or add items. One invoice = one supplier. Saved as Draft; the due date is set to the end of next month.</FormIntro>

        <div>
          <FieldLabel required>Supplier</FieldLabel>
          <SelectField ariaLabel="Supplier" value={supplierId} onChange={pickSupplier}>
            <option value="">Select a supplier…</option>
            {/* A source document's supplier stays visible even when it is no longer active. */}
            {supplierId && !activeIds.has(supplierId) ? (
              <option value={supplierId}>{supplierLabel(suppliers.find((x) => s(x, "id") === supplierId), supplierId)}</option>
            ) : null}
            {active.map((x) => (
              <option key={s(x, "id")} value={s(x, "id")}>
                {supplierLabel(x, s(x, "id"))}
              </option>
            ))}
          </SelectField>
        </div>

        {canImportGrn || canImportPo ? (
          <div style={{ display: "grid", gridTemplateColumns: canImportGrn && canImportPo ? "repeat(2, minmax(0, 1fr))" : "minmax(0, 1fr)", gap: 8 }}>
            {canImportGrn ? <ImportButton label="Import goods receipt" onClick={() => setImportKind("grn")} /> : null}
            {canImportPo ? <ImportButton label={sourcePoId && lines.length ? "Add another PO" : "Import purchase order"} onClick={() => setImportKind("po")} /> : null}
          </div>
        ) : null}

        <div>
          <FieldLabel optional>Purchase company</FieldLabel>
          <div role="radiogroup" aria-label="Purchase company" style={{ display: "grid", gap: 6 }}>
            {orgOptions.map((o) => (
              <RadioRow key={o.code} on={orgCode === o.code} label={o.name || o.code} sub={o.name && o.name !== o.code ? o.code : undefined} onClick={() => setOrgCode(o.code)} />
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: M.ink, marginTop: 5 }}>Prefilled from the source document, else the supplier.</div>
        </div>
        <div>
          <FieldLabel optional>Supplier Invoice No.</FieldLabel>
          <TextInput value={supplierInvoiceNo} onChange={setSupplierInvoiceNo} ariaLabel="Supplier Invoice No." />
        </div>
        <div>
          <FieldLabel>Invoice Date</FieldLabel>
          <TextInput type="date" value={invoiceDate} onChange={setInvoiceDate} ariaLabel="Invoice Date" />
        </div>
        <div>
          <FieldLabel optional>Supplier DO No.</FieldLabel>
          <TextInput value={supplierDoNo} onChange={setSupplierDoNo} ariaLabel="Supplier DO No." />
        </div>
        <div>
          <FieldLabel optional>Remarks</FieldLabel>
          <AreaInput value={remarks} onChange={setRemarks} ariaLabel="Remarks" />
        </div>

        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: M.raisin }}>Invoice lines ({lines.length})</span>
            <span style={{ fontSize: 12, color: M.ink, fontVariantNumeric: "tabular-nums" }}>{money(total)}</span>
          </div>
          {!lines.length ? (
            <FormLineCard>
              <div style={{ textAlign: "center", fontSize: 12.5, color: M.ink }}>Import a goods receipt or tap Add item.</div>
            </FormLineCard>
          ) : null}
          <div style={{ display: "grid", gap: 8 }}>
            {lines.map((l, i) => {
              const over = l.max != null && l.qty > l.max;
              return (
                <FormLineCard key={l.uid ?? i}>
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: M.raisin }}>{l.materialName || l.materialCode}</div>
                      <div style={{ fontSize: 12, color: M.ink, marginTop: 2 }}>
                        {[l.materialCode, l.grnItemId ? "from GRN" : l.poId ? "from PO" : "", l.max != null ? `available ${l.max}` : ""].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <button type="button" onClick={() => setLines((p) => p.filter((_, j) => j !== i))} aria-label="Remove line" style={{ width: 36, height: 36, margin: "-6px -8px 0 0", border: "none", background: "none", color: pill("danger").fg, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Trash2 size={16} strokeWidth={1.9} />
                    </button>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
                    <span style={{ flex: "none", fontSize: 12, color: M.ink }}>Qty</span>
                    <QtyBox value={l.qty} onChange={(v) => { setLines((p) => p.map((x, j) => (j === i ? { ...x, qty: v } : x))); setError(null); }} ariaLabel="Quantity" />
                    <span style={{ flex: 1, textAlign: "right", fontSize: 13.5, fontWeight: 700, color: over ? pill("warning").fg : M.raisin, fontVariantNumeric: "tabular-nums" }}>{over ? "Exceeds available" : money(piLineSen(l))}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                    <span style={{ flex: "none", fontSize: 12, color: M.ink }}>Unit price (RM)</span>
                    <RateBox sen={l.unitPriceSen} onChange={(sen) => setLines((p) => p.map((x, j) => (j === i ? { ...x, unitPriceSen: sen } : x)))} ariaLabel="Unit price (RM)" />
                  </div>
                </FormLineCard>
              );
            })}
          </div>
          {canAdd ? (
            <div style={{ marginTop: 8 }}>
              <GhostAddButton label="Add item" onClick={() => (supplierId ? setAddOpen(true) : setError("Select a supplier"))} />
            </div>
          ) : null}
        </div>
      </FullScreenForm>

      <ImportSheet
        kind={importKind}
        grns={grnImportCandidates(rows(grnList.data?.data), "")}
        pos={poImportCandidates(rows(poList.data?.data), "")}
        loading={(importKind === "grn" && grnList.loading && !grnList.data) || (importKind === "po" && poList.loading && !poList.data)}
        onClose={() => setImportKind(null)}
        onPick={(src, doc, picked) => {
          applyImport(src, doc, picked);
          setImportKind(null);
        }}
      />

      <Sheet open={addOpen} onClose={() => { setAddOpen(false); setAddQ(""); }} title="Add item">
        <SheetSub>{`Materials bound to ${supName(supplierId) || "this supplier"}`}</SheetSub>
        <div style={{ margin: "-12px -18px 8px" }}>
          <SearchRow q={addQ} setQ={setAddQ} placeholder="Search material code or name" />
        </div>
        {(() => {
          const t = addQ.trim().toLowerCase();
          const list = materialPickerRows(rms, bindings, activeIds, supplierId).filter(
            (r) => !t || `${s(r.rm, "itemCode")} ${s(r.rm, "description")}`.toLowerCase().includes(t),
          );
          if (!invResp.data || !bindResp.data) return <Notice>Loading materials…</Notice>;
          if (!list.length) return <Notice>{t ? "No matches for your search." : "No materials with a price binding for this supplier."}</Notice>;
          return (
            <div style={{ display: "grid", gap: 6 }}>
              {list.length > PICK_CAP ? <div style={{ fontSize: 11.5, color: M.ink }}>{`Showing ${PICK_CAP} of ${list.length} — search to narrow.`}</div> : null}
              {list.slice(0, PICK_CAP).map((r) => (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => {
                    const pl = lineFromBinding(r.rm, r.binding, "");
                    setLines((p) => [...p, withUid({ materialCode: pl.rmCode, materialName: pl.rmDescription, supplierSku: pl.supplierSku, qty: pl.quantity, unitPriceSen: pl.unitPriceSen, grnItemId: null, poId: null })]);
                    setAddOpen(false);
                    setAddQ("");
                    setError(null);
                  }}
                  style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 56, padding: "8px 13px", border: "none", borderRadius: 12, background: M.card, fontFamily: "inherit", textAlign: "left", cursor: "pointer", boxShadow: "0 1px 2px rgba(31,29,27,.05),0 6px 18px -10px rgba(31,29,27,.18)" }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: M.raisin }}>{s(r.rm, "description") || s(r.rm, "itemCode")}</span>
                    <span style={{ display: "block", fontSize: 12, color: M.ink, marginTop: 2 }}>{[s(r.rm, "itemCode"), n(r.binding, "moq") ? `MOQ ${n(r.binding, "moq")}` : ""].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span style={{ flex: "none", fontSize: 13, fontWeight: 700, color: M.taupe, fontVariantNumeric: "tabular-nums" }}>{money(n(r.binding, "unitPrice"))}</span>
                </button>
              ))}
            </div>
          );
        })()}
        <div style={{ height: 16 }} />
      </Sheet>
    </>
  );
}

function ImportButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ minHeight: 46, padding: "0 10px", borderRadius: 12, border: "none", background: M.card, color: M.taupe, fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer", boxShadow: `inset 0 0 0 1.5px ${M.hairline}` }}>
      {label}
    </button>
  );
}

/** convert-to-pi-modal.tsx as a sheet: pick a document, then its lines (qty ≤ available). */
function ImportSheet({
  kind,
  grns,
  pos,
  loading,
  onClose,
  onPick,
}: {
  kind: "grn" | "po" | null;
  grns: RawRow[];
  pos: RawRow[];
  loading: boolean;
  onClose: () => void;
  onPick: (src: "grn" | "po", doc: RawRow, lines: PiLine[]) => void;
}) {
  const [docId, setDocId] = useState("");
  const [lastKind, setLastKind] = useState<"grn" | "po" | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [qty, setQty] = useState<Record<string, string>>({});
  const [seededId, setSeededId] = useState("");
  const [q, setQ] = useState("");
  if (kind !== lastKind) {
    setLastKind(kind);
    setDocId("");
    setChecked({});
    setQty({});
    setSeededId("");
    setQ("");
  }
  const url = kind && docId ? (kind === "grn" ? `/api/grn/${encodeURIComponent(docId)}` : `/api/purchase-orders/${encodeURIComponent(docId)}`) : null;
  const detail = useCachedJson<{ data?: RawRow }>(url);
  const doc = (detail.data?.data ?? null) as RawRow | null;
  // Seed once per document: a background refetch must not wipe typed quantities.
  if (doc && docId && seededId !== docId) {
    setSeededId(docId);
    const c: Record<string, boolean> = {};
    const q: Record<string, string> = {};
    for (const r of importRows(kind ?? "po", doc)) {
      c[r.id] = r.avail > 0;
      q[r.id] = String(r.avail);
    }
    setChecked(c);
    setQty(q);
  }
  // convert-to-pi-modal.tsx: search by number / supplier (/ PO for a GRN), first 60 shown.
  const t = q.trim().toLowerCase();
  const all = kind === "grn" ? grns : pos;
  const filtered = all.filter(
    (d) => !t || [kind === "grn" ? s(d, "grnNumber") : s(d, "poNo"), s(d, "supplierName"), kind === "grn" ? s(d, "poNumber") : ""].join(" ").toLowerCase().includes(t),
  );
  const list = filtered.slice(0, PICK_CAP);
  const lineRows = doc && kind ? importRows(kind, doc) : [];
  const picked = lineRows.filter((r) => checked[r.id] && (parseFloat(qty[r.id]) || 0) > 0);
  const hasOver = lineRows.some((r) => checked[r.id] && (parseFloat(qty[r.id]) || 0) > r.avail);

  return (
    <Sheet open={!!kind} onClose={onClose} title={docId ? `Select lines — ${doc ? s(doc, kind === "grn" ? "grnNumber" : "poNo") : "Loading…"}` : kind === "grn" ? "Import goods receipt" : "Import purchase order"}>
      {!docId ? (
        <>
          <SheetSub>{kind === "grn" ? "Goods receipts not cancelled, posted first. Lines carry the quantity still to invoice." : "Purchase orders not Draft, Cancelled or Closed."}</SheetSub>
          <div style={{ margin: "-12px -18px 8px" }}>
            <SearchRow q={q} setQ={setQ} placeholder={kind === "grn" ? "Search GRN, supplier, PO" : "Search PO, supplier"} />
          </div>
          {loading ? (
            <Notice>Loading…</Notice>
          ) : list.length === 0 ? (
            <Notice>{t ? "No matches for your search." : "Nothing to import."}</Notice>
          ) : (
            <div role="radiogroup" style={{ display: "grid", gap: 6 }}>
              {filtered.length > PICK_CAP ? <div style={{ fontSize: 11.5, color: M.ink }}>{`Showing ${PICK_CAP} of ${filtered.length} — search to narrow.`}</div> : null}
              {list.map((d) => {
                const st = statusOf(kind === "grn" ? "grn" : "po", s(d, "status"));
                return (
                  <RadioRow
                    key={s(d, "id")}
                    on={false}
                    label={kind === "grn" ? s(d, "grnNumber") : s(d, "poNo")}
                    sub={[s(d, "supplierName"), kind === "grn" ? s(d, "poNumber") : "", st.label, money(n(d, kind === "grn" ? "totalAmount" : "totalSen"))].filter(Boolean).join(" · ")}
                    onClick={() => setDocId(s(d, "id"))}
                  />
                );
              })}
            </div>
          )}
          <div style={{ height: 16 }} />
        </>
      ) : (
        <>
          <button type="button" onClick={() => setDocId("")} style={{ marginTop: -8, marginBottom: 8, padding: 0, border: "none", background: "none", fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: M.taupe, cursor: "pointer" }}>
            ← Back to the list
          </button>
          {!doc ? (
            <Notice>Loading lines…</Notice>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {lineRows.map((r) => {
                const on = !!checked[r.id];
                const q = parseFloat(qty[r.id]) || 0;
                return (
                  <FormLineCard key={r.id}>
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <button type="button" role="checkbox" aria-checked={on} aria-label={`Select ${r.name}`} disabled={r.avail <= 0} onClick={() => setChecked((p) => ({ ...p, [r.id]: !p[r.id] }))} style={{ padding: 0, border: "none", background: "none", cursor: r.avail > 0 ? "pointer" : "default" }}>
                        <CheckBox on={on} />
                      </button>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 700, color: M.raisin }}>{r.name}</div>
                        <div style={{ fontSize: 12, color: M.ink, marginTop: 2 }}>{[r.sub, r.avail > 0 ? `available ${r.avail}` : "fully invoiced"].filter(Boolean).join(" · ")}</div>
                      </div>
                    </div>
                    {on ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
                        <span style={{ flex: "none", fontSize: 12, color: M.ink }}>Qty</span>
                        <NumberBox value={qty[r.id] ?? ""} onChange={(v) => setQty((p) => ({ ...p, [r.id]: v }))} ariaLabel={`Quantity — ${r.name}`} />
                        {q > r.avail ? <span style={{ fontSize: 12, fontWeight: 700, color: pill("warning").fg }}>exceeds available</span> : null}
                      </div>
                    ) : null}
                  </FormLineCard>
                );
              })}
            </div>
          )}
          <SheetFooter
            onCancel={onClose}
            confirmLabel={picked.length ? `Add ${picked.length} line${picked.length === 1 ? "" : "s"}` : "Add lines"}
            disabled={!doc || picked.length === 0 || hasOver}
            onConfirm={() => {
              if (!doc || !kind) return;
              const want: Record<string, number> = {};
              for (const r of picked) want[r.id] = parseFloat(qty[r.id]) || 0;
              onPick(kind, doc, importLines(kind, doc, want));
            }}
          />
        </>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Edit Purchase Invoice.
// ---------------------------------------------------------------------------
export function PiEditForm({ pi, onClose, onDone }: { pi: RawRow | null; onClose: () => void; onDone: (message: string) => void }) {
  const open = !!pi;
  const [seeded, setSeeded] = useState<RawRow | null>(null);
  const [invoiceDate, setInvoiceDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [remarks, setRemarks] = useState("");
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState("");
  const [supplierDoNo, setSupplierDoNo] = useState("");
  const [lines, setLines] = useState<PiEditLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const confirmSheet = useConfirmSheet();
  if (pi !== seeded) {
    setSeeded(pi);
    if (pi) {
      setInvoiceDate((s(pi, "invoiceDate") || "").slice(0, 10));
      setDueDate((s(pi, "dueDate") || "").slice(0, 10));
      setRemarks(s(pi, "remarks"));
      setSupplierInvoiceNo(s(pi, "supplierInvoiceNo"));
      setSupplierDoNo(s(pi, "supplierDoNo"));
      setLines(piEditLines(pi));
      setError(null);
      setBusy(false);
    }
  }
  const patch = (i: number, p: Partial<PiEditLine>) => {
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...p } : l)));
    setError(null);
  };
  const totals = piEditTotals(lines);

  const submit = async () => {
    if (!pi || busy) return;
    const err = piEditError(lines);
    if (err) {
      setError(err);
      return;
    }
    if (piEditNeedsConfirm(pi, totals.totalSen)) {
      const ok = await confirmSheet.confirm({
        title: "Save changes to a confirmed invoice?",
        lines: [{ icon: "warning", text: `This invoice is already confirmed. Saving changes the amount payable from ${money(n(pi, "amountSen"))} to ${money(totals.totalSen)}, and posts a matching accounting correction. Continue?` }],
        confirmLabel: "Save changes",
      });
      if (!ok) return;
    }
    setBusy(true);
    const r = await putPi(s(pi, "id"), piEditBody({ invoiceDate, dueDate, remarks, supplierInvoiceNo, supplierDoNo }, lines));
    setBusy(false);
    if (!r.ok) {
      setError(r.error || "Save failed");
      return;
    }
    refreshProcurementCaches();
    onDone("Invoice saved");
  };

  const confirmed = pi ? ["CONFIRMED", "APPROVED"].includes(s(pi, "status")) : false;
  return (
    <>
      <FullScreenForm open={open} title="Edit Purchase Invoice" onClose={onClose} submitLabel="Save Changes" onSubmit={() => void submit()} busy={busy} error={error}>
        {confirmed ? <FormIntro>Editing a confirmed PI will reverse the old GL entry and post a new one.</FormIntro> : null}
        {pi && isForeign(pi) ? <Notice tone="warning">A {s(pi, "currency")} invoice's lines can't be edited (the server refuses it).</Notice> : null}
        <div>
          <FieldLabel optional>Supplier Invoice No.</FieldLabel>
          <TextInput value={supplierInvoiceNo} onChange={setSupplierInvoiceNo} ariaLabel="Supplier Invoice No." />
        </div>
        <div>
          <FieldLabel>Invoice Date</FieldLabel>
          <TextInput type="date" value={invoiceDate} onChange={setInvoiceDate} ariaLabel="Invoice Date" />
        </div>
        <div>
          <FieldLabel optional>Due Date</FieldLabel>
          <TextInput type="date" value={dueDate} onChange={setDueDate} ariaLabel="Due Date" />
        </div>
        <div>
          <FieldLabel optional>Supplier DO No.</FieldLabel>
          <TextInput value={supplierDoNo} onChange={setSupplierDoNo} ariaLabel="Supplier DO No." />
        </div>
        <div>
          <FieldLabel optional>Remarks</FieldLabel>
          <AreaInput value={remarks} onChange={setRemarks} ariaLabel="Remarks" />
        </div>
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: M.raisin }}>Invoice lines ({lines.length})</span>
            <span style={{ fontSize: 12, color: M.ink, fontVariantNumeric: "tabular-nums" }}>{money(totals.totalSen)}</span>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {lines.map((l, i) => (
              <FormLineCard key={l.uid ?? i}>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: M.raisin }}>{l.materialName || "—"}</div>
                    <div style={{ fontSize: 12, color: M.ink, marginTop: 2 }}>{[l.materialCode, l.lineType !== "STOCKED" ? l.lineType : "", l.grnItemId ? "from GRN" : ""].filter(Boolean).join(" · ")}</div>
                  </div>
                  <button type="button" onClick={() => setLines((p) => p.filter((_, j) => j !== i))} aria-label="Remove line" style={{ width: 36, height: 36, margin: "-6px -8px 0 0", border: "none", background: "none", color: pill("danger").fg, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Trash2 size={16} strokeWidth={1.9} />
                  </button>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
                  <span style={{ flex: "none", width: 92, fontSize: 12, color: M.ink }}>Qty</span>
                  <NumberBox value={l.qty} onChange={(v) => patch(i, { qty: v })} ariaLabel="Quantity" />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                  <span style={{ flex: "none", width: 92, fontSize: 12, color: M.ink }}>Unit price (RM)</span>
                  <RateBox sen={l.unitPriceSen} onChange={(sen) => patch(i, { unitPriceSen: sen })} ariaLabel="Unit price (RM)" />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                  <span style={{ flex: "none", width: 92, fontSize: 12, color: M.ink }}>Tax (RM)</span>
                  <MoneyBox sen={l.taxSen} onChange={(sen) => patch(i, { taxSen: Math.max(0, sen) })} ariaLabel="Tax (RM)" />
                </div>
              </FormLineCard>
            ))}
          </div>
          {lines.some((l) => l.discountSen > 0) ? <div style={{ fontSize: 11.5, color: M.ink, marginTop: 6 }}>The invoice discount is kept and re-spread over the lines.</div> : null}
        </div>
      </FullScreenForm>
      {confirmSheet.node}
    </>
  );
}

