// /products/:id/customers — the product page's Customers tab (plan D13):
// the same Customer Assignments box as the Products list dropdown.
import { useParams } from "react-router-dom";
import { isUnknownOutcome, useCachedJson } from "@/lib/cached-fetch";
import { RecordLoadError } from "@/components/ui/record-load-error";
import { CustomerAssignmentsSection } from "./customer-assignments";
import { ProductTabs } from "./product-tabs";

type ProductLite = { id: string; code: string; name: string; category: string };

export default function ProductCustomersPage() {
  const { id = "" } = useParams();
  // The costing read takes an id OR a product code (so /products/1003-(K)/customers
  // works too) and carries today's total cost for the margin column.
  const { data, loading, failure, refresh } = useCachedJson<{ data?: { product: ProductLite; totalSen: number }; error?: string }>(
    `/api/product-costing/${encodeURIComponent(id)}`,
    60,
  );
  const p = data?.data?.product;
  // A failed read is not "not found" — say it could not be loaded.
  if (!p && isUnknownOutcome(failure) && failure) {
    return <RecordLoadError subject="product" failure={failure} onRetry={refresh} backTo="/products" backLabel="Back to Products" />;
  }
  if (!p) return <div className="p-6 text-sm text-[#6B7280]">{loading ? "Loading…" : data?.error ?? "Product not found"}</div>;
  return (
    <div className="space-y-4 w-full">
      <ProductTabs productId={p.id} code={p.code} name={p.name} category={p.category} active="customers" />
      <div className="rounded-lg border border-[#E2DDD8] bg-white p-4">
        <CustomerAssignmentsSection productId={p.id} active category={p.category} costSen={data?.data?.totalSen ?? null} />
      </div>
    </div>
  );
}
