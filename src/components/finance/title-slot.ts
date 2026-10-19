// The title row's button slot (finance v2): the accounting page provides the
// element rendered inside FinancePageTitle; FinanceTitleActions portals into
// it. Kept apart from the component file so hot reload stays component-only.
import { createContext } from "react";

export const FinanceTitleSlotContext = createContext<HTMLElement | null>(null);
