// ===========================================================================
// Section editors for the case detail (Phase 4 prototype "Edit" overlays — full screen,
// title + "Save or discard when done" subtitle, one sticky action area).
// Save behaviour is the DESKTOP's, section by section:
//   Issue description        draft → Save / Discard     PUT {issueDescription}
//   Root cause + prevention  draft → Save / Discard     PUT {rootCauses, preventionAction, preventionOwner}
//   Action taken             draft → Save / Discard     PUT {actionLog}
//   Issue photos             saves IMMEDIATELY           PUT {issuePhotos: full array}
//   Affected products/parts  saves IMMEDIATELY           PUT {affectedProducts: full array}
// The server PUT is partial (an omitted field is kept), so only the changed
// field is sent. Products come from the catalogue / source order with their
// real productId; damaged parts come from the canonical BOM breakdown; workers,
// suppliers and raw materials are the real master lists.
// ===========================================================================
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Camera, Plus, Search, Trash2, X } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { getCurrentUser } from "@/lib/auth";
import { M } from "../../theme";
import { putCase } from "./case-api";
import { ROOT_CAUSE_KEYS, ROOT_CAUSE_SHORT, type ActionLogEntry, type CaseProduct, type RootCause, type ServiceCaseApi } from "./case-model";
import { Chip, Stepper } from "./case-ui";
import { CC, SH_CARD, SH_CTRL, fieldStyle } from "./case-style";
import { ConfirmDialog, Overlay } from "./case-overlay";
import { CatalogPickerSheet, PartsPickerSheet } from "./case-pickers";
import type { ComponentPick, ProductVariant } from "./repair-components";
import { usePhotoQueue } from "./photo-queue";

export type EditKind = "issue" | "photos" | "products" | "causes" | "log";

type Common = { open: boolean; onClose: () => void; c: ServiceCaseApi; onToast: (t: string, tone?: "success" | "error") => void };

const errBox = (t: string) => (
  <div role="alert" style={{ marginBottom: 10, padding: "10px 12px", borderRadius: 12, background: CC.errBg, color: CC.dangerDark, fontSize: 12.5, lineHeight: 1.45, overflowWrap: "anywhere" }}>{t}</div>
);
const caption = (t: string) => <div style={{ fontSize: 11.5, color: CC.hint, padding: "0 2px" }}>{t}</div>;
const card: CSSProperties = { background: M.card, borderRadius: 16, boxShadow: SH_CARD, padding: "14px 15px" };
/** Inset-bordered input used inside cards (prototype `f.isText`). */
const inset = (extra?: CSSProperties): CSSProperties => ({ width: "100%", boxSizing: "border-box", height: 42, padding: "0 12px", border: "none", borderRadius: 10, background: M.paper, fontFamily: "inherit", fontSize: 16, color: M.raisin, outline: "none", boxShadow: "inset 0 0 0 1px #E6E0D9", ...extra });
const smallLabel = (t: string) => <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1px", color: CC.brown, margin: "12px 0 8px" }}>{t}</div>;
const fLabel = (t: string) => <div style={{ fontSize: 12, fontWeight: 700, color: M.raisin, marginBottom: 6 }}>{t}</div>;

/** Discard / Save footer row (prototype: ghost "Discard" + brown "Save"). */
function SaveBar({ onDiscard, onSave, busy, disabled, retry, err }: { onDiscard: () => void; onSave: () => void; busy: boolean; disabled: boolean; retry: boolean; err: string }) {
  return (
    <>
      {err ? errBox(err) : null}
      <div style={{ display: "flex", gap: 10 }}>
        <button type="button" onClick={onDiscard} disabled={busy} style={{ flex: "none", height: 48, padding: "0 20px", border: "none", borderRadius: 12, background: M.card, color: M.ink, fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: SH_CTRL }}>Discard</button>
        <button type="button" onClick={onSave} disabled={busy || disabled} style={{ flex: 1, height: 48, border: "none", borderRadius: 12, background: M.taupe, color: "var(--m-text-on-accent)", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: busy || disabled ? "default" : "pointer", opacity: busy || disabled ? 0.55 : 1 }}>
          {busy ? "Saving…" : retry ? "Try again" : "Save"}
        </button>
      </div>
    </>
  );
}

const DISCARD = { title: "Discard your changes?", text: "You have unsaved changes in this section. They’ll be lost if you leave." };

// ---------------------------------------------------------------------------
// Issue description
function IssueSheetInner({ onClose, c, onToast }: Common) {
  const [text, setText] = useState(c.issueDescription ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [askDiscard, setAskDiscard] = useState(false);
  const dirty = text !== (c.issueDescription ?? "");
  const close = () => (dirty && !busy ? setAskDiscard(true) : onClose());
  const save = async () => {
    setBusy(true); setErr("");
    const r = await putCase(c.id, { issueDescription: text || null });
    setBusy(false);
    if (!r.ok) return setErr(r.error || "Couldn’t save. Your text is kept — try again.");
    onToast("Issue description saved");
    onClose();
  };
  return (
    <>
      <Overlay title="Edit issue description" subtitle={`${c.caseNo} · Save or discard when done`} onClose={close} closeLabel="Close editor" footer={<SaveBar onDiscard={close} onSave={() => void save()} busy={busy} disabled={!dirty} retry={!!err} err={err} />}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={12} aria-label="Issue description" style={fieldStyle({ padding: "12px 13px", lineHeight: 1.55, resize: "vertical", borderRadius: 12 })} />
        {caption("One description field. Customer and source can’t be changed here.")}
      </Overlay>
      <ConfirmDialog open={askDiscard} {...DISCARD} onKeep={() => setAskDiscard(false)} onGo={() => { setAskDiscard(false); onClose(); }} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Issue photos — every add/remove saves immediately (whole array PUT).
function PhotosSheetInner({ onClose, c, onToast }: Common) {
  const q = usePhotoQueue();
  const camRef = useRef<HTMLInputElement>(null);
  const libRef = useRef<HTMLInputElement>(null);
  const [list, setList] = useState<string[]>(c.issuePhotos ?? []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [removeAt, setRemoveAt] = useState<number | null>(null);

  const persist = async (next: string[], ok: string) => {
    setBusy(true); setErr("");
    const r = await putCase(c.id, { issuePhotos: next });
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Couldn’t save the photos. Nothing changed."); return false; }
    setList(next);
    onToast(ok);
    return true;
  };
  const add = async (files: FileList | null) => {
    const added = await q.add(files);
    if (added.length) await persist([...list, ...added], `${added.length} photo${added.length === 1 ? "" : "s"} added · saved`);
  };
  return (
    <>
      <Overlay title="Issue photos" subtitle={`${c.caseNo} · Each change saves immediately`} onClose={onClose} closeLabel="Close editor" footer={<>{err ? errBox(err) : null}<button type="button" onClick={onClose} style={{ width: "100%", height: 48, border: "none", borderRadius: 12, background: M.taupe, color: "var(--m-text-on-accent)", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Done · changes already saved</button></>}>
        <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
        <input ref={libRef} type="file" accept="image/*" multiple hidden onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
          {list.map((src, i) => (
            <div key={i} style={{ position: "relative", aspectRatio: "1 / 1", borderRadius: 12, overflow: "hidden", background: "repeating-linear-gradient(135deg,#F4EFE6 0 8px,#EDE5D6 8px 16px)" }}>
              <img src={src} alt={`Photo ${i + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              <button type="button" aria-label={`Remove photo ${i + 1}`} disabled={busy} onClick={() => setRemoveAt(i)} style={{ position: "absolute", top: 4, right: 4, width: 28, height: 28, border: "none", borderRadius: "50%", background: "rgba(31,29,27,.72)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 }}><X size={14} strokeWidth={2.4} /></button>
            </div>
          ))}
          <button type="button" disabled={busy || q.busy} onClick={() => libRef.current?.click()} aria-label="Add photos" style={{ aspectRatio: "1 / 1", border: "1.5px dashed #C9BFAE", borderRadius: 12, background: M.card, color: CC.brown, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, fontFamily: "inherit", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}><Plus size={20} strokeWidth={2} />Add photos</button>
        </div>
        <button type="button" disabled={busy || q.busy} onClick={() => camRef.current?.click()} style={{ justifySelf: "start", height: 36, padding: "0 4px", border: "none", background: "none", color: CC.brown, fontFamily: "inherit", fontWeight: 700, fontSize: 13, display: "inline-flex", gap: 6, alignItems: "center", cursor: "pointer" }}><Camera size={16} strokeWidth={2} />Take photo</button>
        {q.progress ? <div role="status" style={{ fontSize: 12, color: M.ink }}>Compressing {Math.min(q.progress.done + 1, q.progress.total)} of {q.progress.total}…</div> : null}
        {busy ? <div role="status" style={{ fontSize: 12, color: M.ink }}>Saving…</div> : null}
        {q.fails.map((f) => (
          <div key={f.id} role="alert" style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 8px 8px 12px", borderRadius: 12, background: CC.errBg, color: CC.chipText, fontSize: 12.5 }}>
            <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}><b>{f.file.name}</b> couldn’t be read</span>
            <button type="button" onClick={() => void q.retry(f.id).then((ok) => { if (ok.length) void persist([...list, ...ok], "Photo added · saved"); })} style={{ flex: "none", height: 30, padding: "0 10px", border: "none", borderRadius: 999, background: "#fff", color: CC.dangerDark, fontFamily: "inherit", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Retry</button>
            <button type="button" aria-label="Dismiss" onClick={() => q.dismiss(f.id)} style={{ flex: "none", width: 28, height: 28, border: "none", background: "none", color: CC.dangerDark, cursor: "pointer", padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}><X size={14} strokeWidth={2.2} /></button>
          </div>
        ))}
        {list.length === 0 ? <div style={{ ...card, textAlign: "center", fontSize: 13, color: M.ink }}>No issue photos on this case.</div> : null}
        {caption("Adding or removing a photo saves straight away. These are issue photos — Files in ⋯ are separate.")}
      </Overlay>
      <ConfirmDialog open={removeAt !== null} title="Remove this photo?" text="It is removed from the case straight away." keepLabel="Keep" goLabel="Remove" onKeep={() => setRemoveAt(null)} onGo={() => { const i = removeAt; setRemoveAt(null); if (i !== null) void persist(list.filter((_, j) => j !== i), "Photo removed · saved"); }} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Affected products + damaged parts — immediate.
type SrcItem = { id: string; productId?: string | null; productCode?: string | null; productName?: string | null; quantity?: number | null; sizeLabel?: string | null; sizeCode?: string | null; fabricCode?: string | null; gapInches?: number | null; divanHeightInches?: number | null; legHeightInches?: number | null };

function ProductsSheetInner({ onClose, c, onToast }: Common) {
  const [list, setList] = useState<CaseProduct[]>(c.affectedProducts ?? []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [partsFor, setPartsFor] = useState<string | null>(null);
  const [catalog, setCatalog] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);

  const srcUrl = (c.sourceType === "SO" || c.sourceType === "CO") && c.sourceId
    ? c.sourceType === "SO" ? `/api/sales-orders/${encodeURIComponent(c.sourceId)}` : `/api/consignment-orders/${encodeURIComponent(c.sourceId)}`
    : null;
  const { data: src } = useCachedJson<{ data?: { items?: SrcItem[] } }>(srcUrl);
  const srcItems = useMemo(() => {
    const have = new Set(list.map((p) => p.productId));
    const seen = new Set<string>();
    const out: SrcItem[] = [];
    for (const it of src?.data?.items ?? []) {
      if (!it.productId || have.has(it.productId) || seen.has(it.productId)) continue;
      seen.add(it.productId);
      out.push(it);
    }
    return out;
  }, [src, list]);
  const variantFor = (productId: string): ProductVariant | null => {
    const it = (src?.data?.items ?? []).find((x) => x.productId === productId);
    const p = list.find((x) => x.productId === productId);
    if (it) return { productCode: it.productCode ?? p?.code ?? "", sizeLabel: it.sizeLabel, sizeCode: it.sizeCode, fabricCode: it.fabricCode, gapInches: it.gapInches, divanHeightInches: it.divanHeightInches, legHeightInches: it.legHeightInches };
    return p ? { productCode: p.code } : null;
  };

  const persist = async (next: CaseProduct[], ok: string) => {
    setBusy(true); setErr("");
    const r = await putCase(c.id, { affectedProducts: next });
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Couldn’t save. Nothing changed."); return; }
    setList(next);
    onToast(ok);
  };
  const addProduct = (p: CaseProduct) => {
    if (list.some((x) => x.productId === p.productId)) return onToast("Already on this case", "error");
    void persist([...list, p], `${p.code} added · saved`);
  };
  const partsProduct = list.find((p) => p.productId === partsFor) ?? null;

  return (
    <>
      <Overlay title="Affected products" subtitle={`${c.caseNo} · Each change saves immediately`} onClose={onClose} closeLabel="Close editor" footer={<>{err ? errBox(err) : null}<button type="button" onClick={onClose} style={{ width: "100%", height: 48, border: "none", borderRadius: 12, background: M.taupe, color: "var(--m-text-on-accent)", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Done · changes already saved</button></>}>
        {list.length === 0 ? <div style={{ ...card, textAlign: "center", fontSize: 13, color: M.ink }}>No affected products recorded.</div> : null}
        {list.map((p) => (
          <div key={p.productId} style={card}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: M.raisin, overflowWrap: "anywhere" }}>{p.name || p.code}</span>
                <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: CC.brown, marginTop: 2 }}>{p.code}</span>
              </span>
              <button type="button" aria-label={`Remove ${p.code}`} disabled={busy} onClick={() => setRemoveId(p.productId)} style={{ flex: "none", width: 36, height: 36, margin: "-6px -8px 0 0", border: "none", background: "none", color: CC.hint, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Trash2 size={17} strokeWidth={2} /></button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
              <Stepper label="Affected quantity" value={p.qty ?? "—"} decDisabled={busy || (p.qty ?? 1) <= 1} incDisabled={busy} onDec={() => void persist(list.map((x) => (x.productId === p.productId ? { ...x, qty: Math.max(1, (x.qty ?? 1) - 1) } : x)), "Quantity saved")} onInc={() => void persist(list.map((x) => (x.productId === p.productId ? { ...x, qty: (x.qty ?? 0) + 1 } : x)), "Quantity saved")} />
              <button type="button" onClick={() => setPartsFor(p.productId)} disabled={busy} style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", minHeight: 36, padding: "4px 10px", border: "none", borderRadius: 10, background: M.paper, fontFamily: "inherit", textAlign: "left", cursor: "pointer", boxShadow: SH_CTRL }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".5px", color: CC.brown }}>PARTS</span>
                {p.components?.length ? p.components.map((x) => <span key={x.key} style={{ height: 20, display: "inline-flex", alignItems: "center", padding: "0 7px", borderRadius: 6, background: CC.sep, color: CC.chipText, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>{x.label}{x.qty > 1 ? ` ×${x.qty}` : ""}</span>) : <span style={{ height: 20, display: "inline-flex", alignItems: "center", padding: "0 7px", borderRadius: 6, background: CC.sep, color: CC.chipText, fontSize: 11, fontWeight: 600 }}>Whole product</span>}
              </button>
            </div>
          </div>
        ))}
        {srcItems.length > 0 ? (
          <section aria-label="Add from source order">
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1px", color: CC.brown, margin: "0 2px 10px" }}>ADD FROM SOURCE ORDER</div>
            <div style={{ background: M.card, borderRadius: 16, boxShadow: SH_CARD, overflow: "hidden" }}>
              {srcItems.map((it, i) => (
                <button key={it.productId!} type="button" disabled={busy} onClick={() => addProduct({ productId: it.productId!, code: it.productCode ?? "", name: it.productName ?? "", qty: it.quantity ?? null })} style={{ display: "flex", width: "100%", alignItems: "center", gap: 10, minHeight: 56, padding: "9px 14px", border: "none", borderTop: i ? `1px solid ${CC.sep}` : "none", background: "none", textAlign: "left", fontFamily: "inherit", cursor: "pointer" }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: M.raisin }}>{it.productName || it.productCode}</span>
                    <span style={{ display: "block", fontSize: 12, color: M.ink, marginTop: 2 }}><span style={{ fontWeight: 600, color: CC.brown }}>{it.productCode}</span> · On {c.sourceType}: {it.quantity ?? 0}</span>
                  </span>
                  <Plus size={20} strokeWidth={1.9} color={CC.brown} />
                </button>
              ))}
            </div>
          </section>
        ) : null}
        <button type="button" disabled={busy} onClick={() => setCatalog(true)} style={{ justifySelf: "start", height: 40, padding: "0 4px", border: "none", background: "none", fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: CC.brown, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}><Search size={15} strokeWidth={2.2} />Add from catalogue</button>
        {busy ? <div role="status" style={{ fontSize: 12, color: M.ink }}>Saving…</div> : null}
        {caption("Product and damaged-part changes save immediately. Parts come from the product’s BOM; none picked means the whole product.")}
      </Overlay>
      <PartsPickerSheet
        open={!!partsProduct}
        onClose={() => setPartsFor(null)}
        productLabel={partsProduct ? `${partsProduct.code} · ${partsProduct.name}` : ""}
        variant={partsFor ? variantFor(partsFor) : null}
        picks={(partsProduct?.components ?? []) as ComponentPick[]}
        onDone={(next) => void persist(list.map((x) => (x.productId === partsFor ? { ...x, components: next.length ? next : undefined } : x)), "Damaged parts saved")}
      />
      <CatalogPickerSheet open={catalog} onClose={() => setCatalog(false)} excludeIds={list.map((p) => p.productId)} onPick={(p) => addProduct({ productId: p.id, code: p.code, name: p.name, qty: null })} />
      <ConfirmDialog open={removeId !== null} title="Remove this product?" text="It and its damaged-part picks are removed from the case straight away." keepLabel="Keep" goLabel="Remove" onKeep={() => setRemoveId(null)} onGo={() => { const id = removeId; setRemoveId(null); if (id) { const p = list.find((x) => x.productId === id); void persist(list.filter((x) => x.productId !== id), `${p?.code ?? "Product"} removed · saved`); } }} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Root cause + prevention
const PROD_DEPTS = [
  ["FAB_CUT", "Fabric Cutting"], ["FAB_SEW", "Fabric Sewing"], ["WOOD_CUT", "Wood Cutting"], ["FOAM_CUTTING", "Foam Cutting"], ["FOAM", "Foam Bonding"],
  ["FIBRE", "Fibre"], ["FRAMING", "Framing"], ["WEBBING", "Webbing"], ["UPHOLSTERY", "Upholstery"], ["PACKING", "Packing"],
] as const;
const ALL_DEPTS = [...PROD_DEPTS, ["WAREHOUSING", "Warehousing"], ["REPAIR", "Repair"], ["MAINTENANCE", "Maintenance"]] as const;
type Details = Record<string, unknown>;
const sv = (d: Details, k: string) => (typeof d[k] === "string" ? (d[k] as string) : "");

function Sel({ value, onChange, placeholder, children }: { value: string; onChange: (v: string) => void; placeholder: string; children: ReactNode }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={placeholder} style={inset({ marginBottom: 8 })}>
      <option value="">{placeholder}</option>
      {children}
    </select>
  );
}
const note = (v: string, set: (v: string) => void, label: string) => (
  <div style={{ marginTop: 12 }}>{fLabel(label)}<textarea value={v} onChange={(e) => set(e.target.value)} rows={2} aria-label={label} style={inset({ height: "auto", minHeight: 64, padding: "10px 12px", lineHeight: 1.45, resize: "vertical" })} /></div>
);
const txt = (v: string, set: (v: string) => void, label: string) => (
  <div style={{ marginTop: 12 }}>{fLabel(label)}<input value={v} onChange={(e) => set(e.target.value)} aria-label={label} style={inset()} /></div>
);
const chipRow = (children: ReactNode) => <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{children}</div>;

function WorkerPick({ d, patch }: { d: Details; patch: (p: Details) => void }) {
  const { data } = useCachedJson<{ data?: Array<{ id: string; name: string; empNo?: string }> }>("/api/workers");
  const [q, setQ] = useState("");
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return (data?.data ?? []).filter((w) => w.name.toLowerCase().includes(t) || (w.empNo ?? "").toLowerCase().includes(t)).slice(0, 10);
  }, [q, data]);
  const cur = sv(d, "workerName");
  return (
    <div style={{ marginTop: 12 }}>
      {fLabel("Worker / PIC")}
      {cur ? (
        chipRow(
          <button type="button" aria-label="Clear worker" onClick={() => patch({ workerId: null, workerName: null, workerEmpNo: null })} style={{ height: 32, padding: "0 10px 0 12px", border: "none", borderRadius: 999, background: CC.brown, color: "#fff", fontFamily: "inherit", fontSize: 12, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            {cur}{sv(d, "workerEmpNo") ? ` · ${sv(d, "workerEmpNo")}` : ""}<X size={13} strokeWidth={2.4} />
          </button>,
        )
      ) : (
        <>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or employee no." aria-label="Search worker" style={inset()} />
          {hits.map((w) => (
            <button key={w.id} type="button" onClick={() => { patch({ workerId: w.id, workerName: w.name, workerEmpNo: w.empNo ?? null }); setQ(""); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 4px", minHeight: 44, border: "none", borderTop: `1px solid ${CC.sep}`, background: "none", fontFamily: "inherit", cursor: "pointer" }}>
              <b style={{ fontSize: 13.5 }}>{w.name}</b> <span style={{ color: M.ink, fontSize: 12.5 }}>{w.empNo}</span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}

function CauseFields({ category, d, onChange }: { category: string; d: Details; onChange: (d: Details) => void }) {
  const patch = (p: Details) => onChange({ ...d, ...p });
  const needsRm = category === "MATERIAL";
  const { data: rmR } = useCachedJson<{ data?: Array<{ id: string; itemCode: string; description?: string; itemGroup?: string }> }>(needsRm ? "/api/raw-materials" : null);
  const { data: supR } = useCachedJson<{ data?: Array<{ id: string; code?: string; name: string }> }>(needsRm ? "/api/suppliers" : null);
  const rmCode = sv(d, "rawMaterialCode");
  const { data: smR } = useCachedJson<{ data?: Array<{ supplierId: string }> }>(needsRm && rmCode ? `/api/supplier-materials?materialCode=${encodeURIComponent(rmCode)}` : null);
  const { data: drvR } = useCachedJson<{ data?: Array<{ id: string; name: string }> }>(category === "TRANSPORT" ? "/api/drivers" : null);

  const rms = useMemo(() => rmR?.data ?? [], [rmR]);
  const groups = useMemo(() => Array.from(new Set(rms.map((r) => r.itemGroup).filter((g): g is string => !!g))).sort(), [rms]);
  const group = sv(d, "itemGroup");
  const rmsFor = group ? rms.filter((r) => r.itemGroup === group) : rms;
  const sups = useMemo(() => {
    const all = supR?.data ?? [];
    const bound = smR?.data ?? [];
    if (!rmCode || bound.length === 0) return all;
    const ids = new Set(bound.map((b) => b.supplierId));
    return all.filter((s) => ids.has(s.id));
  }, [supR, smR, rmCode]);
  const companies = useMemo(() => Array.from(new Set((drvR?.data ?? []).map((p) => p.name).filter(Boolean))).sort(), [drvR]);

  // Departments are a fixed master list → chips (prototype); long real lists stay selects.
  const deptPick = (list: readonly (readonly [string, string])[], ck: string, nk: string, label: string) => (
    <div style={{ marginTop: 12 }}>
      {fLabel(label)}
      {chipRow(list.map(([code, name]) => <Chip key={code} label={name} on={sv(d, ck) === code} h={32} fs={12} pad={11} onClick={() => patch(sv(d, ck) === code ? { [ck]: null, [nk]: null } : { [ck]: code, [nk]: name })} />))}
    </div>
  );

  switch (category) {
    case "PRODUCTION":
      return <>{deptPick(PROD_DEPTS, "departmentCode", "departmentName", "Production department")}<WorkerPick d={d} patch={patch} />{note(sv(d, "notes"), (v) => patch({ notes: v }), "Notes")}</>;
    case "DESIGN":
      return <>{deptPick(ALL_DEPTS, "designDeptCode", "designDeptName", "Department unable to fulfil")}{note(sv(d, "notes"), (v) => patch({ notes: v }), "Notes")}{note(sv(d, "suggestedFix"), (v) => patch({ suggestedFix: v }), "Suggested fix")}</>;
    case "MATERIAL":
      return (
        <>
          <div style={{ marginTop: 12 }}>{fLabel("Item group")}<Sel value={group} placeholder="Item group — pick one" onChange={(v) => patch({ itemGroup: v || null, rawMaterialId: null, rawMaterialCode: null, supplierId: null, supplierName: null })}>{groups.map((g) => <option key={g} value={g}>{g}</option>)}</Sel></div>
          <div>{fLabel("Raw material")}<Sel value={sv(d, "rawMaterialId")} placeholder={group ? `Raw material in ${group} — pick one` : "Raw material — pick one"} onChange={(v) => { const rm = rms.find((x) => x.id === v); patch({ rawMaterialId: v || null, rawMaterialCode: rm?.itemCode ?? null, itemGroup: rm?.itemGroup ?? (group || null), supplierId: null, supplierName: null }); }}>{rmsFor.map((r) => <option key={r.id} value={r.id}>{r.itemCode}{r.description ? ` — ${r.description}` : ""}</option>)}</Sel></div>
          <div>{fLabel("Supplier")}<Sel value={sv(d, "supplierId")} placeholder={rmCode ? `Supplier of ${rmCode} — pick one` : "Supplier — pick one"} onChange={(v) => patch({ supplierId: v || null, supplierName: (supR?.data ?? []).find((x) => x.id === v)?.name ?? null })}>{sups.map((s) => <option key={s.id} value={s.id}>{s.code ? `${s.code} — ` : ""}{s.name}</option>)}</Sel></div>
          {note(sv(d, "notes"), (v) => patch({ notes: v }), "Notes / batch / GRN")}
        </>
      );
    case "PROCESS":
      return <>{deptPick(ALL_DEPTS, "departmentCode", "departmentName", "Department")}<WorkerPick d={d} patch={patch} />{txt(sv(d, "sopName"), (v) => patch({ sopName: v }), "SOP name")}{note(sv(d, "notes"), (v) => patch({ notes: v }), "Notes")}</>;
    case "CUSTOMER":
      return note(sv(d, "notes"), (v) => patch({ notes: v }), "Notes");
    case "TRANSPORT":
      return (
        <>
          <div style={{ marginTop: 12 }}>{fLabel("3PL company")}<Sel value={sv(d, "threePlCompany")} placeholder="3PL company — pick one" onChange={(v) => patch({ threePlCompany: v || null })}>{companies.map((n) => <option key={n} value={n}>{n}</option>)}</Sel></div>
          {txt(sv(d, "doNo"), (v) => patch({ doNo: v }), "DO no")}
          {txt(sv(d, "driverName"), (v) => patch({ driverName: v }), "Driver")}
          {note(sv(d, "notes"), (v) => patch({ notes: v }), "Notes")}
        </>
      );
    case "SALES":
      return <>{txt(sv(d, "salesPerson"), (v) => patch({ salesPerson: v }), "Salesperson")}{note(sv(d, "notes"), (v) => patch({ notes: v }), "Notes")}</>;
    case "PICKING":
      return <>{deptPick(ALL_DEPTS, "departmentCode", "departmentName", "Department")}<WorkerPick d={d} patch={patch} />{note(sv(d, "notes"), (v) => patch({ notes: v }), "Notes")}</>;
    default:
      return <div style={{ fontSize: 12, color: CC.hint, marginTop: 10 }}>Other has no extra fields — details go in the issue description.</div>;
  }
}

const MAX_CAUSES = 12;

function CausesSheetInner({ onClose, c, onToast }: Common) {
  const initial = useMemo<RootCause[]>(() => (c.rootCauses ?? []).map((r) => ({ category: r.category, details: { ...(r.details ?? {}) } })), [c.rootCauses]);
  const [causes, setCauses] = useState<RootCause[]>(initial);
  const [action, setAction] = useState(c.preventionAction ?? "");
  const [owner, setOwner] = useState(c.preventionOwner ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [askDiscard, setAskDiscard] = useState(false);

  const dirty = JSON.stringify(causes) !== JSON.stringify(initial) || action !== (c.preventionAction ?? "") || owner !== (c.preventionOwner ?? "");
  const close = () => (dirty && !busy ? setAskDiscard(true) : onClose());
  const save = async () => {
    setBusy(true); setErr("");
    const r = await putCase(c.id, {
      rootCauses: causes.filter((x) => x.category).map((x) => ({ category: x.category, details: x.details ?? {} })),
      preventionAction: action || null,
      preventionOwner: owner || null,
    });
    setBusy(false);
    if (!r.ok) return setErr(r.error || "Couldn’t save. Your changes are kept — try again.");
    onToast("Root cause & prevention saved");
    onClose();
  };
  return (
    <>
      <Overlay title="Root cause & prevention" subtitle={`${c.caseNo} · Save or discard when done`} onClose={close} closeLabel="Close editor" footer={<SaveBar onDiscard={close} onSave={() => void save()} busy={busy} disabled={!dirty} retry={!!err} err={err} />}>
        {causes.length === 0 ? <div style={{ ...card, textAlign: "center", fontSize: 13, color: M.ink }}>No root causes yet. Add one below.</div> : null}
        {causes.map((rc, i) => (
          <section key={i} aria-label={`Root cause ${i + 1}`} style={card}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: M.raisin }}>Root cause {i + 1}</span>
              <button type="button" aria-label={`Remove root cause ${i + 1}`} onClick={() => setCauses((l) => l.filter((_, j) => j !== i))} style={{ height: 30, padding: "0 10px", border: "none", borderRadius: 999, background: CC.errBg, color: CC.dangerDark, fontFamily: "inherit", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}><Trash2 size={13} strokeWidth={2} />Remove</button>
            </div>
            {smallLabel("CATEGORY")}
            <div role="radiogroup" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {ROOT_CAUSE_KEYS.map((k) => <Chip role="radio" key={k} label={ROOT_CAUSE_SHORT[k]} on={rc.category === k} h={32} fs={12} pad={12} onClick={() => setCauses((l) => l.map((x, j) => (j === i ? { category: k, details: x.category === k ? x.details : {} } : x)))} />)}
            </div>
            {rc.category ? <CauseFields category={rc.category} d={rc.details ?? {}} onChange={(nd) => setCauses((l) => l.map((x, j) => (j === i ? { ...x, details: nd } : x)))} /> : null}
          </section>
        ))}
        <button type="button" disabled={causes.length >= MAX_CAUSES} aria-disabled={causes.length >= MAX_CAUSES} onClick={() => setCauses((l) => [...l, { category: "PRODUCTION", details: {} }])} style={{ width: "100%", height: 46, border: "1.5px dashed #C9BFAE", borderRadius: 12, background: M.card, color: CC.brown, fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: causes.length >= MAX_CAUSES ? "default" : "pointer", opacity: causes.length >= MAX_CAUSES ? 0.5 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <Plus size={16} strokeWidth={2.2} />{causes.length >= MAX_CAUSES ? `Maximum ${MAX_CAUSES} root causes` : "Add root cause"}
        </button>
        <section aria-label="Prevention" style={card}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1px", color: CC.brown }}>PREVENTION</div>
          <div style={{ marginTop: 12 }}>{fLabel("Prevention action")}<textarea value={action} onChange={(e) => setAction(e.target.value)} rows={3} aria-label="Prevention action" style={inset({ height: "auto", minHeight: 84, padding: "10px 12px", lineHeight: 1.45, resize: "vertical" })} /></div>
          <div style={{ marginTop: 12 }}>{fLabel("Owner")}<input value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Prevention owner" style={inset()} /></div>
          {c.responsibleUnit ? <div style={{ marginTop: 12, fontSize: 12, color: M.ink }}>Responsible unit · {c.responsibleUnit} (read-only)</div> : null}
        </section>
      </Overlay>
      <ConfirmDialog open={askDiscard} {...DISCARD} onKeep={() => setAskDiscard(false)} onGo={() => { setAskDiscard(false); onClose(); }} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Action taken log
const todayMY = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
const newActId = () => `act-${Math.random().toString(36).slice(2, 8)}`;

function LogSheetInner({ onClose, c, onToast }: Common) {
  const initial = useMemo<ActionLogEntry[]>(() => (c.actionLog ?? []).map((a) => ({ ...a })), [c.actionLog]);
  const [rows, setRows] = useState<ActionLogEntry[]>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [askDiscard, setAskDiscard] = useState(false);
  const dirty = JSON.stringify(rows) !== JSON.stringify(initial);
  const close = () => (dirty && !busy ? setAskDiscard(true) : onClose());
  const save = async () => {
    setBusy(true); setErr("");
    const user = getCurrentUser();
    const out = rows
      .filter((r) => r.date || r.description.trim())
      .map((r) => ({
        ...r,
        id: r.id || newActId(),
        date: r.date || todayMY(),
        createdAt: r.createdAt || new Date().toISOString(),
        createdByName: r.createdByName || user?.displayName || user?.email || undefined,
      }));
    const res = await putCase(c.id, { actionLog: out });
    setBusy(false);
    if (!res.ok) return setErr(res.error || "Couldn’t save. Your entries are kept — try again.");
    onToast("Action log saved");
    onClose();
  };
  return (
    <>
      <Overlay title="Action taken" subtitle={`${c.caseNo} · Save or discard when done`} onClose={close} closeLabel="Close editor" footer={<SaveBar onDiscard={close} onSave={() => void save()} busy={busy} disabled={!dirty} retry={!!err} err={err} />}>
        <button type="button" onClick={() => setRows((l) => [{ date: todayMY(), description: "" }, ...l])} style={{ width: "100%", height: 46, border: "1.5px dashed #C9BFAE", borderRadius: 12, background: M.card, color: CC.brown, fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}><Plus size={16} strokeWidth={2.2} />Add entry</button>
        {rows.length === 0 ? <div style={{ ...card, textAlign: "center", fontSize: 13, color: M.ink }}>No entries yet.</div> : null}
        {rows.map((r, i) => (
          <div key={r.id ?? i} style={card}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <input type="date" value={r.date} onChange={(e) => setRows((l) => l.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))} aria-label="Date" style={inset({ flex: 1, width: "auto" })} />
              <button type="button" aria-label="Remove entry" onClick={() => setRows((l) => l.filter((_, j) => j !== i))} style={{ flex: "none", width: 40, height: 40, border: "none", background: "none", color: CC.hint, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Trash2 size={16} strokeWidth={2} /></button>
            </div>
            <textarea value={r.description} onChange={(e) => setRows((l) => l.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} rows={3} placeholder="What was done" aria-label="What was done" style={inset({ height: "auto", minHeight: 80, padding: "10px 12px", lineHeight: 1.45, resize: "vertical" })} />
          </div>
        ))}
        {caption("An editable log saved with the case — not a comment thread or audit history. Blank entries are dropped on save.")}
      </Overlay>
      <ConfirmDialog open={askDiscard} {...DISCARD} onKeep={() => setAskDiscard(false)} onGo={() => { setAskDiscard(false); onClose(); }} />
    </>
  );
}

// Each editor mounts only while open, so its draft state starts fresh from the
// latest server data every time (no reset-on-open effects).
export const IssueSheet = (p: Common) => (p.open ? <IssueSheetInner {...p} /> : null);
export const PhotosSheet = (p: Common) => (p.open ? <PhotosSheetInner {...p} /> : null);
export const ProductsSheet = (p: Common) => (p.open ? <ProductsSheetInner {...p} /> : null);
export const CausesSheet = (p: Common) => (p.open ? <CausesSheetInner {...p} /> : null);
export const LogSheet = (p: Common) => (p.open ? <LogSheetInner {...p} /> : null);

