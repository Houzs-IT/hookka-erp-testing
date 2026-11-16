// ---------------------------------------------------------------------------
// theme.ts — light / dark / system preference for the office ERP (owner
// 2026-11-11). The preference lives in localStorage; `html.dark` turns on the
// dark overrides in src/styles/dark-theme.generated.css + dark-base.css.
// index.html applies the stored choice before first paint (no flash); this
// module owns changing it and following the OS when the choice is "system".
//
// Default is LIGHT, so nobody's screen changes until they pick dark.
// ---------------------------------------------------------------------------
export type ThemePref = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "hookka-theme";

export function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return v === "dark" || v === "system" || v === "light" ? v : "light";
  } catch {
    return "light";
  }
}

/** Resolve a preference against the OS setting. Pure apart from matchMedia. */
export function resolveTheme(pref: ThemePref, systemDark: boolean): "light" | "dark" {
  if (pref === "system") return systemDark ? "dark" : "light";
  return pref;
}

const systemQuery = (): MediaQueryList | null =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

export function applyTheme(pref: ThemePref = readThemePref()): "light" | "dark" {
  const mode = resolveTheme(pref, !!systemQuery()?.matches);
  const root = document.documentElement;
  root.classList.toggle("dark", mode === "dark");
  root.style.colorScheme = mode;
  return mode;
}

export function setThemePref(pref: ThemePref): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    /* private mode: still apply for this page */
  }
  applyTheme(pref);
  window.dispatchEvent(new CustomEvent("hookka-theme", { detail: pref }));
}

/** Keep "system" in step with the OS while the app is open. Call once at start. */
export function watchSystemTheme(): () => void {
  const q = systemQuery();
  if (!q) return () => {};
  const onChange = () => {
    if (readThemePref() === "system") applyTheme("system");
  };
  q.addEventListener?.("change", onChange);
  return () => q.removeEventListener?.("change", onChange);
}
