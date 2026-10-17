// ---------------------------------------------------------------------------
// use-fiscal-years.ts — the financial years from GET /api/accounting/
// fiscal-years (finance backlog item 9): each year's months and status, the
// year end and its changes, and whether this user may change the year end.
// The reports build their Quarter / Financial Year picks from it; Settings
// shows it. `reloadKey` re-reads after a change.
// ---------------------------------------------------------------------------
import { useEffect, useState } from "react";
import type { FyPeriod } from "@/lib/fiscal-year";

export type FiscalYearRow = FyPeriod & { status: "closed" | "reopened" | "current" | "future" | "open" };
export type FiscalYears = {
  fyeMonth: number;
  currentFyeMonth: number;
  changes: { from: string; to: string }[];
  years: FiscalYearRow[];
  canChangeYearEnd: boolean;
  /** Close Year (accounting:create) / Reopen (Super Admin) — item 9 part B. */
  canCloseYear?: boolean;
  canReopenYear?: boolean;
};

export function useFiscalYears(reloadKey = 0): FiscalYears | null {
  const [data, setData] = useState<FiscalYears | null>(null);
  useEffect(() => {
    let stale = false;
    fetch("/api/accounting/fiscal-years")
      .then((r) => r.json() as Promise<{ success?: boolean; data?: FiscalYears }>)
      .then((j) => { if (!stale && j?.success && j.data) setData(j.data); })
      .catch(() => {});
    return () => { stale = true; };
  }, [reloadKey]);
  return data;
}
