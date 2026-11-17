// HoursPage — the full "View all" page for Daily working hours (HK-0125 Phase 2), the same pattern as the Approved / Rejected
// adjustments page: a header with Back, a search box, a count line, and the cards 30 at a time. It lists the rows the
// Working Hours filters (date, department, search) currently select; its own search narrows them further.
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Search } from "lucide-react";
import { M } from "../../theme";
import HoursCard from "./HoursCard";
import { CARD, COUNT_PILL, LINK_BUTTON, SEARCH_BOX, SEARCH_INPUT } from "./employees-styles";
import { groupByDate, type WhRow } from "./working-hours-model";

const PAGE = 30;

export default function HoursPage({ rows, onClose }: { rows: readonly WhRow[]; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [n, setN] = useState(PAGE);
  const found = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? rows.filter((r) => r.name.toLowerCase().includes(s) || r.empNo.toLowerCase().includes(s)) : [...rows];
  }, [rows, q]);
  const groups = useMemo(() => groupByDate(found.slice(0, n)), [found, n]);

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
    <div role="dialog" aria-modal="true" aria-label="Daily working hours" style={{ position: "fixed", inset: 0, zIndex: 70, background: M.paper, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 6, minHeight: 52, padding: "env(safe-area-inset-top, 0px) 14px 0 6px", boxSizing: "border-box" }}>
        <button type="button" onClick={onClose} aria-label="Back" style={{ width: 44, height: 44, border: "none", background: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: M.raisin }}>
          <ChevronLeft size={22} strokeWidth={2} />
        </button>
        <div style={{ flex: 1, fontSize: 16, fontWeight: 700, color: M.raisin }}>Daily working hours</div>
        <span style={COUNT_PILL}>{found.length}</span>
      </div>
      <div style={{ flex: "none", padding: "4px 18px 8px" }}>
        <label style={SEARCH_BOX}>
          <Search size={16} strokeWidth={1.9} color={M.muted} />
          <input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setN(PAGE);
            }}
            placeholder="Name or employee no…"
            className="emp-ph"
            aria-label="Search by employee name or number"
            style={SEARCH_INPUT}
          />
        </label>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, color: M.taupe, margin: "10px 2px 0" }}>
          {q.trim() ? `${found.length} MATCHING` : `${found.length} ENTRIES`} · NEWEST FIRST
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "0 18px 24px" }}>
        {found.length === 0 ? (
          <div style={{ ...CARD, padding: 18, fontSize: 13, color: M.ink, textAlign: "center" }}>No entries match.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 12 }}>
            {groups.map((g) => (
              <div key={g.date} style={{ minWidth: 0 }}>
                <div style={{ padding: "2px 4px 6px", fontSize: 11, fontWeight: 700, letterSpacing: 0.8, color: M.taupe, textTransform: "uppercase" }}>{g.title}</div>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8 }}>
                  {g.rows.map((r) => (
                    <HoursCard key={r.key} r={r} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {found.length > n ? (
          <button type="button" onClick={() => setN((v) => v + PAGE)} style={{ ...LINK_BUTTON, borderTop: "none", marginTop: 12, ...COUNT_PILL, width: "100%", height: 40, borderRadius: 12 }}>
            Load {PAGE} more · {found.length - n} left
          </button>
        ) : null}
      </div>
    </div>
  );
}
