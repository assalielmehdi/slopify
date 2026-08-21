---
name: Slopify
colors:
  primary: '#1C1C1C'
  light:
    background: '#F7F7F8'
    foreground: '#1C1C1C'
    surface: '#FFFFFF'
    surfaceForeground: '#1C1C1C'
    muted: '#F1F1F3'
    mutedForeground: '#6A6B70'
    subtleForeground: '#55565A'
    accent: '#F3F3F5'
    border: '#DCDCE0'
    sidebarBorder: '#E7E7E9'
    selected: '#EAEAEC'
    focus: '#1C1C1C'
  dark:
    background: '#111113'
    foreground: '#F1F1F2'
    surface: '#171719'
    surfaceForeground: '#F1F1F2'
    muted: '#222225'
    mutedForeground: '#8E8F95'
    subtleForeground: '#B7B7BC'
    accent: '#232326'
    border: '#303034'
    sidebarBorder: '#2B2B2F'
    selected: '#2A2A2E'
    focus: '#D8D8DA'
  signal:
    light:
      info: '#2563EB'
      success: '#0F7B45'
      warning: '#B45309'
      danger: '#C93434'
    dark:
      info: '#6EA8FE'
      success: '#5CCF8A'
      warning: '#F6B73C'
      danger: '#FF6B6B'
typography:
  titleLg:
    fontFamily: Geist
    fontSize: 22px
    lineHeight: 32px
    fontWeight: 600
    letterSpacing: '-0.01em'
  titleMd:
    fontFamily: Geist
    fontSize: 18px
    lineHeight: 24px
    fontWeight: 600
    letterSpacing: '-0.01em'
  body:
    fontFamily: Geist
    fontSize: 14px
    lineHeight: 20px
    fontWeight: 400
    letterSpacing: 0px
  label:
    fontFamily: Geist
    fontSize: 12px
    lineHeight: 16px
    fontWeight: 500
    letterSpacing: 0px
  sectionLabel:
    fontFamily: Geist
    fontSize: 11px
    lineHeight: 16px
    fontWeight: 500
    letterSpacing: '0.08em'
spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 20px
  xl: 24px
  2xl: 32px
  3xl: 40px
  4xl: 48px
rounded:
  sm: 4px
  md: 8px
  lg: 12px
  full: 9999px
components:
  controlSm:
    height: 32px
  controlMd:
    height: 36px
  appHeader:
    height: 56px
  sidebarExpanded:
    width: 256px
  sidebarCollapsed:
    width: 56px
  themeSelector:
    height: 36px
---

# Slopify Design System

## Overview

Slopify is a native AI delivery workbench for technical users. Its interface should
feel calm, precise, capable, and durable: closer to a professional instrument than a
branded marketing surface. It takes cues from Linear, Vercel, and Cloudflare without
copying their identity.

The visual hierarchy is carried primarily by typography, neutral contrast, spacing,
and borders. There is no persistent brand accent color. Chromatic color communicates
meaning: information, success, warning, danger, execution state, or data category.

Light and dark modes are equal first-class expressions of one system. A mode change
must change semantic token values only. It must not alter information hierarchy,
spacing, typography, component geometry, or interaction behavior.

## Colors

Use semantic roles instead of literal colors in component code. Components consume
`background`, `surface`, `foreground`, `mutedForeground`, `border`, `selected`, and
signal roles. They do not select a gray because it happens to look right in one mode.

### Neutral hierarchy

- `foreground` is reserved for page titles, active destinations, primary values, and
  decisive actions.
- `subtleForeground` is for ordinary navigation and secondary interface copy.
- `mutedForeground` is for section labels, metadata, descriptions, placeholders, and
  nonessential context. It must remain readable; muted never means disabled.
- `surface` is used by the sidebar, top navigation, panels, cards, menus, and dialogs.
- `background` is the main work area and must remain visibly distinct from `surface`.
- `selected` identifies the current neutral selection without introducing an accent.
- `border` and `sidebarBorder` define structure quietly. Prefer borders over shadows.

### Light mode

Light mode uses white structural surfaces over a soft gray work area. Text uses warm,
near-black gray rather than pure black. Selection and hover states are neutral gray.

The left navigation and top breadcrumb bar use the same surface, foreground hierarchy,
and border family. The main workspace uses `background` so the application shell is
legible without heavy elevation.

### Dark mode

Dark mode is designed independently, not produced by inverting light mode.

- Use deep charcoal for the work area and a slightly raised charcoal for structural
  surfaces. Avoid pure black.
- Primary text is soft white rather than pure white. Secondary text is lighter than in
  light mode so it keeps equivalent perceived importance.
- Borders must remain visible without becoming luminous outlines.
- Hover and selected states become lighter neutral surfaces, never colored glows.
- The sidebar and breadcrumb bar remain the same color; the main work area stays
  distinct.
- Status colors use the dark signal palette and must be paired with text or an icon.

Switching modes uses a 150ms color transition with no movement, scaling, or crossfade.
When reduced motion is requested, the transition is removed. Slopify defaults to Light,
stores one shared `Light`, `Dark`, or `System` preference, and exposes the same semantic
mode switch through the Preferences screen and the global `D` shortcut.

### Signal colors

Color is allowed only when it carries information. Never use a signal color as general
decoration, a default link color, a selected-navigation accent, or a substitute for
hierarchy. Never communicate a state by color alone.

## Typography

Use Geist for product UI and Geist Mono only for code, identifiers, logs, shortcuts,
and fixed-width technical values. Prefer a compact type scale with a small number of
roles.

- Titles use 18/24 or 22/32, weight 600, and -1% tracking.
- Body and navigation text use 14/20. Dense metadata may use 12/16.
- Section labels use 11/16, medium weight, uppercase, and 0.08em tracking.
- Use weight and neutral contrast before increasing type size.
- Use sentence case for navigation, buttons, headings, and labels.
- Avoid weights above 600 in the application shell.

## Layout

Use a 4px base grid. Preferred gaps and padding come from the spacing tokens; arbitrary
values require a concrete optical or layout reason.

- The expanded sidebar is 256px; its collapsed icon rail is 56px.
- The top navigation is 56px high and aligns with the sidebar title row.
- Sidebar and header content use enough edge padding that controls never feel attached
  to the viewport border.
- Group labels sit 8px above their first item. Distinct navigation groups use 20px of
  separation.
- Navigation items and standard controls are 36px high.
- Dense utility controls may use the 32px size.
- Keep related controls close; use larger gaps to separate concepts, not every element.
- Prefer one strong alignment axis per region.

Responsive behavior preserves priority. Collapse the sidebar to an icon rail before
compressing labels or reducing control targets. Breadcrumbs may hide earlier ancestors
on narrow screens, but the current location remains visible.

## Elevation & Depth

Depth is quiet and structural.

- Use a one-pixel border as the default separator.
- Use subtle shadows only for floating layers such as menus, dialogs, and drawers.
- Do not stack border, heavy shadow, and contrasting background on the same surface.
- Do not use gradients, glass effects, or colored glows in the product shell.

## Shapes

The default radius is 8px. Use 4px for small inline elements, 8px for controls and
navigation selection, and 12px for larger floating surfaces. Pills are reserved for
statuses, compact filters, and naturally circular controls; they are not the default
button shape.

Icons use Lucide, normally at 16px with a 1.8 stroke. Use 14px inside compact controls
and 18px only where an icon needs more visual authority. Icons inherit the semantic
text color of their role.

## Components

### Navigation shell

- The sidebar and breadcrumb bar share `surface`; the workspace uses `background`.
- The product title and collapse control share one row when the sidebar is expanded.
- The expand control moves to the breadcrumb bar when the sidebar is collapsed.
- Section labels are visually quieter than navigation destinations.
- The selected destination uses `selected` plus stronger text, not a chromatic accent.
- Preferences is a standalone footer destination pinned to the bottom of the sidebar.
  It is not a navigation group. When selected, it uses the same neutral selected state
  as primary navigation.
- Breadcrumb items are links. The current location uses stronger text and
  `aria-current="page"`.
- Preferences is a top-level destination, so its breadcrumb contains one clickable
  `Preferences` item rather than inheriting workflow ancestry.

### Preferences

- Center preference content in a readable column with generous outer padding.
- Let the top breadcrumb carry the page identity; begin content with the first category
  heading instead of repeating a page title.
- Each category has a heading above one bordered `surface` containing one or more rows.
- A preference row pairs a concise name and description with its control. Stack the
  control below the copy when horizontal room is limited.
- The initial category is `Interface`; its initial row is named `Theme`.
- Theme is one mutually exclusive choice: `Light`, `Dark`, or `System`. Exactly one is
  always selected.
- `System` follows the operating system color scheme. Selecting Light or Dark creates
  an explicit override.
- Present the three options as an accessible radio group inside a neutral segmented
  control. Selection is communicated by text contrast, a border, and a raised neutral
  surface rather than a chromatic accent.

### Theme selector motion

- Use one shared selection surface that travels between options; do not animate three
  independent button backgrounds.
- Position the surface from the selected option's measured offset and width.
- Move it over 250ms with `cubic-bezier(0.22, 1, 0.36, 1)`.
- On first paint and resize, position it without a transition so it never slides in
  from an incorrect origin.
- Remove the transition when `prefers-reduced-motion: reduce` is active.

### Provider and connector catalogs

- SQLite is the source of truth for supported provider and connector catalog entries;
  the API returns that catalog together with current connection state. The frontend
  must not maintain a parallel list of names, descriptions, setup steps, or links.
- If the catalog request fails, show the unavailable state and no catalog cards. Never
  fabricate providers or connectors from client-side fallback data.
- Providers and connectors use the same catalog component and interaction model. Start
  each catalog from the main workspace's left content edge. Do not center a short final
  row or introduce a narrow maximum-width wrapper.
- Both routes use the same 24px horizontal and top padding around the catalog. The grid is left-aligned and
  uses responsive `minmax(18rem, 1fr)` columns so additional providers fill available
  space without imposing an arbitrary three-column ceiling.
- Grid cards and list rows share the same information order, status treatment, and
  whole-surface interaction. Do not add a secondary `View setup` action.
- The grid/list selector is an icon-only accessible radio group using the same moving
  neutral selection surface and motion rules as the Theme selector.
- Provider and connector details open in a floating, non-modal right drawer contained
  by the main workspace. It must not overlap the breadcrumb bar, shift layout, dim
  content, or disable background interaction.
- The drawer enters and exits horizontally over 350ms. Clicking elsewhere closes it
  while preserving the underlying interaction, and reduced motion removes the travel.
- Provider and connector brand marks may keep their identity colors; surrounding UI
  stays neutral and semantic.

### Keyboard interaction

- `B` toggles the sidebar between expanded and collapsed states.
- `D` toggles the effective light and dark appearance. When System is selected, using
  `D` changes the preference to the explicit opposite mode.
- Single-letter shortcuts only run when focus is outside text inputs, textareas,
  selects, and editable content.
- Ignore repeated keydown events and shortcuts combined with Control, Command, or Alt.
- Visible controls that expose a shortcut show it with the ShadCN `Kbd` component in
  their tooltip.

### Controls and states

- Every interactive element has visible hover, focus-visible, active, and disabled
  states in both modes.
- Focus uses the semantic `focus` token and must not depend on hover styling.
- Keep labels explicit. Icon-only controls require an accessible name and a tooltip.
- Loading, empty, success, warning, and error states preserve the neutral layout and
  introduce only the minimum semantic color needed to communicate state.

## Do's and Don'ts

### Do

- Build hierarchy with spacing, typography, neutral contrast, and alignment.
- Validate every component in light and dark mode at the same time.
- Keep chrome quieter than the user's workflow content.
- Use semantic tokens so mode changes do not require component overrides.
- Pair signal color with an icon, label, or explicit status text.
- Preserve keyboard access, clear focus, and at least 44px effective pointer targets
  where touch interaction is expected.

### Don't

- Do not introduce a default brand accent to make the interface feel designed.
- Do not use pure black or pure white as large dark-mode surfaces.
- Do not lower secondary text contrast until it becomes decorative or unreadable.
- Do not change layout, type scale, or information priority between color modes.
- Do not use excessive rounding, floating cards, heavy shadows, or gradients.
- Do not create a second theme path for future Preferences controls; all theme entry
  points must operate on the same semantic tokens and state.
