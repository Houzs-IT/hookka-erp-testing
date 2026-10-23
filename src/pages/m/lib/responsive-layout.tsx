import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

export type MobileLayoutMode = "phone" | "tablet-portrait" | "tablet-landscape";

export const PHONE_MAX_WIDTH = 719;
export const FULL_RAIL_MIN_WIDTH = 1024;
export const COMPACT_RAIL_WIDTH = 72;
export const FULL_RAIL_WIDTH = 198;
export const SPLIT_CONTENT_MIN_WIDTH = 760;

type TabletLayoutMode = Exclude<MobileLayoutMode, "phone">;

const RAIL_PREFERENCE_KEYS: Record<TabletLayoutMode, string> = {
  "tablet-portrait": "hookka.mobileRail.portraitExpanded",
  "tablet-landscape": "hookka.mobileRail.landscapeExpanded",
};

export function defaultRailExpanded(mode: TabletLayoutMode): boolean {
  return mode === "tablet-landscape";
}

export function readRailExpandedPreference(mode: TabletLayoutMode): boolean {
  const fallback = defaultRailExpanded(mode);
  if (typeof localStorage === "undefined") return fallback;
  try {
    const saved = localStorage.getItem(RAIL_PREFERENCE_KEYS[mode]);
    return saved == null ? fallback : saved === "1";
  } catch {
    return fallback;
  }
}

export function writeRailExpandedPreference(
  mode: TabletLayoutMode,
  expanded: boolean,
): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(RAIL_PREFERENCE_KEYS[mode], expanded ? "1" : "0");
  } catch {
    /* Storage can be unavailable in private/restricted browsing. */
  }
}

/** True once the user has expanded or collapsed the rail themselves (a saved choice exists). */
export function hasRailExpandedPreference(mode: TabletLayoutMode): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(RAIL_PREFERENCE_KEYS[mode]) != null;
  } catch {
    return false;
  }
}

/**
 * Whether the rail is shown expanded. Normally that is the preference (the saved
 * choice, else the mode's default). One exception, so the split view's detail
 * keeps a usable width: when NO explicit choice exists, the preference is
 * "expanded", and a split-view detail is open, the rail compacts if the detail
 * pane would otherwise be phone-sized (below CONTAINER_REGULAR_MIN_WIDTH).
 *
 * The result depends only on the shell width and the route, never on the current
 * rail width: it measures the detail pane as if the rail were expanded. So
 * opening or closing the rail cannot change the answer, and there is no feedback
 * loop. Compacting only ever widens the content, so the split view stays open.
 * Closing the detail returns the preference unchanged.
 */
export function resolveRailExpanded({
  shellWidth,
  preferred,
  explicit,
  splitDetailOpen,
}: {
  shellWidth: number;
  preferred: boolean;
  explicit: boolean;
  splitDetailOpen: boolean;
}): boolean {
  if (!preferred || explicit || !splitDetailOpen) return preferred;
  const withFullRail = resolveResponsiveLayout(shellWidth, undefined, true);
  if (withFullRail.mode === "phone" || !withFullRail.canSplitDetail) return preferred;
  return estimatePaneWidths(withFullRail).detail >= CONTAINER_REGULAR_MIN_WIDTH;
}

export type ResponsiveLayoutValue = {
  mode: MobileLayoutMode;
  shellWidth: number;
  contentWidth: number;
  railWidth: 0 | typeof COMPACT_RAIL_WIDTH | typeof FULL_RAIL_WIDTH;
  splitMasterWidth: number;
  hasBottomNavigation: boolean;
  canSplitDetail: boolean;
};

export function resolveResponsiveLayout(
  shellWidth: number,
  measuredContentWidth?: number,
  railExpandedOverride?: boolean,
): ResponsiveLayoutValue {
  const safeShellWidth = Math.max(0, shellWidth);
  const mode: MobileLayoutMode =
    safeShellWidth <= PHONE_MAX_WIDTH
      ? "phone"
      : safeShellWidth < FULL_RAIL_MIN_WIDTH
        ? "tablet-portrait"
        : "tablet-landscape";
  const railExpanded =
    mode === "phone"
      ? false
      : railExpandedOverride ?? defaultRailExpanded(mode);
  const railWidth = mode === "phone"
    ? 0
    : railExpanded
      ? FULL_RAIL_WIDTH
      : COMPACT_RAIL_WIDTH;
  const estimatedContentWidth = Math.max(0, safeShellWidth - railWidth);
  const contentWidth =
    measuredContentWidth != null && measuredContentWidth > 0
      ? measuredContentWidth
      : estimatedContentWidth;
  const splitMasterWidth = Math.min(340, Math.max(320, Math.round(contentWidth * 0.38)));

  return {
    mode,
    shellWidth: safeShellWidth,
    contentWidth,
    railWidth,
    splitMasterWidth,
    hasBottomNavigation: mode === "phone",
    canSplitDetail: mode !== "phone" && contentWidth >= SPLIT_CONTENT_MIN_WIDTH,
  };
}

const DEFAULT_LAYOUT = resolveResponsiveLayout(390, 390);
const ResponsiveLayoutContext = createContext<ResponsiveLayoutValue>(DEFAULT_LAYOUT);

export function ResponsiveLayoutProvider({
  value,
  children,
}: {
  value: ResponsiveLayoutValue;
  children: ReactNode;
}) {
  return (
    <ResponsiveLayoutContext.Provider value={value}>
      {children}
    </ResponsiveLayoutContext.Provider>
  );
}

export function useResponsiveLayout(): ResponsiveLayoutValue {
  return useContext(ResponsiveLayoutContext);
}

function initialViewportWidth(): number {
  if (typeof document !== "undefined") {
    return document.documentElement.clientWidth || 390;
  }
  if (typeof window !== "undefined") return window.innerWidth || 390;
  return 390;
}

/** Observe the rendered shell/content box rather than assuming viewport width. */
export function useObservedWidth<T extends HTMLElement>(
  initialWidth = initialViewportWidth(),
): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(initialWidth);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => {
      const next = Math.round(el.getBoundingClientRect().width);
      if (next > 0) setWidth((current) => (current === next ? current : next));
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

export function useResolvedResponsiveLayout(
  shellWidth: number,
  contentWidth: number,
): ResponsiveLayoutValue {
  return useMemo(
    () => resolveResponsiveLayout(shellWidth, contentWidth),
    [shellWidth, contentWidth],
  );
}

// ---------------------------------------------------------------------------
// Container layout: how wide is the box THIS content sits in?
//
// The shell mode above answers "which navigation" (rail or bottom bar) from the
// whole shell. It cannot answer "how many columns fit", because inside the
// split view (TwoPane) the list and the detail each get only part of the
// content width. Arrangement decisions (columns, side-by-side cards) read the
// container below; navigation keeps reading `useResponsiveLayout()`.
// ---------------------------------------------------------------------------

export type ContainerSize = "compact" | "regular" | "wide";
export type PaneKind = "full" | "list" | "detail";

// The one place a content-width threshold is named, so screens stop inventing
// their own (the screens today cap at 560, 640, 720 and 760 independently).
//
// PROVISIONAL: 520 and 880 are starting points, not design facts. They are fixed
// when the first screens adopt them (Sales Order detail, Home KPIs), from what
// those layouts actually need, and they change here, once. `compact` is the
// approved 390px phone design: whatever is shown in a compact container must look
// right as the phone stack, which is also what a 320-505px split pane gets.
/** Below this the container is phone-sized: one stacked column (390px phone, a split list pane). */
export const CONTAINER_REGULAR_MIN_WIDTH = 520;
/** From this up there is room for a genuinely multi-column arrangement. */
export const CONTAINER_WIDE_MIN_WIDTH = 880;

export function resolveContainerSize(width: number): ContainerSize {
  const w = Math.max(0, width);
  if (w >= CONTAINER_WIDE_MIN_WIDTH) return "wide";
  if (w >= CONTAINER_REGULAR_MIN_WIDTH) return "regular";
  return "compact";
}

export type ContainerLayoutValue = {
  /** Width of the box the content is laid out in, in CSS px. */
  width: number;
  size: ContainerSize;
  /** `list` / `detail` inside the split view; `full` everywhere else. */
  pane: PaneKind;
};

export function resolveContainerLayout(width: number, pane: PaneKind = "full"): ContainerLayoutValue {
  const safe = Math.max(0, width);
  return { width: safe, size: resolveContainerSize(safe), pane };
}

/** Per-pane widths of the split view, before the first measurement lands. */
export function estimatePaneWidths(layout: ResponsiveLayoutValue): { list: number; detail: number } {
  const list = layout.splitMasterWidth;
  // The 1px divider between the panes belongs to the list pane's border.
  return { list, detail: Math.max(0, layout.contentWidth - list - 1) };
}

const ContainerLayoutContext = createContext<ContainerLayoutValue | null>(null);

/** Mounted by TwoPane around each pane so descendants see the pane's own width. */
export function PaneProvider({
  value,
  children,
}: {
  value: ContainerLayoutValue;
  children: ReactNode;
}) {
  return (
    <ContainerLayoutContext.Provider value={value}>
      {children}
    </ContainerLayoutContext.Provider>
  );
}

/**
 * The width class of the nearest pane. Outside the split view there is no
 * pane, so it falls back to the shell's content width, which is exactly what
 * a screen saw before this hook existed.
 *
 * The context follows the React tree, not the screen geometry. A `Sheet` or
 * dialog opened from inside a pane is still a descendant of that pane but is as
 * wide as the viewport allows, so overlay content must size itself with CSS, or
 * the overlay must provide its own PaneProvider; it must not read this hook and
 * assume the pane's width.
 */
export function useContainerLayout(): ContainerLayoutValue {
  const pane = useContext(ContainerLayoutContext);
  const shell = useContext(ResponsiveLayoutContext);
  return useMemo(
    () => pane ?? resolveContainerLayout(shell.contentWidth, "full"),
    [pane, shell.contentWidth],
  );
}
