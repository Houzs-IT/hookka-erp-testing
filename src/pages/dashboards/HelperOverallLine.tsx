// "Overall xx% (incl. helpers X h)" — the small line under a department or
// factory efficiency figure (owner 2026-11-11). The main figure is production
// efficiency (helpers left out); this line names the figure with them in, and
// only appears when helpers clocked time in the slice.
export function HelperOverallLine({ overallPct, helperMinutes, className = "" }: {
  overallPct: number | null;
  helperMinutes: number;
  className?: string;
}) {
  if (!(helperMinutes > 0) || overallPct == null) return null;
  const h = Math.round((helperMinutes / 60) * 10) / 10;
  return (
    <p className={`text-[11px] leading-tight text-[#6B7280] ${className}`}>
      Overall {overallPct.toFixed(1)}% (incl. helpers {h} h)
    </p>
  );
}
