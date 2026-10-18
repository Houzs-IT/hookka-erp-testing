import { useMemo } from "react";
import { useCachedJson } from "@/lib/cached-fetch";
import { formatCurrency } from "@/lib/utils";
import { parseDashPeriod } from "../../api/lib/dash-period";

// Layer 2 behind the Command Center KPI tiles (owner 2026-10-17: "点到那个数据
// 都可以深挖"). Each list is the rows the tile adds up, read on demand:
//   Sales       — confirmed SOs (not DRAFT / CANCELLED / ON_HOLD) by SO date
//   Invoices    — invoices (not CANCELLED) by invoice date
//   Outstanding — confirmed value minus delivered value, by status (live)
type So = { id: string; companySOId?: string | null; companySO?: string | null; customerName?: string | null; companySODate?: string | null; createdAt?: string | null; status: string; totalSen?: number | null };
type Inv = { id: string; invoiceNo?: string | null; customerName?: string | null; invoiceDate?: string | null; status: string; totalSen?: number | null };

const rm = (sen: number) => formatCurrency(Math.round(sen));

function Table({ head, rows, total }: { head: string[]; rows: (string | number)[][]; total?: number }) {
  return (
    <div className="max-h-[60vh] overflow-y-auto">
      <table className="w-full text-[12.5px]">
        <thead><tr className="sticky top-0 bg-white text-left text-[10.5px] uppercase tracking-wide text-[#9CA3AF] shadow-[inset_0_-1px_0_#E2DDD8]">
          {head.map((h, i) => <th key={h} className={`py-1.5 ${i === head.length - 1 ? "text-right" : ""}`}>{h}</th>)}
        </tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-[#F0ECE6]">
              {r.map((c, j) => <td key={j} className={`py-1.5 ${j === r.length - 1 ? "text-right tabular-nums font-semibold" : j === 0 ? "font-mono" : "text-[#6B7280]"}`}>{c}</td>)}
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={head.length} className="py-6 text-center text-[#9CA3AF]">Nothing here.</td></tr>}
        </tbody>
        {total != null && rows.length > 0 && (
          <tfoot><tr className="font-semibold"><td colSpan={head.length - 1} className="py-1.5">Total · {rows.length}</td><td className="py-1.5 text-right tabular-nums">{rm(total)}</td></tr></tfoot>
        )}
      </table>
    </div>
  );
}

export function SoListDrill({ period, kind }: { period: string; kind: "sales" }) {
  const { data } = useCachedJson<{ data?: So[] }>("/api/sales-orders");
  const dp = useMemo(() => parseDashPeriod(period), [period]);
  const list = useMemo(() => {
    const all = data?.data ?? [];
    void kind;
    return all.filter((o) => !["DRAFT", "CANCELLED", "ON_HOLD"].includes(o.status) && dp.inYm(o.companySODate ?? o.createdAt)).sort((a, b) => String(b.companySODate ?? b.createdAt).localeCompare(String(a.companySODate ?? a.createdAt)));
  }, [data, dp, kind]);
  if (!data) return <p className="py-6 text-center text-sm text-[#9CA3AF]">Loading…</p>;
  return (
    <>
      <Table
        head={["SO", "Customer", "SO date", "Status", "Total"]}
        rows={list.map((o) => [o.companySOId ?? o.companySO ?? o.id, o.customerName ?? "—", String(o.companySODate ?? o.createdAt ?? "").slice(0, 10), o.status, rm(o.totalSen ?? 0)])}
        total={list.reduce((a, o) => a + (o.totalSen ?? 0), 0)}
      />
      <p className="mt-2 text-[11px] text-[#9CA3AF]">
        The order list leaves out service orders; the Sales tile includes them, so the tile can be a little higher.
      </p>
    </>
  );
}

export function InvoiceListDrill({ period }: { period: string }) {
  const { data } = useCachedJson<{ data?: Inv[] }>("/api/invoices");
  const dp = useMemo(() => parseDashPeriod(period), [period]);
  const list = useMemo(
    () => (data?.data ?? []).filter((i) => i.status !== "CANCELLED" && dp.inYm(i.invoiceDate)).sort((a, b) => String(b.invoiceDate).localeCompare(String(a.invoiceDate))),
    [data, dp],
  );
  if (!data) return <p className="py-6 text-center text-sm text-[#9CA3AF]">Loading…</p>;
  return (
    <Table
      head={["Invoice", "Customer", "Date", "Status", "Total"]}
      rows={list.map((i) => [i.invoiceNo ?? i.id, i.customerName ?? "—", String(i.invoiceDate ?? "").slice(0, 10), i.status, rm(i.totalSen ?? 0)])}
      total={list.reduce((a, i) => a + (i.totalSen ?? 0), 0)}
    />
  );
}

export function PendingDeliveryDrill({ pendingSen, dispatchSen, transitSen }: { pendingSen: number; dispatchSen: number; transitSen: number }) {
  return (
    <Table
      head={["Stage", "What it is", "Value"]}
      rows={[
        ["Made, not on a DO", "finished, waiting for a delivery order", rm(pendingSen)],
        ["On a draft DO", "delivery order raised, not dispatched", rm(dispatchSen)],
        ["On the road", "dispatched / in transit, not yet delivered", rm(transitSen)],
      ]}
      total={pendingSen + dispatchSen + transitSen}
    />
  );
}

/**
 * Outstanding is not a list of orders: it is all confirmed order value minus
 * the value already delivered (GET /api/sales-orders/stats). Show that
 * arithmetic, by status, so the popup adds up to the tile exactly.
 */
export function OutstandingDrill() {
  const { data } = useCachedJson<{ csRevenueSen?: number; deliveredItemsSen?: number; outstandingItemsSen?: number; revenueByStatus?: Record<string, number>; byStatus?: Record<string, number> }>("/api/sales-orders/stats");
  if (!data) return <p className="py-6 text-center text-sm text-[#9CA3AF]">Loading…</p>;
  const order = ["CONFIRMED", "IN_PRODUCTION", "READY_TO_SHIP", "SHIPPED", "DELIVERED", "INVOICED", "CLOSED"];
  const rows: (string | number)[][] = order
    .filter((s) => (data.revenueByStatus?.[s] ?? 0) > 0)
    .map((s) => [s, `${data.byStatus?.[s] ?? 0} orders`, rm(data.revenueByStatus?.[s] ?? 0)]);
  rows.push(["= Confirmed value", "all of the above", rm(data.csRevenueSen ?? 0)]);
  rows.push(["− Delivered value", "items already delivered", `− ${rm(data.deliveredItemsSen ?? 0)}`]);
  return (
    <>
      <Table head={["", "", "Value"]} rows={rows} />
      <p className="mt-2 text-right text-sm font-semibold text-[#1F1D1B]">Outstanding = {rm(data.outstandingItemsSen ?? 0)}</p>
      <p className="mt-1 text-[11px] text-[#9CA3AF]">Live, whatever the period. Every confirmed order ever, less what has been delivered — what we still owe customers in goods.</p>
    </>
  );
}
