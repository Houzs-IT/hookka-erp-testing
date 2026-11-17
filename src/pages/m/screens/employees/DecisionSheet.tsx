// DecisionSheet — the HTML's confirm / reject bottom sheet (Employees 3.dc.html `sheet.kind` confirm + reject): title, a body
// block, then two buttons — Cancel (white, ringed) and the action (brown, or red for Reject). HK-0125 Phase 2.
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Sheet } from "../../components";
import { M } from "../../theme";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  tone?: "primary" | "danger";
  busy?: boolean;
  onConfirm: () => void;
};

export default function DecisionSheet({ open, onClose, title, children, confirmLabel, tone = "primary", busy = false, onConfirm }: Props) {
  return (
    <Sheet open={open} onClose={busy ? () => undefined : onClose} title={title} bare>
      <div style={{ display: "flex", justifyContent: "center", paddingTop: 8 }}>
        <div style={{ width: 40, height: 4, borderRadius: 999, background: M.border }} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px 8px 18px" }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 700, color: M.raisin }}>{title}</div>
        <button type="button" onClick={onClose} disabled={busy} aria-label="Close" style={{ width: 44, height: 44, border: "none", background: "none", padding: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: M.muted }}>
          <X size={20} strokeWidth={1.9} />
        </button>
      </div>
      <div style={{ padding: "4px 16px 16px" }}>{children}</div>
      <div style={{ display: "flex", gap: 8, padding: "10px 16px 18px", borderTop: "1px solid #F0ECE9", background: M.paper }}>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          style={{ flex: "1 1 0", minWidth: 0, height: 46, padding: "0 14px", border: "1px solid #E6E0D9", borderRadius: 12, background: M.card, color: M.raisin, fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          style={{ flex: "1 1 0", minWidth: 0, height: 46, padding: "0 14px", border: "none", borderRadius: 12, background: tone === "danger" ? "#9A3A2D" : M.taupe, color: "#FFFFFF", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
        >
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </Sheet>
  );
}
