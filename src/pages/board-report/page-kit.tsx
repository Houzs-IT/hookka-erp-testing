// Board Report — the A4 page frame and the small table / tile pieces every
// page uses. One <BrPage> = one printed A4 portrait page (board-report.css).
import type { ReactNode } from "react";
import { rm, C } from "./format";

export function BrPage({ title, kicker, month, children, className = "" }: { title: string; kicker?: string; month: string; children: ReactNode; className?: string }) {
  return (
    <section className={`brp-page ${className}`}>
      <header className="brp-head">
        <div>
          {kicker && <div className="brp-kicker">{kicker}</div>}
          <h2>{title}</h2>
        </div>
        <div className="brp-head-month">{month}</div>
      </header>
      <div className="brp-body">{children}</div>
      <footer className="brp-foot">
        <span>Hookka · Monthly board report · {month} · figures live from Hookka ERP</span>
        <span className="brp-pageno" />
      </footer>
    </section>
  );
}

/** A section whose source could not be read: says why, never shows zeros. */
export function Unavailable({ error }: { error: string }) {
  return (
    <div className="brp-unavailable">
      <strong>Not available.</strong> {error}
      <div className="brp-small">This is a load failure, not a zero. Reload the report, or open the source page to check.</div>
    </div>
  );
}


/** Money cell; negatives red. */
export function Money({ v, strong }: { v: number | null | undefined; strong?: boolean }) {
  const neg = typeof v === "number" && v < 0;
  return <span style={{ color: neg ? C.red : undefined, fontWeight: strong ? 700 : undefined }}>{rm(v)}</span>;
}

/** Change % coloured: good = green. `invert` for costs (up is bad). */
export function Delta({ p, invert }: { p: number | null; invert?: boolean }) {
  if (p === null) return <span className="brp-muted">-</span>;
  const good = invert ? p <= 0 : p >= 0;
  return <span style={{ color: good ? C.green : C.red }}>{p >= 0 ? "+" : ""}{p.toFixed(1)}%</span>;
}

export function Tile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "navy" | "gold" | "green" | "red" }) {
  return (
    <div className={`brp-tile ${tone ? `tone-${tone}` : ""}`}>
      <div className="lb">{label}</div>
      <div className="vl">{value}</div>
      {sub && <div className="sb">{sub}</div>}
    </div>
  );
}


/** A chart's title: its conclusion as the headline, what is plotted as the small
 *  label under it (owner 2026-11-19, investment-bank standard). Falls back to the
 *  plain label when there is nothing to conclude (no actual month yet). */
export function ChartTitle({ action, label }: { action: string | null | undefined; label: string }) {
  if (!action) return <h3>{label}</h3>;
  return (
    <div className="brp-ctitle">
      <h3 className="brp-action">{action}</h3>
      <div className="brp-clabel">{label}</div>
    </div>
  );
}
