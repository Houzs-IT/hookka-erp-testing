// A finance tab's buttons on the page's title row (finance v2, owner
// 2026-10-16: "the title and the button row share one line"). The accounting
// page renders the slot inside FinancePageTitle and provides it through
// FinanceTitleSlotContext (./title-slot); a tab wraps its buttons in
// <FinanceTitleActions>. Outside a slot (the tab used elsewhere) the buttons
// stay where they are, right-aligned.
import { useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FinanceTitleSlotContext } from "./title-slot";

export function FinanceTitleActions({ children }: { children: ReactNode }) {
  const slot = useContext(FinanceTitleSlotContext);
  if (slot) return createPortal(children, slot);
  return <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>;
}
