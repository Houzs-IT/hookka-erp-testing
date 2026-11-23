// ---------------------------------------------------------------------------
// MRP — raw materials (owner 2026-11-23, ported from the Houzs / Conts MRP).
//
// One table of raw materials needed by open production orders, netted against
// RM stock and open POs (GET /api/mrp/plan — recomputed live on every load).
// Tabs = merged material groups (src/lib/mrp-groups.ts: sofa + bedframe
// together; a new RM category gets its own tab). Expand a row to see each
// production order and what covers it (Stock / PO / Short). Deliberately no
// KPI tiles and no banner (owner: 「这些不需要」). Create PO is the next step.
// ---------------------------------------------------------------------------
import { Fragment, useMemo, useState } from "react";
import { useCachedJson, invalidateCachePrefix } from "@/lib/cached-fetch";
import { Button } from "@/components/ui/button";
import { Layers, RefreshCw, Loader2, Download, ChevronRight, ChevronDown } from "lucide-react";
import type { RowKind, StyledSheet } from "@/lib/styled-xlsx";

type Cover =
  | { source: "STOCK"; qty: number }
  | { source: "PO"; ref: string; eta: string; qty: number };

type OrderLine = {
  productionOrderId: string;
  poNo: string;
  productCode: string;
  quantity: number;
  jobCardId: string | null;
  dept: string;
  wipKey: string;
  required: number;
  needBy: string;
  covers: Cover[];
  shortQty: number;
  status: "READY" | "WAITING_PO" | "SHORT";
};

type MaterialRow = {
  rmId: string;
  code: string;
  description: string;
  itemGroup: string;
  group: string;
  uom: string;
  needed: number;
  stock: number;
  poOutstanding: number;
  short: number;
  poOtherUnit: { ref: string; eta: string; qty: number; unit: string }[];
  firstNeedBy: string;
  mainSupplier: string | null;
  orders: OrderLine[];
};

type Plan = {
  calculatedAt: string;
  groups: string[];
  materials: MaterialRow[];
  productionOrders: { open: number; counted: number; alreadyDeducted: number; noBom: number };
  unresolved: { poNo: string; productCode: string; material: string; required: number }[];
  openPoLinesUnresolved: number;
};

type Win = "1w" | "2w" | "1m" | "all";
const WINDOWS: { key: Win; label: string; days: number | null }[] = [
  { key: "1w", label: "This week", days: 7 },
  { key: "2w", label: "2 weeks", days: 14 },
  { key: "1m", label: "1 month", days: 31 },
  { key: "all", label: "All", days: null },
];

const DEPT_LABEL: Record<string, string> = {
  FAB_CUT: "Fab Cut",
  FAB_SEW: "Fab Sew",
  WOOD_CUT: "Wood Cut",
  FOAM_CUTTING: "Foam Cutting",
  FOAM: "Foam",
  FIBRE: "Fibre",
  FRAMING: "Framing",
  WEBBING: "Webbing",
  UPHOLSTERY: "Upholstery",
  PACKING: "Packing",
};

const fmtQty = (n: number): string =>
  Math.abs(n) < 1e-9
    ? "—"
    : n.toLocaleString("en-MY", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const fmtDate = (d: string): string => {
  if (!d) return "—";
  const dt = new Date(`${d.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

const fmtTime = (iso: string): string => {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

const coverLabel = (c: Cover, uom: string): string =>
  c.source === "STOCK"
    ? `Stock ${fmtQty(c.qty)} ${uom}`
    : `${c.ref}${c.eta ? ` · ETA ${fmtDate(c.eta)}` : ""} · ${fmtQty(c.qty)} ${uom}`;

function cutoffFor(win: Win): string | null {
  const w = WINDOWS.find((x) => x.key === win);
  if (!w || w.days == null) return null;
  const d = new Date();
  d.setDate(d.getDate() + w.days);
  return d.toISOString().slice(0, 10);
}

// The row as seen through the need-by window: only order lines due by the
// cutoff count toward Needed / Short. An order with no date only shows in All.
function windowed(m: MaterialRow, cutoff: string | null): MaterialRow | null {
  if (!cutoff) return m;
  const orders = m.orders.filter((o) => o.needBy && o.needBy <= cutoff);
  if (orders.length === 0) return null;
  return {
    ...m,
    orders,
    needed: orders.reduce((s, o) => s + o.required, 0),
    short: orders.reduce((s, o) => s + o.shortQty, 0),
  };
}

export default function MRPPage() {
  const { data: resp, loading, error } = useCachedJson<{
    success?: boolean;
    data?: Plan;
    error?: string;
  }>("/api/mrp/plan");
  // Recalculate = a fresh GET (the plan is never stored). The fresh answer
  // replaces the cached one on screen; a failure is shown, never swallowed.
  const [fresh, setFresh] = useState<Plan | null>(null);
  const [recalcError, setRecalcError] = useState<string | null>(null);
  const [recalculating, setRecalculating] = useState(false);
  const plan = fresh ?? (resp?.success ? resp.data : undefined);

  const recalculate = async () => {
    setRecalculating(true);
    setRecalcError(null);
    try {
      const res = await fetch("/api/mrp/plan", { cache: "no-store" });
      const json = (await res.json()) as { success?: boolean; data?: Plan; error?: string };
      if (json.success && json.data) {
        setFresh(json.data);
        invalidateCachePrefix("/api/mrp/plan");
      } else {
        setRecalcError(json.error || `MRP calculation failed (HTTP ${res.status}).`);
      }
    } catch (err) {
      setRecalcError(err instanceof Error ? err.message : String(err));
    } finally {
      setRecalculating(false);
    }
  };

  const [tab, setTab] = useState<string>("ALL");
  const [win, setWin] = useState<Win>("all");
  const [onlyShort, setOnlyShort] = useState(false);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [showGaps, setShowGaps] = useState(false);
  const [exporting, setExporting] = useState(false);

  const cutoff = cutoffFor(win);
  const inWindow = useMemo(
    () => (plan?.materials ?? []).map((m) => windowed(m, cutoff)).filter((m): m is MaterialRow => !!m),
    [plan, cutoff],
  );

  const tabs = useMemo(() => {
    const groups = plan?.groups ?? [];
    const used = groups.filter((g) => inWindow.some((m) => m.group === g));
    const unused = groups.filter((g) => !used.includes(g));
    // A group present in the plan but missing from the live list (should not
    // happen) still gets a tab rather than hiding its rows.
    const extra = [...new Set(inWindow.map((m) => m.group))].filter((g) => !groups.includes(g));
    return ["ALL", ...used, ...extra, ...unused].map((g) => {
      const rows = inWindow.filter((m) => g === "ALL" || m.group === g);
      return { key: g, label: g === "ALL" ? "All" : g, count: rows.length, short: rows.filter((m) => m.short > 0).length };
    });
  }, [plan, inWindow]);

  const needle = q.trim().toLowerCase();
  const rows = inWindow.filter(
    (m) =>
      (tab === "ALL" || m.group === tab) &&
      (!onlyShort || m.short > 0) &&
      (!needle || m.code.toLowerCase().includes(needle) || m.description.toLowerCase().includes(needle)),
  );

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const exportExcel = async () => {
    if (!plan) return;
    setExporting(true);
    try {
      const { exportStyledWorkbookXlsx } = await import("@/lib/styled-xlsx");
      const stamp = `Calculated ${fmtTime(plan.calculatedAt)} · need-by ${WINDOWS.find((w) => w.key === win)?.label ?? "All"}${tab === "ALL" ? "" : ` · ${tab}`}`;
      const matAoa: (string | number)[][] = [
        ["MRP — raw materials"],
        [stamp],
        [],
        ["Code", "Description", "Material", "RM category", "UOM", "Needed", "Stock", "PO outstanding", "Short", "First need-by", "Main supplier", "Orders"],
      ];
      const matKinds: RowKind[] = ["title", "meta", "blank", "header"];
      const ordAoa: (string | number)[][] = [
        ["MRP — production orders per material"],
        [stamp],
        [],
        ["Code", "Production order", "Product", "Qty", "Dept", "Needs", "UOM", "Need-by", "Covered by", "Short", "Status"],
      ];
      const ordKinds: RowKind[] = ["title", "meta", "blank", "header"];
      for (const m of rows) {
        matAoa.push([m.code, m.description, m.group, m.itemGroup, m.uom, m.needed, m.stock, m.poOutstanding, m.short, m.firstNeedBy, m.mainSupplier ?? "", m.orders.length]);
        matKinds.push("item");
        for (const o of m.orders) {
          ordAoa.push([
            m.code,
            o.poNo,
            o.productCode,
            o.quantity,
            DEPT_LABEL[o.dept] ?? o.dept,
            o.required,
            m.uom,
            o.needBy,
            o.covers.map((c) => coverLabel(c, m.uom)).join("; "),
            o.shortQty,
            o.status === "READY" ? "Ready" : o.status === "WAITING_PO" ? "Waiting PO" : "Short",
          ]);
          ordKinds.push("item");
        }
      }
      const sheets: StyledSheet[] = [
        { name: "Materials", aoa: matAoa, kinds: matKinds, cols: [18, 34, 12, 12, 7, 11, 11, 13, 11, 12, 22, 8], numCols: [5, 6, 7, 8, 11] },
        { name: "Orders", aoa: ordAoa, kinds: ordKinds, cols: [18, 18, 18, 6, 12, 10, 7, 12, 40, 10, 11], numCols: [3, 5, 9] },
      ];
      await exportStyledWorkbookXlsx(`MRP-${plan.calculatedAt.slice(0, 10)}.xlsx`, sheets);
    } finally {
      setExporting(false);
    }
  };

  const failed = !loading && !plan;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#1F1D1B] flex items-center gap-2">
            <Layers className="h-7 w-7 text-[#6B5C32]" />
            MRP — Raw Materials
          </h1>
          <p className="text-xs text-[#6B7280] mt-0.5">
            Open production orders × BOM against raw-material stock and open POs.
            {plan ? ` Calculated ${fmtTime(plan.calculatedAt)}.` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={recalculate} disabled={recalculating || loading}>
            {recalculating || loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Recalculate
          </Button>
          <Button variant="outline" onClick={exportExcel} disabled={!plan || exporting || rows.length === 0}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export Excel
          </Button>
        </div>
      </div>

      {loading && !plan && (
        <div className="flex items-center justify-center h-64 text-[#6B7280]">
          <Loader2 className="h-6 w-6 animate-spin text-[#6B5C32]" />
          <span className="ml-3">Calculating MRP…</span>
        </div>
      )}

      {recalcError && (
        <div className="rounded-lg border border-[#EBC6BF] bg-[#FDF1EF] p-3 text-sm text-[#9A3A2D]">
          Recalculate failed: {recalcError}
        </div>
      )}

      {failed && (
        <div className="rounded-lg border border-[#EBC6BF] bg-[#FDF1EF] p-4 text-sm text-[#9A3A2D]">
          {resp?.error || error || "The MRP could not be calculated."} Press Recalculate to try again.
        </div>
      )}

      {plan && (
        <div className="rounded-xl border border-[#E2DDD8] bg-white">
          <div className="flex flex-wrap items-center gap-3 border-b border-[#EFEBE3] px-3.5 py-2.5">
            <div className="flex items-center gap-1 rounded-lg bg-[#F0ECE9] p-0.5" role="group" aria-label="Need-by window">
              {WINDOWS.map((w) => (
                <button
                  key={w.key}
                  type="button"
                  onClick={() => setWin(w.key)}
                  aria-pressed={win === w.key}
                  className={`h-7 rounded-md px-2.5 text-xs font-semibold cursor-pointer ${
                    win === w.key ? "bg-white text-[#1F1D1B] shadow-sm" : "text-[#6B7280] hover:text-[#1F1D1B]"
                  }`}
                >
                  {w.label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1.5 text-xs text-[#374151] cursor-pointer">
              <input type="checkbox" checked={onlyShort} onChange={(e) => setOnlyShort(e.target.checked)} />
              Only shortages
            </label>
            <label className="ml-auto flex items-center gap-1.5 text-xs text-[#6B7280]">
              Search
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Code or description"
                className="h-8 w-48 rounded-lg border border-[#D8D1C3] px-2.5 text-[13px] text-[#1F1D1B]"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 border-b border-[#EFEBE3] px-3.5 py-2.5">
            <span className="mr-1 text-xs text-[#6B7280]">Material</span>
            {tabs.map((t) => {
              const on = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  aria-pressed={on}
                  className={`h-[30px] whitespace-nowrap rounded-full border px-2.5 text-xs cursor-pointer ${
                    on
                      ? "border-[#6B5C32] bg-[#6B5C32] font-bold text-white"
                      : t.count
                        ? "border-[#E2DDD8] bg-white font-semibold text-[#374151]"
                        : "border-[#E2DDD8] bg-[#F7F5F1] font-semibold text-[#9CA3AF]"
                  }`}
                >
                  {t.label} <span className="ml-0.5 text-[11px] opacity-75">{t.count}</span>
                  {t.short > 0 && (
                    <span className="ml-1 rounded-full bg-[#B42318] px-1.5 py-px text-[11px] font-bold text-white">{t.short}</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Header row and the material column stay put while scrolling. */}
          <div className="max-h-[70vh] overflow-auto" data-testid="mrp-requirements-scroll">
            <table className="w-full min-w-[1080px] border-collapse text-[13px]">
              <thead className="sticky top-0 z-20">
                <tr className="bg-[#FAF8F4] text-left text-[11px] uppercase tracking-wide text-[#6B7280]">
                  <th className="sticky left-0 z-10 bg-[#FAF8F4] px-2.5 py-2">Raw material</th>
                  <th className="px-1.5 py-2">Material</th>
                  <th className="px-1.5 py-2">UOM</th>
                  <th className="px-1.5 py-2 text-right">Needed</th>
                  <th className="px-1.5 py-2 text-right">Stock</th>
                  <th className="px-1.5 py-2 text-right">PO outstanding</th>
                  <th className="px-1.5 py-2 text-right">Short</th>
                  <th className="px-1.5 py-2">First need-by</th>
                  <th className="px-1.5 py-2">Main supplier</th>
                  <th className="px-2.5 py-2 text-right">Orders</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-4 py-10 text-center text-sm text-[#6B7280]">
                      {plan.materials.length === 0
                        ? "No raw materials are needed by open production orders."
                        : "Nothing matches these filters."}
                    </td>
                  </tr>
                )}
                {rows.map((m) => {
                  const isOpen = open.has(m.rmId);
                  const isShort = m.short > 1e-9;
                  return (
                    <Fragment key={m.rmId}>
                      <tr className={`border-t border-[#EFEBE3] ${isShort ? "bg-[#FFFBFA]" : "bg-white"}`}>
                        <td className={`sticky left-0 z-[5] px-2.5 py-2 ${isShort ? "bg-[#FFFBFA]" : "bg-white"}`}>
                          <button
                            type="button"
                            onClick={() => toggle(m.rmId)}
                            aria-expanded={isOpen}
                            aria-label={`${isOpen ? "Hide" : "Show"} orders for ${m.code}`}
                            className="flex items-start gap-1.5 text-left cursor-pointer"
                          >
                            {isOpen ? (
                              <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-[#6B7280]" />
                            ) : (
                              <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-[#6B7280]" />
                            )}
                            <span>
                              <b>{m.code}</b> <span className="text-[#6B7280]">{m.description}</span>
                            </span>
                          </button>
                        </td>
                        <td className="px-1.5 py-2 whitespace-nowrap">
                          <span className="rounded bg-[#F3EFE6] px-1.5 py-0.5 text-[11px] text-[#5B4D27]">{m.group}</span>{" "}
                          <span className="text-[10px] text-[#9CA3AF]">{m.itemGroup}</span>
                        </td>
                        <td className="px-1.5 py-2 text-[#6B7280]">{m.uom}</td>
                        <td className="px-1.5 py-2 text-right font-semibold tabular-nums">{fmtQty(m.needed)}</td>
                        <td className="px-1.5 py-2 text-right tabular-nums">{fmtQty(m.stock)}</td>
                        <td className="px-1.5 py-2 text-right tabular-nums">
                          {fmtQty(m.poOutstanding)}
                          {m.poOtherUnit.length > 0 && (
                            <div className="text-[11px] font-semibold text-[#8A6A12]" title="Ordered in another unit — not counted (no unit conversion)">
                              {m.poOtherUnit.map((p) => `+${fmtQty(p.qty)} ${p.unit}`).join(", ")}
                            </div>
                          )}
                        </td>
                        <td className={`px-1.5 py-2 text-right font-bold tabular-nums ${isShort ? "text-[#B42318]" : "text-[#9CA3AF]"}`}>
                          {isShort ? fmtQty(m.short) : "—"}
                        </td>
                        <td className="px-1.5 py-2 tabular-nums">{fmtDate(m.firstNeedBy)}</td>
                        <td className={`px-1.5 py-2 ${m.mainSupplier ? "text-[#374151]" : "text-[#8A6A12]"}`}>{m.mainSupplier ?? "Not set"}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{m.orders.length}</td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-[#FCFBF8]">
                          <td colSpan={10} className="px-8 pb-3 pt-1">
                            <table className="w-full border-collapse rounded-lg border border-[#EFEBE3] bg-white text-xs">
                              <thead>
                                <tr className="text-left text-[11px] text-[#6B7280]">
                                  <th className="px-2.5 py-1.5">Production order</th>
                                  <th className="px-1.5 py-1.5">Product</th>
                                  <th className="px-1.5 py-1.5 text-right">Qty</th>
                                  <th className="px-1.5 py-1.5">Used at</th>
                                  <th className="px-1.5 py-1.5 text-right">Needs</th>
                                  <th className="px-1.5 py-1.5">Need-by</th>
                                  <th className="px-2.5 py-1.5">Covered by</th>
                                </tr>
                              </thead>
                              <tbody>
                                {m.orders.map((o, i) => (
                                  <tr key={`${o.productionOrderId}-${o.wipKey}-${o.dept}-${i}`} className="border-t border-[#F3F0EA]">
                                    <td className="px-2.5 py-1.5 font-semibold text-[#6B5A2E]">{o.poNo}</td>
                                    <td className="px-1.5 py-1.5">{o.productCode}</td>
                                    <td className="px-1.5 py-1.5 text-right">{o.quantity}</td>
                                    <td className="px-1.5 py-1.5 text-[#6B7280]">{DEPT_LABEL[o.dept] ?? o.dept}</td>
                                    <td className="px-1.5 py-1.5 text-right tabular-nums">
                                      {fmtQty(o.required)} {m.uom}
                                    </td>
                                    <td className="px-1.5 py-1.5 tabular-nums">{fmtDate(o.needBy)}</td>
                                    <td className="px-2.5 py-1.5">
                                      <span className="flex flex-wrap gap-1">
                                        {o.covers.map((c, j) => (
                                          <span
                                            key={j}
                                            className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                                              c.source === "STOCK" ? "bg-[#E7F3EC] text-[#1E6B3F]" : "bg-[#E8F0F8] text-[#1F4E6B]"
                                            }`}
                                          >
                                            {coverLabel(c, m.uom)}
                                          </span>
                                        ))}
                                        {o.shortQty > 1e-9 && (
                                          <span className="rounded bg-[#FDECEA] px-1.5 py-0.5 text-[11px] font-semibold text-[#B42318]">
                                            Short {fmtQty(o.shortQty)} {m.uom}
                                          </span>
                                        )}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {m.poOtherUnit.length > 0 && (
                              <div className="mt-1.5 text-[11px] font-semibold text-[#8A6A12]">
                                Also on order in another unit — not counted, check before ordering more:{" "}
                                {m.poOtherUnit
                                  .map((p) => `${p.ref} · ${fmtQty(p.qty)} ${p.unit}${p.eta ? ` · ETA ${fmtDate(p.eta)}` : ""}`)
                                  .join("; ")}
                              </div>
                            )}
                            <div className="mt-1.5 text-[11px] text-[#6B7280]">
                              Earliest need-by takes stock first, then the earliest PO; what is left is short.
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="space-y-1 border-t border-[#EFEBE3] px-3.5 py-2.5 text-xs text-[#6B7280]">
            <div>
              {rows.length} raw materials shown · {plan.productionOrders.counted} of {plan.productionOrders.open} open production
              orders still need materials ({plan.productionOrders.alreadyDeducted} already deducted,{" "}
              {plan.productionOrders.noBom} with no BOM materials) · stock = RM balance now · PO outstanding = ordered, not yet
              received · a WIP stops counting once its job card is completed (its materials have left stock) · need-by = that
              department&apos;s due date, else the order&apos;s date.
            </div>
            {plan.materials.some((m) => m.poOtherUnit.length > 0) && (
              <div className="font-semibold text-[#8A6A12]">
                Some open POs are in another unit than the stock (e.g. fabric ordered in ROLL, stocked in MTR). There is no
                conversion, so they are shown in amber under PO outstanding but not counted.
              </div>
            )}
            {plan.openPoLinesUnresolved > 0 && (
              <div className="font-semibold text-[#8A6A12]">
                PO outstanding is a floor: {plan.openPoLinesUnresolved} open PO lines name no known raw material, so they are
                not counted as coming in.
              </div>
            )}
            {plan.unresolved.length > 0 && (
              <div>
                <button type="button" onClick={() => setShowGaps((v) => !v)} className="font-semibold text-[#8A6A12] underline cursor-pointer">
                  {plan.unresolved.length} BOM lines name a material that is not in Raw Materials — not planned
                </button>
                {showGaps && (
                  <ul className="mt-1 max-h-48 list-disc overflow-y-auto pl-5">
                    {plan.unresolved.map((u, i) => (
                      <li key={i}>
                        {u.poNo} · {u.productCode} · {u.material} ({fmtQty(u.required)})
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
