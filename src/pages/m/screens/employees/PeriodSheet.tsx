// PeriodSheet — the shared Employees period picker (Employees 3.dc.html `lcd` sheet): a year ‹ › stepper over 12 month
// buttons (future months disabled), a Custom From/To range, an inline error and Apply. Dates are Malaysia dates: `today`
// comes from the caller, never from a hard-coded value.
//
// Phase 1: built and unit-tested, but not mounted on any tab — a tab only shows the picker once its data follows the
// shared period (see use-employees-period.ts).
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Sheet } from "../../components";
import { M } from "../../theme";
import {
  MIN_DATE,
  isFutureMonth,
  monthRange,
  monthShort,
  validateRange,
  wholeMonthOf,
  type YmdRange,
} from "./employees-dates";

type Props = {
  open: boolean;
  onClose: () => void;
  /** The currently applied range. */
  range: YmdRange;
  /** Malaysia today, YYYY-MM-DD. */
  today: string;
  onApply: (r: YmdRange) => void;
};

export function PeriodSheet({ open, onClose, range, today, onApply }: Props) {
  return (
    <Sheet open={open} onClose={onClose} title="Period">
      {/* Mounted only while open, so the draft restarts from the applied range each time. */}
      <PeriodBody range={range} today={today} onApply={onApply} onClose={onClose} />
    </Sheet>
  );
}

function PeriodBody({ range, today, onApply, onClose }: Omit<Props, "open">) {
  const [draft, setDraft] = useState<YmdRange>(range);
  const [error, setError] = useState<string | null>(null);
  const todayYear = Number(today.slice(0, 4));
  const minYear = Number(MIN_DATE.slice(0, 4));
  const [year, setYear] = useState<number>(() => wholeMonthOf(range)?.year ?? Number(range.from.slice(0, 4)));
  const selected = wholeMonthOf(draft);

  function apply() {
    const err = validateRange(draft, today);
    if (err) {
      setError(err);
      return;
    }
    onApply(draft);
    onClose();
  }

  const stepBtn = (disabled: boolean): React.CSSProperties => ({
    width: 32,
    height: 32,
    border: "none",
    borderRadius: "50%",
    background: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: disabled ? "default" : "pointer",
    color: M.taupe,
    opacity: disabled ? 0.35 : 1,
    padding: 0,
  });

  const dateInput: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    width: "100%",
    height: 42,
    boxSizing: "border-box",
    padding: "0 11px",
    border: "none",
    borderRadius: 10,
    background: M.card,
    boxShadow: "inset 0 0 0 1px #E6E0D9",
    fontFamily: "inherit",
    fontSize: 15,
    color: M.raisin,
    outline: "none",
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 0 8px" }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe, marginLeft: 2 }}>MONTH</span>
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <button
            type="button"
            aria-label="Previous year"
            disabled={year <= minYear}
            onClick={() => setYear((y) => y - 1)}
            style={stepBtn(year <= minYear)}
          >
            <ChevronLeft size={17} strokeWidth={2} />
          </button>
          <span style={{ minWidth: 44, textAlign: "center", fontSize: 14, fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums" }}>
            {year}
          </span>
          <button
            type="button"
            aria-label="Next year"
            disabled={year >= todayYear}
            onClick={() => setYear((y) => y + 1)}
            style={stepBtn(year >= todayYear)}
          >
            <ChevronRight size={17} strokeWidth={2} />
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6 }}>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
          const disabled = isFutureMonth(year, m, today);
          const on = !!selected && selected.year === year && selected.month === m;
          return (
            <button
              key={m}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => {
                setDraft(monthRange(year, m));
                setError(null);
              }}
              style={{
                opacity: disabled ? 0.38 : 1,
                height: 36,
                minWidth: 0,
                border: "none",
                borderRadius: 10,
                background: on ? M.taupe : M.card,
                color: on ? "#FFFFFF" : M.raisin,
                boxShadow: on ? "none" : "inset 0 0 0 1px #E6E0D9",
                fontFamily: "inherit",
                fontSize: 13,
                fontWeight: 700,
                cursor: disabled ? "default" : "pointer",
              }}
            >
              {monthShort(m)}
            </button>
          );
        })}
      </div>

      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe, margin: "14px 2px 8px" }}>CUSTOM RANGE</div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8 }}>
        <label style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ flex: "none", width: 38, fontSize: 12, fontWeight: 600, color: M.ink }}>From</span>
          <input
            type="date"
            value={draft.from}
            min={MIN_DATE}
            max={today}
            onChange={(e) => {
              setDraft((d) => ({ ...d, from: e.target.value }));
              setError(null);
            }}
            style={dateInput}
          />
        </label>
        <label style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ flex: "none", width: 38, fontSize: 12, fontWeight: 600, color: M.ink }}>To</span>
          <input
            type="date"
            value={draft.to}
            min={MIN_DATE}
            max={today}
            onChange={(e) => {
              setDraft((d) => ({ ...d, to: e.target.value }));
              setError(null);
            }}
            style={dateInput}
          />
        </label>
      </div>
      {error ? (
        <div role="alert" style={{ fontSize: 12, color: "#9A3A2D", margin: "6px 2px 0" }}>
          {error}
        </div>
      ) : null}

      <button
        type="button"
        onClick={apply}
        style={{
          marginTop: 16,
          width: "100%",
          height: 46,
          border: "none",
          borderRadius: 12,
          background: M.taupe,
          color: "#FFFFFF",
          fontFamily: "inherit",
          fontSize: 14,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        Apply
      </button>
    </div>
  );
}
