// Joined filter chips (finance v2, owner 2026-10-16): All · Draft 2 · … — the
// one that is on is gold, a count follows the label quietly (none when 0).
export function SegmentedChips<K extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: K; label: string; count?: number }[];
  value: K;
  onChange: (k: K) => void;
}) {
  return (
    <div className="inline-flex flex-wrap overflow-hidden rounded-lg border border-[#E2DDD8] bg-white" role="tablist">
      {options.map((o, i) => {
        const on = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.key)}
            className={`h-[34px] whitespace-nowrap px-3 text-[13px] font-semibold transition-colors ${i > 0 ? "border-l border-[#E2DDD8]" : ""} ${on ? "bg-[#6B5C32] text-white" : "text-[#374151] hover:bg-[#FAF8F5]"}`}
          >
            {o.label}
            {o.count ? <span className="ml-1.5 text-[11px] tabular-nums opacity-70">{o.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
