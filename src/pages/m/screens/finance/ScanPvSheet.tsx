// Scan a bill / receipt → editable review → DRAFT Payment Voucher (Home "Scan to Create", Payment Voucher tile, and the
// Payment Vouchers list). Batch 3 prototype "Scan to create": a full page with a four-step bar (pick → reading → review →
// done), plus the fail and choose-a-bill states; the review body is the Edit voucher page's own fields.
// The desktop Payment Vouchers "Scan" on the phone:
//   file → POST /api/scan-finance/extract (SYNCHRONOUS, one file, `docs[]`; gate accounting:create) → review (payee, dates,
//   bill, paid-from, account lines learned from what finance saved before, SST as its own line, "already on the books"
//   warning) → POST /api/accounting/payment-vouchers with saveAs:"draft" → the original attached to the voucher.
// A scan NEVER prepares, checks, approves, posts or settles anything: a DRAFT has no number and no ledger legs, and every
// step after it is an explicit tap on the voucher by a user who holds that permission.
// Differences from the Sales Order / Invoice / Receipt scans, said plainly: the extraction is not on the scan queue, so a
// read result cannot be recovered after this page closes (reading again is one more OCR call); and the create endpoint
// carries an Idempotency-Key (the server replays the first answer for a retry of the same body); after an UNKNOWN outcome
// the page also looks for the same draft in the voucher list and adopts it, in case a server did not honour the key.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Camera, CircleAlert, CircleCheck, Copy, FileText, Files, FileX, Info, RotateCw, ScanLine, TriangleAlert, Upload } from "lucide-react";
import { usePermissions } from "@/lib/use-permission";
import { mutateJson, refreshList } from "../../config/mutate";
import { fileProblem, idempotencyKeyFor, type IdemStore } from "../../lib/scan-so";
import { buildMemory, buildPvCard, EMPTY_MEMORY, findDraftTwin, scanBlockers, type FinanceDoc, type PvCard, type ScanMemory } from "../../lib/scan-pv";
import { pvBody, pvFormTotalSen, type PvForm, type PvRaw } from "../../lib/pv-mobile";
import { F, rm } from "./fin-format";
import { FinPage, PageBanner, PageBusy, PageDoc, PagePick } from "./fin-overlay";
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
const sizeOf = (f: File | null): string => (!f ? "" : f.size >= 1048576 ? `${(f.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(f.size / 1024))} KB`);

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
  const [tried, setTried] = useState(false);
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
    setFile(null); setFound([]); setMade({}); setCurrent(null); setFormState(null); setSaved(null); setError(""); setAttachError(""); setBusy(false); setSlow(false); setFailText(""); setTried(false);
    ambiguousRef.current = false;
    setStep("pick");
  };

  const openDoc = (f: Found, f2: File | null = file) => {
    const card0 = buildPvCard(f.doc, memoryRef.current, coa, { today: todayIso(), fileName: f2?.name ?? "scan" });
    if (!card0) { setFailText("No amount was read from this bill."); setStep("fail"); return; }
    setCurrent(f); setFormState(card0); setError(""); setAttachError(""); setSrcOpen(false); setTried(false); ambiguousRef.current = false; idemRef.current = { body: null, key: null }; setSaved(null);
    setStep("review");
  };

  /** One OCR call. Cancel aborts it; the result is held in this page only. */
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
    if (stops.length) { setTried(true); setError(stops[0]); return; }
    setBusy(true);
    setError("");
    const body = pvBody(c as PvForm, true);
    // After an unknown outcome, look before sending again: the same draft may already exist.
    if (ambiguousRef.current) {
      const twin = findDraftTwin(await getRows("/api/accounting/payment-vouchers"), body);
      if (twin) { await finish({ id: String(twin.id), pvNo: String(twin.pvNo ?? ""), adopted: true }, cur); return; }
    }
    // The server de-duplicates on this key (a retry of the same body replays the first answer). The look-for-the-draft step
    // stays for the case where the key was not honoured. (A server refusal of the same payee + bill number is held back.)
    const key = idempotencyKeyFor(idemRef.current, body, () => crypto.randomUUID());
    const res = await mutateJson<{ data?: { id?: string; pvNo?: string } }>("/api/accounting/payment-vouchers", "POST", body, { "Idempotency-Key": key });
    if (!res.ok) {
      setBusy(false);
      if (res.status === 0 || res.status >= 500) {
        ambiguousRef.current = true;
        setError(`${res.error || "The voucher could not be saved."} It may have been saved — tapping Save draft again checks for it first, so it won't be made twice.`);
      } else setError(res.error || "The voucher could not be saved.");
      return;
    }
    const data = res.body?.data;
    if (!data?.id) {
      ambiguousRef.current = true;
      setBusy(false);
      setError("The server did not confirm the new voucher. Tap Save draft again — it checks for the draft first.");
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
  const srcImage = !!file && file.type.startsWith("image/");
  const canUpload = hasPermission("accounting", "update");
  const waitingCoa = coaLoading && coa.length === 0;
  const unsaved = found.some((f) => !made[f.idx]);
  // The step bar: pick · reading (also fail / choose) · review · done.
  const at = step === "pick" ? 0 : step === "review" ? 2 : step === "done" ? 3 : 1;
  const steps = [0, 1, 2, 3].map((i) => i <= at);
  const title = step === "review" ? "Review draft" : step === "done" ? "Draft saved" : "Scan to create";
  const backToList = step === "review" && found.length > 1;
  const foot = step === "fail"
    ? { l: "Try again", onTap: reset }
    : step === "review" && form && current
      ? { l: busy ? "Saving draft…" : "Save draft", onTap: () => void createDraft(), disabled: busy }
      : step === "done" && saved
        ? { l: "Open draft", onTap: () => { onClose(); navigate(`/m/finance/vouchers/${encodeURIComponent(saved.id)}`); } }
        : null;

  return (
    <>
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
      <FinPage
        open={open}
        title={title}
        cancelL={step === "done" ? "Close" : backToList ? "Back" : "Cancel"}
        onCancel={backToList ? () => setStep("choose") : onClose}
        steps={steps}
        err={step === "review" ? error || (tried && stops.length ? stops[0] : "") : ""}
        foot={foot}
      >
        {step === "pick" ? (
          <>
            <PageBanner icon={Info} bg="#E0EDF0" fg="#1F4654" t="Scanning creates a Draft only — no number, nothing posted. You'll still prepare, check and approve it as usual. Reading is one OCR call; if you close this page before saving, the read result is lost." />
            <PagePick opts={[
              { key: "cam", l: "Take a photo", s: "Use the camera on the bill", icon: Camera, bg: F.cream, c: F.gold, onTap: () => camRef.current?.click() },
              { key: "up", l: "Upload a file", s: "Image or PDF, up to 32 MB", icon: Upload, bg: "#E3EAF5", c: "#2B5797", onTap: () => fileRef.current?.click() },
            ]} />
            {coaFailed ? <PageBanner icon={TriangleAlert} bg="#FBE7E3" fg={F.neg} t="The chart of accounts could not be loaded, so accounts can't be picked. Try again in a moment." /> : null}
          </>
        ) : null}

        {step === "scanning" ? (
          <>
            {file ? <PageDoc n={file.name} s={`Supporting document · ${sizeOf(file)}`} /> : null}
            <PageBusy t="Reading the bill…" s={slow ? "Taking longer than usual. You can keep waiting or cancel." : "This takes a few seconds."} />
          </>
        ) : null}

        {step === "fail" ? (
          <>
            <PageBanner icon={CircleAlert} bg="#FBE7E3" fg={F.neg} t={`${failText || "We couldn't read this bill."} Try a sharper photo with the whole page in view.`} />
            {file ? <PagePick opts={[{ key: "again", l: "Read it again", s: file.name, icon: RotateCw, bg: F.cream, c: F.gold, onTap: () => void start(file) }]} /> : null}
          </>
        ) : null}

        {step === "choose" ? (
          <>
            <PageBanner icon={Files} bg="#FAEFCB" fg="#85600F" t={`This file has ${found.length} bills. Review and save them one at a time.`} />
            <PagePick opts={found.map((f) => {
              const m = made[f.idx];
              const nl = f.doc.lines?.length ?? 0;
              return {
                key: String(f.idx),
                l: `${f.doc.partyName || "Payee not found"}${f.doc.totalSen ? ` · ${rm(f.doc.totalSen)}` : ""}`,
                s: m ? "Draft saved" : `Bill ${f.doc.docNo || "number not found"} · ${nl} line${nl === 1 ? "" : "s"}`,
                icon: m ? CircleCheck : FileText,
                bg: m ? "#EEF3E4" : F.cream,
                c: m ? F.pos : F.gold,
                disabled: !!m,
                onTap: m ? undefined : () => openDoc(f),
              };
            })} />
          </>
        ) : null}

        {step === "review" && form && current ? (
          <>
            {file ? <PageDoc n={file.name} s={`Supporting document · ${sizeOf(file)} · tap to ${srcOpen ? "hide" : "view"}`} onTap={() => setSrcOpen((v) => !v)} /> : null}
            {srcOpen && fileUrl ? (
              srcImage
                ? <img src={fileUrl} alt="Scanned bill" style={{ display: "block", width: "100%", maxHeight: 320, objectFit: "contain", borderRadius: 12, backgroundColor: F.track }} />
                : <a href={fileUrl} target="_blank" rel="noreferrer" style={{ display: "block", padding: 12, borderRadius: 12, backgroundColor: F.cream, color: F.gold, fontSize: 13, fontWeight: 700, textAlign: "center" }}>Open the PDF in a new tab</a>
            ) : null}
            {form.duplicateOf ? <PageBanner icon={Copy} bg="#FAEFCB" fg="#85600F" t={`Possible duplicate: this bill number is already on our books (${form.duplicateOf}). Check it is not a duplicate — you can still save.`} /> : null}
            {waitingCoa ? <PageBanner icon={Info} bg="#E0EDF0" fg="#1F4654" t="Loading the chart of accounts…" /> : null}
            {coaFailed ? <PageBanner icon={TriangleAlert} bg="#FBE7E3" fg={F.neg} t="The chart of accounts could not be loaded — accounts can't be picked until it does." /> : null}
            <PvFormFields form={form} setForm={(f) => setFormState({ ...form, ...f })} coa={coa} meta={form.meta} tried={tried} />
            <div style={{ fontSize: 11.5, color: F.muted, textAlign: "center", lineHeight: 1.45 }}>
              Saved as a draft ({rm(pvFormTotalSen(form))}): no number yet, nothing posted. Prepare, check and approve it from the voucher, one step at a time.
            </div>
          </>
        ) : null}

        {step === "done" && saved ? (
          <>
            <PageBanner icon={CircleCheck} bg="#EEF3E4" fg="#2F5E3C" t={saved.adopted ? "This draft voucher already existed — the earlier save had gone through, so no second voucher was made." : "Draft saved as No number yet — nothing posted."} />
            {busy ? <PageBanner icon={Info} bg="#E0EDF0" fg="#1F4654" t="Attaching the bill…" /> : null}
            {!busy && attachError ? (
              <>
                <PageBanner icon={FileX} bg="#FBE7E3" fg={F.neg} t={`The bill image didn't attach (${attachError}). Your draft is safe.${canUpload ? "" : " Your role cannot upload files here."}`} />
                <PagePick opts={[{ key: "retry", l: "Retry attaching", s: file?.name ?? "", icon: RotateCw, bg: F.cream, c: F.gold, onTap: () => void retryAttach() }]} />
              </>
            ) : null}
            <PagePick opts={[{
              key: "next",
              l: unsaved ? "Review the next bill" : "Scan another",
              s: unsaved ? "More bills were found in this file" : "Pick a photo or file",
              icon: unsaved ? Files : ScanLine,
              bg: F.cream,
              c: F.gold,
              onTap: () => (unsaved ? setStep("choose") : reset()),
            }]} />
          </>
        ) : null}
      </FinPage>
    </>
  );
}
