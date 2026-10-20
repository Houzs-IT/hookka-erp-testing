// ===========================================================================
// PodSheet — mobile Proof of Delivery capture (Build Spec: DO → Mark delivered →
// POD capture: signature + photos + time). Reuses the EXACT desktop payload:
// PUT /api/delivery-orders/:id { proofOfDelivery: {receiverName, receiverIC,
// signatureDataUrl, photoDataUrls[], remarks, deliveredAt, capturedBy}, status:
// "DELIVERED" }. Backend attaches the proof + transitions the DO (delivery-orders
// .ts:5794) and auto-creates the invoice.
//
// 2026-10-20: the RULES are now desktop POD-dialog.tsx's (lib/do-mobile.ts) —
// receiver name AND a signature or at least one photo; photos compressed with
// the shared helper (1280px, JPEG 0.7); raw files over 10 MB refused; the
// whole proof refused over 700 KB. The look is unchanged. The Delivery screens
// use their own Claude Design sheet (screens/delivery/DeliveryPodSheet.tsx).
// ===========================================================================
import { useRef, useState } from "react";
import { Sheet } from "./Sheet";
import { M } from "../theme";
import type { ProofOfDelivery } from "@/types";
import { compressImage } from "@/lib/image-compress";
import {
  POD_MAX_INPUT_FILE_BYTES,
  POD_MAX_PHOTOS,
  POD_PHOTO_JPEG_QUALITY,
  POD_PHOTO_MAX_DIMENSION,
  podCanSubmit,
  podOversizeFileError,
  podSizeError,
} from "../lib/do-mobile";

type Props = {
  open: boolean;
  onClose: () => void;
  onSubmit: (pod: ProofOfDelivery) => Promise<{ ok: boolean; error?: string }>;
};

export function PodSheet({ open, onClose, onSubmit }: Props) {
  const [receiverName, setReceiverName] = useState("");
  const [receiverIC, setReceiverIC] = useState("");
  const [remarks, setRemarks] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hasSignature, setHasSignature] = useState(false);

  // ---- Signature canvas (pointer draw, no external lib) ----
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);

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
    if (!hasSignature) setHasSignature(true);
  };
  const end = () => {
    drawing.current = false;
  };
  const clearSig = () => {
    const c = canvasRef.current;
    if (!c) return;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setHasSignature(false);
  };

  // Desktop pipeline: refuse >10 MB raw files, compress one at a time.
  const addPhotos = async (input: HTMLInputElement) => {
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (!files.length) return;
    const toProcess = files.slice(0, POD_MAX_PHOTOS - photos.length);
    const oversize = toProcess.find((f) => f.size > POD_MAX_INPUT_FILE_BYTES);
    if (oversize) {
      setErr(podOversizeFileError(oversize.name));
      return;
    }
    const out: string[] = [];
    for (const f of toProcess) {
      try {
        out.push(await compressImage(f, { maxDim: POD_PHOTO_MAX_DIMENSION, quality: POD_PHOTO_JPEG_QUALITY }));
      } catch (e) {
        setErr(`Couldn't process "${f.name}": ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (out.length) setPhotos((prev) => [...prev, ...out].slice(0, POD_MAX_PHOTOS));
  };

  const reset = () => {
    setReceiverName("");
    setReceiverIC("");
    setRemarks("");
    setPhotos([]);
    setErr(null);
    setHasSignature(false);
  };

  const confirm = async () => {
    if (busy) return;
    if (!receiverName.trim()) {
      setErr("Receiver name is required.");
      return;
    }
    if (!podCanSubmit(receiverName, hasSignature, photos.length)) {
      setErr("Add a signature or at least one photo.");
      return;
    }
    const c = canvasRef.current;
    const pod: ProofOfDelivery = {
      receiverName: receiverName.trim(),
      receiverIC: receiverIC.trim(),
      signatureDataUrl: hasSignature && c ? c.toDataURL("image/png") : "",
      photoDataUrls: photos,
      remarks: remarks.trim(),
      deliveredAt: new Date().toISOString(),
      capturedBy: "",
    };
    const tooBig = podSizeError(pod);
    if (tooBig) {
      setErr(tooBig);
      return;
    }
    setBusy(true);
    setErr(null);
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
    <Sheet open={open} onClose={onClose} title="Proof of Delivery">
      <div style={{ padding: "4px 16px calc(16px + env(safe-area-inset-bottom))", overflowY: "auto", maxHeight: "calc(88dvh - 60px)" }}>
        <div style={label}>Receiver name *</div>
        <input style={input} value={receiverName} onChange={(e) => setReceiverName(e.target.value)} placeholder="Who received it" />

        <div style={label}>Receiver IC / phone</div>
        <input style={input} value={receiverIC} onChange={(e) => setReceiverIC(e.target.value)} placeholder="Optional" />

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

        <div style={label}>Photos <span style={{ color: M.muted, fontWeight: 500 }}>(up to 5)</span></div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          {photos.map((p, i) => (
            <div key={i} style={{ position: "relative" }}>
              <img src={p} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8, border: `1px solid ${M.border}` }} />
              <button
                onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}
                style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: "50%", background: M.raisin, color: "#fff", border: "none", fontSize: 11, cursor: "pointer", lineHeight: 1 }}
              >
                ×
              </button>
            </div>
          ))}
          {photos.length < 5 ? (
            <label style={{ width: 56, height: 56, borderRadius: 8, border: `1px dashed ${M.taupe}`, color: M.taupe, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, cursor: "pointer" }}>
              +
              <input type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => void addPhotos(e.currentTarget)} />
            </label>
          ) : null}
        </div>

        <div style={label}>Remarks</div>
        <textarea
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          placeholder="Optional note"
          rows={2}
          style={{ ...input, height: 60, padding: "10px 13px", resize: "none" }}
        />

        {err ? <div style={{ color: "#9A3A2D", fontSize: 12.5, marginTop: 10, fontWeight: 600 }}>{err}</div> : null}

        <button
          onClick={confirm}
          disabled={busy}
          style={{ width: "100%", height: 50, marginTop: 16, border: "none", borderRadius: 13, background: busy ? "#B7C4A6" : "#4F7C3A", color: "#fff", fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: busy ? "default" : "pointer" }}
        >
          {busy ? "Confirming…" : "Confirm Delivery"}
        </button>
      </div>
    </Sheet>
  );
}
