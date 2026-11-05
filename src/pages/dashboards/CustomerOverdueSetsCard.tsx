import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CustomerOverdueSets, OverdueSetsOrder, OverdueSetsSummary } from "@/api/lib/customer-overdue-sets";
import { fmtN } from "./dashboard-shared-lib";
import { OverdueOrderProgress } from "./OverdueOrderProgress";

export interface CustomerOverdueSetsCardProps {
  summary: OverdueSetsSummary | null | undefined;
  isLoading: boolean;
  unavailableReason?: string;
}

function LatePill({ days }: { days: number }) {
  return (
    <span className="inline-flex items-center rounded-full bg-[#FBE7E3] px-2 py-0.5 text-[11px] font-semibold text-[#9A3A2D] whitespace-nowrap">
      {fmtN(days)} d late
    </span>
  );
}

function CustomerRow({ customer, asOf }: { customer: CustomerOverdueSets; asOf: string }) {
  const oldestDaysLate = customer.orders.reduce((most, order) => Math.max(most, order.daysLate), 0);
  return (
    <details className="group border-b border-[#E2DDD8] last:border-b-0">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 px-4 py-2.5 hover:bg-[#F7F5F3] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#6B5C32] [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-4 w-4 shrink-0 text-[#9CA3AF] transition-transform group-open:rotate-90" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-[#1F1D1B]">{customer.customerName}</p>
          <p className="truncate text-xs text-[#6B7280]">
            {fmtN(customer.orders.length)} {customer.orders.length === 1 ? "order" : "orders"} · oldest due {customer.oldestDueDate}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-3">
          <LatePill days={oldestDaysLate} />
          <p className="text-right text-base font-bold tabular-nums text-[#9A3A2D]">
            {fmtN(customer.overdueSets)} <span className="text-xs font-medium text-[#6B7280]">sets</span>
          </p>
        </div>
      </summary>
      <ul className="bg-[#FAF9F7] px-4 py-1" aria-label={`Overdue orders for ${customer.customerName} as of ${asOf}`}>
        {customer.orders.map((order) => <OrderRow key={order.soId} order={order} />)}
      </ul>
    </details>
  );
}

function OrderRow({ order }: { order: OverdueSetsOrder }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <li className="border-b border-[#EFEBE5] text-xs last:border-b-0">
      <details className="group/order" onToggle={(event) => setIsOpen(event.currentTarget.open)}>
        <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 py-2 hover:bg-[#F2EFEA] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#6B5C32] sm:min-h-0 [&::-webkit-details-marker]:hidden">
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#9CA3AF] transition-transform group-open/order:rotate-90" aria-hidden="true" />
          <span className="font-mono text-[#6B5C32]">{order.soNo ?? "(no number)"}</span>
          <span className="text-[#6B7280]">due {order.dueDate}</span>
          <LatePill days={order.daysLate} />
          <span className="ml-auto tabular-nums text-[#1F1D1B]">
            <span className="font-semibold">{fmtN(order.remainingSets)}</span> of {fmtN(order.orderedSets)} sets to deliver
          </span>
        </summary>
        {isOpen && (
          <div className="pb-2 sm:pl-6">
            <OverdueOrderProgress soId={order.soId} soNo={order.soNo} />
          </div>
        )}
      </details>
    </li>
  );
}

function CardMessage({ text }: { text: string }) {
  return <p className="px-4 py-6 text-center text-sm text-[#6B7280]">{text}</p>;
}

export function CustomerOverdueSetsCard({ summary, isLoading, unavailableReason }: CustomerOverdueSetsCardProps) {
  const body = (() => {
    if (summary) {
      return summary.customers.length === 0
        ? <CardMessage text="Nothing overdue. Every order past its delivery date has been fully delivered." />
        : summary.customers.map((customer) => <CustomerRow key={customer.customerId ?? customer.customerName} customer={customer} asOf={summary.asOf} />);
    }
    if (isLoading) return <CardMessage text="Loading overdue sets…" />;
    return <CardMessage text={`Overdue sets could not be loaded${unavailableReason ? ` (${unavailableReason})` : ""}. This is not a zero.`} />;
  })();

  return (
    <Card id="sales-overdue-sets" className="scroll-mt-[var(--dash-sticky-top,0px)]">
      <CardHeader className="pb-3">
        <CardTitle>Customer overdue sets{summary ? ` · ${fmtN(summary.totalSets)}` : ""}</CardTitle>
        <p className="mt-0.5 text-xs text-[#6B7280]">
          Sets not yet delivered on orders past the customer's delivery date, by customer. Tap a customer for its orders, then an order to see where each item is now.
          {summary && summary.ordersWithoutCustomerDate > 0 && (
            <span className="text-[#9C6F1E]"> {fmtN(summary.ordersWithoutCustomerDate)} {summary.ordersWithoutCustomerDate === 1 ? "order has" : "orders have"} no delivery date and {summary.ordersWithoutCustomerDate === 1 ? "is" : "are"} not counted.</span>
          )}
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-[480px] overflow-y-auto border-t border-[#E2DDD8]">{body}</div>
      </CardContent>
    </Card>
  );
}
