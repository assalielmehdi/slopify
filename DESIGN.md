---
name: Slopify
colors:
  primary: '#1C1C1C'
  light:
    background: '#FFFFFF'
    foreground: '#1C1C1C'
    surface: '#FFFFFF'
    surfaceForeground: '#1C1C1C'
    sidebar: '#FFFFFF'
    muted: '#F1F1F3'
    mutedForeground: '#6A6B70'
    subtleForeground: '#55565A'
    accent: '#F3F3F5'
    border: '#DCDCE0'
    sidebarBorder: '#E7E7E9'
    selected: '#EAEAEC'
    focus: '#1C1C1C'
  dark:
    background: '#000000'
    foreground: '#F1F1F2'
    surface: '#000000'
    surfaceForeground: '#F1F1F2'
    sidebar: '#000000'
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
elevation:
  light:
    raised: '0 1px 2px rgb(24 24 27 / 3%)'
    raisedHover: '0 2px 6px rgb(24 24 27 / 4%)'
    overlay: '0 8px 24px rgb(24 24 27 / 7%), 0 1px 3px rgb(24 24 27 / 4%)'
  dark:
    raised: '0 1px 2px rgb(0 0 0 / 12%)'
    raisedHover: '0 2px 6px rgb(0 0 0 / 14%)'
    overlay: '0 8px 24px rgb(0 0 0 / 24%), 0 1px 3px rgb(0 0 0 / 16%)'
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

Slopify is a native agent workflow orchestrator for technical users. Its interface should
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
`background`, `surface`, `sidebar`, `foreground`, `mutedForeground`, `border`,
`selected`, and signal roles. They do not select a gray because it happens to look
right in one mode.

### Neutral hierarchy

- `foreground` is reserved for page titles, active destinations, primary values, and
  decisive actions.
- `subtleForeground` is for ordinary navigation and secondary interface copy.
- `mutedForeground` is for section labels, metadata, descriptions, placeholders, and
  nonessential context. It must remain readable; muted never means disabled.
- `sidebar` is the navigation canvas, including the product title and collapse control
  row. It always resolves to the same color as `background`.
- `background` is the base work surface used by the breadcrumb bar and main area.
- `surface` is used by cards, tables, forms, sheets, menus, and dialogs. Ordinary
  content surfaces use the same color value as `background`; their boundaries come
  from spacing, borders, and intentional elevation rather than a different fill.
- `selected` identifies the current neutral selection without introducing an accent.
- `border` and `sidebarBorder` define structure quietly. Prefer borders over shadows.
- `input` resolves to `border`, so resting fields and selectors use the same quiet
  boundary as table rows and section delimiters. Focus strengthens only the control
  border; inputs, textareas, and selectors never add a focus halo or shadow.

### Light mode

Light mode uses one pure white canvas across the navigation, breadcrumb bar, main area,
cards, tables, forms, and sheets. Text uses warm, near-black gray rather than pure
black. Selection and hover states are neutral gray.

Do not recreate hierarchy by tinting ordinary content containers. Begin with spacing
and typography, add a one-pixel boundary when grouping is otherwise unclear, and add
the lowest suitable shadow only when a surface is meaningfully raised.

### Dark mode

Dark mode is designed independently, not produced by inverting light mode.

- Use one pure black canvas across the navigation, breadcrumb bar, work surface, and
  ordinary content.
- Primary text is soft white rather than pure white. Secondary text is lighter than in
  light mode so it keeps equivalent perceived importance.
- Borders must remain visible without becoming luminous outlines.
- Hover and selected states become lighter neutral surfaces, never colored glows.
- The breadcrumb bar, main work area, navigation, and ordinary content remain one
  surface.
- Dark shadows are less perceptible, so borders, spacing, typography, and neutral
  interaction states carry the separation.
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

- Use whitespace and alignment before adding a visible container.
- Use a one-pixel border as the default boundary for cards, tables, fields, and grouped
  rows that still need explicit containment.
- Use `raised` only for standalone cards, workflow nodes, and interactive catalog
  tiles. It is a nearly imperceptible single-layer shadow; hover may increase it by one
  restrained step.
- Use `overlay` only for content floating above the page: drawers, sheets, menus,
  popovers, and dialogs. It should register as depth without presenting a visibly dark
  halo. Pair it with a crisp border, especially in dark mode.
- Ordinary nested sections remain flat. Do not stack multiple raised materials or add
  a shadow when spacing and a border already communicate the relationship.
- Never combine a heavy shadow with a contrasting ordinary-content fill.
- Do not use gradients, glass effects, or colored glows in the product shell.

## Shapes

The default radius is 8px. Use 4px for small inline elements, 8px for controls and
navigation selection, and 12px for larger floating surfaces. Pills are reserved for
statuses, compact filters, and naturally circular controls; they are not the default
button shape.

Tags and badges never use borders. Their semantic background and text color carry the
entire visual treatment; interactive tags retain a visible external focus ring.

Icons use Lucide, normally at 16px with a 1.8 stroke. Use 14px inside compact controls
and 18px only where an icon needs more visual authority. Icons inherit the semantic
text color of their role.

## Components

### Navigation shell

- The sidebar, breadcrumb bar, and workspace use the same base `background` color. The
  `sidebar` token remains available for navigation-specific semantics but resolves to
  that same color.
- The sidebar title row is part of the sidebar plane; do not detach the logo or collapse
  control onto the work surface.
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
  Its fill matches the work surface; a quiet raised shadow may reinforce the group.
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

### Harnesses

- Harnesses are discovered from the host through the API; the frontend never maintains
  a parallel availability or model catalog. Harness setup remains external to Slopify.
- Keep this screen deliberately minimal while Pi is the only harness: one left-aligned
  bordered surface showing its name, installed version when available, availability,
  and a short explanation that configuration remains in Pi.
- When Pi is unavailable, show the reason and one link to the official installation
  page. Never imply that Slopify can install or configure it.
- Model metadata may be summarized. Detailed agent selection belongs in the workflow
  agent drawer.

### Project catalog

- Projects are local Git repositories identified by one canonical absolute path. The
  add flow asks only for that path; the API validates that it exists and is the root of
  a Git repository before persisting it.
- After the API confirms a Project was added, close the add drawer and show a success
  toast naming the Project. Never show success before persistence completes.
- Use a left-aligned responsive card catalog, whole-surface tiles, and the standard
  contained floating drawer.
- Derive availability from the filesystem whenever Projects are listed or used. Never
  remove a saved Project merely because its path is unavailable.
- A missing Project remains in its original catalog position with a muted tile and the
  explicit status `Can't find in file system`. Color or opacity alone is insufficient.

### Workflow editor

- A workflow screen presents the single current workflow graph. Do not expose revision
  selectors, revision IDs, version ancestry, or publication controls.
- Every workflow node is an agent. One agent can be the entire workflow.
- An empty workflow is a valid draft state. Give it a calm, actionable empty canvas,
  but disable running it and explain that at least one agent is required.
- Keep a compact workflow configuration action directly beside Run. It opens the same
  contained, non-modal floating right drawer used by agent configuration.
- Workflow configuration contains Projects and Variables. Projects are selected from
  Slopify's live Project catalog and apply to every agent in the workflow. Variables are
  an ordered list of unique, non-empty names requested whenever a run starts.
- Let the graph fill the workspace remaining below the application header. Keep the
  page itself fixed to the viewport; graph pan and zoom belong to the canvas.
- Workflow nodes use the standard neutral card treatment. In a run snapshot, a node's
  whole surface adopts the corresponding semantic success, danger, warning, or info
  treatment while retaining an icon and explicit status label.
- Agent drawers use one proximity hierarchy on the 4px spacing grid: 4px between a
  section heading and its description, 8px between a visible field label and its
  control, 12px between the section introduction and its fields or between related
  field rows, and 32px between Name, Prompt, and Harness.
  Repeated section titles do not require a second visible field label; keep the label
  accessible to assistive technology without adding it to the visual rhythm.
- Harness configuration is limited to the selected harness plus optional model and
  thinking effort supported by that harness. Explain that the rest of harness setup is
  external to Slopify.

### Run variables

- Starting a run shows one read-only name and one value field for every variable
  declared in the selected workflow. Do not scan prompts to create rows, and do not
  allow adding, removing, or renaming variables from the run form.
- Values accept JSON scalars, objects, and arrays. When entered text is not valid JSON,
  preserve it as a string rather than inventing a second input mode.
- Require a value for every configured name before enabling Start. The API accepts
  exactly those names and rejects missing or additional entries.
- Interpolate only placeholders whose names are declared by the workflow. Leave
  undeclared placeholders unchanged so prompt typos are visible rather than inferred.

### Data tables

- Before using a native browser control or building a bespoke component, use the
  matching component from the configured ShadCN system. Compose ShadCN primitives for
  combined patterns such as date pickers, and fall back only when no suitable ShadCN
  component exists.

- Tables occupy the full horizontal width of their main workspace surface. Do not wrap
  them in a card, rounded container, enclosing border, contrasting fill, or elevation.
- A full-width utility strip precedes the column headers. It holds the current scope or
  result count, quick filters, and filter configuration when those controls exist.
  Render only working controls; never add inert filter placeholders to reserve space.
- Sorting belongs in sortable column headers, beside the label. The complete control
  is keyboard accessible, exposes `aria-sort`, and uses a directional icon to show the
  active order.
- Use quiet horizontal separators between the utility strip, header, rows, and footer.
  Avoid vertical rules unless column grouping would otherwise be ambiguous.
- Keep dense tabular content on one line and allow the table region to scroll
  horizontally at narrow widths instead of compressing values into unreadable cells.
- Pagination and result totals form a flat footer row aligned to the same column inset;
  they are part of the table flow, not a separate card.
- Keep table filter configuration and pagination controls borderless. Hover and focus
  treatments communicate interactivity while table separators and filter chips carry
  the visible structure.
- Place applied-filter chips at the far left of the utility strip and the filter button
  at the far right. Each chip names and summarizes one attribute filter; its remove
  affordance appears on hover and keyboard focus and clears that attribute everywhere.
  At rest, a chip fits its label with no reserved remove-button space. Hover or focus
  smoothly expands its trailing edge to reveal the button, and leaving reverses the
  same transition.
- The filter button badge counts active attributes. Inside its popover, keep a search
  input directly above the attribute list with no redundant category heading, and show
  each attribute's selected-value count beside its icon and label.
- Attribute editors match the data type: free text uses an input, bounded numbers use
  paired range inputs, dates use paired ShadCN calendar pickers, and enumerations use
  accessible single- or multi-selection controls. Filters apply to the complete
  server-backed result set before pagination, and the URL preserves them across table
  pages.
- When a filter update keeps the previous rows visible while the next server result is
  loading, mark the table region busy and pair reduced row opacity with explicit
  updating text. Never leave retained stale rows looking current.

### Run history

- Run history is a ShadCN table with exactly four informational columns: Run ID,
  Started, Duration, and Status.
- Keep the utility strip empty on the left when no filters are applied; do not show an
  `All runs` label or duplicate the total already present in the pagination footer.
- Run IDs use monospace and remain directly navigable. Started time and duration use
  stable, scan-friendly formatting.
- Status is a compact ShadCN badge. Success is green, failure is red, active execution
  is informational, and pending or cancelled states remain neutral or warning as
  appropriate. Status color is always paired with its text label.
- Status filter options use plain toggle buttons rather than nested badges. Each label
  uses its semantic status color, and its hover and selected backgrounds use a quiet
  tint of that same hue. Selection remains explicit through the button state and check
  icon, never color alone.
- Do not include workflow versions, revisions, or configuration columns that duplicate
  information available inside a run.

### Run detail

- A run is the immutable historical capture of its workflow, every agent configuration,
  and its configured variable values at admission. The detail UI always renders that
  capture; it must never fetch the current workflow to reconstruct historical state.
- The top of the screen contains one wide ShadCN Card with the Run ID, Status, Started,
  and Duration. A running run may keep a compact cancel action in this card.
- The rest of the desktop screen is the read-only workflow canvas. Do not append
  additional summary sections beneath it.
- Opening an agent uses the standard contained, non-modal floating right panel. It does
  not shift the graph, overlap the application header, add
  a backdrop, trap focus, or block interaction with the canvas.
- The panel shows the captured harness and version, optional model and thinking effort,
  primary Project and run worktree paths, result/timeout data, execution status and
  timing, errors or output, and available agent transcript messages.
- The panel enters from and exits toward the right over 350ms using the catalog drawer
  easing. Clicking elsewhere begins its exit while allowing that underlying
  interaction. Long panel content scrolls inside the panel; the run page does not.
- The floating panel uses `overlay` elevation. Configuration blocks inside it remain
  flat on the panel surface unless a semantic status requires a signal fill.

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
- Keep the navigation, breadcrumb, work area, and ordinary content on one base surface.
- Choose the lowest border and elevation treatment that still makes grouping clear.
- Validate every component in light and dark mode at the same time.
- Keep chrome quieter than the user's workflow content.
- Use semantic tokens so mode changes do not require component overrides.
- Pair signal color with an icon, label, or explicit status text.
- Preserve keyboard access, clear focus, and at least 44px effective pointer targets
  where touch interaction is expected.

### Don't

- Do not introduce a default brand accent to make the interface feel designed.
- Do not introduce alternate neutral canvas fills to separate application regions.
- Do not lower secondary text contrast until it becomes decorative or unreadable.
- Do not change layout, type scale, or information priority between color modes.
- Do not use excessive rounding, floating cards, heavy shadows, or gradients.
- Do not use different neutral fills merely to make every content group look like a
  card.
- Do not create a second theme path for future Preferences controls; all theme entry
  points must operate on the same semantic tokens and state.
