# Mobile UI Foundation

> **Last verified: 2026-10-21** against `src/pages/m/lib/control-styles.ts`,
> `src/pages/m/theme-vars.css` and `src/pages/m/components/SegmentedSwitch.tsx` on
> branch `design/mobile-filter-chips-standardization` — the "Segmented switch and
> filter chips" section only. The rest still carries the 2026-10-14 stamp below.
>
> **Last verified: 2026-10-14** against `src/pages/m/theme-vars.css`,
> `src/pages/m/theme.ts`, `src/pages/m/MobileLayout.tsx`,
> `src/pages/m/screens/AnnouncementsScreen.tsx`, and
> `src/pages/m/screens/UpdatesScreen.tsx` on branch
> `design/mobile-ui-foundation`.

This is the implementation contract for future office mobile work under
`/m/*`. Phase 0 adds the foundation tokens and this guidance only. Existing
screens do not consume the new tokens yet and must not change visually until a
separately approved Phase 1 migration.

## What is Hookka branding and what is mobile-specific

Existing Hookka branding remains authoritative:

- The warm raisin, taupe, paper, card, border, divider, gold and semantic
  status colours already defined in `src/pages/m/theme-vars.css`.
- The existing `system-ui` font stack from `M_FONT`; no new font is introduced.
- Lucide outline icons at the existing 1.75 stroke convention.
- Desktop tokens and shared components remain governed by
  `docs/DESIGN-SYSTEM.md` and `docs/UI-CONVENTIONS.md`.

The new mobile-specific standard is the semantic layer prefixed `--m-` in
`theme-vars.css`: type roles, accessible text roles, spacing, gutters, shape,
control and icon sizes, elevation, focus, motion and responsive aliases. These
tokens organise the existing brand for touch-first `/m/*` interfaces; they do
not replace or recolour the Hookka brand and they do not apply to desktop.

## Theme and typography

Use semantic type roles instead of choosing an arbitrary size and weight:

| Role | Tokens | Intended use |
| --- | --- | --- |
| Page title | `--m-type-page-title-*` | One route-level heading |
| Section heading | `--m-type-section-heading-*` | Major groups within a page |
| Card title | `--m-type-card-title-*` | Card/list-row heading |
| Business value | `--m-type-business-value-*` | Amounts, counts and KPIs; use tabular numerals |
| Description | `--m-type-description-*` | Main supporting prose |
| Metadata | `--m-type-metadata-*` | Dates, references and secondary context |
| Label | `--m-type-label-*` | Persistent form or group labels |
| Input | `--m-type-input-*` | User-entered text; 16px prevents iOS zoom |
| Button | `--m-type-button-*` | Button and primary action labels |
| Status | `--m-type-status-*` | Short status/chip text, not body copy |

The family stays `M_FONT`. Do not load another font. Preserve natural text
wrapping and allow Dynamic Type/browser text zoom: avoid fixed text containers,
blanket `white-space: nowrap`, and fixed card heights.

The semantic text colours are:

- `--m-text-primary` for headings and high-emphasis values.
- `--m-text-secondary` for descriptions and standard body copy.
- `--m-text-subtle` for metadata that still conveys information.
- `--m-text-placeholder` for placeholder text; it is not a substitute for a
  visible label.
- `--m-text-disabled` only for genuinely disabled controls. It is intentionally
  not a normal-content colour.
- `--m-text-on-accent` for text on the primary taupe/gold action surface.
- `--m-text-status-{success|warning|danger|info}` for status text paired with a
  word or icon, never colour alone.

Light and dark values are mapped independently. All normal text and status
text roles meet at least 4.5:1 against both the card and paper surface in their
theme. The colours stay within Hookka's existing warm brand and semantic
families; the dark values are accessible tonal variants, not an inverted or
new palette.

## Spacing and responsive layout

Use the 4px rhythm from `--m-space-1` through `--m-space-12`. Prefer semantic
aliases where they describe intent:

- `--m-page-gutter` for normal page edges; 18px on phones and 24px from the
  existing 720px Fold/tablet breakpoint.
- `--m-page-gutter-compact` only for dense, approved list treatments.
- `--m-section-gap`, `--m-card-gap`, and `--m-card-padding` for hierarchy.
- `--m-safe-*` for fixed or sticky chrome near device cut-outs and gesture
  areas.
- `--m-content-readable-max` for long-form content on wide mobile surfaces.

Phone is the default. At 720px the aliases expand for Fold/tablet layouts; a
phone in landscape receives the larger horizontal gutter. Future layouts must
avoid horizontal page scrolling, reserve space for fixed navigation, and let
content reflow at browser zoom and enlarged text sizes. Do not encode a CSS
breakpoint as a custom property and attempt to use it in a media query; use the
documented 720px boundary.

## Cards, shape and elevation

Cards are content containers, not fixed-height tiles. Their height must be
content-driven, with `min-height` used only when alignment truly requires it.
Text wraps before the card grows; truncation is reserved for cases with a way
to reveal the full value.

Use these conceptual variants in future Phase 1 work:

- **Standard card** — `--m-card` surface, `--m-border`,
  `--m-radius-lg`, `--m-card-padding`, and `--m-shadow-card`.
- **Flat/grouped card** — the same surface, border and radius with
  `--m-shadow-none`; suitable for nested or dense groups.
- **Interactive card** — starts from standard or flat and adds semantic button
  behaviour, a 44px minimum target, keyboard focus and pressed feedback. A
  clickable `div` is not sufficient without full keyboard semantics.
- **Raised overlay/sheet** — use `--m-shadow-floating` or
  `--m-shadow-sheet`; these are for transient layers, not ordinary rows.

`--m-shadow-card` is exactly the existing Announcements/Notifications soft
shadow:

```css
0 1px 0 rgba(31, 29, 27, 0.03),
0 6px 20px -12px rgba(31, 29, 27, 0.14)
```

Use soft shadow to separate a card from the page, not to replace a required
border or communicate status. Avoid stacking shadows on nested cards. Radius
roles are `--m-radius-sm`, `--m-radius-md`, `--m-radius-lg`,
`--m-radius-xl`, and `--m-radius-pill`; choose by hierarchy rather than page.

## Controls, search, filters, buttons and chips

- Pointer targets are at least `--m-target-min` (44px) in both dimensions.
  A smaller visual icon may sit inside an expanded target.
- `--m-control-default` (44px) is the normal field/button height;
  `--m-control-comfortable` (48px) is for prominent actions. The 32px compact
  size is secondary chrome only and still needs a 44px hit area.
- Search uses a visible or accessible label, a 16px input role, a clear action
  when populated, and does not rely on placeholder text as its label.
- Filters open from a clearly named 44px control, expose the active count, keep
  draft choices until Apply, provide Reset, and report the resulting count.
- Buttons have one primary action per view. Secondary, destructive, loading
  and disabled states must be semantically and visually distinct.
- Chips are short and single-purpose. Collections wrap before labels shrink.
  Status chips include text; filter chips expose selection and removal to
  assistive technology. Use `--m-radius-pill` for pill shapes.
- Icons use `--m-icon-xs` through `--m-icon-xl`, Lucide's 1.75 stroke, and an
  accessible name when the icon is the only control label. Decorative icons
  are hidden from assistive technology.

## Segmented switch and filter chips (shared standard, 2026-10-21)

The approved Claude Design handoff for these two controls lives in one place,
`src/pages/m/lib/control-styles.ts`, and is pinned by
`tests/m-control-styles.test.mjs`. Colours and shadows come from `theme-vars.css`
(light values below; dark values are set alongside):

| Token | Light | Dark |
| --- | --- | --- |
| `--m-segment-track` | `#F0ECE9` | `#34302A` |
| `--m-chip-text` | `#3A352C` | `#D4C9A8` |
| `--m-shadow-segment-on`, `--m-shadow-chip`, `--m-shadow-chip-on` | handoff shadows | same |

- **Segmented switch** (`SEGMENT_WRAP`, `segmentTrack(n)`, `segmentButton(on)`,
  `SEGMENT_ICON`): wrapper `6px 18px 0`; 46px track, 4px padding and gap, radius 14;
  segments radius 10, no border, 13px, optional 15px Lucide icon (stroke 1.9).
  Active = card surface, `--m-raisin`, 700, `--m-shadow-segment-on`; inactive =
  transparent, `--m-ink`, 600.
- **Filter chips** (`CHIP_ROW` + `CHIP_ROW_CLASS`, `chip(on)`, `CHIP_COUNT`,
  `chipDot`): horizontal scroll with a hidden scrollbar, gap 8, padding
  `12px 18px 4px`; 34px pill, `0 13px`, no border, 12.5px; optional 7px dot before
  the label, count after it at opacity .8 with tabular numerals. Active = taupe
  fill, `--m-text-on-accent`, 700, `--m-shadow-chip-on`; inactive = card,
  `--m-chip-text`, 600, `--m-shadow-chip`.

Adopted by Home (`SegmentedSwitch variant="prominent"`), Products (`ViewSwitch`,
`CategoryChips`), Sales Orders (phone and tablet status chips; the tablet row
keeps its 10px top spacing) and Delivery (`SectionSwitch`, stage `Chips`).
`SegmentedSwitch`'s default variant, `ChipTabs`, `SubTabs` and other screens are
unchanged. To adopt it on another screen, import these helpers rather than
copying the values, and keep the screen's labels, counts and tap behaviour.

## Focus and interaction

Future migrated controls use `--m-focus-ring-width`,
`--m-focus-ring-offset`, `--m-focus-color`, and `--m-focus-ring` with
`:focus-visible`. Never remove an outline without an equally visible
replacement. Focus order follows visual order, and sticky UI must not obscure
the focused element.

Pressed feedback may use `--m-pressed-opacity` and the shared motion tokens,
but must not change layout bounds. Disabled controls use native disabled
semantics plus `--m-disabled-opacity`; opacity alone is not disabling.
Primary actions cannot depend on hover. `prefers-reduced-motion: reduce`
collapses the foundation motion durations, so correctness must never depend on
an animation-end event.

Phase 0 does not apply these rules to existing selectors. Any adoption that
changes a current component's focus, hover, pressed, disabled or motion style
belongs in Phase 1 and requires screen-level visual and interaction checks.

## Light and dark mode requirements

Every new `/m/*` UI must be reviewed in both themes. Use semantic tokens rather
than raw hex values. In particular:

- Confirm primary, secondary, subtle and status text on the actual surface.
- Keep borders/dividers and focus indicators distinguishable in both themes.
- Do not infer dark mode by inversion or opacity alone.
- Meaningful icons/control boundaries need at least 3:1 contrast.
- Test composed overlays and scrims against the content behind them.
- Logo, product imagery, QR codes and photos keep `.m-no-invert` behaviour.

## Accessibility acceptance criteria

Future Phase 1 changes must verify:

- Normal text contrast is at least 4.5:1; large text and non-text UI meet the
  applicable 3:1 threshold.
- All actions are keyboard reachable, visibly focused and correctly named.
- Touch targets are at least 44px with at least 8px separation where practical.
- Visible labels, specific inline errors and programmatic descriptions are
  present for form controls.
- Colour is never the sole carrier of status, urgency or selection.
- Text zoom/enlargement, wrapping, 375px width, landscape, the 720px Fold
  boundary, and reduced motion do not hide content or actions.
- Fixed headers, bottom navigation and sheets respect safe areas and do not
  cover scroll content or focus.

## How future UI work adopts the foundation

1. Keep the task inside `/m/*`; desktop tokens and shared component styling are
   outside this foundation.
2. Select semantic roles by meaning, not by copying a nearby pixel value.
3. Reuse existing mobile components when their behaviour already matches the
   rule. Do not create speculative components.
4. Migrate one approved surface or component at a time. Record visual deltas,
   test phone/Fold widths and both themes, and verify keyboard/touch behaviour.
5. If a required rule changes an existing shared component or screen, document
   it in the Phase 1 scope before implementation. Phase 0 tokens alone are not
   permission to restyle existing UI.
6. New roles should be added centrally only when none of the existing semantic
   roles fits. Do not add a new palette colour or font without owner approval.

Example for future adoption (not applied to an existing screen in Phase 0):

```css
.future-mobile-card {
  padding: var(--m-card-padding);
  color: var(--m-text-secondary);
  background: var(--m-card);
  border: 1px solid var(--m-border);
  border-radius: var(--m-radius-lg);
  box-shadow: var(--m-shadow-card);
}
```

