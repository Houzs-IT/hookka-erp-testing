// TAB_REGISTRY — the ONLY place a dashboard tab is wired to its screen.
//
// Since 2026-10-17 every /m tab renders the desktop merged-dashboard view
// (tabs/MergedTabs.tsx), so the phone and the desktop show the same figures.
// To add a tab: add a wrapper in MergedTabs.tsx, its key to MOBILE_TABS, and
// register it here. Do not touch DashboardScreen.tsx (the shell) — it renders
// whatever is registered.
import { type ComponentType } from "react";
import type { MobileTabKey } from "./dashboard-m-lib";
import { FinanceTab, OperationsTab, PeopleTab, SalesTab, ServiceTab } from "./tabs/MergedTabs";
import type { DashboardTabProps } from "./types";

export const TAB_REGISTRY: Record<MobileTabKey, ComponentType<DashboardTabProps>> = {
  sales: SalesTab,
  operations: OperationsTab,
  people: PeopleTab,
  service: ServiceTab,
  finance: FinanceTab,
};
