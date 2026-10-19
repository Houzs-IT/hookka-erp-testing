import { useCallback, useMemo, useState } from "react";
import { CC_LEGEND } from "./dashboard-shared-lib";

// Click a legend item to hide / show that series (owner 2026-10-17: "这种类型的
// dashboard 全部要可以开关"). One instance per chart:
//   const t = useSeriesToggle();
//   <Legend {...t.legend} />
//   <Bar dataKey="Plan" hide={t.hide("Plan")} … />
// A hidden series keeps its legend entry, struck through and greyed, so it can
// be clicked back on.
export function useSeriesToggle() {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = useCallback((key: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const hide = useCallback((key: string) => hidden.has(key), [hidden]);
  const legend = useMemo(
    () => ({
      ...CC_LEGEND,
      wrapperStyle: { ...CC_LEGEND.wrapperStyle, cursor: "pointer", userSelect: "none" as const },
      onClick: (d: { dataKey?: unknown }) => toggle(String(d.dataKey)),
      formatter: (value: unknown, entry: { dataKey?: unknown }) => {
        const off = hidden.has(String(entry.dataKey));
        return <span style={{ color: off ? "#C9C4BA" : "#4B5563", textDecoration: off ? "line-through" : undefined }}>{String(value)}</span>;
      },
    }),
    [hidden, toggle],
  );
  return { legend, hide, toggle, hidden };
}
