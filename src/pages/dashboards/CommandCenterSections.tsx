import DashboardBPage, { type CommandCenterSection } from "../dashboard-b";
import { widgetPeriod, type Period } from "./dashboard-shared-lib";

/**
 * Merged dashboard (owner 2026-10-17): "the old Overview UI is the one I'm
 * happiest with". These are the Command Center (/dashboard) cards themselves,
 * not copies: same code, same look, same numbers, driven by this page's
 * period picker.
 */
export function CommandCenterSections({
  period, sections, onPeriodChange,
}: { period: Period; sections: readonly CommandCenterSection[]; onPeriodChange?: (p: Period) => void }) {
  // A picked day reaches the cards that can show one (Department Revenue);
  // a click on its chart picks a day of the same month, or clears it.
  const onPickDay = onPeriodChange
    ? (day: string | undefined) => onPeriodChange({ mode: "monthly", month: period.month, day })
    : undefined;
  return <DashboardBPage embed={{ period: widgetPeriod(period), sections, day: period.day, onPickDay }} />;
}
