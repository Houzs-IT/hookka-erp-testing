// RevenueUnitsPage — the full "View all N units" page of Labor Cost → Revenue Raw Data (Employees 3.dc.html `lcp`): Back, the period
// (and category) under the title, a search box ("Search product, customer or SO") with a clear button, "N UNITS · M MATCHES", and the
// recognised units grouped by date (newest first), one card per unit with a category rail and pill: product, customer, SO,
// Qty × Unit price and Total. 40 units at a time. Read-only.
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Search, X } from "lucide-react";
import { formatRM } from "@/lib/utils";
import { M } from "../../theme";
import { CARD, SHEET_CARD } from "./employees-styles";
import { catLabel, catTone, filterUnits, groupUnits, unitProduct, type RevenueUnit } from "./labor-cost-model";

const PAGE = 40;
const dmy = (ymd: string) => (/^\d{4}-\d{2}-\d{2}$/.test(ymd) ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}` : ymd || "—");

export default function RevenueUnitsPage({ rows, sub, onClose }: { rows: readonly RevenueUnit[]; sub: string; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [n, setN] = useState(PAGE);
  const found = useMemo(() => filterUnits(rows, q), [rows, q]);
  const groups = useMemo(() => groupUnits(found.slice(0, n)), [found, n]);
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
    <div role="dialog" aria-modal="true" aria-label="Revenue Raw Data" style={{ position: "fixed", inset: 0, zIndex: 70, background: M.paper, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 4, minHeight: 52, padding: "env(safe-area-inset-top, 0px) 14px 0 8px", boxSizing: "border-box" }}>
        <button type="button" onClick={onClose} aria-label="Back" style={{ width: 44, height: 44, border: "none", background: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: M.raisin }}>
          <ChevronLeft size={24} strokeWidth={1.9} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: M.raisin }}>Revenue Raw Data</div>
          <div style={{ fontSize: 12, color: M.ink, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>
        </div>
      </div>
      <div style={{ flex: "none", padding: "4px 18px 10px" }}>
        <label style={{ height: 44, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 9, padding: "0 13px", background: "#FFFFFF", borderRadius: 14, boxShadow: "0 1px 2px rgba(31,29,27,.05), 0 8px 22px -10px rgba(31,29,27,.18)" }}>
          <Search size={18} strokeWidth={1.75} color="#9CA3AF" />
          <input
            className="emp-ph"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setN(PAGE);
            }}
            placeholder="Search product, customer or SO"
            aria-label="Search revenue raw data"
            style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", fontSize: 16, fontFamily: "inherit", color: M.raisin, padding: 0 }}
          />
          {hasQ ? (
            <button type="button" onClick={() => setQ("")} aria-label="Clear search" style={{ width: 32, height: 32, marginRight: -6, border: "none", background: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#9CA3AF" }}>
              <X size={16} strokeWidth={2} />
            </button>
          ) : null}
        </label>
        <div style={{ padding: "10px 4px 0", fontSize: 11, fontWeight: 700, letterSpacing: 1, color: "#6B5C32", textTransform: "uppercase" }}>
          {rows.length} unit{rows.length === 1 ? "" : "s"}
          {hasQ ? ` · ${found.length} match${found.length === 1 ? "" : "es"}` : ""}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "0 18px 28px" }}>
        {found.length === 0 ? (
          <div role="status" style={{ ...CARD, padding: 22, textAlign: "center", fontSize: 13, color: M.ink }}>
            {hasQ ? `No units match “${q.trim()}”.` : "No revenue recognised for this selection."}
          </div>
        ) : null}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 10 }}>
          {groups.map((g) => (
            <div key={g.date} style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 4px 0" }}>
                <span style={{ flex: "none", fontSize: 11, fontWeight: 700, letterSpacing: 0.8, color: "#6B5C32" }}>{dmy(g.date)}</span>
                <span aria-hidden="true" style={{ flex: 1, height: 1, background: "#E6E0D9" }} />
                <span style={{ flex: "none", fontSize: 11.5, color: M.ink, fontVariantNumeric: "tabular-nums" }}>
                  {g.units} unit{g.units === 1 ? "" : "s"} · {formatRM(g.totalSen)}
                </span>
              </div>
              {g.rows.map((u, i) => {
                const tone = catTone(u.category);
                return (
                  <div key={`${g.date}-${u.soNo}-${u.productCode}-${i}`} style={{ ...SHEET_CARD, position: "relative", overflow: "hidden", padding: "12px 14px 12px 17px" }}>
                    <span aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: tone.rail }} />
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: M.raisin, lineHeight: 1.35, overflowWrap: "anywhere" }}>{unitProduct(u)}</span>
                        <span style={{ display: "block", fontSize: 12, color: M.ink, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.customerName || "—"}</span>
                      </span>
                      <span style={{ flex: "none", height: 22, display: "inline-flex", alignItems: "center", padding: "0 8px", borderRadius: 999, background: tone.bg, color: tone.fg, fontSize: 11, fontWeight: 700 }}>{catLabel(u.category ?? "")}</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "8px 10px", marginTop: 10, padding: "9px 10px", borderRadius: 10, background: "#FAF8F4" }}>
                      <Cell k="SO" v={u.soNo || "—"} />
                      <Cell k="Qty × Unit price" v={`${u.qty ?? "—"} × ${formatRM(Number(u.unitPriceSen) || 0)}`} />
                      <Cell k="Total" v={formatRM(Number(u.totalPriceSen) || 0)} right bold />
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {found.length > n ? (
          <button type="button" onClick={() => setN((v) => v + PAGE)} style={{ width: "100%", height: 42, marginTop: 10, border: "none", borderRadius: 12, background: "#FFFFFF", boxShadow: "0 1px 2px rgba(31,29,27,.05), 0 6px 16px -10px rgba(31,29,27,.18)", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, color: "#6B5C32", cursor: "pointer" }}>
            Load {PAGE} more · {found.length - n} left
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Cell({ k, v, right, bold }: { k: string; v: string; right?: boolean; bold?: boolean }) {
  return (
    <div style={{ minWidth: 0, textAlign: right ? "right" : "left" }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.2, color: "#9A9082", whiteSpace: "nowrap" }}>{k}</div>
      <div style={{ fontSize: bold ? 13 : 12.5, fontWeight: bold ? 700 : 600, color: M.raisin, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontVariantNumeric: "tabular-nums" }}>{v}</div>
    </div>
  );
}
