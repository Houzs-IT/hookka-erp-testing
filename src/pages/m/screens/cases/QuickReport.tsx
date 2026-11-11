// ===========================================================================
// QuickReport — "Report an issue" (Phase 4 prototype, create flow).
// Order of fields follows the prototype: photos → related order / customer →
// "What's wrong?" → collapsible More details (products + BOM parts, root
// cause, external ref) → Open case.
//
// Behaviour is the DESKTOP CreateServiceCaseModal's, deliberately: only the
// source (SO/CO order, or a master-list customer for External) is required.
// Photos and description stay OPTIONAL — decision D-01 is NOT implemented.
// Same POST /api/service-cases body, same compressImage settings.
// ===========================================================================
import { useMemo, useRef, useState, type CSSProperties } from "react";
import { Camera, Check, ChevronDown, ChevronRight, CircleAlert, Images, Lock, Plus, Receipt, Search, User, X } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { getCurrentUser } from "@/lib/auth";
import { M } from "../../theme";
import { Sheet } from "../../components";
import { mutateJson, refreshList } from "../../config/mutate";
import { ROOT_CAUSE_KEYS, ROOT_CAUSE_SHORT, tc, type SourceType } from "./case-model";
import { Chip, IconTile, Seg, SearchField, Stepper } from "./case-ui";
import { CC, SH_CARD, SH_CTRL, SH_FIELD, fieldStyle } from "./case-style";
import { Overlay } from "./case-overlay";
import { CatalogPickerSheet, PartsPickerSheet } from "./case-pickers";
import type { ComponentPick, ProductVariant } from "./repair-components";
import { usePhotoQueue } from "./photo-queue";

type SoOpt = { id: string; customerName: string; status: string; no: string; po: string; ref: string };
type SourceItem = {
  id: string;
  productId?: string | null;
  productCode?: string | null;
  productName?: string | null;
  quantity?: number | null;
  sizeLabel?: string | null;
  sizeCode?: string | null;
  fabricCode?: string | null;
  gapInches?: number | null;
  divanHeightInches?: number | null;
  legHeightInches?: number | null;
};
type Picked = {
  productId: string;
  code: string;
  name: string;
  qty: number | null;
  max: number | null; // on-order qty (cap) — null for catalogue adds
  components?: ComponentPick[];
  variant: ProductVariant;
};
type Customer = { id: string; code: string; name: string };
export type QuickReportPreset = { sourceType: "SO" | "CO"; sourceId: string; sourceNo: string; customerName?: string };

const EXCLUDED = new Set(["DRAFT", "CANCELLED"]);

function QuickReportInner({
  open,
  onClose,
  onCreated,
  preset,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (caseId: string) => void;
  preset?: QuickReportPreset;
}) {
  const photos = usePhotoQueue();
  const camRef = useRef<HTMLInputElement>(null);
  const libRef = useRef<HTMLInputElement>(null);
  const [srcType, setSrcType] = useState<SourceType>(preset?.sourceType ?? "SO");
  const [pick, setPick] = useState<SoOpt | null>(null);
  const [extCustomer, setExtCustomer] = useState<Customer | null>(null);
  const [text, setText] = useState("");
  const [more, setMore] = useState(false);
  const [products, setProducts] = useState<Picked[]>([]);
  const [category, setCategory] = useState("");
  const [extRef, setExtRef] = useState("");
  const [sourceSheet, setSourceSheet] = useState(false);
  const [partsFor, setPartsFor] = useState<string | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [srcErr, setSrcErr] = useState(false);
  const [discard, setDiscard] = useState(false);

  const locked = !!preset;
  const sourceId = locked ? preset!.sourceId : pick?.id ?? "";
  const effType: SourceType = locked ? preset!.sourceType : srcType;

  // Source order lines (products to pick from).
  const detailUrl =
    open && sourceId && effType !== "EXTERNAL"
      ? effType === "SO"
        ? `/api/sales-orders/${encodeURIComponent(sourceId)}`
        : `/api/consignment-orders/${encodeURIComponent(sourceId)}`
      : null;
  const { data: detail, loading: itemsLoading } = useCachedJson<{ data?: { items?: SourceItem[] } }>(detailUrl);
  const lines = useMemo(() => {
    // One pickable card per product (quantities summed) — desktop's rule.
    const by = new Map<string, SourceItem>();
    let noProduct = 0;
    for (const it of detail?.data?.items ?? []) {
      if (!it.productId) { noProduct++; continue; }
      const prev = by.get(it.productId);
      if (prev) prev.quantity = (prev.quantity ?? 0) + (it.quantity ?? 0);
      else by.set(it.productId, { ...it });
    }
    return { list: [...by.values()], noProduct };
  }, [detail]);

  const dirty = photos.photos.length > 0 || text.trim() !== "" || products.length > 0 || category !== "" || extRef !== "" || (!locked && (!!pick || !!extCustomer));

  const requestClose = () => {
    if (busy) return;
    if (dirty) setDiscard(true);
    else onClose();
  };

  const toggleLine = (it: SourceItem) => {
    const id = it.productId!;
    setProducts((prev) =>
      prev.some((p) => p.productId === id)
        ? prev.filter((p) => p.productId !== id)
        : [
            ...prev,
            {
              productId: id,
              code: it.productCode ?? "",
              name: it.productName ?? "",
              qty: it.quantity ?? null,
              max: it.quantity ?? null,
              variant: {
                productCode: it.productCode ?? "",
                sizeLabel: it.sizeLabel, sizeCode: it.sizeCode, fabricCode: it.fabricCode,
                gapInches: it.gapInches, divanHeightInches: it.divanHeightInches, legHeightInches: it.legHeightInches,
              },
            },
          ],
    );
  };
  const setQty = (id: string, delta: number) =>
    setProducts((prev) => prev.map((p) => {
      if (p.productId !== id) return p;
      const next = Math.max(1, (p.qty ?? 1) + delta);
      return { ...p, qty: p.max != null ? Math.min(p.max, next) : next };
    }));

  const submit = async () => {
    if (busy) return;
    setError("");
    // Desktop validation only: the source is required. Photos / description are NOT (D-01).
    if (effType === "EXTERNAL" ? !extCustomer : !sourceId) {
      setSrcErr(true);
      setError("Choose the related order or customer.");
      return;
    }
    setBusy(true);
    const user = getCurrentUser();
    const r = await mutateJson<{ data?: { id?: string } }>("/api/service-cases", "POST", {
      sourceType: effType,
      sourceId: effType === "EXTERNAL" ? null : sourceId,
      customerId: effType === "EXTERNAL" ? extCustomer!.id : undefined,
      customerName: effType === "EXTERNAL" ? extCustomer!.name : undefined,
      externalRef: effType === "EXTERNAL" ? extRef.trim() || null : undefined,
      issueDescription: text.trim() ? text : null,
      issuePhotos: photos.photos,
      affectedProducts: products.length
        ? products.map((p) => ({
            productId: p.productId,
            code: p.code,
            name: p.name,
            qty: p.qty,
            components: p.components && p.components.length ? p.components : undefined,
          }))
        : undefined,
      rootCauseCategory: category || null,
      rootCauseNotes: null,
      createdBy: user?.id ?? null,
      createdByName: user?.displayName ?? user?.email ?? null,
    });
    setBusy(false);
    const id = r.body?.data?.id;
    if (!r.ok || !id) {
      setError(r.error || `Couldn’t open the case (HTTP ${r.status}). Everything you entered is kept — try again.`);
      return;
    }
    refreshList("/api/service-cases");
    onCreated(id);
  };

  const resultTitle = locked ? preset!.sourceNo : effType === "EXTERNAL" ? extCustomer?.name ?? "" : pick?.no ?? "";
  const resultSub = locked ? preset!.customerName ?? "" : effType === "EXTERNAL" ? extCustomer?.code ?? "" : pick ? [pick.customerName, pick.po && `PO ${pick.po}`].filter(Boolean).join(" · ") : "";
  const FieldIcon = !resultTitle ? Search : effType === "EXTERNAL" ? User : Receipt;
  const moreSummary = [
    products.length ? `${products.length} product${products.length === 1 ? "" : "s"}` : "",
    category ? ROOT_CAUSE_SHORT[category] : "",
    extRef ? "ref added" : "",
  ].filter(Boolean).join(" · ") || "products, parts, root cause";
  const lab = (t: string, size = 13) => <div style={{ fontSize: size, fontWeight: 700, color: M.raisin, margin: "0 2px 8px" }}>{t}</div>;
  const partsProduct = products.find((p) => p.productId === partsFor) ?? null;
  const prodRow = (p: Picked, removable: boolean, dueLabel: string) => (
    <div key={p.productId} style={{ borderRadius: 12, background: M.paper, boxShadow: `inset 0 0 0 1px ${CC.track}`, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "11px 12px" }}>
        <button type="button" role="checkbox" aria-checked aria-label={`Affected: ${p.name || p.code}`} onClick={() => setProducts((l) => l.filter((x) => x.productId !== p.productId))} style={{ flex: "none", width: 24, height: 24, marginTop: 1, border: "none", borderRadius: 7, background: CC.brown, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 }}><Check size={15} strokeWidth={3} /></button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: M.raisin, overflowWrap: "anywhere" }}>{p.name || p.code}</div>
          <div style={{ fontSize: 12, color: M.ink, marginTop: 2, fontVariantNumeric: "tabular-nums" }}><span style={{ fontWeight: 600, color: CC.brown }}>{p.code}</span>{dueLabel ? ` · ${dueLabel}` : ""}</div>
        </div>
        {removable ? <button type="button" aria-label={`Remove ${p.name || p.code}`} onClick={() => setProducts((l) => l.filter((x) => x.productId !== p.productId))} style={{ flex: "none", width: 32, height: 32, margin: "-4px -6px 0 0", border: "none", background: "none", color: CC.hint, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 }}><X size={16} strokeWidth={2} /></button> : null}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "0 12px 11px 48px" }}>
        <Stepper label="Affected quantity" value={p.qty ?? 1} onDec={() => setQty(p.productId, -1)} onInc={() => setQty(p.productId, 1)} decDisabled={(p.qty ?? 1) <= 1} incDisabled={p.max != null && (p.qty ?? 1) >= p.max} />
        <button type="button" onClick={() => setPartsFor(p.productId)} style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", minHeight: 36, padding: "4px 10px", border: "none", borderRadius: 10, background: M.card, fontFamily: "inherit", textAlign: "left", cursor: "pointer", boxShadow: SH_CTRL }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".5px", color: CC.brown }}>PARTS</span>
          {p.components?.length ? p.components.map((x) => <span key={x.key} style={{ height: 20, display: "inline-flex", alignItems: "center", padding: "0 7px", borderRadius: 6, background: CC.sep, color: CC.chipText, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>{x.label}{x.qty > 1 ? ` ×${x.qty}` : ""}</span>) : <span style={{ height: 20, display: "inline-flex", alignItems: "center", padding: "0 7px", borderRadius: 6, background: CC.sep, color: CC.chipText, fontSize: 11, fontWeight: 600 }}>Whole product</span>}
          <span style={{ flex: 1 }} />
          <ChevronRight size={15} strokeWidth={2} color={CC.brownSoft} />
        </button>
      </div>
    </div>
  );

  return (
    <>
      <Overlay
        title="Report an issue"
        onClose={requestClose}
        headerH={52}
        footer={
          <>
            {error ? (
              <div role="alert" style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 10, padding: "10px 12px", borderRadius: 12, background: CC.errBg, fontSize: 12.5, lineHeight: 1.45, color: CC.dangerDark }}>
                <CircleAlert size={15} strokeWidth={2} color={CC.dangerDark} style={{ flex: "none", marginTop: 1 }} /><span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{error}</span>
              </div>
            ) : null}
            <button type="button" onClick={() => void submit()} disabled={busy || photos.busy} aria-disabled={busy || photos.busy} style={{ width: "100%", height: 52, border: "none", borderRadius: 14, background: M.taupe, color: "var(--m-text-on-accent)", fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: busy || photos.busy ? "default" : "pointer", opacity: busy || photos.busy ? 0.6 : 1, boxShadow: "0 10px 22px -10px rgba(107,92,50,.7)" }}>
              {busy ? "Opening case…" : photos.busy ? "Processing photos…" : "Open case"}
            </button>
          </>
        }
      >
        <section aria-label="Photos">
          <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void photos.add(e.target.files); e.target.value = ""; }} />
          <input ref={libRef} type="file" accept="image/*" multiple hidden onChange={(e) => { void photos.add(e.target.files); e.target.value = ""; }} />
          {photos.photos.length === 0 ? (
            <button type="button" onClick={() => camRef.current?.click()} style={{ width: "100%", height: 150, border: "1.5px dashed #E2DDD8", borderRadius: 18, background: M.card, fontFamily: "inherit", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: CC.brown }}>
              <span style={{ width: 56, height: 56, borderRadius: "50%", background: CC.brown, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 10px 22px -10px rgba(107,92,50,.8)" }}><Camera size={26} strokeWidth={1.9} /></span>
              <span style={{ fontSize: 15, fontWeight: 700, color: M.raisin }}>Take photo</span>
            </button>
          ) : (
            <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: 2, scrollbarWidth: "none" }}>
              {photos.photos.map((src, i) => (
                <div key={i} style={{ position: "relative", flex: "none", width: 88, height: 88, borderRadius: 14, overflow: "hidden", background: "repeating-linear-gradient(135deg,#F4EFE6 0 8px,#EDE5D6 8px 16px)" }}>
                  <img src={src} alt={`Photo ${i + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  <button type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => photos.remove(i)} style={{ position: "absolute", top: 4, right: 4, width: 26, height: 26, border: "none", borderRadius: "50%", background: "rgba(31,29,27,.72)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 }}><X size={13} strokeWidth={2.4} /></button>
                </div>
              ))}
              <button type="button" onClick={() => camRef.current?.click()} aria-label="Take another photo" style={{ flex: "none", width: 88, height: 88, border: "1.5px dashed #C9BFAE", borderRadius: 14, background: M.card, color: CC.brown, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, fontFamily: "inherit", fontSize: 11.5, fontWeight: 700 }}><Camera size={20} strokeWidth={1.9} />Add</button>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "center", marginTop: 8 }}>
            <button type="button" onClick={() => libRef.current?.click()} style={{ height: 34, padding: "0 10px", border: "none", background: "none", fontFamily: "inherit", fontSize: 13, fontWeight: 600, color: CC.brown, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}><Images size={15} strokeWidth={2} />Choose from library</button>
          </div>
          {photos.progress ? (
            <>
              <div role="status" aria-live="polite" style={{ height: 4, marginTop: 4, borderRadius: 999, background: "#E6E0D9", overflow: "hidden" }}><div style={{ height: "100%", width: `${(photos.progress.done / photos.progress.total) * 100}%`, background: CC.brown, transition: "width .3s ease" }} /></div>
              <div style={{ fontSize: 11.5, color: M.ink, textAlign: "center", marginTop: 5 }}>Compressing {Math.min(photos.progress.done + 1, photos.progress.total)} of {photos.progress.total}…</div>
            </>
          ) : null}
          {photos.fails.map((f) => (
            <div key={f.id} role="alert" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, padding: "8px 8px 8px 12px", borderRadius: 12, background: CC.errBg, fontSize: 12.5, color: CC.chipText }}>
              <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}><b>{f.file.name}</b> couldn’t be read</span>
              <button type="button" onClick={() => void photos.retry(f.id)} style={{ flex: "none", height: 30, padding: "0 10px", border: "none", borderRadius: 999, background: "#fff", color: CC.dangerDark, fontFamily: "inherit", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Retry</button>
              <button type="button" onClick={() => photos.dismiss(f.id)} aria-label="Dismiss" style={{ flex: "none", width: 28, height: 28, border: "none", background: "none", color: CC.dangerDark, cursor: "pointer", padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}><X size={14} strokeWidth={2.2} /></button>
            </div>
          ))}
        </section>

        <section aria-label="Related order or customer">
          {lab("Related order or customer")}
          <button type="button" onClick={() => !locked && setSourceSheet(true)} aria-haspopup="dialog" style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, minHeight: 56, padding: "9px 14px", border: "none", borderRadius: 14, background: M.card, fontFamily: "inherit", textAlign: "left", cursor: locked ? "default" : "pointer", boxShadow: srcErr ? "0 0 0 1.5px #C0574A" : SH_FIELD }}>
            <IconTile icon={FieldIcon} size={32} r={10} iconSize={16} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 14, fontWeight: resultTitle ? 700 : 500, color: resultTitle ? M.raisin : CC.hint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontVariantNumeric: "tabular-nums" }}>{resultTitle || "Choose order or customer"}</span>
              {resultSub ? <span style={{ display: "block", fontSize: 12.5, color: M.ink, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{resultSub}</span> : null}
            </span>
            {locked ? <Lock size={15} strokeWidth={2} color={CC.hint} /> : <ChevronRight size={18} strokeWidth={2} color={CC.brownSoft} />}
          </button>
          {srcErr ? <div role="alert" style={{ fontSize: 12.5, color: CC.dangerDark, margin: "7px 2px 0" }}>Choose the related order or customer.</div> : null}
        </section>

        <label style={{ display: "block" }}>
          <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: M.raisin, margin: "0 2px 8px" }}>What’s wrong? <span style={{ fontWeight: 500, color: CC.hint }}>or add a photo</span></span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} aria-label="Issue description" placeholder="e.g. Seam split on seat cushion" style={fieldStyle({ padding: "12px 13px", lineHeight: 1.5, resize: "vertical" })} />
        </label>

        <section aria-label="More details">
          <button type="button" onClick={() => setMore((v) => !v)} aria-expanded={more} style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, minHeight: 44, padding: "0 2px", border: "none", background: "none", fontFamily: "inherit", textAlign: "left", cursor: "pointer" }}>
            <span style={{ flex: 1, minWidth: 0 }}><span style={{ fontSize: 13.5, fontWeight: 700, color: CC.brown }}>More details</span><span style={{ fontSize: 12.5, color: CC.hint }}> · {moreSummary}</span></span>
            <span style={{ display: "flex", transform: more ? "rotate(180deg)" : "none", color: CC.brown }}><ChevronDown size={18} strokeWidth={2} /></span>
          </button>
          {more ? (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 16, marginTop: 8 }}>
              <div>
                {lab("Affected products & damaged parts", 12.5)}
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 8 }}>
                  {effType !== "EXTERNAL" && !sourceId ? <div style={{ fontSize: 12.5, color: CC.hint, padding: "0 2px" }}>Pick the related order first to see its products.</div> : null}
                  {effType !== "EXTERNAL" && sourceId && itemsLoading && !detail ? (
                    <div aria-busy="true" style={{ display: "grid", gap: 8 }}><div style={{ height: 64, borderRadius: 12, background: "#EFEAE1" }} /><div style={{ height: 64, borderRadius: 12, background: "#EFEAE1" }} /></div>
                  ) : null}
                  {effType !== "EXTERNAL" && sourceId && detail && lines.list.length === 0 ? <div style={{ fontSize: 12.5, color: CC.hint, padding: "0 2px" }}>This order has no products to pick.</div> : null}
                  {effType === "EXTERNAL" && products.length === 0 ? <div style={{ fontSize: 12.5, color: CC.hint, padding: "0 2px" }}>No products added yet.</div> : null}
                  {effType !== "EXTERNAL"
                    ? lines.list.map((it) => {
                        const sel = products.find((p) => p.productId === it.productId);
                        return sel ? prodRow(sel, false, `On order: ${it.quantity ?? 0}`) : (
                          <div key={it.productId!} style={{ borderRadius: 12, background: M.paper, boxShadow: `inset 0 0 0 1px ${CC.track}` }}>
                            <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "11px 12px" }}>
                              <button type="button" role="checkbox" aria-checked={false} aria-label={`Affected: ${it.productName || it.productCode}`} onClick={() => toggleLine(it)} style={{ flex: "none", width: 24, height: 24, marginTop: 1, border: "none", borderRadius: 7, background: M.card, boxShadow: "inset 0 0 0 1.5px #C9BFAE", cursor: "pointer", padding: 0 }} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 13.5, fontWeight: 700, color: M.raisin, overflowWrap: "anywhere" }}>{it.productName || it.productCode}</div>
                                <div style={{ fontSize: 12, color: M.ink, marginTop: 2, fontVariantNumeric: "tabular-nums" }}><span style={{ fontWeight: 600, color: CC.brown }}>{it.productCode}</span> · On order: {it.quantity ?? 0}</div>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    : products.map((p) => prodRow(p, true, ""))}
                  {effType !== "EXTERNAL" && sourceId && lines.noProduct > 0 ? <div style={{ fontSize: 11.5, color: CC.hint, padding: "0 2px" }}>{lines.noProduct} line{lines.noProduct === 1 ? "" : "s"} without a product (e.g. delivery charge) can’t be picked. Repeated lines of the same product are combined.</div> : null}
                  {effType === "EXTERNAL" ? (
                    <button type="button" onClick={() => setCatalogOpen(true)} style={{ height: 40, padding: "0 4px", border: "none", background: "none", fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: CC.brown, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, justifySelf: "start" }}><Plus size={15} strokeWidth={2.2} />Add from catalogue</button>
                  ) : null}
                </div>
              </div>
              <div>
                {lab("Root-cause category", 12.5)}
                <div role="radiogroup" style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                  {ROOT_CAUSE_KEYS.map((k) => <Chip role="radio" key={k} label={ROOT_CAUSE_SHORT[k]} on={category === k} onClick={() => setCategory(category === k ? "" : k)} />)}
                </div>
              </div>
              {effType === "EXTERNAL" ? (
                <label style={{ display: "block" }}>
                  <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: M.raisin, margin: "0 2px 8px" }}>External reference</span>
                  <input value={extRef} onChange={(e) => setExtRef(e.target.value)} placeholder="e.g. WhatsApp 30/10, walk-in" aria-label="External reference" style={fieldStyle({ height: 44, padding: "0 13px", borderRadius: 12 })} />
                </label>
              ) : null}
            </div>
          ) : null}
        </section>
      </Overlay>

      <SourceSheet
        open={sourceSheet}
        onClose={() => setSourceSheet(false)}
        type={srcType}
        selectedId={sourceId}
        onType={(t) => { setSrcType(t); setPick(null); setExtCustomer(null); setProducts([]); }}
        onPickOrder={(o) => { if (o.id !== pick?.id) setProducts([]); setPick(o); setSrcErr(false); setError(""); setSourceSheet(false); }}
        onPickCustomer={(c) => { setExtCustomer(c); setSrcErr(false); setError(""); setSourceSheet(false); }}
      />
      <PartsPickerSheet
        open={!!partsProduct}
        onClose={() => setPartsFor(null)}
        productLabel={partsProduct ? `${partsProduct.code} · ${partsProduct.name}` : ""}
        variant={partsProduct?.variant ?? null}
        picks={partsProduct?.components ?? []}
        onDone={(next) => setProducts((l) => l.map((p) => (p.productId === partsFor ? { ...p, components: next.length ? next : undefined } : p)))}
      />
      <CatalogPickerSheet
        open={catalogOpen}
        onClose={() => setCatalogOpen(false)}
        excludeIds={products.map((p) => p.productId)}
        onPick={(p) => setProducts((l) => [...l, { productId: p.id, code: p.code, name: p.name, qty: 1, max: null, variant: { productCode: p.code } }])}
      />
      <Sheet open={discard} onClose={() => setDiscard(false)} title="Discard this new case?">
        <div style={{ fontSize: 13, lineHeight: 1.5, color: M.ink, marginTop: -4 }}>What you’ve entered will be lost.</div>
        <div style={{ display: "flex", gap: 10, margin: "16px 0 8px" }}>
          <button type="button" onClick={() => setDiscard(false)} style={{ flex: 1, height: 44, border: "none", borderRadius: 12, background: CC.tile, color: CC.brown, fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Keep editing</button>
          <button type="button" onClick={() => { setDiscard(false); onClose(); }} style={{ flex: 1, height: 44, border: "none", borderRadius: 12, background: CC.dangerDark, color: "#fff", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Discard</button>
        </div>
      </Sheet>
    </>
  );
}

// ---------------------------------------------------------------------------
function SourceSheet({
  open, onClose, type, selectedId, onType, onPickOrder, onPickCustomer,
}: {
  open: boolean;
  onClose: () => void;
  type: SourceType;
  onType: (t: SourceType) => void;
  selectedId: string;
  onPickOrder: (o: SoOpt) => void;
  onPickCustomer: (c: Customer) => void;
}) {
  const [q, setQ] = useState("");
  const { data: so, loading: soL, error: soE } = useCachedJson<{ data?: Array<Record<string, unknown>> }>(open && type === "SO" ? "/api/sales-orders" : null);
  const { data: co, loading: coL, error: coE } = useCachedJson<{ data?: Array<Record<string, unknown>> }>(open && type === "CO" ? "/api/consignment-orders" : null);
  const { data: cu, loading: cuL, error: cuE } = useCachedJson<{ data?: Customer[] }>(open && type === "EXTERNAL" ? "/api/customers" : null);
  const s = (r: Record<string, unknown>, ...k: string[]) => { for (const x of k) { const v = r[x]; if (typeof v === "string" && v) return v; } return ""; };

  const orders = useMemo<SoOpt[]>(() => {
    const list = type === "SO" ? so?.data : type === "CO" ? co?.data : [];
    const t = q.trim().toLowerCase();
    return (list ?? [])
      .filter((r) => !EXCLUDED.has(s(r, "status")))
      .map((r) => ({
        id: s(r, "id"),
        customerName: s(r, "customerName"),
        status: s(r, "status"),
        no: type === "SO" ? s(r, "companySOId") : s(r, "companyCOId"),
        po: type === "SO" ? s(r, "customerPOId", "customerPO") : s(r, "customerCOId", "customerCO"),
        ref: s(r, "reference"),
        so2: type === "SO" ? s(r, "customerSOId", "customerSO") : "",
      }))
      .filter((r) => !t || `${r.no} ${r.customerName} ${r.po} ${r.so2} ${r.ref}`.toLowerCase().includes(t))
      .slice(0, 15);
  }, [type, so, co, q]);

  const customers = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return (cu?.data ?? []).filter((c) => c.code.toLowerCase().includes(t) || c.name.toLowerCase().includes(t)).slice(0, 10);
  }, [cu, q]);

  const loading = type === "SO" ? soL && !so : type === "CO" ? coL && !co : cuL && !cu;
  const failed = type === "SO" ? soE && !so : type === "CO" ? coE && !co : cuE && !cu;

  return (
    <Sheet open={open} onClose={onClose} title="Related order or customer">
      <div style={{ display: "grid", gap: 10, paddingBottom: 10 }}>
        <Seg<SourceType> label="Source type" value={type} onChange={(t) => { onType(t); setQ(""); }} options={[["SO", "Sales order"], ["CO", "Consignment"], ["EXTERNAL", "External"]]} />
        <SearchField value={q} onChange={setQ} placeholder={type === "EXTERNAL" ? "Search customer name or code" : "Order no, customer, PO or reference"} />
        <div style={{ fontSize: 11.5, color: CC.hint, padding: "0 2px" }}>{type === "EXTERNAL" ? "Pick a real customer record · first 10 matches" : "Draft and cancelled orders aren’t listed · first 15 matches"}</div>
      </div>
      {failed ? (
        <div role="alert" style={{ padding: "18px 12px", textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: M.raisin }}>Couldn’t load the list</div>
          <div style={{ fontSize: 12.5, color: M.ink, marginTop: 4 }}>Your photos and notes are kept. Close this list and open it again to retry.</div>
        </div>
      ) : loading ? (
        <div style={{ padding: "18px 12px", textAlign: "center", fontSize: 13, color: M.ink }}>Loading…</div>
      ) : type === "EXTERNAL" ? (
        !q.trim() ? <div role="status" style={{ padding: "18px 12px", textAlign: "center", fontSize: 13, color: M.ink }}>Type to search customers.</div>
        : customers.length === 0 ? <div role="status" style={{ padding: "18px 12px", textAlign: "center", fontSize: 13, color: M.ink }}>No customers match “{q}”.</div>
        : <div role="radiogroup" style={{ background: M.card, borderRadius: 16, overflow: "hidden", boxShadow: SH_CARD, marginBottom: 12 }}>
            {customers.map((c, i) => (
              <button key={c.id} type="button" role="radio" aria-checked={false} onClick={() => onPickCustomer(c)} style={resultRow(i)}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: M.raisin }}>{c.name}</span>
                  <span style={{ display: "block", fontSize: 12.5, color: M.ink, marginTop: 2 }}>{c.code}</span>
                </span>
              </button>
            ))}
          </div>
      ) : orders.length === 0 ? (
        <div role="status" style={{ padding: "18px 12px", textAlign: "center", fontSize: 13, color: M.ink }}>{q ? `No orders match “${q}”.` : "No open orders to show."}</div>
      ) : (
        <div role="radiogroup" style={{ background: M.card, borderRadius: 16, overflow: "hidden", boxShadow: SH_CARD, marginBottom: 12 }}>
          {orders.map((o, i) => (
            <button key={o.id} type="button" role="radio" aria-checked={o.id === selectedId} onClick={() => onPickOrder(o)} style={resultRow(i, o.id === selectedId)}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <span style={{ minWidth: 0, fontSize: 13.5, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontVariantNumeric: "tabular-nums" }}>{o.no || o.id}</span>
                  <span style={{ flex: "none", fontSize: 11, color: CC.hint }}>{tc(o.status)}</span>
                </span>
                <span style={{ display: "block", fontSize: 12.5, color: M.ink, marginTop: 2, overflowWrap: "anywhere" }}>{o.customerName}</span>
                {o.po || o.ref ? <span style={{ display: "block", fontSize: 12, color: CC.hint, marginTop: 1 }}>{[o.po && `PO ${o.po}`, o.ref].filter(Boolean).join(" · ")}</span> : null}
              </span>
              {o.id === selectedId ? <Check size={18} strokeWidth={2.4} color={CC.brown} /> : null}
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}

const resultRow = (i: number, on?: boolean): CSSProperties => ({ width: "100%", display: "flex", alignItems: "center", gap: 10, minHeight: 58, padding: "9px 14px", border: "none", borderTop: i ? `1px solid ${CC.sep}` : "none", background: on ? "#FBF7EE" : "none", fontFamily: "inherit", textAlign: "left", cursor: "pointer" });

// Mounted only while open → every opening starts from a clean form.
export function QuickReport(p: { open: boolean; onClose: () => void; onCreated: (caseId: string) => void; preset?: QuickReportPreset }) {
  return p.open ? <QuickReportInner {...p} /> : null;
}
