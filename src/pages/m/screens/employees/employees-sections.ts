// employees-sections.ts — the nine Employees sections (order of Employees 3.dc.html) and the map from each section to the
// EXISTING data source it still shows in Phase 1. Kept apart from EmployeesRoute.tsx so that file only exports a component.
import { employeesConfig } from "../../config/modules";
import type { ModuleConfig } from "../../config/types";

/** The nine sections, in the order of the approved HTML pill bar. `tab` = the existing data source's sub-tab key. */
export const EMPLOYEES_SECTIONS = [
  { key: "overview", label: "Overview", tab: null },
  { key: "working-hours", label: "Working Hours", tab: "hours" },
  { key: "attendance", label: "Attendance", tab: "attendance" },
  { key: "labor-cost", label: "Labor Cost", tab: "labrev" },
  { key: "efficiency", label: "Efficiency Overview", tab: "efficiency" },
  { key: "department-labor", label: "Department Labor", tab: "deptlabor" },
  { key: "employee-performance", label: "Employee Performance", tab: "emp-perf" },
  { key: "department-performance", label: "Department Performance", tab: "dept-perf" },
  { key: "payroll", label: "Payroll", tab: "payroll" },
] as const;

export type EmployeesSectionKey = (typeof EMPLOYEES_SECTIONS)[number]["key"] | "employee-master";

// Phase 1 keeps landing on Working Hours (the first tab the screen always opened on) because Overview is still a
// placeholder; Phase 3 switches the default to "overview", the design's default pill.
export const DEFAULT_SECTION: EmployeesSectionKey = "working-hours";
export const MASTER_TAB = "directory";

/** Pure: a `?section=` value → a known section (unknown / missing → DEFAULT_SECTION). */
export function resolveSection(raw: string | null): EmployeesSectionKey {
  if (raw === "employee-master") return "employee-master";
  return EMPLOYEES_SECTIONS.some((s) => s.key === raw) ? (raw as EmployeesSectionKey) : DEFAULT_SECTION;
}

/** The existing config narrowed to ONE data source, so the generic list shows just that section. Cached: stable identity. */
const sectionConfigs = new Map<string, ModuleConfig>();
export function sectionConfig(tab: string): ModuleConfig | null {
  const hit = sectionConfigs.get(tab);
  if (hit) return hit;
  const source = employeesConfig.sources.find((s) => s.subTabs.some((t) => t.key === tab));
  if (!source) return null;
  const cfg: ModuleConfig = { ...employeesConfig, sources: [source] };
  sectionConfigs.set(tab, cfg);
  return cfg;
}

