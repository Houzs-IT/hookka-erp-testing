// BreakdownPage — the full "View all N items" page of Employee Performance → Daily Breakdown (Employees 3.dc.html `epp`): Back, the
// worker and period, a search box ("Search product / item or department") with a clear button, "N items · M matches", and the same
// cards 40 at a time. Read-only.
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Search, X } from "lucide-react";
import { M } from "../../theme";
import BreakdownCard from "./BreakdownCard";
import { filterBreakdown, type BreakdownRow } from "./employee-performance-model";
import { CARD, COUNT_PILL } from "./employees-styles";

const PAGE = 40;

export default function BreakdownPage({ rows, who, periodLabel, onClose }: { rows: readonly BreakdownRow[]; who: string; periodLabel: string; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [n, setN] = useState(PAGE);
  const found = useMemo(() => filterBreakdown(rows, q), [rows, q]);
  const hasQ = q.trim().length > 0;

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
    <div role="dialog" aria-modal="true" aria-label="Daily Breakdown" style={{ position: "fixed", inset: 0, zIndex: 70, background: M.paper, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 4, minHeight: 52, padding: "env(safe-area-inset-top, 0px) 14px 0 8px", boxSizing: "border-box" }}>
        <button type="button" onClick={onClose} aria-label="Back" style={{ width: 44, height: 44, border: "none", background: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: M.raisin }}>
          <ChevronLeft size={24} strokeWidth={1.9} />
        </button>
        <div style={{ flex: 1, minWidth: 0, fontSize: 17, fontWeight: 700, color: M.raisin }}>Daily Breakdown</div>
        <span style={COUNT_PILL}>{rows.length}</span>
      </div>
      <div style={{ flex: "none", padding: "0 18px 8px" }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: M.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{who}</div>
        <div style={{ fontSize: 12, color: M.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontVariantNumeric: "tabular-nums" }}>{periodLabel}</div>
      </div>
      <div style={{ flex: "none", padding: "0 18px 10px" }}>
        <label style={{ height: 44, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 9, padding: "0 13px", background: "#FFFFFF", borderRadius: 14, boxShadow: "0 1px 2px rgba(31,29,27,.05), 0 8px 22px -10px rgba(31,29,27,.18)" }}>
          <Search size={18} strokeWidth={1.75} color="#9CA3AF" />
          <input
            className="emp-ph"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setN(PAGE);
            }}
            placeholder="Search product / item or department"
            aria-label="Search daily breakdown"
            style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", fontSize: 16, fontFamily: "inherit", color: M.raisin, padding: 0 }}
          />
          {hasQ ? (
            <button type="button" onClick={() => setQ("")} aria-label="Clear search" style={{ width: 32, height: 32, marginRight: -6, border: "none", background: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#9CA3AF" }}>
              <X size={16} strokeWidth={2} />
            </button>
          ) : null}
        </label>
        <div style={{ fontSize: 12, color: M.ink, margin: "8px 4px 0" }}>
          {rows.length} item{rows.length === 1 ? "" : "s"}
          {hasQ ? ` · ${found.length} match${found.length === 1 ? "" : "es"}` : ""}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "0 18px 28px" }}>
        {found.length === 0 ? (
          <div role="status" style={{ ...CARD, padding: 22, textAlign: "center", fontSize: 13, color: M.ink }}>
            No items match.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 10 }}>
            {found.slice(0, n).map((r) => (
              <BreakdownCard key={r.key} r={r} />
            ))}
          </div>
        )}
        {found.length > n ? (
          <button type="button" onClick={() => setN((v) => v + PAGE)} style={{ width: "100%", height: 42, marginTop: 10, border: "none", borderRadius: 12, background: "#FFFFFF", boxShadow: "0 1px 2px rgba(31,29,27,.05), 0 6px 16px -10px rgba(31,29,27,.18)", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, color: "#6B5C32", cursor: "pointer" }}>
            Load {PAGE} more · {found.length - n} left
          </button>
        ) : null}
      </div>
    </div>
  );
}
