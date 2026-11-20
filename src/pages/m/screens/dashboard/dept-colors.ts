// Department colours for the /m dashboards, from the SAME source as Settings → Department
// Configuration (src/pages/settings/index.tsx): the server key `settings-departments` read
// through GET /api/kv-config/settings-departments (open read, authenticated). Colours are whatever
// the owner keyed there; this is never a second mapping.
//
// Only when that key is empty or the call failed does Settings itself fall back to its
// `defaultDepartments` — those same 8 code/colour pairs are used here, so the phone shows what
// Settings shows. (Not src/lib/mock-data.ts.) A code absent from the configuration gets the neutral.
import { useCallback } from "react";
import { useCachedJson } from "@/lib/cached-fetch";

type DeptCfg = { code?: string; color?: string };

/** Mirror of `defaultDepartments` in src/pages/settings/index.tsx (fallback only). */
const SETTINGS_DEFAULT_COLORS: Record<string, string> = {
  FAB_CUT: "#3B82F6", FAB_SEW: "#6366F1", WOOD_CUT: "#F59E0B", FOAM: "#8B5CF6",
  FRAMING: "#F97316", WEBBING: "#10B981", UPHOLSTERY: "#F43F5E", PACKING: "#06B6D4",
};
export const DEPT_NEUTRAL = "#A8A196";

/** `colorOf(code)` → the configured hex for a department code (e.g. "FAB_CUT"), else a neutral. */
export function useDeptColors(enabled = true): (code: string) => string {
  const { data } = useCachedJson<{ success?: boolean; data?: DeptCfg[] | null }>(enabled ? "/api/kv-config/settings-departments" : null);
  const list = data?.success && Array.isArray(data.data) && data.data.length > 0 ? data.data : null;
  return useCallback(
    (code: string) => {
      if (list) return list.find((d) => d.code === code)?.color ?? DEPT_NEUTRAL;
      return SETTINGS_DEFAULT_COLORS[code] ?? DEPT_NEUTRAL;
    },
    [list],
  );
}
