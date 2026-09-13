# The Shell Floats — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the IDE shell to VS Code 1.137.0 Modern UI — floating cards with 4px gaps and 8px corners, pill tabs, a status bar on the window ground — without touching `Shell.tsx`, any slot, or any `data-testid`.

**Architecture:** One stylesheet (`engine/ide/client/src/styles.css`) owns every colour and size as `--e8-*` tokens; the token names change from a background ladder to named surfaces and states, and the five grid regions become bordered, rounded cards separated by margins. Monaco gets a theme whose background equals the editor card's. A guard test pins the token system, a Playwright suite pins the geometry in a real browser, and `DESIGN.md` is rewritten to name the version copied.

**Tech Stack:** CSS custom properties, Vitest (guard tests, jsdom), Playwright (`getComputedStyle` + `boundingBox`), Monaco 0.56 `editor.defineTheme`.

**Spec:** `docs/superpowers/specs/2026-09-13-modern-ui-design.md`

## Global Constraints

- No change to `Shell.tsx`, `Explorer.tsx`, `StatusItems.tsx`, `EditorDocument.tsx`, `ViewerDocument.tsx`, `App.tsx`, any slot, any `data-testid`, any class NAME. Only class RULES change. (Spec §3 "CSS-only".)
- Every colour outside the two token blocks of `styles.css` is a `var(--e8-*)`; the existing guard stays green.
- Old token names `--e8-bg-0..3` and `--e8-radius` (bare) exist nowhere under `engine/` after Task 1 — not in CSS, TS, TSX or MD (spec §9, `engine/apps/web/dist` is build output and is excluded).
- `box-shadow` in `styles.css` is only ever `none`. (Spec §2 shadows.)
- `border-radius` in `styles.css` uses only `var(--e8-radius-sm)`, `var(--e8-radius-lg)` and `0`. (Spec §8.)
- Density is `default`: gaps are exactly `4px` (`--e8-gap`); the activity bar is exactly `56px` (`--e8-activity-w`). (Spec §2, §3.)
- Every test assertion is written with a named mutation that must fail it, and the mutation is confirmed LANDED by a before/after count on the ORIGINAL file, not by the suite going red. (Spec §8; method notes.)
- Playwright runs ALONE of every root-level npm command; list `pgrep -fl e8-server` before and after. Ports 5679/5680.
- UI copy stays as it is: Russian headings, English inline labels.

---

## File map

| File | Task | Change |
|---|---|---|
| `engine/ide/client/src/styles.css` | 1, 2 | tokens renamed (1); card layout rules (2) |
| `engine/ide/client/tests/styles.test.ts` | 1 | three new guards |
| `engine/ide/client/src/editor/Monaco.tsx` | 3 | `defineTheme` `e8-dark`/`e8-light` from `--e8-editor-bg` |
| `engine/ide/client/tests/monaco.test.tsx` | 3 | fake grows `defineTheme`; theme test |
| `engine/apps/web/tests/e2e/modern-ui.spec.ts` | 4 | new: geometry in a real browser |
| `DESIGN.md` (repo root) | 5 | rewritten for 1.137.0 Modern UI |
| `docs/superpowers/notes/2026-09-13-modern-ui-screenshots/` | 5 | two PNGs for the eye |

---

### Task 1: Rename the tokens, and guard the names

**Files:**
- Modify: `engine/ide/client/src/styles.css` (the two token blocks at the top, and every `var(--e8-bg-*)` / `var(--e8-radius)` reference below them)
- Modify: `engine/ide/client/tests/styles.test.ts`

**Interfaces:**
- Produces: the token set of spec §4, verbatim. Task 2 paints with these names only.

- [ ] **Step 1: Write the three failing guards**

Append inside the existing `describe` in `engine/ide/client/tests/styles.test.ts`:

```ts
  // Spec §4 retired the background ladder and the one radius. A rule that
  // still says `--e8-bg-1` resolves to NOTHING in the browser — the
  // property is undefined — and paints transparent, which no test that
  // reads a token by its new name would notice.
  it('no rule reads a retired token name', () => {
    const css = readFileSync('src/styles.css', 'utf8');
    expect(css.match(/--e8-bg-\d|--e8-radius(?![-\w])/g) ?? []).toEqual([]);
  });

  // Modern UI's `shadows.css` sets every workbench shadow to `none`; a
  // card that floats does so by gap and border, never by blur.
  it('every box-shadow is none', () => {
    const css = readFileSync('src/styles.css', 'utf8');
    const shadows = [...css.matchAll(/box-shadow\s*:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(shadows.length).toBeGreaterThan(0);
    expect(shadows.filter((v) => v !== 'none')).toEqual([]);
  });

  // Two shapes, both tokens: 8px for a card, 4px for a thing inside one.
  // A literal `px` in a radius is a third shape nobody decided on.
  it('every border-radius is built from the two radius tokens and 0', () => {
    const css = readFileSync('src/styles.css', 'utf8');
    const radii = [...css.matchAll(/border-(?:[a-z]+-)*radius\s*:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(radii.length).toBeGreaterThan(0);
    const part = /^(?:var\(--e8-radius-(?:sm|lg)\)|0)$/;
    const bad = radii.filter((v) => !v.split(/\s+/).every((p) => part.test(p)));
    expect(bad).toEqual([]);
  });
```

- [ ] **Step 2: Run, see all three red**

Run: `npm test --workspace @energy8engine/ide-client -- tests/styles.test.ts`
Expected: retired-names guard FAILS (`--e8-bg-*` and `--e8-radius` are everywhere today); radius guard FAILS (every radius is `var(--e8-radius)`, neither `-sm` nor `-lg`); the shadow guard may already pass (`box-shadow: none` is the only shadow in the file) — note the outcome either way.

- [ ] **Step 3: Replace the two token blocks**

In `engine/ide/client/src/styles.css`, replace everything from the leading comment through the end of the `[data-theme='light'] { … }` block with:

```css
/* Tokens from DESIGN.md (repo root) §4 — VS Code 1.137.0, Modern UI,
   default density, measured from its sources. Dark lives on bare :root and
   needs no attribute; [data-theme="light"] redefines every colour token,
   name for name. Sizes and fonts do not change between themes and live
   only on :root. Guards in tests/styles.test.ts: every colour anywhere
   ELSE in this file is one of these custom properties; no retired name
   (--e8-bg-N, bare --e8-radius) survives; box-shadow is only ever none;
   border-radius is only ever the two radius tokens and 0. */
:root {
  /* surfaces */
  --e8-shell-bg: #181818;
  --e8-surface: #181818;
  --e8-editor-bg: #1f1f1f;
  --e8-border: #2a2a2a;
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
  --e8-font-mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace;
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

- [ ] **Step 4: Rename every reference below the blocks — mechanically, then by hand where the meaning moved**

Mechanical pass (run from `engine/ide/client`):

```bash
sed -i '' \
  -e 's/var(--e8-bg-0)/var(--e8-editor-bg)/g' \
  -e 's/var(--e8-bg-1)/var(--e8-surface)/g' \
  -e 's/var(--e8-bg-2)/var(--e8-hover)/g' \
  -e 's/var(--e8-bg-3)/var(--e8-hover)/g' \
  -e 's/var(--e8-radius)/var(--e8-radius-sm)/g' \
  -e 's/var(--e8-size-status)/var(--e8-size-label)/g' \
  src/styles.css
grep -c 'e8-bg-\|--e8-radius)\|e8-size-status' src/styles.css
```

Expected count after: `0`.

Then by hand — these four are places where the OLD ladder meant something the new names do not:

1. `.e8-activity` had `background: var(--e8-bg-3)` → after sed it says `--e8-hover`. Change to `background: var(--e8-surface);`.
2. `.e8-editors-tabs` had `background: var(--e8-bg-2)` → change to `background: transparent;` (Task 2 owns the rest of that rule; this keeps Task 1's tree honest on its own).
3. `.e8-status` had `background: var(--e8-bg-2)` → change to `background: var(--e8-shell-bg);`.
4. `.e8-activity-button[aria-pressed='true']` had `background: var(--e8-bg-2); color: var(--e8-accent)` → change to `background: var(--e8-activity-active); color: var(--e8-fg);`.

`.e8-explorer-delete:hover` had `--e8-bg-3` and now says `--e8-hover` — correct as is.

- [ ] **Step 5: Run the whole ide-client suite**

Run: `npm test --workspace @energy8engine/ide-client`
Expected: all green, including the three new guards and the original colour guard.

- [ ] **Step 6: Confirm each guard bites — mutation with a landed count**

For each, note the `grep -c` BEFORE and AFTER on `src/styles.css`, run the one test file, confirm red, revert:

| Guard | Mutation | Landed check |
|---|---|---|
| retired names | `sed -i '' 's/var(--e8-surface)/var(--e8-bg-1)/' src/styles.css` (first occurrence) | `grep -c 'e8-bg-1'`: 0 → 1 |
| box-shadow | append `.e8-x { box-shadow: 0 1px 2px var(--e8-border); }` | `grep -c 'box-shadow: 0 1px'`: 0 → 1 |
| radius | append `.e8-y { border-radius: 3px; }` | `grep -c 'border-radius: 3px'`: 0 → 1 |

Record the three before/after pairs in the report. Revert with `git checkout src/styles.css` after each.

- [ ] **Step 7: Grep the whole tree for the old names**

```bash
cd /Users/mrphelko/Documents/repo/game-engine
grep -rn 'e8-bg-\|--e8-radius[^-]\|e8-size-status' engine docs --exclude-dir=node_modules --exclude-dir=dist | grep -v 'docs/superpowers/\(specs\|plans\|notes\)/'
```

Expected: no output. (`docs/superpowers/*` records history and may name them.)

- [ ] **Step 8: Commit**

```bash
git add engine/ide/client/src/styles.css engine/ide/client/tests/styles.test.ts
git commit -m "Name the surfaces, retire the background ladder"
```

---

### Task 2: Float the cards

**Files:**
- Modify: `engine/ide/client/src/styles.css` (rules only; no new class names)

**Interfaces:**
- Consumes: Task 1's tokens.
- Produces: the geometry Task 4 measures — see the acceptance list at the end of this task; each line there is one Playwright assertion.

- [ ] **Step 1: The shell and its ground**

Replace the `.e8-shell { … }` rule:

```css
/* Shell: activity bar, sidebar, editor group, panel, status bar — five
   named grid areas, one per `shell` slot (DESIGN.md §2). Modern UI: the
   shell is the window ground; activity bar + sidebar, the editor group and
   the panel float on it as cards with `--e8-gap` between them and to the
   window edge; the status bar lies on the ground, not in a card. The
   activity bar and sidebar are one card with a seam (the sidebar's left
   border); the panel sits only under the editor group. */
.e8-shell {
  height: 100vh;
  box-sizing: border-box;
  display: grid;
  grid-template-columns: var(--e8-activity-w) var(--e8-sidebar-w) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr) auto var(--e8-status-h);
  grid-template-areas:
    'activity sidebar editors'
    'activity sidebar panel'
    'status status status';
  padding: var(--e8-gap) var(--e8-gap) 0;
  background: var(--e8-shell-bg);
  color: var(--e8-fg);
  font: 400 var(--e8-size) / 1.4 var(--e8-font);
}
```

Also change `html { background: var(--e8-editor-bg); … }` to `html { background: var(--e8-shell-bg); … }`.

- [ ] **Step 2: Activity bar — the left half of the first card**

Replace `.e8-activity`, `.e8-activity-button`, `.e8-activity-button:hover`, `.e8-activity-button[aria-pressed='true']` and the collapsed rules:

```css
.e8-activity {
  grid-area: activity;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
  box-sizing: border-box;
  padding-top: var(--e8-gap);
  margin-bottom: var(--e8-gap);
  background: var(--e8-surface);
  border: 1px solid var(--e8-border);
  border-right: 0;
  border-radius: var(--e8-radius-lg) 0 0 var(--e8-radius-lg);
}
/* 48px wide, 36px tall, like VS Code's action item; the 32×32 rounded
   indicator is the button's own background, clipped to the content box
   inside `padding: 2px 8px` — the element's radius rounds that box. */
.e8-activity-button {
  width: 48px;
  height: 36px;
  padding: 2px 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--e8-radius-sm);
  background: transparent;
  background-clip: content-box;
  color: var(--e8-fg-inactive);
  font-size: var(--e8-size-small);
}
.e8-activity-button svg {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.e8-activity-letter {
  font-size: 15px;
  font-weight: 600;
}
.e8-activity-button:hover {
  background-color: var(--e8-activity-hover);
  color: var(--e8-fg);
}
.e8-activity-button[aria-pressed='true'] {
  background-color: var(--e8-activity-active);
  color: var(--e8-fg);
}
```

Collapsed sidebar — the activity bar becomes a whole card:

```css
/* No sidebar chosen: the column is 0, not 260px of empty chrome (DESIGN.md
   §2). The aside is hidden with it, and the activity bar closes its own
   card: right border back, all four corners, the gap to the editor. */
.e8-shell.e8-sidebar-collapsed {
  grid-template-columns: var(--e8-activity-w) 0 minmax(0, 1fr);
}
.e8-shell.e8-sidebar-collapsed .e8-sidebar {
  display: none;
}
.e8-shell.e8-sidebar-collapsed .e8-activity {
  border-right: 1px solid var(--e8-border);
  border-radius: var(--e8-radius-lg);
  margin-right: var(--e8-gap);
}
```

- [ ] **Step 3: Sidebar — the right half of the first card**

```css
.e8-sidebar {
  grid-area: sidebar;
  position: relative;
  overflow: auto;
  scrollbar-width: thin;
  box-sizing: border-box;
  margin: 0 var(--e8-gap) var(--e8-gap) 0;
  background: var(--e8-surface);
  border: 1px solid var(--e8-border);
  border-radius: 0 var(--e8-radius-lg) var(--e8-radius-lg) 0;
}
```

Explorer header and rows (replace the existing rules of the same names):

```css
.e8-explorer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--e8-title-h);
  padding: 0 8px 0 12px;
  color: var(--e8-fg);
  font-size: var(--e8-size-label);
  font-weight: 600;
}
.e8-explorer-entry {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  margin: 0 var(--e8-gap);
  padding-right: 8px;
  border-radius: var(--e8-radius-sm);
  white-space: nowrap;
  cursor: pointer;
  color: var(--e8-fg);
}
.e8-explorer-entry:hover {
  background: var(--e8-hover);
}
```

- [ ] **Step 4: Editor group — the second card; tabs as pills**

```css
.e8-editors {
  grid-area: editors;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  box-sizing: border-box;
  margin-bottom: var(--e8-gap);
  background: var(--e8-editor-bg);
  border: 1px solid var(--e8-border);
  border-radius: var(--e8-radius-lg);
  overflow: hidden;
}
.e8-editors-tabs {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  /* One row, however many tabs: the strip scrolls sideways rather than
     wrapping into a second row that eats the editor. */
  flex-wrap: nowrap;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
  height: var(--e8-title-h);
  padding-left: 2px;
  background: transparent;
}
.e8-doc-tab {
  flex: 0 0 auto;
  white-space: nowrap;
  height: var(--e8-tab-h);
  margin: 0 2px;
  padding: 0 8px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: var(--e8-radius-sm);
  background: transparent;
  color: var(--e8-fg-muted);
  font-size: var(--e8-size);
  font-weight: 400;
}
.e8-doc-tab:hover {
  background: var(--e8-hover);
  color: var(--e8-fg);
}
.e8-doc-tab[aria-selected='true'] {
  background: var(--e8-selected);
  color: var(--e8-fg);
  box-shadow: none;
}
.e8-doc-tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: var(--e8-radius-sm);
  color: var(--e8-fg-muted);
}
.e8-doc-tab-close:hover {
  background: var(--e8-activity-active);
  color: var(--e8-fg);
}
```

Delete the old `.e8-doc-tab[aria-selected='true']` rule's `border-bottom: 2px solid var(--e8-accent);` — the new rule above has none.

- [ ] **Step 5: Panel — the third card**

```css
.e8-panel {
  grid-area: panel;
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: var(--e8-header-h);
  box-sizing: border-box;
  margin-bottom: var(--e8-gap);
  background: var(--e8-surface);
  border: 1px solid var(--e8-border);
  border-radius: var(--e8-radius-lg);
  overflow: hidden;
}
.e8-panel:has(.e8-panel-entry) {
  height: var(--e8-panel-h);
}
.e8-panel-header {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  height: var(--e8-header-h);
  padding: 0 8px 0 12px;
  pointer-events: none;
}
.e8-panel-title {
  color: var(--e8-fg);
  font-size: var(--e8-size-label);
  font-weight: 600;
}
```

Diagnostics header, same shape:

```css
.e8-diagnostics-panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  height: var(--e8-header-h);
  padding: 0 12px;
}
.e8-diagnostics-panel h2 {
  margin: 0;
  color: var(--e8-fg);
  font-size: var(--e8-size-label);
  font-weight: 600;
}
.e8-diagnostic-row {
  margin: 0 var(--e8-gap);
  padding: 3px 8px;
  border-radius: var(--e8-radius-sm);
  font: 400 var(--e8-size) / 1.5 var(--e8-font-mono);
  color: var(--e8-fg);
  white-space: nowrap;
}
.e8-diagnostic-row:hover {
  background: var(--e8-hover);
}
```

- [ ] **Step 6: Status bar — on the ground**

```css
.e8-status {
  grid-area: status;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--e8-status-h);
  padding: 0 6px;
  background: var(--e8-shell-bg);
  font-size: var(--e8-size-label);
  color: var(--e8-fg);
}
.e8-status [data-side] {
  display: flex;
  align-items: center;
  gap: 4px;
}
.e8-status-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 18px;
  padding: 0 4px;
  border-radius: var(--e8-radius-sm);
}
.e8-status-item:hover {
  background: var(--e8-status-hover);
}
.e8-theme-toggle {
  border: 0;
  background: transparent;
  color: inherit;
  font-size: var(--e8-size-label);
}
```

- [ ] **Step 7: Resize handles — a grip dot, gone on hover**

Replace `.e8-resize`, `.e8-resize-x`, `.e8-resize-y` and the `:hover/:active` rule:

```css
/* The two drag handles (Shell.tsx's `useResize`): a thin strip riding the
   sidebar's right edge and the panel's top edge, inside the card (an
   `overflow: auto` card clips anything hung outside it). Modern UI draws
   a grip at the middle and hides it while the pointer is on it; the strip
   itself never fills. VS Code's grip is three dots drawn with box-shadow,
   which the shadow guard forbids — one 2px dot reads the same.
   `touch-action: none` is what lets a finger drag without the page
   scrolling under it. */
.e8-resize {
  position: absolute;
  z-index: 1;
  touch-action: none;
  background: transparent;
}
.e8-resize::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 2px;
  height: 2px;
  border-radius: var(--e8-radius-sm);
  transform: translate(-50%, -50%);
  background: color-mix(in srgb, var(--e8-fg) 30%, transparent);
  pointer-events: none;
}
.e8-resize-x {
  top: 0;
  right: 0;
  width: 5px;
  height: 100%;
  cursor: col-resize;
}
.e8-resize-y {
  top: 0;
  left: 0;
  width: 100%;
  height: 5px;
  cursor: row-resize;
}
.e8-resize:hover::after,
.e8-resize:active::after {
  opacity: 0;
}
```

The colour guard allows `color-mix(in srgb, var(--e8-fg) 30%, transparent)`: no literal in it. Note the one-dot simplification in the report.

- [ ] **Step 8: Everything else that carried the old radius or ladder**

- `button { border-radius: var(--e8-radius-sm); background: var(--e8-surface); }` `button:hover, button:active { background: var(--e8-hover); }` — already so after Task 1's sed; verify.
- `.e8-shell-confirm { border-radius: var(--e8-radius-sm); background: var(--e8-surface); }` — set `background` to `--e8-surface` (Task 1's sed made it `--e8-hover`, which is a state, not a surface).
- `.e8-badge { background: var(--e8-selected); }`.
- `.e8-doc-pane:has(> .e8-code-editor)` unchanged.
- `.e8-assets-text`, `.e8-row`: `background: var(--e8-surface)` — already so; verify.
- Remove `box-shadow: none;` lines ONLY if no other `box-shadow` remains — the guard requires at least one `box-shadow` declaration (it asserts `length > 0`), so leave `.e8-doc-tab[aria-selected='true'] { box-shadow: none; }` in place.

- [ ] **Step 9: Run the ide-client suite and the guards**

Run: `npm test --workspace @energy8engine/ide-client`
Expected: green. The four guards in `styles.test.ts` are what pin this task at the unit level; Task 4 pins the geometry.

- [ ] **Step 10: Look, once, in the dev server**

```bash
cd engine/apps/web && npm run dev
```

Open `http://127.0.0.1:5680/#/doc/composition`, toggle the theme, collapse the sidebar, open `game/script.spin`. Confirm by eye: gaps, corners, no line under the tabs, status bar on the ground. Stop the server. This is a look, not a test — Task 4 is the test.

- [ ] **Step 11: Commit**

```bash
git add engine/ide/client/src/styles.css
git commit -m "Float the cards: 4px gaps, 8px corners, pill tabs, status on the ground"
```

**Acceptance geometry this task must produce (each is one Task 4 assertion):**

1. `boundingBox(sidebar).x + width + 4 === boundingBox(.e8-editors).x` (±0.5).
2. `boundingBox(.e8-editors).y + height + 4 === boundingBox(panel).y` (±0.5).
3. `.e8-editors` `border-top-left-radius === '8px'`; `activity-bar` `border-top-left-radius === '8px'` and `border-top-right-radius === '0px'`.
4. After collapsing the sidebar: `activity-bar` all four radii `8px`, `border-right-width === '1px'`.
5. Active `doc-*`: `border-bottom-width === '0px'`, `border-top-left-radius === '4px'`, `background-color` equals `--e8-selected` resolved; `doc-tabs` `border-bottom-width === '0px'`.
6. `activity-bar` `boundingBox.width === 56`; pressed activity button `background-color !== 'rgba(0, 0, 0, 0)'` and `color !== --e8-accent`.
7. `status-bar` `border-top-width === '0px'`, `background-color` equals `--e8-shell-bg`.
8. Theme toggle: `--e8-shell-bg` on `:root` is `#181818` then `#f8f8f8`; `.e8-editors` background `rgb(31, 31, 31)` then `rgb(255, 255, 255)`.
9. `box-shadow === 'none'` on `shell`, `sidebar`, `.e8-editors`, `panel`, `status-bar`, active tab.

---

### Task 3: Monaco on the card's colour

**Files:**
- Modify: `engine/ide/client/src/editor/Monaco.tsx`
- Modify: `engine/ide/client/tests/monaco.test.tsx`

**Interfaces:**
- Consumes: `--e8-editor-bg` on `:root` (Task 1).
- Produces: Monaco themes named `e8-dark` and `e8-light`; Task 4's assertion 8 reads `.monaco-editor`'s background.

- [ ] **Step 1: Write the failing test**

In `engine/ide/client/tests/monaco.test.tsx`, the fake's `editor` object gains two members (inside the `vi.hoisted` factory, next to `setModelMarkers`):

```ts
      themes: [] as Array<{ name: string; data: Record<string, unknown> }>,
      defineTheme(name: string, data: Record<string, unknown>) {
        fake.editor.themes.push({ name, data });
      },
      setTheme(_name: string) {},
```

(If `fake` is not referable inside its own factory, keep a module-level `const themes: Array<…> = []` in the hoisted block and push there; expose it as `fake.themes`.)

Contract under test: `themeFor()` returns `'e8-dark' | 'e8-light'`; `ensureTheme(monaco, name)` defines a theme ONCE per name per API object, reading `--e8-editor-bg` from `getComputedStyle(document.documentElement)` AT THAT MOMENT (when the observer fires, `data-theme` has already flipped, so `e8-light` reads the light value); creation passes `theme: ensureTheme(...)`, the observer calls `setTheme(ensureTheme(...))`. `fake.editor.applied` is a `string[]` that `setTheme` pushes to. A fresh `fake.editor` per test (extract the editor-API factory from the hoisted block as `makeEditorApi()` and assign in `beforeEach`) is what lets a `WeakMap` keyed on `monaco.editor` start empty each test.

Add these tests:

```ts
it('defines the dark theme on the card colour the stylesheet names, once, and uses it', async () => {
  document.documentElement.style.setProperty('--e8-editor-bg', '#1f1f1f');
  delete document.documentElement.dataset.theme;
  render(<Monaco value="" language="spin" diagnostics={[]} onChange={() => {}} />);
  await waitFor(() => expect(fake.editors.length).toBe(1));
  expect(fake.editor.themes).toEqual([
    { name: 'e8-dark', data: { base: 'vs-dark', inherit: true, rules: [], colors: { 'editor.background': '#1f1f1f' } } },
  ]);
  expect(fake.editors[0].options.theme).toBe('e8-dark');
});

it('defines the light theme when data-theme flips, on the colour the token has THEN', async () => {
  document.documentElement.style.setProperty('--e8-editor-bg', '#1f1f1f');
  delete document.documentElement.dataset.theme;
  render(<Monaco value="" language="spin" diagnostics={[]} onChange={() => {}} />);
  await waitFor(() => expect(fake.editors.length).toBe(1));
  document.documentElement.style.setProperty('--e8-editor-bg', '#ffffff');
  document.documentElement.dataset.theme = 'light';
  await waitFor(() => expect(fake.editor.themes.map((t) => t.name)).toEqual(['e8-dark', 'e8-light']));
  expect(fake.editor.themes[1].data).toMatchObject({ base: 'vs', colors: { 'editor.background': '#ffffff' } });
  expect(fake.editor.applied).toEqual(['e8-light']);
});

it('registers a theme without colours when the token is not on :root', async () => {
  document.documentElement.style.removeProperty('--e8-editor-bg');
  delete document.documentElement.dataset.theme;
  render(<Monaco value="" language="spin" diagnostics={[]} onChange={() => {}} />);
  await waitFor(() => expect(fake.editors.length).toBe(1));
  expect(fake.editor.themes[0].data).toMatchObject({ base: 'vs-dark', colors: {} });
});
```

- [ ] **Step 2: Run, see red**

Run: `npm test --workspace @energy8engine/ide-client -- tests/monaco.test.tsx`
Expected: FAIL — `defineTheme` never called; `options.theme` is `'vs-dark'`.

- [ ] **Step 3: Implement in `Monaco.tsx`**

Replace `themeFor` and the two theme call sites:

```ts
type ThemeName = 'e8-dark' | 'e8-light';

/** The shell's `data-theme` (see `StatusItems.tsx`'s `applyTheme`) picks the theme name. */
function themeFor(): ThemeName {
  return document.documentElement.dataset.theme === 'light' ? 'e8-light' : 'e8-dark';
}

/** Which themes each Monaco instance has been told about — once per name, per API object, so tests with a fresh fake start empty. */
const defined = new WeakMap<Api['editor'], Set<ThemeName>>();

/**
 * Monaco's built-in `vs-dark` paints `#1e1e1e`; the editor card is
 * `--e8-editor-bg` (`#1f1f1f`), and the 1px seam between them was visible.
 * Each theme is defined on first use, reading the token AT THAT MOMENT —
 * `data-theme` has already flipped when the observer fires, so the value
 * read is the light one for `e8-light`. A missing token (a test with no
 * stylesheet) defines the theme with no colours: Monaco's own default,
 * the seam, and no throw.
 */
function ensureTheme(monaco: Api, name: ThemeName): ThemeName {
  let set = defined.get(monaco.editor);
  if (!set) defined.set(monaco.editor, (set = new Set()));
  if (!set.has(name)) {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--e8-editor-bg').trim();
    monaco.editor.defineTheme(name, {
      base: name === 'e8-light' ? 'vs' : 'vs-dark',
      inherit: true,
      rules: [],
      colors: bg ? { 'editor.background': bg } : {},
    });
    set.add(name);
  }
  return name;
}
```

At creation: `theme: ensureTheme(monaco, themeFor())`. In the observer: `monaco.editor.setTheme(ensureTheme(monaco, themeFor()))`.

- [ ] **Step 4: Run, see green; run the whole package**

Run: `npm test --workspace @energy8engine/ide-client`
Expected: green. `editor-document.test.tsx` mocks the same slice — if its fake lacks `defineTheme`, add the same two members there (it will throw `defineTheme is not a function` otherwise; that throw is the reason to run the whole package, not one file).

- [ ] **Step 5: Mutations, with landed counts**

| Assertion | Mutation in `Monaco.tsx` | Landed |
|---|---|---|
| colours read | `colors: {}` unconditionally | `grep -c "'editor.background': bg"`: 1 → 0 |
| once per name | drop `set.add(name)` | `grep -c 'set.add(name)'`: 1 → 0 → second test sees 3 themes |
| light on flip | observer calls `setTheme('e8-dark')` literally | `grep -c "setTheme(ensureTheme"`: 1 → 0 |

- [ ] **Step 6: Commit**

```bash
git add engine/ide/client/src/editor/Monaco.tsx engine/ide/client/tests/monaco.test.tsx engine/ide/client/tests/editor-document.test.tsx
git commit -m "Paint Monaco on the editor card's colour, not its own"
```

---

### Task 4: Measure the cards in a browser

**Files:**
- Create: `engine/apps/web/tests/e2e/modern-ui.spec.ts`

**Interfaces:**
- Consumes: `openIde`, `openInEditor` shapes from `shell.spec.ts` (copy the two helpers; they are 15 lines), `projectCopy`/`startDevHost` from `./project-fixture`; testids `shell`, `activity-bar`, `activity-explorer`, `sidebar`, `doc-tabs`, `doc-composition`, `panel`, `status-bar`, `status-theme`, `doc-pane-f:game/script.spin`.

- [ ] **Step 1: Write the spec**

```ts
/**
 * Modern UI (VS Code 1.137.0) geometry, measured in a real browser: a
 * jsdom test cannot see a gap, a corner, or whether a line under the tabs
 * is gone. Every number here is from the spec's measurement table
 * (`docs/superpowers/specs/2026-09-13-modern-ui-design.md` §2): 4px gaps,
 * 8px card corners, 4px element corners, a 56px activity bar.
 */
import { rmSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { projectCopy, startDevHost, type DevHost } from './project-fixture';

const IDE_URL = 'http://127.0.0.1:5680/';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // @ts-expect-error test-only: forces Monaco onto its textarea input
    delete window.EditContext;
  });
});

async function openIde(page: Page, host: DevHost, hash = ''): Promise<void> {
  await page.goto(host.gameUrl);
  await expect(page.locator('#status')).not.toHaveText('', { timeout: 20_000 });
  await page.goto(`${IDE_URL}${hash}`);
  await expect(page.getByTestId('activity-explorer')).toBeVisible({ timeout: 20_000 });
}

/** A `:root` token as the browser resolved it. */
function token(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
}

/** `#rrggbb` → the `rgb(r, g, b)` form `getComputedStyle` returns for backgrounds. */
function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

function style(page: Page, selector: string, prop: string): Promise<string> {
  return page.locator(selector).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
}

test('activity bar and sidebar are one card, the editor another, the panel a third — 4px apart, 8px corners', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await openIde(page, host, '#/doc/composition');
    const sidebar = (await page.getByTestId('sidebar').boundingBox())!;
    const editors = (await page.locator('.e8-editors').boundingBox())!;
    const panel = (await page.getByTestId('panel').boundingBox())!;
    const activity = (await page.getByTestId('activity-bar').boundingBox())!;
    expect(Math.abs(sidebar.x + sidebar.width + 4 - editors.x)).toBeLessThan(0.5);
    expect(Math.abs(editors.y + editors.height + 4 - panel.y)).toBeLessThan(0.5);
    expect(activity.width).toBe(56);
    expect(await style(page, '.e8-editors', 'border-top-left-radius')).toBe('8px');
    expect(await style(page, '[data-testid="activity-bar"]', 'border-top-left-radius')).toBe('8px');
    expect(await style(page, '[data-testid="activity-bar"]', 'border-top-right-radius')).toBe('0px');
    expect(await style(page, '[data-testid="activity-bar"]', 'border-right-width')).toBe('0px');
    expect(await style(page, '[data-testid="sidebar"]', 'border-top-left-radius')).toBe('0px');
    expect(await style(page, '[data-testid="sidebar"]', 'border-top-right-radius')).toBe('8px');
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('with the sidebar collapsed the activity bar closes its own card', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await openIde(page, host, '#/doc/composition');
    await page.getByTestId('activity-explorer').click();
    await expect(page.getByTestId('sidebar')).toBeHidden();
    for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
      expect(await style(page, '[data-testid="activity-bar"]', `border-${corner}-radius`)).toBe('8px');
    }
    expect(await style(page, '[data-testid="activity-bar"]', 'border-right-width')).toBe('1px');
    const activity = (await page.getByTestId('activity-bar').boundingBox())!;
    const editors = (await page.locator('.e8-editors').boundingBox())!;
    expect(Math.abs(activity.x + activity.width + 4 - editors.x)).toBeLessThan(0.5);
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the active tab is a pill on the selected colour, with no line under it or the strip', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await openIde(page, host, '#/doc/composition');
    const tab = '[data-testid="doc-composition"]';
    await expect(page.locator(tab)).toHaveAttribute('aria-selected', 'true');
    expect(await style(page, tab, 'border-bottom-width')).toBe('0px');
    expect(await style(page, tab, 'border-right-width')).toBe('0px');
    expect(await style(page, tab, 'border-top-left-radius')).toBe('4px');
    expect(await style(page, tab, 'background-color')).toBe(rgb(await token(page, '--e8-selected')));
    expect(await style(page, '[data-testid="doc-tabs"]', 'border-bottom-width')).toBe('0px');
    const strip = (await page.getByTestId('doc-tabs').boundingBox())!;
    const pill = (await page.locator(tab).boundingBox())!;
    expect(strip.height).toBe(32);
    expect(pill.height).toBe(24);
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the pressed activity button is a filled square, not an accent stripe', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await openIde(page, host, '#/doc/composition');
    const button = '[data-testid="activity-composition"]';
    await expect(page.locator(button)).toHaveAttribute('aria-pressed', 'true');
    expect(await style(page, button, 'background-color')).not.toBe('rgba(0, 0, 0, 0)');
    expect(await style(page, button, 'color')).toBe(rgb(await token(page, '--e8-fg')));
    expect(await style(page, button, 'border-left-width')).toBe('0px');
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the status bar lies on the window ground with no line above it', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await openIde(page, host, '#/doc/composition');
    expect(await style(page, '[data-testid="status-bar"]', 'border-top-width')).toBe('0px');
    expect(await style(page, '[data-testid="status-bar"]', 'background-color')).toBe(rgb(await token(page, '--e8-shell-bg')));
    expect(await style(page, '[data-testid="shell"]', 'background-color')).toBe(rgb(await token(page, '--e8-shell-bg')));
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('nothing in the shell casts a shadow', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await openIde(page, host, '#/doc/composition');
    for (const sel of ['[data-testid="shell"]', '[data-testid="sidebar"]', '.e8-editors', '[data-testid="panel"]', '[data-testid="status-bar"]', '[data-testid="doc-composition"]', '[data-testid="activity-bar"]']) {
      expect(await style(page, sel, 'box-shadow'), sel).toBe('none');
    }
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the light theme repaints the ground, the cards and Monaco together', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await openIde(page, host, '#/doc/composition');
    await page.getByTestId('explorer-game/script.spin').click();
    const pane = page.getByTestId('doc-pane-f:game/script.spin');
    await expect(pane.locator('.monaco-editor')).toBeVisible({ timeout: 10_000 });
    const monacoBg = () => pane.locator('.monaco-editor').first().evaluate((el) => getComputedStyle(el).backgroundColor);

    expect(await token(page, '--e8-shell-bg')).toBe('#181818');
    expect(await style(page, '.e8-editors', 'background-color')).toBe('rgb(31, 31, 31)');
    await expect.poll(monacoBg).toBe('rgb(31, 31, 31)');

    await page.getByTestId('status-theme').locator('button').click();
    await expect.poll(() => token(page, '--e8-shell-bg')).toBe('#f8f8f8');
    expect(await style(page, '.e8-editors', 'background-color')).toBe('rgb(255, 255, 255)');
    await expect.poll(monacoBg).toBe('rgb(255, 255, 255)');
    expect(await style(page, '[data-testid="status-bar"]', 'background-color')).toBe('rgb(248, 248, 248)');
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
```

`.monaco-editor`'s own background: Monaco paints `editor.background` on `.monaco-editor` and `.monaco-editor-background`; if `.monaco-editor` reads transparent, read `.monaco-editor-background` instead — measure once, fix the selector, note it in the report.

`status-theme`'s toggle: `Shell.tsx` wraps the item in `<span data-testid="status-theme">`; the `<button>` inside is the toggle (`aria-label="toggle theme"`). If `locator('button')` fails, use `getByRole('button', { name: 'toggle theme' })`.

- [ ] **Step 2: Run the new spec alone**

```bash
pgrep -fl e8-server || echo none
cd engine/apps/web && npx playwright test tests/e2e/modern-ui.spec.ts
pgrep -fl e8-server || echo none
```

Expected: 7 passed. Any failure is either the stylesheet (fix in `styles.css`, that is Task 2's contract) or the sketch (measure, fix the test, note the correction in the report).

- [ ] **Step 3: Mutations, one per test, landed counts on `styles.css`**

| Test | Mutation | Landed |
|---|---|---|
| cards | `.e8-sidebar { margin-right: 0 }` (change `var(--e8-gap)` → `0` in that rule) | `grep -c 'margin: 0 var(--e8-gap) var(--e8-gap) 0'`: 1 → 0 |
| collapsed | remove `border-radius: var(--e8-radius-lg);` from `.e8-sidebar-collapsed .e8-activity` | count of that line in file: N → N−1 |
| tab | put back `border-bottom: 2px solid var(--e8-accent)` on the selected tab | `grep -c '2px solid'`: 0 → 1 |
| activity | `[aria-pressed='true'] { color: var(--e8-accent) }` | `grep -c 'color: var(--e8-accent)'`: before → +1 |
| status | `.e8-status { border-top: 1px solid var(--e8-border) }` | `grep -c 'border-top: 1px solid'`: before → +1 |
| shadow | `.e8-panel { box-shadow: 0 1px 2px var(--e8-border) }` | `grep -c 'box-shadow: 0'`: 0 → 1 |
| theme | in `Monaco.tsx` `colors: {}` unconditionally | `grep -c "'editor.background': bg"`: 1 → 0 |

Run only the affected test each time; revert each with `git checkout`.

- [ ] **Step 4: The whole Playwright suite**

```bash
cd engine/apps/web && npx playwright test
pgrep -fl e8-server || echo none
ls -d ../../examples/e8-compose-* 2>/dev/null | wc -l
```

Expected: 70 passed (63 + 7), no orphan, no temp compose dirs.

- [ ] **Step 5: Commit**

```bash
git add engine/apps/web/tests/e2e/modern-ui.spec.ts
git commit -m "Measure the cards: gaps, corners, pills, ground, no shadows, both themes"
```

---

### Task 5: `DESIGN.md` names the version; two screenshots for the eye

**Files:**
- Modify: `DESIGN.md` (repo root) — rewrite
- Create: `docs/superpowers/notes/2026-09-13-modern-ui-screenshots/dark.png`, `light.png`

**Interfaces:**
- Consumes: spec §2–§6; `styles.css` token block (Task 1) copied VERBATIM into §4.

- [ ] **Step 1: Rewrite `DESIGN.md`**

Frontmatter:

```markdown
---
version: alpha
name: modern-ui-shell-design
description: The IDE shell restyled to VS Code 1.137.0 with `workbench.experimental.modernUI` on, default density — floating cards with 4px gaps and 8px corners, pill tabs, a status bar on the window ground — measured from the VS Code sources and restated as the `--e8-*` tokens this codebase owns.
---
```

Sections, in this order, each written fresh (not patched):

1. **The IDE shell, after Modern UI** — one paragraph: what changed since the previous document (Slice 7's flat planes → cards), and the source list: `src/vs/workbench/contrib/modernUI/browser/media/*.css`, `src/vs/workbench/browser/media/floatingPanels.css`, `src/vs/workbench/services/layout/browser/layoutService.ts`, `src/vs/platform/theme/common/sizes/baseSizes.ts`, `src/vs/workbench/common/theme.ts`, `extensions/theme-defaults/themes/{dark,light}_modern.json`, all at tag `1.137.0`.
2. **Anatomy** — the card drawing from spec §5, then the region table (class, default size token, slot) with `--e8-activity-w` 56px and the note that activity bar + sidebar are one card with a seam, editor and panel are their own cards, status bar is not a card.
3. **Principles** — cards not planes (gap + border, never shadow); two shapes (8 for a card, 4 for a thing in one); hover and selected are states, not steps of a background ladder; one border; one accent, spent on focus and primary buttons only, never on the pressed activity button or the active tab; headings 12px/600 capitalize, never uppercase; type ramp 13/12/11/10; region sizes are tokens; density is `default` and `compact` is out.
4. **Tokens** — the two blocks from `styles.css`, verbatim (copy, do not retype), and the four guards in `tests/styles.test.ts` named.
5. **Themes** — unchanged from the previous document's §5 (dark default, `data-theme="light"`, `localStorage['e8.theme']`, read before first paint) plus one line: Monaco defines `e8-dark`/`e8-light` on `--e8-editor-bg` at first use (`Monaco.tsx`).
6. **What this replaces** — the `--e8-bg-0..3` ladder, bare `--e8-radius`, `--e8-size-status`; the accent stripe on the pressed activity button; the line under the tab strip; the `#007acc` accent (now `#0078d4`); where the previous document lives (git, `0b74e2f`).
7. **What was deliberately not copied** — the panel's `#F8F8F8` in light (ours is `--e8-surface`); the three-dot sash grip (one dot — the shadow guard); Codicons; command center / title bar; compact density.

- [ ] **Step 2: Screenshots**

Per the `pixi-headless-init-hang` memory, system headless Chrome hangs on Pixi but the IDE page itself has no Pixi (the preview is an iframe); Playwright's Chromium is fine. Write a throwaway script in the scratchpad (NOT committed) that reuses `project-fixture`'s `projectCopy`/`startDevHost`, opens `#/doc/composition`, clicks `explorer-game/script.spin`, waits for `.monaco-editor`, sets viewport 1440×900, screenshots to `docs/superpowers/notes/2026-09-13-modern-ui-screenshots/dark.png`, clicks the theme toggle, screenshots `light.png`. Simplest: a Playwright test file in the scratchpad run with `--config engine/apps/web/playwright.config.ts`? The config's `testDir` is fixed — instead put the script as `engine/apps/web/tests/e2e/_screenshots.spec.ts`, run it alone, then `git rm`/delete it before commit. Check `git status` shows only the two PNGs and `DESIGN.md`.

- [ ] **Step 3: Verify the guards still pass and the whole ide-client suite**

Run: `npm test --workspace @energy8engine/ide-client`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add DESIGN.md docs/superpowers/notes/2026-09-13-modern-ui-screenshots/
git commit -m "Say which VS Code the shell copies, and show it"
```

---

## Self-review

- **Spec coverage:** §2 measurements → Task 2 rules + Task 4 assertions; §3 decisions (default density, no title bar, CSS-only, Monaco theme, thin scrollbar, no uppercase) → Tasks 2, 3; §4 tokens → Task 1; §5 layout → Task 2; §6 DESIGN.md → Task 5; §7 failure-as-data (Monaco without token) → Task 3 third test; §8 guards → Task 1; §8 Playwright 1–8 → Task 4 (spec's 8 assertions map onto 7 tests: spec 1+4 share the first test); §8 acceptance screenshots → Task 5; §9 risk 1 (JS readers) → Task 1 Step 7; risk 2 (Monaco overlays under `overflow: hidden`) → Task 2 Step 10's look plus Task 4's Monaco test; risk 3 → Task 4 test 1.
- **Placeholders:** none; every step has its code.
- **Type consistency:** token names in Task 1's block are the ones Task 2's rules and Task 4's `token()` reads use; `ensureTheme` signature in Task 3 matches the test's expectations (`inherit: true, rules: []`).
- **Guard interplay:** Task 2 Step 7's sash grip uses `background: currentColor` and one dot, no `box-shadow` — consistent with the guard; Task 2 Step 8 keeps at least one `box-shadow: none` for the guard's `length > 0`.
