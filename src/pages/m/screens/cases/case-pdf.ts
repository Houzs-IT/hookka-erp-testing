// "Download PDF" — the desktop's client-side report (src/lib/generate-service-case-pdf.ts),
// fed exactly as detail.tsx feeds it. No server call, no new authorisation.
import { parseRepairScope, repairScopeBadgeLabel } from "@/lib/repair-scope";
import type { computeCasePipeline } from "@/lib/case-pipeline";
import { CASE_PIPELINE_STEPS, ROOT_CAUSE_LABELS, type ServiceCaseApi } from "./case-model";

export type CustomerRecord = {
  name?: string;
  code?: string;
  phone?: string | null;
  mobile?: string | null;
  contactName?: string | null;
  email?: string | null;
  companyAddress?: string | null;
  deliveryHubs?: Array<{ state?: string; address?: string; isDefault?: boolean }>;
};

export type CasePoRow = {
  id: string;
  salesOrderId?: string | null;
  companySOId?: string | null;
  customerPOId?: string | null;
  customerReference?: string | null;
  repairScope?: string | null;
  repairscope?: string | null;
  jobCards?: Array<{ completedDate?: string | null }>;
};

export function casePoRefs(pos: CasePoRow[], svIds: string[]) {
  const ids = new Set(svIds);
  const mine = pos.filter((p) => !!p.salesOrderId && ids.has(p.salesOrderId));
  let po = "";
  let ref = "";
  for (const p of mine) {
    if (!po && p.customerPOId) po = p.customerPOId;
    if (!ref && p.customerReference) ref = p.customerReference;
  }
  const repairScopes: Array<{ orderNo: string; label: string }> = [];
  const seen = new Set<string>();
  for (const p of mine) {
    const so = p.salesOrderId ?? "";
    if (!so || seen.has(so)) continue;
    seen.add(so);
    repairScopes.push({
      orderNo: p.companySOId || p.salesOrderId || "Service Order",
      label: repairScopeBadgeLabel(parseRepairScope(p.repairScope ?? p.repairscope ?? null)),
    });
  }
  return { po, ref, repairScopes };
}

export async function downloadCasePdf(args: {
  c: ServiceCaseApi;
  customer: CustomerRecord | null;
  pipe: ReturnType<typeof computeCasePipeline> | null;
  pos: CasePoRow[];
}) {
  const { c, customer, pipe, pos } = args;
  const { generateServiceCasePdf } = await import("@/lib/generate-service-case-pdf");
  const svIds = c.orders.filter((o) => o.isSv).map((o) => o.id);
  const refs = casePoRefs(pos, svIds);
  const hubs = customer?.deliveryHubs ?? [];
  const hub = hubs.find((h) => h.isDefault) ?? hubs[0] ?? null;
  const firstCat = c.rootCauses?.[0]?.category || c.rootCauseCategory || "";
  generateServiceCasePdf({
    caseNo: c.caseNo,
    status: c.status,
    customerName: customer?.name ?? c.customerName,
    customerCode: customer?.code ?? null,
    customerPhone: customer?.phone ?? customer?.mobile ?? null,
    customerContact: customer?.contactName ?? null,
    customerEmail: customer?.email ?? null,
    customerAddress: customer?.companyAddress ?? null,
    deliveryAddress: hub?.address ?? null,
    deliveryState: hub?.state ?? null,
    sourceType: c.sourceType,
    sourceNo: c.sourceNo,
    customerPO: refs.po || null,
    customerRef: refs.ref || null,
    externalRef: c.externalRef,
    category: firstCat ? ROOT_CAUSE_LABELS[firstCat] ?? firstCat : null,
    createdByName: c.createdByName,
    createdAt: c.createdAt,
    investigatingAt: c.investigatingAt,
    closedAt: c.closedAt,
    customerState: c.customerState,
    responsibleUnit: c.responsibleUnit,
    issueDescription: c.issueDescription,
    notes: c.notes,
    issuePhotos: c.issuePhotos,
    affectedProducts: c.affectedProducts?.map((p) => ({ code: p.code, name: p.name, qty: p.qty, components: p.components })),
    rootCauses: c.rootCauses,
    preventionAction: c.preventionAction,
    preventionOwner: c.preventionOwner,
    actionLog: c.actionLog?.map((a) => ({ date: a.date, description: a.description, createdByName: a.createdByName })),
    orders: c.orders?.map((o) => ({ serviceOrderNo: o.serviceOrderNo, mode: o.mode, status: o.status, isSv: o.isSv, createdAt: o.createdAt })),
    repairScopes: refs.repairScopes,
    timeline: pipe
      ? CASE_PIPELINE_STEPS.map((step, i) => {
          let date: string | null = null;
          if (i === 0) date = c.createdAt || null;
          else if (i === 1) date = c.investigatingAt ?? c.createdAt ?? null;
          else if (i === CASE_PIPELINE_STEPS.length - 1) date = c.closedAt || null;
          if (i === pipe.index && !date) date = pipe.enteredAt;
          return { step, done: pipe.doneFlags[i], date };
        })
      : undefined,
  });
}
