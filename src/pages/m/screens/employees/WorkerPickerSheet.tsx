// WorkerPickerSheet — "Choose employee" (Employees 3.dc.html `actList`): one white card of rows, each a 38px initials circle, the
// name, "EMP-001 · Department" under it and a check on the current worker. Lists active, non-test workers plus the selected one.
import { Check } from "lucide-react";
import { Sheet } from "../../components";
import { M } from "../../theme";
import { initialsOf, workerLabel, type EpWorker } from "./employee-performance-model";

export default function WorkerPickerSheet({
  open,
  workers,
  selectedId,
  deptName,
  onPick,
  onClose,
}: {
  open: boolean;
  workers: readonly EpWorker[];
  selectedId: string;
  deptName: (code: string) => string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Choose employee">
      <div style={{ background: M.card, borderRadius: 16, boxShadow: "0 1px 2px rgba(31,29,27,.05), 0 12px 28px -16px rgba(31,29,27,.22)", overflow: "hidden" }}>
        {workers.map((w, i) => {
          const on = w.id === selectedId;
          return (
            <button
              key={w.id}
              type="button"
              onClick={() => onPick(w.id)}
              aria-current={on ? "true" : undefined}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, minHeight: 52, padding: "8px 14px", border: "none", borderTop: i ? "1px solid #F0ECE9" : "none", background: on ? "#FAF8F4" : "#FFFFFF", fontFamily: "inherit", textAlign: "left", cursor: "pointer" }}
            >
              <span aria-hidden="true" style={{ width: 38, height: 38, flex: "none", borderRadius: "50%", background: "#F4EFE6", color: "#6B5C32", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>
                {initialsOf(w.name || w.id)}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: M.raisin, overflowWrap: "anywhere" }}>{w.name || w.id}</span>
                <span style={{ display: "block", fontSize: 12, color: M.ink, marginTop: 1 }}>
                  {[w.empNo, w.departmentCode ? deptName(w.departmentCode) : "", w.status && w.status !== "ACTIVE" ? w.status.toLowerCase() : ""].filter(Boolean).join(" · ") || workerLabel(w)}
                </span>
              </span>
              {on ? <Check size={16} strokeWidth={2.2} color="#6B5C32" /> : null}
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}
