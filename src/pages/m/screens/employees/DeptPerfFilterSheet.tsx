// DeptPerfFilterSheet — the Department Performance "Filter" sheet (Employees 3.dc.html `dpf`): DEPARTMENT (one, or "All departments")
// and CATEGORY (All · Sofa · Bedframe), then Reset and Apply. The draft lives in the sheet and is applied only on Apply.
import { useState, type CSSProperties } from "react";
import { Sheet } from "../../components";
import type { DpCategory } from "./department-performance-model";

const CATS: { k: DpCategory; l: string }[] = [
  { k: "", l: "All" },
  { k: "SOFA", l: "Sofa" },
  { k: "BEDFRAME", l: "Bedframe" },
];

const chip = (on: boolean): CSSProperties => ({
  height: 36,
  padding: "0 14px",
  border: "none",
  borderRadius: 999,
  background: on ? "#6B5C32" : "#FFFFFF",
  color: on ? "#FFFFFF" : "#3A352C",
  boxShadow: on ? "none" : "0 1px 2px rgba(31,29,27,.06), 0 4px 10px -6px rgba(31,29,27,.16)",
  fontFamily: "inherit",
  fontSize: 13,
  fontWeight: on ? 700 : 600,
  cursor: "pointer",
});
const LABEL: CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: 1, color: "#6B5C32" };

type Props = {
  open: boolean;
  dept: string;
  cat: DpCategory;
  depts: readonly { code: string; name: string }[];
  onApply: (dept: string, cat: DpCategory) => void;
  onClose: () => void;
};

export default function DeptPerfFilterSheet({ open, onClose, ...rest }: Props) {
  return (
    <Sheet open={open} onClose={onClose} title="Filter">
      {/* Mounted only while open, so the draft restarts from the applied filters each time. */}
      <Body {...rest} onClose={onClose} />
    </Sheet>
  );
}

function Body({ dept, cat, depts, onApply, onClose }: Omit<Props, "open">) {
  const [d, setD] = useState(dept);
  const [c, setC] = useState<DpCategory>(cat);
  return (
    <div>
      <div style={{ ...LABEL, margin: "0 2px 8px" }}>DEPARTMENT</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" aria-pressed={d === ""} onClick={() => setD("")} style={chip(d === "")}>
          All departments
        </button>
        {depts.map((x) => (
          <button key={x.code} type="button" aria-pressed={d === x.code} onClick={() => setD(x.code)} style={chip(d === x.code)}>
            {x.name}
          </button>
        ))}
      </div>
      <div style={{ ...LABEL, margin: "16px 2px 8px" }}>CATEGORY</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {CATS.map((o) => (
          <button key={o.l} type="button" aria-pressed={c === o.k} onClick={() => setC(o.k)} style={chip(c === o.k)}>
            {o.l}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
        <button
          type="button"
          onClick={() => {
            setD("");
            setC("");
          }}
          style={{ flex: "none", height: 46, padding: "0 18px", border: "none", borderRadius: 12, background: "#FFFFFF", boxShadow: "inset 0 0 0 1px #E6E0D9", color: "#1F1D1B", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
        >
          Reset
        </button>
        <button
          type="button"
          onClick={() => {
            onApply(d, c);
            onClose();
          }}
          style={{ flex: 1, height: 46, border: "none", borderRadius: 12, background: "#6B5C32", color: "#FFFFFF", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
        >
          Apply
        </button>
      </div>
    </div>
  );
}
