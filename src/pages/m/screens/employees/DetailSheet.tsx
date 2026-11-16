// DetailSheet — the read-only detail card from Employees 3.dc.html (`sheet.kind === "detail"`): a bottom sheet with a
// handle, a header (title, sub line, optional pill, close), a white card of label / value rows, optional extra blocks,
// action buttons and an info note. HK-0125 Phase 2. Used by Working Hours (a worker's day) and Attendance (a punch).
import type { ReactNode } from "react";
import { Info, X } from "lucide-react";
import { Sheet } from "../../components";
import { M } from "../../theme";
import { SHEET_CARD } from "./employees-styles";

export type DetailField = [label: string, value: string];
export type DetailAct = { label: string; onTap: () => void };

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  sub?: string;
  pill?: { label: string; bg: string; fg: string };
  fields?: DetailField[];
  /** Extra blocks under the label / value card (e.g. the department table). */
  children?: ReactNode;
  acts?: DetailAct[];
  note?: string;
};

export default function DetailSheet({ open, onClose, title, sub, pill, fields = [], children, acts = [], note }: Props) {
  return (
    <Sheet open={open} onClose={onClose} title={title} bare>
      <div style={{ display: "flex", justifyContent: "center", paddingTop: 8 }}>
        <div style={{ width: 40, height: 4, borderRadius: 999, background: M.border }} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px 8px 18px" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
          {sub ? <div style={{ fontSize: 12, color: M.ink, marginTop: 2 }}>{sub}</div> : null}
        </div>
        {pill ? (
          <span style={{ flex: "none", height: 22, display: "inline-flex", alignItems: "center", padding: "0 9px", borderRadius: 999, background: pill.bg, color: pill.fg, fontSize: 11, fontWeight: 700 }}>
            {pill.label}
          </span>
        ) : null}
        <button type="button" onClick={onClose} aria-label="Close" style={{ width: 44, height: 44, border: "none", background: "none", padding: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: M.muted }}>
          <X size={20} strokeWidth={1.9} />
        </button>
      </div>

      <div style={{ padding: "4px 16px 16px" }}>
        {fields.length > 0 ? (
          <div style={{ ...SHEET_CARD, padding: "2px 14px" }}>
            {fields.map(([k, v], i) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 14, minHeight: 42, padding: "8px 0", boxSizing: "border-box", borderTop: i ? "1px solid #F0ECE9" : "none" }}>
                <span style={{ flex: "none", fontSize: 12.5, color: M.ink }}>{k}</span>
                <span style={{ minWidth: 0, textAlign: "right", fontSize: 13, fontWeight: 600, color: v === "—" ? M.muted : M.raisin, fontVariantNumeric: "tabular-nums", wordBreak: "break-word" }}>{v}</span>
              </div>
            ))}
          </div>
        ) : null}
        {children}
        {note ? (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10, padding: "0 4px", fontSize: 12, lineHeight: 1.45, color: M.ink }}>
            <Info size={13} strokeWidth={2} color="#8B7A4E" style={{ flex: "none", marginTop: 2 }} />
            <span>{note}</span>
          </div>
        ) : null}
      </div>

      {acts.length > 0 ? (
        <div style={{ display: "flex", gap: 8, padding: "10px 16px 18px", borderTop: "1px solid #F0ECE9", background: M.paper }}>
          {acts.map((a, i) => (
            <button
              key={a.label}
              type="button"
              onClick={a.onTap}
              style={{ flex: 1, minWidth: 0, height: 46, padding: "0 14px", border: "none", borderRadius: 12, background: i === 0 ? M.taupe : M.card, color: i === 0 ? "#FFFFFF" : M.raisin, fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
            >
              {a.label}
            </button>
          ))}
        </div>
      ) : null}
    </Sheet>
  );
}
