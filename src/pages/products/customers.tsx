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
  const { data, loading, failure, refresh } = useCachedJson<{ data?: ProductLite; error?: string }>(`/api/products/${encodeURIComponent(id)}`);
  const p = data?.data;
  // A failed read is not "not found" — say it could not be loaded.
  if (!p && isUnknownOutcome(failure) && failure) {
    return <RecordLoadError subject="product" failure={failure} onRetry={refresh} backTo="/products" backLabel="Back to Products" />;
  }
  if (!p) return <div className="p-6 text-sm text-[#6B7280]">{loading ? "Loading…" : data?.error ?? "Product not found"}</div>;
  return (
    <div className="space-y-4 max-w-[1100px]">
      <ProductTabs productId={p.id} code={p.code} name={p.name} category={p.category} active="customers" />
      <div className="rounded-lg border border-[#E2DDD8] bg-white p-4">
        <CustomerAssignmentsSection productId={p.id} active />
      </div>
    </div>
  );
}
