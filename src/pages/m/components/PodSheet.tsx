// ===========================================================================
// PodSheet — mobile Proof of Delivery capture (Build Spec: DO → Mark delivered →
// POD capture: signature + photos + time). PUT /api/delivery-orders/:id
// { proofOfDelivery: {receiverName, receiverIC, signatureDataUrl, photoIds[],
// remarks, capturedBy}, status: "DELIVERED" }. Backend attaches the proof +
// transitions the DO and auto-creates the invoice.
//
// Photos (review H3-4, Houzs#5397 / #5526): each is compressed, stamped with
// the DO number and the SERVER's date/time (C2-3, Conts#547) and uploaded the
// moment it is taken (POST /:id/pod-photos). Each tile can be retried or
// removed; Confirm waits until all are uploaded. "Take photo" opens the camera,
// "Choose photos" the library. A phone that reloads the page under the camera
// gets the sheet back with its photos (from the server) and its typed fields
// and signature (sessionStorage).
// ===========================================================================
import { useEffect, useRef, useState } from "react";
import { Sheet } from "./Sheet";
import { M } from "../theme";
import type { ProofOfDelivery } from "@/types";
import { compressImage } from "@/lib/image-compress";
import { fetchServerClockOffset, podStampLines, stampPodPhoto } from "@/lib/pod-photo-stamp";
import {
  patchTile,
  photoSlots,
  photosBlocker,
  POD_MAX_PHOTOS,
  readPodDraft,
  tilesFromServer,
  uploadedPhotoIds,
  writePodDraft,
  type PodPhotoTile,
} from "@/lib/pod-capture";

type Props = {
  open: boolean;
  /** The delivery order's id (photo uploads + the per-DO draft). */
  doId: string;
  /** Printed on every photo with the server's time. */
  doNo: string;
  onClose: () => void;
  onSubmit: (pod: ProofOfDelivery) => Promise<{ ok: boolean; error?: string }>;
};

const PHOTO_MAX_DIMENSION = 1280;
const PHOTO_JPEG_QUALITY = 0.7;
const MAX_INPUT_FILE_BYTES = 25 * 1024 * 1024;

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function PodSheet({ open, doId, doNo, onClose, onSubmit }: Props) {
  const [initial] = useState(() => (doId ? readPodDraft(doId) : null));
  const [receiverName, setReceiverName] = useState(initial?.receiverName ?? "");
  const [receiverIC, setReceiverIC] = useState(initial?.receiverIC ?? "");
  const [remarks, setRemarks] = useState(initial?.remarks ?? "");
  const [tiles, setTiles] = useState<PodPhotoTile[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const offsetRef = useRef<number | null>(null);
  const photosUrl = `/api/delivery-orders/${encodeURIComponent(doId)}/pod-photos`;

  // ---- Signature canvas (pointer draw, no external lib) ----
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const signed = useRef(false);
  const sigDataRef = useRef<string>(initial?.signatureDataUrl ?? "");

  // Keep the typed fields + signature for this DO, so a reload under the
  // camera comes back to them; `open` reopens the sheet itself.
  const saveDraft = (patch: Partial<{ receiverName: string; receiverIC: string; remarks: string }> = {}) => {
    if (!doId) return;
    writePodDraft(doId, {
      open: true,
      receiverName: patch.receiverName ?? receiverName,
      receiverIC: patch.receiverIC ?? receiverIC,
      remarks: patch.remarks ?? remarks,
      signatureDataUrl: sigDataRef.current,
    });
  };

  // On open: the photos already uploaded for this DO + the server's clock.
  useEffect(() => {
    if (!open || !doId) return;
    let cancelled = false;
    saveDraft();
    void (async () => {
      const sent = Date.now();
      try {
        const res = await fetch(photosUrl, { cache: "no-store" });
        const received = Date.now();
        const body = await readJson(res);
        if (cancelled || !res.ok || !body) return;
        const serverMs = Date.parse(String(body.serverNow ?? ""));
        if (Number.isFinite(serverMs)) offsetRef.current = Math.round(serverMs - (sent + received) / 2);
        const rows = Array.isArray(body.data) ? (body.data as Array<{ id: string; dataUrl: string }>) : [];
        setTiles((prev) => (prev.some((t) => t.status !== "done") ? prev : tilesFromServer(rows)));
      } catch {
        /* offline — the first photo will try again */
      }
    })();
    // Restore a signature drawn before a reload.
    const sig = sigDataRef.current;
    if (sig) {
      requestAnimationFrame(() => {
        const c = canvasRef.current;
        if (!c) return;
        const img = new Image();
        img.onload = () => {
          c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
          signed.current = true;
        };
        img.src = sig;
      });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run on open / DO change only
  }, [open, doId]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  };
  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current;
    if (!c) return;
    c.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = c.getContext("2d")!;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1F1D1B";
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    signed.current = true;
  };
  const end = () => {
    if (drawing.current && signed.current && canvasRef.current) {
      sigDataRef.current = canvasRef.current.toDataURL("image/png");
      saveDraft();
    }
    drawing.current = false;
  };
  const clearSig = () => {
    const c = canvasRef.current;
    if (!c) return;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    signed.current = false;
    sigDataRef.current = "";
    saveDraft();
  };

  // ---- Photos: upload each one the moment it is taken ----
  const upload = async (key: string, dataUrl: string) => {
    setTiles((prev) => patchTile(prev, key, { status: "uploading", error: undefined }));
    try {
      const res = await fetch(photosUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl }),
      });
      const body = await readJson(res);
      if (!res.ok || !body || body.success === false) {
        const msg = (body?.error as string) || `Upload failed (HTTP ${res.status})`;
        setTiles((prev) => patchTile(prev, key, { status: "failed", error: msg }));
        return;
      }
      const id = String((body.data as { id?: string } | undefined)?.id ?? "");
      setTiles((prev) => patchTile(prev, key, { status: "done", id }));
    } catch {
      setTiles((prev) => patchTile(prev, key, { status: "failed", error: "No connection — tap Retry." }));
    }
  };

  const addPhotos = async (files: FileList | null, input: HTMLInputElement) => {
    const list = files ? Array.from(files) : [];
    input.value = "";
    if (list.length === 0) return;
    const { take, dropped } = photoSlots(tiles.length, list.length);
    setNote(dropped);
    // The stamp carries the SERVER's time — get the clock first if needed.
    if (offsetRef.current == null) offsetRef.current = await fetchServerClockOffset(photosUrl);
    if (offsetRef.current == null) {
      setErr("Can't reach the server to time-stamp the photo. Check the connection and try again.");
      return;
    }
    for (const f of list.slice(0, take)) {
      if (f.size > MAX_INPUT_FILE_BYTES) {
        setNote(`"${f.name}" is too large. Choose a smaller photo.`);
        continue;
      }
      const key = `ph-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      let dataUrl: string;
      try {
        const small = await compressImage(f, { maxDim: PHOTO_MAX_DIMENSION, quality: PHOTO_JPEG_QUALITY });
        dataUrl = await stampPodPhoto(small, podStampLines(doNo, Date.now() + (offsetRef.current ?? 0)));
      } catch {
        setNote(`Couldn't read "${f.name}". Try another photo.`);
        continue;
      }
      setTiles((prev) => (prev.length >= POD_MAX_PHOTOS ? prev : [...prev, { key, status: "uploading", dataUrl }]));
      void upload(key, dataUrl);
    }
  };

  const removeTile = async (t: PodPhotoTile) => {
    setTiles((prev) => prev.filter((x) => x.key !== t.key));
    if (t.id) {
      try {
        await fetch(`${photosUrl}/${encodeURIComponent(t.id)}`, { method: "DELETE" });
      } catch {
        /* left on the server; it is not in this POD unless named */
      }
    }
  };

  const reset = () => {
    setReceiverName("");
    setReceiverIC("");
    setRemarks("");
    setTiles([]);
    setErr(null);
    setNote(null);
    signed.current = false;
    sigDataRef.current = "";
    if (doId) writePodDraft(doId, null);
  };

  const close = () => {
    // Closing keeps the typed fields for this DO but stops the sheet from
    // reopening by itself; the uploaded photos stay on the server.
    if (doId) {
      const d = readPodDraft(doId);
      if (d) writePodDraft(doId, { ...d, open: false });
    }
    onClose();
  };

  const confirm = async () => {
    if (busy) return;
    if (!receiverName.trim()) {
      setErr("Receiver name is required.");
      return;
    }
    const blocker = photosBlocker(tiles);
    if (blocker) {
      setErr(blocker);
      return;
    }
    setBusy(true);
    setErr(null);
    const c = canvasRef.current;
    const pod: ProofOfDelivery = {
      receiverName: receiverName.trim(),
      receiverIC: receiverIC.trim(),
      signatureDataUrl: signed.current && c ? c.toDataURL("image/png") : "",
      photoDataUrls: [],
      photoIds: uploadedPhotoIds(tiles),
      remarks: remarks.trim(),
      // The server stamps the delivered time; this is only the phone's claim.
      deliveredAt: new Date().toISOString(),
      capturedBy: "",
    };
    const res = await onSubmit(pod);
    setBusy(false);
    if (res.ok) {
      reset();
      onClose();
    } else {
      setErr(res.error || "Couldn't confirm delivery.");
    }
  };

  const label: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: M.ink, margin: "12px 0 6px" };
  const input: React.CSSProperties = {
    width: "100%",
    height: 42,
    border: `1px solid ${M.hairline}`,
    borderRadius: 11,
    padding: "0 13px",
    fontSize: 13.5,
    color: M.raisin,
    background: M.paper,
    outline: "none",
    fontFamily: "inherit",
    boxSizing: "border-box",
  };

  return (
    <Sheet open={open} onClose={close} title="Proof of Delivery">
      <div style={{ padding: "4px 16px calc(16px + env(safe-area-inset-bottom))", overflowY: "auto", maxHeight: "calc(88dvh - 60px)" }}>
        <div style={label}>Receiver name *</div>
        <input style={input} value={receiverName} onChange={(e) => { setReceiverName(e.target.value); saveDraft({ receiverName: e.target.value }); }} placeholder="Who received it" />

        <div style={label}>Receiver IC / phone</div>
        <input style={input} value={receiverIC} onChange={(e) => { setReceiverIC(e.target.value); saveDraft({ receiverIC: e.target.value }); }} placeholder="Optional" />

        <div style={label}>Signature</div>
        <div style={{ border: `1px solid ${M.hairline}`, borderRadius: 12, background: "#fff", position: "relative" }}>
          <canvas
            ref={canvasRef}
            width={560}
            height={200}
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerLeave={end}
            style={{ width: "100%", height: 150, touchAction: "none", display: "block", borderRadius: 12 }}
          />
          <button
            onClick={clearSig}
            style={{ position: "absolute", top: 8, right: 10, fontSize: 11, fontWeight: 700, color: M.taupe, background: "transparent", border: "none", cursor: "pointer" }}
          >
            Clear
          </button>
        </div>

        <div style={label}>Photos <span style={{ color: M.muted, fontWeight: 500 }}>(up to {POD_MAX_PHOTOS})</span></div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-start" }}>
          {tiles.map((t) => (
            <div key={t.key} style={{ position: "relative", width: 64 }}>
              <img
                src={t.dataUrl}
                alt=""
                style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8, border: `1px solid ${t.status === "failed" ? "#9A3A2D" : M.border}`, opacity: t.status === "uploading" ? 0.55 : 1 }}
              />
              <div style={{ fontSize: 10.5, fontWeight: 600, marginTop: 3, color: t.status === "failed" ? "#9A3A2D" : M.muted, textAlign: "center" }}>
                {t.status === "uploading" ? "Uploading…" : t.status === "done" ? "Uploaded" : (
                  <button
                    onClick={() => void upload(t.key, t.dataUrl)}
                    title={t.error}
                    style={{ fontSize: 10.5, fontWeight: 700, color: "#9A3A2D", background: "transparent", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline" }}
                  >
                    Retry
                  </button>
                )}
              </div>
              <button
                onClick={() => void removeTile(t)}
                aria-label="Remove photo"
                disabled={t.status === "uploading"}
                style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: "50%", background: M.raisin, color: "#fff", border: "none", fontSize: 12, cursor: "pointer", lineHeight: 1 }}
              >
                ×
              </button>
            </div>
          ))}
          {tiles.length < POD_MAX_PHOTOS ? (
            <>
              <label style={{ width: 64, height: 64, borderRadius: 8, border: `1px dashed ${M.taupe}`, color: M.taupe, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontSize: 10.5, fontWeight: 700, cursor: "pointer", textAlign: "center" }}>
                <span style={{ fontSize: 20, lineHeight: 1 }}>+</span>
                Take photo
                <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => void addPhotos(e.target.files, e.target)} />
              </label>
              <label style={{ width: 64, height: 64, borderRadius: 8, border: `1px dashed ${M.taupe}`, color: M.taupe, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontSize: 10.5, fontWeight: 700, cursor: "pointer", textAlign: "center" }}>
                <span style={{ fontSize: 18, lineHeight: 1 }}>▦</span>
                Choose photos
                <input type="file" accept="image/*" multiple hidden onChange={(e) => void addPhotos(e.target.files, e.target)} />
              </label>
            </>
          ) : null}
        </div>
        {note ? <div style={{ color: M.muted, fontSize: 12, marginTop: 6 }}>{note}</div> : null}

        <div style={label}>Remarks</div>
        <textarea
          value={remarks}
          onChange={(e) => { setRemarks(e.target.value); saveDraft({ remarks: e.target.value }); }}
          placeholder="Optional note"
          rows={2}
          style={{ ...input, height: 60, padding: "10px 13px", resize: "none" }}
        />

        {err ? <div style={{ color: "#9A3A2D", fontSize: 12.5, marginTop: 10, fontWeight: 600 }}>{err}</div> : null}

        <button
          onClick={confirm}
          disabled={busy || tiles.some((t) => t.status === "uploading")}
          style={{ width: "100%", height: 50, marginTop: 16, border: "none", borderRadius: 13, background: busy ? "#B7C4A6" : "#4F7C3A", color: "#fff", fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: busy ? "default" : "pointer" }}
        >
          {busy ? "Confirming…" : "Confirm Delivery"}
        </button>
      </div>
    </Sheet>
  );
}
