// Scan a supplier invoice → editable review and matching → DRAFT Purchase Invoice (Home "Scan to Create",
// Purchase Invoice tile). The desktop CreatePIWizard's rules, on the phone, with no simulation:
//   file → the scan queue (useScanQueue; kind=supplier) → rawJson.docs[] → card (lib/scan-pi.ts: supplier, bindings,
//   PO links, tax / discount) → review → ORIGINAL uploaded to /api/files → POST /api/purchase-invoices as DRAFT.
// The original is saved BEFORE the invoice is created, because `sourceDocumentFileId` can only be set at create (the
// PUT does not take it). If that upload fails the operator chooses: retry, or create without it (then it is attached
// as a plain file afterwards, as a follow-up step). The create itself carries an Idempotency-Key that is reused for a
// retry of the same body, so a dropped connection cannot make a second invoice.
// After the invoice exists, the steps that follow (attach the original if needed, send the OCR-accuracy report, mark the
// scan used) are tracked in a record that keeps the saved invoice's id (lib/scan-doc-recovery.ts): a failed step is
// retried on its own, and a closed sheet is recovered from /api/scan-queue/pending without a new read.
// A scan never confirms: Confirm (it posts to the ledger) stays on the invoice page, behind its own permission.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Camera, ChevronDown, ChevronRight, CircleCheck, FileImage, FileText, FileWarning, Info, Plus, Search, Trash2, TriangleAlert, Upload } from "lucide-react";
import { usePermissions } from "@/lib/use-permission";
import { teachPartyAlias } from "@/lib/party-alias-client";
import { postScanQueueConsume, uploadSourceDoc } from "@/lib/scan-queue-client";
import { M, M_ACCENT } from "../../theme";
import { mutateJson, refreshList } from "../../config/mutate";
import { idempotencyKeyFor, type IdemStore } from "../../lib/scan-so";
import { FOLLOW_ORDER, failedKeys, hasOpenFollowUps, runFollowUps } from "../../lib/scan-so-recovery";
import { DOC_FOLLOW_LABEL, loadDocs, newDocRecord, saveDocs, sameScanDoc, upsertDoc, type DocRecord } from "../../lib/scan-doc-recovery";
import {
  blankLine, buildPiCard, cardTotals, changeSupplier, correctedExtraction, docsOfRow, isFutureInvoiceDate, matchTierHint, materialOptions, openPosFor, pickMaterial,
  piBlockers, piDraftBody, poOrderedFor, relinkToPos, todayIso, type PiCard, type PiCardLine, type PiContext, type SupplierDoc,
} from "../../lib/scan-pi";
import { Sheet } from "../../components";
import { SheetFrame } from "../dashboard/home-ui";
import { TNUM } from "../dashboard/home-style";
import { Field, Tag } from "../so/so-ui";
import { card, ghost, input, miniLabel, primary, sectionLabel, small } from "../so/so-style";
import { useScanQueue } from "../scan/useScanQueue";
import { loadSupplierContext } from "../scan/loadSupplierContext";
import { attachOnceReturningId, linkSourceDocument } from "../scan/attach-once";
import { num, rm, safeStore, sen } from "../scan/scan-fmt";

type Step = "pick" | "scanning" | "fail" | "choose" | "review" | "done";
type Found = { doc: SupplierDoc; docIdx: number };
type Saved = { id: string; piNo: string; warning: string | null };

const EMPTY_CTX: PiContext = { suppliers: [], materials: [], bindings: [], purchaseOrders: [], orgs: [], aliases: {} };

export function SourceButton({ label, desc, icon: Icon, onClick }: { label: string; desc: string; icon: typeof Camera; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, minHeight: 64, padding: "0 14px", border: `1px solid ${M.border}`, borderRadius: 14, backgroundColor: M.card, fontFamily: "inherit", textAlign: "left", cursor: "pointer" }}>
      <span aria-hidden="true" style={{ width: 40, height: 40, flex: "none", borderRadius: 11, backgroundColor: M.divider, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon size={19} strokeWidth={1.9} color={M.taupe} aria-hidden="true" /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: M.raisin }}>{label}</span>
        <span style={{ display: "block", fontSize: 12, color: M.ink, marginTop: 2 }}>{desc}</span>
      </span>
      <ChevronRight size={16} strokeWidth={2} color={M.taupe} aria-hidden="true" />
    </button>
  );
}

export function Mini({ label, value, onChange, aria, mode = "decimal", flag }: { label: string; value: string; onChange: (v: string) => void; aria: string; mode?: "decimal" | "text"; flag?: "missing" | "check" }) {
  return (
    <label style={{ minWidth: 0 }}>
      <span style={miniLabel}>{label}</span>
      <input value={value} inputMode={mode === "decimal" ? "decimal" : undefined} onChange={(e) => onChange(e.target.value)} aria-label={aria} style={{ ...small, ...(flag ? input(flag) : {}), marginTop: 3, height: 36, textAlign: mode === "decimal" ? "right" : "left", fontSize: 13.5 }} />
    </label>
  );
}

/** Searchable internal-code picker: this supplier's materials first, the rest of the catalogue below, nothing hidden. */
export function MaterialPicker({ open, supplierId, ctx, current, onPick, onClose }: { open: boolean; supplierId: string; ctx: PiContext; current: string; onPick: (code: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const opts = useMemo(() => (open ? materialOptions(supplierId, ctx) : []), [open, supplierId, ctx]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (t ? opts.filter((o) => o.itemCode.toLowerCase().includes(t) || o.description.toLowerCase().includes(t)) : opts).slice(0, 80);
  }, [opts, q]);
  return (
    <Sheet open={open} onClose={onClose} title="Internal code">
      <div style={{ position: "relative" }}>
        <Search size={15} strokeWidth={2} color={M.muted} style={{ position: "absolute", left: 12, top: 15 }} aria-hidden="true" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code or description" aria-label="Search materials" style={{ ...input(), marginTop: 0, paddingLeft: 34 }} />
      </div>
      <div style={{ ...card, marginTop: 10, padding: "0 14px", maxHeight: 360, overflowY: "auto" }}>
        {shown.length === 0 ? <div style={{ padding: "16px 0", fontSize: 13, color: M.ink }}>Nothing matches.</div> : null}
        {shown.map((o, i) => (
          <button key={o.itemCode} type="button" onClick={() => onPick(o.itemCode)} style={{ width: "100%", display: "block", textAlign: "left", padding: "9px 0", border: "none", borderTop: i ? `1px solid ${M.divider}` : "none", background: "none", fontFamily: "inherit", cursor: "pointer" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13.5, fontWeight: 700, color: M.raisin }}>{o.itemCode}{o.itemCode === current ? <Tag kind="check">Current</Tag> : null}</span>
            <span style={{ display: "block", fontSize: 12, color: M.ink, overflowWrap: "anywhere" }}>{o.description}{o.known ? "" : " · not supplied by this supplier before"}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

export function ScanPiSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const [step, setStep] = useState<Step>("pick");
  const [ctx, setCtx] = useState<PiContext>(EMPTY_CTX);
  const ctxRef = useRef<PiContext>(EMPTY_CTX);
  const prepRef = useRef<Promise<string | null> | null>(null);
  const [found, setFound] = useState<Found[]>([]);
  const [current, setCurrent] = useState<Found | null>(null);
  const [cardState, setCardState] = useState<PiCard | null>(null);
  const [records, setRecords] = useState<DocRecord[]>(() => loadDocs(safeStore(), "PI"));
  const [srcOpen, setSrcOpen] = useState(false);
  const [queueSrc, setQueueSrc] = useState<{ url: string; image: boolean } | null>(null);
  const [pickLine, setPickLine] = useState<string | null>(null);
  const [posOpen, setPosOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState("");
  const [needChoice, setNeedChoice] = useState(false);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [rec, setRec] = useState<DocRecord | null>(null);
  const [following, setFollowing] = useState(false);
  const idemRef = useRef<IdemStore>({ body: null, key: null });
  const fileIdRef = useRef<string | null>(null);
  const camRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const saveRecords = (next: DocRecord[]) => { saveDocs(safeStore(), "PI", next); setRecords(next); };

  // Suppliers, organisations, materials, bindings, orders (when allowed) and taught aliases, loaded once per open.
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
    kind: "supplier invoice",
    queueKind: "supplier",
    docKind: "PI",
    docsOf: docsOfRow,
    placeholder: (r) => ({ docNo: r.ref, lines: [{ description: r.ref }] }),
    records,
    allowHeic: true,
    prepare,
    onRead: (rawJson) => {
      const list = docsOfRow(rawJson);
      if (list.length === 0) return "No invoice lines were found in this file.";
      setFound(list);
      if (list.length === 1) openDoc(list[0]);
      else setStep("choose");
      return null;
    },
  });

  useEffect(() => { void prepare(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A resumed scan's source document comes back from the queue row, on demand.
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
    setCardState(buildPiCard(f.doc, ctxRef.current, { today: todayIso() }));
    setCreateError("");
    setNeedChoice(false);
    setSrcOpen(false);
    setRec(null);
    fileIdRef.current = null;
    idemRef.current = { body: null, key: null };
    setStep("review");
  };

  // Step follows the scan queue's phase until a review is open.
  const phaseStep: Step = q.phase === "scanning" ? "scanning" : q.phase === "failed" ? "fail" : step;
  const shown: Step = phaseStep === "pick" && q.phase === "idle" ? step : phaseStep;

  const madeFor = (docIdx: number) => records.find((r) => sameScanDoc(r, "PI", q.row.id, docIdx)) ?? null;
  const patch = (p: Partial<PiCard>) => setCardState((c) => (c ? { ...c, ...p } : c));
  const patchLine = (key: string, p: Partial<PiCardLine>) => setCardState((c) => (c ? { ...c, lines: c.lines.map((l) => (l.key === key ? { ...l, ...p } : l)) } : c));

  const reset = () => {
    q.reset();
    setFound([]); setCurrent(null); setCardState(null); setSaved(null); setRec(null); setQueueSrc(null); setNeedChoice(false); setCreateError(""); setBusy(false);
    setStep("pick");
  };

  // ---- the steps after the invoice exists --------------------------------------------------------------------
  const finishFollowUps = async (r: DocRecord) => {
    setFollowing(true);
    const next = await runFollowUps(r, {
      // The original is only a follow-up when it was NOT linked at create: then it is attached as a plain file.
      original: async () => {
        // The invoice was made without its scan: attach it once, then link it as the invoice's source document (both steps are retry-safe).
        const fid = await attachOnceReturningId(q.file ? { kind: "file", file: q.file } : r.rowId ? { kind: "queue", rowId: r.rowId } : null, "PI", r.docId, q.file?.name ?? q.row.fileName);
        if (!fid) return false;
        const linked = await linkSourceDocument(r.docId, fid);
        return linked.ok || linked.status === 409; // 409 = it already has a source document: nothing left to do
      },
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
    setSaved({ id: r.docId, piNo: r.docNo, warning: null });
    setStep("done");
  };

  // ---- create -----------------------------------------------------------------------------------------------------
  const createInvoice = async (withoutOriginal = false) => {
    const c = cardState;
    const cur = current;
    if (!c || !cur || busy) return;
    const stops = piBlockers(c, ctxRef.current);
    if (stops.length) { setCreateError(stops[0]); return; }
    setBusy(true);
    setCreateError("");
    // 1) the original first: sourceDocumentFileId is settable only at create.
    let fileId = fileIdRef.current;
    if (!fileId && !withoutOriginal) {
      fileId = await uploadSourceDoc(q.file ? { kind: "file", file: q.file } : q.row.id ? { kind: "queue", rowId: q.row.id } : null, "purchase-invoice-source", q.row.id || `scan-${Date.now()}`);
      if (!fileId) {
        setBusy(false);
        setNeedChoice(true);
        setCreateError("The scanned document could not be saved, so it cannot be linked to the invoice. Try again, or create the invoice without it.");
        return;
      }
      fileIdRef.current = fileId;
    }
    // 2) the invoice, as a DRAFT, with a key that survives a retry of the same body.
    const body = piDraftBody(c, ctxRef.current, q.row.fileName || q.file?.name || "scan", fileId);
    const key = idempotencyKeyFor(idemRef.current, body, () => crypto.randomUUID());
    const res = await mutateJson<{ data?: { id?: string; piNo?: string }; warning?: string }>("/api/purchase-invoices", "POST", body, { "Idempotency-Key": key });
    if (!res.ok) {
      setBusy(false);
      setCreateError(res.error || "The invoice could not be created.");
      return;
    }
    const data = res.body?.data;
    if (!data?.id || !data.piNo) {
      setBusy(false);
      setCreateError("The server did not confirm the new invoice. Check Purchase Invoices before trying again.");
      return;
    }
    // The invoice exists. Keep its id first, show the success, then run the follow-through in the background.
    refreshList("/api/purchase-invoices", "/api/purchase-orders", "/api/grn");
    void teachPartyAlias({ partyType: "SUPPLIER", partyId: c.supplierId, rawName: cur.doc.supplierName, knownMap: ctxRef.current.aliases });
    const record = newDocRecord({
      kind: "PI", rowId: q.row.id, docIdx: cur.docIdx, docId: data.id, docNo: data.piNo, ref: c.supplierInvoiceNo.trim() || c.supplierDoNo.trim(),
      sampleId: q.row.sampleId, corrected: correctedExtraction(c, cur.doc), needsOriginal: !fileId,
    });
    saveRecords(upsertDoc(records, record));
    setRec(record);
    setSaved({ id: data.id, piNo: data.piNo, warning: res.body?.warning ?? null });
    setBusy(false);
    setStep("done");
    void finishFollowUps(record);
  };

  // ---- resume from the unfinished-scans list ---------------------------------------------------------------------------
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
  function openCamera() { camRef.current?.click(); }
  function openFilePicker() { fileRef.current?.click(); }

  const c = cardState;
  const totals = c ? cardTotals(c) : null;
  const stops = c ? piBlockers(c, ctx) : [];
  const supplierPos = c ? openPosFor(c.supplierId, ctx) : [];
  const back = shown === "review" ? () => (found.length > 1 ? setStep("choose") : reset()) : shown === "choose" || shown === "fail" ? reset : undefined;
  const srcImage = q.file ? q.file.type.startsWith("image/") : queueSrc?.image ?? false;
  const srcHref = q.file ? fileUrl : queueSrc?.url ?? null;
  const srcName = q.file?.name ?? q.row.fileName;
  const reconcile = c && c.docTotalRm != null && totals ? Math.abs(c.docTotalRm * 100 - totals.totalSen) : 0;

  return (
    <SheetFrame open={open} title="Scan Purchase Invoice" sub={shown === "pick" ? "Prepares a draft Purchase Invoice" : undefined} onBack={back} onClose={onClose}>
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />

      {shown === "pick" ? (
        <div>
          <div style={{ display: "grid", gap: 10 }}>
            <SourceButton label="Take photo" desc="Use the camera to capture the document" icon={Camera} onClick={openCamera} />
            <SourceButton label="Upload image or PDF" desc="Choose a photo or PDF from this device" icon={Upload} onClick={openFilePicker} />
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
                          ? finishOnly ? "A draft invoice was saved; a step after it did not finish."
                            : `${v.docs.length} invoice${v.docs.length === 1 ? "" : "s"} ready to review. This is already read, so no new scan is needed.`
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
            <span>Scanning only prepares an editable draft. Nothing is confirmed, approved, posted or paid until you review it. A PDF or a photo, up to 32 MB.</span>
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
          <div aria-hidden="true" style={{ height: 6, margin: "16px auto 0", maxWidth: 240, borderRadius: 999, backgroundColor: M.divider, overflow: "hidden" }}>
            <div className="scan-bar" style={{ height: "100%", width: "40%", backgroundColor: M.taupe, borderRadius: 999, animation: "scanSlide 1.4s ease-in-out infinite alternate" }} />
          </div>
          <style>{"@keyframes scanSlide{from{transform:translateX(-30%)}to{transform:translateX(160%)}}@media (prefers-reduced-motion:reduce){.scan-bar{animation:none!important;width:60%!important}}"}</style>
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
                    <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: M.raisin, overflowWrap: "anywhere" }}>{f.doc.docNo || "Number not found"}</span>
                    <span style={{ display: "block", fontSize: 12, color: M.ink, overflowWrap: "anywhere" }}>{f.doc.supplierName || "Supplier not found"} · {f.doc.lines?.length ?? 0} line{(f.doc.lines?.length ?? 0) === 1 ? "" : "s"}</span>
                  </span>
                  {m ? <Tag kind="check">{finished ? `Draft ${m.docNo}` : `Finish ${m.docNo}`}</Tag> : <ChevronRight size={16} strokeWidth={2} color={M.taupe} aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {shown === "review" && c && current && totals ? (
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
              ? <img src={srcHref} alt="Scanned supplier invoice" style={{ display: "block", width: "100%", maxHeight: 320, objectFit: "contain", marginTop: 8, borderRadius: 12, backgroundColor: M.divider }} />
              : <a href={srcHref} target="_blank" rel="noreferrer" style={{ display: "block", marginTop: 8, padding: 12, borderRadius: 12, backgroundColor: M.divider, color: M.taupe, fontSize: 13, fontWeight: 700, textAlign: "center" }}>Open the PDF in a new tab</a>
          ) : null}

          {[
            c.docType === "DELIVERY_NOTE" ? "This looks like a delivery note, not an invoice. Use Goods Receipt for the goods; continue here only if it really is the supplier's invoice." : "",
            c.currency && !["MYR", "RM"].includes(c.currency.toUpperCase()) ? `The document is in ${c.currency}. Mobile invoices are saved in MYR — enter a foreign-currency invoice on the desktop, where the exchange rate is set.` : "",
            c.unmatchedPoRefs.length ? `The document names ${c.unmatchedPoRefs.join(", ")}, which matches no order — pick the order below if there is one.` : "",
            reconcile > 5 && c.docTotalRm != null ? `The document's printed total is ${rm(c.docTotalRm)} but these lines come to ${sen(totals.totalSen)}. Check quantities, prices and tax against the source.` : "",
          ].filter(Boolean).map((t) => (
            <div key={t} role="note" style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10, padding: "10px 12px", borderRadius: 12, backgroundColor: M_ACCENT.warning.bg, fontSize: 12, lineHeight: 1.45, color: "#3A352C" }}>
              <TriangleAlert size={14} strokeWidth={2} color={M_ACCENT.warning.fg} style={{ flex: "none", marginTop: 1 }} aria-hidden="true" />
              <span>{t}</span>
            </div>
          ))}

          <div style={{ ...sectionLabel, marginTop: 12 }}>DETAILS</div>
          <div style={{ ...card, padding: "4px 14px", marginTop: 8 }}>
            <Field first label="Supplier" flag={c.supplierId ? undefined : "missing"} hint={c.supplierDocName ? `Document says: ${c.supplierDocName}` : undefined}>
              <select value={c.supplierId} onChange={(e) => setCardState(changeSupplier({ ...c, purchaseOrderIds: [] }, e.target.value, ctx))} aria-label="Supplier" style={input(c.supplierId ? undefined : "missing")}>
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
            <Field label="Supplier invoice number"><input value={c.supplierInvoiceNo} onChange={(e) => patch({ supplierInvoiceNo: e.target.value })} aria-label="Supplier invoice number" style={input()} /></Field>
            <Field label="Supplier DO number"><input value={c.supplierDoNo} onChange={(e) => patch({ supplierDoNo: e.target.value })} aria-label="Supplier DO number" style={input()} /></Field>
            <Field label="Invoice date" flag={isFutureInvoiceDate(c.invoiceDate) ? "check" : undefined} hint={isFutureInvoiceDate(c.invoiceDate) ? "This date is in the future — check the supplier's invoice." : undefined}>
              <input type="date" value={c.invoiceDate} onChange={(e) => patch({ invoiceDate: e.target.value })} aria-label="Invoice date" style={input(isFutureInvoiceDate(c.invoiceDate) ? "check" : undefined)} />
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
                        <input type="checkbox" checked={on} onChange={() => setCardState(relinkToPos(c, on ? c.purchaseOrderIds.filter((x) => x !== p.id) : [...c.purchaseOrderIds, p.id], ctx))} style={{ width: 18, height: 18, accentColor: "var(--m-taupe)" }} />
                        {p.poNo}
                      </label>
                    );
                  })}
                  <div style={{ fontSize: 11, color: M.muted }}>Each line is billed against the order that owns it; a blank price is filled from that order.</div>
                </div>
              ) : null}
            </div>
            <Field label="Invoice discount (RM)"><input value={c.discountRm} inputMode="decimal" onChange={(e) => patch({ discountRm: e.target.value })} aria-label="Invoice discount" style={{ ...input(), textAlign: "right" }} /></Field>
          </div>

          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 14 }}>
            <span style={sectionLabel}>INVOICE LINES</span>
            <span style={{ fontSize: 12, color: M.muted }}>{c.lines.length} line{c.lines.length === 1 ? "" : "s"}</span>
          </div>
          <div style={{ ...card, padding: "0 14px", marginTop: 8 }}>
            {c.lines.map((l, idx) => {
              const n = idx + 1;
              const ordered = poOrderedFor(l, ctx.purchaseOrders);
              const over = ordered && num(l.qty) > ordered.ordered;
              return (
                <div key={l.key} style={{ padding: "10px 0", borderTop: idx ? `1px solid ${M.divider}` : "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: M.muted }}>LINE {n}</span>
                    <span style={{ flex: 1 }} />
                    <button type="button" onClick={() => setCardState({ ...c, lines: c.lines.filter((x) => x.key !== l.key) })} aria-label={`Remove line ${n}`} style={{ width: 32, height: 32, border: "none", background: "none", color: M.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Trash2 size={16} strokeWidth={1.9} aria-hidden="true" /></button>
                  </div>
                  <label style={{ display: "block" }}>
                    <span style={miniLabel}>DESCRIPTION</span>
                    <input value={l.materialName || l.description} onChange={(e) => patchLine(l.key, { materialName: e.target.value })} aria-label={`Line ${n} description`} style={{ ...input(), marginTop: 3, height: 38, fontWeight: 600, fontSize: 13.5 }} />
                  </label>
                  <div style={{ marginTop: 6 }}>
                    <span style={miniLabel}>INTERNAL CODE</span>
                    <button type="button" onClick={() => setPickLine(l.key)} aria-label={`Line ${n} internal code`} style={{ ...input(l.materialCode ? undefined : "missing"), marginTop: 3, height: 38, display: "flex", alignItems: "center", justifyContent: "space-between", textAlign: "left", cursor: "pointer", fontSize: 13.5 }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.materialCode || "Not matched — pick the internal code"}</span>
                      <ChevronRight size={15} strokeWidth={2} color={M.taupe} aria-hidden="true" />
                    </button>
                  </div>
                  <div style={{ marginTop: 6 }}><Mini label="SUPPLIER CODE" value={l.supplierSku} onChange={(v) => patchLine(l.key, { supplierSku: v })} aria={`Line ${n} supplier code`} mode="text" /></div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8, marginTop: 6 }}>
                    <Mini label={`QTY${l.uom ? ` (${l.uom})` : ""}`} value={l.qty} onChange={(v) => patchLine(l.key, { qty: v })} aria={`Line ${n} quantity`} flag={num(l.qty) > 0 ? undefined : "missing"} />
                    <Mini label="UNIT PRICE (RM)" value={l.unitPriceRm} onChange={(v) => patchLine(l.key, { unitPriceRm: v })} aria={`Line ${n} unit price`} flag={num(l.unitPriceRm) > 0 ? undefined : "check"} />
                    <Mini label="TAX (RM)" value={l.taxRm} onChange={(v) => patchLine(l.key, { taxRm: v })} aria={`Line ${n} tax`} />
                  </div>
                  {l.autoMatched ? <div style={{ fontSize: 11.5, color: M_ACCENT.warning.fg, marginTop: 5 }}>{matchTierHint(l.matchTier, l.matchVia)}</div> : null}
                  {ordered ? <div style={{ fontSize: 11.5, color: over ? M_ACCENT.danger.fg : M.muted, marginTop: 5 }}>{ordered.poNo} · ordered {ordered.ordered}{over ? " — this line bills more than was ordered; the server will refuse an over-billed line." : ""}</div> : null}
                  {num(l.unitPriceRm) > 0 ? null : <div style={{ fontSize: 11.5, color: M_ACCENT.warning.fg, marginTop: 5 }}>Price not read — enter it, or link the order it belongs to.</div>}
                </div>
              );
            })}
            <button type="button" onClick={() => setCardState({ ...c, lines: [...c.lines, blankLine(`n${Date.now()}`)] })} style={{ ...ghost, height: 38, width: "100%", margin: "4px 0 12px", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}><Plus size={15} strokeWidth={2} aria-hidden="true" /> Add line</button>
          </div>

          <div style={{ ...card, padding: "10px 14px", marginTop: 10 }}>
            {([["Subtotal", totals.subtotalSen], ["Discount", -totals.discountSen], ["Tax", totals.taxSen]] as const).map(([l, v]) => (
              <div key={l} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: M.ink, padding: "2px 0" }}><span>{l}</span><span style={TNUM}>{sen(v)}</span></div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 700, color: M.raisin, paddingTop: 6, marginTop: 4, borderTop: `1px solid ${M.divider}` }}><span>Total</span><span style={TNUM}>{sen(totals.totalSen)}</span></div>
          </div>
          <div style={{ fontSize: 11.5, color: M.muted, marginTop: 12, textAlign: "center" }}>Saved as a draft for you to finish. Confirming the invoice is done from the invoice page.</div>

          <div style={{ position: "sticky", bottom: 0, zIndex: 2, margin: "14px -16px 0", padding: "10px 16px 6px", borderTop: `1px solid ${M.border}`, backgroundColor: M.paper }}>
            {createError || stops.length ? <div role="alert" style={{ fontSize: 12, color: M_ACCENT.danger.fg, marginBottom: 8, overflowWrap: "anywhere" }}>{createError || stops[0]}</div> : null}
            {needChoice ? <button type="button" onClick={() => void createInvoice(true)} disabled={busy} style={{ ...ghost, height: 40, width: "100%", marginBottom: 8, fontSize: 13 }}>Create without the scanned document</button> : null}
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={onClose} disabled={busy} style={{ ...ghost, height: 46, padding: "0 16px", flex: "none" }}>Cancel</button>
              <button type="button" onClick={() => void createInvoice(false)} disabled={busy || stops.length > 0} style={{ ...primary, height: 46, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", opacity: busy || stops.length ? 0.55 : 1, cursor: busy || stops.length ? "default" : "pointer" }}>{busy ? "Creating draft…" : needChoice ? "Try again" : "Create Purchase Invoice"}</button>
            </div>
          </div>
          <MaterialPicker
            open={pickLine != null}
            supplierId={c.supplierId}
            ctx={ctx}
            current={c.lines.find((l) => l.key === pickLine)?.materialCode ?? ""}
            onClose={() => setPickLine(null)}
            onPick={(code) => { if (pickLine) setCardState(pickMaterial(c, pickLine, code, ctx)); setPickLine(null); }}
          />
        </div>
      ) : null}

      {shown === "done" && saved ? (
        <div role="status" style={{ ...card, padding: "24px 16px", textAlign: "center" }}>
          <div style={{ width: 48, height: 48, margin: "0 auto", borderRadius: "50%", backgroundColor: M_ACCENT.moss.bg, display: "flex", alignItems: "center", justifyContent: "center" }}><CircleCheck size={24} strokeWidth={1.9} color={M_ACCENT.moss.fg} aria-hidden="true" /></div>
          <div style={{ fontSize: 15, fontWeight: 700, color: M.raisin, marginTop: 12 }}>Draft Purchase Invoice created</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: M.taupe, marginTop: 4, ...TNUM }}>{saved.piNo}</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, color: M.ink, marginTop: 6 }}>Saved as a draft. It has not been confirmed — confirming it from the invoice page is what posts it to the books.</div>
          {saved.warning ? <div role="alert" style={{ marginTop: 10, padding: "9px 12px", borderRadius: 12, backgroundColor: M_ACCENT.warning.bg, color: "#3A352C", fontSize: 12, lineHeight: 1.45, textAlign: "left", overflowWrap: "anywhere" }}>{saved.warning}</div> : null}
          {following ? <div role="status" style={{ marginTop: 10, fontSize: 12, color: M.ink }}>Finishing up…</div> : null}
          {!following && rec && hasOpenFollowUps(rec) ? (
            <div role="alert" style={{ marginTop: 10, padding: "9px 12px", borderRadius: 12, backgroundColor: M_ACCENT.warning.bg, color: "#3A352C", fontSize: 12, lineHeight: 1.45, textAlign: "left" }}>
              The invoice is saved, but {FOLLOW_ORDER.filter((k) => rec.follow[k] === "failed" || rec.follow[k] === "todo").length === 1 ? "one step" : "some steps"} after it did not finish:
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {FOLLOW_ORDER.filter((k) => rec.follow[k] === "failed" || rec.follow[k] === "todo").map((k) => <li key={k}>{DOC_FOLLOW_LABEL[k]}{rec.follow[k] === "todo" ? " (waiting)" : ""}</li>)}
              </ul>
              {failedKeys(rec).includes("original") && !q.file ? <div style={{ marginTop: 4 }}>If this keeps failing, the document can be attached from the desktop.</div> : null}
              <button type="button" onClick={() => void finishFollowUps(rec)} style={{ ...ghost, height: 38, padding: "0 16px", marginTop: 8 }}>Retry the failed steps</button>
            </div>
          ) : null}
          <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
            <button type="button" onClick={() => { onClose(); navigate(`/m/procurement/${encodeURIComponent(saved.id)}`); }} style={primary}>Open purchase invoice</button>
            <button type="button" onClick={() => (found.some((f) => !madeFor(f.docIdx)) ? setStep("choose") : reset())} style={ghost}>{found.some((f) => !madeFor(f.docIdx)) ? "Review the next invoice" : "Scan another"}</button>
          </div>
        </div>
      ) : null}
    </SheetFrame>
  );
}
