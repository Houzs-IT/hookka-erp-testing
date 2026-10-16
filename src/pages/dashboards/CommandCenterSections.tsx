import DashboardBPage, { type CommandCenterSection } from "../dashboard-b";
import { widgetPeriod, type Period } from "./dashboard-shared-lib";

/**
 * Merged dashboard (owner 2026-10-17): "the old Overview UI is the one I'm
 * happiest with". These are the Command Center (/dashboard) cards themselves,
 * not copies: same code, same look, same numbers, driven by this page's
 * period picker.
 */
export function CommandCenterSections({ period, sections }: { period: Period; sections: readonly CommandCenterSection[] }) {
  return <DashboardBPage embed={{ period: widgetPeriod(period), sections }} />;
}
