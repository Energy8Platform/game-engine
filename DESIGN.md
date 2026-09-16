---
version: alpha
name: modern-ui-shell-design
description: The IDE shell restyled to VS Code 1.137.0 with `workbench.experimental.modernUI` on, default density — floating cards with 4px gaps and 8px corners, pill tabs, a status bar on the window ground — measured from the VS Code sources and restated as the `--e8-*` tokens this codebase owns.
---

# The IDE shell, after Modern UI

The previous document (git `0b74e2f`) took VS Code's anatomy and a flat
palette "without claiming a specific version". This one names the version:
VS Code 1.137.0 with `workbench.experimental.modernUI: true`, density
`default`. The anatomy is the same five regions in the same five slots of
the `shell` service (`engine/ide/client/src/plugins/shell.tsx`, drawn by
`engine/ide/client/src/shell/Shell.tsx`); what changed is the form. Slice 7
drew four planes butted edge to edge, separated by hairlines and stepped
through four background levels. Modern UI draws **cards**: the sidebar, the
editor group and the panel float on the window's background with a 4px gap,
an 8px corner and a 1px border, and nothing touches the window edge. Every
number below was read from the VS Code sources at tag `1.137.0`, not from a
screenshot: `src/vs/workbench/contrib/modernUI/browser/media/*.css`,
`src/vs/workbench/browser/media/floatingPanels.css`,
`src/vs/workbench/services/layout/browser/layoutService.ts`,
`src/vs/platform/theme/common/sizes/baseSizes.ts`,
`src/vs/workbench/common/theme.ts`, and
`extensions/theme-defaults/themes/{dark,light}_modern.json`. The decision
record is `docs/superpowers/specs/2026-09-13-modern-ui-design.md`.

## 2. Anatomy

```
┌ shell-bg, padding 4px ─────────────────────────────────────┐
│ ┌AB┬─sidebar──┐ 4px ┌─editors (tabs + doc)───────────────┐ │
│ │  │          │     │                                    │ │
│ │  │          │     └────────────────────────────────────┘ │
│ │  │          │ 4px ┌─panel──────────────────────────────┐ │
│ └──┴──────────┘     └────────────────────────────────────┘ │
│ status bar (no border, on shell-bg)                        │
└────────────────────────────────────────────────────────────┘
```

| Region       | Class          | Default size                                    | Slot             |
| ------------ | -------------- | ----------------------------------------------- | ---------------- |
| Activity bar | `.e8-activity` | `--e8-activity-w` (56px)                        | `shell.activity` |
| Sidebar      | `.e8-sidebar`  | `--e8-sidebar-w` (260px), collapses to 0        | `shell.sidebar`  |
| Editor group | `.e8-editors`  | remaining width                                 | `shell.document` |
| Panel        | `.e8-panel`    | `--e8-panel-h` (200px), collapses to its header | `shell.panel`    |
| Status bar   | `.e8-status`   | `--e8-status-h` (22px)                          | `shell.status`   |

Three cards and one strip:

- **Activity bar + sidebar are one card.** The activity bar is 56px wide —
  VS Code's 48px bar plus its 8px `--modern-ui-activitybar-lane` — and is
  rounded only on its left (`var(--e8-radius-lg) 0 0 var(--e8-radius-lg)`)
  with no right border; the sidebar is rounded only on its right and keeps
  its left border, so the seam between them is one line. When the sidebar
  is collapsed the activity bar gets all four corners and its right border
  back. Each activity button is 48×36 with a 32×32 indicator drawn by its
  `::before` (`inset: 2px 8px`, radius 4px); hover and `aria-pressed` paint
  that indicator, never the button, and the pressed icon takes `--e8-fg`
  while the others sit at `--e8-fg-inactive`.
- **The editor group is its own card**, `--e8-editor-bg` all the way down:
  the tab row is transparent on it, 32px tall, with no line under it; each
  tab is a 24px pill with a 4px radius, the selected one filled with
  `--e8-selected`, a hovered one with `--e8-hover`, the rest transparent.
  The card is `overflow: hidden`, which is what clips the document to the
  corners.
- **The panel is its own card** under the editor group only, the same width
  as the tabs above it, painted `--e8-surface` like the sidebar.
- **The status bar is not a card.** It lies on `--e8-shell-bg` with no
  border; its items are 4px-radius pills that take `--e8-status-hover`.

The shell itself has `padding: var(--e8-gap) var(--e8-gap) 0` and each card
a `margin` of one gap on the side facing its neighbour, so the 4px between
any two cards and the 4px to the window edge are the same token. Sidebar
and panel are resized by dragging their shared edge (`Shell.tsx`'s
`useResize`, reading `--e8-sidebar-w` / `--e8-panel-h`), the chosen size
kept in `localStorage` for this browser — a convenience, not state. The
drag handle is transparent and carries one 2px dot at its centre, fg at
30%, that disappears on hover and while dragging. Clicking the pressed
activity button collapses the sidebar; the panel's toggle collapses it to
its 28px header.

## 3. Principles

- **Cards, not planes.** A region floats by its gap and its border, never
  by a shadow; every `box-shadow` in the stylesheet is `none`.
- **Two shapes.** `--e8-radius-lg` (8px) for a card; `--e8-radius-sm` (4px)
  for a thing inside one — a tab, an activity indicator, a status item, a
  list row, a button, an input, a badge. There is no third radius.
- **Hover and selected are states, not steps.** `--e8-hover` and
  `--e8-selected` are two named colours applied to a row, a tab or a
  section header when it is in that state. They are not a lighter or
  darker "level" of chrome, and no region is painted with them at rest; the
  badge (`.e8-badge`) borrows `--e8-selected` for lack of a token of its
  own, the way VS Code gives it `badge.background`.
- **One border.** `--e8-border` draws the card frames and every hairline
  inside them. One line, reused.
- **One accent.** `--e8-accent` is spent on focus (`:focus-visible` only)
  and primary buttons. It is not on the pressed activity button — that is
  a grey indicator with the icon in `--e8-fg` — and not on the active tab,
  which is a filled pill with no line under it.
- **Headings.** View titles (Explorer, Diagnostics) and section headers are
  `--e8-size-label` (12px) at weight 600, written as they are — VS Code's
  default is `text-transform: capitalize` and its uppercase setting is
  off; ours sets no `text-transform` at all. Never uppercase, no
  `letter-spacing`.
- **Type ramp.** `--e8-size` 13px for the body (`body1`), `--e8-size-label`
  12px for titles and the status bar (`label1`), `--e8-size-small` 11px
  (`label2`), `--e8-size-badge` 10px (`label3`). Weights 400 and 600 for
  text; controls, labels and badges keep 500 from the previous palette
  (`button`, `label`, `.e8-badge`, `legend`). The system UI stack for the
  shell, a monospace stack for the editor and any code fragment inline.
- **Text.** `--e8-fg` for anything meant to be read, `--e8-fg-muted` for a
  hint, a byline, a disabled state; `--e8-fg-inactive` only for an
  unpressed activity icon.
- **Severity keeps its own colours** (`--e8-error`, `--e8-warning`,
  `--e8-info`, `--e8-success`); none of them is the layout accent.
- **Region sizes are tokens.** Anything that reads a size in JS reads the
  same custom property as the stylesheet, never a duplicated literal.
- **Density is `default`.** VS Code's `compact` density (0px gaps, one
  shared frame, gradient corners) exists and is out.
- **Copy is English throughout.** Localisation, when it comes, is a
  dictionary — not a second set of strings in the components.

## 4. Tokens

Copied from `engine/ide/client/src/styles.css` — the stylesheet is the
source, this block is a mirror of it. Dark lives on bare `:root` and needs
no attribute; `[data-theme='light']` redefines every colour token, name for
name. Sizes and fonts do not change between themes and live only on
`:root`.

```css
:root {
  /* surfaces */
  --e8-shell-bg: #181818;
  --e8-surface: #181818;
  --e8-editor-bg: #1f1f1f;
  --e8-border: #2a2a2a;
  /* Video letterbox — stays black in both themes, like a real screen. */
  --e8-video-bg: #000000;
  /* states */
  --e8-hover: #2a2d2e;
  --e8-selected: #37373d;
  --e8-activity-hover: #ffffff11;
  --e8-activity-active: #ffffff22;
  --e8-status-hover: #f1f1f133;
  /* text and accent */
  --e8-fg: #cccccc;
  --e8-fg-muted: #9d9d9d;
  --e8-fg-inactive: #868686;
  --e8-accent: #0078d4;
  --e8-on-accent: #ffffff;
  --e8-error: #f85149;
  --e8-warning: #cca700;
  --e8-info: #3794ff;
  --e8-success: #89d185;

  /* shape */
  --e8-gap: 4px;
  --e8-radius-lg: 8px;
  --e8-radius-sm: 4px;
  --e8-activity-w: 56px;
  --e8-sidebar-w: 260px;
  --e8-panel-h: 200px;
  --e8-status-h: 22px;
  --e8-title-h: 32px;
  --e8-tab-h: 24px;
  --e8-header-h: 28px;

  --e8-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --e8-font-mono:
    ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace;
  --e8-size: 13px;
  --e8-size-label: 12px;
  --e8-size-small: 11px;
  --e8-size-badge: 10px;
}

[data-theme='light'] {
  --e8-shell-bg: #f8f8f8;
  --e8-surface: #ffffff;
  --e8-editor-bg: #ffffff;
  --e8-border: #e5e5e5;
  /* Same black in both themes — a video stays on black regardless. */
  --e8-video-bg: #000000;
  --e8-hover: #f0f0f0;
  --e8-selected: #e4e6f1;
  --e8-activity-hover: #f2f2f2;
  --e8-activity-active: #e4e6f1;
  --e8-status-hover: #1f1f1f11;
  --e8-fg: #3b3b3b;
  --e8-fg-muted: #616161;
  --e8-fg-inactive: #616161;
  --e8-accent: #005fb8;
  --e8-on-accent: #ffffff;
  --e8-error: #f85149;
  --e8-warning: #b58900;
  --e8-info: #1a85ff;
  --e8-success: #388a34;
}
```

Four guards in `engine/ide/client/tests/styles.test.ts` hold this in place:

1. _every colour in the stylesheet is a token, not a literal_ — outside the
   two blocks above, a colour is a `var(--e8-*)` reference or it fails;
2. _no rule reads a retired token name_ — no `--e8-bg-<n>`, no bare
   `--e8-radius`;
3. _every box-shadow is none_;
4. _every border-radius is built from the two radius tokens and 0_ — a
   literal `px` in a radius is a third shape nobody decided on.

None of them can tell whether a screen uses the right token for the right
job; that is still a design review's call.

## 5. Themes

Dark is the default and needs no attribute. Light is `<html
data-theme="light">`, chosen by the toggle in the status bar
(`ThemeStatus`, `engine/ide/client/src/shell/StatusItems.tsx`) and
persisted under `localStorage['e8.theme']`. Read once, at module load —
before the first paint — so a returning visitor never sees a dark flash
before the page flips to light; a `localStorage` that throws (a private
window) degrades to the dark default rather than breaking that paint.

Monaco has its own default backgrounds (`#1e1e1e` / `#ffffff`), and the
dark one is a visible 1px seam against the editor card's `#1f1f1f`. So
`engine/ide/client/src/editor/Monaco.tsx` defines two themes, `e8-dark`
(base `vs-dark`) and `e8-light` (base `vs`), each on first use, reading
`--e8-editor-bg` from `:root` at that moment and setting it as
`editor.background`; `data-theme` picks which one an editor gets. Without
the token (a test with no stylesheet) the theme is defined with no
colours — Monaco's default, the seam, no throw. Token colours come from
Monaco's `vs-dark`/`vs` themes through `e8-dark`/`e8-light`'s `inherit:
true`; the shell defines no token rules of its own.

## 6. What this replaces

The previous document is at git `0b74e2f` (`DESIGN.md`, name
`vscode-shell-design`). Gone with it:

- the four-level background ladder `--e8-bg-0..3` — replaced by three named
  surfaces (`--e8-shell-bg`, `--e8-surface`, `--e8-editor-bg`) and two
  state colours (`--e8-hover`, `--e8-selected`);
- the bare `--e8-radius` (3px on everything) — replaced by `--e8-radius-lg`
  and `--e8-radius-sm`;
- `--e8-size-status` — replaced by `--e8-size-label`, which the view titles
  now share with the status bar;
- the accent stripe on the pressed activity button — now a grey indicator;
- the line under the tab strip, the right border on every tab and the
  accent line under the active one — the tab is a pill;
- the line above the status bar — it lies on the window ground;
- the `#007acc` accent — now `#0078d4` (light: `#005fb8`, unchanged);
- the 48px activity bar — now 56px.

The screens' own class names (`.e8-row`, `.e8-diagnostic-row`,
`.e8-explorer-entry`, …) are unchanged; only what they paint with is.

## 7. What was deliberately not copied

- **The panel's light background.** VS Code paints the panel
  `panel.background #F8F8F8` in light, not white; ours is `--e8-surface`,
  the same as the sidebar. One surface for every chrome card is fewer
  tokens, and in dark the two values are the same anyway.
- **The three-dot sash grip.** VS Code draws three 2px dots; the shortest
  way to draw three with one pseudo-element is `box-shadow`, which guard 3
  forbids. Ours is one dot.
- **Codicons.** The activity bar keeps its SVG outlines and letters; a
  bundled icon font is another slice.
- **The title bar and command centre.** We have neither; the top of the
  shell behaves as VS Code's `top-window-edge` — 4px to the window edge.
- **Compact density**, and with it the shared frame and gradient corners.
- **The 8px WebKit scrollbar styling.** Scrollable regions use
  `scrollbar-width: thin`.
