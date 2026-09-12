---
version: alpha
name: vscode-shell-design
description: A flat, dense developer-tool interface, laid out on the anatomy of VS Code (activity bar, sidebar, editor group, panel, status bar) and finished in the colours of its own default dark theme, without claiming a specific version of either. No source-of-truth screenshot was measured pixel-for-pixel; the shapes and roles are what carried over, restated as tokens this codebase owns.
---

# The IDE shell, after VS Code

Replaces the previous `Cal.com-design-analysis` entirely — that palette
belonged to a marketing site and never fit a tool a person stares at for
hours. See `docs/superpowers/specs/2026-09-11-vscode-shell-design.md` §7
for the decision this document implements, and
`engine/ide/client/src/shell/Shell.tsx` for the component that draws the
anatomy below.

## 1. Why VS Code

Not because it is fashionable. Every region below has a job a developer
already knows without being told, and the layout survives growth: a new
capability is a button and a view, not another tab crowding the top bar —
see the parent spec §1 for the tab-sprawl this replaced.

## 2. Anatomy

```
┌──┬───────────┬────────────────────────────────┐
│  │           │ ◦ script.spin  ◦ Состав  × ... │  ← document tabs
│AB│  sidebar  ├────────────────────────────────┤
│  │           │                                │
│  │           │        active document         │
│  │           │                                │
│  │           ├────────────────────────────────┤
│  │           │ panel: Diagnostics (3)          │
├──┴───────────┴────────────────────────────────┤
│ status bar: first-slot · e8-server ● · 2 dirty │
└───────────────────────────────────────────────┘
```

Five regions, each one slot in the `shell` service
(`engine/ide/client/src/plugins/shell.tsx`) and one class in `styles.css`:

| Region | Class | Default size | Slot |
|---|---|---|---|
| Activity bar | `.e8-activity` | `--e8-activity-w` (48px) | `shell.activity` |
| Sidebar | `.e8-sidebar` | `--e8-sidebar-w` (260px), collapses to 0 | `shell.sidebar` |
| Editor group | `.e8-editors` | remaining width | `shell.document` |
| Panel | `.e8-panel` | `--e8-panel-h` (200px), collapses to its header | `shell.panel` |
| Status bar | `.e8-status` | `--e8-status-h` (22px) | `shell.status` |

The activity bar and the sidebar run the full height above the status bar;
the panel sits only under the editor group, the same width as the tabs and
the document above it — not under the sidebar. The status bar is the one
region that spans the whole width, at the very bottom.

Sidebar and panel are meant to be resized by dragging their shared border,
with the chosen width/height kept in `localStorage` for this browser — a
convenience, not state, so a page that starts with nothing stored still
draws the defaults above. (The drag interaction itself is a later slice;
this document specs the sizes it will read and write, all of them tokens.)

## 3. Principles

- **Flat.** No shadows, no gradients. A raised look comes from a different
  `--e8-bg-*` level or the one `--e8-border` line, never from a blur.
- **Small radius.** `--e8-radius` is 3px, used on buttons, inputs and
  badges alike. Nothing on this screen gets the Cal.com-era 12px card
  corners — a chrome region is not a marketing card.
- **Four background levels**, darkest number = most chrome:
  - `--e8-bg-0` — the editor / a document's own body, the surface a person
    is actually looking at.
  - `--e8-bg-1` — sidebar and panel, one step of chrome around it.
  - `--e8-bg-2` — document tabs and the status bar, a second step.
  - `--e8-bg-3` — the activity bar, the outermost edge.
- **One border.** `--e8-border` draws every hairline this UI has — between
  regions, under a tab, around a field. Not four hairline shades the way
  the old palette had; one line, reused.
- **One accent.** `--e8-accent` marks the active tab, a focused control,
  the pressed activity button. It is not spent on decoration elsewhere.
- **Text.** `--e8-fg` for anything meant to be read, `--e8-fg-muted` for
  everything secondary (a hint, a disabled state, a byline) — the same two-
  step ladder VS Code's own theme uses instead of a five-shade grey scale.
- **Severity keeps its own three colours** (`--e8-error`, `--e8-warning`,
  `--e8-info`) — diagnostics have to stay readable at a glance across a
  list, which "one accent for everything" cannot do; `--e8-success` exists
  for the rare case that needs it. None of the four are the layout accent.
- **Type.** The system UI stack (`-apple-system, "Segoe UI", …`) at 13px
  base, 12px in the status bar; a monospace stack for the editor and for
  any diagnostic/code fragment shown inline. No bundled webfont — the
  previous document's Inter/Cal Sans substitution is gone with the palette
  it served.
- **Region sizes are tokens**, not numbers sprinkled through the
  stylesheet — see the table in §2. Anything that reads a size in JS (a
  drag handle clamping its range, a persisted width) reads the same custom
  property, never a duplicated literal.

## 4. Tokens

Defined once on bare `:root` (dark, the default — no attribute needed) and
redefined, name-for-name, under `[data-theme="light"]`. Sizes and fonts do
not change between themes and live only on `:root`.

```css
:root {
  --e8-bg-0: #1e1e1e;
  --e8-bg-1: #252526;
  --e8-bg-2: #2d2d2d;
  --e8-bg-3: #333333;
  --e8-border: #3c3c3c;
  --e8-fg: #cccccc;
  --e8-fg-muted: #969696;
  --e8-accent: #007acc;
  --e8-on-accent: #ffffff;
  --e8-error: #f14c4c;
  --e8-warning: #cca700;
  --e8-info: #3794ff;
  --e8-success: #89d185;

  --e8-radius: 3px;
  --e8-activity-w: 48px;
  --e8-sidebar-w: 260px;
  --e8-panel-h: 200px;
  --e8-status-h: 22px;

  --e8-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --e8-font-mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace;
  --e8-size: 13px;
  --e8-size-status: 12px;
}

[data-theme='light'] {
  --e8-bg-0: #ffffff;
  --e8-bg-1: #f3f3f3;
  --e8-bg-2: #ececec;
  --e8-bg-3: #e0e0e0;
  --e8-border: #d4d4d4;
  --e8-fg: #1f1f1f;
  --e8-fg-muted: #6e6e6e;
  --e8-accent: #005fb8;
  --e8-on-accent: #ffffff;
  --e8-error: #cd3131;
  --e8-warning: #b58900;
  --e8-info: #1a85ff;
  --e8-success: #388a34;
}
```

A guard test (`engine/ide/client/tests/styles.test.ts`) enforces the first
half of this: every colour in `styles.css` outside these two blocks has to
be a `var(--e8-*)` reference. It cannot enforce that a screen actually USES
the right token for the right job — that is still a design review's call,
the same as it always was.

## 5. Themes

Dark is the default and needs no attribute. Light is `<html
data-theme="light">`, chosen by the toggle in the status bar
(`ThemeStatus`, `engine/ide/client/src/shell/StatusItems.tsx`) and
persisted under `localStorage['e8.theme']`. Read once, at module load —
before the first paint — so a returning visitor never sees a dark flash
before the page flips to light; a `localStorage` that throws (a private
window) degrades to the dark default rather than breaking that paint.

## 6. What this replaces

The whole previous document — the Cal.com marketing palette, its 12px/16px
card radii, its two-tier shadow system, its Cal Sans/Inter display type —
served the four screens `Layout.tsx` used to tab between. Those screens'
own `e8-*` class names (`.e8-row`, `.e8-diagnostic-row`, `.e8-code-files`,
…) are unchanged in `styles.css`; only the tokens they paint with are.
