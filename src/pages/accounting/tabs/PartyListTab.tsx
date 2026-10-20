// ---------------------------------------------------------------------------
// Finance › Debtor List / Creditor List (owner 2026-10-17, Finance v2 「要」).
//
// Everyone who owes us — trade customers and other debtors — or whom we owe —
// suppliers and other creditors — in one list, each with what is outstanding
// (the same figure its aging row shows). Double-click opens the record where
// it is kept: a customer's edit form on Customers, a supplier's page, an other
// party's form on its own page. Read-only here; nothing is deleted — a record
// is set inactive where it is kept.
// ---------------------------------------------------------------------------
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataGrid, type Column } from "@/components/ui/data-grid";
import { useCachedJson } from "@/lib/cached-fetch";
import { formatCurrency } from "@/lib/utils";
import { KpiCards } from "@/components/finance/report-shell";
import { SegmentedChips } from "@/components/finance/segmented-chips";
import { FinanceTitleActions } from "@/components/finance/title-actions";
import { agingTotalSen, customerRows, otherPartyRows, overLimit, supplierRows, type PartyListRow } from "@/lib/party-list";

type Side = "DEBTOR" | "CREDITOR";
type AgingRow = { customerId?: string; supplierId?: string; currentSen: number; days30Sen: number; days60Sen: number; days90Sen: number; over90Sen: number };
type ListResp = { success?: boolean; data?: Record<string, unknown>[] } | Record<string, unknown>[];
const listOf = (r: ListResp | null | undefined): Record<string, unknown>[] => (Array.isArray(r) ? r : r?.data ?? []);

const tag = (label: string, cls: string) => (
  <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{label}</span>
);

export function PartyListTab({ side }: { side: Side }) {
  const navigate = useNavigate();
  const debtor = side === "DEBTOR";
  const otherLabel = debtor ? "Other Debtor" : "Other Creditor";
  const { data: tradeResp } = useCachedJson<ListResp>(debtor ? "/api/customers" : "/api/suppliers");
  const { data: othersResp } = useCachedJson<ListResp>(`/api/accounting/other-parties?type=${side}`);
  const { data: agingResp } = useCachedJson<{ success?: boolean; data?: { ar?: AgingRow[]; ap?: AgingRow[] } }>("/api/accounting/aging");
  const { data: otherAgingResp } = useCachedJson<{ success?: boolean; data?: { bills?: { partyId: string; outstandingSen: number }[] } }>(
    `/api/accounting/other-party-aging?type=${side}`,
  );
  const [show, setShow] = useState<"all" | "trade" | "other">("all");

  const all = useMemo<PartyListRow[]>(() => {
    const owed = new Map<string, number>();
    for (const r of (debtor ? agingResp?.data?.ar : agingResp?.data?.ap) ?? []) {
      owed.set(String((debtor ? r.customerId : r.supplierId) ?? ""), agingTotalSen(r));
    }
    const trade = debtor ? customerRows(listOf(tradeResp), owed) : supplierRows(listOf(tradeResp), owed);
    const other = otherPartyRows(listOf(othersResp), otherAgingResp?.data?.bills ?? []);
    const byName = (a: PartyListRow, b: PartyListRow) => a.name.localeCompare(b.name);
    return [...trade.sort(byName), ...other.sort(byName)];
  }, [debtor, tradeResp, othersResp, agingResp, otherAgingResp]);
  const trade = all.filter((r) => r.kind === "trade");
  const other = all.filter((r) => r.kind === "other");
  const shown = show === "all" ? all : show === "trade" ? trade : other;

  const open = (r: PartyListRow) => {
    if (r.kind === "other") navigate(`/accounting?tab=${debtor ? "odebtor" : "ocreditor"}&edit=${encodeURIComponent(r.id)}`);
    else if (debtor) navigate(`/customers?edit=${encodeURIComponent(r.id)}`);
    else navigate(`/suppliers/${encodeURIComponent(r.id)}`);
  };

  const columns = useMemo<Column<PartyListRow>[]>(() => [
    { key: "code", label: "Code", width: "110px", render: (_v, r) => <span className="font-mono text-xs text-[#6B5C32]">{r.code || "—"}</span> },
    {
      key: "name", label: "Name", width: "260px", noFilter: true,
      render: (_v, r) => (
        <span className="block leading-tight">
          <span className="text-[#1F1D1B]">{r.name}</span>
          {r.contact ? <span className="block text-[11px] text-[#9CA3AF]">PIC {r.contact}</span> : null}
        </span>
      ),
    },
    {
      key: "kind", label: "Type", width: "130px",
      filterAccessor: (r) => (r.kind === "trade" ? "Trade" : otherLabel),
      exportValue: (r) => (r.kind === "trade" ? "Trade" : otherLabel),
      render: (_v, r) => (r.kind === "trade" ? tag("Trade", "bg-[#EEF1F4] text-[#4B5563]") : tag(otherLabel, "bg-[#F4EEE3] text-[#6B5C32]")),
    },
    { key: "termsOrNote", label: debtor ? "Terms / What For" : "Terms / What For", width: "170px", render: (_v, r) => r.termsOrNote || "—" },
    ...(debtor
      ? [{
          key: "limitSen", label: "Credit Limit", width: "130px", align: "right" as const, type: "currency" as const,
          render: (_v: unknown, r: PartyListRow) => (r.limitSen ? <span className="tabular-nums text-[#6B7280]">{formatCurrency(r.limitSen)}</span> : <span className="text-[#C4BDB3]">—</span>),
        }]
      : []),
    {
      key: "outstandingSen", label: "Outstanding", width: "140px", align: "right", type: "currency", total: "sum",
      render: (_v, r) => (r.outstandingSen
        ? <span className={`tabular-nums ${overLimit(r) ? "font-semibold text-[#9A3A2D]" : r.outstandingSen < 0 ? "text-[#27500A]" : "text-[#1F1D1B]"}`} title={overLimit(r) ? "Over the credit limit" : undefined}>{formatCurrency(r.outstandingSen)}</span>
        : <span className="text-[#C4BDB3]">—</span>),
    },
    { key: "phone", label: "Phone", width: "140px", render: (_v, r) => r.phone || "—" },
    { key: "email", label: "Email", width: "220px", render: (_v, r) => (r.email ? <span className="text-[#3E6570]">{r.email}</span> : "—") },
    {
      key: "active", label: "Status", width: "100px",
      filterAccessor: (r) => (r.active ? "Active" : "Inactive"),
      exportValue: (r) => (r.active ? "Active" : "Inactive"),
      render: (_v, r) => (r.active ? tag("Active", "bg-[#E7F0E3] text-[#27500A]") : tag("Inactive", "bg-[#F3F4F6] text-[#6B7280]")),
    },
  ], [debtor, otherLabel]);

  const tradeActive = trade.filter((r) => r.active).length;
  const otherActive = other.filter((r) => r.active).length;
  const totalSen = all.reduce((t, r) => t + r.outstandingSen, 0);
  const loading = !tradeResp || !othersResp || !agingResp;

  return (
    <div className="space-y-4" data-party-list={side}>
      <FinanceTitleActions>
        <Button variant="outline" size="sm" onClick={() => navigate(`/accounting?tab=${debtor ? "odebtor" : "ocreditor"}&new=1`)}>
          + New {otherLabel}
        </Button>
        <Button variant="primary" size="sm" onClick={() => navigate(debtor ? "/customers?new=1" : "/procurement/maintenance?new=1")}>
          + New {debtor ? "Customer" : "Supplier"}
        </Button>
      </FinanceTitleActions>
      <KpiCards
        items={[
          debtor
            ? { label: "Trade customers", value: loading ? "—" : String(tradeActive), note: `${trade.filter(overLimit).length} over credit limit` }
            : { label: "Suppliers", value: loading ? "—" : String(tradeActive), note: `${trade.filter((r) => r.outstandingSen > 0).length} with balances` },
          { label: debtor ? "Other debtors" : "Other creditors", value: loading ? "—" : String(otherActive), note: `${other.filter((r) => r.outstandingSen !== 0).length} with balances` },
          { label: "Total outstanding", value: loading ? "—" : formatCurrency(totalSen), tone: debtor ? "warn" : "err", note: debtor ? "as on Debtor Aging" : "as on Creditor Aging (trade finance not included)" },
        ]}
      />
      <Card>
        <CardContent className="p-0">
          <DataGrid
            columns={columns}
            data={shown}
            keyField="key"
            gridId={debtor ? "accounting-debtor-list" : "accounting-creditor-list"}
            onDoubleClick={open}
            // Right-click: Edit only (owner 2026-10-20 「可以加右键edit 就好」) —
            // the same place a double-click goes.
            contextMenuItems={() => [{ label: "Edit", action: open }]}
            rowClassName={(r) => (r.active ? "" : "opacity-60")}
            headerMenu
            reorderableHeaders
            exportName={debtor ? "Debtor List" : "Creditor List"}
            toolbarStart={
              <SegmentedChips
                options={[
                  { key: "all" as const, label: "All", count: all.length },
                  { key: "trade" as const, label: debtor ? "Trade" : "Suppliers", count: trade.length },
                  { key: "other" as const, label: debtor ? "Other Debtors" : "Other Creditors", count: other.length },
                ]}
                value={show}
                onChange={setShow}
              />
            }
          />
        </CardContent>
      </Card>
      <p className="text-[12px] text-[#9CA3AF]">
        Double-click a row to edit it where it is kept. Set a {debtor ? "customer" : "supplier"} inactive instead of deleting it.
      </p>
    </div>
  );
}
