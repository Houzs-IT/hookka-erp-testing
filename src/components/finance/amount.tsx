import { cn } from "@/lib/utils";
import { fmtAmount, isNegativeAmount } from "@/lib/finance-money";

/**
 * An amount on a finance page (owner 2026-10-14): 1,234.00, a negative as
 * (1,234.00) in red, "–" for zero, figures lined up digit under digit.
 * `red={false}` keeps the surrounding text colour — for a total on a dark band,
 * where red would not read.
 */
export function Amount({ sen, zero, red = true, className }: { sen: number; zero?: string; red?: boolean; className?: string }) {
  return (
    <span className={cn("tabular-nums", red && isNegativeAmount(sen) && "text-[#9A3A2D]", className)}>
      {fmtAmount(sen, { zero })}
    </span>
  );
}
