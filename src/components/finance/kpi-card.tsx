import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { pctChange } from "@/lib/finance-money";

/**
 * Key-figure cards on top of a finance report (owner 2026-10-14): the figures
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

export function KpiCard({ label, value, note, tone }: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  /** Colours the figure: good = green, bad = red. */
  tone?: "good" | "bad";
}) {
  return (
    <div className="min-w-0 rounded-lg border border-[#E2DDD8] bg-white px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">{label}</div>
      <div className={cn("mt-1 truncate text-xl font-bold tabular-nums", tone === "good" ? "text-[#4F7C3A]" : tone === "bad" ? "text-[#9A3A2D]" : "text-[#1F1D1B]")}>
        {value}
      </div>
      {note && <div className="mt-0.5 text-xs text-[#6B7280]">{note}</div>}
    </div>
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
