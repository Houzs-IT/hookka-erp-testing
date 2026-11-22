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
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
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
import { getVariantsConfigSync } from "@/lib/kv-config";

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

function ProcessRows({ procs, pcs, onChange }: { procs: Proc[]; pcs: number; onChange: (p: Proc[]) => void }) {
  const set = (i: number, patch: Partial<Proc>) => onChange(procs.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <div className="space-y-1">
      {procs.map((p, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 text-[13px]">
          <select
            value={p.deptCode}
            onChange={(e) => set(i, { deptCode: e.target.value, dept: DEPTS.find(([c]) => c === e.target.value)?.[1] ?? e.target.value })}
            className="h-8 rounded border border-[#E2DDD8] bg-white px-2"
            aria-label="Department"
          >
            {!DEPTS.some(([c]) => c === p.deptCode) && <option value={p.deptCode}>{p.dept || p.deptCode || "—"}</option>}
            {DEPTS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
          </select>
          <input value={p.category ?? ""} onChange={(e) => set(i, { category: e.target.value })} placeholder="CAT" className="h-8 w-20 rounded border border-[#E2DDD8] px-2" aria-label="Category" />
          <input type="number" min={0} value={p.minutes} onFocus={(e) => e.currentTarget.select()} onChange={(e) => set(i, { minutes: Math.max(0, parseFloat(e.target.value) || 0) })} className="h-8 w-20 rounded border border-[#CFC8BB] px-2 text-right" aria-label="Minutes per piece" />
          <span className="text-[11px] text-[#6B7280]">min / pc × {pcs} = {(Number(p.minutes) || 0) * pcs} min</span>
          <button type="button" onClick={() => onChange(procs.filter((_, j) => j !== i))} className="ml-auto text-[12px] text-[#9A3A2D] hover:underline">Remove</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...procs, { dept: "Fab Cut", deptCode: "FAB_CUT", category: "", minutes: 0 }])} className="text-[12px] font-medium text-[#6B5A2E] hover:underline">
        + Add process
      </button>
    </div>
  );
}

function MaterialRows({ mats, materials, onChange }: { mats: WIPMaterial[]; materials: RawMaterialOption[]; onChange: (m: WIPMaterial[]) => void }) {
  const set = (i: number, patch: Partial<WIPMaterial>) => onChange(mats.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const isFiller = (m: WIPMaterial) => !m.autoDetect && /FILLER/i.test(materials.find((o) => o.itemCode === (m.code || m.inventoryCode))?.itemGroup ?? "");
  return (
    <div className="space-y-2">
      {mats.map((m, i) => (
        <div key={i} className="rounded border border-[#EFEBE3] bg-[#FCFBF8] p-2 space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            {m.autoDetect ? (
              <span className="inline-flex items-center gap-1 rounded bg-[#E3EEF4] px-2 py-1 text-[12px] font-semibold text-[#1F4E6B]">
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
            <input type="number" min={0} value={m.qty} onFocus={(e) => e.currentTarget.select()} onChange={(e) => set(i, { qty: Math.max(0, parseFloat(e.target.value) || 0) })} className="h-8 w-20 rounded border border-[#CFC8BB] px-2 text-right" aria-label="Quantity per piece" />
            <span className="text-[12px] text-[#6B7280]">{m.unit || "PCS"} / pc</span>
            <input type="number" min={0} value={m.wastePct ?? ""} placeholder="0" onChange={(e) => set(i, { wastePct: Math.max(0, parseFloat(e.target.value) || 0) })} className="h-8 w-16 rounded border border-[#E2DDD8] px-2 text-right" aria-label="Wastage %" />
            <span className="text-[12px] text-[#6B7280]">% waste</span>
            {isFiller(m) && (
              <span className="flex items-center gap-1 text-[12px] text-[#B8601A]">
                cut
                <input type="number" placeholder="L" value={m.cutLengthIn ?? ""} onChange={(e) => set(i, { cutLengthIn: parseFloat(e.target.value) || 0 })} className="h-7 w-14 rounded border border-[#E8B786] px-1" aria-label="Cut length (in)" />
                ×
                <input type="number" placeholder="W" value={m.cutWidthIn ?? ""} onChange={(e) => set(i, { cutWidthIn: parseFloat(e.target.value) || 0 })} className="h-7 w-14 rounded border border-[#E8B786] px-1" aria-label="Cut width (in)" />
                in
              </span>
            )}
            <button type="button" onClick={() => onChange(mats.filter((_, j) => j !== i))} className="ml-auto text-[12px] text-[#9A3A2D] hover:underline">Remove</button>
          </div>
          <MaterialScalingEditor scaling={m.scaling} unit={m.unit || "PCS"} isCut={isFiller(m)} onChange={(s) => set(i, { scaling: s })} />
        </div>
      ))}
      <button type="button" onClick={() => onChange([...mats, { code: "", name: "", qty: 1, unit: "PCS" }])} className="text-[12px] font-medium text-[#6B5A2E] hover:underline">
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
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-label="Copy from another model">
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
        <div className="border-b border-[#EFEBE3] px-4 py-3 font-semibold">{pick ? `Copy from ${pick.productCode}` : "Copy from another model"}</div>
        {!pick ? (
          <div className="p-4 space-y-2">
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search model" className="h-9 w-full rounded border border-[#CFC8BB] px-2 text-sm" />
            <div className="max-h-72 overflow-y-auto divide-y divide-[#F3F1EC]">
              {all === null && <div className="py-3 text-sm text-[#6B7280]">Loading…</div>}
              {all !== null && shown.length === 0 && <div className="py-3 text-sm text-[#6B7280]">No matching model</div>}
              {shown.map((t) => {
                const n = count(t);
                return (
                  <button key={t.id} type="button" onClick={() => setPick(t)} className="flex w-full items-center justify-between px-2 py-2 text-left text-sm hover:bg-[#FAF8F4]">
                    <span className="font-semibold">{t.productCode}</span>
                    <span className="text-[11px] text-[#6B7280]">{n.wips} WIPs · {n.mins} min · {n.mats} materials</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="p-4 space-y-3 text-sm">
            <p className="text-[#6B7280]">Pick what to copy. Each part replaces only that part on this page; the rest stays. You can copy again from another model at any time.</p>
            {(() => {
              const n = count(pick);
              const rows: [keyof CopyParts, string, string][] = [
                ["processes", "WIP processes", `the WIP tree (${n.wips} WIPs) and each WIP's departments`],
                ["time", "WIP time", `minutes per process (${n.mins} min); matched to the same WIP + department here`],
                ["materials", "Raw materials", `${n.mats} materials with qty, scaling and "from order" settings`],
              ];
              return rows.map(([k, label, hint]) => (
                <label key={k} className="flex items-start gap-2">
                  <input type="checkbox" checked={parts[k]} onChange={(e) => setParts({ ...parts, [k]: e.target.checked })} className="mt-1" />
                  <span><b>{label}</b> — {hint}</span>
                </label>
              ));
            })()}
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-[#EFEBE3] px-4 py-3">
          <button type="button" onClick={pick ? () => setPick(null) : onClose} className="rounded border border-[#D8D1C3] px-3 py-1.5 text-sm">{pick ? "Back" : "Cancel"}</button>
          {pick && (
            <button
              type="button"
              disabled={!parts.processes && !parts.time && !parts.materials}
              onClick={() => onCopy(pick, parts)}
              className="rounded bg-[#6B5A2E] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              Copy
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function CostingEditor({
  template,
  category,
  tier,
  onDone,
}: {
  template: EditableTemplate;
  category: string;
  tier: string | null;
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
  const dirty = JSON.stringify(bom) !== original;
  // Same WIP type list as the BOM Builder (built-ins + Maintenance extras).
  const wipTypes = useMemo(() => buildWipTypes(getVariantsConfigSync()?.wipTypes), []);
  const [newType, setNewType] = useState(category === "SOFA" ? "SOFA_BASE" : "DIVAN");
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
      invalidateCachePrefix("/api/bom");
      invalidateCachePrefix("/api/product-costing");
      invalidateCachePrefix("/api/products");
      toast.success("Saved — the BOM page shows the same change.");
      onDone(true);
    } finally {
      setSaving(false);
    }
  };

  const cancel = async () => {
    if (dirty && !(await confirm({ title: "Discard changes?", message: "Your edits to this costing have not been saved.", danger: true }))) return;
    onDone(false);
  };

  const renderLevel = (path: Path, label: string, wipType: string, pcs: number, level: number) => {
    const { processes, materials: mats } = getAt(bom, path);
    return (
      <div key={path.join(".") || "l1"} style={{ marginLeft: Math.max(0, level - 2) * 24 }} className="relative">
        {level > 2 && <div aria-hidden className="absolute -left-4 top-0 h-6 w-4 border-l border-b border-gray-300 rounded-bl" />}
        <div className="rounded-lg border border-[#E2DDD8] bg-white overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 px-3 py-2" style={{ background: LEVEL_TINT[Math.min(level - 1, LEVEL_TINT.length - 1)] }}>
            <span className="text-[10px] font-bold rounded px-1.5 py-0.5 bg-black/10">{level === 1 ? "Product" : `L${level}`}</span>
            {path.length > 0 ? (
              <>
                <input
                  value={label}
                  onChange={(e) => setBom(updateNode(bom, path, (n) => ({ ...n, wipCode: e.target.value })))}
                  placeholder="WIP name"
                  className="h-7 min-w-[200px] flex-1 rounded border border-[#CFC8BB] bg-white px-2 text-sm font-semibold"
                  aria-label="WIP name"
                />
                <span className="text-xs text-[#6B7280]">{wipType} ×</span>
                <input
                  type="number"
                  min={1}
                  value={pcs}
                  onChange={(e) => setBom(updateNode(bom, path, (n) => ({ ...n, quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })))}
                  className="h-7 w-14 rounded border border-[#CFC8BB] bg-white px-1 text-right text-sm"
                  aria-label="Pieces per finished good"
                />
                <span className="text-xs text-[#6B7280]">PCS</span>
                <button type="button" onClick={() => setBom(addChild(bom, path, wipType))} className="text-[12px] text-[#6B5A2E] hover:underline">+ Sub-WIP</button>
                <button type="button" onClick={() => setBom(removeNode(bom, path))} className="text-[12px] text-[#9A3A2D] hover:underline">Remove WIP</button>
              </>
            ) : (
              <span className="text-sm font-semibold">Product-level processes and materials</span>
            )}
          </div>
          <div className="grid gap-3 p-3 md:grid-cols-2">
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase text-[#6B7280]">Processes · minutes per piece</div>
              <ProcessRows procs={processes} pcs={pcs} onChange={(p) => setBom(setProcs(bom, path, p))} />
            </div>
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase text-[#6B7280]">Raw materials · qty per piece</div>
              <MaterialRows mats={mats} materials={materials} onChange={(m) => setBom(setMats(bom, path, m))} />
            </div>
          </div>
        </div>
      </div>
    );
  };

  const rows: ReactElement[] = [renderLevel([], "", "", 1, 1)];
  const walk = (list: Node[], path: Path, level: number) =>
    list.forEach((n, i) => {
      const p = [...path, i];
      rows.push(renderLevel(p, String(n.wipCode ?? ""), String(n.wipType ?? ""), Number(n.quantity) || 1, level));
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
        <div className="ml-auto flex flex-wrap gap-2">
          <button type="button" onClick={() => setCopyOpen(true)} className="rounded border border-[#D8D1C3] bg-white px-3 py-1.5 text-sm font-semibold">Copy from model…</button>
          <button type="button" onClick={cancel} className="rounded border border-[#D8D1C3] bg-white px-3 py-1.5 text-sm">Cancel</button>
          <button type="button" disabled={!dirty || saving} onClick={save} className="rounded bg-[#6B5A2E] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
      {bom.wipComponents.length === 0 && (
        <div className="rounded-lg border border-dashed border-[#D8CBA8] bg-white p-4 text-sm text-[#6B7280]">
          No WIPs yet. Use <b>Copy from model…</b> above, or add a WIP below, then set each process's minutes and raw material usage.
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
      {copyOpen && <CopyDialog category={category} selfId={template.id} onClose={() => setCopyOpen(false)} onCopy={doCopy} />}
    </div>
  );
}
