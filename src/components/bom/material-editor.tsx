// ---------------------------------------------------------------------------
// Raw material picker + scaling editor for a BOM material line. Moved out of
// src/pages/bom.tsx (2026-11-22) so the BOM Builder and the product costing
// editor use ONE editor (owner: "我们的rawmaterial是跟BOM 那边的setup 一样？
// 有scale的功能？和选择from order的功能" — plan D8).
// ---------------------------------------------------------------------------
import React, { useState, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import type { MaterialScaling, MaterialScalingDimension } from "@/api/lib/material-scaling";

import { normaliseScaling, type RawMaterialOption } from "@/lib/bom-material";
export type { RawMaterialOption, WIPMaterial } from "@/lib/bom-material";


// ---------- Raw Material Select (searchable dropdown from inventory) ----------
// Where the dropdown should be drawn, in VIEWPORT coordinates.
//
// It is rendered through a portal rather than inside the row because the BOM
// modal body is `max-h-[85vh] overflow-y-auto`: an absolutely-positioned list
// belonging to a row near the bottom is clipped by that container, and the
// operator sees one option and a cut edge. Owner 2026-08-21: 「然后被cut掉了 看不到」.
function dropdownPosition(trigger: HTMLElement | null): {
  left: number;
  top: number;
  width: number;
  flipped: boolean;
} {
  if (!trigger) return { left: 0, top: 0, width: 320, flipped: false };
  const r = trigger.getBoundingClientRect();
  const WIDTH = 320;
  const HEIGHT = 300; // the from-SO block plus the 200px list
  const GAP = 4;
  // Flip above when the space below cannot hold it but the space above can.
  const below = window.innerHeight - r.bottom;
  const flipped = below < HEIGHT + GAP && r.top > below;
  return {
    left: Math.max(8, Math.min(r.left, window.innerWidth - WIDTH - 8)),
    top: flipped ? Math.max(8, r.top - HEIGHT - GAP) : r.bottom + GAP,
    width: WIDTH,
    flipped,
  };
}

export function RawMaterialSelect({
  value,
  materials,
  onSelect,
  onSelectAutoDetect,
}: {
  value: string;
  materials: RawMaterialOption[];
  onSelect: (rm: RawMaterialOption) => void;
  // When provided, renders two pinned options at the top of the dropdown
  // ("Fabric from SO" / "Leg from SO") that bind the material row to the
  // SO line's fabric or leg height instead of a fixed inventory item.
  onSelectAutoDetect?: (kind: "FABRIC" | "LEG") => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState(() => dropdownPosition(null));

  // Close on an outside click or Escape, and follow the trigger when the page
  // behind scrolls — a portalled list does not move with its row on its own,
  // and a list left hanging beside the wrong row is worse than a clipped one.
  useEffect(() => {
    if (!open) return;
    const reposition = () => setPos(dropdownPosition(triggerRef.current));
    reposition();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if ((t as HTMLElement).closest?.("[data-rm-dropdown]")) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  const filtered = useMemo(() => {
    if (!search.trim()) return materials.slice(0, 50);
    const q = search.toLowerCase();
    return materials.filter(
      (m) => m.itemCode.toLowerCase().includes(q) || m.description.toLowerCase().includes(q)
    ).slice(0, 50);
  }, [materials, search]);

  const showAutoDetect = !!onSelectAutoDetect && !search.trim();

  return (
    <div className="relative flex-1">
      <button
        type="button"
        ref={triggerRef}
        onClick={() => { setOpen(!open); setSearch(""); }}
        className="w-full text-left text-xs border border-gray-200 rounded px-1.5 py-1 bg-white hover:bg-gray-50 truncate font-mono"
      >
        {value || <span className="text-gray-400">Select material...</span>}
      </button>

      {open && createPortal(
        <div
          data-rm-dropdown
          className="fixed z-[100] bg-white border border-gray-200 rounded-lg shadow-lg"
          style={{ left: pos.left, top: pos.top, width: pos.width }}
        >
          <div className="p-1.5">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by code or description..."
              className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#6B5C32]/40"
            />
          </div>
          {showAutoDetect && (
            <div className="border-b border-gray-100 bg-[#F4F8FA]">
              <button
                onClick={() => { onSelectAutoDetect!("FABRIC"); setOpen(false); }}
                className="w-full text-left px-2 py-1.5 hover:bg-[#E0EDF0] transition-colors"
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] px-1.5 py-0.5 bg-[#E0EDF0] text-[#3E6570] rounded font-semibold border border-[#A8CAD2]">from SO</span>
                  <span className="text-xs font-medium text-[#3E6570]">Fabric (follow sales order)</span>
                </div>
                <div className="text-[10px] text-gray-500 mt-0.5">Resolves to SO item fabricCode at production time</div>
              </button>
              <button
                onClick={() => { onSelectAutoDetect!("LEG"); setOpen(false); }}
                className="w-full text-left px-2 py-1.5 hover:bg-[#E0EDF0] transition-colors"
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] px-1.5 py-0.5 bg-[#E0EDF0] text-[#3E6570] rounded font-semibold border border-[#A8CAD2]">from SO</span>
                  <span className="text-xs font-medium text-[#3E6570]">Leg (follow sales order)</span>
                </div>
                <div className="text-[10px] text-gray-500 mt-0.5">Resolves to SO item legHeightInches at production time</div>
              </button>
            </div>
          )}
          <div className="max-h-[200px] overflow-y-auto divide-y divide-gray-100">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-xs text-gray-400 text-center">No materials found</div>
            ) : (
              filtered.map((rm) => (
                <button
                  key={rm.id}
                  onClick={() => { onSelect(rm); setOpen(false); }}
                  className="w-full text-left px-2 py-1.5 hover:bg-[#FAF9F7] transition-colors"
                >
                  <div className="text-xs font-mono font-medium text-[#111827]">{rm.itemCode}</div>
                  <div className="text-[10px] text-gray-500 truncate">{rm.description} · {rm.baseUOM}</div>
                </button>
              ))
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// ---------- Material Scaling Editor ----------
// Inline three-input row that lives directly under each material row in
// the BOM editor. Lets the user attach a dimension-scaling rule:
//
//   { dimension, baseValue, perUnit }
//
// At consumption time the qty expands as:
//
//   effective = qty + max(0, SOLine[dim] - baseValue) * perUnit
//
// (See src/api/lib/material-scaling.ts for the apply path.) Leaving the
// dimension dropdown on "none" removes the scaling rule entirely. The
// editor renders inline + always-visible so the user can see at a glance
// which materials scale and which don't, without an extra toggle click.
// Labels match the SO line entry form (Total Height / Gap / Divan Height /
// Leg Height / Sofa Size) so authors don't have to map between two
// different vocabularies. Underlying value strings stay the same so the
// resolver in api/lib/material-scaling.ts keeps working.
const SCALING_DIM_OPTIONS: Array<{ value: MaterialScalingDimension; label: string }> = [
  { value: "totalHeight", label: "Total Height" },
  { value: "gap", label: "Gap" },
  { value: "divan", label: "Divan Height" },
  { value: "leg", label: "Leg Height" },
  { value: "seatHeight", label: "Sofa Size" },
];


export function MaterialScalingEditor({
  scaling,
  unit,
  isCut = false,
  onChange,
}: {
  // Accept legacy single-object or undefined at runtime even though the
  // declared WIPMaterial.scaling is now MaterialScaling[]. Saved BOMs
  // pre-array still flow through here; normaliseScaling handles them.
  scaling: MaterialScaling[] | MaterialScaling | undefined;
  unit: string;
  /** A cut material (FILLER): offer the cut-growth inputs. Defaults false so a
   *  caller that has no way to know simply does not show them. */
  isCut?: boolean;
  onChange: (next: MaterialScaling[] | undefined) => void;
}) {
  const rules = normaliseScaling(scaling);

  function emit(next: MaterialScaling[]) {
    onChange(next.length === 0 ? undefined : next);
  }

  function updateRule(idx: number, patch: Partial<MaterialScaling>) {
    const next = rules.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    emit(next);
  }

  function removeRule(idx: number) {
    emit(rules.filter((_, i) => i !== idx));
  }

  function addRule() {
    emit([
      ...rules,
      { dimension: "totalHeight", baseValue: 24, perUnit: 0 },
    ]);
  }

  // No rules yet: render only the "+ Add scaling" affordance so existing
  // unscaled materials keep their compact one-liner in the BOM tree.
  if (rules.length === 0) {
    return (
      <div className="ml-7 mb-1 flex items-center gap-1.5 text-[10px] text-gray-500">
        <button
          type="button"
          onClick={addRule}
          className="text-[10px] text-[#3E6570] hover:text-[#2A4A55] underline"
          title="Add a dimension scaling rule"
        >
          + Add scaling
        </button>
      </div>
    );
  }

  return (
    <div className="ml-7 mb-1 flex flex-col gap-1 text-[10px] text-gray-500">
      {rules.map((rule, idx) => (
        <div
          key={idx}
          className="flex flex-wrap items-center gap-1.5"
        >
          <span className="text-gray-400">Scale by</span>
          <select
            value={rule.dimension}
            onChange={(e) =>
              updateRule(idx, {
                dimension: e.target.value as MaterialScalingDimension,
              })
            }
            className="text-[10px] border border-gray-200 rounded px-1 py-0.5 bg-white"
          >
            {SCALING_DIM_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="text-gray-400">base</span>
          <input
            type="number" onFocus={(e) => e.currentTarget.select()}
            value={Number.isFinite(rule.baseValue) ? rule.baseValue : 0}
            step="1"
            min="0"
            onChange={(e) =>
              updateRule(idx, { baseValue: parseFloat(e.target.value) || 0 })
            }
            className="text-[10px] border border-gray-200 rounded px-1 py-0.5 w-12 bg-white"
            title="Smallest size at which the recorded qty applies"
          />
          <span className="text-gray-400">in, qty +</span>
          <input
            type="number" onFocus={(e) => e.currentTarget.select()}
            value={Number.isFinite(rule.perUnit) ? rule.perUnit : 0}
            step="0.01"
            min="0"
            onChange={(e) =>
              updateRule(idx, { perUnit: parseFloat(e.target.value) || 0 })
            }
            className="text-[10px] border border-gray-200 rounded px-1 py-0.5 w-14 bg-white"
            title="Extra qty per 1 inch over base"
          />
          <span className="text-gray-400">{unit || "unit"}/inch over base</span>
          {isCut && (
            <>
              {/* A cut material does not arrive in more pieces when the order
                  grows — the same piece is cut bigger. Owner 2026-08-21:
                  「通常是长度变而已」, so the two axes are separate and either may
                  stay at 0. */}
              <span className="text-[#B8601A]">· cut +</span>
              <input
                type="number" onFocus={(e) => e.currentTarget.select()}
                value={Number.isFinite(rule.cutLengthPerUnit ?? 0) ? (rule.cutLengthPerUnit ?? 0) : 0}
                step="0.1"
                min="0"
                placeholder="L"
                onChange={(e) =>
                  updateRule(idx, { cutLengthPerUnit: parseFloat(e.target.value) || 0 })
                }
                className="text-[10px] border border-[#E8B786] rounded px-1 py-0.5 w-12 bg-white"
                title="Inches added to the cut LENGTH per 1 inch over base"
              />
              <span className="text-[#B8601A]">×</span>
              <input
                type="number" onFocus={(e) => e.currentTarget.select()}
                value={Number.isFinite(rule.cutWidthPerUnit ?? 0) ? (rule.cutWidthPerUnit ?? 0) : 0}
                step="0.1"
                min="0"
                placeholder="W"
                onChange={(e) =>
                  updateRule(idx, { cutWidthPerUnit: parseFloat(e.target.value) || 0 })
                }
                className="text-[10px] border border-[#E8B786] rounded px-1 py-0.5 w-12 bg-white"
                title="Inches added to the cut WIDTH per 1 inch over base"
              />
              <span className="text-[#B8601A]">in/inch</span>
            </>
          )}
          <button
            type="button"
            onClick={() => removeRule(idx)}
            className="text-[#9A3A2D] hover:text-[#7A2E24] ml-1"
            title="Remove this scaling rule"
          >
            <svg
              className="w-3 h-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      ))}
      <div>
        <button
          type="button"
          onClick={addRule}
          className="text-[10px] text-[#3E6570] hover:text-[#2A4A55] underline"
          title="Stack another scaling rule on a different dimension"
        >
          + Add another
        </button>
      </div>
    </div>
  );
}
