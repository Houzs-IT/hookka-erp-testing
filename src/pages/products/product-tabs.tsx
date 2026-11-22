// ---------------------------------------------------------------------------
// The product page header (owner 2026-11-22, plan D13): double-clicking a
// row in Products opens the product; its pages share this header and tab
// strip — BOM / Costing / Customers / Documents. The Products list dropdown
// stays exactly as it was; this is the second, detailed way in.
// ---------------------------------------------------------------------------
import { Link } from "react-router-dom";

export type ProductTab = "bom" | "costing" | "customers" | "documents";

const TABS: { key: ProductTab; label: string; path: string }[] = [
  { key: "bom", label: "BOM", path: "bom" },
  { key: "costing", label: "Costing", path: "costing" },
  { key: "customers", label: "Customers", path: "customers" },
  { key: "documents", label: "Documents", path: "documents" },
];

export function ProductTabs({
  productId,
  code,
  name,
  category,
  active,
  extra,
}: {
  productId: string;
  code: string;
  name: string;
  category?: string;
  active: ProductTab;
  extra?: string;
}) {
  return (
    <div className="space-y-2">
      <nav className="text-xs text-[#6B7280]">
        <Link to="/products" className="hover:underline">Products</Link>
        <span className="mx-1">›</span>
        <span>{code}</span>
        <span className="mx-1">›</span>
        <span className="font-semibold text-[#111827]">{TABS.find((t) => t.key === active)?.label}</span>
      </nav>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-[#111827] truncate">{name || code}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded border border-[#E5E7EB] bg-white px-1.5 py-0.5 font-semibold">{code}</span>
            {category && <span className="rounded bg-[#FDF3D8] px-1.5 py-0.5 font-semibold text-[#8A6A12]">{category}</span>}
            {extra && <span className="text-[#6B7280]">{extra}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`/products?variants=${encodeURIComponent(productId)}`}
            className="rounded-md border border-[#E8D597] bg-[#FDF6D8] px-3 py-1.5 text-xs font-medium text-[#8A6A12] hover:bg-[#FBF0C4]"
          >
            Manage Variants
          </Link>
          <ProductTabStrip productId={productId} active={active} />
        </div>
      </div>
    </div>
  );
}

/** Just the tab strip — for the older product pages (BOM, Documents) that
 *  keep their own header. */
export function ProductTabStrip({ productId, active }: { productId: string; active: ProductTab }) {
  return (
    <div role="tablist" className="inline-flex flex-wrap rounded-lg border border-[#E2DDD8] bg-[#F5F2EC] p-1">
      {TABS.map((t) => (
        <Link
          key={t.key}
          role="tab"
          aria-selected={t.key === active}
          to={`/products/${encodeURIComponent(productId)}/${t.path}`}
          className={`rounded-md px-3 py-1.5 text-sm ${t.key === active ? "bg-white font-semibold text-[#111827] shadow-sm" : "text-[#6B7280] hover:text-[#111827]"}`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
