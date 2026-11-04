// Scan a supplier delivery document → editable review and matching → DRAFT Goods Receipt (Home "Scan to Create",
// Goods Receipt tile). The Purchase Invoice scanner's flow (ScanPiSheet) with the receipt's own fields:
//   file → the scan queue (useScanQueue; kind=supplier) → rawJson.docs[] → card (lib/scan-grn.ts, which reuses the PI
//   matching: supplier, bindings, PO links; each line also draws down ONE purchase-order line) → review → POST /api/grn
//   with ocrUsed:true, which the server saves as a DRAFT. Nothing is posted to stock by a scan.
// The original document is attached AFTER the receipt exists, as a plain file on the receipt (resourceType GRN): the GRN
// has no source-document column and the create endpoint takes no file, so unlike the invoice it cannot be linked at
// create. That step is tracked (lib/scan-doc-recovery.ts), is safe to repeat (it first looks for the same file already
// on the receipt) and a failed attach never undoes the receipt. The create carries an Idempotency-Key reused for a retry
// of the same body, and the server refuses a second receipt with the same supplier DO number, so neither a dropped
// connection nor a second scan makes another GRN.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Camera, ChevronDown, ChevronRight, CircleCheck, FileImage, FileText, FileWarning, Info, Plus, Trash2, TriangleAlert, Upload } from "lucide-react";
import { usePermissions } from "@/lib/use-permission";
import { teachPartyAlias } from "@/lib/party-alias-client";
import { postScanQueueConsume } from "@/lib/scan-queue-client";
import { M, M_ACCENT } from "../../theme";
import { mutateJson, refreshList } from "../../config/mutate";
import { idempotencyKeyFor, type IdemStore } from "../../lib/scan-so";
import { FOLLOW_ORDER, failedKeys, hasOpenFollowUps, runFollowUps } from "../../lib/scan-so-recovery";
import { DOC_FOLLOW_LABEL, loadDocs, newDocRecord, saveDocs, sameScanDoc, upsertDoc, type DocRecord } from "../../lib/scan-doc-recovery";
import { docsOfRow, matchTierHint, openPosFor, todayIso, type PiContext, type SupplierDoc } from "../../lib/scan-pi";
import {
  buildGrnCard, grnBlockers, grnChangeSupplier, grnCorrected, grnDraftBody, grnPickMaterial, grnRelink, newGrnLine, overReceiptNotes, setReceived, setRejected,
  type GrnCard, type GrnLine,
} from "../../lib/scan-grn";
import { SheetFrame } from "../dashboard/home-ui";
import { Field, Tag } from "../so/so-ui";
import { card, ghost, input, miniLabel, primary, sectionLabel } from "../so/so-style";
import { useScanQueue } from "../scan/useScanQueue";
import { loadSupplierContext } from "../scan/loadSupplierContext";
import { num, safeStore } from "../scan/scan-fmt";
import { attachOriginalOnce } from "../scan/attach-once";
import { MaterialPicker, Mini, SourceButton } from "./ScanPiSheet";

type Step = "pick" | "scanning" | "fail" | "choose" | "review" | "done";
type Found = { doc: SupplierDoc; docIdx: number };
type Saved = { id: string; grnNo: string; po: boolean };

const EMPTY_CTX: PiContext = { suppliers: [], materials: [], bindings: [], purchaseOrders: [], orgs: [], aliases: {} };

export function ScanGrnSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const [step, setStep] = useState<Step>("pick");
  const [ctx, setCtx] = useState<PiContext>(EMPTY_CTX);
  const ctxRef = useRef<PiContext>(EMPTY_CTX);
  const prepRef = useRef<Promise<string | null> | null>(null);
  const [found, setFound] = useState<Found[]>([]);
  const [current, setCurrent] = useState<Found | null>(null);
  const [cardState, setCardState] = useState<GrnCard | null>(null);
  const [records, setRecords] = useState<DocRecord[]>(() => loadDocs(safeStore(), "GRN"));
  const [srcOpen, setSrcOpen] = useState(false);
  const [queueSrc, setQueueSrc] = useState<{ url: string; image: boolean } | null>(null);
  const [pickLine, setPickLine] = useState<string | null>(null);
  const [posOpen, setPosOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState("");
  const [saved, setSaved] = useState<Saved | null>(null);
  const [rec, setRec] = useState<DocRecord | null>(null);
  const [following, setFollowing] = useState(false);
  const idemRef = useRef<IdemStore>({ body: null, key: null });
  const camRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const saveRecords = (next: DocRecord[]) => { saveDocs(safeStore(), "GRN", next); setRecords(next); };

  const prepare = (): Promise<string | null> => {
    if (!prepRef.current) {
      prepRef.current = (async () => {
        const { ctx: next, error } = await loadSupplierContext(hasPermission("purchase-orders", "read"));
        if (!next) return error;
        ctxRef.current = next;
        setCtx(next);
        return null;
      })();
    }
    return prepRef.current;
  };

  const q = useScanQueue<SupplierDoc>({
    kind: "delivery document",
    queueKind: "supplier",
    docKind: "GRN",
    docsOf: docsOfRow,
    placeholder: (r) => ({ docNo: r.ref, lines: [{ description: r.ref }] }),
    records,
    allowHeic: true,
    prepare,
    onRead: (rawJson) => {
      const list = docsOfRow(rawJson);
      if (list.length === 0) return "No lines were found in this file.";
      setFound(list);
      if (list.length === 1) openDoc(list[0]);
      else setStep("choose");
      return null;
    },
  });

  useEffect(() => { void prepare(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!srcOpen || q.file || !q.row.id || queueSrc) return;
    let live = true;
    fetch(`/api/scan-queue/${encodeURIComponent(q.row.id)}/bytes`, { credentials: "include" })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => { if (live && b && b.size) setQueueSrc({ url: URL.createObjectURL(b), image: b.type.startsWith("image/") }); })
      .catch(() => {});
    return () => { live = false; };
  }, [srcOpen, q.file, q.row.id, queueSrc]);
  useEffect(() => () => { if (queueSrc) URL.revokeObjectURL(queueSrc.url); }, [queueSrc]);
  const fileUrl = useMemo(() => (q.file ? URL.createObjectURL(q.file) : null), [q.file]);
  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl); }, [fileUrl]);

  const openDoc = (f: Found) => {
    setCurrent(f);
    setCardState(buildGrnCard(f.doc, ctxRef.current, { today: todayIso() }));
    setCreateError("");
    setSrcOpen(false);
    setRec(null);
    idemRef.current = { body: null, key: null };
    setStep("review");
  };

  const phaseStep: Step = q.phase === "scanning" ? "scanning" : q.phase === "failed" ? "fail" : step;
  const shown: Step = phaseStep === "pick" && q.phase === "idle" ? step : phaseStep;

  const madeFor = (docIdx: number) => records.find((r) => sameScanDoc(r, "GRN", q.row.id, docIdx)) ?? null;
  const patch = (p: Partial<GrnCard>) => setCardState((c) => (c ? { ...c, ...p } : c));
  const patchLine = (key: string, fn: (l: GrnLine) => GrnLine) => setCardState((c) => (c ? { ...c, lines: c.lines.map((l) => (l.key === key ? fn(l) : l)) } : c));

  const reset = () => {
    q.reset();
    setFound([]); setCurrent(null); setCardState(null); setSaved(null); setRec(null); setQueueSrc(null); setCreateError(""); setBusy(false);
    setStep("pick");
  };

  // ---- the steps after the receipt exists ----------------------------------------------------------------------
  const finishFollowUps = async (r: DocRecord) => {
    setFollowing(true);
    const next = await runFollowUps(r, {
      original: () => attachOriginalOnce(q.file ? { kind: "file", file: q.file } : r.rowId ? { kind: "queue", rowId: r.rowId } : null, "GRN", r.docId, q.file?.name ?? q.row.fileName),
      sample: async () => {
        try {
          const res = await fetch(`/api/scan-supplier/samples/${encodeURIComponent(r.sampleId ?? "")}/confirm`, {
            method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
            body: JSON.stringify({ correctedJson: r.corrected, gold: false }),
          });
          if (!res.ok) console.warn(`[scan-supplier] accuracy sample not recorded (${res.status})`);
          return res.ok;
        } catch {
          return false;
        }
      },
      consume: async () => (await postScanQueueConsume(r.rowId, r.docIdx)).ok,
    });
    saveRecords(upsertDoc(records.filter((x) => !sameScanDoc(x, r.kind, r.rowId, r.docIdx)), next));
    setRec(next);
    setFollowing(false);
  };

  const openFinish = (r: DocRecord) => {
    setRec(r);
    setSaved({ id: r.docId, grnNo: r.docNo, po: false });
    setStep("done");
  };

  // ---- create ---------------------------------------------------------------------------------------------------
  const createReceipt = async () => {
    const c = cardState;
    const cur = current;
    if (!c || !cur || busy) return;
    const stops = grnBlockers(c, ctxRef.current);
    if (stops.length) { setCreateError(stops[0]); return; }
    setBusy(true);
    setCreateError("");
    const body = grnDraftBody(c, ctxRef.current, q.row.fileName || q.file?.name || "scan");
    const key = idempotencyKeyFor(idemRef.current, body, () => crypto.randomUUID());
    const res = await mutateJson<{ data?: { id?: string; grnNumber?: string } }>("/api/grn", "POST", body, { "Idempotency-Key": key });
    if (!res.ok) {
      setBusy(false);
      setCreateError(res.error || "The receipt could not be created.");
      return;
    }
    const data = res.body?.data;
    if (!data?.id || !data.grnNumber) {
      setBusy(false);
      setCreateError("The server did not confirm the new receipt. Check Goods Receipts before trying again.");
      return;
    }
    refreshList("/api/grn", "/api/purchase-orders");
    void teachPartyAlias({ partyType: "SUPPLIER", partyId: c.supplierId, rawName: cur.doc.supplierName, knownMap: ctxRef.current.aliases });
    const record = newDocRecord({
      kind: "GRN", rowId: q.row.id, docIdx: cur.docIdx, docId: data.id, docNo: data.grnNumber, ref: c.supplierDoNo.trim(),
      sampleId: q.row.sampleId, corrected: grnCorrected(c, cur.doc), needsOriginal: true,
    });
    saveRecords(upsertDoc(records, record));
    setRec(record);
    setSaved({ id: data.id, grnNo: data.grnNumber, po: !!body.poId });
    setBusy(false);
    setStep("done");
    void finishFollowUps(record);
  };

  const resumeReady = async (v: NonNullable<typeof q.views>[number]) => {
    q.setFile(null);
    setQueueSrc(null);
    q.setRow({ id: v.rowId, sampleId: v.sampleId, fileName: v.fileName });
    const err = await prepare();
    if (err) { setCreateError(err); return; }
    const list = v.docs.map(({ doc, docIdx }) => ({ doc, docIdx }));
    setFound(list);
    if (list.length === 1) {
      const m = v.docs[0].made;
      if (m) openFinish(m);
      else openDoc(list[0]);
    } else setStep("choose");
  };

  const onFile = (f: File | undefined) => { if (f) void q.start(f); };

  const c = cardState;
  const stops = c ? grnBlockers(c, ctx) : [];
  const overs = c ? overReceiptNotes(c, ctx) : [];
  const supplierPos = c ? openPosFor(c.supplierId, ctx) : [];
  const back = shown === "review" ? () => (found.length > 1 ? setStep("choose") : reset()) : shown === "choose" || shown === "fail" ? reset : undefined;
  const srcImage = q.file ? q.file.type.startsWith("image/") : queueSrc?.image ?? false;
  const srcHref = q.file ? fileUrl : queueSrc?.url ?? null;
  const srcName = q.file?.name ?? q.row.fileName;

  return (
    <SheetFrame open={open} title="Scan Goods Receipt" sub={shown === "pick" ? "Prepares a draft Goods Receipt" : undefined} onBack={back} onClose={onClose}>
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />

      {shown === "pick" ? (
        <div>
          <div style={{ display: "grid", gap: 10 }}>
            <SourceButton label="Take photo" desc="Use the camera to capture the delivery order" icon={Camera} onClick={() => camRef.current?.click()} />
            <SourceButton label="Upload image or PDF" desc="Choose a photo or PDF from this device" icon={Upload} onClick={() => fileRef.current?.click()} />
          </div>
          {q.views && q.views.length > 0 ? (
            <div style={{ marginTop: 14 }}>
              <div style={sectionLabel}>UNFINISHED SCANS</div>
              <div style={{ ...card, padding: "0 14px", marginTop: 8 }}>
                {q.views.map((v, i) => {
                  const finishOnly = v.state === "ready" && v.docs.every((d) => d.made);
                  return (
                    <div key={`${v.rowId}-${i}`} style={{ padding: "10px 0", borderTop: i ? `1px solid ${M.divider}` : "none" }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: M.raisin, overflowWrap: "anywhere" }}>{v.fileName}</div>
                      <div style={{ fontSize: 12, color: M.ink, marginTop: 2, lineHeight: 1.4, overflowWrap: "anywhere" }}>
                        {v.state === "ready"
                          ? finishOnly ? "A draft receipt was saved; a step after it did not finish."
                            : `${v.docs.length} document${v.docs.length === 1 ? "" : "s"} ready to review. This is already read, so no new scan is needed.`
                          : v.state === "reading" ? "Still being read."
                            : `Could not be read${v.error ? ` (${v.error.slice(0, 80)})` : ""}.`}
                      </div>
                      {v.state === "ready" ? (
                        <button type="button" onClick={() => void resumeReady(v)} style={{ ...primary, height: 38, padding: "0 16px", marginTop: 8 }}>{finishOnly ? "Finish saving" : "Review"}</button>
                      ) : v.solo ? (
                        <>
                          <button type="button" onClick={() => void q.continueReading(v)} style={{ ...ghost, height: 38, padding: "0 16px", marginTop: 8 }}>{v.state === "failed" ? "Retry reading" : "Continue reading"}</button>
                          <div style={{ fontSize: 11, color: M.muted, marginTop: 4 }}>Starts one more read of this file.</div>
                        </>
                      ) : <div style={{ fontSize: 11, color: M.muted, marginTop: 6 }}>Part of a larger batch. Continue it on the desktop.</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 12, padding: "10px 12px", borderRadius: 12, backgroundColor: M.divider, fontSize: 12, lineHeight: 1.45, color: M.ink }}>
            <Info size={14} strokeWidth={2} color={M.taupe} style={{ flex: "none", marginTop: 1 }} aria-hidden="true" />
            <span>Scanning only prepares an editable draft. Nothing goes into stock until you post the receipt, and only once the goods are marked arrived. A PDF or a photo, up to 32 MB.</span>
          </div>
        </div>
      ) : null}

      {shown === "scanning" ? (
        <div role="status" aria-live="polite" style={{ ...card, padding: "22px 16px", textAlign: "center" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 10, backgroundColor: M.paper, fontSize: 12.5, color: M.raisin, maxWidth: "100%" }}>
            <FileText size={15} strokeWidth={2} color={M.taupe} aria-hidden="true" />
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{srcName}</span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: M.raisin, marginTop: 16 }}>Reading the document…</div>
          <div style={{ fontSize: 12, color: M.ink, marginTop: 4 }}>{q.slow ? "Taking longer than usual. You can keep waiting or cancel." : "This usually takes under a minute."}</div>
          <button type="button" onClick={reset} style={{ ...ghost, height: 40, padding: "0 18px", marginTop: 16 }}>Cancel</button>
        </div>
      ) : null}

      {shown === "fail" ? (
        <div role="alert" style={{ ...card, padding: "22px 16px", textAlign: "center" }}>
          <div style={{ width: 46, height: 46, margin: "0 auto", borderRadius: "50%", backgroundColor: M_ACCENT.danger.bg, display: "flex", alignItems: "center", justifyContent: "center" }}><FileWarning size={22} strokeWidth={1.9} color={M_ACCENT.danger.fg} aria-hidden="true" /></div>
          <div style={{ fontSize: 15, fontWeight: 700, color: M.raisin, marginTop: 12 }}>Couldn’t read this document</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, color: M.ink, marginTop: 4, overflowWrap: "anywhere" }}>{q.failText || "The image may be blurred, cropped or too dark."} Try again, or choose a clearer file.</div>
          <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
            {q.file ? <button type="button" onClick={() => void q.start(q.file as File)} style={primary}>Retry</button> : null}
            <button type="button" onClick={reset} style={ghost}>Choose another file</button>
          </div>
        </div>
      ) : null}

      {shown === "choose" ? (
        <div>
          <div style={{ fontSize: 12.5, color: M.ink, lineHeight: 1.5 }}>{found.length} documents were found in this file. Review and create them one at a time.</div>
          <div style={{ ...card, marginTop: 10, padding: "0 14px" }}>
            {found.map((f, i) => {
              const m = madeFor(f.docIdx);
              const finished = !!m && !hasOpenFollowUps(m);
              return (
                <button key={f.docIdx} type="button" disabled={finished} onClick={() => (m ? openFinish(m) : openDoc(f))} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, minHeight: 56, padding: "8px 0", border: "none", borderTop: i ? `1px solid ${M.divider}` : "none", background: "none", fontFamily: "inherit", textAlign: "left", cursor: finished ? "default" : "pointer" }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: M.raisin, overflowWrap: "anywhere" }}>{f.doc.docNo || f.doc.deliveryOrderNo || "Number not found"}</span>
                    <span style={{ display: "block", fontSize: 12, color: M.ink, overflowWrap: "anywhere" }}>{f.doc.supplierName || "Supplier not found"} · {f.doc.lines?.length ?? 0} line{(f.doc.lines?.length ?? 0) === 1 ? "" : "s"}</span>
                  </span>
                  {m ? <Tag kind="check">{finished ? `Draft ${m.docNo}` : `Finish ${m.docNo}`}</Tag> : <ChevronRight size={16} strokeWidth={2} color={M.taupe} aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {shown === "review" && c && current ? (
        <div>
          <button type="button" onClick={() => setSrcOpen((v) => !v)} aria-expanded={srcOpen} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: `1px solid ${M.border}`, borderRadius: 12, backgroundColor: M.card, fontFamily: "inherit", textAlign: "left", cursor: "pointer" }}>
            {srcImage ? <FileImage size={16} strokeWidth={2} color={M.taupe} aria-hidden="true" /> : <FileText size={16} strokeWidth={2} color={M.taupe} aria-hidden="true" />}
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{srcName}</span>
              <span style={{ display: "block", fontSize: 11.5, color: M.muted }}>View source document</span>
            </span>
            <ChevronDown size={16} strokeWidth={2} color={M.taupe} style={{ transform: srcOpen ? "rotate(180deg)" : "none" }} aria-hidden="true" />
          </button>
          {srcOpen && srcHref ? (
            srcImage
              ? <img src={srcHref} alt="Scanned delivery document" style={{ display: "block", width: "100%", maxHeight: 320, objectFit: "contain", marginTop: 8, borderRadius: 12, backgroundColor: M.divider }} />
              : <a href={srcHref} target="_blank" rel="noreferrer" style={{ display: "block", marginTop: 8, padding: 12, borderRadius: 12, backgroundColor: M.divider, color: M.taupe, fontSize: 13, fontWeight: 700, textAlign: "center" }}>Open the PDF in a new tab</a>
          ) : null}

          {[
            c.docType === "INVOICE" ? "This looks like an invoice, not a delivery note. Use Purchase Invoice for billing; continue here only if goods really arrived with it." : "",
            c.unmatchedPoRefs.length ? `The document names ${c.unmatchedPoRefs.join(", ")}, which matches no order — pick the order below if there is one.` : "",
            ...overs.map((o) => o.text),
          ].filter(Boolean).map((t) => (
            <div key={t} role="note" style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10, padding: "10px 12px", borderRadius: 12, backgroundColor: M_ACCENT.warning.bg, fontSize: 12, lineHeight: 1.45, color: "#3A352C" }}>
              <TriangleAlert size={14} strokeWidth={2} color={M_ACCENT.warning.fg} style={{ flex: "none", marginTop: 1 }} aria-hidden="true" />
              <span>{t}</span>
            </div>
          ))}

          <div style={{ ...sectionLabel, marginTop: 12 }}>DETAILS</div>
          <div style={{ ...card, padding: "4px 14px", marginTop: 8 }}>
            <Field first label="Supplier" flag={c.supplierId ? undefined : "missing"} hint={c.supplierDocName ? `Document says: ${c.supplierDocName}` : undefined}>
              <select value={c.supplierId} onChange={(e) => setCardState(grnChangeSupplier(c, e.target.value, ctx))} aria-label="Supplier" style={input(c.supplierId ? undefined : "missing")}>
                <option value="">{c.supplierId ? "Choose the supplier" : "Not found — choose the supplier"}</option>
                {ctx.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Purchase company">
              <select value={c.purchaseOrgCode} onChange={(e) => patch({ purchaseOrgCode: e.target.value })} aria-label="Purchase company" style={input()}>
                {ctx.orgs.filter((o) => o.isActive !== false).map((o) => <option key={o.code} value={o.code}>{o.name || o.code}</option>)}
                {!ctx.orgs.some((o) => o.code === c.purchaseOrgCode) ? <option value={c.purchaseOrgCode}>{c.purchaseOrgCode}</option> : null}
              </select>
            </Field>
            <Field label="Supplier DO number" hint="A second receipt with this number for the same supplier is refused.">
              <input value={c.supplierDoNo} onChange={(e) => patch({ supplierDoNo: e.target.value })} aria-label="Supplier DO number" style={input()} />
            </Field>
            <div style={{ padding: "10px 0", borderTop: `1px solid ${M.divider}` }}>
              <button type="button" onClick={() => setPosOpen((v) => !v)} aria-expanded={posOpen} style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, border: "none", background: "none", padding: 0, fontFamily: "inherit", textAlign: "left", cursor: "pointer" }}>
                <span style={{ flex: 1, fontSize: 11.5, fontWeight: 600, color: M.ink }}>Linked purchase orders</span>
                <span style={{ fontSize: 12.5, color: M.raisin }}>{c.purchaseOrderIds.length ? c.purchaseOrderIds.map((id) => ctx.purchaseOrders.find((p) => p.id === id)?.poNo || id).join(", ") : "None"}</span>
                <ChevronDown size={14} strokeWidth={2} color={M.taupe} style={{ transform: posOpen ? "rotate(180deg)" : "none" }} aria-hidden="true" />
              </button>
              {posOpen ? (
                <div style={{ marginTop: 6 }}>
                  {supplierPos.length === 0 ? <div style={{ fontSize: 12, color: M.muted }}>{hasPermission("purchase-orders", "read") ? "This supplier has no open orders." : "Your role cannot list purchase orders."}</div> : null}
                  {supplierPos.map((p) => {
                    const on = c.purchaseOrderIds.includes(p.id);
                    return (
                      <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", fontSize: 13, color: M.raisin }}>
                        <input type="checkbox" checked={on} onChange={() => setCardState(grnRelink(c, on ? c.purchaseOrderIds.filter((x) => x !== p.id) : [...c.purchaseOrderIds, p.id], ctx))} style={{ width: 18, height: 18, accentColor: "var(--m-taupe)" }} />
                        {p.poNo}
                      </label>
                    );
                  })}
                  <div style={{ fontSize: 11, color: M.muted }}>Each line draws down the order line it matches. A receipt linked to an order starts as “not arrived”; one with no order starts as arrived. Either way it is only a draft.</div>
                </div>
              ) : null}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 14 }}>
            <span style={sectionLabel}>RECEIVED LINES</span>
            <span style={{ fontSize: 12, color: M.muted }}>{c.lines.length} line{c.lines.length === 1 ? "" : "s"}</span>
          </div>
          <div style={{ ...card, padding: "0 14px", marginTop: 8 }}>
            {c.lines.map((l, idx) => {
              const n = idx + 1;
              const po = l.poId ? ctx.purchaseOrders.find((p) => p.id === l.poId) : null;
              return (
                <div key={l.key} style={{ padding: "10px 0", borderTop: idx ? `1px solid ${M.divider}` : "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: M.muted }}>LINE {n}</span>
                    <span style={{ flex: 1 }} />
                    <button type="button" onClick={() => setCardState({ ...c, lines: c.lines.filter((x) => x.key !== l.key) })} aria-label={`Remove line ${n}`} style={{ width: 32, height: 32, border: "none", background: "none", color: M.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Trash2 size={16} strokeWidth={1.9} aria-hidden="true" /></button>
                  </div>
                  <label style={{ display: "block" }}>
                    <span style={miniLabel}>DESCRIPTION</span>
                    <input value={l.materialName || l.description} onChange={(e) => patchLine(l.key, (x) => ({ ...x, materialName: e.target.value }))} aria-label={`Line ${n} description`} style={{ ...input(), marginTop: 3, height: 38, fontWeight: 600, fontSize: 13.5 }} />
                  </label>
                  <div style={{ marginTop: 6 }}>
                    <span style={miniLabel}>INTERNAL CODE</span>
                    <button type="button" onClick={() => setPickLine(l.key)} aria-label={`Line ${n} internal code`} style={{ ...input(l.materialCode ? undefined : "missing"), marginTop: 3, height: 38, display: "flex", alignItems: "center", justifyContent: "space-between", textAlign: "left", cursor: "pointer", fontSize: 13.5 }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.materialCode || "Not matched — pick the internal code"}</span>
                      <ChevronRight size={15} strokeWidth={2} color={M.taupe} aria-hidden="true" />
                    </button>
                  </div>
                  <div style={{ marginTop: 6 }}><Mini label="SUPPLIER CODE" value={l.supplierSku} onChange={(v) => patchLine(l.key, (x) => ({ ...x, supplierSku: v }))} aria={`Line ${n} supplier code`} mode="text" /></div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8, marginTop: 6 }}>
                    <Mini label="RECEIVED" value={l.qty} onChange={(v) => patchLine(l.key, (x) => setReceived(x, v))} aria={`Line ${n} received`} flag={num(l.qty) > 0 ? undefined : "missing"} />
                    <Mini label="ACCEPTED" value={l.acceptedQty} onChange={(v) => patchLine(l.key, (x) => ({ ...x, acceptedQty: v }))} aria={`Line ${n} accepted`} />
                    <Mini label="REJECTED" value={l.rejectedQty} onChange={(v) => patchLine(l.key, (x) => setRejected(x, v))} aria={`Line ${n} rejected`} />
                  </div>
                  {l.autoMatched ? <div style={{ fontSize: 11.5, color: M_ACCENT.warning.fg, marginTop: 5 }}>{matchTierHint(l.matchTier, l.matchVia)}</div> : null}
                  <div style={{ fontSize: 11.5, color: M.muted, marginTop: 5 }}>{[po ? `Draws down ${po.poNo}` : c.purchaseOrderIds.length ? "Not matched to an order line" : "No purchase order", l.uom ? `Unit: ${l.uom}` : ""].filter(Boolean).join(" · ")}</div>
                </div>
              );
            })}
            <button type="button" onClick={() => setCardState({ ...c, lines: [...c.lines, newGrnLine(`n${Date.now()}`)] })} style={{ ...ghost, height: 38, width: "100%", margin: "4px 0 12px", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}><Plus size={15} strokeWidth={2} aria-hidden="true" /> Add line</button>
          </div>
          <div style={{ fontSize: 11.5, color: M.muted, marginTop: 12, textAlign: "center" }}>Saved as a draft. Posting to stock is a separate step on the receipt, once the goods are marked arrived.</div>

          <div style={{ position: "sticky", bottom: 0, zIndex: 2, margin: "14px -16px 0", padding: "10px 16px 6px", borderTop: `1px solid ${M.border}`, backgroundColor: M.paper }}>
            {createError || stops.length ? <div role="alert" style={{ fontSize: 12, color: M_ACCENT.danger.fg, marginBottom: 8, overflowWrap: "anywhere" }}>{createError || stops[0]}</div> : null}
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={onClose} disabled={busy} style={{ ...ghost, height: 46, padding: "0 16px", flex: "none" }}>Cancel</button>
              <button type="button" onClick={() => void createReceipt()} disabled={busy || stops.length > 0} style={{ ...primary, height: 46, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", opacity: busy || stops.length ? 0.55 : 1, cursor: busy || stops.length ? "default" : "pointer" }}>{busy ? "Creating draft…" : "Create Goods Receipt"}</button>
            </div>
          </div>
          <MaterialPicker
            open={pickLine != null}
            supplierId={c.supplierId}
            ctx={ctx}
            current={c.lines.find((l) => l.key === pickLine)?.materialCode ?? ""}
            onClose={() => setPickLine(null)}
            onPick={(code) => { if (pickLine) setCardState(grnPickMaterial(c, pickLine, code, ctx)); setPickLine(null); }}
          />
        </div>
      ) : null}

      {shown === "done" && saved ? (
        <div role="status" style={{ ...card, padding: "24px 16px", textAlign: "center" }}>
          <div style={{ width: 48, height: 48, margin: "0 auto", borderRadius: "50%", backgroundColor: M_ACCENT.moss.bg, display: "flex", alignItems: "center", justifyContent: "center" }}><CircleCheck size={24} strokeWidth={1.9} color={M_ACCENT.moss.fg} aria-hidden="true" /></div>
          <div style={{ fontSize: 15, fontWeight: 700, color: M.raisin, marginTop: 12 }}>Draft Goods Receipt created</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: M.taupe, marginTop: 4 }}>{saved.grnNo}</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, color: M.ink, marginTop: 6 }}>Saved as a draft. Nothing has gone into stock yet — open the receipt to adjust quantities, mark it arrived and post it.</div>
          {following ? <div role="status" style={{ marginTop: 10, fontSize: 12, color: M.ink }}>Finishing up…</div> : null}
          {!following && rec && hasOpenFollowUps(rec) ? (
            <div role="alert" style={{ marginTop: 10, padding: "9px 12px", borderRadius: 12, backgroundColor: M_ACCENT.warning.bg, color: "#3A352C", fontSize: 12, lineHeight: 1.45, textAlign: "left" }}>
              The receipt is saved, but {FOLLOW_ORDER.filter((k) => rec.follow[k] === "failed" || rec.follow[k] === "todo").length === 1 ? "one step" : "some steps"} after it did not finish:
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {FOLLOW_ORDER.filter((k) => rec.follow[k] === "failed" || rec.follow[k] === "todo").map((k) => <li key={k}>{DOC_FOLLOW_LABEL[k]}{rec.follow[k] === "todo" ? " (waiting)" : ""}</li>)}
              </ul>
              {failedKeys(rec).includes("original") && !hasPermission("files", "create") ? <div style={{ marginTop: 4 }}>Your role cannot upload files, so the document cannot be attached from here.</div> : null}
              <button type="button" onClick={() => void finishFollowUps(rec)} style={{ ...ghost, height: 38, padding: "0 16px", marginTop: 8 }}>Retry the failed steps</button>
            </div>
          ) : null}
          <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
            <button type="button" onClick={() => { onClose(); navigate(`/m/procurement/${encodeURIComponent(saved.id)}`); }} style={primary}>Open goods receipt</button>
            <button type="button" onClick={() => (found.some((f) => !madeFor(f.docIdx)) ? setStep("choose") : reset())} style={ghost}>{found.some((f) => !madeFor(f.docIdx)) ? "Review the next document" : "Scan another"}</button>
          </div>
        </div>
      ) : null}
    </SheetFrame>
  );
}
