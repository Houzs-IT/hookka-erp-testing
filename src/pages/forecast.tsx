// ---------------------------------------------------------------------------
// Forecast P&L (owner 2026-07-29) — a pure PLANNING page, zero contact with
// the books: each month's projected sales, every P&L line as RM or a % of
// sales, saved to kv `forecast_pnl` (PUT /forecast).
//
// Since 2026-11-11 the page IS the Monthly P&L's Edit forecast (owner, on this
// page's separate actual-purchase rows: 「这个actual purchase 会confuse」
// 「这个forecast P&L 就align with montly report 那个的功能就好不就行了？就是两边都
// 应该是一样的view等等」): the same editor, src/pages/accounting/
// monthly-pl-forecast-editor.tsx — each month's Actual beside its Forecast in
// the P&L's own layout, the financial year stepped as on the Monthly P&L.
// Nothing to go back to here, so no Done.
// ---------------------------------------------------------------------------
import { useMemo, useState } from "react";
import { TrendingUp } from "lucide-react";
import { FinancePageTitle } from "@/components/finance/page-title";
import { MonthlyPlForecastEditor } from "@/pages/accounting/monthly-pl-forecast-editor";
import { monthOptions } from "@/lib/finance-reports";
import { todayYmdMY } from "@/lib/utils";

export default function ForecastPage() {
  const thisMonth = todayYmdMY().slice(0, 7);
  const [anchor, setAnchor] = useState(thisMonth);
  // The months the Monthly P&L steps through; each stands for its financial year.
  const periodOptions = useMemo(() => monthOptions(thisMonth, 18), [thisMonth]);
  return (
    <div className="space-y-4 p-1" data-fin-ui>
      <FinancePageTitle
        title="Forecast P&L"
        icon={<TrendingUp className="h-5 w-5 text-[#6B5C32]" />}
        explain="Planning only — nothing here touches the books. The same sheet as the Monthly P&L's Edit forecast: each month's Actual beside its Forecast. Key the Forecast as RM or a % of that month's sales; ▸ opens customers, suppliers or departments; a new month starts with the previous month's percentages; Save keeps it for the Monthly P&L, Cash Flow and the Dashboard."
      />
      <MonthlyPlForecastEditor anchor={anchor} period={{ options: periodOptions, onChange: setAnchor }} frameTitle="Forecast P&L (Overall)" />
    </div>
  );
}
