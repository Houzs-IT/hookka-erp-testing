// Scan a bill / receipt → editable review → DRAFT Payment Voucher (Home "Scan to Create", Payment Voucher tile).
// The desktop Payment Vouchers "Scan" on the phone:
//   file → POST /api/scan-finance/extract (SYNCHRONOUS, one file, `docs[]`; gate accounting:create) → review (payee, dates,
//   bill, paid-from, account lines learned from what finance saved before, SST as its own line, "already on the books"
//   warning) → POST /api/accounting/payment-vouchers with saveAs:"draft" → the original attached to the voucher.
// A scan NEVER prepares, checks, approves, posts or settles anything: a DRAFT has no number and no ledger legs, and every
// step after it is an explicit tap on the voucher by a user who holds that permission.
// Differences from the Sales Order / Invoice / Receipt scans, said plainly: the extraction is not on the scan queue, so a
// read result cannot be recovered after this sheet closes (reading again is one more OCR call); and the create endpoint has
// carries an Idempotency-Key (the server replays the first answer for a retry of the same body and refuses a second live voucher
// with the same payee + bill number); after an UNKNOWN outcome the sheet also looks for the same draft in the voucher list and
// adopts it, in case a server did not honour the key.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Camera, ChevronDown, CircleCheck, FileImage, FileText, FileWarning, Info, TriangleAlert, Upload } from "lucide-react";
import { usePermissions } from "@/lib/use-permission";
import { M, M_ACCENT } from "../../theme";
import { mutateJson, refreshList } from "../../config/mutate";
import { fileProblem, idempotencyKeyFor, type IdemStore } from "../../lib/scan-so";
import { buildMemory, buildPvCard, EMPTY_MEMORY, findDraftTwin, scanBlockers, type FinanceDoc, type PvCard, type ScanMemory } from "../../lib/scan-pv";
import { pvBody, type PvForm, type PvRaw } from "../../lib/pv-mobile";
import { SheetFrame } from "../dashboard/home-ui";
import { card, ghost, primary } from "../so/so-style";
import { SourceButton } from "../procurement/ScanPiSheet";
import { PvFormFields } from "./pv-ui";
import { attachPvFileOnce, useCoa } from "./pv-data";

type Step = "pick" | "scanning" | "fail" | "choose" | "review" | "done";
type Found = { doc: FinanceDoc; idx: number };
type Saved = { id: string; pvNo: string; adopted: boolean };

const rowsOf = (j: unknown): PvRaw[] => {
  const d = Array.isArray(j) ? j : (j as { data?: unknown } | null)?.data;
  return Array.isArray(d) ? (d as PvRaw[]) : [];
};
const getRows = async (url: string): Promise<PvRaw[]> => {
  try {
    const res = await fetch(url, { credentials: "include", cache: "no-store" });
    return res.ok ? rowsOf(await res.json().catch(() => null)) : [];
  } catch {
    return [];
  }
};
const todayIso = (): string => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

export function ScanPvSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const { coa, loading: coaLoading, failed: coaFailed } = useCoa();
  const [step, setStep] = useState<Step>("pick");
  const [file, setFile] = useState<File | null>(null);
  const [failText, setFailText] = useState("");
  const [slow, setSlow] = useState(false);
  const [found, setFound] = useState<Found[]>([]);
  const [made, setMade] = useState<Record<number, Saved>>({});
  const [current, setCurrent] = useState<Found | null>(null);
  const [form, setFormState] = useState<PvCard | null>(null);
  const [srcOpen, setSrcOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<Saved | null>(null);
  const [attachError, setAttachError] = useState("");
  const memoryRef = useRef<ScanMemory>(EMPTY_MEMORY);
  const abortRef = useRef<AbortController | null>(null);
  const ambiguousRef = useRef(false);
  const idemRef = useRef<IdemStore>({ body: null, key: null });
  const camRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fileUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl); }, [fileUrl]);
  useEffect(() => () => { abortRef.current?.abort(); if (slowTimer.current) clearTimeout(slowTimer.current); }, []);

  const reset = () => {
    abortRef.current?.abort();
    if (slowTimer.current) clearTimeout(slowTimer.current);
    setFile(null); setFound([]); setMade({}); setCurrent(null); setFormState(null); setSaved(null); setError(""); setAttachError(""); setBusy(false); setSlow(false); setFailText("");
    ambiguousRef.current = false;
    setStep("pick");
  };

  const openDoc = (f: Found, f2: File | null = file) => {
    const card0 = buildPvCard(f.doc, memoryRef.current, coa, { today: todayIso(), fileName: f2?.name ?? "scan" });
    if (!card0) { setFailText("No amount was read from this bill."); setStep("fail"); return; }
    setCurrent(f); setFormState(card0); setError(""); setAttachError(""); setSrcOpen(false); ambiguousRef.current = false; idemRef.current = { body: null, key: null }; setSaved(null);
    setStep("review");
  };

  /** One OCR call. Cancel aborts it; the result is held in this sheet only. */
  const start = async (f: File) => {
    const problem = fileProblem(f, { heic: true });
    setFile(f);
    setFailText(""); setSlow(false);
    if (problem) { setFailText(problem); setStep("fail"); return; }
    setStep("scanning");
    const ac = new AbortController();
    abortRef.current = ac;
    // eslint-disable-next-line no-restricted-syntax -- one-off "taking longer than usual" hint inside an async handler, cleared on every exit
    slowTimer.current = setTimeout(() => setSlow(true), 45000);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const [res, vouchers, bills, invoices] = await Promise.all([
        fetch("/api/scan-finance/extract", { method: "POST", body: fd, credentials: "include", signal: ac.signal }),
        getRows("/api/accounting/payment-vouchers"),
        getRows("/api/accounting/other-party-bills?type=CREDITOR"),
        hasPermission("purchase-invoices", "read") ? getRows("/api/purchase-invoices") : Promise.resolve([] as PvRaw[]),
      ]);
      const j = (await res.json().catch(() => null)) as { success?: boolean; error?: string; data?: { docs?: FinanceDoc[] } & FinanceDoc } | null;
      if (slowTimer.current) clearTimeout(slowTimer.current);
      if (!res.ok || !j?.success || !j.data) {
        setFailText(res.status === 403 ? "Your role cannot scan bills (it needs permission to create accounting records)." : j?.error || `The document could not be read (HTTP ${res.status}).`);
        setStep("fail");
        return;
      }
      memoryRef.current = buildMemory(vouchers, bills, invoices);
      const docs = j.data.docs?.length ? j.data.docs : [j.data];
      const list = docs.map((doc, idx) => ({ doc, idx })).filter(({ doc }) => (doc.lines ?? []).length > 0 || (doc.totalSen ?? 0) > 0);
      if (list.length === 0) { setFailText("No amount was read from this document."); setStep("fail"); return; }
      setFound(list);
      if (list.length === 1) openDoc(list[0], f);
      else setStep("choose");
    } catch (e) {
      if (slowTimer.current) clearTimeout(slowTimer.current);
      if ((e as Error).name === "AbortError") return;
      setFailText(e instanceof Error ? e.message : "Network error while reading.");
      setStep("fail");
    }
  };

  const createDraft = async () => {
    const c = form;
    const cur = current;
    if (!c || !cur || busy) return;
    const stops = scanBlockers(c, coa);
    if (stops.length) { setError(stops[0]); return; }
    setBusy(true);
    setError("");
    const body = pvBody(c as PvForm, true);
    // After an unknown outcome, look before sending again: the same draft may already exist.
    if (ambiguousRef.current) {
      const twin = findDraftTwin(await getRows("/api/accounting/payment-vouchers"), body);
      if (twin) { await finish({ id: String(twin.id), pvNo: String(twin.pvNo ?? ""), adopted: true }, cur); return; }
    }
    // The server de-duplicates on this key (a retry of the same body replays the first answer), and refuses a second live
    // voucher with the same payee + bill number. The look-for-the-draft step stays for the case where the key was not honoured.
    const key = idempotencyKeyFor(idemRef.current, body, () => crypto.randomUUID());
    const res = await mutateJson<{ data?: { id?: string; pvNo?: string } }>("/api/accounting/payment-vouchers", "POST", body, { "Idempotency-Key": key });
    if (!res.ok) {
      setBusy(false);
      if (res.status === 0 || res.status >= 500) {
        ambiguousRef.current = true;
        setError(`${res.error || "The voucher could not be saved."} It may have been saved — tapping Save draft voucher again checks for it first, so it won't be made twice.`);
      } else setError(res.error || "The voucher could not be saved.");
      return;
    }
    const data = res.body?.data;
    if (!data?.id) {
      ambiguousRef.current = true;
      setBusy(false);
      setError("The server did not confirm the new voucher. Tap Save draft voucher again — it checks for the draft first.");
      return;
    }
    await finish({ id: data.id, pvNo: data.pvNo ?? "", adopted: false }, cur);
  };

  const finish = async (s: Saved, cur: Found) => {
    refreshList("/api/accounting/payment-vouchers");
    setMade((m) => ({ ...m, [cur.idx]: s }));
    setSaved(s);
    setBusy(false);
    setStep("done");
    if (file) {
      const r = await attachPvFileOnce(s.id, file);
      setAttachError(r.ok ? "" : r.error);
    }
  };

  const retryAttach = async () => {
    if (!saved || !file) return;
    setBusy(true);
    const r = await attachPvFileOnce(saved.id, file);
    setAttachError(r.ok ? "" : r.error);
    setBusy(false);
  };

  const onFile = (f: File | undefined) => { if (f) void start(f); };
  const stops = form ? scanBlockers(form, coa) : [];
  const back = step === "review" ? () => (found.length > 1 ? setStep("choose") : reset()) : step === "choose" || step === "fail" ? reset : undefined;
  const srcImage = !!file && file.type.startsWith("image/");
  const canUpload = hasPermission("accounting", "update");
  const waitingCoa = coaLoading && coa.length === 0;

  return (
    <SheetFrame open={open} title="Scan Payment Voucher" sub={step === "pick" ? "Prepares a draft voucher" : undefined} onBack={back} onClose={onClose}>
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />

      {step === "pick" ? (
        <div>
          <div style={{ display: "grid", gap: 10 }}>
            <SourceButton label="Take photo" desc="Use the camera to capture the bill or receipt" icon={Camera} onClick={() => camRef.current?.click()} />
            <SourceButton label="Upload image or PDF" desc="Choose a photo or PDF from this device" icon={Upload} onClick={() => fileRef.current?.click()} />
          </div>
          {coaFailed ? <div role="alert" style={{ marginTop: 10, fontSize: 12, color: M_ACCENT.danger.fg }}>The chart of accounts could not be loaded, so accounts can't be picked. Try again in a moment.</div> : null}
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 12, padding: "10px 12px", borderRadius: 12, backgroundColor: M.divider, fontSize: 12, lineHeight: 1.45, color: M.ink }}>
            <Info size={14} strokeWidth={2} color={M.taupe} style={{ flex: "none", marginTop: 1 }} aria-hidden="true" />
            <span>Scanning only saves a draft voucher with no number and no ledger entries. It is never prepared, checked, approved, posted or settled by a scan. A PDF or a photo, up to 32 MB. Reading is one OCR call; if you close this sheet before saving, the read result is lost.</span>
          </div>
        </div>
      ) : null}

      {step === "scanning" ? (
        <div role="status" aria-live="polite" style={{ ...card, padding: "22px 16px", textAlign: "center" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 10, backgroundColor: M.paper, fontSize: 12.5, color: M.raisin, maxWidth: "100%" }}>
            <FileText size={15} strokeWidth={2} color={M.taupe} aria-hidden="true" />
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{file?.name}</span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: M.raisin, marginTop: 16 }}>Reading the document…</div>
          <div style={{ fontSize: 12, color: M.ink, marginTop: 4 }}>{slow ? "Taking longer than usual. You can keep waiting or cancel." : "This usually takes under a minute."}</div>
          <button type="button" onClick={reset} style={{ ...ghost, height: 40, padding: "0 18px", marginTop: 16 }}>Cancel</button>
        </div>
      ) : null}

      {step === "fail" ? (
        <div role="alert" style={{ ...card, padding: "22px 16px", textAlign: "center" }}>
          <div style={{ width: 46, height: 46, margin: "0 auto", borderRadius: "50%", backgroundColor: M_ACCENT.danger.bg, display: "flex", alignItems: "center", justifyContent: "center" }}><FileWarning size={22} strokeWidth={1.9} color={M_ACCENT.danger.fg} aria-hidden="true" /></div>
          <div style={{ fontSize: 15, fontWeight: 700, color: M.raisin, marginTop: 12 }}>Couldn’t read this document</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, color: M.ink, marginTop: 4, overflowWrap: "anywhere" }}>{failText || "The image may be blurred, cropped or too dark."} Try again (that reads it again), or choose a clearer file.</div>
          <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
            {file ? <button type="button" onClick={() => void start(file)} style={primary}>Read again</button> : null}
            <button type="button" onClick={reset} style={ghost}>Choose another file</button>
          </div>
        </div>
      ) : null}

      {step === "choose" ? (
        <div>
          <div style={{ fontSize: 12.5, color: M.ink, lineHeight: 1.5 }}>{found.length} bills were found in this file. Review and save them one at a time.</div>
          <div style={{ ...card, marginTop: 10, padding: "0 14px" }}>
            {found.map((f, i) => {
              const m = made[f.idx];
              return (
                <button key={f.idx} type="button" disabled={!!m} onClick={() => openDoc(f)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, minHeight: 56, padding: "8px 0", border: "none", borderTop: i ? `1px solid ${M.divider}` : "none", background: "none", fontFamily: "inherit", textAlign: "left", cursor: m ? "default" : "pointer" }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: M.raisin, overflowWrap: "anywhere" }}>{f.doc.docNo || "Number not found"}</span>
                    <span style={{ display: "block", fontSize: 12, color: M.ink, overflowWrap: "anywhere" }}>{f.doc.partyName || "Payee not found"} · {f.doc.lines?.length ?? 0} line{(f.doc.lines?.length ?? 0) === 1 ? "" : "s"}</span>
                  </span>
                  {m ? <span style={{ fontSize: 11.5, fontWeight: 700, color: M_ACCENT.moss.fg }}>Draft saved</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {step === "review" && form && current ? (
        <div>
          <button type="button" onClick={() => setSrcOpen((v) => !v)} aria-expanded={srcOpen} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: `1px solid ${M.border}`, borderRadius: 12, backgroundColor: M.card, fontFamily: "inherit", textAlign: "left", cursor: "pointer" }}>
            {srcImage ? <FileImage size={16} strokeWidth={2} color={M.taupe} aria-hidden="true" /> : <FileText size={16} strokeWidth={2} color={M.taupe} aria-hidden="true" />}
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{file?.name}</span>
              <span style={{ display: "block", fontSize: 11.5, color: M.muted }}>View source document</span>
            </span>
            <ChevronDown size={16} strokeWidth={2} color={M.taupe} style={{ transform: srcOpen ? "rotate(180deg)" : "none" }} aria-hidden="true" />
          </button>
          {srcOpen && fileUrl ? (
            srcImage
              ? <img src={fileUrl} alt="Scanned bill" style={{ display: "block", width: "100%", maxHeight: 320, objectFit: "contain", marginTop: 8, borderRadius: 12, backgroundColor: M.divider }} />
              : <a href={fileUrl} target="_blank" rel="noreferrer" style={{ display: "block", marginTop: 8, padding: 12, borderRadius: 12, backgroundColor: M.divider, color: M.taupe, fontSize: 13, fontWeight: 700, textAlign: "center" }}>Open the PDF in a new tab</a>
          ) : null}
          {[
            form.duplicateOf ? `This bill number is already on our books (${form.duplicateOf}). Check it is not a duplicate before saving.` : "",
            waitingCoa ? "Loading the chart of accounts…" : "",
            ...(coaFailed ? ["The chart of accounts could not be loaded — accounts can't be picked until it does."] : []),
          ].filter(Boolean).map((t) => (
            <div key={t} role="note" style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10, padding: "10px 12px", borderRadius: 12, backgroundColor: M_ACCENT.warning.bg, fontSize: 12, lineHeight: 1.45, color: "#3A352C" }}>
              <TriangleAlert size={14} strokeWidth={2} color={M_ACCENT.warning.fg} style={{ flex: "none", marginTop: 1 }} aria-hidden="true" />
              <span>{t}</span>
            </div>
          ))}
          <div style={{ height: 12 }} />
          <PvFormFields form={form} setForm={(f) => setFormState({ ...form, ...f })} coa={coa} meta={form.meta} />
          <div style={{ fontSize: 11.5, color: M.muted, marginTop: 12, textAlign: "center" }}>Saved as a draft: no number yet, nothing posted. Prepare, check and approve it from the voucher, one step at a time.</div>
          <div style={{ position: "sticky", bottom: 0, zIndex: 2, margin: "14px -16px 0", padding: "10px 16px 6px", borderTop: `1px solid ${M.border}`, backgroundColor: M.paper }}>
            {error || stops.length ? <div role="alert" style={{ fontSize: 12, color: M_ACCENT.danger.fg, marginBottom: 8, overflowWrap: "anywhere" }}>{error || stops[0]}</div> : null}
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={onClose} disabled={busy} style={{ ...ghost, height: 46, padding: "0 16px", flex: "none" }}>Cancel</button>
              <button type="button" onClick={() => void createDraft()} disabled={busy || stops.length > 0} style={{ ...primary, height: 46, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", opacity: busy || stops.length ? 0.55 : 1, cursor: busy || stops.length ? "default" : "pointer" }}>{busy ? "Saving draft…" : "Save draft voucher"}</button>
            </div>
          </div>
        </div>
      ) : null}

      {step === "done" && saved ? (
        <div role="status" style={{ ...card, padding: "24px 16px", textAlign: "center" }}>
          <div style={{ width: 48, height: 48, margin: "0 auto", borderRadius: "50%", backgroundColor: M_ACCENT.moss.bg, display: "flex", alignItems: "center", justifyContent: "center" }}><CircleCheck size={24} strokeWidth={1.9} color={M_ACCENT.moss.fg} aria-hidden="true" /></div>
          <div style={{ fontSize: 15, fontWeight: 700, color: M.raisin, marginTop: 12 }}>{saved.adopted ? "This draft voucher already existed" : "Draft Payment Voucher saved"}</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, color: M.ink, marginTop: 6 }}>{saved.adopted ? "The earlier save had gone through, so no second voucher was made. " : ""}It is a draft: no number yet and nothing posted. Prepare, check and approve it from the voucher.</div>
          {busy ? <div role="status" style={{ marginTop: 10, fontSize: 12, color: M.ink }}>Attaching the document…</div> : null}
          {!busy && attachError ? (
            <div role="alert" style={{ marginTop: 10, padding: "9px 12px", borderRadius: 12, backgroundColor: M_ACCENT.warning.bg, color: "#3A352C", fontSize: 12, lineHeight: 1.45, textAlign: "left", overflowWrap: "anywhere" }}>
              The voucher is saved, but the scanned document could not be attached ({attachError}). {canUpload ? "" : "Your role cannot upload files here. "}You can also add it later from the voucher.
              <button type="button" onClick={() => void retryAttach()} style={{ ...ghost, height: 38, padding: "0 16px", marginTop: 8, display: "block" }}>Retry attaching</button>
            </div>
          ) : null}
          <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
            <button type="button" onClick={() => { onClose(); navigate(`/m/finance/vouchers/${encodeURIComponent(saved.id)}`); }} style={primary}>Open voucher</button>
            <button type="button" onClick={() => (found.some((f) => !made[f.idx]) ? setStep("choose") : reset())} style={ghost}>{found.some((f) => !made[f.idx]) ? "Review the next bill" : "Scan another"}</button>
          </div>
        </div>
      ) : null}
    </SheetFrame>
  );
}
