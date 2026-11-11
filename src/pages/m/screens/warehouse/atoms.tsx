// Small presentational atoms shared by the Warehouse tabs (kept apart from
// shared.ts so that file stays components-free for fast refresh).
import type { ReactNode } from "react";
import { M } from "../../theme";

export function Pill({ bg, fg, children }: { bg: string; fg: string; children: ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 22,
        padding: "0 9px",
        borderRadius: 7,
        fontSize: 10.5,
        fontWeight: 800,
        letterSpacing: 0.4,
        background: bg,
        color: fg,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, margin: "16px 2px 8px" }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe, textTransform: "uppercase" }}>
        {children}
      </span>
      {right}
    </div>
  );
}

export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "err" }) {
  return (
    <div
      role={tone === "err" ? "alert" : undefined}
      style={{
        background: tone === "err" ? "#F9E1DA" : M.card,
        border: `1px solid ${tone === "err" ? "#E8B2A1" : M.border}`,
        color: tone === "err" ? "#9A3A2D" : M.ink,
        borderRadius: 12,
        padding: "10px 13px",
        fontSize: 12.5,
        fontWeight: 600,
        lineHeight: 1.4,
      }}
    >
      {children}
    </div>
  );
}


export function FieldLabel({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 700, color: M.ink, margin: "0 0 7px" }}>
      {children}
      {hint ? <span style={{ color: M.muted, fontWeight: 500 }}> {hint}</span> : null}
    </div>
  );
}
