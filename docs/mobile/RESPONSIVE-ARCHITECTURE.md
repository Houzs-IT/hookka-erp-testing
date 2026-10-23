# `/m` responsive architecture

> **Last verified: 2026-10-23 on branch `feat/m-sales-responsive` (Sales Orders list + detail row, step 4) and earlier `feat/mobile-responsive-foundation` (step 3 list grids added; rail auto-compact added; step 2 added the same day: `ResponsiveActionDock`, `screens/delivery/ui.tsx` `ToastView`, `DocumentDetailScreen.tsx` `Toast`)** against
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

## Tablet rail auto-compact (owner-approved 2026-10-23)

In `tablet-landscape` the rail defaults to expanded (198px). With the split view open at about 1024px that leaves a 505px detail pane, so `resolveRailExpanded()` (`lib/responsive-layout.tsx`, wired in `MobileLayout.tsx`) compacts the rail to 72px (detail 611px) while a split-view detail is open, only when all of these hold: no explicit user choice is saved, the preference is "expanded", and the detail pane with the full rail would be below `CONTAINER_REGULAR_MIN_WIDTH` (520). Closing the detail restores the preference. The rail toggle behaves in two ways (owner decision 2026-10-23): while the rail is auto-compacted, tapping it expands the rail **temporarily** (`railToggleOutcome`): nothing is saved, and the expand ends as soon as auto-compact stops applying (the detail closes, or the window leaves the narrow range), so the next detail auto-compacts again; at any other time it is the user's own choice, saved as an explicit preference that is never overridden. The width eases with `--m-motion-standard`, which is 0.01ms under `prefers-reduced-motion`.

- **No oscillation, by construction.** The rule is computed from the *shell* width and the route, measuring the detail pane as if the rail were expanded; it never reads the current rail. A rule that measured the current pane would flip forever at 1024px (505 compact, 611 expand, 505 ...); `tests/mobile-rail-auto-collapse.test.mjs` demonstrates that and pins the fixed-point behaviour. Compacting only widens the content, so the split view cannot close because of it.
- **The 520 threshold only matters for 1024-1038px shells** (a 1024px iPad in landscape). 1039px and wider already give the detail 520px or more (1080px: 546, 1180px: 641). It is therefore a narrow trigger, and 520 vs 521 makes no practical difference to the detail UI, since nothing consumes the size class yet. 520 is still provisional; a larger value (for example 560, covering up to 1099px) would extend the behaviour to 1080px iPads and is a design decision.
- **Known visual trade-offs to check on a device:** the rail labels disappear at the start of the width transition while the width eases; the split panes re-measure each frame during the 180ms transition.

## Migration order and completion criteria

| Step | Purpose | Done when |
|---|---|---|
| 1. Foundation (this branch) | Pane width, grid, cap, tests, this page | Tests and lint green, no screen changed, no new `tsc` errors |
| 2. Floating layers (**built, not yet visually checked**) | One toast / action-bar placement that follows the rail and pane | `ResponsiveActionDock` gains `scope="auto"` (follows the pane via `useContainerLayout`) and `tabletBottom`; the `DocumentDetailScreen` and Delivery (`ToastView`) toasts render in it with their phone offsets unchanged (120/72 and 104) and their looks untouched; `tests/mobile-floating-layer.test.mjs` also fails if a screen adds a new `position: "fixed"` layer or uses `100vw`. Tablet position of those two toasts changes on purpose (centred in the content area or pane, above the bar) and needs a visual check |
| 3. First screens (**built, not yet visually checked**) | Prove `ResponsiveGrid` on real screens | The Delivery and Procurement lists (and their loading skeletons) use `<ResponsiveGrid maxColumns={tablet && !inPane ? undefined : 1} gap={10}>` instead of two hand-written grids. Behaviour is deliberately **unchanged** (owner 2026-10-23): one column in phone mode (even 652-719px), in the split list pane and at 390px (the exact `minmax(0, 1fr)` template and 10px gap), and the same 320px-minimum column counts as before on tablets (1 at 720, 2 at 768-1024, a borderline 3 at 1180); `tests/mobile-list-grid.test.mjs` pins the before/after counts. NOT done and still open: the 652-719px two-column question, the 1180px count, `inPane` in Products (its `wide` grid is a different shape), and the 520/880 thresholds, which these CSS-only grids do not exercise |
| 4. Sales Orders list + detail (**built, not yet visually checked**) | The one fork with functional differences | One adaptive detail (`SalesOrderDetail.tsx`) and one list design at every width. The phone markup is locked by `tests/m-sales-phone-golden.test.mjs` (fixture data, byte-identical); wider screens add Payments (Total / Paid / Balance), the Customer PO Date row and the status actions (same requests as before: `lib/use-so-actions.ts`) and arrange cards in columns; two detail columns only at a >= 760px container (a screen-local constant: the provisional 520 / 880 size classes are not used here, and 880 would rarely be reached). The Sales list loses its separate tablet UI; the Sort the tablet list had moves into the phone `SalesFilterSheet` on wider screens only; the old tablet card's Order date is no longer on the list (it is in the detail). `SalesDetailTablet` is kept unused until parity is verified in a non-production environment |
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
