// Scan a customer PO → editable review → DRAFT Sales Order (Home "Scan to Create", Sales Order tile).
//
// Real flow, no simulation:
//   file → POST /api/scan-queue/upload (kind=po) → the browser drives POST …/batch/:id/work and polls
//   GET …/batch/:id (the same client the desktop modal uses; a request the phone holds open for the whole
//   OCR would die with the screen lock) → rawJson.pos[] → review → POST /api/sales-orders as DRAFT.
//
// After the order exists (and only then): the original document is attached, the OCR-accuracy sample is
// confirmed with the final values, the queue row is consumed and the customer letterhead is taught — the
// same four things the desktop ScanPOModal does. They never undo the order. The first three are tracked
// in a record that keeps the saved order id (lib/scan-so-recovery.ts), so a failed one can be retried on
// its own without creating a second order.
// A scan closed half-way is recovered from GET /api/scan-queue/pending: a finished read is reviewed from
// its stored result (no new OCR); a read still pending or failed is continued only when the user taps.
// A scan never confirms: Confirm (BOM / purchasing / production cascade) stays on the order page.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Camera, ChevronDown, ChevronRight, CircleCheck, FileImage, FileText, FileWarning, Info, TriangleAlert, Upload } from "lucide-react";
import { useInterval } from "@/lib/scheduler";
import { fetchPartyAliases, teachPartyAlias, type AliasMap } from "@/lib/party-alias-client";
import { createScanQueueDriver, postScanQueueConsume } from "@/lib/scan-queue-client";
import { persistSoOriginal } from "@/lib/so-original";
import { M, M_ACCENT } from "../../theme";
import { mutateJson, refreshList } from "../../config/mutate";
import {
  blockers, buildSoBody, correctedJsonFor, draftFlags, draftFromPo, fileProblem, idempotencyKeyFor, posOfRow, rmToSen,
  type IdemStore, type RawScanPo, type ReviewDraft, type ReviewItem, type ScanCatalog,
} from "../../lib/scan-so";
import {
  FOLLOW_LABEL, FOLLOW_ORDER, failedKeys, hasOpenFollowUps, loadMade, newMadeRecord, pendingViews, runFollowUps, sameDoc, saveMade, upsertMade,
  type MadeRecord, type PendingRow, type PendingView,
} from "../../lib/scan-so-recovery";
import { SheetFrame } from "./home-ui";
import { splitSofaLine } from "../../lib/so-edit";
import { Field, Tag, SoLineEditor } from "../so/so-ui";
import { card, ghost, input, primary, sectionLabel } from "../so/so-style";
import { TNUM } from "./home-style";

type Step = "pick" | "scanning" | "fail" | "choose" | "review" | "done";
type Found = { po: RawScanPo; docIdx: number };
type Result = { id: string; soNo: string; warning: string | null };
type Row = { id: string; sampleId: string | null; fileName: string };

const nowMs = (): number => Date.now();
const safeStore = (): Storage | null => {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
};

const ymd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const rm = (n: number) => `RM ${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function SourceButton({ label, desc, icon: Icon, onClick }: { label: string; desc: string; icon: typeof Camera; onClick: () => void }) {
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

export function ScanSoSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("pick");
  const [file, setFile] = useState<File | null>(null);
  const [failText, setFailText] = useState("");
  const [slow, setSlow] = useState(false);
  const [found, setFound] = useState<Found[]>([]);
  const [madeList, setMadeList] = useState<MadeRecord[]>(() => loadMade(safeStore()));
  const [row, setRow] = useState<Row>({ id: "", sampleId: null, fileName: "" });
  const [rec, setRec] = useState<MadeRecord | null>(null);
  const [following, setFollowing] = useState(false);
  const [pendingRaw, setPendingRaw] = useState<{ batchId: string; items: PendingRow[] } | null>(null);
  const [queueSrc, setQueueSrc] = useState<{ url: string; image: boolean } | null>(null);
  const [pick, setPick] = useState<Found | null>(null);
  const [draft, setDraft] = useState<ReviewDraft | null>(null);
  const [srcOpen, setSrcOpen] = useState(false);
  const [catalog, setCatalog] = useState<ScanCatalog | null>(null);
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  const catalogRef = useRef<ScanCatalog | null>(null);
  const aliasRef = useRef<AliasMap>({});
  const prepRef = useRef<Promise<string | null> | null>(null);
  const batchRef = useRef<{ batchId: string; rowId: string; startedAt: number } | null>(null);
  const driverRef = useRef<ReturnType<typeof createScanQueueDriver> | null>(null);
  const pollingRef = useRef(false);
  const idemRef = useRef<IdemStore>({ body: null, key: null });
  const camRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Customer / product catalog + taught aliases, loaded once per open. Same gate as the upload.
  const prepare = (): Promise<string | null> => {
    if (!prepRef.current) {
      prepRef.current = (async () => {
        try {
          const [res, aliases] = await Promise.all([fetch("/api/scan-po/catalog", { credentials: "include" }), fetchPartyAliases("CUSTOMER")]);
          const j = (await res.json().catch(() => null)) as { success?: boolean; error?: string; data?: ScanCatalog } | null;
          if (!res.ok || !j?.success || !j.data) {
            return res.status === 403 ? "Your role cannot scan customer POs (it needs permission to create purchase orders)." : j?.error || `Could not load the customer list (HTTP ${res.status}).`;
          }
          catalogRef.current = j.data;
          setCatalog(j.data);
          aliasRef.current = aliases;
          return null;
        } catch (e) {
          return e instanceof Error ? e.message : "Network error";
        }
      })();
    }
    return prepRef.current;
  };

  // A preview of what was scanned: an image is shown; a PDF opens in the browser's viewer.
  const srcUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (srcUrl) URL.revokeObjectURL(srcUrl); }, [srcUrl]);

  // Unfinished scans of this user (GET only: reading it never starts an OCR call).
  const fetchPending = async (): Promise<{ batchId: string; items: PendingRow[] }> => {
    try {
      const res = await fetch("/api/scan-queue/pending?kind=po", { credentials: "include" });
      const j = (await res.json().catch(() => null)) as { success?: boolean; data?: { batchId: string | null; items?: PendingRow[] } } | null;
      if (!res.ok || !j?.success) return { batchId: "", items: [] };
      return { batchId: j.data?.batchId ?? "", items: j.data?.items ?? [] };
    } catch {
      return { batchId: "", items: [] };
    }
  };
  const loadPending = () => { void fetchPending().then(setPendingRaw); };
  const views = useMemo(() => (pendingRaw ? pendingViews(pendingRaw.items, madeList) : null), [pendingRaw, madeList]);

  useEffect(() => {
    if (open) {
      void prepare();
      void fetchPending().then(setPendingRaw);
    }
    return () => { driverRef.current?.stop(); };
  }, [open]);

  // The source document of a RESUMED scan comes back from the queue row, on demand.
  useEffect(() => {
    if (!srcOpen || file || !row.id || queueSrc) return;
    let live = true;
    fetch(`/api/scan-queue/${encodeURIComponent(row.id)}/bytes`, { credentials: "include" })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => { if (live && b && b.size) setQueueSrc({ url: URL.createObjectURL(b), image: b.type.startsWith("image/") }); })
      .catch(() => {});
    return () => { live = false; };
  }, [srcOpen, file, row.id, queueSrc]);
  useEffect(() => () => { if (queueSrc) URL.revokeObjectURL(queueSrc.url); }, [queueSrc]);

  const toFail = (text: string) => { driverRef.current?.stop(); setFailText(text); setStep("fail"); };

  const reviewPo = (f: Found) => {
    const cat = catalogRef.current;
    setPick(f);
    setDraft(draftFromPo(f.po, cat, aliasRef.current));
    setCreateError("");
    setSrcOpen(false);
    setRec(null);
    idemRef.current = { body: null, key: null };
    setStep("review");
  };

  const afterRead = (rawJson: unknown) => {
    const list = posOfRow(rawJson);
    if (list.length === 0) { toFail("No purchase order was found in this file."); return; }
    setFound(list);
    if (list.length === 1) reviewPo(list[0]);
    else setStep("choose");
  };

  const poll = async () => {
    const b = batchRef.current;
    if (!b || pollingRef.current) return;
    pollingRef.current = true;
    try {
      const res = await fetch(`/api/scan-queue/batch/${encodeURIComponent(b.batchId)}`, { credentials: "include" });
      const j = (await res.json().catch(() => null)) as { success?: boolean; error?: string; data?: { items?: { id: string; status: string; fileName: string; rawJson: unknown; error: string | null; sampleId: string | null }[] } } | null;
      if (!res.ok || !j?.success) {
        if (res.status === 401 || res.status === 403) toFail("Your session or permission changed while reading. Sign in again and retry.");
        return; // a blip: the next tick asks again
      }
      const item = j.data?.items?.find((i) => i.id === b.rowId);
      if (!item) return;
      if (item.status === "done" || item.status === "cached") {
        if (item.rawJson == null) return;
        driverRef.current?.stop();
        batchRef.current = null;
        setRow({ id: item.id, sampleId: item.sampleId ?? null, fileName: item.fileName });
        const err = await prepare();
        if (err) { toFail(err); return; }
        afterRead(item.rawJson);
      } else if (item.status === "failed") {
        batchRef.current = null;
        toFail(item.error ? `The document could not be read (${item.error.slice(0, 140)}).` : "The document could not be read.");
      } else {
        if (nowMs() - b.startedAt > 45000) setSlow(true);
        if (driverRef.current && driverRef.current.active() === 0) driverRef.current.poke();
      }
    } finally {
      pollingRef.current = false;
    }
  };
  useInterval(() => void poll(), step === "scanning" ? 3000 : null);

  const startScan = async (f: File) => {
    const problem = fileProblem(f);
    setFile(f);
    setSlow(false);
    if (problem) { setFailText(problem); setStep("fail"); return; }
    setStep("scanning");
    const prepErr = await prepare();
    if (prepErr) { toFail(prepErr); return; }
    try {
      const fd = new FormData();
      fd.append("kind", "po");
      fd.append("files", f);
      const res = await fetch("/api/scan-queue/upload", { method: "POST", body: fd, credentials: "include" });
      const j = (await res.json().catch(() => null)) as { success?: boolean; error?: string; data?: { batchId: string; items: { id: string }[] } } | null;
      if (!res.ok || !j?.success || !j.data?.items?.[0]) {
        toFail(res.status === 403 ? "Your role cannot scan customer POs (it needs permission to create purchase orders)." : j?.error || `Upload failed (HTTP ${res.status}).`);
        return;
      }
      batchRef.current = { batchId: j.data.batchId, rowId: j.data.items[0].id, startedAt: nowMs() };
      setRow({ id: j.data.items[0].id, sampleId: null, fileName: f.name });
      driverRef.current?.stop();
      driverRef.current = createScanQueueDriver(j.data.batchId, { concurrency: 1, onProcessed: () => void poll() });
      driverRef.current.poke();
      void poll(); // a file the queue has already read (same bytes scanned before) is ready at once
    } catch (e) {
      toFail(e instanceof Error ? e.message : "Network error while uploading.");
    }
  };

  const reset = () => {
    driverRef.current?.stop();
    batchRef.current = null;
    setFile(null); setFound([]); setPick(null); setDraft(null); setResult(null); setRec(null); setQueueSrc(null); setFollowing(false);
    setCreateError(""); setFailText(""); setSlow(false); setBusy(false);
    setRow({ id: "", sampleId: null, fileName: "" });
    setStep("pick");
    loadPending();
  };

  const madeFor = (docIdx: number) => madeList.find((m) => sameDoc(m, row.id, docIdx)) ?? null;
  const saveRecord = (r: MadeRecord) => {
    setMadeList((list) => {
      const next = upsertMade(list, r);
      saveMade(safeStore(), next);
      return next;
    });
    setRec(r);
  };

  // The order exists; finish what is still open (original, accuracy report, queue row). Only steps that
  // have not succeeded run, so a retry can never repeat one that worked — and never creates an order.
  const finishFollowUps = async (r: MadeRecord) => {
    setFollowing(true);
    const next = await runFollowUps(r, {
      original: async () => (await persistSoOriginal(r.soId, file ? { kind: "file", file } : r.rowId ? { kind: "queue", rowId: r.rowId } : null, r.poNo || null)).ok,
      sample: async () => {
        try {
          const res = await fetch(`/api/scan-po/samples/${encodeURIComponent(r.sampleId ?? "")}/confirm`, {
            method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
            body: JSON.stringify({ correctedJson: r.corrected, gold: false }),
          });
          if (!res.ok) console.warn(`[scan-po] accuracy sample not recorded (${res.status})`);
          return res.ok;
        } catch {
          return false;
        }
      },
      consume: async () => (await postScanQueueConsume(r.rowId, r.docIdx)).ok,
    });
    saveRecord(next);
    setFollowing(false);
  };

  const openFinish = (r: MadeRecord) => {
    setRec(r);
    setResult({ id: r.soId, soNo: r.soNo, warning: null });
    setStep("done");
  };

  // A finished read is reviewed from its stored result: no OCR call.
  const resumeReady = async (v: PendingView) => {
    setFile(null);
    setQueueSrc(null);
    setRow({ id: v.rowId, sampleId: v.sampleId, fileName: v.fileName });
    const err = await prepare();
    if (err) { toFail(err); return; }
    const list = v.pos.map(({ po, docIdx }) => ({ po, docIdx }));
    setFound(list);
    if (list.length === 1) {
      const m = v.pos[0].made;
      if (m) openFinish(m);
      else reviewPo(list[0]);
    } else setStep("choose");
  };

  // Continuing a read that never finished (or failed) IS one more OCR call, so it only happens on this tap.
  const continueReading = async (v: PendingView) => {
    const batchId = pendingRaw?.batchId;
    if (!batchId || !v.solo) return;
    setFile(null);
    setQueueSrc(null);
    setSlow(false);
    setRow({ id: v.rowId, sampleId: null, fileName: v.fileName });
    setStep("scanning");
    const err = await prepare();
    if (err) { toFail(err); return; }
    if (v.state === "failed") {
      const r = await fetch(`/api/scan-queue/${encodeURIComponent(v.rowId)}/retry`, { method: "POST", credentials: "include" });
      if (!r.ok) { toFail(`The read could not be restarted (HTTP ${r.status}).`); return; }
    }
    batchRef.current = { batchId, rowId: v.rowId, startedAt: nowMs() };
    driverRef.current?.stop();
    driverRef.current = createScanQueueDriver(batchId, { concurrency: 1, onProcessed: () => void poll() });
    driverRef.current.poke();
    void poll();
  };

  const patchItem = (key: string, patch: Partial<ReviewItem>) => setDraft((d) => (d ? { ...d, items: d.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) } : d));
  const patch = (p: Partial<ReviewDraft>) => setDraft((d) => (d ? { ...d, ...p } : d));

  const createOrder = async () => {
    const cat = catalogRef.current;
    if (!draft || !pick || !cat || busy) return;
    const stops = blockers(draft);
    if (stops.length) { setCreateError(stops[0]); return; }
    setBusy(true);
    setCreateError("");
    const body = buildSoBody(draft, cat, pick.po, ymd());
    const key = idempotencyKeyFor(idemRef.current, body, () => crypto.randomUUID());
    const res = await mutateJson<{ data?: { id?: string; companySOId?: string }; warning?: string; duplicateOf?: string | null }>("/api/sales-orders", "POST", body, { "Idempotency-Key": key });
    if (!res.ok) {
      setBusy(false);
      setCreateError(res.error || "The order could not be created.");
      return;
    }
    const data = res.body?.data;
    if (!data?.id || !data.companySOId) {
      setBusy(false);
      setCreateError("The server did not confirm the new order. Check Sales Orders before trying again.");
      return;
    }
    const { id, companySOId } = data;
    // The order exists. Keep its id first (so closing the sheet cannot lose it), show the success, then
    // run the follow-through in the background: none of it can undo the order.
    refreshList("/api/sales-orders", "/api/production-orders");
    void teachPartyAlias({ partyType: "CUSTOMER", partyId: draft.customerId, rawName: pick.po.customerName, knownMap: aliasRef.current });
    const saved = newMadeRecord({ rowId: row.id, docIdx: pick.docIdx, soId: id, soNo: companySOId, poNo: draft.customerPO.trim(), sampleId: row.sampleId, corrected: correctedJsonFor(pick.po, draft, cat) });
    saveRecord(saved);
    setResult({ id, soNo: companySOId, warning: res.body?.warning ?? null });
    setBusy(false);
    setStep("done");
    void finishFollowUps(saved);
  };

  const onFile = (f: File | undefined) => { if (f) void startScan(f); };
  function openCamera() { camRef.current?.click(); }
  function openFilePicker() { fileRef.current?.click(); }

  const srcImage = file ? file.type.startsWith("image/") : queueSrc?.image ?? false;
  const srcHref = file ? srcUrl : queueSrc?.url ?? null;
  const srcName = file?.name ?? row.fileName;
  const cat = catalog;
  const flags = draft && step === "review" ? draftFlags(draft, cat) : null;
  const customer = draft ? cat?.customers.find((c) => c.id === draft.customerId) : undefined;
  const stops = draft ? blockers(draft) : [];
  const priced = draft ? draft.items.filter((i) => rmToSen(i.priceRm) > 0) : [];
  const total = draft ? draft.items.reduce((s, i) => s + (Number(i.qty) > 0 ? Number(i.qty) * (rmToSen(i.priceRm) / 100) : 0), 0) : 0;
  const back = step === "review" ? () => (found.length > 1 ? setStep("choose") : reset()) : step === "choose" || step === "fail" ? reset : undefined;

  return (
    <SheetFrame open={open} title="Scan Sales Order" sub={step === "pick" ? "Prepares a draft Sales Order" : undefined} onBack={back} onClose={onClose}>
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />

      {step === "pick" ? (
        <div>
          <div style={{ display: "grid", gap: 10 }}>
            <SourceButton label="Take photo" desc="Use the camera to capture the document" icon={Camera} onClick={openCamera} />
            <SourceButton label="Upload image or PDF" desc="Choose a photo or PDF from this device" icon={Upload} onClick={openFilePicker} />
          </div>
          {views && views.length > 0 ? (
            <div style={{ marginTop: 14 }}>
              <div style={sectionLabel}>UNFINISHED SCANS</div>
              <div style={{ ...card, padding: "0 14px", marginTop: 8 }}>
                {views.map((v, i) => {
                  const finishOnly = v.state === "ready" && v.pos.every((p) => p.made);
                  return (
                    <div key={`${v.rowId}-${i}`} style={{ padding: "10px 0", borderTop: i ? `1px solid ${M.divider}` : "none" }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: M.raisin, overflowWrap: "anywhere" }}>{v.fileName}</div>
                      <div style={{ fontSize: 12, color: M.ink, marginTop: 2, lineHeight: 1.4, overflowWrap: "anywhere" }}>
                        {v.state === "ready"
                          ? finishOnly
                            ? "A draft order was saved; a step after it did not finish."
                            : `${v.pos.length} purchase order${v.pos.length === 1 ? "" : "s"} ready to review. This is already read, so no new scan is needed.`
                          : v.state === "reading"
                            ? "Still being read."
                            : `Could not be read${v.error ? ` (${v.error.slice(0, 80)})` : ""}.`}
                      </div>
                      {v.state === "ready" ? (
                        <button type="button" onClick={() => void resumeReady(v)} style={{ ...primary, height: 38, padding: "0 16px", marginTop: 8 }}>{finishOnly ? "Finish saving" : "Review"}</button>
                      ) : v.solo ? (
                        <>
                          <button type="button" onClick={() => void continueReading(v)} style={{ ...ghost, height: 38, padding: "0 16px", marginTop: 8 }}>{v.state === "failed" ? "Retry reading" : "Continue reading"}</button>
                          <div style={{ fontSize: 11, color: M.muted, marginTop: 4 }}>Starts one more read of this file.</div>
                        </>
                      ) : (
                        <div style={{ fontSize: 11, color: M.muted, marginTop: 6 }}>Part of a larger batch. Continue it on the desktop.</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 12, padding: "10px 12px", borderRadius: 12, backgroundColor: M.divider, fontSize: 12, lineHeight: 1.45, color: M.ink }}>
            <Info size={14} strokeWidth={2} color={M.taupe} style={{ flex: "none", marginTop: 1 }} aria-hidden="true" />
            <span>Scanning only prepares an editable draft. Nothing is confirmed, approved, posted or paid until you review it. A PDF or JPEG / PNG / WebP photo, up to 32 MB.</span>
          </div>
        </div>
      ) : null}

      {step === "scanning" ? (
        <div role="status" aria-live="polite" style={{ ...card, padding: "22px 16px", textAlign: "center" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 10, backgroundColor: M.paper, fontSize: 12.5, color: M.raisin, maxWidth: "100%" }}>
            <FileText size={15} strokeWidth={2} color={M.taupe} aria-hidden="true" />
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{srcName}</span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: M.raisin, marginTop: 16 }}>Reading the document…</div>
          <div style={{ fontSize: 12, color: M.ink, marginTop: 4 }}>{slow ? "Taking longer than usual. You can keep waiting or cancel." : "This usually takes under a minute."}</div>
          <div aria-hidden="true" style={{ height: 6, margin: "16px auto 0", maxWidth: 240, borderRadius: 999, backgroundColor: M.divider, overflow: "hidden" }}>
            <div className="scan-bar" style={{ height: "100%", width: "40%", backgroundColor: M.taupe, borderRadius: 999, animation: "scanSlide 1.4s ease-in-out infinite alternate" }} />
          </div>
          <style>{"@keyframes scanSlide{from{transform:translateX(-30%)}to{transform:translateX(160%)}}@media (prefers-reduced-motion:reduce){.scan-bar{animation:none!important;width:60%!important}}"}</style>
          <button type="button" onClick={reset} style={{ ...ghost, height: 40, padding: "0 18px", marginTop: 16 }}>Cancel</button>
        </div>
      ) : null}

      {step === "fail" ? (
        <div role="alert" style={{ ...card, padding: "22px 16px", textAlign: "center" }}>
          <div style={{ width: 46, height: 46, margin: "0 auto", borderRadius: "50%", backgroundColor: M_ACCENT.danger.bg, display: "flex", alignItems: "center", justifyContent: "center" }}><FileWarning size={22} strokeWidth={1.9} color={M_ACCENT.danger.fg} aria-hidden="true" /></div>
          <div style={{ fontSize: 15, fontWeight: 700, color: M.raisin, marginTop: 12 }}>Couldn’t read this document</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, color: M.ink, marginTop: 4, overflowWrap: "anywhere" }}>{failText || "The image may be blurred, cropped or too dark."} Try again, or choose a clearer file.</div>
          <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
            {file && !fileProblem(file) ? <button type="button" onClick={() => void startScan(file)} style={primary}>Retry</button> : null}
            <button type="button" onClick={reset} style={ghost}>Choose another file</button>
          </div>
        </div>
      ) : null}

      {step === "choose" ? (
        <div>
          <div style={{ fontSize: 12.5, color: M.ink, lineHeight: 1.5 }}>{found.length} purchase orders were found in this file. Review and create them one at a time.</div>
          <div style={{ ...card, marginTop: 10, padding: "0 14px" }}>
            {found.map((f, i) => {
              const m = madeFor(f.docIdx);
              const finished = !!m && !hasOpenFollowUps(m);
              return (
                <button key={f.docIdx} type="button" disabled={finished} onClick={() => (m ? openFinish(m) : reviewPo(f))} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, minHeight: 56, padding: "8px 0", border: "none", borderTop: i ? `1px solid ${M.divider}` : "none", background: "none", fontFamily: "inherit", textAlign: "left", cursor: finished ? "default" : "pointer" }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: M.raisin, overflowWrap: "anywhere" }}>{f.po.customerPO || "PO number not found"}</span>
                    <span style={{ display: "block", fontSize: 12, color: M.ink, overflowWrap: "anywhere" }}>{f.po.customerName || "Customer not found"} · {f.po.items?.length ?? 0} line{(f.po.items?.length ?? 0) === 1 ? "" : "s"}</span>
                  </span>
                  {m ? <Tag kind="check">{finished ? `Draft ${m.soNo}` : `Finish ${m.soNo}`}</Tag> : <ChevronRight size={16} strokeWidth={2} color={M.taupe} aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {step === "review" && draft && pick && flags ? (
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
              ? <img src={srcHref} alt="Scanned customer PO" style={{ display: "block", width: "100%", maxHeight: 320, objectFit: "contain", marginTop: 8, borderRadius: 12, backgroundColor: M.divider }} />
              : <a href={srcHref} target="_blank" rel="noreferrer" style={{ display: "block", marginTop: 8, padding: "12px", borderRadius: 12, backgroundColor: M.divider, color: M.taupe, fontSize: 13, fontWeight: 700, textAlign: "center" }}>Open the PDF in a new tab</a>
          ) : null}

          {flags.missingCount + flags.checkCount > 0 ? (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10, padding: "10px 12px", borderRadius: 12, backgroundColor: M_ACCENT.warning.bg, fontSize: 12, lineHeight: 1.45, color: "#3A352C" }}>
              <TriangleAlert size={14} strokeWidth={2} color={M_ACCENT.warning.fg} style={{ flex: "none", marginTop: 1 }} aria-hidden="true" />
              <span>
                {flags.missingCount ? `${flags.missingCount} field${flags.missingCount === 1 ? "" : "s"} not found` : ""}{flags.missingCount && flags.checkCount ? " · " : ""}{flags.checkCount ? `${flags.checkCount} value${flags.checkCount === 1 ? "" : "s"} to check` : ""}. Compare with the source document and correct before creating.
              </span>
            </div>
          ) : null}

          <div style={{ ...sectionLabel, marginTop: 12 }}>DETAILS</div>
          <div style={{ ...card, padding: "4px 14px", marginTop: 8 }}>
            <Field first label="Customer" flag={flags.missing.has("customerId") ? "missing" : undefined} hint={draft.customerName ? `Document says: ${draft.customerName}` : undefined}>
              <select value={draft.customerId} onChange={(e) => patch({ customerId: e.target.value, hubId: "" })} aria-label="Customer" style={input(flags.missing.has("customerId") ? "missing" : undefined)}>
                <option value="">{flags.missing.has("customerId") ? "Not found — choose the customer" : "Choose the customer"}</option>
                {(cat?.customers ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Delivery hub" flag={flags.hubCheck ? "check" : undefined} hint={customer && customer.hubs.length === 0 ? "This customer has no delivery hubs set up." : "Leave blank and the system picks the customer’s hub for its state, or its default hub."}>
              <select value={draft.hubId} onChange={(e) => patch({ hubId: e.target.value })} disabled={!customer || customer.hubs.length === 0} aria-label="Delivery hub" style={input(flags.hubCheck ? "check" : undefined)}>
                <option value="">{customer ? "Let the system choose" : "Choose the customer first"}</option>
                {(customer?.hubs ?? []).map((h) => <option key={h.id} value={h.id}>{h.shortName}{h.state ? ` · ${h.state}` : ""}</option>)}
              </select>
            </Field>
            <Field label="Customer PO number" flag={flags.missing.has("customerPO") ? "missing" : undefined}>
              <input value={draft.customerPO} onChange={(e) => patch({ customerPO: e.target.value })} placeholder={flags.missing.has("customerPO") ? "Not found — enter manually" : ""} aria-label="Customer PO number" style={input(flags.missing.has("customerPO") ? "missing" : undefined)} />
            </Field>
            <Field label="Customer delivery date" flag={flags.missing.has("deliveryDate") ? "missing" : undefined}>
              <input type="date" value={draft.deliveryDate} onChange={(e) => patch({ deliveryDate: e.target.value })} aria-label="Customer delivery date" style={input(flags.missing.has("deliveryDate") ? "missing" : undefined)} />
            </Field>
            <Field label="Customer reference">
              <input value={draft.reference} onChange={(e) => patch({ reference: e.target.value })} aria-label="Customer reference" style={input()} />
            </Field>
            <Field label="Customer SO number">
              <input value={draft.customerSO} onChange={(e) => patch({ customerSO: e.target.value })} aria-label="Customer SO number" style={input()} />
            </Field>
            <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: `1px solid ${M.divider}`, fontSize: 13, color: M.raisin }}>
              <input type="checkbox" checked={draft.isUrgent} onChange={(e) => patch({ isUrgent: e.target.checked })} style={{ width: 18, height: 18, accentColor: "var(--m-taupe)" }} />
              Urgent order
            </label>
          </div>

          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 14 }}>
            <span style={sectionLabel}>ORDER ITEMS</span>
            <span style={{ fontSize: 12, color: M.muted }}>{draft.items.length} line{draft.items.length === 1 ? "" : "s"}</span>
          </div>
          <div style={{ ...card, padding: "0 14px", marginTop: 8 }}>
            {draft.items.length === 0 ? <div style={{ padding: "16px 0", fontSize: 13, color: M.ink }}>No items left. Go back and scan again, or cancel.</div> : null}
            {draft.items.map((it, idx) => (
              <SoLineEditor
                key={it.key}
                item={it}
                index={idx}
                catalog={cat}
                onChange={(p) => patchItem(it.key, p)}
                onRemove={() => setDraft((d) => (d ? { ...d, items: d.items.filter((x) => x.key !== it.key) } : d))}
                onSplit={() => setDraft((d) => (d ? { ...d, items: splitSofaLine(d.items, it.key) } : d))}
              />
            ))}
          </div>
          {draft.items.length > 0 ? (
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginTop: 10, padding: "0 4px" }}>
              <span style={{ fontSize: 12.5, color: M.ink }}>{priced.length === draft.items.length ? "Estimated total" : "Estimated total (priced lines only)"}</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: M.raisin, ...TNUM }}>{rm(total)}</span>
            </div>
          ) : null}
          <div style={{ fontSize: 11.5, color: M.muted, marginTop: 12, textAlign: "center" }}>Saved as a draft for you to finish. Prices left blank use the system price list.</div>

          <div style={{ position: "sticky", bottom: 0, zIndex: 2, margin: "14px -16px 0", padding: "10px 16px 6px", borderTop: `1px solid ${M.border}`, backgroundColor: M.paper }}>
            {createError || stops.length ? <div role="alert" style={{ fontSize: 12, color: M_ACCENT.danger.fg, marginBottom: 8, overflowWrap: "anywhere" }}>{createError || stops[0]}</div> : null}
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={onClose} disabled={busy} style={{ ...ghost, height: 46, padding: "0 16px", flex: "none" }}>Cancel</button>
              <button type="button" onClick={() => void createOrder()} disabled={busy || stops.length > 0} style={{ ...primary, height: 46, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", opacity: busy || stops.length ? 0.55 : 1, cursor: busy || stops.length ? "default" : "pointer" }}>{busy ? "Creating draft…" : "Create Sales Order"}</button>
            </div>
          </div>
        </div>
      ) : null}

      {step === "done" && result ? (
        <div role="status" style={{ ...card, padding: "24px 16px", textAlign: "center" }}>
          <div style={{ width: 48, height: 48, margin: "0 auto", borderRadius: "50%", backgroundColor: M_ACCENT.moss.bg, display: "flex", alignItems: "center", justifyContent: "center" }}><CircleCheck size={24} strokeWidth={1.9} color={M_ACCENT.moss.fg} aria-hidden="true" /></div>
          <div style={{ fontSize: 15, fontWeight: 700, color: M.raisin, marginTop: 12 }}>Draft Sales Order created</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: M.taupe, marginTop: 4, ...TNUM }}>{result.soNo}</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, color: M.ink, marginTop: 6 }}>Saved as a draft. It has not been confirmed — confirming it from the order page is what starts production and purchasing.</div>
          {result.warning ? <div role="alert" style={{ marginTop: 10, padding: "9px 12px", borderRadius: 12, backgroundColor: M_ACCENT.warning.bg, color: "#3A352C", fontSize: 12, lineHeight: 1.45, textAlign: "left", overflowWrap: "anywhere" }}>{result.warning}</div> : null}
          {following ? <div role="status" style={{ marginTop: 10, fontSize: 12, color: M.ink }}>Finishing up: attaching the scanned document…</div> : null}
          {!following && rec && hasOpenFollowUps(rec) ? (
            <div role="alert" style={{ marginTop: 10, padding: "9px 12px", borderRadius: 12, backgroundColor: M_ACCENT.warning.bg, color: "#3A352C", fontSize: 12, lineHeight: 1.45, textAlign: "left" }}>
              The order is saved, but {FOLLOW_ORDER.filter((k) => rec.follow[k] === "failed" || rec.follow[k] === "todo").length === 1 ? "one step" : "some steps"} after it did not finish:
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {FOLLOW_ORDER.filter((k) => rec.follow[k] === "failed" || rec.follow[k] === "todo").map((k) => <li key={k}>{FOLLOW_LABEL[k]}{rec.follow[k] === "todo" ? " (waiting)" : ""}</li>)}
              </ul>
              {failedKeys(rec).includes("original") && !file ? <div style={{ marginTop: 4 }}>If this keeps failing, attach the document from the order page.</div> : null}
              <button type="button" onClick={() => void finishFollowUps(rec)} style={{ ...ghost, height: 38, padding: "0 16px", marginTop: 8 }}>Retry the failed steps</button>
            </div>
          ) : null}
          <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
            <button type="button" onClick={() => { onClose(); navigate(`/m/sales/${encodeURIComponent(result.id)}`); }} style={primary}>Open sales order</button>
            <button type="button" onClick={() => (found.some((f) => !madeFor(f.docIdx)) ? setStep("choose") : reset())} style={ghost}>{found.some((f) => !madeFor(f.docIdx)) ? "Review the next PO" : "Scan another"}</button>
          </div>
        </div>
      ) : null}
    </SheetFrame>
  );
}
