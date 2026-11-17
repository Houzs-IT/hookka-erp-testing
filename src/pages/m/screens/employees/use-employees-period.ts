// use-employees-period — the ONE reporting period shared by the Employees sections that follow it (Department Labor,
// Efficiency Overview, Employee Performance, Labor Cost, Department Performance — HK-0125). Kept in the URL (`from`,
// `to`) so refresh and Back keep the place, like the Home dashboard's useDashboardPeriod.
//
// Payroll does NOT use this: it has its own month picker (Phase 6). Overview is fixed to the current month.
// Phase 1 builds the state; no section consumes it yet, so no tab shows a period picker until its data follows it.
import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { todayYmdMYForReads } from "@/lib/staging-today";
import { parseRange, rangeLabel, validateRange, type YmdRange } from "./employees-dates";

export function useEmployeesPeriod(): {
  range: YmdRange;
  label: string;
  today: string;
  setRange: (r: YmdRange) => boolean;
} {
  const [params, setParams] = useSearchParams();
  const today = todayYmdMYForReads();
  const from = params.get("from");
  const to = params.get("to");
  const range = useMemo(() => parseRange(from, to, today), [from, to, today]);

  const setRange = useCallback(
    (r: YmdRange): boolean => {
      if (validateRange(r, today) !== null) return false;
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("from", r.from);
          next.set("to", r.to);
          return next;
        },
        { replace: true },
      );
      return true;
    },
    [setParams, today],
  );

  return { range, label: rangeLabel(range), today, setRange };
}
