import { levelNames } from "@/lib/finance-nav";

/**
 * How much of a report to show (owner 2026-10-14): Summary · Groups · … · All
 * lines, in place of the old L1–L4 buttons. Level n = groups deeper than n
 * folded, the same rule the buttons had; the hover still says the level.
 */
export function LevelPicker({ max, level, onPick }: { max: number; level: number | null; onPick: (level: number) => void }) {
  return (
    <div role="group" aria-label="Detail level" className="inline-flex overflow-hidden rounded-md border border-[#E2DDD8] bg-white text-sm">
      {levelNames(max).map((name, i) => {
        const L = i + 1;
        return (
          <button
            key={L}
            type="button"
            aria-pressed={level === L}
            title={`Level ${L}`}
            onClick={() => onPick(L)}
            className={`cursor-pointer whitespace-nowrap px-3 py-1.5 ${i > 0 ? "border-l border-[#E2DDD8]" : ""} ${level === L ? "bg-[#6B5C32] text-white" : "text-[#4B5563] hover:bg-[#F0ECE9]"}`}
          >
            {name}
          </button>
        );
      })}
    </div>
  );
}
