// ---------------------------------------------------------------------------
// /products/:id/costing — what one finished good costs to make (owner
// 2026-11-22, docs/plans/product-costing.md; approved design canvas
// "Costing"). Read view: labour from the BOM minutes, raw materials priced
// from the supplier price list (price in effect today), fabric "from order"
// per tier, margins against today's prices and customer prices, and a
// price ↔ margin calculator that changes nothing.
//
// All maths is server-side (src/lib/product-costing.ts via
// /api/product-costing/:id); this page only lays it out. The calculator uses
// the same pure helpers so the numbers agree.
// ---------------------------------------------------------------------------
import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { isUnknownOutcome, useCachedJson } from "@/lib/cached-fetch";
import { RecordLoadError } from "@/components/ui/record-load-error";
import { bedframePrice3Sen, formatCurrency } from "@/lib/utils";
import { compareToStandard, marginOn, priceForMargin, type CostMaterial, type CostNode, type FabricTier } from "@/lib/product-costing";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { ProductTabs } from "./product-tabs";
import { wipLabel } from "@/lib/wip-label";
import { CostingEditor, type EditableTemplate } from "./costing-editor";
import { FabricTierCard } from "./fabric-tier-card";
import { CostingExportMenu } from "./costing-export-menu";

type CostingData = {
  product: { id: string; code: string; name: string; category: string };
  bom: { id: string; version: string | null; status: string | null; effectiveFrom: string | null } | null;
  labourRatePerMinSen: number;
  nodes: CostNode[];
  byDept: { deptCode: string; dept: string; minutes: number; labourSen: number }[];
  minutes: number;
  labourSen: number;
  materialSen: number;
  totalSen: number;
  tier: string | null;
  tiers: { level: string; maxSen: number; materialSen: number; totalSen: number }[];
  materialLines: number;
  missingLines: number;
  fabricFromOrderLines: number;
  template: EditableTemplate | null;
  fabricTiers?: FabricTier[];
  fabricTiersMeta?: { updatedBy: string | null; updatedAt: string | null };
  standard: {
    labourSen: number;
    materialSen: number;
    totalSen: number;
    tier: string | null;
    setAt: string;
    setBy: string | null;
    linePrices: Record<string, number>;
    tierMaterialSen: Record<string, number>;
  } | null;
};

type ProductLite = {
  id: string;
  code: string;
  name: string;
  category: string;
  baseModel?: string;
  sizeCode?: string;
  sizeLabel?: string;
  basePriceSen?: number | null;
  price1Sen?: number | null;
  defaultVariants?: { fabricCode?: string; divanHeight?: string; legHeight?: string; seatHeight?: string } | null;
};

type Assignment = { id: string; customerName: string; basePriceSen?: number | null };

const LEVEL_TINT = ["#F3F4F6", "#E3EEF4", "#F1E6F2", "#FBE8D8", "#E9F1E2", "#FDF6D8"];
const DEPT_COLORS: Record<string, string> = {
  FAB_CUT: "#3B82F6", FAB_SEW: "#6366F1", WOOD_CUT: "#F59E0B", FOAM: "#10B981",
  FRAMING: "#EF4444", WEBBING: "#14B8A6", UPHOLSTERY: "#EC4899", PACKING: "#8B5CF6",
};
const rm = (sen: number) => formatCurrency(Math.round(sen));
const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);
const qtyText = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(q < 1 ? 3 : 2).replace(/0+$/, "").replace(/\.$/, ""));

function MaterialStatusNote({ m }: { m: CostMaterial }) {
  if (m.status === "priced") {
    return <span className="text-[11px] text-[#6B7280]">{m.supplierName || "supplier"}{m.isMainSupplier ? " · main" : " · not main"}</span>;
  }
  if (m.status === "fabric-tier") return <span className="text-[11px] text-[#1F4E6B]">From order · fabric tier</span>;
  const text = m.status === "no-code" ? "Not a raw material code" : m.status === "from-order" ? "From order · price unknown" : "No supplier price";
  return <span className="text-[11px] font-semibold text-[#B91C1C]">{text}</span>;
}

function NodeCard({ node, category, stdPrices, product }: { node: CostNode; category: string; stdPrices?: Record<string, number>; product?: ProductLite }) {
  const indent = Math.max(0, node.level - 2) * 24;
  const perFg = category === "SOFA" ? "set" : category === "BEDFRAME" ? "bedframe" : "unit";
  return (
    <div className="relative" style={{ marginLeft: indent }}>
      {node.level > 2 && (
        <div aria-hidden className="absolute -left-4 top-0 h-6 w-4 border-l border-b border-gray-300 rounded-bl" />
      )}
      <div className="rounded-lg border border-[#E2DDD8] bg-white overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2" style={{ background: LEVEL_TINT[Math.min(node.level - 1, LEVEL_TINT.length - 1)] }}>
          <span className="text-[10px] font-bold rounded px-1.5 py-0.5 bg-black/10">{node.level === 1 ? "Product" : `L${node.level}`}</span>
          <span className="font-semibold text-sm text-[#111827] truncate">{wipLabel(node.label, product) || "—"}</span>
          <span className="ml-auto text-xs text-[#6B7280] whitespace-nowrap">{node.wipType ? `${node.wipType} · ` : ""}× {node.pcs} PCS</span>
        </div>
        {node.processes.length > 0 && (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-[11px] uppercase text-[#6B7280] bg-[#FAF8F4]">
                <th className="text-left font-semibold px-3 py-1.5">Department</th>
                <th className="text-right font-semibold px-3 py-1.5">Minutes / pc</th>
                <th className="text-right font-semibold px-3 py-1.5">× PCS</th>
                <th className="text-right font-semibold px-3 py-1.5">Minutes</th>
                <th className="text-right font-semibold px-3 py-1.5">Labour</th>
              </tr>
            </thead>
            <tbody>
              {node.processes.map((p, i) => (
                <tr key={i} className="border-t border-[#EFEBE3]">
                  <td className="px-3 py-1.5">
                    <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle" style={{ background: DEPT_COLORS[p.deptCode] ?? "#6B7280" }} />
                    {p.dept} <span className="text-[11px] text-[#6B7280]">{p.category}</span>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{qtyText(p.minutesPerPc)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{node.pcs}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{qtyText(p.minutes)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{rm(p.labourSen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-[11px] uppercase text-[#6B7280] bg-[#FAF8F4] border-t border-[#EFEBE3]">
              <th className="text-left font-semibold px-3 py-1.5">Raw material</th>
              <th className="text-left font-semibold px-3 py-1.5">UOM</th>
              <th className="text-right font-semibold px-3 py-1.5">Qty / {perFg}</th>
              <th className="text-right font-semibold px-3 py-1.5">Unit price</th>
              <th className="text-right font-semibold px-3 py-1.5">Amount</th>
            </tr>
          </thead>
          <tbody>
            {node.materials.length === 0 && (
              <tr className="border-t border-[#EFEBE3]"><td colSpan={5} className="px-3 py-2 text-[12px] text-[#9CA3AF]">No raw material on this WIP</td></tr>
            )}
            {node.materials.map((m, i) => (
              <tr key={i} className="border-t border-[#EFEBE3] align-top">
                <td className="px-3 py-1.5">
                  <div className="font-semibold text-[#111827]">{m.code || m.name}</div>
                  <div className="text-[11px] text-[#6B7280]">{m.code && m.name !== m.code ? `${m.name} · ` : ""}<MaterialStatusNote m={m} /></div>
                </td>
                <td className="px-3 py-1.5">
                  {m.unit || "—"}
                  {m.unitMismatch && <div className="text-[11px] text-[#B45309]">priced per {m.priceUnit}</div>}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {qtyText(m.qty)}
                  {m.wastePct > 0 && <div className="text-[11px] text-[#6B7280]">incl. {m.wastePct}% waste</div>}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {m.priceSen == null ? <span className="font-semibold text-[#B91C1C]">No price</span> : `${rm(m.priceSen)} / ${m.priceUnit || m.unit || "unit"}`}
                  {(() => {
                    const std = m.status === "priced" ? stdPrices?.[m.code.toUpperCase()] : undefined;
                    if (std == null || m.priceSen == null || std === m.priceSen) return null;
                    return <div className={`text-[11px] ${m.priceSen > std ? "text-[#B91C1C]" : "text-[#15803D]"}`}>standard {rm(std)}</div>;
                  })()}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{m.amountSen == null ? "—" : rm(m.amountSen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex justify-end gap-4 px-3 py-1.5 text-[12px] text-[#6B7280] bg-[#FAF8F4] border-t border-[#EFEBE3]">
          <span>Labour <b className="text-[#111827]">{rm(node.labourSen)}</b></span>
          <span>Materials <b className="text-[#111827]">{rm(node.materialSen)}</b></span>
          <span>WIP cost <b className="text-[#111827]">{rm(node.labourSen + node.materialSen)}</b></span>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-lg border border-[#E2DDD8] bg-white px-4 py-3">
      <div className="text-[11px] font-semibold uppercase text-[#6B7280]">{label}</div>
      <div className={`text-xl font-bold tabular-nums ${tone === "good" ? "text-[#15803D]" : tone === "bad" ? "text-[#B91C1C]" : "text-[#111827]"}`}>{value}</div>
      <div className="text-[11px] text-[#6B7280]">{sub}</div>
    </div>
  );
}

export default function ProductCostingPage() {
  const { id = "" } = useParams();
  const [tier, setTier] = useState<string | null>(null);
  const url = `/api/product-costing/${encodeURIComponent(id)}${tier ? `?tier=${encodeURIComponent(tier)}` : ""}`;
  const { data: resp, loading, error, failure, refresh } = useCachedJson<{ success?: boolean; data?: CostingData; error?: string }>(url, 60);
  // Switching fabric tier changes the URL; until the new tier's reply lands
  // keep showing the last costing of THIS product instead of blanking the
  // page to "Loading costing…" (owner 2026-11-22: 「我点不一样level 会闪一下」).
  const [shown, setShown] = useState<CostingData | undefined>(undefined);
  if (resp?.data && resp.data !== shown) setShown(resp.data);
  const sameProduct = (d?: CostingData) => !!d && (d.product.id === id || d.product.code === id);
  const c = resp?.data ?? (loading && sameProduct(shown) ? shown : undefined);
  const switchingTier = !resp?.data && !!c;
  // By the product's id from the costing reply: the route param may be a code.
  const { data: productResp } = useCachedJson<{ data?: ProductLite }>(c ? `/api/products/${encodeURIComponent(c.product.id)}` : null);
  const { data: custResp } = useCachedJson<{ data?: Assignment[] }>(c ? `/api/customer-products/by-product/${c.product.id}` : null);
  const [sellAt, setSellAt] = useState("");
  const [savingStd, setSavingStd] = useState(false);
  const [editing, setEditing] = useState(false);
  // R&D forms keyed in for this product (plan D11), from the audit journal.
  const { data: auditResp } = useCachedJson<{ data?: { action: string; afterJson?: string | null; after?: unknown; ts?: string; createdAt?: string }[] }>(
    c ? `/api/audit-events?resource=products&resourceId=${encodeURIComponent(c.product.id)}` : null,
    60,
  );
  const rdEntries = useMemo(
    () =>
      (auditResp?.data ?? [])
        .filter((e) => e.action === "rd-form-entry")
        .map((e) => {
          let a: Record<string, unknown> = {};
          try {
            a = (typeof e.after === "object" && e.after ? e.after : JSON.parse(String(e.afterJson ?? "{}"))) as Record<string, unknown>;
          } catch {
            a = {};
          }
          return {
            formNo: String(a.formNo ?? ""),
            filledBy: String(a.filledBy ?? ""),
            filledOn: String(a.filledOn ?? ""),
            enteredBy: String(a.enteredBy ?? ""),
            at: String(e.ts ?? e.createdAt ?? ""),
          };
        }),
    [auditResp],
  );
  const { confirm } = useConfirm();
  const { toast } = useToast();
  const [wantPct, setWantPct] = useState("");

  const prices = useMemo(() => {
    const p = productResp?.data;
    if (!p) return [] as { label: string; sen: number | null }[];
    const p2 = p.basePriceSen ?? null;
    const out: { label: string; sen: number | null }[] = [];
    if (p.category === "BEDFRAME") out.push({ label: "Price 3", sen: bedframePrice3Sen(p2) });
    out.push({ label: "Price 2", sen: p2 }, { label: "Price 1", sen: p.price1Sen ?? null });
    return out;
  }, [productResp]);

  if (loading && !c) return <div className="p-6 text-sm text-[#6B7280]">Loading costing…</div>;
  if (!c && isUnknownOutcome(failure) && failure) {
    return <RecordLoadError subject="product costing" failure={failure} onRetry={refresh} backTo="/products" backLabel="Back to Products" />;
  }
  if (!c) return <div className="p-6 text-sm text-[#B91C1C]">{resp?.error || (error ? String(error) : "Costing not available")}</div>;

  const total = c.totalSen;
  const price2 = prices.find((p) => p.label === "Price 2")?.sen ?? null;
  const m2 = price2 ? marginOn(price2, total) : null;
  const sellSen = Math.round(Number(sellAt) * 100);
  const sellMargin = sellAt && sellSen > 0 ? marginOn(sellSen, total) : null;
  const targetPrice = wantPct ? priceForMargin(total, Number(wantPct)) : null;
  const statusLabel = c.bom ? `${c.bom.version ? `BOM ${c.bom.version}` : "BOM"} · ${c.bom.status === "ACTIVE" ? "Active" : c.bom.status ?? ""}` : "No BOM";

  return (
    <div className={`space-y-4 w-full transition-opacity ${switchingTier ? "opacity-70" : ""}`} aria-busy={switchingTier || undefined}>
      <ProductTabs productId={c.product.id} code={c.product.code} name={c.product.name} category={c.product.category} active="costing" extra={statusLabel} />

      {c.bom && !editing && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <CostingExportMenu productId={c.product.id} tier={c.tier} />
        </div>
      )}

      {!c.bom && <div className="rounded-lg border border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 text-sm text-[#B91C1C]">This product has no BOM yet, so there is nothing to cost. Create its BOM first.</div>}
      {c.bom && c.bom.status !== "ACTIVE" && <div className="rounded-lg border border-[#FCD34D] bg-[#FFFBEB] px-4 py-3 text-sm text-[#92400E]">Costed from a {String(c.bom.status ?? "draft").toLowerCase()} BOM — this product has no active BOM.</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Labour" value={rm(c.labourSen)} sub={`${qtyText(c.minutes)} min × RM ${(c.labourRatePerMinSen / 100).toFixed(4)}/min`} />
        <Kpi label="Raw materials" value={rm(c.materialSen)} sub={`${c.materialLines} lines${c.missingLines ? ` · ${c.missingLines} without a price` : ""}${c.tier ? ` · fabric ${c.tier}` : ""}`} tone={c.missingLines ? "bad" : undefined} />
        <Kpi label="Total cost" value={rm(total)} sub="labour + raw materials" />
        <Kpi label={`Margin at Price 2${price2 ? ` (${rm(price2)})` : ""}`} value={m2 ? rm(m2.marginSen) : "—"} sub={m2 ? `${pct(m2.pct)} of price` : "no Price 2"} tone={m2 ? (m2.marginSen >= 0 ? "good" : "bad") : undefined} />
      </div>

      {c.bom && (() => {
        const std = c.standard;
        const cmp = std ? compareToStandard(c, std) : null;
        const setStandard = async () => {
          const ok = await confirm({
            title: std ? "Update standard to today?" : "Set today's cost as standard?",
            message: `The standard cost becomes ${rm(total)}${c.tier ? ` (fabric ${c.tier})` : ""}. Earlier standards are kept in the history.`,
          });
          if (!ok) return;
          setSavingStd(true);
          try {
            const r = await fetch(`/api/product-costing/${encodeURIComponent(c.product.id)}/standard${c.tier ? `?tier=${encodeURIComponent(c.tier)}` : ""}`, { method: "POST" });
            const j = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string };
            if (!r.ok || j.success === false) {
              toast.error(j.error || "Could not save the standard cost.");
            } else {
              toast.success("Standard cost saved.");
              refresh();
            }
          } finally {
            setSavingStd(false);
          }
        };
        return (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-[#E2DDD8] bg-white px-4 py-3 text-[13px]">
            {std && cmp ? (
              <>
                <div><span className="text-[#6B7280]">Standard cost</span> <b className="tabular-nums">{rm(cmp.stdTotalSen)}</b> <span className="text-[11px] text-[#6B7280]">set {std.setAt.slice(0, 10)}{std.setBy ? ` by ${std.setBy}` : ""}</span></div>
                <div><span className="text-[#6B7280]">Today</span> <b className="tabular-nums">{rm(total)}</b></div>
                <div className={cmp.diffSen > 0 ? "text-[#B91C1C]" : cmp.diffSen < 0 ? "text-[#15803D]" : "text-[#6B7280]"}>
                  {cmp.diffSen === 0 ? "Same as standard" : `${cmp.diffSen > 0 ? "+" : "−"}${rm(Math.abs(cmp.diffSen))} (${pct(cmp.diffPct == null ? null : Math.abs(cmp.diffPct))}) vs standard`}
                </div>
              </>
            ) : (
              <div className="text-[#6B7280]">No standard cost yet — set today's cost as the standard to track price changes against it.</div>
            )}
            <button type="button" disabled={savingStd} onClick={setStandard} className="ml-auto rounded-md border border-[#D8CBA8] bg-[#F6F1E6] px-3 py-1.5 text-xs font-semibold text-[#6B5A2E] disabled:opacity-50">
              {savingStd ? "Saving…" : std ? "Update standard to today" : "Set as standard"}
            </button>
          </div>
        );
      })()}

      {(rdEntries?.length ?? 0) > 0 && (
        <div className="rounded-lg border border-[#E2DDD8] bg-white px-4 py-2 text-[12px] text-[#374151]">
          <span className="font-semibold">R&amp;D forms entered:</span>{" "}
          {rdEntries!.slice(0, 3).map((e, i) => (
            <span key={i}>
              {i > 0 && " · "}
              {e.formNo}
              {e.filledBy ? ` filled by ${e.filledBy}` : ""}
              {e.filledOn ? ` on ${e.filledOn}` : ""}
              {e.enteredBy ? `, keyed in by ${e.enteredBy}` : ""}
              {e.at ? ` (${e.at.slice(0, 10)})` : ""}
            </span>
          ))}
        </div>
      )}

      {c.tiers.length > 0 && (
        <FabricTierCard
          tiers={c.tiers}
          settings={c.fabricTiers ?? []}
          selected={switchingTier ? tier : c.tier}
          onSelect={(lv) => setTier(lv)}
          fabricMetres={c.nodes.flatMap((n) => n.materials).filter((m) => m.status === "fabric-tier").reduce((sum, m) => sum + m.qty, 0)}
          labourSen={c.labourSen}
          materialSen={c.materialSen}
          updatedBy={c.fabricTiersMeta?.updatedBy}
          updatedAt={c.fabricTiersMeta?.updatedAt}
          onSaved={() => refresh()}
        />
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-4 items-start">
        <div className="space-y-3 min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-[#111827]">Cost by WIP</h2>
            <span className="text-[11px] text-[#6B7280]">Minutes from the BOM · unit prices from the supplier price list (main supplier, price in effect today)</span>
            {c.template && !editing && (
              <button type="button" onClick={() => setEditing(true)} className="ml-auto rounded-md bg-[#6B5A2E] px-3 py-1.5 text-xs font-semibold text-white">
                Edit costing
              </button>
            )}
          </div>
          {editing && c.template ? (
            <CostingEditor
              template={c.template}
              productId={c.product.id}
              category={c.product.category}
              labelProduct={productResp?.data}
              tier={c.tier}
              onDone={(saved) => {
                setEditing(false);
                if (saved) refresh();
              }}
            />
          ) : (
            <div className="space-y-2 overflow-x-auto">
              {c.nodes.length === 0 && <div className="text-sm text-[#6B7280]">No WIPs in this BOM.</div>}
              {c.nodes.map((n) => <NodeCard key={n.id} node={n} category={c.product.category} stdPrices={c.standard?.linePrices} product={productResp?.data} />)}
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="rounded-lg border border-[#E2DDD8] bg-white p-4 space-y-3">
            <h2 className="text-sm font-semibold text-[#111827]">Price check</h2>
            <div className="text-[13px] space-y-1">
              <div className="flex justify-between"><span>Labour</span><span className="tabular-nums">{rm(c.labourSen)}</span></div>
              <div className="flex justify-between"><span>Raw materials</span><span className="tabular-nums">{rm(c.materialSen)}</span></div>
              <div className="flex justify-between font-bold border-t border-[#EFEBE3] pt-1"><span>Total cost</span><span className="tabular-nums">{rm(total)}</span></div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase text-[#6B7280] mb-1">Current prices · margin</div>
              <div className="text-[13px] space-y-1">
                {prices.map((p) => {
                  const m = p.sen ? marginOn(p.sen, total) : null;
                  return (
                    <div key={p.label} className="flex justify-between">
                      <span className={p.label === "Price 2" ? "font-semibold" : ""}>{p.label}</span>
                      <span className="tabular-nums">{p.sen ? `${rm(p.sen)} · ${pct(m?.pct ?? null)}` : "—"}</span>
                    </div>
                  );
                })}
                {(custResp?.data ?? []).map((a) => {
                  const m = a.basePriceSen ? marginOn(a.basePriceSen, total) : null;
                  return (
                    <div key={a.id} className="flex justify-between">
                      <span className="truncate pr-2">{a.customerName}</span>
                      <span className="tabular-nums whitespace-nowrap">{a.basePriceSen ? `${rm(a.basePriceSen)} · ${pct(m?.pct ?? null)}` : "—"}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase text-[#6B7280] mb-1">Calculator</div>
              <label className="block rounded-md bg-[#FAF8F4] p-2 mb-2">
                <span className="text-[12px] font-semibold">If I sell at (RM)</span>
                <input inputMode="decimal" value={sellAt} onChange={(e) => setSellAt(e.target.value)} className="mt-1 w-full h-9 rounded-md border border-[#CFC8BB] px-2 text-sm" placeholder="e.g. 650" />
                <div className="flex justify-between mt-1 text-[13px]"><span>Margin</span><b className={`tabular-nums ${sellMargin && sellMargin.marginSen < 0 ? "text-[#B91C1C]" : "text-[#15803D]"}`}>{sellMargin ? `${rm(sellMargin.marginSen)} · ${pct(sellMargin.pct)}` : "—"}</b></div>
              </label>
              <label className="block rounded-md bg-[#FAF8F4] p-2">
                <span className="text-[12px] font-semibold">If I want a margin of (%)</span>
                <input inputMode="decimal" value={wantPct} onChange={(e) => setWantPct(e.target.value)} className="mt-1 w-full h-9 rounded-md border border-[#CFC8BB] px-2 text-sm" placeholder="e.g. 60" />
                <div className="flex justify-between mt-1 text-[13px]"><span>Sell at</span><b className="tabular-nums">{targetPrice != null ? rm(targetPrice) : "—"}</b></div>
              </label>
              <p className="mt-2 text-[11px] text-[#6B7280]">Margin = (price − total cost) ÷ price. Nothing here changes a saved price; set prices in Price history as today.</p>
            </div>
            {c.missingLines > 0 && (
              <div className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] p-2 text-[12px] text-[#B91C1C]">
                <b>{c.missingLines} material{c.missingLines === 1 ? "" : "s"} without a price</b> — not counted as RM 0. Add a supplier price, or the total cost is short.
              </div>
            )}
          </div>

          <div className="rounded-lg border border-[#E2DDD8] bg-white p-4">
            <h2 className="text-sm font-semibold text-[#111827] mb-2">Cost by department</h2>
            <div className="text-[13px] space-y-1">
              {c.byDept.length === 0 && <div className="text-[#6B7280]">No minutes in this BOM.</div>}
              {c.byDept.map((d) => (
                <div key={d.deptCode} className="flex justify-between">
                  <span><span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: DEPT_COLORS[d.deptCode] ?? "#6B7280" }} />{d.dept}</span>
                  <span className="tabular-nums">{qtyText(d.minutes)} min · {rm(d.labourSen)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
