// ---------------------------------------------------------------------------
// AuditLogTab — Accounting → Audit Log.
//
// Lists every document currently VOID or DELETED (newest action first) with
// who/when, and lets you Unvoid — the only way back for DELETED docs, which
// are hidden from the normal document lists. Each sourceType maps to its
// /lifecycle endpoint to repost the unvoid.
//
// Extracted verbatim from accounting/index.tsx (2026-07-04 file split). Since
// 2026-10-17 the list is the Payment Vouchers table (DataGrid: header menu,
// filters, resize / reorder, Set as default, its own search); Unvoid is the
// row's right-click / ⋮ menu and its double-click.
// ---------------------------------------------------------------------------

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { LifecycleBadge } from "@/components/accounting/lifecycle-actions";
import { DataGrid, type Column } from "@/components/ui/data-grid";
import { asMutationResponse } from "../shared";

type AuditRow = {
  id: string;
  sourceType: string;
  sourceId: string;
  state: string;
  actionAt: string | null;
  actorUserId: string | null;
  actorName?: string | null;
  reference?: string;
  party?: string;
  amountSen?: number;
  docDate?: string;
};

const AUDIT_DOC_MAP: Record<string, { label: string; base: string }> = {
  payment_voucher: { label: "Expense Payment", base: "/api/accounting/payment-vouchers" },
  official_receipt: { label: "Official Receipt", base: "/api/accounting/official-receipts" },
  manual: { label: "Journal Entry", base: "/api/accounting/journals" },
  fund_transfer: { label: "Fund Transfer", base: "/api/accounting/fund-transfers" },
  other_party_bill: { label: "Other Party Bill", base: "/api/accounting/other-party-bills" },
  other_party_payment: { label: "Other Party Payment", base: "/api/accounting/other-party-payments" },
  supplier_payment: { label: "Supplier Payment", base: "/api/supplier-payments" },
};

const typeLabel = (r: AuditRow) => AUDIT_DOC_MAP[r.sourceType]?.label ?? r.sourceType;
const whenText = (r: AuditRow) => (r.actionAt ? r.actionAt.slice(0, 19).replace("T", " ") : "—");

export function AuditLogTab() {
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const [rows, setRows] = useState<AuditRow[] | null>(null);

  const load = useCallback(() => {
    fetch("/api/accounting/audit-log")
      .then((r) => r.json() as Promise<{ success?: boolean; data?: AuditRow[] }>)
      .then((j) => { if (j?.success) setRows(j.data ?? []); })
      .catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const unvoid = async (row: AuditRow) => {
    const map = AUDIT_DOC_MAP[row.sourceType];
    if (!map) { toast.error(`Don't know how to restore ${row.sourceType}`); return; }
    if (!(await confirm({ title: "Restore document?", message: `Restore ${map.label} ${row.sourceId}? It will be reposted to the GL.`, danger: false }))) return;
    const res = await fetch(`${map.base}/${encodeURIComponent(row.sourceId)}/lifecycle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "unvoid" }),
    });
    const j = asMutationResponse(await res.json());
    if (j?.success) { toast.success(`${row.sourceId} restored`); load(); }
    else toast.error(j?.error || "Restore failed");
  };

  // The grid's search reads type, reference, party, who, state and date (#10).
  const columns = useMemo<Column<AuditRow>[]>(() => [
    { key: "actionAt", label: "When", width: "160px", sortAccessor: (r) => r.actionAt ?? "", filterAccessor: whenText, exportValue: whenText, render: (_v, r) => <span className="text-xs text-[#6B7280] whitespace-nowrap">{whenText(r)}</span> },
    { key: "sourceType", label: "Type", width: "150px", filterAccessor: typeLabel, exportValue: typeLabel, render: (_v, r) => <span className="text-xs">{typeLabel(r)}</span> },
    { key: "reference", label: "Reference", width: "150px", noFilter: true, filterAccessor: (r) => r.reference ?? r.sourceId, exportValue: (r) => r.reference ?? r.sourceId, render: (_v, r) => <span className="tabular-nums text-xs font-medium">{r.reference ?? r.sourceId}</span> },
    { key: "docDate", label: "Doc Date", type: "date", width: "110px", render: (_v, r) => <span className="text-xs text-[#6B7280] whitespace-nowrap">{r.docDate || "—"}</span> },
    { key: "party", label: "Party", width: "200px", render: (_v, r) => <span className="text-xs">{r.party || "—"}</span> },
    { key: "amountSen", label: "Amount", type: "currency", align: "right", width: "130px" },
    { key: "state", label: "State", width: "100px", render: (_v, r) => <LifecycleBadge state={r.state} /> },
    { key: "actorName", label: "By", width: "150px", filterAccessor: (r) => r.actorName ?? r.actorUserId ?? "—", exportValue: (r) => r.actorName ?? r.actorUserId ?? "—", render: (_v, r) => <span className="text-xs text-[#6B7280]">{r.actorName ?? r.actorUserId ?? "—"}</span> },
  ], []);

  return (
    <div className="space-y-4">
      {/* The page title and its (i) name the page (finance v2). */}
      <p className="text-xs text-[#6B7280]">Voided &amp; deleted documents — the GL keeps every reversal; restore any of them here (right-click a row, or double-click it).</p>
      <Card>
        <CardContent className="p-0">
          <DataGrid
            columns={columns}
            data={rows ?? []}
            keyField="id"
            gridId="accounting-audit-log"
            onDoubleClick={(r) => void unvoid(r)}
            contextMenuItems={[{ label: "Unvoid — restore and repost", action: (r: AuditRow) => void unvoid(r) }]}
            searchPlaceholder="Search reference / party / who…"
            alwaysSearchKeys={["reference", "sourceId", "party", "actorName", "state", "docDate"]}
            headerMenu
            reorderableHeaders
            exportName="Audit Log"
            emptyMessage="No voided or deleted documents."
            loading={rows === null}
            maxHeight="calc(100vh - 260px)"
          />
        </CardContent>
      </Card>
    </div>
  );
}
