// DeptLaborFilterSheet — the Department Labor "Filter" sheet (Employees 3.dc.html `dlf`): CATEGORY (All · Sofa · Bedframe · Accessory),
// DEPARTMENT TYPE (All · Production · Non-production) and DEPARTMENT (pick one or more), then Reset and "Show departments".
// The draft lives in the sheet and is applied only on "Show departments".
import { useState, type CSSProperties } from "react";
import { Sheet } from "../../components";
import { M } from "../../theme";
import type { DlCategory, DlType } from "./department-labor-model";

export type SheetValue = { category: DlCategory; type: DlType; depts: readonly string[] };

const CATS: { k: DlCategory; l: string }[] = [
  { k: "", l: "All" },
  { k: "SOFA", l: "Sofa" },
  { k: "BEDFRAME", l: "Bedframe" },
  { k: "ACCESSORY", l: "Accessory" },
];
const TYPES: { k: DlType; l: string }[] = [
  { k: "all", l: "All" },
  { k: "prod", l: "Production" },
  { k: "non", l: "Non-production" },
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

export default function DeptLaborFilterSheet({
  open,
  value,
  depts,
  onApply,
  onClose,
}: {
  open: boolean;
  value: SheetValue;
  depts: readonly { code: string; name: string }[];
  onApply: (v: SheetValue) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Filter">
      {/* Mounted only while open, so the draft restarts from the applied filters each time. */}
      <Body value={value} depts={depts} onApply={onApply} onClose={onClose} />
    </Sheet>
  );
}

function Body({ value, depts, onApply, onClose }: Omit<Parameters<typeof DeptLaborFilterSheet>[0], "open">) {
  const [draft, setDraft] = useState<SheetValue>({ ...value, depts: [...value.depts] });
  const toggle = (code: string) =>
    setDraft((d) => ({ ...d, depts: d.depts.includes(code) ? d.depts.filter((c) => c !== code) : [...d.depts, code] }));
  return (
    <div>
      <div style={{ ...LABEL, margin: "0 2px 8px" }}>CATEGORY</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {CATS.map((o) => (
          <button key={o.l} type="button" aria-pressed={draft.category === o.k} onClick={() => setDraft((d) => ({ ...d, category: o.k }))} style={chip(draft.category === o.k)}>
            {o.l}
          </button>
        ))}
      </div>
      <div style={{ ...LABEL, margin: "16px 2px 8px" }}>DEPARTMENT TYPE</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {TYPES.map((o) => (
          <button key={o.l} type="button" aria-pressed={draft.type === o.k} onClick={() => setDraft((d) => ({ ...d, type: o.k }))} style={chip(draft.type === o.k)}>
            {o.l}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", margin: "16px 2px 8px" }}>
        <span style={LABEL}>DEPARTMENT</span>
        <span style={{ fontSize: 11.5, color: M.ink }}>{draft.depts.length ? `${draft.depts.length} selected` : "Pick one or more"}</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" aria-pressed={draft.depts.length === 0} onClick={() => setDraft((d) => ({ ...d, depts: [] }))} style={chip(draft.depts.length === 0)}>
          All
        </button>
        {depts.map((d) => (
          <button key={d.code} type="button" aria-pressed={draft.depts.includes(d.code)} onClick={() => toggle(d.code)} style={chip(draft.depts.includes(d.code))}>
            {d.name}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
        <button type="button" onClick={() => setDraft({ category: "", type: "all", depts: [] })} style={{ flex: "none", height: 46, padding: "0 18px", border: "none", borderRadius: 12, background: "#FFFFFF", boxShadow: "inset 0 0 0 1px #E6E0D9", color: M.raisin, fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
          Reset
        </button>
        <button
          type="button"
          onClick={() => {
            onApply(draft);
            onClose();
          }}
          style={{ flex: 1, height: 46, border: "none", borderRadius: 12, background: "#6B5C32", color: "#FFFFFF", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
        >
          Show departments
        </button>
      </div>
    </div>
  );
}
