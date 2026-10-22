# `/m` responsive architecture

> **Last verified: 2026-10-22 on branch `feat/mobile-responsive-foundation`** against
> `src/pages/m/lib/responsive-layout.tsx`, `lib/responsive-grid.ts`,
> `components/{ResponsiveGrid,PageContainer,ResponsiveActionDock,Sheet}.tsx`,
> `MobileLayout.tsx` (`TwoPane`) and the screens named below. The repo counts quoted
> here (duplicated `inPane`, 760px caps, `auto-fill` grids) were measured by grep on that
> date. **No screen has been visually checked at tablet widths**: nothing here claims
> visual parity. If a claim below disagrees with the code, trust the code and fix this page.

## Goal

One `/m` frontend for phones, foldables and tablets. The approved 390px design is the
visual baseline. A wider screen rearranges the same cards, it does not switch to a
legacy or separate tablet design, and no module gets a second "tablet" screen.

## Two questions, two answers

| Question | Answered by | Used for |
|---|---|---|
| Which **navigation** does this device get? | the **shell** width: `useResponsiveLayout()` → `mode` (`phone` ≤719, `tablet-portrait` 720–1023, `tablet-landscape` ≥1024), `railWidth`, `hasBottomNavigation`, `canSplitDetail` | rail vs bottom bar, sheet placement, safe areas |
| How should **this content** be arranged? | the **container** the content sits in: `useContainerLayout()` → `{ width, pane, size }`, or plain CSS for grids | columns, side-by-side cards, content caps |

Inside the split view (`TwoPane`) the list and the detail each get only part of the content
width, so the shell width is the wrong input for arrangement. Each pane therefore reports its
own measured width.

## Building blocks and why each exists

Decisions were made on repository evidence, not on possible future use.

| Piece | Evidence it is needed | Status |
|---|---|---|
| `useObservedWidth` (existing) | Already the way the shell measures itself | Reused, unchanged |
| `PaneProvider` / `useContainerLayout().pane` + `.width` | `const inPane = layout.canSplitDetail && !!openId` is copy-pasted in Delivery, Procurement and Products; `canSplitDetail ? "detail" : "content"` in four detail screens; `ResponsiveActionDock` positions from an *estimated* `splitMasterWidth`. Home sizes a chart from `contentWidth` | **Retain** |
| `estimatePaneWidths` | Seeds the first paint before the observers report, so the split view does not flash | **Retain** (tiny) |
| `ContainerSize` + thresholds | Screens cap at 560, 640, 720 and 760 independently; Home picks 4 KPI columns from `mode === "tablet-landscape"`, so it shows **2** columns at 1023px (951px content) and **4** at 1024px (826px content): wider content, fewer columns | **Retain, thresholds provisional**: one named vocabulary is justified, the numbers (520 / 880) are not. Set them from the first adopting screens |
| `ResponsiveGrid` + `lib/responsive-grid.ts` | `auto-fill, minmax(320px, 1fr)` written by hand in `DeliveryScreen`, `ProcurementScreen`, `ProductsScreen` (and a 200px variant); `StatGrid` in the Dashboard is fixed at 2 columns | **Retain**. Pure CSS: follows the container with no mode check |
| `PageContainer` | A 760px centred column is hand-written four times (Delivery detail, Procurement detail body, Procurement full-screen dialog, and 720px in Product detail) | **Retain, simplified**: cap + centre only. The first version also padded with the gutter token; removed, because approved 390px screens use 14, 16 and 18px paddings and a shared gutter would move phone pixels |
| Gutter variables (`--m-page-gutter` …) | Defined in `theme-vars.css`, read by nothing | **Defer**: adopting them is a design decision about the 390px padding scale, not a plumbing task |
| `ResponsiveActionDock` (existing) | Already positions fixed bars by rail and pane | Extend later, do not duplicate |

## Rules for screens

1. A screen is one component. Never a phone file plus a tablet file.
2. `mode` / shell values decide **navigation chrome only**. Arrangement reads the container or uses CSS.
3. Prefer continuous CSS (`ResponsiveGrid`, `minmax`) over a class switch: nothing jumps at a boundary.
4. `compact` is the 390px phone design. Anything shown in a compact container must look right as the phone stack.
5. Which actions and which information a screen shows never depends on width as a new rule. (Sales Order detail still has one legacy width-based difference, tracked separately.)
6. No hard-coded `position: fixed` bottom offsets or `100vw` in a screen; use the action dock / floating layer.
7. Colours from `M.*` only.

## Edge cases and how they are handled

- **Split view, narrow panes.** The list pane is 320–340px and always `compact`. The detail pane is about 485–640px, so it is `compact` or `regular`. Design for `compact` first.
- **Resizing and rotation.** Pane widths come from `ResizeObserver`, so a rail toggle or a window resize updates them. Rotating across 760px content width mounts or unmounts `TwoPane` (existing behaviour); the observers go with it.
- **The 1023 → 1024px step.** The 72px rail becomes the 198px rail, so single-pane content shrinks 951 → 826px and the detail pane 610 → 505px (`wide`→`regular`, `regular`→`compact`). This only happens when resizing across 1024px (Stage Manager / Split View); a rotation jumps far past it. It is another reason to prefer continuous CSS.
- **Loading and lazy screens.** The pane element is persistent, so its width does not depend on the data or on a Suspense fallback.
- **Overlays inside a pane.** React context follows the tree, not the geometry: a `Sheet` opened from a pane is still its descendant but is viewport-wide. Overlay content must size with CSS (or the overlay must supply its own `PaneProvider`); it must not read `useContainerLayout()`.
- **Phone mode ≤719px but wider than a phone** (a large phone in landscape, or an unfolded fold) uses phone navigation and a content width up to 719. `ResponsiveGrid` will use two columns from 652px there, where today's `tablet && !inPane` rule gives one. Decide this explicitly when migrating Delivery / Procurement.
- **Full-screen scanning** (`ScanSheet`) stays a full-screen layer on purpose.
- **Embedded desktop views** (Dashboard tabs, IT Support) stay until a separate product decision.

## Migration order and completion criteria

| Step | Purpose | Done when |
|---|---|---|
| 1. Foundation (this branch) | Pane width, grid, cap, tests, this page | Tests and lint green, no screen changed, no new `tsc` errors |
| 2. Floating layers | One toast / action-bar placement that follows the rail and pane | The hard-coded `72/84/104px` offsets and `100vw` are gone from `DocumentDetailScreen` and `delivery/ui.tsx`; phone offsets unchanged |
| 3. First screens | Prove the API on real screens; **fix the thresholds** | Delivery and Procurement lists on `ResponsiveGrid` with the phone-width decision above made; `inPane` removed from the three screens |
| 4. Sales Order detail | The one fork with functional differences | Single adaptive screen; every tablet action and figure preserved and checked in a non-production environment; `SalesDetailTablet` removed only after sign-off |
| 5. Remaining forks and unadapted screens | Production detail, Sales list, Mail Center, Home, Finance, Dashboard wrapper, Warehouse, forms | Per module: one component, phone unchanged, tablet follows the phone design language |

## Regression strategy

1. **Layout maths (automated, in `npm test`).** `tests/mobile-responsive-shell.test.mjs` and `tests/mobile-container-layout.test.mjs` cover 390, 719, 720, 768, 820, 884, 1023, 1024, 1180 and 1366: modes, content widths, pane widths, size classes.
2. **Source guards (automated).** Assertions that the foundation reads no viewport, hard-codes no colour, uses no fixed positioning, and that unmigrated screens are untouched. A ratchet test for fixed offsets and hard-coded grid counts is added with step 2.
3. **Parity tests for forks (automated).** For Sales Order detail: the same endpoints, methods, bodies and per-status action matrix as `SalesDetailTablet`.
4. **Visual (manual, now).** Screenshots at 390, 768, 820, 1024, 1180, light and dark, taken before and after each step, compared by eye. Baselines for the screens being changed are captured *before* the change.
5. **Visual (automated, needs approval).** The repo has no browser-test framework (no Playwright, no jsdom). A screenshot suite would need a new dev dependency and a mocked network whose fixtures are labelled as layout-only. Not started.
6. **Real devices.** iPad, an Android tablet and a fold for scanning, rotation and the split view.

## Known unknowns

Visual results at any tablet width; the right 520 / 880 values; first-paint behaviour of the split view on a device; Surface Duo hinge handling (out of scope).
