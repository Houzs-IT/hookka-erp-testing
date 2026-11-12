# Refined look (preview) — design system v2

> **Last verified: 2026-11-12** (branch `feat/refined-look-preview`): tokens, generator and toggle as described; visual check on prod pending.

Owner 2026-11-12: "我要像 Houzs ERP 那么漂亮的 或者更加漂亮" + "不要看久眼睛痛". Design canvas
(17 boards: principles, Houzs reference, eye comfort, foundations, palette A/B, components, layout,
data viz, forms, states, status, screens, dark, print, brand, phone):
https://claude.ai/artifact/Roh88iBS5bxpxjVQEkpYvq — owner chose palette **B-lite**.

## How it is wired (phase 1 — opt-in preview)
- `src/styles/refined-tokens.css` — the `--hk-*` tokens (warm neutrals, brass primary, 4 status
  colours, B-lite sage/slate/clay tints, chart set, radii, shadows, Inter + Noto Sans SC + JetBrains
  Mono), all under `:root.refined`. Also re-points the phone app's `--m-*` variables (light theme only).
- `scripts/gen-refined-theme.mjs` → `src/styles/refined-theme.generated.css` — scans every hard-coded
  colour class (`text-[#…]`, `bg-[#…]`, `border-[#…]` …) and snaps each hex to its nearest token by role
  (OKLab + chroma weight, a pinned table for Hookka's structural colours). Same technique as dark mode
  (`scripts/gen-dark-theme.mjs`): no page edits, no merge conflicts. Runs on `npm run build`.
  ~1,075 classes / ~726 distinct hex → 35 tokens.
- Toggle: Topbar › user menu › **Look: Classic / Refined (new)** (`src/lib/theme.ts` `setLookPref`,
  localStorage `hookka-look`). `index.html` applies it before first paint and loads the fonts only when
  refined. On a phone: open any page with `?look=refined` (or `?look=classic`).
- Rules: refined-only (`:root.refined:not(.dark)`), screen-only (print/PDF unchanged), paper wrappers
  with `data-theme="light"` (Board Report) opt out — the phone shell's `<body data-theme="light">` does not.

## Direction C · Modern bright (owner 2026-11-12)
After using the B-lite preview the owner said "大部分都不是很好看" and picked direction **C** from three
offered (A warm premium / B Houzs-like / C modern bright): whiter, cleaner, a little more vivid, still
eye-comfortable. Tokens now: bg #F5F6F8, surface #FFFFFF, ink #1A1D23, ink-muted #667085, brighter brass
primary #9C7A2E (soft #FBF4E2), vivid status (success #15803D, warning #B45309, danger #B42318, info
#175CD3) with very light fills, module tints green/blue/coral, charts #2E6BE6 #12B886 #F59F00 #7950F2
#E8590C #868E96, rounder radii (8/10/14/18), lighter shadows. Sidebar is LIGHT in refined (`data-sidebar`
hook; it carries data-theme="light" so the remap skips it and refined-tokens.css restyles it; the black
logo shows without the invert filter). Chart series now match by hue (angle) then lightness.

## Polish log
- 2026-11-12 (owner screenshots): `.font-mono` keeps the UI font in refined (dates like 2026-05-01 went
  wide in JetBrains Mono); production grid cells (`CellBox`, `data-cell`) are soft fills with a thin edge
  instead of solid red/olive/teal blocks (eye comfort).
- 2026-11-12: chart colours — recharts writes JS colour constants as SVG `fill` / `stroke` / `stop-color`
  attributes; the generator now turns every hex string literal into an svg-scoped attribute rule snapped
  onto the chart set (hue-weighted, a coloured series never turns grey). Fixes the bright teal/navy
  Accounting overview and every other chart without touching chart code.
- 2026-11-12: Tailwind status families (red/rose, green/emerald/lime, amber/yellow/orange,
  blue/sky/cyan/teal/indigo) re-pointed to refined status ramps (bright `bg-red-600` Cancel buttons →
  soft danger); warehouse occupied racks (`data-rack`) soft brass instead of solid olive.

## Known gaps (phase 2)
- Colours typed into inline `style={{…}}` on HTML elements and PDF generators are not caught by CSS —
  move them to tokens (`src/lib/design-tokens.ts`) module by module.
- Dark mode keeps its own palette in refined mode for now (refined rules skip `.dark`).
- Phase 3: make Refined the default after the owner signs off; then a lint rule banning new
  arbitrary hex colour classes.
