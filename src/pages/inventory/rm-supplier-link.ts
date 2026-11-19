import type { SearchableOption } from "@/components/ui/searchable-select";
import type { Supplier } from "@/types";

export interface RawMaterialSupplierLink {
  supplierId: string;
  itemCode: string;
  description: string;
}

export interface MainSupplierBindingPayload {
  supplierId: string;
  materialCode: string;
  materialName: string;
  supplierSku: string;
  unitPrice: number;
  isMainSupplier: boolean;
}

export function buildMainSupplierBinding(link: RawMaterialSupplierLink): MainSupplierBindingPayload {
  return {
    supplierId: link.supplierId,
    materialCode: link.itemCode,
    materialName: link.description,
    supplierSku: link.itemCode,
    unitPrice: 0,
    isMainSupplier: true,
  };
}

export async function linkSupplierToRawMaterial(link: RawMaterialSupplierLink): Promise<void> {
  const response = await fetch("/api/supplier-materials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildMainSupplierBinding(link)),
  });
  if (response.ok) return;
  const errorBody = (await response.json().catch(() => ({}))) as { error?: string };
  throw new Error(errorBody.error || `HTTP ${response.status}`);
}

export function toActiveSupplierOptions(suppliers: Supplier[]): SearchableOption[] {
  return suppliers
    .filter((supplier) => supplier.status === "ACTIVE")
    .map((supplier) => ({
      value: supplier.id,
      label: supplier.code ? `${supplier.code} · ${supplier.name}` : supplier.name,
    }));
}
