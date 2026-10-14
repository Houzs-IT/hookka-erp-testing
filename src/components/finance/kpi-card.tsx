import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { pctChange } from "@/lib/finance-money";

/**
 * Key-figure cards on top of a finance page (owner 2026-10-14): the figures
 * the page is opened for, before the table. `.fin-kpis` (finance-ui.css) lays
 * them out side by side and wraps them on a phone.
 */
export function FinKpis({ children, label = "Key figures" }: { children: ReactNode; label?: string }) {
  return (
    <section aria-label={label} className="fin-kpis">
      {children}
    </section>
  );
}

/** One key figure. With `onClick` the card is a button (e.g. filters the list below); `active` marks the filter in use. */
export function KpiCard({ label, value, note, tone, onClick, active }: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  /** Colours the figure: good = green, bad = red. */
  tone?: "good" | "bad";
  onClick?: () => void;
  active?: boolean;
}) {
  const body = (
    <>
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">{label}</span>
      <span className={cn("mt-1 block truncate text-base font-bold tabular-nums sm:text-xl", tone === "good" ? "text-[#4F7C3A]" : tone === "bad" ? "text-[#9A3A2D]" : "text-[#1F1D1B]")}>
        {value}
      </span>
      {note && <span className="mt-0.5 block text-xs text-[#6B7280]">{note}</span>}
    </>
  );
  const box = cn("min-w-0 rounded-lg border bg-white px-4 py-3 text-left", active ? "border-[#6B5C32] ring-1 ring-[#6B5C32]" : "border-[#E2DDD8]");
  if (!onClick) return <div className={box}>{body}</div>;
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={cn(box, "cursor-pointer hover:border-[#6B5C32]")}>
      {body}
    </button>
  );
}

/** "▲ 1.5% vs Sep" — green when the move is the good way, red when not; nothing when there is no earlier figure. */
export function KpiChange({ cur, prev, vs, upIsGood = true }: { cur: number; prev: number; vs: string; upIsGood?: boolean }) {
  const p = pctChange(cur, prev);
  if (p === null) return null;
  const flat = Math.abs(p) < 0.05;
  const good = (p > 0) === upIsGood;
  return (
    <span className={flat ? "" : good ? "text-[#4F7C3A]" : "text-[#9A3A2D]"}>
      {flat ? "flat" : `${p > 0 ? "▲" : "▼"} ${Math.abs(p).toFixed(1)}%`} vs {vs}
    </span>
  );
}
