// ---------------------------------------------------------------------------
// "Export PDF ▾" for one product — the three costing reports and the R&D
// Spec Form. Used on the costing page AND in the Products list dropdown
// (owner 2026-11-22: 「不能在这里点击export 我要的PDF 还得进去」), so both
// produce the same files from the same data. Everything loads on click: the
// costing, the product (prices, default variants), the customer prices, and
// jsPDF itself.
// ---------------------------------------------------------------------------
import { useState } from "react";
import { bedframePrice3Sen } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";

type Kind = "full" | "spec" | "labour" | "rd";

const ITEMS: [Kind, string, string][] = [
  ["full", "Full Costing Report", "processes, raw materials, labour + material cost, margins"],
  ["spec", "Production Spec Sheet", "processes, minutes, raw materials — no money"],
  ["labour", "Labour Cost Report", "minutes and labour by WIP and department"],
  ["rd", "R&D Spec Form (to fill in)", "what the BOM has now + empty boxes for R&D"],
];

export function CostingExportMenu({ productId, tier, align = "right" }: { productId: string; tier?: string | null; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const run = async (kind: Kind) => {
    setOpen(false);
    setBusy(true);
    try {
      const q = tier ? `?tier=${encodeURIComponent(tier)}` : "";
      type Json = { data?: any; error?: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
      const [cr, pr] = await Promise.all([
        fetch(`/api/product-costing/${encodeURIComponent(productId)}${q}`).then((r) => r.json() as Promise<Json>),
        fetch(`/api/products/${encodeURIComponent(productId)}`).then((r) => r.json() as Promise<Json>).catch((): Json => ({})),
      ]);
      const c = cr?.data;
      if (!c) {
        toast.error(cr?.error || "Could not load the costing.");
        return;
      }
      if (!c.bom) {
        toast.error("This product has no BOM yet — nothing to print.");
        return;
      }
      const p = pr?.data ?? {};
      const product = { ...c.product, ...p };
      if (kind === "rd") {
        const { generateRdFormPdf } = await import("@/lib/generate-rd-form-pdf");
        generateRdFormPdf({ product, bom: c.bom, nodes: c.nodes, blankLines: 2 });
        return;
      }
      const cust = await fetch(`/api/customer-products/by-product/${encodeURIComponent(c.product.id)}`)
        .then((r) => r.json() as Promise<Json>)
        .catch((): Json => ({}));
      const p2 = p.basePriceSen ?? null;
      const prices = [
        ...(product.category === "BEDFRAME" ? [{ label: "Price 3", sen: bedframePrice3Sen(p2) }] : []),
        { label: "Price 2", sen: p2 },
        { label: "Price 1", sen: p.price1Sen ?? null },
      ];
      const customers = ((cust?.data ?? []) as { customerName: string; basePriceSen?: number | null }[]).map((a) => ({ name: a.customerName, sen: a.basePriceSen ?? null }));
      const { generateCostingPdf } = await import("@/lib/generate-costing-pdf");
      generateCostingPdf({ product, bom: c.bom, costing: c, prices, customers, standard: c.standard }, kind);
    } catch {
      toast.error("Could not make the PDF.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md border border-[#6B5A2E] bg-white px-3 py-1.5 text-xs font-semibold text-[#6B5A2E] disabled:opacity-50"
      >
        {busy ? "Making PDF…" : "Export PDF ▾"}
      </button>
      {open && (
        <div className={`absolute z-30 mt-1 w-72 rounded-md border border-[#E2DDD8] bg-white p-1 shadow-lg ${align === "right" ? "right-0" : "left-0"}`}>
          {ITEMS.map(([kind, title, hint], i) => (
            <button
              key={kind}
              type="button"
              onClick={() => void run(kind)}
              className={`block w-full rounded px-3 py-2 text-left hover:bg-[#FAF8F4] ${i === 3 ? "mt-1 border-t border-[#EFEBE3]" : ""}`}
            >
              <div className="text-sm font-semibold text-[#111827]">{title}</div>
              <div className="text-[11px] text-[#6B7280]">{hint}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
