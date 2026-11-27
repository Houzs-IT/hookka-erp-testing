// Phone floating glass tab bar geometry (design_handoff_bottom_bar_glass, Style B).
// No imports on purpose: ResponsiveActionDock and the node tests load this without the
// `@/` alias that theme.ts needs.
//
// The numbers live in CSS vars (theme-vars.css, `--m-tabbar-*`) because the bottom gap
// depends on the phone's safe-area inset. `top` is the pill's top edge measured from the
// screen bottom, inset included.
export const M_TAB_BAR = {
  bottom: "var(--m-tabbar-bottom)",
  top: "var(--m-tabbar-top)",
  side: "var(--m-tabbar-side)",
  height: 64,
} as const;

/**
 * CSS `bottom` for something that sits `gap` px above the floating pill.
 * Phone `ResponsiveActionDock phoneBottom` values were authored against the old 56px
 * flush bar (56 = resting on it), so docks call this with `phoneBottom - 50`: resting
 * docks get a 6px gap, raised toasts keep their extra height.
 */
export const aboveTabBar = (gap: number) => `calc(${M_TAB_BAR.top} + ${gap}px)`;
