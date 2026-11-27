// ---------------------------------------------------------------------------
// Outsource Work (mobile): the full-screen scanner, drawn to the prototype
// ("Scanning for X", torch, viewfinder ring + sweep, coloured result, Done · N)
// around the REAL shared scanner (src/components/qr-camera-scanner.tsx via its
// optional `renderChrome`). Decoding, camera start-up and clean-up are the
// shared scanner's; every decoded text goes to the hook's issueByScan, which
// owns the same-code suppression and the one-at-a-time queue.
// ---------------------------------------------------------------------------
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CameraOff, Flashlight, ScanLine, X as XIcon } from "lucide-react";
import { QrCameraScanner, type QrScannerChrome } from "@/components/qr-camera-scanner";
import type { IssueFeedback, UseOutsourceIssueResult } from "@/pages/production/use-outsource-issue";
import { shortWorkerName } from "@/lib/outsource-issue-format";
import { feedbackView } from "./os-format";
import { KEYFRAMES, TONE } from "./os-style";

const RESULT_MS = 2200;

export function ScannerOverlay({ issue, onClose }: { issue: UseOutsourceIssueResult; onClose: () => void }) {
  // Captured once when the scanner opens: what was already on screen does not count.
  const [startIds] = useState(() => new Set(issue.sessionIssues.map((item) => item.id)));
  const [startFeedback] = useState<IssueFeedback | null>(issue.feedback);
  const [hiddenFeedback, setHiddenFeedback] = useState<IssueFeedback | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const doneCount = issue.sessionIssues.filter((item) => !startIds.has(item.id)).length;
  const feedback = issue.feedback;
  const result = feedback && feedback !== startFeedback && feedback !== hiddenFeedback ? feedback : null;

  useEffect(() => {
    if (!result) return;
    // eslint-disable-next-line no-restricted-syntax -- hides this one result; cleared when the next result replaces it or on close
    const handle = window.setTimeout(() => setHiddenFeedback(result), RESULT_MS);
    return () => window.clearTimeout(handle);
  }, [result]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const who = issue.selectedWorker ? shortWorkerName(issue.selectedWorker.name) : "";
  const view = result ? feedbackView(result, "Couldn't issue") : null;
  const ring = view ? TONE[view.tone].ring : "#FFFFFF";

  const frame = (chrome: QrScannerChrome | null): ReactNode => (
    <div data-os="" role="dialog" aria-modal="true" aria-label="Scan stickers"
      style={{ position: "fixed", inset: 0, zIndex: 90, background: "#0E0D0B", color: "#FFFFFF", display: "flex", flexDirection: "column", paddingTop: "env(safe-area-inset-top)" }}>
      <style>{KEYFRAMES}</style>
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, height: 56, padding: "0 14px" }}>
        <button type="button" onClick={onClose} aria-label="Close scanner"
          style={{ width: 44, height: 44, marginLeft: -8, border: "none", background: "none", color: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flex: "none" }}>
          <XIcon size={22} strokeWidth={2} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Scanning for {who}</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Keeps scanning until you tap Done</div>
        </div>
        {chrome?.isTorchSupported ? (
          <button type="button" onClick={chrome.toggleTorch} aria-label="Torch" aria-pressed={chrome.isTorchOn}
            style={{ width: 42, height: 42, flex: "none", borderRadius: "50%", border: "none", background: chrome.isTorchOn ? "#FFFFFF" : "rgba(255,255,255,.12)", color: chrome.isTorchOn ? "#1F1D1B" : "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <Flashlight size={18} strokeWidth={2} />
          </button>
        ) : null}
      </div>

      <div style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", background: "radial-gradient(70% 50% at 50% 45%,#2A2620,#0E0D0B)" }}>
        {chrome ? (
          <>
            {chrome.video}
            <div onClick={chrome.refocus} aria-hidden="true" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <div style={chrome.scanMode === "barcode"
                ? { position: "relative", width: "86%", maxWidth: 440, height: 96, borderRadius: 14, boxShadow: `0 0 0 999px rgba(0,0,0,.45),inset 0 0 0 3px ${ring}` }
                : { position: "relative", width: "66%", maxWidth: 280, aspectRatio: "1", borderRadius: 22, boxShadow: `0 0 0 999px rgba(0,0,0,.45),inset 0 0 0 3px ${ring}` }}>
                <span style={{ position: "absolute", left: "8%", right: "8%", height: 2, background: ring, boxShadow: `0 0 12px ${ring}`, animation: "os-sweep 2.4s ease-in-out infinite" }} />
              </div>
            </div>
            <div style={{ position: "absolute", top: 12, left: 0, right: 0, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
              <span style={{ fontSize: 11.5, fontWeight: 600, padding: "4px 10px", borderRadius: 999, background: "rgba(0,0,0,.45)", opacity: 0.85 }}>Tap to focus</span>
            </div>
          </>
        ) : (
          <div role="alert" style={{ margin: 24, maxWidth: 340, padding: "24px 18px", borderRadius: 20, background: "rgba(255,255,255,.08)", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <span style={{ width: 50, height: 50, borderRadius: 16, background: "rgba(240,138,120,.18)", display: "flex", alignItems: "center", justifyContent: "center" }}><CameraOff size={22} strokeWidth={1.8} color="#F08A78" /></span>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{cameraError?.startsWith("Camera blocked") ? "Camera blocked" : "Couldn't open the camera"}</div>
            <div style={{ fontSize: 13, lineHeight: 1.45, opacity: 0.85 }}>{cameraError}</div>
            <div style={{ fontSize: 12, lineHeight: 1.45, opacity: 0.7 }}>You can still type the sticker code on the Issue page.</div>
            <button type="button" onClick={() => { setCameraError(null); setAttempt((n) => n + 1); }}
              style={{ marginTop: 4, height: 44, padding: "0 20px", borderRadius: 999, border: "none", background: "rgba(255,255,255,.16)", color: "#FFFFFF", fontFamily: "inherit", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>
              Try again
            </button>
          </div>
        )}
        {view ? (
          <div role="status" aria-live="polite" style={{ position: "absolute", left: 16, right: 16, bottom: 16, display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px", borderRadius: 14, background: TONE[view.tone].solid, color: "#FFFFFF", animation: "os-pop .18s ease-out" }}>
            {(() => { const Icon = TONE[view.tone].icon; return <Icon size={19} strokeWidth={2.2} style={{ flex: "none" }} />; })()}
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 14, fontWeight: 700 }}>{view.t}</span>
              <span style={{ display: "block", fontSize: 12, opacity: 0.9, marginTop: 2, lineHeight: 1.4, overflowWrap: "anywhere" }}>{view.s}</span>
            </span>
          </div>
        ) : null}
      </div>

      <div style={{ flex: "none", padding: "12px 16px calc(16px + env(safe-area-inset-bottom))", background: "#17150F" }}>
        {chrome ? (
          <div role="radiogroup" aria-label="Code type" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 4, height: 42, padding: 4, boxSizing: "border-box", borderRadius: 12, background: "rgba(255,255,255,.1)" }}>
            {(["qr", "barcode"] as const).map((mode) => {
              const on = chrome.scanMode === mode;
              return (
                <button key={mode} type="button" role="radio" aria-checked={on} onClick={() => chrome.setScanMode(mode)}
                  style={{ border: "none", borderRadius: 9, background: on ? "#FFFFFF" : "transparent", color: on ? "#1F1D1B" : "#FFFFFF", fontFamily: "inherit", fontSize: 12.5, fontWeight: on ? 700 : 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  {mode === "qr" ? <ScanLine size={14} strokeWidth={2} /> : null}{mode === "qr" ? "QR" : "Barcode"}
                </button>
              );
            })}
          </div>
        ) : null}
        <button type="button" onClick={onClose}
          style={{ marginTop: chrome ? 10 : 0, width: "100%", height: 50, borderRadius: 14, border: "none", background: "#FFFFFF", color: "#1F1D1B", fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>
          Done · {doneCount} issued
        </button>
      </div>
    </div>
  );

  const body = cameraError !== null
    ? frame(null)
    : (
      <QrCameraScanner
        key={attempt}
        onDecode={(text) => void issue.issueByScan(text)}
        onClose={onClose}
        onError={setCameraError}
        renderChrome={frame}
      />
    );
  return typeof document === "undefined" ? body : createPortal(body, document.body);
}
