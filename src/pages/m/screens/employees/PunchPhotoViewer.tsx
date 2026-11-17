// PunchPhotoViewer — full-screen punch selfie with In / Out tabs (Employees 3.dc.html `pv`). HK-0125 Phase 2.
// The image streams from the existing `GET /api/attendance/:id/photo?which=in|out` (attendance:read); the browser reuses
// the copy the list row's thumbnail already loaded (the endpoint is cacheable for a day).
import { useEffect, useState } from "react";
import { CameraOff, X } from "lucide-react";

export type PunchPhotoTarget = {
  id: string;
  name: string;
  clockIn: string | null;
  clockOut: string | null;
  hasIn: boolean;
  hasOut: boolean;
};

export default function PunchPhotoViewer({
  target,
  which,
  onWhich,
  onClose,
}: {
  target: PunchPhotoTarget;
  which: "in" | "out";
  onWhich: (w: "in" | "out") => void;
  onClose: () => void;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const has = which === "in" ? target.hasIn : target.hasOut;
  const time = which === "in" ? target.clockIn : target.clockOut;
  const src = `/api/attendance/${encodeURIComponent(target.id)}/photo?which=${which}`;
  const broken = failed === src;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Punch photo"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(18,16,14,.94)", display: "flex", flexDirection: "column" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "calc(env(safe-area-inset-top, 0px) + 14px) 14px 10px 18px", color: "#FFFFFF" }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{target.name}</div>
          <div style={{ fontSize: 12.5, color: "#D9CFBF", marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
            {which === "in" ? "Punch in" : "Punch out"} · {time ?? "not yet"}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{ width: 44, height: 44, border: "none", borderRadius: "50%", background: "rgba(255,255,255,.12)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#FFFFFF" }}
        >
          <X size={20} strokeWidth={2} />
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: "10px 18px" }}>
        {has && !broken ? (
          <img
            key={src}
            src={src}
            alt={`${target.name} punch ${which}`}
            onClick={(e) => e.stopPropagation()}
            onError={() => setFailed(src)}
            style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 16, objectFit: "contain" }}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, color: "#B5AC9C" }}>
            <CameraOff size={40} strokeWidth={1.6} />
            <span style={{ fontSize: 13 }}>
              {broken ? "Photo unavailable" : which === "out" ? "No punch-out photo yet" : "No punch-in photo"}
            </span>
          </div>
        )}
      </div>

      <div onClick={(e) => e.stopPropagation()} style={{ flex: "none", display: "flex", justifyContent: "center", padding: "12px 0 calc(env(safe-area-inset-bottom, 0px) + 28px)" }}>
        <div role="tablist" style={{ display: "flex", gap: 4, padding: 4, borderRadius: 12, background: "rgba(255,255,255,.12)" }}>
          {(["in", "out"] as const).map((k) => {
            const on = which === k;
            return (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => onWhich(k)}
                style={{ height: 36, minWidth: 76, border: "none", borderRadius: 9, background: on ? "#FFFFFF" : "transparent", color: on ? "#1F1D1B" : "#E6E0D9", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
              >
                {k === "in" ? "In" : "Out"}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
