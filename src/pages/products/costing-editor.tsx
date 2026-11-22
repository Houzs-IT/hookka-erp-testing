// ---------------------------------------------------------------------------
// Costing editor (owner 2026-11-22, plan D6 / D7 / D8): edit a product's WIP
// processes, minutes and raw materials on the costing page, with the cost
// updating as you type, and copy any of the three parts from another model.
//
// ONE data path: this edits the product's BOM template row and saves it with
// PUT /api/bom/templates/:id — the exact call the BOM Builder makes — so a
// change here is a change in the BOM page, and the BOM save's job-card
// minutes preview / sync runs the same way. The material picker and scaling
// editor are the BOM Builder's own (components/bom/material-editor.tsx).
// ---------------------------------------------------------------------------
import { Fragment, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { cachedFetchJson, invalidateCachePrefix } from "@/lib/cached-fetch";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { confirmJobCardImpact, previewBomTemplateSave } from "@/lib/job-card-impact";
import { copyBomParts, type CopyParts } from "@/lib/bom-copy";
import { autoDetectMaterialPatch, type RawMaterialOption, type WIPMaterial } from "@/lib/bom-material";
import { MaterialScalingEditor, RawMaterialSelect } from "@/components/bom/material-editor";
import { formatCurrency } from "@/lib/utils";
import type { CostingResult } from "@/lib/product-costing";
import { buildWipTypes } from "@/lib/wip-types";
import { rdFormNo } from "@/lib/rd-form-no";
import { applyRdScan, rdScanChanges, type RdChange, type RdScanReading } from "@/lib/rd-scan";
import { todayYmdMY as todayYmd } from "@/lib/utils";
import { getVariantsConfigSync } from "@/lib/kv-config";
import { canMoveWipNode, moveWipNode } from "@/lib/wip-tree-ops";
import { wipLabel } from "@/lib/wip-label";

type Proc = { dept: string; deptCode: string; category: string; minutes: number };
type Node = {
  id: string;
  wipCode?: string;
  wipType: string;
  quantity: number;
  processes: Proc[];
  materials?: WIPMaterial[];
  children?: Node[];
  [k: string]: unknown;
};
export type EditableTemplate = {
  id: string;
  productCode: string;
  l1Processes?: Proc[];
  l1Materials?: WIPMaterial[];
  wipComponents?: Node[];
};
type Bom = { l1Processes: Proc[]; l1Materials: WIPMaterial[]; wipComponents: Node[] };
type Path = number[]; // [] = product level (L1); [i, j, …] = wipComponents[i].children[j]…

// Same list and labels as the BOM Builder's process <select>.
const DEPTS: [string, string][] = [
  ["FAB_CUT", "Fab Cut"], ["FAB_SEW", "Fab Sew"], ["WOOD_CUT", "Wood Cut"], ["FOAM_CUTTING", "Foam Cutting"],
  ["FOAM", "Foam Bonding"], ["FIBRE", "Fibre"], ["FRAMING", "Framing"], ["WEBBING", "Webbing"],
  ["UPHOLSTERY", "Upholstery"], ["PACKING", "Packing"],
];
const LEVEL_TINT = ["#F3F4F6", "#E3EEF4", "#F1E6F2", "#FBE8D8", "#E9F1E2", "#FDF6D8"];
const rm = (sen: number) => formatCurrency(Math.round(sen));
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const newId = () => `wip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function toBom(t: EditableTemplate): Bom {
  return clone({ l1Processes: t.l1Processes ?? [], l1Materials: t.l1Materials ?? [], wipComponents: t.wipComponents ?? [] });
}

/** Read / replace the processes or materials at a path. */
function getAt(bom: Bom, path: Path): { processes: Proc[]; materials: WIPMaterial[] } {
  if (path.length === 0) return { processes: bom.l1Processes, materials: bom.l1Materials };
  let list = bom.wipComponents;
  let node: Node | undefined;
  for (const i of path) {
    node = list[i];
    list = node?.children ?? [];
  }
  return { processes: node?.processes ?? [], materials: node?.materials ?? [] };
}
function updateNode(bom: Bom, path: Path, fn: (n: Node) => Node): Bom {
  const next = clone(bom);
  const walk = (list: Node[], depth: number): Node[] =>
    list.map((n, i) => (i !== path[depth] ? n : depth === path.length - 1 ? fn(n) : { ...n, children: walk(n.children ?? [], depth + 1) }));
  next.wipComponents = walk(next.wipComponents, 0);
  return next;
}
function setProcs(bom: Bom, path: Path, procs: Proc[]): Bom {
  if (path.length === 0) return { ...clone(bom), l1Processes: procs };
  return updateNode(bom, path, (n) => ({ ...n, processes: procs }));
}
function setMats(bom: Bom, path: Path, mats: WIPMaterial[]): Bom {
  if (path.length === 0) return { ...clone(bom), l1Materials: mats };
  return updateNode(bom, path, (n) => ({ ...n, materials: mats }));
}
function removeNode(bom: Bom, path: Path): Bom {
  const next = clone(bom);
  const parent = path.slice(0, -1);
  const idx = path[path.length - 1];
  if (parent.length === 0) {
    next.wipComponents = next.wipComponents.filter((_, i) => i !== idx);
    return next;
  }
  return updateNode(next, parent, (n) => ({ ...n, children: (n.children ?? []).filter((_, i) => i !== idx) }));
}
function addChild(bom: Bom, path: Path, wipType: string): Bom {
  const child: Node = { id: newId(), wipCode: "", wipType, quantity: 1, processes: [], materials: [], children: [] };
  if (path.length === 0) return { ...clone(bom), wipComponents: [...clone(bom.wipComponents), child] };
  return updateNode(bom, path, (n) => ({ ...n, children: [...(n.children ?? []), child] }));
}

function ProcessRows({ procs, pcs, labour, onChange }: { procs: Proc[]; pcs: number; labour: (i: number) => number | null; onChange: (p: Proc[]) => void }) {
  const set = (i: number, patch: Partial<Proc>) => onChange(procs.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <div>
      <div className="px-3 pt-2 text-[11px] font-bold tracking-wide text-[#6B5A2E]">PROCESSES</div>
      {procs.length > 0 && (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-[#FAF8F4] text-left text-[11px] uppercase text-[#6B7280]">
              <th className="px-3 py-1.5 font-semibold">Department</th>
              <th className="px-3 py-1.5 font-semibold">Category</th>
              <th className="px-3 py-1.5 text-right font-semibold">Min / piece</th>
              <th className="px-3 py-1.5 text-right font-semibold">× {pcs} PCS</th>
              <th className="px-3 py-1.5 text-right font-semibold">Labour</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {procs.map((p, i) => (
              <tr key={i} className="border-t border-[#EFEBE3]">
                <td className="px-3 py-1.5">
                  <select
                    value={p.deptCode}
                    onChange={(e) => set(i, { deptCode: e.target.value, dept: DEPTS.find(([c]) => c === e.target.value)?.[1] ?? e.target.value })}
                    className="h-8 w-44 rounded border border-[#E2DDD8] bg-white px-2"
                    aria-label="Department"
                  >
                    {!DEPTS.some(([c]) => c === p.deptCode) && <option value={p.deptCode}>{p.dept || p.deptCode || "—"}</option>}
                    {DEPTS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
                  </select>
                </td>
                <td className="px-3 py-1.5"><input value={p.category ?? ""} onChange={(e) => set(i, { category: e.target.value })} placeholder="CAT" className="h-8 w-20 rounded border border-[#E2DDD8] px-2" aria-label="Category" /></td>
                <td className="px-3 py-1.5 text-right"><input type="number" min={0} value={p.minutes} onFocus={(e) => e.currentTarget.select()} onChange={(e) => set(i, { minutes: Math.max(0, parseFloat(e.target.value) || 0) })} className="h-8 w-20 rounded border border-[#CFC8BB] px-2 text-right" aria-label="Minutes per piece" /></td>
                <td className="px-3 py-1.5 text-right tabular-nums">{(Number(p.minutes) || 0) * pcs} min</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{labour(i) == null ? "—" : rm(labour(i)!)}</td>
                <td className="px-2 py-1.5 text-center"><button type="button" onClick={() => onChange(procs.filter((_, j) => j !== i))} className="text-base leading-none text-[#9A3A2D]" aria-label="Remove process">×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button type="button" onClick={() => onChange([...procs, { dept: "Fab Cut", deptCode: "FAB_CUT", category: "", minutes: 0 }])} className="px-3 py-2 text-[12px] font-semibold text-[#6B5A2E] hover:underline">
        + Add process
      </button>
    </div>
  );
}

function MaterialRows({ mats, materials, pcs, amount, onChange }: { mats: WIPMaterial[]; materials: RawMaterialOption[]; pcs: number; amount: (i: number) => { sen: number | null; note: string }; onChange: (m: WIPMaterial[]) => void }) {
  const [scaleOpen, setScaleOpen] = useState<number | null>(null);
  const set = (i: number, patch: Partial<WIPMaterial>) => onChange(mats.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const isFiller = (m: WIPMaterial) => !m.autoDetect && /FILLER/i.test(materials.find((o) => o.itemCode === (m.code || m.inventoryCode))?.itemGroup ?? "");
  const scaleText = (m: WIPMaterial) => {
    const r = m.scaling?.[0];
    if (!r) return null;
    const dim = String(r.dimension ?? "").toLowerCase().replace(/_/g, " ");
    return `${dim || "scaling"} ${r.perUnit >= 0 ? "+" : ""}${r.perUnit}${(m.scaling?.length ?? 0) > 1 ? ` · +${(m.scaling?.length ?? 1) - 1}` : ""}`;
  };
  return (
    <div className="border-t border-[#EFEBE3]">
      <div className="px-3 pt-2 text-[11px] font-bold tracking-wide text-[#6B5A2E]">RAW MATERIALS</div>
      {mats.length > 0 && (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-[#FAF8F4] text-left text-[11px] uppercase text-[#6B7280]">
              <th className="px-3 py-1.5 font-semibold">Material</th>
              <th className="px-3 py-1.5 text-right font-semibold">Qty / piece</th>
              <th className="px-3 py-1.5 font-semibold">UOM</th>
              <th className="px-3 py-1.5 text-right font-semibold">Waste %</th>
              <th className="px-3 py-1.5 text-right font-semibold">Per product</th>
              <th className="px-3 py-1.5 font-semibold">Scaling</th>
              <th className="px-3 py-1.5 text-right font-semibold">Amount</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {mats.map((m, i) => {
              const amt = amount(i);
              const st = scaleText(m);
              return (
                <Fragment key={i}>
                  <tr className="border-t border-[#EFEBE3] align-middle">
                    <td className="px-3 py-1.5">
                      {m.autoDetect ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-[#9CC3D6] bg-[#E3EEF4] px-2 py-0.5 text-[12px] font-semibold text-[#1F4E6B]">
                          From order: {m.autoDetect === "FABRIC" ? "fabric" : "leg"}
                          <button type="button" onClick={() => set(i, { autoDetect: undefined, name: "", code: "" })} className="ml-1 text-[#6B7280]" aria-label="Clear from order">×</button>
                        </span>
                      ) : (
                        <div className="min-w-[220px]">
                          <RawMaterialSelect
                            value={m.code ?? ""}
                            materials={materials}
                            onSelect={(o) => set(i, { code: o.itemCode, name: o.description, unit: o.baseUOM, inventoryCode: o.itemCode, autoDetect: undefined })}
                            onSelectAutoDetect={(kind) => set(i, autoDetectMaterialPatch(kind))}
                          />
                        </div>
                      )}
                      {isFiller(m) && (
                        <div className="mt-1 flex items-center gap-1 text-[12px] text-[#B8601A]">
                          cut
                          <input type="number" placeholder="L" value={m.cutLengthIn ?? ""} onChange={(e) => set(i, { cutLengthIn: parseFloat(e.target.value) || 0 })} className="h-7 w-14 rounded border border-[#E8B786] px-1" aria-label="Cut length (in)" />
                          ×
                          <input type="number" placeholder="W" value={m.cutWidthIn ?? ""} onChange={(e) => set(i, { cutWidthIn: parseFloat(e.target.value) || 0 })} className="h-7 w-14 rounded border border-[#E8B786] px-1" aria-label="Cut width (in)" />
                          in
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right"><input type="number" min={0} value={m.qty} onFocus={(e) => e.currentTarget.select()} onChange={(e) => set(i, { qty: Math.max(0, parseFloat(e.target.value) || 0) })} className="h-8 w-20 rounded border border-[#CFC8BB] px-2 text-right" aria-label="Quantity per piece" /></td>
                    <td className="px-3 py-1.5 text-[#374151]">{m.unit || "PCS"}</td>
                    <td className="px-3 py-1.5 text-right"><input type="number" min={0} value={m.wastePct ?? ""} placeholder="0" onChange={(e) => set(i, { wastePct: Math.max(0, parseFloat(e.target.value) || 0) })} className="h-8 w-16 rounded border border-[#E2DDD8] px-2 text-right" aria-label="Wastage %" /></td>
                    <td className="px-3 py-1.5 text-right tabular-nums" title="per piece × pieces × (1 + waste %) — the R&D form prints it without waste">
                      {+((Number(m.qty) || 0) * pcs * (1 + (Number(m.wastePct) || 0) / 100)).toFixed(3)} {m.unit || "PCS"}
                    </td>
                    <td className="px-3 py-1.5">
                      <button
                        type="button"
                        onClick={() => setScaleOpen(scaleOpen === i ? null : i)}
                        className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[12px] ${st ? "border-[#D8D1C3] bg-white text-[#374151]" : "border-dashed border-[#D8D1C3] bg-white text-[#6B7280]"}`}
                      >
                        {st ? `↕ ${st}` : "+ Scaling"}
                      </button>
                    </td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${amt.sen == null ? "font-semibold text-[#B91C1C]" : ""}`}>
                      {amt.sen == null ? amt.note || "No price" : rm(amt.sen)}
                      {amt.sen != null && amt.note && <span className="ml-1 text-[11px] font-normal text-[#6B7280]">{amt.note}</span>}
                    </td>
                    <td className="px-2 py-1.5 text-center"><button type="button" onClick={() => onChange(mats.filter((_, j) => j !== i))} className="text-base leading-none text-[#9A3A2D]" aria-label="Remove material">×</button></td>
                  </tr>
                  {scaleOpen === i && (
                    <tr>
                      <td colSpan={8} className="px-3 pb-2">
                        <div className="rounded-md border border-[#D8CBA8] bg-[#FFFDF7] p-2">
                          <div className="mb-1 flex items-center text-[12px] font-semibold">
                            Scaling for {m.autoDetect ? "From order: fabric" : m.code || "this material"}
                            <button type="button" onClick={() => setScaleOpen(null)} className="ml-auto rounded border border-[#D8D1C3] bg-white px-2 py-0.5 text-[11px]">Done</button>
                          </div>
                          <MaterialScalingEditor scaling={m.scaling} unit={m.unit || "PCS"} isCut={isFiller(m)} onChange={(sc) => set(i, { scaling: sc })} />
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
      <button type="button" onClick={() => onChange([...mats, { code: "", name: "", qty: 1, unit: "PCS" }])} className="px-3 py-2 text-[12px] font-semibold text-[#6B5A2E] hover:underline">
        + Add raw material
      </button>
    </div>
  );
}

type TemplateLite = EditableTemplate & { baseModel?: string; category?: string; versionStatus?: string };

function CopyDialog({
  category,
  selfId,
  onClose,
  onCopy,
}: {
  category: string;
  selfId: string;
  onClose: () => void;
  onCopy: (src: TemplateLite, parts: CopyParts) => void;
}) {
  const [all, setAll] = useState<TemplateLite[] | null>(null);
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<TemplateLite | null>(null);
  const [parts, setParts] = useState<CopyParts>({ processes: true, time: true, materials: true });
  useEffect(() => {
    let live = true;
    cachedFetchJson<{ data?: TemplateLite[] } | TemplateLite[]>("/api/bom/templates")
      .then((r) => {
        if (!live) return;
        const list = Array.isArray(r) ? r : r?.data ?? [];
        setAll(list.filter((t) => t.id !== selfId && t.versionStatus !== "OBSOLETE"));
      })
      .catch(() => live && setAll([]));
    return () => {
      live = false;
    };
  }, [selfId]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (all ?? [])
      .filter((t) => !category || !t.category || t.category === category)
      .filter((t) => !s || t.productCode.toLowerCase().includes(s) || String(t.baseModel ?? "").toLowerCase().includes(s))
      .slice(0, 60);
  }, [all, q, category]);
  const count = (t: TemplateLite) => {
    let wips = 0;
    let mins = 0;
    let mats = (t.l1Materials ?? []).length;
    const walk = (l: Node[] | undefined) =>
      (l ?? []).forEach((n) => {
        wips += 1;
        mins += (n.processes ?? []).reduce((s, p) => s + (Number(p.minutes) || 0), 0) * (Number(n.quantity) || 1);
        mats += (n.materials ?? []).length;
        walk(n.children);
      });
    walk(t.wipComponents);
    mins += (t.l1Processes ?? []).reduce((s, p) => s + (Number(p.minutes) || 0), 0);
    return { wips, mins, mats };
  };
  const picked = pick ? count(pick) : null;
  const what = [parts.processes && "processes", parts.time && "time", parts.materials && "materials"].filter(Boolean).join(" + ");
  const rows: [keyof CopyParts, string, string][] = [
    ["processes", "WIP processes", "the WIP tree and each WIP's departments"],
    ["time", "WIP time", "minutes per process — matched to the same WIP + department here"],
    ["materials", "Raw materials", 'qty, scaling and "from order" settings'],
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-label="Copy from another model">
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
        <div className="border-b border-[#EFEBE3] px-4 py-3 font-semibold">Copy from another model</div>
        <div className="space-y-3 p-4 text-sm">
          <div>
            <div className="mb-1 text-[11px] font-bold text-[#5F5A52]">1. WHAT TO COPY (tick any)</div>
            {rows.map(([k, label, hint]) => (
              <label key={k} className="flex items-start gap-2 py-0.5">
                <input type="checkbox" checked={parts[k]} onChange={(e) => setParts({ ...parts, [k]: e.target.checked })} className="mt-1" />
                <span><b>{label}</b> — {hint}</span>
              </label>
            ))}
          </div>
          <div>
            <div className="mb-1 text-[11px] font-bold text-[#5F5A52]">2. FROM WHICH MODEL ({category ? `${category.toLowerCase()}s only — same category` : "any"})</div>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search model" className="h-9 w-full rounded border border-[#CFC8BB] px-2 text-sm" />
            <div className="mt-1 max-h-56 divide-y divide-[#F3F1EC] overflow-y-auto rounded border border-[#EFEBE3]">
              {all === null && <div className="px-2 py-3 text-sm text-[#6B7280]">Loading…</div>}
              {all !== null && shown.length === 0 && <div className="px-2 py-3 text-sm text-[#6B7280]">No matching model</div>}
              {shown.map((t) => {
                const n = count(t);
                return (
                  <button key={t.id} type="button" onClick={() => setPick(t)} className={`flex w-full items-center justify-between px-2 py-2 text-left text-sm ${pick?.id === t.id ? "bg-[#F6F1E6]" : "hover:bg-[#FAF8F4]"}`}>
                    <span className="font-semibold">{t.productCode}</span>
                    <span className="text-[11px] text-[#6B7280]">{n.wips} WIPs · {n.mins} min · {n.mats} materials</span>
                  </button>
                );
              })}
            </div>
          </div>
          <p className="text-[11px] text-[#6B7280]">Each part replaces only that part here; the rest stays. Nothing is saved until you press Save.</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-[#EFEBE3] px-4 py-3">
          <button type="button" onClick={onClose} className="rounded border border-[#D8D1C3] px-3 py-1.5 text-sm">Cancel</button>
          <button
            type="button"
            disabled={!pick || !what}
            onClick={() => pick && onCopy(pick, parts)}
            className="rounded bg-[#6B5A2E] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pick && what ? `Copy ${what} from ${pick.productCode}${picked ? ` (${picked.wips} WIPs)` : ""}` : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ScanReview({ changes, reading, onApply, onClose }: { changes: RdChange[]; reading: RdScanReading; onApply: (picked: RdChange[]) => void; onClose: () => void }) {
  const [on, setOn] = useState<boolean[]>(() => changes.map((c) => c.kind !== "unmatched"));
  const text = (c: RdChange) =>
    c.kind === "minutes"
      ? `#${c.wipNo} ${c.dept}: ${c.from} → ${c.to} min / pc`
      : c.kind === "qty"
        ? `#${c.wipNo} ${c.code}: ${+c.fromPerProduct.toFixed(4)} → ${c.toPerProduct} per product`
        : c.kind === "add"
          ? `#${c.wipNo} add ${c.code} ${c.perProduct} ${c.unit} per product`
          : `#${c.wipNo} could not place "${c.what}" — key it in by hand`;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-label="Review the scanned R&D form">
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
        <div className="border-b border-[#EFEBE3] px-4 py-3">
          <div className="font-semibold">Read from the form{reading.formNo ? ` ${reading.formNo}` : ""}</div>
          <div className="text-[12px] text-[#6B7280]">
            {reading.filledBy ? `Filled by ${reading.filledBy}` : "Filled by: not read"}
            {reading.filledOn ? ` on ${reading.filledOn}` : ""}. Check each line against the paper — untick anything read wrong.
          </div>
        </div>
        <div className="max-h-80 overflow-y-auto p-4 space-y-1 text-sm">
          {changes.length === 0 && <div className="text-[#6B7280]">Nothing new was written on the form (or nothing could be read).</div>}
          {changes.map((c, i) => (
            <label key={i} className={`flex items-start gap-2 ${c.kind === "unmatched" ? "text-[#B45309]" : ""}`}>
              <input type="checkbox" disabled={c.kind === "unmatched"} checked={on[i]} onChange={(e) => setOn(on.map((v, j) => (j === i ? e.target.checked : v)))} className="mt-1" />
              <span>{text(c)}</span>
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2 border-t border-[#EFEBE3] px-4 py-3">
          <button type="button" onClick={onClose} className="rounded border border-[#D8D1C3] px-3 py-1.5 text-sm">Cancel</button>
          <button type="button" onClick={() => onApply(changes.filter((_, i) => on[i]))} className="rounded bg-[#6B5A2E] px-3 py-1.5 text-sm font-semibold text-white">
            Put ticked lines into the editor
          </button>
        </div>
      </div>
    </div>
  );
}

export function CostingEditor({
  template,
  productId,
  category,
  tier,
  labelProduct,
  onDone,
}: {
  template: EditableTemplate;
  productId: string;
  category: string;
  tier: string | null;
  /** Fills {TOKENS} in WIP names for display (size, default variants). */
  labelProduct?: Parameters<typeof wipLabel>[1];
  onDone: (saved: boolean) => void;
}) {
  const { confirm } = useConfirm();
  const { toast } = useToast();
  const original = useMemo(() => JSON.stringify(toBom(template)), [template]);
  const [bom, setBom] = useState<Bom>(() => toBom(template));
  const [materials, setMaterials] = useState<RawMaterialOption[]>([]);
  const [live, setLive] = useState<CostingResult | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // Plan D11: "these changes come from a filled R&D Spec Form" - recorded with
  // the form no., who filled it and its date; the server adds who keyed it in.
  const [fromRd, setFromRd] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState<{ reading: RdScanReading; changes: RdChange[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [rd, setRd] = useState({ formNo: rdFormNo(template.productCode, todayYmd()), filledBy: "", filledOn: todayYmd() });
  const dirty = JSON.stringify(bom) !== original;
  // Same WIP type list as the BOM Builder (built-ins + Maintenance extras).
  const wipTypes = useMemo(() => buildWipTypes(getVariantsConfigSync()?.wipTypes), []);
  const [newType, setNewType] = useState(category === "SOFA" ? "SOFA_BASE" : "DIVAN");
  const [moreOpen, setMoreOpen] = useState(false);
  const [showL1, setShowL1] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const reqSeq = useRef(0);

  useEffect(() => {
    cachedFetchJson<{ data?: { rawMaterials?: (RawMaterialOption & Record<string, unknown>)[] } }>("/api/inventory?buckets=rawMaterials")
      .then((r) =>
        setMaterials(
          (r?.data?.rawMaterials ?? []).map((o) => ({ id: o.id, itemCode: o.itemCode, description: o.description, baseUOM: o.baseUOM, itemGroup: o.itemGroup })),
        ),
      )
      .catch(() => setMaterials([]));
  }, []);

  // Live cost while editing (server engine, nothing saved).
  useEffect(() => {
    const seq = ++reqSeq.current;
    // eslint-disable-next-line no-restricted-syntax -- debounce keyed on the edited BOM; cleared on every change
    const t = setTimeout(() => {
      fetch("/api/product-costing/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bom, tier }),
      })
        .then((r) => r.json() as Promise<{ data?: CostingResult }>)
        .then((j) => {
          if (seq === reqSeq.current && j?.data) setLive(j.data);
        })
        .catch(() => undefined);
    }, 350);
    return () => clearTimeout(t);
  }, [bom, tier]);

  const doCopy = (src: TemplateLite, parts: CopyParts) => {
    const r = copyBomParts(bom, toBom(src), parts);
    setBom(r.bom as Bom);
    setCopyOpen(false);
    const what = [parts.processes && "WIP processes", parts.time && "WIP time", parts.materials && "raw materials"].filter(Boolean).join(", ");
    toast.success(`Copied ${what} from ${src.productCode}${r.unmatchedNodes ? ` · ${r.unmatchedNodes} WIP${r.unmatchedNodes === 1 ? "" : "s"} had no match` : ""}. Not saved yet.`);
  };

  const save = async () => {
    setSaving(true);
    try {
      const body = { l1Processes: bom.l1Processes, l1Materials: bom.l1Materials, wipComponents: bom.wipComponents };
      const impact = await previewBomTemplateSave(template.id, body);
      if (!(await confirmJobCardImpact(confirm, impact))) return;
      const r = await fetch(`/api/bom/templates/${encodeURIComponent(template.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!r.ok || j.success === false) {
        toast.error(j.error || "Could not save the BOM.");
        return;
      }
      if (fromRd) {
        const rr = await fetch(`/api/product-costing/${encodeURIComponent(productId)}/rd-entry`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...rd, bomId: template.id }),
        });
        if (!rr.ok) toast.error("BOM saved, but the R&D form record was not - note the form no. by hand.");
      }
      invalidateCachePrefix("/api/audit-events");
      invalidateCachePrefix("/api/bom");
      invalidateCachePrefix("/api/product-costing");
      invalidateCachePrefix("/api/products");
      toast.success("Saved — the BOM page shows the same change.");
      onDone(true);
    } finally {
      setSaving(false);
    }
  };

  // Phase 7: read a filled R&D form; the reply is only shown for review.
  const scanForm = async (file: File) => {
    setScanning(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/product-costing/${encodeURIComponent(productId)}/rd-scan`, { method: "POST", body: fd });
      const j = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string; data?: RdScanReading };
      if (!r.ok || !j.data) {
        toast.error(j.error || "Could not read the form.");
        return;
      }
      setScan({ reading: j.data, changes: rdScanChanges(bom, j.data) });
    } finally {
      setScanning(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const applyScan = (picked: RdChange[]) => {
    if (!scan) return;
    const lookup = (code: string) => {
      const k = code.trim().toUpperCase();
      const hit = materials.find((o) => o.itemCode.toUpperCase() === k);
      return hit ? { code: hit.itemCode, name: hit.description, unit: hit.baseUOM } : null;
    };
    setBom(applyRdScan(bom, picked, lookup));
    setFromRd(true);
    setRd({
      formNo: scan.reading.formNo || rd.formNo,
      filledBy: scan.reading.filledBy || rd.filledBy,
      filledOn: scan.reading.filledOn || rd.filledOn,
    });
    setScan(null);
    toast.success(`${picked.length} line${picked.length === 1 ? "" : "s"} put into the editor. Check, then Save.`);
  };

  const cancel = async () => {
    if (dirty && !(await confirm({ title: "Discard changes?", message: "Your edits to this costing have not been saved.", danger: true }))) return;
    onDone(false);
  };

  const liveNode = (id: string) => live?.nodes.find((n) => n.id === id);
  const move = (path: Path, dir: -1 | 1) => {
    const r = moveWipNode(bom.wipComponents, path[0], path.slice(1), dir);
    if (r) setBom({ ...clone(bom), wipComponents: r.roots as Node[] });
  };

  const renderLevel = (path: Path, node: Node | null, level: number, no?: number) => {
    const { processes, materials: mats } = getAt(bom, path);
    const pcs = node ? Number(node.quantity) || 1 : 1;
    const ln = liveNode(node ? String(node.id ?? "") : "l1");
    const key = path.join(".") || "l1";
    const pretty = node ? wipLabel(String(node.wipCode ?? ""), labelProduct) : "";
    const canUp = node ? canMoveWipNode(bom.wipComponents, path[0], path.slice(1), -1) : false;
    const canDown = node ? canMoveWipNode(bom.wipComponents, path[0], path.slice(1), 1) : false;
    const arrow = "rounded border border-[#D8D1C3] bg-white px-1.5 text-[12px] leading-6 disabled:opacity-30";
    return (
      <div key={key} style={{ marginLeft: Math.max(0, level - 2) * 24 }} className="relative">
        {level > 2 && <div aria-hidden className="absolute -left-4 top-0 h-6 w-4 rounded-bl border-b border-l border-gray-300" />}
        <div className="overflow-hidden rounded-lg border border-[#E2DDD8] bg-white">
          <div className="flex flex-wrap items-center gap-2 px-3 py-2" style={{ background: LEVEL_TINT[Math.min(level - 1, LEVEL_TINT.length - 1)] }}>
            {no != null && <span className="text-[11px] font-bold text-[#6B5A2E]" title="Same number as on the R&D Spec Form">#{no}</span>}
            <span className="rounded bg-black/10 px-1.5 py-0.5 text-[10px] font-bold">{level === 1 ? "Product" : `L${level}`}</span>
            {node ? (
              <>
                {renaming === key ? (
                  <input
                    autoFocus
                    value={String(node.wipCode ?? "")}
                    onChange={(e) => setBom(updateNode(bom, path, (n) => ({ ...n, wipCode: e.target.value })))}
                    onBlur={() => setRenaming(null)}
                    placeholder="WIP name"
                    className="h-7 min-w-[220px] flex-1 rounded border border-[#CFC8BB] bg-white px-2 text-sm font-semibold"
                    aria-label="WIP name (with {TOKENS})"
                  />
                ) : (
                  <button type="button" onClick={() => setRenaming(key)} className="min-w-0 truncate text-left text-sm font-semibold hover:underline" title={`Stored as ${node.wipCode ?? ""} — click to rename`}>
                    {pretty || "(no name)"}
                  </button>
                )}
                <span className="ml-auto text-xs text-[#6B7280]">{node.wipType} ×</span>
                <input
                  type="number"
                  min={1}
                  value={pcs}
                  onChange={(e) => setBom(updateNode(bom, path, (n) => ({ ...n, quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })))}
                  className="h-7 w-14 rounded border border-[#CFC8BB] bg-white px-1 text-right text-sm"
                  aria-label="Pieces per finished good"
                />
                <span className="text-xs text-[#6B7280]">PCS</span>
                <button type="button" disabled={!canUp} onClick={() => move(path, -1)} className={arrow} title="Move up (same as the BOM page)" aria-label="Move WIP up">↑</button>
                <button type="button" disabled={!canDown} onClick={() => move(path, 1)} className={arrow} title="Move down (same as the BOM page)" aria-label="Move WIP down">↓</button>
                <button type="button" onClick={() => setBom(addChild(bom, path, String(node.wipType)))} className="text-[12px] font-semibold text-[#6B5A2E] hover:underline">+ Sub-WIP</button>
                <button type="button" onClick={() => setBom(removeNode(bom, path))} className="text-[12px] text-[#9A3A2D] hover:underline">Remove</button>
              </>
            ) : (
              <span className="text-sm font-semibold">Product-level processes and materials</span>
            )}
          </div>
          <ProcessRows procs={processes} pcs={pcs} labour={(i) => ln?.processes[i]?.labourSen ?? null} onChange={(pr) => setBom(setProcs(bom, path, pr))} />
          <MaterialRows
            mats={mats}
            materials={materials}
            pcs={pcs}
            amount={(i) => {
              const m = ln?.materials[i];
              if (!m) return { sen: null, note: "—" };
              if (m.status === "fabric-tier") return { sen: m.amountSen, note: live?.tier ?? "" };
              if (m.status === "from-order") return { sen: null, note: "from order" };
              if (m.status === "no-code") return { sen: null, note: "pick a material" };
              return { sen: m.amountSen, note: "" };
            }}
            onChange={(mm) => setBom(setMats(bom, path, mm))}
          />
          <div className="flex justify-end gap-4 border-t border-[#EFEBE3] bg-[#FAF8F4] px-3 py-1.5 text-[12px] text-[#6B7280]">
            <span>Labour <b className="text-[#111827]">{ln ? rm(ln.labourSen) : "—"}</b></span>
            <span>Materials <b className="text-[#111827]">{ln ? rm(ln.materialSen) : "—"}</b></span>
            <span>WIP cost <b className="text-[#111827]">{ln ? rm(ln.labourSen + ln.materialSen) : "—"}</b></span>
          </div>
        </div>
      </div>
    );
  };

  const hasL1 = bom.l1Processes.length > 0 || bom.l1Materials.length > 0 || showL1;
  const rows: ReactElement[] = hasL1 ? [renderLevel([], null, 1)] : [];
  let wipNo = 0;
  const walk = (list: Node[], path: Path, level: number) =>
    list.forEach((n, i) => {
      const p = [...path, i];
      rows.push(renderLevel(p, n, level, ++wipNo));
      walk(n.children ?? [], p, level + 1);
    });
  walk(bom.wipComponents, [], 2);

  return (
    <div className="space-y-3">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-[#D8CBA8] bg-[#FFFDF7] px-4 py-2 shadow-sm">
        <span className="text-sm font-semibold text-[#6B5A2E]">Editing BOM {dirty ? "· unsaved changes" : ""}</span>
        {live && (
          <span className="text-[13px] text-[#374151]">
            Labour <b className="tabular-nums">{rm(live.labourSen)}</b> · Materials <b className="tabular-nums">{rm(live.materialSen)}</b> · Total <b className="tabular-nums">{rm(live.totalSen)}</b>
            {live.missingLines > 0 && <span className="ml-1 font-semibold text-[#B91C1C]">· {live.missingLines} without a price</span>}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setCopyOpen(true)} className="rounded border border-[#6B5A2E] bg-white px-3 py-1.5 text-sm font-semibold text-[#6B5A2E]">Copy from another model…</button>
          <div className="relative">
            <button type="button" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)} className="rounded border border-[#D8D1C3] bg-white px-3 py-1.5 text-sm font-semibold">
              {scanning ? "Reading form…" : "More ▾"}
            </button>
            {moreOpen && (
              <div className="absolute right-0 z-30 mt-1 w-80 rounded-md border border-[#E2DDD8] bg-white p-1 text-left shadow-lg">
                <button type="button" disabled={scanning} onClick={() => { setMoreOpen(false); fileRef.current?.click(); }} className="block w-full rounded px-3 py-2 text-left hover:bg-[#FAF8F4]">
                  <div className="text-sm font-semibold">Scan filled R&amp;D form…</div>
                  <div className="text-[11px] text-[#6B7280]">read a filled form, tick what to put in</div>
                </button>
                <button type="button" onClick={() => { setMoreOpen(false); setFromRd((v) => !v); }} className="block w-full rounded px-3 py-2 text-left hover:bg-[#FAF8F4]">
                  <div className="text-sm font-semibold">{fromRd ? "☑" : "☐"} This came from an R&amp;D Spec Form</div>
                  <div className="text-[11px] text-[#6B7280]">records form no. / filled by / date with the save</div>
                </button>
                {!hasL1 && (
                  <button type="button" onClick={() => { setMoreOpen(false); setShowL1(true); }} className="block w-full rounded border-t border-[#EFEBE3] px-3 py-2 text-left hover:bg-[#FAF8F4]">
                    <div className="text-sm font-semibold">+ Product-level process / material</div>
                    <div className="text-[11px] text-[#6B7280]">for work done on the finished product, not a WIP</div>
                  </button>
                )}
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && void scanForm(e.target.files[0])} />
          <button type="button" onClick={cancel} className="rounded border border-[#D8D1C3] bg-white px-3 py-1.5 text-sm">Cancel</button>
          <button type="button" disabled={!dirty || saving} onClick={save} className="rounded bg-[#6B5A2E] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
      {fromRd && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#E2DDD8] bg-white px-4 py-2 text-[13px]">
          <b>From an R&amp;D Spec Form:</b>
          <input value={rd.formNo} onChange={(e) => setRd({ ...rd, formNo: e.target.value })} placeholder="Form no." className="h-8 w-44 rounded border border-[#CFC8BB] px-2" aria-label="Form no." />
          <input value={rd.filledBy} onChange={(e) => setRd({ ...rd, filledBy: e.target.value })} placeholder="Filled by (R&D)" className="h-8 w-44 rounded border border-[#CFC8BB] px-2" aria-label="Filled by" />
          <input type="date" value={rd.filledOn} onChange={(e) => setRd({ ...rd, filledOn: e.target.value })} className="h-8 rounded border border-[#CFC8BB] px-2" aria-label="Date on the form" />
          <button type="button" onClick={() => setFromRd(false)} className="text-[12px] text-[#9A3A2D]">Not from a form</button>
          <span className="w-full text-[11px] text-[#6B7280]">WIP numbers (#1, #2…) match the form. Saved with your name as the person who keyed it in.</span>
        </div>
      )}
      {bom.wipComponents.length === 0 && (
        <div className="rounded-lg border border-dashed border-[#D8CBA8] bg-white p-4 text-sm text-[#6B7280]">
          No WIPs yet. Use <b>Copy from another model…</b> above, or add a WIP below, then set each process's minutes and raw material usage.
        </div>
      )}
      <div className="space-y-2">{rows}</div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={newType} onChange={(e) => setNewType(e.target.value)} className="h-9 rounded border border-[#E2DDD8] bg-white px-2 text-sm" aria-label="New WIP type">
          {Object.entries(wipTypes).map(([code, st]) => <option key={code} value={code}>{st.label}</option>)}
        </select>
        <button type="button" onClick={() => setBom(addChild(bom, [], newType))} className="rounded border border-dashed border-[#D8CBA8] bg-white px-3 py-1.5 text-sm text-[#6B5A2E]">
          + Add WIP
        </button>
      </div>
      {scan && <ScanReview changes={scan.changes} reading={scan.reading} onApply={applyScan} onClose={() => setScan(null)} />}
      {copyOpen && <CopyDialog category={category} selfId={template.id} onClose={() => setCopyOpen(false)} onCopy={doCopy} />}
    </div>
  );
}
