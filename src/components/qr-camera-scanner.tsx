import { useCallback, useEffect, useRef, useState } from "react";
import type { JSX, ReactNode } from "react";
import { Flashlight, X } from "lucide-react";
import jsQR from "jsqr";

export type ScanMode = "qr" | "barcode";
type ZxingDecoder = (image: ImageData) => string | null;

interface BoundedBarcode {
  rawValue: string;
  format?: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

/**
 * What a caller-drawn scanner chrome gets (see `renderChrome`). `video` is the
 * scanner's own <video> element and must be rendered exactly once; `refocus`
 * is the same tap-to-refocus the default chrome uses (it also calls
 * `onUserGesture`). Decoding, camera start-up and clean-up stay in here.
 */
export interface QrScannerChrome {
  video: ReactNode;
  scanMode: ScanMode;
  setScanMode: (mode: ScanMode) => void;
  isTorchSupported: boolean;
  isTorchOn: boolean;
  toggleTorch: () => void;
  refocus: () => void;
}

export interface QrCameraScannerProps {
  onDecode: (text: string) => void;
  onClose: () => void;
  onError: (message: string) => void;
  onUserGesture?: () => void;
  statusText?: string;
  isFullScreen?: boolean;
  /**
   * Optional (mobile Outsource Work, 2026-11-27): draw the whole scanner chrome
   * yourself around the scanner's video. Omitted = the default chrome below,
   * exactly as before (`isFullScreen`, `statusText` and `onClose` apply only to it).
   */
  renderChrome?: (chrome: QrScannerChrome) => ReactNode;
}

function CustomChrome({ render, ...chrome }: QrScannerChrome & { render: (chrome: QrScannerChrome) => ReactNode }): JSX.Element {
  return <>{render(chrome)}</>;
}

let zxingDecoder: ZxingDecoder | null = null;
let zxingLoading: Promise<void> | null = null;

function ensureZxing(): Promise<void> {
  if (zxingDecoder) return Promise.resolve();
  if (zxingLoading) return zxingLoading;
  zxingLoading = import("@zxing/library")
    .then((zx) => {
      const reader = new zx.MultiFormatReader();
      const hints = new Map<number, unknown>();
      hints.set(zx.DecodeHintType.POSSIBLE_FORMATS, [
        zx.BarcodeFormat.QR_CODE,
        zx.BarcodeFormat.CODE_128,
      ]);
      hints.set(zx.DecodeHintType.TRY_HARDER, true);
      reader.setHints(hints);
      zxingDecoder = (image: ImageData): string | null => {
        const { data, width, height } = image;
        const gray = new Uint8ClampedArray(width * height);
        for (let i = 0, j = 0; j < gray.length; i += 4, j++) {
          gray[j] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
        }
        try {
          const result = reader.decodeWithState(
            new zx.BinaryBitmap(
              new zx.HybridBinarizer(new zx.RGBLuminanceSource(gray, width, height)),
            ),
          );
          return result ? result.getText() : null;
        } catch {
          return null;
        }
      };
    })
    .catch(() => {
      zxingLoading = null;
    });
  return zxingLoading;
}

function createNativeDetector(): BarcodeDetectorLike | null {
  if (typeof window === "undefined" || !window.BarcodeDetector) return null;
  try {
    return new window.BarcodeDetector({ formats: ["qr_code", "code_128"] });
  } catch {
    try {
      return new window.BarcodeDetector({ formats: ["qr_code"] });
    } catch {
      return null;
    }
  }
}

function describeCameraError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  return name === "NotAllowedError" || name === "SecurityError"
    ? "Camera blocked. Allow camera access for this site (tap the lock icon in the address bar), then tap Scan again."
    : "Could not open the camera. Make sure no other app is using it and that this page is on https.";
}

export function QrCameraScanner({
  onDecode,
  onClose,
  onError,
  onUserGesture,
  statusText,
  isFullScreen = false,
  renderChrome,
}: QrCameraScannerProps): JSX.Element {
  const [scanMode, setScanMode] = useState<ScanMode>("qr");
  const [isTorchOn, setIsTorchOn] = useState(false);
  const [isTorchSupported, setIsTorchSupported] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanModeRef = useRef<ScanMode>(scanMode);
  const onDecodeRef = useRef(onDecode);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    scanModeRef.current = scanMode;
    onDecodeRef.current = onDecode;
    onErrorRef.current = onError;
  }, [scanMode, onDecode, onError]);

  const toggleTorch = useCallback(async (): Promise<void> => {
    const track = streamRef.current?.getVideoTracks?.()[0];
    if (!track) return;
    const next = !isTorchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as unknown as MediaTrackConstraintSet],
      });
      setIsTorchOn(next);
    } catch {
      setIsTorchOn(false);
    }
  }, [isTorchOn]);

  const refocus = useCallback(async (): Promise<void> => {
    const track = streamRef.current?.getVideoTracks?.()[0];
    if (!track) return;
    const capabilities = track.getCapabilities?.() as
      | (MediaTrackCapabilities & { focusMode?: string[] })
      | undefined;
    const modes = capabilities?.focusMode ?? [];
    const focusMode = modes.includes("single-shot")
      ? "single-shot"
      : modes.includes("continuous")
        ? "continuous"
        : null;
    if (!focusMode) return;
    try {
      await track.applyConstraints({
        advanced: [{ focusMode } as unknown as MediaTrackConstraintSet],
      });
    } catch {
      return;
    }
  }, []);

  useEffect(() => {
    let isStopped = false;
    let frameHandle: number | null = null;
    const canvas = document.createElement("canvas");

    const stopStream = (): void => {
      if (frameHandle !== null) {
        cancelAnimationFrame(frameHandle);
        frameHandle = null;
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };

    const run = async (): Promise<void> => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 2560 },
            height: { ideal: 1440 },
          },
          audio: false,
        });
      } catch (error) {
        if (!isStopped) onErrorRef.current(describeCameraError(error));
        return;
      }
      if (isStopped) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      try {
        const track = stream.getVideoTracks()[0];
        const capabilities = track?.getCapabilities?.() as
          | (MediaTrackCapabilities & { focusMode?: string[]; torch?: boolean })
          | undefined;
        if (capabilities?.focusMode?.includes("continuous")) {
          await track.applyConstraints({
            advanced: [{ focusMode: "continuous" } as unknown as MediaTrackConstraintSet],
          });
        }
        setIsTorchSupported(Boolean(capabilities?.torch));
      } catch {
        setIsTorchSupported(false);
      }

      const video = videoRef.current;
      if (isStopped || !video) {
        stopStream();
        return;
      }
      video.srcObject = stream;
      video.setAttribute("playsinline", "true");
      video.muted = true;
      video.play().catch(() => undefined);

      let nativeDetector = createNativeDetector();
      void ensureZxing();
      let lastDecodeAt = 0;
      const throttleMs = nativeDetector ? 60 : 90;

      const tick = async (): Promise<void> => {
        if (isStopped) return;
        const now = performance.now();
        const mode = scanModeRef.current;
        let hit: string | null = null;
        if (now - lastDecodeAt >= throttleMs && video.videoWidth > 0 && video.readyState >= 2) {
          lastDecodeAt = now;
          if (nativeDetector) {
            try {
              const codes = (await nativeDetector.detect(video)) as BoundedBarcode[];
              if (isStopped) return;
              if (mode === "barcode") {
                const centerX = video.videoWidth / 2;
                const centerY = video.videoHeight / 2;
                let best: { value: string; distance: number } | null = null;
                for (const code of codes) {
                  if (!code.rawValue) continue;
                  if (code.format && code.format !== "code_128") continue;
                  const box = code.boundingBox;
                  const distance = box
                    ? Math.hypot(box.x + box.width / 2 - centerX, box.y + box.height / 2 - centerY)
                    : 0;
                  if (!best || distance < best.distance) best = { value: code.rawValue, distance };
                }
                if (best) hit = best.value;
              } else if (codes.length > 0 && codes[0].rawValue) {
                hit = codes[0].rawValue;
              }
            } catch {
              nativeDetector = null;
            }
          } else {
            const videoWidth = video.videoWidth;
            const videoHeight = video.videoHeight;
            const context = canvas.getContext("2d", { willReadFrequently: true });
            if (context) {
              const targetWidth = mode === "barcode" ? 1280 : 1440;
              const scale = Math.min(1, targetWidth / Math.max(videoWidth, videoHeight));
              const canvasWidth = Math.max(1, Math.round(videoWidth * scale));
              const canvasHeight = Math.max(1, Math.round(videoHeight * scale));
              canvas.width = canvasWidth;
              canvas.height = canvasHeight;
              context.drawImage(video, 0, 0, canvasWidth, canvasHeight);
              let imageData: ImageData | null = null;
              try {
                imageData = context.getImageData(0, 0, canvasWidth, canvasHeight);
              } catch {
                imageData = null;
              }
              if (imageData) {
                if (mode !== "barcode") {
                  const code = jsQR(imageData.data, canvasWidth, canvasHeight, {
                    inversionAttempts: "attemptBoth",
                  });
                  if (code && code.data) hit = code.data;
                }
                if (!hit) {
                  if (!zxingDecoder) {
                    void ensureZxing();
                  } else {
                    hit = zxingDecoder(imageData);
                  }
                }
              }
            }
          }
        }
        if (hit && !isStopped) onDecodeRef.current(hit);
        frameHandle = requestAnimationFrame(() => void tick());
      };
      frameHandle = requestAnimationFrame(() => void tick());
    };

    void run();
    return () => {
      isStopped = true;
      stopStream();
    };
  }, []);

  if (renderChrome) {
    return (
      <CustomChrome
        render={renderChrome}
        video={
          <video
            ref={videoRef}
            playsInline
            muted
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", background: "#000" }}
          />
        }
        scanMode={scanMode}
        setScanMode={setScanMode}
        isTorchSupported={isTorchSupported}
        isTorchOn={isTorchOn}
        toggleTorch={() => void toggleTorch()}
        refocus={() => {
          onUserGesture?.();
          void refocus();
        }}
      />
    );
  }

  const frameClass = isFullScreen
    ? "fixed inset-0 z-[80] flex flex-col bg-black"
    : "rounded-xl overflow-hidden bg-black shadow-sm border border-[#E6E0D9]";
  const videoClass = isFullScreen
    ? "w-full flex-1 min-h-0 object-cover bg-black"
    : "w-full h-[58vh] object-cover bg-black";
  const videoFrameClass = isFullScreen ? "relative flex-1 min-h-0" : "relative";

  return (
    <div className={frameClass}>
      <div className={videoFrameClass}>
        <video ref={videoRef} className={`${videoClass} ${isFullScreen ? "absolute inset-0 h-full" : ""}`} playsInline muted />
        <div
          onClick={() => {
            onUserGesture?.();
            void refocus();
          }}
          className="absolute inset-0 flex items-center justify-center"
        >
          {scanMode === "barcode" ? (
            <div className="pointer-events-none w-[86vw] max-w-[440px] h-[88px] rounded-lg border-2 border-white/90 shadow-[0_0_0_2000px_rgba(0,0,0,0.35)]" />
          ) : (
            <div className="pointer-events-none w-[66vw] max-w-[300px] aspect-square rounded-lg border-2 border-white/90 shadow-[0_0_0_2000px_rgba(0,0,0,0.35)]" />
          )}
        </div>
        <div
          className="absolute right-2 flex gap-2"
          style={{ top: isFullScreen ? "calc(env(safe-area-inset-top) + 8px)" : "8px" }}
        >
          {isTorchSupported && (
            <button
              type="button"
              onClick={() => void toggleTorch()}
              className={`h-11 w-11 rounded-full flex items-center justify-center ${
                isTorchOn ? "bg-[#9C6F1E] text-white" : "bg-black/55 text-white"
              }`}
              aria-label="Toggle flashlight"
            >
              <Flashlight className="h-5 w-5" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="h-11 w-11 rounded-full bg-black/55 text-white flex items-center justify-center"
            aria-label="Close camera"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex rounded-full bg-black/55 p-1 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setScanMode("qr")}
            className={`px-4 py-1.5 min-h-[44px] rounded-full ${scanMode === "qr" ? "bg-white text-[#1F1D1B]" : "text-white"}`}
          >
            QR
          </button>
          <button
            type="button"
            onClick={() => setScanMode("barcode")}
            className={`px-4 py-1.5 min-h-[44px] rounded-full ${scanMode === "barcode" ? "bg-white text-[#1F1D1B]" : "text-white"}`}
          >
            Barcode
          </button>
        </div>
      </div>
      <div
        className="bg-[#1F1D1B] px-4 py-2.5 text-center text-sm text-white min-h-[40px] flex items-center justify-center"
        style={isFullScreen ? { paddingBottom: "calc(env(safe-area-inset-bottom) + 10px)" } : undefined}
      >
        {statusText || "Point at an item QR…"}
      </div>
    </div>
  );
}
