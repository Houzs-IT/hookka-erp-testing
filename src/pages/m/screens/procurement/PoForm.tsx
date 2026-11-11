// ===========================================================================
// PoForm — full-screen New / Low-stock / Edit Purchase Order (prototype form).
// Three desktop flows, kept apart (owner 2026-10-21):
//   new       desktop create.tsx        → POST status CONFIRMED (+ Split: one
//                                          CONFIRMED PO per supplier, each with
//                                          that supplier's purchase company)
//   lowStock  desktop index.tsx dialog  → POST with NO status (server DRAFT),
//                                          no purchase company (server derives)
//   edit      desktop detail.tsx        → PUT expectedDate / notes / items
// Lines come from supplier-material bindings (price, unit, MOQ from data).
// ===========================================================================
import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { Sheet } from "../../components";
import { M } from "../../theme";
import { money } from "../../config/helpers";
import {
  distinctSuppliers, lineFromBinding, lineFromPoItem, lineUid, lowStockLines, materialPickerRows, n, poCreateBody, poCreateError, poEditBody,
  poEditError, poLowStockBody, rows, s, splitBodies, splitResultToast, supplierLabel,
  type PoLine, type RawRow,
} from "../../lib/procurement-mobile";
import { FieldLabel, Notice, RadioRow, SelectField, SheetSub } from "../delivery/ui";
import { DL, pill } from "../delivery/ui-tokens";
import { useConfirmSheet } from "../delivery/ui-hooks";
import { postPoGroups, putPo, refreshProcurementCaches, send } from "./actions";
import { AreaInput, FormIntro, FormLineCard, FullScreenForm, GhostAddButton, QtyBox, RateBox, SearchRow, TextInput } from "./parts";

export type PoFormMode = { kind: "new" } | { kind: "lowStock" } | { kind: "edit"; po: RawRow };

type Org = { code: string; name: string; isActive?: boolean };

const withUid = (l: PoLine): PoLine => ({ ...l, uid: lineUid() });

export function PoForm({
  mode,
  onClose,
  onDone,
}: {
  mode: PoFormMode | null;
  rawMaterials?: RawRow[];
  bindings?: RawRow[];
  onClose: () => void;
  onDone: (message: string, newId: string | null) => void;
}) {
  const open = !!mode;
  // Same reads desktop create.tsx makes (shared cache).
  const supResp = useCachedJson<{ data?: RawRow[] }>(open ? "/api/suppliers" : null);
  const orgResp = useCachedJson<{ organisations?: Org[] }>(open ? "/api/organisations" : null);
  const invResp = useCachedJson<{ success?: boolean; data?: { rawMaterials?: RawRow[] } }>(open ? "/api/inventory?buckets=rawMaterials" : null);
  const bindResp = useCachedJson<{ data?: RawRow[] } | RawRow[]>(open ? "/api/supplier-materials" : null);

  const suppliers = useMemo(() => rows(supResp.data?.data), [supResp.data]);
  const active = useMemo(() => suppliers.filter((x) => s(x, "status") === "ACTIVE"), [suppliers]);
  const activeIds = useMemo(() => new Set(active.map((x) => s(x, "id"))), [active]);
  const orgs = useMemo(() => (orgResp.data?.organisations ?? []).filter((o) => o.isActive !== false), [orgResp.data]);
  const rms = useMemo(() => (invResp.data?.success ? rows(invResp.data.data?.rawMaterials) : []), [invResp.data]);
  const bindings = useMemo(() => {
    const b = (bindResp.data as { data?: RawRow[] } | null)?.data ?? bindResp.data;
    return Array.isArray(b) ? (b as RawRow[]) : [];
  }, [bindResp.data]);
  const nameOf = (sid: string) => supplierLabel(suppliers.find((x) => s(x, "id") === sid), sid);

  // ---- form state, re-seeded whenever a different mode opens ----
  const [seededFor, setSeededFor] = useState<PoFormMode | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [orgCode, setOrgCode] = useState("HOOKKA");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<PoLine[]>([]);
  const [lowSeeded, setLowSeeded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickQ, setPickQ] = useState("");
  const confirmSheet = useConfirmSheet();

  if (mode !== seededFor) {
    setSeededFor(mode);
    setError(null);
    setBusy(false);
    setLowSeeded(false);
    if (mode?.kind === "edit") {
      const po = mode.po;
      const sid = s(po, "supplierId");
      setSupplierId(sid);
      setExpectedDate((s(po, "expectedDate") || "").slice(0, 10));
      setNotes(s(po, "notes"));
      setLines(rows(po.items).map((it) => withUid(lineFromPoItem(it, sid, s(po, "supplierName")))));
    } else {
      setSupplierId("");
      setOrgCode("HOOKKA");
      setExpectedDate("");
      setNotes("");
      setLines([]);
    }
  }
  // Low-stock prefill waits for the inventory + bindings reads.
  if (mode?.kind === "lowStock" && !lowSeeded && invResp.data && bindResp.data && supResp.data) {
    setLowSeeded(true);
    setLines(lowStockLines(rms, bindings, nameOf).map(withUid));
  }

  const kind = mode?.kind ?? "new";
  const nSup = distinctSuppliers(lines).length;
  const unbound = lines.some((l) => !l.supplierId);
  const subtotal = lines.reduce((a, l) => a + l.quantity * l.unitPriceSen, 0);
  const pickerSupplier = supplierId;
  const addedKeys = new Set(lines.map((l) => `${l.rmId}|${l.supplierId}`));
  const pickRows = useMemo(() => {
    const t = pickQ.trim().toLowerCase();
    return materialPickerRows(rms, bindings, activeIds, pickerSupplier).filter(
      (r) => !t || `${s(r.rm, "itemCode")} ${s(r.rm, "description")}`.toLowerCase().includes(t),
    );
  }, [rms, bindings, activeIds, pickerSupplier, pickQ]);

  const setLine = (i: number, patch: Partial<PoLine>) => {
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
    setError(null);
  };

  const changeSupplier = async (next: string) => {
    if (next === supplierId) return;
    if (lines.some((l) => l.supplierId !== next)) {
      const ok = await confirmSheet.confirm({
        title: "Change supplier?",
        lines: [{ icon: "warning", text: "Changing the supplier will clear the current order items. Continue?" }],
        confirmLabel: "Clear items",
      });
      if (!ok) return;
      setLines([]);
    }
    setSupplierId(next);
    const sup = suppliers.find((x) => s(x, "id") === next);
    if (s(sup ?? {}, "purchaseOrgCode")) setOrgCode(s(sup!, "purchaseOrgCode"));
    else if (!next) setOrgCode("HOOKKA");
    setError(null);
  };

  const submit = async () => {
    if (busy) return;
    const err = kind === "edit" ? poEditError(lines) : poCreateError(lines);
    if (err) {
      setError(err);
      return;
    }
    setBusy(true);
    if (kind === "edit" && mode?.kind === "edit") {
      const r = await putPo(s(mode.po, "id"), poEditBody(lines, { expectedDate, notes }));
      setBusy(false);
      if (!r.ok) return setError(r.error);
      refreshProcurementCaches();
      onDone("Purchase order updated", null);
      return;
    }
    const body = kind === "new" ? poCreateBody(lines, { purchaseOrgCode: orgCode, expectedDate, notes }) : poLowStockBody(lines, { expectedDate, notes });
    const r = await send("/api/purchase-orders", "POST", body);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    refreshProcurementCaches();
    const data = (r.body?.data ?? null) as RawRow | null;
    onDone("Purchase order created", data ? s(data, "id") || null : null);
  };

  const split = async () => {
    if (busy || unbound || nSup < 2) return;
    setBusy(true);
    const groups = splitBodies(lines, { expectedDate, notes, purchaseOrgCode: orgCode }, kind === "lowStock" ? "lowStock" : "manual", (sid) =>
      s(suppliers.find((x) => s(x, "id") === sid) ?? {}, "purchaseOrgCode"),
    );
    const res = await postPoGroups(groups);
    setBusy(false);
    if (res.failures.length === 0) {
      onDone(splitResultToast(res.ok, groups.length), null);
      return;
    }
    setError([...res.failures, res.ok > 0 ? splitResultToast(res.ok, groups.length) : ""].filter(Boolean).join("\n"));
  };

  const title = kind === "edit" ? "Edit Purchase Order" : "New Purchase Order";
  const submitLabel = kind === "edit" ? "Save Changes" : "Create PO";
  const intro =
    kind === "lowStock"
      ? "Prefilled with raw materials at or below minStock. Suggested qty = max(maxStock − balance, MOQ). Saved as Draft."
      : kind === "new"
        ? "Lines come from supplier price bindings. One PO = one supplier."
        : "";
  const orgOptions = orgs.length ? orgs : [{ code: "HOOKKA", name: "HOOKKA" }];
  const loadingRefs = open && (!invResp.data || !bindResp.data || !supResp.data);

  return (
    <>
      <FullScreenForm open={open} title={title} onClose={onClose} submitLabel={submitLabel} onSubmit={() => void submit()} busy={busy} error={error}>
        {intro ? <FormIntro>{intro}</FormIntro> : null}

        {kind === "new" ? (
          <div>
            <FieldLabel optional>Supplier</FieldLabel>
            <SelectField ariaLabel="Supplier" value={supplierId} onChange={(v) => void changeSupplier(v)}>
              <option value="">Any supplier</option>
              {active.map((x) => (
                <option key={s(x, "id")} value={s(x, "id")}>
                  {supplierLabel(x, s(x, "id"))}
                </option>
              ))}
            </SelectField>
            <div style={{ fontSize: 11.5, color: M.ink, marginTop: 5 }}>Only active suppliers. Picking a supplier limits the materials to its price bindings.</div>
          </div>
        ) : kind === "edit" ? (
          <div>
            <FieldLabel>Supplier</FieldLabel>
            <div style={{ fontSize: 14, fontWeight: 600, color: M.raisin }}>{s(mode?.kind === "edit" ? mode.po : {}, "supplierName") || "—"}</div>
          </div>
        ) : null}

        {kind === "new" ? (
          <div>
            <FieldLabel required>Purchase company</FieldLabel>
            <div role="radiogroup" aria-label="Purchase company" style={{ display: "grid", gap: 6 }}>
              {orgOptions.map((o) => (
                <RadioRow key={o.code} on={orgCode === o.code} label={o.name || o.code} sub={o.name && o.name !== o.code ? o.code : undefined} onClick={() => setOrgCode(o.code)} />
              ))}
            </div>
          </div>
        ) : null}

        <div>
          <FieldLabel optional>Expected Delivery Date</FieldLabel>
          <TextInput type="date" value={expectedDate} onChange={setExpectedDate} ariaLabel="Expected Delivery Date" />
        </div>
        <div>
          <FieldLabel optional>Notes</FieldLabel>
          <AreaInput value={notes} onChange={setNotes} ariaLabel="Notes" />
        </div>

        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: M.raisin }}>Order items ({lines.length})</span>
            <span style={{ fontSize: 12, color: M.ink, fontVariantNumeric: "tabular-nums" }}>{money(subtotal)}</span>
          </div>
          {loadingRefs && kind === "lowStock" && !lines.length ? <Notice>Loading low-stock materials…</Notice> : null}
          {!lines.length && !(loadingRefs && kind === "lowStock") ? (
            <FormLineCard>
              <div style={{ textAlign: "center", fontSize: 12.5, color: M.ink, padding: "4px 0" }}>No items yet — tap Add item.</div>
            </FormLineCard>
          ) : null}
          <div style={{ display: "grid", gap: 8 }}>
            {lines.map((l, i) => (
              <FormLineCard key={l.uid ?? i}>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: M.raisin }}>{l.rmDescription || l.rmCode}</div>
                    <div style={{ fontSize: 12, color: M.ink, marginTop: 2 }}>
                      {[l.rmCode, l.supplierName || "No supplier", l.unit ? `per ${l.unit}` : ""].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <button type="button" onClick={() => setLines((p) => p.filter((_, j) => j !== i))} aria-label="Remove line" style={{ width: 36, height: 36, margin: "-6px -8px 0 0", border: "none", background: "none", color: pill("danger").fg, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Trash2 size={16} strokeWidth={1.9} />
                  </button>
                </div>
                {!l.supplierId ? (
                  <div style={{ marginTop: 8 }}>
                    <SelectField ariaLabel="Supplier for this line" value="" onChange={(sid) => setLine(i, { supplierId: sid, supplierName: nameOf(sid) })}>
                      <option value="">Pick supplier…</option>
                      {active.map((x) => (
                        <option key={s(x, "id")} value={s(x, "id")}>
                          {supplierLabel(x, s(x, "id"))}
                        </option>
                      ))}
                    </SelectField>
                  </div>
                ) : null}
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
                  <span style={{ flex: "none", fontSize: 12, color: M.ink }}>Qty{l.unit ? ` (${l.unit})` : ""}</span>
                  <QtyBox value={l.quantity} onChange={(v) => setLine(i, { quantity: v })} ariaLabel="Quantity" />
                  <span style={{ flex: 1, textAlign: "right", fontSize: 13.5, fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums" }}>{money(l.quantity * l.unitPriceSen)}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                  <span style={{ flex: "none", fontSize: 12, color: M.ink }}>Unit price (RM)</span>
                  <RateBox sen={l.unitPriceSen} onChange={(sen) => setLine(i, { unitPriceSen: sen })} ariaLabel="Unit price (RM)" />
                </div>
              </FormLineCard>
            ))}
          </div>
          <div style={{ marginTop: 8 }}>
            <GhostAddButton label="Add item" onClick={() => setPickerOpen(true)} />
          </div>
        </div>

        {kind !== "edit" && nSup > 1 ? (
          <div style={{ padding: 12, borderRadius: 12, background: pill("warning").bg, display: "grid", gap: 10 }}>
            <div style={{ fontSize: 12.5, lineHeight: 1.45, color: DL.body }}>
              Lines belong to {nSup} suppliers — use Split by Supplier to create one PO per supplier{kind === "lowStock" ? " (saved as Drafts)" : ""}.
              {unbound ? " Pick a supplier for every line first." : ""}
            </div>
            <button
              type="button"
              disabled={busy || unbound}
              onClick={() => void split()}
              style={{ height: 44, borderRadius: 12, border: "none", background: M.card, color: M.taupe, fontFamily: "inherit", fontSize: 13.5, fontWeight: 700, cursor: busy || unbound ? "default" : "pointer", opacity: busy || unbound ? 0.5 : 1 }}
            >
              Split by Supplier ({nSup})
            </button>
          </div>
        ) : null}
      </FullScreenForm>

      <Sheet open={pickerOpen} onClose={() => setPickerOpen(false)} title="Add item">
        <SheetSub>{pickerSupplier ? `Materials bound to ${s(suppliers.find((x) => s(x, "id") === pickerSupplier) ?? {}, "name")}` : "All supplier price bindings"}</SheetSub>
        <div style={{ margin: "-12px -18px 8px" }}>
          <SearchRow q={pickQ} setQ={setPickQ} placeholder="Search material code or name" />
        </div>
        {loadingRefs ? (
          <Notice>Loading materials…</Notice>
        ) : pickRows.length === 0 ? (
          <Notice>No materials with an active supplier price binding{pickerSupplier ? " for this supplier" : ""}.</Notice>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {pickRows.slice(0, 80).map((r) => {
              const sid = s(r.binding, "supplierId");
              const added = addedKeys.has(r.key);
              return (
                <button
                  key={r.key}
                  type="button"
                  disabled={added}
                  onClick={() => {
                    setLines((p) => [...p, withUid(lineFromBinding(r.rm, r.binding, nameOf(sid)))]);
                    setPickerOpen(false);
                    setPickQ("");
                    setError(null);
                  }}
                  style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 56, padding: "8px 13px", border: "none", borderRadius: 12, background: M.card, fontFamily: "inherit", textAlign: "left", cursor: added ? "default" : "pointer", opacity: added ? 0.5 : 1, boxShadow: "0 1px 2px rgba(31,29,27,.05),0 6px 18px -10px rgba(31,29,27,.18)" }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: M.raisin }}>{s(r.rm, "description") || s(r.rm, "itemCode")}</span>
                    <span style={{ display: "block", fontSize: 12, color: M.ink, marginTop: 2 }}>
                      {[s(r.rm, "itemCode"), s(suppliers.find((x) => s(x, "id") === sid) ?? {}, "name") || sid, r.binding.isMainSupplier === true ? "Main" : "", n(r.binding, "moq") ? `MOQ ${n(r.binding, "moq")}` : "", added ? "Added" : ""].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span style={{ flex: "none", fontSize: 13, fontWeight: 700, color: M.taupe, fontVariantNumeric: "tabular-nums" }}>
                    {money(n(r.binding, "unitPrice"))}
                    {s(r.rm, "baseUOM") ? `/${s(r.rm, "baseUOM")}` : ""}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <div style={{ height: 16 }} />
      </Sheet>
      {confirmSheet.node}
    </>
  );
}
