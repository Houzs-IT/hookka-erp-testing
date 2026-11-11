// Data layer of the /m Home dashboard (Sales view). One hook, the desktop's own
// endpoints, the desktop's own response shapes (dashboard-b/index.tsx and
// dashboards/SalesOrdersView.tsx). Each fetch is skipped (URL = null) when the
// signed-in user's client permissions say the section is not theirs. That is a
// UX gate only: the server remains the authority, and the gaps in it are the
// separate backend remediation task (docs/RBAC-REMEDIATION.md).
import { useCachedJson, type CachedFetchFailure } from "@/lib/cached-fetch";
import type { RevenueSplitResp } from "@/pages/dashboard-b/revenue-split";
import type { StateKpis } from "@/pages/dashboards/dashboard-widgets-lib";
import type { Aov, MonthAov, StateCatRow } from "./home-lib";

type Slice = {
  totalSen: number; customerCount: number; largestName: string | null; largestPct: number | null; largestSen: number;
  top10Pct: number | null; top10Sen: number;
};

export type Overview = {
  success?: boolean;
  salesThisMonthSen?: number;
  invoicesThisMonthSen?: number;
  deliveredOfMonthOrdersSen?: number;
  aovByCustomer?: Aov[];
  aovCompany?: { bedframeAvgSen: number; bedframeUnits: number; sofaAvgSen: number; sofaSets: number; totalSen: number };
  customerConcentration?: { all: Slice; bedframe: Slice; sofa: Slice; shownCount: number };
  aovMonthlyByCustomer?: Record<string, MonthAov[]>;
  topSellers?: {
    BEDFRAME: { productCode: string; productName?: string; qtySold: number; valueSen: number }[];
    SOFA: { model: string; setsSold: number; valueSen: number }[];
  };
  topSellersByCustomer?: {
    BEDFRAME: Record<string, { customer: string; qty: number; valueSen: number }[]>;
    SOFA: Record<string, { customer: string; sets: number; valueSen: number }[]>;
  };
  monthlyRevenue?: { month: string; salesOrderSen: number; invoiceSen: number; productionSen: number }[];
  weeklyRevenue?: { week: string; salesOrderSen: number; invoiceSen: number; productionSen: number }[];
  stateKpis?: StateKpis | null;
};

export type SoStats = {
  csRevenueSen?: number; deliveredItemsSen?: number; outstandingItemsSen?: number;
  byStatus?: Record<string, number>; revenueByStatus?: Record<string, number>;
};
export type PendingValue = { pendingDeliveryValueSen?: number };
export type DoStats = { valueByStatus?: Record<string, number> };
export type ProtoFeed = {
  success?: boolean;
  meta?: { monthsWithSales?: string[]; months?: string[] };
  sales?: { byDay: { date: string }[]; byStateCategory: StateCatRow[] };
};
export type ForecastResp = { data?: { months?: Record<string, { salesSen?: number }> } };
export type InvoiceRow = { id?: string; invoiceNo?: string | null; customerName?: string | null; invoiceDate?: string | null; status: string; totalSen?: number | null };
export type InvoicesResp = { data?: InvoiceRow[] };

/** What this user may read, from usePermissions (client-side; server still decides). */
export type SalesAccess = {
  /** The view itself: sales-orders:read, or a tab-restricted role whose tabs include sales. */
  view: boolean;
  /** invoices:read (D1: Invoices KPI, invoice series and invoice drill lock without it). */
  invoices: boolean;
  /** accounting:read (forecast target). */
  accounting: boolean;
  /** delivery-orders:read, or the sales tab (the server's requireReadOrDashboardTab). */
  delivery: boolean;
};

type Slot<T> = { data: T | null; loading: boolean; failure: CachedFetchFailure | null; error: string | null };

export function useSalesData(periodKey: string, access: SalesAccess) {
  const proto = useCachedJson<ProtoFeed>(access.view ? "/api/dashboard/prototype" : null);
  const overview = useCachedJson<Overview>(access.view ? `/api/dashboard/overview?period=${periodKey}` : null);
  const split = useCachedJson<RevenueSplitResp>(access.view ? `/api/dashboard/overview/revenue-split?period=${periodKey}` : null);
  const soStats = useCachedJson<SoStats>(access.view ? "/api/sales-orders/stats" : null);
  const pending = useCachedJson<PendingValue>(access.view && access.delivery ? "/api/delivery-orders/pending-value" : null);
  const doStats = useCachedJson<DoStats>(access.view && access.delivery ? "/api/delivery-orders/stats" : null);
  const invoices = useCachedJson<InvoicesResp>(access.view && access.invoices ? "/api/invoices" : null);
  const forecast = useCachedJson<ForecastResp>(access.view && access.accounting ? "/api/accounting/forecast" : null);

  const refreshers = [proto, overview, split, soStats, pending, doStats, invoices, forecast].map((r) => r.refresh);
  const refresh = () => { refreshers.forEach((f) => f()); };

  const slot = <T,>(r: { data: T | null | undefined; loading: boolean; failure?: CachedFetchFailure | null; error?: string | null }): Slot<T> => ({
    data: r.data ?? null, loading: r.loading, failure: r.failure ?? null, error: r.error ?? null,
  });
  return {
    proto: slot(proto), overview: slot(overview), split: slot(split), soStats: slot(soStats), pending: slot(pending),
    doStats: slot(doStats), invoices: slot(invoices), forecast: slot(forecast), refresh,
  };
}
export type SalesData = ReturnType<typeof useSalesData>;
