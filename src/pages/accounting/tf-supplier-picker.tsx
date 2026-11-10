// ---------------------------------------------------------------------------
// tf-supplier-picker.tsx — the Suppliers box in the Cash Flow Capex & financing
// popup's Trade finance block (owner 2026-11-10: 「我要能选，别太复杂，就是tick」,
// then a screenshot of a picker from another system: 「supplier 名字和total
// amount，然后tick…这个amounts是forecast PNL 的 amount」; spec
// docs/superpowers/specs/2026-11-09-forecast-three-columns-design.md 5).
//
// A box naming the ticked suppliers opens a small table over the popup: a
// tick, the supplier and its Forecast P&L amount due in the months shown,
// biggest first, the ticked total last (rows from tfSupplierRows). The table
// is portalled to the page, so the popup's scrolling table never clips it,
// and it opens upward when there is no room below. Esc or a click outside
// closes the table only.
// ---------------------------------------------------------------------------
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { useEscapeClose } from "@/lib/escape-stack";
import { DROPDOWN_GAP, DROPDOWN_VIEWPORT_MARGIN, computeDropdownPlacement } from "@/lib/dropdown-placement";
import { fmtAmt } from "@/lib/finance-reports";
import { tfSupplierLabel } from "@/lib/cashflow-forecast";

export type TfSupplierPickRow = { id: string; name: string; totalSen: number; ticked: boolean };

/** The table's width, and the height it asks for (about ten rows). */
const PANEL_W = 420;
const PANEL_H = 380;

type PanelPos = { left: number; width: number; top?: number; bottom?: number; maxHeight: number };

export function TfSupplierPicker({ rows, tickedTotalSen, monthsLabel, onToggle }: {
  rows: TfSupplierPickRow[];
  tickedTotalSen: number;
  /** The months the amounts cover, e.g. "Nov'26 – Oct'27". */
  monthsLabel: string;
  onToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  useEscapeClose(() => setOpen(false), open);
  const boxRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<PanelPos | null>(null);

  // Placed against the box before paint on open, and again whenever anything
  // scrolls or the window resizes.
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const el = boxRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const p = computeDropdownPlacement(r, window.innerHeight, PANEL_H);
      const width = Math.min(PANEL_W, window.innerWidth - 2 * DROPDOWN_VIEWPORT_MARGIN);
      const left = Math.max(DROPDOWN_VIEWPORT_MARGIN, Math.min(r.left, window.innerWidth - width - DROPDOWN_VIEWPORT_MARGIN));
      setPos(p.side === "below"
        ? { left, width, top: r.bottom + DROPDOWN_GAP, maxHeight: p.maxHeight }
        : { left, width, bottom: window.innerHeight - r.top + DROPDOWN_GAP, maxHeight: p.maxHeight });
    };
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open]);

  // A click outside the box and the table closes the table.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!boxRef.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const tickedNames = rows.filter((r) => r.ticked).map((r) => tfSupplierLabel(r.name));
  const boxText = tickedNames.length ? tickedNames.join(", ") : "none ticked";
  const cell = "px-2 py-1.5";
  const th = `sticky top-0 z-10 bg-white ${cell} text-[11px] font-semibold uppercase tracking-wide text-[#6B7280] shadow-[inset_0_-1px_0_#E2DDD8]`;
  const foot = `sticky bottom-0 bg-white ${cell} shadow-[inset_0_1px_0_#E2DDD8]`;
  return (
    <>
      <button
        ref={boxRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`Fill from Forecast P&L takes the ticked suppliers: ${boxText}`}
        className={`inline-flex h-6 max-w-[22rem] items-center gap-1 rounded border bg-white px-2 text-[11px] ${open ? "border-[#6B5C32] ring-2 ring-[#6B5C32]/20" : "border-[#E2DDD8] hover:border-[#CFC8BF]"}`}
      >
        <span className="shrink-0 text-[#6B7280]">Suppliers:</span>
        <span className="truncate text-[#1F1D1B]">{boxText}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-[#9CA3AF]" />
      </button>
      {open && pos && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Suppliers for Fill from Forecast P&L"
          data-tf-supplier-picker=""
          style={{ position: "fixed", left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width, maxHeight: pos.maxHeight }}
          className="z-[60] flex flex-col overflow-hidden rounded-md border border-[#E2DDD8] bg-white text-xs shadow-lg"
        >
          {rows.length === 0 ? (
            <p className="px-3 py-3 text-[#6B7280]">
              No supplier has Forecast P&L figures due {monthsLabel}. Key them per supplier under each material (▸) on the Forecast P&L.
            </p>
          ) : (
            <div className="min-h-0 overflow-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className={`${th} w-8`} aria-label="Ticked" />
                    <th className={`${th} text-left`}>Supplier</th>
                    <th className={`${th} text-right`}>Forecast P&L (RM)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className={`border-b border-[#F0ECE9] hover:bg-[#F7F5F2] ${r.ticked ? "bg-[#FAF8F4]" : ""}`}>
                      <td className={`${cell} text-center`}>
                        <input
                          id={`tf-sup-${r.id}`}
                          type="checkbox"
                          checked={r.ticked}
                          onChange={() => onToggle(r.id)}
                          className="h-3.5 w-3.5 cursor-pointer accent-[#6B5C32]"
                        />
                      </td>
                      <td className={cell}>
                        <label htmlFor={`tf-sup-${r.id}`} title={r.name} className="block cursor-pointer text-[#1F1D1B]">{tfSupplierLabel(r.name)}</label>
                      </td>
                      <td className={`${cell} text-right tabular-nums text-[#1F1D1B]`}>{r.totalSen ? fmtAmt(r.totalSen) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold text-[#1F1D1B]">
                    <td className={foot} />
                    <td className={foot}>Ticked total</td>
                    <td className={`${foot} text-right tabular-nums`}>{tickedTotalSen ? fmtAmt(tickedTotalSen) : "-"}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <p className="shrink-0 border-t border-[#E2DDD8] bg-[#F7F5F2] px-3 py-1.5 text-[11px] text-[#6B7280]">
            Due {monthsLabel}, each by its supplier&apos;s term. After changing a tick, press Fill from Forecast P&L.
          </p>
        </div>,
        document.body,
      )}
    </>
  );
}
