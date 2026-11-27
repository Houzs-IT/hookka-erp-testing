// ===========================================================================
// Inventory — what the three detail pages share: the page frame (header with
// a back arrow on its own, none as the tablet's right pane), the stock
// breakdown read, its notices, and its load states. The breakdown's own 404
// text is shown verbatim; any other failure says "couldn't load" with a
// retry — never "no data" (class C15).
// ===========================================================================
import type { ReactNode } from "react";
import { panelNotices } from "@/lib/stock-breakdown";
import { MobileHeader } from "../../components";
import { useContainerLayout } from "../../lib/responsive-layout";
import { BREAKDOWN_404 } from "../../lib/inventory-lib";
import { TplStyles } from "../threepl/tpl-kit";
import { useBack, type Breakdown } from "./inv-data";
import { Notice, Skeletons, StateLine } from "./inv-kit";
import { X } from "./inv-style";

/** The detail page frame. `dockPad` leaves room for a bottom action bar. */
export function DetailFrame({ head, children, dockPad = false, trailing }: { head: string; children: ReactNode; dockPad?: boolean; trailing?: ReactNode }) {
  const { pane } = useContainerLayout();
  const back = useBack();
  return (
    <div style={{ minHeight: "100%", background: X.bg, color: X.ink }}>
      <TplStyles />
      <MobileHeader title={head} onBack={pane === "detail" ? undefined : back} trailing={trailing} />
      <div
        style={{
          padding: `6px 16px ${dockPad ? 104 : 24}px`, width: "100%", maxWidth: 760, margin: "0 auto", boxSizing: "border-box",
          display: "grid", alignContent: "start", gridTemplateColumns: "minmax(0,1fr)", gap: 10,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * The breakdown's load state, or null when its sections can render.
 * 404 = the server's own explanation; 403 = no access; anything else = retry.
 */
export function BreakdownGate({ b }: { b: Breakdown }) {
  if (b.data) return null;
  if (b.failure?.kind === "notFound") return <Notice tone="info">{BREAKDOWN_404}</Notice>;
  if (b.failure?.status === 403) return <StateLine tone="lock">Your role can't read the stock breakdown. Ask an admin.</StateLine>;
  if (b.failure) return <StateLine tone="bad" retry={b.refresh}>{`Could not load the breakdown. ${b.failure.message}`}</StateLine>;
  if (b.loading) return <Skeletons n={3} h={84} pad="0" />;
  return <StateLine retry={b.refresh}>Could not load the breakdown.</StateLine>;
}

/**
 * The server's notices, in its own order (qty note, reconciliation, ledger vs
 * on hand). The valuation note is left out with the values it explains — no
 * money is shown on mobile (owner S-2).
 */
export function ServerNotices({ b }: { b: Breakdown }) {
  if (!b.data) return null;
  const list = panelNotices(b.data.header).filter((n) => n.key !== "valuation");
  return (
    <>
      {list.map((n) => (
        <Notice key={n.key} tone={n.tone === "warn" ? "warn" : "info"}>{n.text}</Notice>
      ))}
    </>
  );
}
