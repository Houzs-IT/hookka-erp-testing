// ===========================================================================
// DeliveryPodSheet — proof of delivery for the Delivery screens, laid out as
// the Claude Design "Proof of delivery" sheet (white shadowed fields, a
// signature area with the PenLine hint, an "Add photos" button with the Camera
// icon, Cancel + confirm footer).
//
// The capture is REAL and its rules are desktop POD-dialog.tsx's (via
// lib/do-mobile.ts): receiver name AND a signature or at least one photo; up
// to 5 photos, raw files over 10 MB refused, each compressed with the shared
// helper (1280px, JPEG 0.7); the whole proof refused over 700 KB. Payload =
// desktop's ProofOfDelivery. The shared components/PodSheet.tsx keeps its own
// look for the generic detail screen.
// ===========================================================================
import { useRef, useState } from "react";
import { Camera, PenLine, X } from "lucide-react";
import type { ProofOfDelivery } from "@/types";
import { compressImage } from "@/lib/image-compress";
import { Sheet } from "../../components";
import { M } from "../../theme";
import {
  POD_MAX_INPUT_FILE_BYTES, POD_MAX_PHOTOS, POD_MAX_PHOTO_BYTES, POD_PHOTO_JPEG_QUALITY, POD_PHOTO_MAX_DIMENSION,
  podCanSubmit, podOversizeFileError, podSizeError,
} from "../../lib/do-mobile";
import { FieldLabel, SheetFooter, SheetSub } from "./ui";
import { DL, INPUT, SHADOW_FIELD, sem } from "./ui-tokens";

type Props = {
  open: boolean;
  onClose: () => void;
  onSubmit: (pod: ProofOfDelivery) => Promise<{ ok: boolean; error?: string }>;
  subtitle: string;
  confirmLabel: string;
};

export function DeliveryPodSheet({ open, onClose, onSubmit, subtitle, confirmLabel }: Props) {
  const [receiverName, setReceiverName] = useState("");
  const [receiverIC, setReceiverIC] = useState("");
  const [remarks, setRemarks] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [hasSignature, setHasSignature] = useState(false);
  const [busy, setBusy] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);

  // Fresh form each time the sheet opens.
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setReceiverName("");
      setReceiverIC("");
      setRemarks("");
      setPhotos([]);
      setHasSignature(false);
      setErr(null);
      setNote(null);
    }
  }

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
    if (c) c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
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
    setErr(null);
    setNote(null);
    setProcessing(true);
    const out: string[] = [];
    try {
      for (const f of toProcess) {
        try {
          out.push(await compressImage(f, { maxDim: POD_PHOTO_MAX_DIMENSION, quality: POD_PHOTO_JPEG_QUALITY }));
        } catch (e) {
          setErr(`Couldn't process "${f.name}": ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (out.some((u) => u.length > POD_MAX_PHOTO_BYTES * 1.5)) {
        setNote("One photo is unusually large after compression — the proof may be close to the size limit.");
      }
      if (out.length) setPhotos((prev) => [...prev, ...out].slice(0, POD_MAX_PHOTOS));
    } finally {
      setProcessing(false);
    }
  };

  const canSubmit = podCanSubmit(receiverName, hasSignature, photos.length);

  const confirm = async () => {
    if (busy || processing) return;
    if (!receiverName.trim()) {
      setErr("Receiver name is required.");
      return;
    }
    if (!canSubmit) {
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
    if (res.ok) onClose();
    else setErr(res.error || "Couldn't save the proof of delivery.");
  };

  return (
    <Sheet open={open} onClose={busy ? () => undefined : onClose} title="Proof of delivery">
      <SheetSub>{subtitle}</SheetSub>
      <div style={{ display: "grid", gap: 14 }}>
        <label style={{ display: "block" }}>
          <FieldLabel required>Receiver name</FieldLabel>
          <input
            className="dl-input"
            value={receiverName}
            onChange={(e) => {
              setReceiverName(e.target.value);
              setErr(null);
            }}
            style={INPUT}
          />
        </label>
        <label style={{ display: "block" }}>
          <FieldLabel>Receiver IC / ID</FieldLabel>
          <input className="dl-input" value={receiverIC} onChange={(e) => setReceiverIC(e.target.value)} style={INPUT} />
        </label>

        <div>
          <FieldLabel>Signature</FieldLabel>
          <div style={{ position: "relative", height: 96, borderRadius: 12, background: "#FFFFFF", boxShadow: `inset 0 0 0 1.5px ${M.hairline}`, overflow: "hidden" }}>
            <canvas
              ref={canvasRef}
              width={600}
              height={192}
              aria-label="Signature pad"
              className="m-no-invert"
              onPointerDown={start}
              onPointerMove={move}
              onPointerUp={end}
              onPointerLeave={end}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none", display: "block" }}
            />
            {!hasSignature ? (
              <div aria-hidden style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, fontSize: 13, color: M.ink, pointerEvents: "none" }}>
                <PenLine size={16} strokeWidth={1.9} />
                Tap to sign
              </div>
            ) : (
              <button
                type="button"
                onClick={clearSig}
                style={{ position: "absolute", top: 4, right: 4, minHeight: 32, padding: "0 10px", border: "none", background: "transparent", fontFamily: "inherit", fontSize: 12, fontWeight: 700, color: sem("success"), cursor: "pointer" }}
              >
                Signed — clear
              </button>
            )}
          </div>
        </div>

        <div>
          <FieldLabel>Photos</FieldLabel>
          <label
            style={{
              width: "100%", height: 48, borderRadius: 12, background: M.card, display: "flex", alignItems: "center", justifyContent: "center",
              gap: 7, fontSize: 13, fontWeight: 600, color: photos.length >= POD_MAX_PHOTOS ? DL.disabled : M.taupe, cursor: photos.length >= POD_MAX_PHOTOS || processing ? "default" : "pointer",
              boxShadow: SHADOW_FIELD,
            }}
          >
            <Camera size={16} strokeWidth={1.9} aria-hidden />
            {processing ? "Adding photos…" : photos.length ? `${photos.length} photo${photos.length === 1 ? "" : "s"} added` : "Add photos"}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              hidden
              aria-label="Add photos"
              disabled={processing || photos.length >= POD_MAX_PHOTOS}
              onChange={(e) => void addPhotos(e.currentTarget)}
            />
          </label>
          {photos.length ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
              {photos.map((p, i) => (
                <div key={i} style={{ position: "relative" }}>
                  <img src={p} alt={`Photo ${i + 1}`} className="m-no-invert" style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 8, display: "block" }} />
                  <button
                    type="button"
                    aria-label={`Remove photo ${i + 1}`}
                    onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}
                    style={{ position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: "50%", border: "none", background: M.raisin, color: M.paper, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 }}
                  >
                    <X size={12} strokeWidth={2.4} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <label style={{ display: "block" }}>
          <FieldLabel>Remarks</FieldLabel>
          <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} style={{ ...INPUT, height: "auto", padding: "11px 13px", resize: "none" }} />
        </label>

        {note ? <div style={{ fontSize: 12, fontWeight: 600, color: "var(--dl-pill-warning-fg)" }}>{note}</div> : null}
        {err ? <div role="alert" style={{ fontSize: 12.5, fontWeight: 600, color: sem("danger") }}>{err}</div> : null}
      </div>
      {/* Validates on tap (prototype: "Receiver name is required."), as desktop's rule. */}
      <SheetFooter onCancel={onClose} onConfirm={confirm} confirmLabel={confirmLabel} busy={busy || processing} />
    </Sheet>
  );
}
