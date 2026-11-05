// useScanQueue — the phone side of the scan queue, shared by the document scan sheets (Purchase Invoice now;
// Goods Receipt next). It is the flow ScanSoSheet runs for customer POs, as a hook:
//   file → POST /api/scan-queue/upload → the browser DRIVES POST …/batch/:id/work and polls GET …/batch/:id
//   (a request the phone holds open for the whole OCR would die with the screen lock) → onRead(rawJson, row).
// Recovery: GET /api/scan-queue/pending lists this user's unfinished scans (reading it never starts a read). A
// finished one is reviewed from its stored result; one still pending or failed is continued ONLY by `continueReading`,
// which the sheet wires to a button, and only when it is alone in its batch.
// Nothing here creates a document.
import { useEffect, useMemo, useRef, useState } from "react";
import { useInterval } from "@/lib/scheduler";
import { createScanQueueDriver } from "@/lib/scan-queue-client";
import { fileProblem } from "../../lib/scan-so";
import { pendingDocViews, type DocKind, type DocRecord, type PendingDocView } from "../../lib/scan-doc-recovery";
import type { PendingRow } from "../../lib/scan-so-recovery";

export type QueueRow = { id: string; sampleId: string | null; fileName: string };
type Phase = "idle" | "scanning" | "failed";
const nowMs = (): number => Date.now();

export function useScanQueue<T>({
  kind, queueKind, docKind, docsOf, placeholder, records, onRead, prepare, allowHeic,
}: {
  /** The label used in messages. */
  kind: string;
  /** The queue's own kind (`supplier` for PI / GRN). */
  queueKind: "po" | "supplier";
  docKind: DocKind;
  docsOf: (rawJson: unknown) => { doc: T; docIdx: number }[];
  placeholder: (rec: DocRecord) => T;
  records: DocRecord[];
  /** A finished read: build the review. Return an error text to show the failure screen instead. */
  onRead: (rawJson: unknown, row: QueueRow) => string | null;
  /** Load whatever the review needs first (catalogue…); an error text stops the scan. */
  prepare: () => Promise<string | null>;
  allowHeic?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [failText, setFailText] = useState("");
  const [slow, setSlow] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [row, setRow] = useState<QueueRow>({ id: "", sampleId: null, fileName: "" });
  const [pendingRaw, setPendingRaw] = useState<{ batchId: string; items: PendingRow[] } | null>(null);
  const batchRef = useRef<{ batchId: string; rowId: string; startedAt: number } | null>(null);
  const driverRef = useRef<ReturnType<typeof createScanQueueDriver> | null>(null);
  const pollingRef = useRef(false);

  const fetchPending = async (): Promise<{ batchId: string; items: PendingRow[] }> => {
    try {
      const res = await fetch(`/api/scan-queue/pending?kind=${queueKind}`, { credentials: "include" });
      const j = (await res.json().catch(() => null)) as { success?: boolean; data?: { batchId: string | null; items?: PendingRow[] } } | null;
      if (!res.ok || !j?.success) return { batchId: "", items: [] };
      return { batchId: j.data?.batchId ?? "", items: j.data?.items ?? [] };
    } catch {
      return { batchId: "", items: [] };
    }
  };
  const loadPending = () => { void fetchPending().then(setPendingRaw); };

  // Open: look for unfinished scans (a GET only). Close: stop driving.
  useEffect(() => {
    void fetchPending().then(setPendingRaw);
    return () => { driverRef.current?.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const views: PendingDocView<T>[] | null = useMemo(
    () => (pendingRaw ? pendingDocViews<T>(pendingRaw.items, records, docKind, docsOf, placeholder) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pendingRaw, records],
  );

  const fail = (text: string) => { driverRef.current?.stop(); batchRef.current = null; setFailText(text); setPhase("failed"); };

  const poll = async () => {
    const b = batchRef.current;
    if (!b || pollingRef.current) return;
    pollingRef.current = true;
    try {
      const res = await fetch(`/api/scan-queue/batch/${encodeURIComponent(b.batchId)}`, { credentials: "include" });
      const j = (await res.json().catch(() => null)) as { success?: boolean; data?: { items?: { id: string; status: string; fileName: string; rawJson: unknown; error: string | null; sampleId: string | null }[] } } | null;
      if (!res.ok || !j?.success) {
        if (res.status === 401 || res.status === 403) fail("Your session or permission changed while reading. Sign in again and retry.");
        return; // a blip: the next tick asks again
      }
      const item = j.data?.items?.find((i) => i.id === b.rowId);
      if (!item) return;
      if (item.status === "done" || item.status === "cached") {
        if (item.rawJson == null) return;
        driverRef.current?.stop();
        batchRef.current = null;
        const r = { id: item.id, sampleId: item.sampleId ?? null, fileName: item.fileName };
        setRow(r);
        const err = await prepare();
        if (err) { fail(err); return; }
        const bad = onRead(item.rawJson, r);
        if (bad) fail(bad);
        else setPhase("idle");
      } else if (item.status === "failed") {
        fail(item.error ? `The document could not be read (${item.error.slice(0, 140)}).` : "The document could not be read.");
      } else {
        if (nowMs() - b.startedAt > 45000) setSlow(true);
        if (driverRef.current && driverRef.current.active() === 0) driverRef.current.poke();
      }
    } finally {
      pollingRef.current = false;
    }
  };
  useInterval(() => void poll(), phase === "scanning" ? 3000 : null);

  const drive = (batchId: string, rowId: string) => {
    batchRef.current = { batchId, rowId, startedAt: nowMs() };
    driverRef.current?.stop();
    driverRef.current = createScanQueueDriver(batchId, { concurrency: 1, onProcessed: () => void poll() });
    driverRef.current.poke();
    void poll(); // a file the queue has already read (same bytes scanned before) is ready at once
  };

  const start = async (f: File) => {
    setFile(f);
    setSlow(false);
    const problem = fileProblem(f, { heic: allowHeic });
    if (problem) { setFailText(problem); setPhase("failed"); return; }
    setPhase("scanning");
    const prepErr = await prepare();
    if (prepErr) { fail(prepErr); return; }
    try {
      const fd = new FormData();
      fd.append("kind", queueKind);
      fd.append("files", f);
      const res = await fetch("/api/scan-queue/upload", { method: "POST", body: fd, credentials: "include" });
      const j = (await res.json().catch(() => null)) as { success?: boolean; error?: string; data?: { batchId: string; items: { id: string }[] } } | null;
      if (!res.ok || !j?.success || !j.data?.items?.[0]) {
        fail(res.status === 403 ? `Your role cannot scan ${kind}s (it needs permission to create purchase orders).` : j?.error || `Upload failed (HTTP ${res.status}).`);
        return;
      }
      setRow({ id: j.data.items[0].id, sampleId: null, fileName: f.name });
      drive(j.data.batchId, j.data.items[0].id);
    } catch (e) {
      fail(e instanceof Error ? e.message : "Network error while uploading.");
    }
  };

  /** Continuing a read that never finished (or failed) IS one more OCR call, so it only happens on a tap. */
  const continueReading = async (v: PendingDocView<T>) => {
    const batchId = pendingRaw?.batchId;
    if (!batchId || !v.solo) return;
    setFile(null);
    setSlow(false);
    setRow({ id: v.rowId, sampleId: null, fileName: v.fileName });
    setPhase("scanning");
    const err = await prepare();
    if (err) { fail(err); return; }
    if (v.state === "failed") {
      const r = await fetch(`/api/scan-queue/${encodeURIComponent(v.rowId)}/retry`, { method: "POST", credentials: "include" });
      if (!r.ok) { fail(`The read could not be restarted (HTTP ${r.status}).`); return; }
    }
    drive(batchId, v.rowId);
  };

  /** Back to the start (also stops any read being driven from this phone). */
  const reset = () => {
    driverRef.current?.stop();
    batchRef.current = null;
    setPhase("idle");
    setFailText("");
    setSlow(false);
    setFile(null);
    setRow({ id: "", sampleId: null, fileName: "" });
    loadPending();
  };

  return { phase, failText, slow, file, row, setRow, setFile, views, start, continueReading, reset, loadPending };
}
