// ---------------------------------------------------------------------------
// Fabric from order — cost by fabric tier, with "Set tier prices" (owner
// 2026-11-22: 「这个地方我要可以set fabric的price 因为fabric的价格全部都是浮动的
// 就是我可以preset lv几多少钱的」; design "Fabric tier prices").
//
// The tiers are ONE setting for every product (kv_config via
// PUT /api/product-costing/fabric-tiers, audited, who/when kept). While
// editing, each row shows what THIS product would cost at that level, worked
// out from the page's own numbers: labour + non-fabric materials + fabric
// metres × the level's top price.
// ---------------------------------------------------------------------------
import { useState } from "react";
import { formatCurrency } from "@/lib/utils";
import { invalidateCachePrefix } from "@/lib/cached-fetch";
import { useToast } from "@/components/ui/toast";
import type { FabricTier } from "@/lib/product-costing";

type TierRow = { level: string; maxSen: number; materialSen: number; totalSen: number };
type Draft = { level: string; min: string; max: string };

const rm = (sen: number) => formatCurrency(Math.round(sen));
const toSen = (v: string) => Math.round(Number(v) * 100);

export function FabricTierCard({
  tiers,
  settings,
  selected,
  onSelect,
  fabricMetres,
  labourSen,
  materialSen,
  updatedBy,
  updatedAt,
  onSaved,
}: {
  tiers: TierRow[];
  settings: FabricTier[];
  selected: string | null;
  onSelect: (level: string) => void;
  fabricMetres: number;
  labourSen: number;
  materialSen: number;
  updatedBy?: string | null;
  updatedAt?: string | null;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft[]>([]);
  const range = (level: string) => settings.find((s) => s.level === level);
  const selMax = tiers.find((t) => t.level === selected)?.maxSen ?? tiers[0]?.maxSen ?? 0;
  const nonFabricSen = materialSen - fabricMetres * selMax;
  const at = (maxSen: number) => labourSen + nonFabricSen + fabricMetres * maxSen;

  const start = () => {
    setDraft(settings.map((s) => ({ level: s.level, min: (s.minSen / 100).toFixed(2), max: (s.maxSen / 100).toFixed(2) })));
    setEditing(true);
  };
  const set = (i: number, patch: Partial<Draft>) => setDraft(draft.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  const save = async () => {
    const out = draft.map((d) => ({ level: d.level.trim(), minSen: toSen(d.min), maxSen: toSen(d.max) }));
    setSaving(true);
    try {
      const r = await fetch("/api/product-costing/fabric-tiers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tiers: out }),
      });
      const j = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!r.ok || j.success === false) {
        toast.error(j.error || "Could not save the tier prices.");
        return;
      }
      // Every product's costing and the list's Raw mat. column read these.
      invalidateCachePrefix("/api/product-costing");
      toast.success("Fabric tier prices saved — every product's costing now uses them.");
      setEditing(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`rounded-lg border p-3 ${editing ? "border-[#D8CBA8] bg-[#FFFDF7]" : "border-[#E2DDD8] bg-white"}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-[#111827]">{editing ? "Fabric tier prices (per metre)" : "Fabric from order — cost by fabric tier"}</span>
        <span className="text-[11px] text-[#6B7280]">{editing ? "Same for every product. Costing uses the TOP of each range." : "each tier costed at its top price per metre"}</span>
        <span className="ml-auto flex gap-2">
          {editing ? (
            <>
              <button type="button" onClick={() => setEditing(false)} className="rounded-md border border-[#D8D1C3] bg-white px-3 py-1.5 text-xs">Cancel</button>
              <button type="button" disabled={saving} onClick={() => void save()} className="rounded-md bg-[#6B5A2E] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                {saving ? "Saving…" : "Save"}
              </button>
            </>
          ) : (
            <button type="button" onClick={start} className="rounded-md border border-[#D8D1C3] bg-white px-3 py-1.5 text-xs font-semibold">Set tier prices</button>
          )}
        </span>
      </div>

      {editing ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] uppercase text-[#6B7280]">
                <th className="px-2 py-1.5 font-semibold">Level</th>
                <th className="px-2 py-1.5 font-semibold">From (RM / m)</th>
                <th className="px-2 py-1.5 font-semibold">To (RM / m) — used for cost</th>
                <th className="px-2 py-1.5 font-semibold">This product at this level</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {draft.map((d, i) => {
                const max = toSen(d.max);
                const old = tiers.find((t) => t.level === d.level);
                const now = max > 0 ? at(max) : null;
                return (
                  <tr key={i} className="border-t border-[#EFEBE3]">
                    <td className="px-2 py-1.5"><input value={d.level} onChange={(e) => set(i, { level: e.target.value })} className="h-8 w-24 rounded border border-[#CFC8BB] px-2" aria-label="Level name" /></td>
                    <td className="px-2 py-1.5"><input inputMode="decimal" value={d.min} onChange={(e) => set(i, { min: e.target.value })} className="h-8 w-24 rounded border border-[#CFC8BB] px-2 text-right" aria-label={`${d.level} from`} /></td>
                    <td className="px-2 py-1.5"><input inputMode="decimal" value={d.max} onChange={(e) => set(i, { max: e.target.value })} className="h-8 w-24 rounded border border-[#CFC8BB] px-2 text-right" aria-label={`${d.level} to`} /></td>
                    <td className="px-2 py-1.5 tabular-nums">
                      {now == null ? "—" : <b>{rm(now)}</b>}
                      {now != null && old && Math.round(old.totalSen) !== Math.round(now) && <span className="ml-1 text-[11px] text-[#6B7280]">(was {rm(old.totalSen)})</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <button type="button" disabled={draft.length <= 1} onClick={() => setDraft(draft.filter((_, j) => j !== i))} className="text-[12px] text-[#9A3A2D] hover:underline disabled:opacity-40">Remove</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mt-2 flex flex-wrap justify-between gap-2 text-[12px] text-[#6B7280]">
            <button
              type="button"
              disabled={draft.length >= 10}
              onClick={() => {
                const last = draft[draft.length - 1];
                setDraft([...draft, { level: `Lv${draft.length + 1}`, min: last?.max ?? "0.00", max: last?.max ?? "0.00" }]);
              }}
              className="font-semibold text-[#6B5A2E] hover:underline disabled:opacity-40"
            >
              + Add level
            </button>
            {updatedBy && <span>Last changed by {updatedBy}{updatedAt ? ` · ${updatedAt.slice(0, 10)}` : ""} · every change is kept in the history</span>}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {tiers.map((t) => {
            const r = range(t.level);
            return (
              <button
                key={t.level}
                type="button"
                aria-pressed={selected === t.level}
                onClick={() => onSelect(t.level)}
                className={`rounded-md border px-3 py-2 text-left ${selected === t.level ? "border-[#6B5A2E] bg-[#F6F1E6]" : "border-[#E2DDD8] bg-white hover:bg-[#FAF8F4]"}`}
              >
                <div className="text-[11px] text-[#6B7280]">
                  {t.level} · {r ? `${rm(r.minSen)} – ${rm(t.maxSen)}` : `up to ${rm(t.maxSen)}`} /m
                </div>
                <div className="font-bold tabular-nums">{rm(t.totalSen)}</div>
                <div className="text-[11px] text-[#6B7280]">materials {rm(t.materialSen)}</div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
