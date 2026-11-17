// PayrollSheets — the three bottom sheets of the Payroll list (Employees 3.dc.html `pyms`, `pyf`, `pyk`): the Payroll month picker (a year
// stepper over 12 months, future months disabled), the worker Filter (STATUS · DEPARTMENT · DEDUCTIONS, "Show N workers") and the card
// sheets (Total Pay / Statutory (all)). All read-only.
import { useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Sheet } from "../../components";
import { M } from "../../theme";
import { DEDUCTION_CHOICES, STATUS_CHOICES, monthsOfYear, type Deduction, type PayFilters, type Sheet as CardSheet } from "./payroll-model";

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
const round = (disabled: boolean): CSSProperties => ({
  width: 38,
  height: 38,
  borderRadius: "50%",
  border: "none",
  background: "#FFFFFF",
  boxShadow: "0 1px 2px rgba(31,29,27,.06), 0 4px 10px -6px rgba(31,29,27,.16)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: disabled ? "default" : "pointer",
  color: "#6B5C32",
  opacity: disabled ? 0.35 : 1,
  padding: 0,
});

// ---- the month ---------------------------------------------------------------------------------------------------------------------

export function MonthSheet({ open, month, today, onPick, onClose }: { open: boolean; month: string; today: string; onPick: (ym: string) => void; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Payroll month">
      <MonthBody month={month} today={today} onPick={onPick} onClose={onClose} />
    </Sheet>
  );
}
function MonthBody({ month, today, onPick, onClose }: { month: string; today: string; onPick: (ym: string) => void; onClose: () => void }) {
  const [year, setYear] = useState(Number(month.slice(0, 4)));
  const thisYear = Number(today.slice(0, 4));
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <button type="button" onClick={() => setYear((y) => Math.max(2020, y - 1))} aria-label="Previous year" disabled={year <= 2020} style={round(year <= 2020)}>
          <ChevronLeft size={17} strokeWidth={2} />
        </button>
        <span style={{ fontSize: 16, fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums" }}>{year}</span>
        <button type="button" onClick={() => setYear((y) => Math.min(thisYear, y + 1))} aria-label="Next year" disabled={year >= thisYear} style={round(year >= thisYear)}>
          <ChevronRight size={17} strokeWidth={2} />
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
        {monthsOfYear(year, today).map((m) => {
          const on = m.ym === month;
          return (
            <button
              key={m.ym}
              type="button"
              disabled={m.disabled}
              onClick={() => {
                onPick(m.ym);
                onClose();
              }}
              aria-pressed={on}
              style={{ opacity: m.disabled ? 0.35 : 1, height: 40, minWidth: 0, border: "none", borderRadius: 10, background: on ? "#6B5C32" : "#FFFFFF", color: on ? "#FFFFFF" : M.raisin, boxShadow: on ? "none" : "0 1px 2px rgba(31,29,27,.06), 0 4px 10px -6px rgba(31,29,27,.16)", fontFamily: "inherit", fontSize: 13.5, fontWeight: 700, cursor: m.disabled ? "default" : "pointer" }}
            >
              {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m.month - 1]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---- the worker filter -------------------------------------------------------------------------------------------------------------

type FilterValue = Pick<PayFilters, "st" | "dept" | "ded">;
export function FilterSheet({
  open,
  value,
  depts,
  count,
  onApply,
  onClose,
}: {
  open: boolean;
  value: FilterValue;
  depts: readonly { code: string; name: string }[];
  /** How many workers a draft selection would show (the button label). */
  count: (draft: FilterValue) => number;
  onApply: (v: FilterValue) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Filter">
      <FilterBody value={value} depts={depts} count={count} onApply={onApply} onClose={onClose} />
    </Sheet>
  );
}
function FilterBody({ value, depts, count, onApply, onClose }: Omit<Parameters<typeof FilterSheet>[0], "open">) {
  const [d, setD] = useState<FilterValue>(value);
  const n = count(d);
  return (
    <div>
      <div style={{ ...LABEL, margin: "0 2px 8px" }}>STATUS</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {STATUS_CHOICES.map((o) => (
          <button key={o.k} type="button" aria-pressed={d.st === o.k} onClick={() => setD((x) => ({ ...x, st: o.k }))} style={chip(d.st === o.k)}>
            {o.l}
          </button>
        ))}
      </div>
      <div style={{ ...LABEL, margin: "16px 2px 8px" }}>DEPARTMENT</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" aria-pressed={d.dept === "all"} onClick={() => setD((x) => ({ ...x, dept: "all" }))} style={chip(d.dept === "all")}>
          All
        </button>
        {depts.map((o) => (
          <button key={o.code} type="button" aria-pressed={d.dept === o.code} onClick={() => setD((x) => ({ ...x, dept: o.code }))} style={chip(d.dept === o.code)}>
            {o.name}
          </button>
        ))}
      </div>
      <div style={{ ...LABEL, margin: "16px 2px 8px" }}>DEDUCTIONS</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {DEDUCTION_CHOICES.map((o) => (
          <button key={o.k} type="button" aria-pressed={d.ded === o.k} onClick={() => setD((x) => ({ ...x, ded: o.k as Deduction }))} style={chip(d.ded === o.k)}>
            {o.l}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
        <button type="button" onClick={() => setD({ st: "all", dept: "all", ded: "all" })} style={{ flex: "none", height: 46, padding: "0 18px", border: "none", borderRadius: 12, background: "#FFFFFF", boxShadow: "inset 0 0 0 1px #E6E0D9", color: M.raisin, fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
          Reset
        </button>
        <button
          type="button"
          onClick={() => {
            onApply(d);
            onClose();
          }}
          style={{ flex: 1, height: 46, border: "none", borderRadius: 12, background: "#6B5C32", color: "#FFFFFF", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
        >
          Show {n} worker{n === 1 ? "" : "s"}
        </button>
      </div>
    </div>
  );
}

// ---- the card sheets ---------------------------------------------------------------------------------------------------------------

export function CardSheetView({ open, sheet, onClose }: { open: boolean; sheet: CardSheet | null; onClose: () => void }) {
  return (
    <Sheet open={open && !!sheet} onClose={onClose} title={sheet?.title ?? ""}>
      {sheet ? (
        <div>
          <div style={{ fontSize: 12, color: M.ink, margin: "-4px 2px 10px" }}>{sheet.sub}</div>
          <div style={{ background: "#FFFFFF", borderRadius: 16, boxShadow: "0 1px 2px rgba(31,29,27,.05), 0 12px 28px -16px rgba(31,29,27,.22)", padding: "4px 14px" }}>
            {sheet.rows.map((x, i) => (
              <div key={x.k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 0", borderTop: i ? "1px solid #EEE9E4" : "none", fontSize: 13 }}>
                <span style={{ color: M.ink }}>{x.k}</span>
                <span style={{ fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums" }}>{x.v}</span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 0", borderTop: "1px solid #E6E0D9", fontSize: 14, fontWeight: 700 }}>
              <span style={{ color: M.raisin }}>Total</span>
              <span style={{ color: "#6B5C32", fontVariantNumeric: "tabular-nums" }}>{sheet.total}</span>
            </div>
          </div>
          {sheet.note ? <div style={{ fontSize: 12, color: "#6B7280", margin: "8px 4px 0" }}>{sheet.note}</div> : null}
        </div>
      ) : null}
    </Sheet>
  );
}
