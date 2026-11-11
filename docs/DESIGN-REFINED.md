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

## Known gaps (phase 2)
- Colours typed into inline `style={{…}}`, chart configs and PDF generators are not caught by CSS —
  move them to tokens (`src/lib/design-tokens.ts`) module by module.
- Dark mode keeps its own palette in refined mode for now (refined rules skip `.dark`).
- Phase 3: make Refined the default after the owner signs off; then a lint rule banning new
  arbitrary hex colour classes.
