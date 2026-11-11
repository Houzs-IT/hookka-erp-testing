// Helper / 杂工 tag (owner 2026-11-11). A helper assists others and scans no
// completions of their own: no personal efficiency (shown as "—") and no
// efficiency allowance. Every screen that lists people marks them the same way.
export function HelperTag({ className = "" }: { className?: string }) {
  return (
    <span
      title="Helper — assists others; no personal efficiency, no efficiency allowance"
      className={`ml-1.5 inline-flex items-center rounded-full bg-[#F1ECE4] px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-[#6B5C32] align-middle ${className}`}
    >
      Helper
    </span>
  );
}
