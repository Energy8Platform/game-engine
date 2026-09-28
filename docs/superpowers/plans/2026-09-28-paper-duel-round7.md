# Paper-duel Round 7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close F15–F20: `view()` answers the copy on screen (+ `views()`), a public `load` with a narrow refresh (+ flow `load`), `emit { wait }` documented for plugins, text `letterSpacing`/`lineHeight`/`fitWidth`, `scenes1.fonts`, and a hideable shell bar that gives its height back.

**Architecture:** Scenes-side changes in `@energy8engine/scenes` (`scenes.ts`, `builtin.ts`, `runtime.ts`, `schema.ts`); flow-side in `@energy8engine/flow` (`kinds.ts`, README) and a regression test in `flow-fx`; shell-side in `@energy8engine/shell-pixi` (a wrapped handle) and the flow `shell` kind; one e2e spec on a project copy.

**Tech Stack:** TypeScript, pixi.js v8, cordis 4, schemastery, vitest (+ jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-28-paper-duel-round7-design.md`

## Global Constraints

- `packages/*` is not edited (the Pixi shell lives there — wrap it, never change it). No `@energy8platform/game-engine` under `engine/`. Every change carries a test in its package.
- Existing documents and patches keep working unchanged: every new field defaults to "as before" (`letterSpacing: 0`, `lineHeight: 0`, `fitWidth: 0`, `fonts: []`, shell `visible: ''`).
- Every schema leaf has a default and a `.description()` (the schema walker tests pin it).
- One workspace per test command (`npm test -w <name>`); `@energy8engine/ide-host` ALONE. Playwright ALONE from `engine/apps/web`: `E8_E2E_HOST_PORT=5779 npx playwright test <files>`.
- NEVER `git stash`/`checkout`/`restore` — baseline via `git show HEAD:<path> > <scratch file>`. Never kill a process you did not start. Never touch `engine/examples/paper-duel`.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Never stage `packages/*`, `engine/apps/web/dist`, `engine/examples/first-slot/concept.png`, `engine/examples/paper-duel`, `docs/superpowers/notes/2026-09-19-paper-duel-port-feasibility.md`.

## Review Focus

1. **A document nested in two shown hosts** (the same `scene` node in two visible documents): `view()` picks the most recently shown host's copy, never throws, and `views()` returns both. Pinned in Task 1.
2. **A `setProps` patch on a node whose asset loads later**: the narrow refresh re-runs `update` for that node with its live patch still applied (a narrow refresh must not lose `setProps` state). Pinned in Task 1.
3. **`fitWidth` with `wrap` set** (both a wrap width and a fit width): wrapping lays out first, then the widest line is fitted; a text shorter than `fitWidth` keeps its `size` exactly (no float drift). Pinned in Task 2.
4. **A font that never loads (404, bad file)**: `scenes.ready` still settles (the game boots in the fallback), one diagnostic names the `src`. Pinned in Task 2.
5. **Hiding the bar while its layout changes** (a resize wide↔mobile while hidden): `safeArea.bottom` stays 0 until shown; showing again answers the CURRENT bar height, not the one from before the hide. Pinned in Task 4.

---

### Task 1: scenes — `view()` on screen, `views()`, public `load()`, a narrow refresh (F15, F16)

**Files:**
- Modify: `engine/game/scenes/src/scenes.ts` (`ScenesService`: `view` doc, new `views`, new `load`; `view` implementation; `loadPaths`/`refresh`)
- Test: `engine/game/scenes/tests/mount.test.ts` or a new `engine/game/scenes/tests/view.test.ts` (read `mount.test.ts`/`once.test.ts` for the harness: `createScenes({ root, design, nodeTypes, loader, ctx })`, a fake `loader`)

**Interfaces:**
- Produces on `ScenesService`: `view(ref: SceneRef): Container | undefined` (the copy whose host is shown — see below); `views(ref: SceneRef): Container[]`; `load(id: string): Promise<void>`.
- "Host" of an entry = the key of the `mounted` map whose `Mount.all` holds it (the document itself for its own top-level mount). "Shown" = `visibleIds` (top-level shows, in show order). Pick rule: among `entriesOf(ref)`, the entry whose host is shown, preferring the host LATEST in `visibleIds`; none shown → `entryOf(ref)` (today's answer).

- [ ] **Step 1: Failing tests.**
  - `view()`: documents `inner` (a node `x`) and `outer` (a `scene` node embedding `inner`); nothing shown → `view({ scene: 'inner', node: 'x' })` is inner's own mount's view (today's answer); `show('outer')` → it is the copy inside outer's mount (assert `view.parent` chain reaches `outer`'s root, or compare with `views(...)` entries); `show('inner')` too (its own mount shown after outer) → the own mount's copy (latest shown host wins); hide it → back to outer's copy.
  - `views()`: returns both copies (own + embedded), in `entriesOf` order; an unknown ref → `[]`.
  - `load()`: public; after `load('a')` the loader got a's paths and `show('a')` asks the loader for nothing more.
  - Pose survives: an `image` node in `a` (asset `p.png`); `await load('a')`; set `view(ref).x = 123`; `await show('a')` → `x` is still `123`.
  - Narrow refresh: documents `a` (an image using `a.png`) and `b` (an image using `b.png`); `load('a')`; pose `a`'s image (`x = 50`); `load('b')` → `a`'s image keeps `x = 50` (its `update` was NOT re-run — spy on the node type's `update`, count calls per entry); `b`'s image WAS updated.
  - Review Focus 2: `setProps(ref, { alpha: 0.5 })` on an image whose `src` is not loaded yet; then load its document → after the refresh the view's `alpha` is `0.5` (the refresh uses the entry's live props, patch included).
  - Review Focus 1: `inner` embedded in two shown hosts `h1`, `h2` (shown in that order) → `view()` is the copy in `h2`; `views()` has three entries (own + two copies).
- [ ] **Step 2: Implement.**

```ts
  /** The document whose top-level mount holds `e` (its own id for its own mount). */
  const hostOf = (e: Entry): string | undefined => {
    for (const [id, m] of mounted) if (m.all.includes(e)) return id;
    return undefined;
  };
  const viewOf = (ref: SceneRef): Container | undefined => {
    const entries = entriesOf(ref);
    for (let i = visibleIds.length - 1; i >= 0; i--) {
      const shown = entries.find((e) => hostOf(e) === visibleIds[i]);
      if (shown) return shown.view;
    }
    return entryOf(ref)?.view;
  };
```

(`hostOf` is O(mounts×entries) — fine at these sizes; mark `// ponytail:` with the upgrade — a host id stored on the entry at mount — if you keep the scan.) `view: viewOf`, `views: (ref) => entriesOf(ref).map((e) => e.view)`, `load` exposed on the service object. `loadPaths(where, need)` ends with `refresh(need)` instead of `refresh()`; `refresh(paths?: string[])`: with `paths`, only entries whose `e.type.assets?.(e.props)` intersects `paths` re-run `update`; with none (the other callers), every entry as today. Update the service's doc comments (the `view` doc must say which copy it answers and point to `views`).
- [ ] **Step 3:** `npm test -w @energy8engine/scenes`, typecheck — PASS / 0. Also `npm test -w @energy8engine/flow-fx` (its `tween` uses `view()`) — PASS.
- [ ] **Step 4: Commit** — `Scenes: view() answers the copy on screen, views() every copy; load() is public and a load re-runs only the nodes it fed`.

---

### Task 2: scenes — text spacing/line height/fit, and web fonts (F18, F19)

**Files:**
- Modify: `engine/game/scenes/src/builtin.ts` (`text` schema, `styleOf`, `update`/`mount`)
- Modify: `engine/game/scenes/src/schema.ts` (`fonts`), `engine/game/scenes/src/runtime.ts` (load fonts before the boot `replace`)
- Test: `engine/game/scenes/tests/text.test.ts`, `engine/game/scenes/tests/runtime.test.ts`, `engine/game/scenes/tests/schema.test.ts`

**Interfaces:**
- Produces: `text` props `letterSpacing: number` (default 0, "px between letters"), `lineHeight: number` (default 0, "px per line; 0 = the renderer's own"), `fitWidth: number` (default 0, "shrink the font so the text fits this width, design px; 0 = off"); `scenes1` config `fonts: { family: string; src: string; weight: string; style: string }[]` (default `[]`; `src` with `.extra('asset', ['woff2', 'woff', 'ttf', 'otf'])`; `weight` default `'normal'`, `style` default `'normal'`); `ScenesConfig` gains a test seam `fontFace?: (family, url, descriptors) => { load(): Promise<unknown> }` and `fonts?: { add(face): void }` (defaults: `globalThis.FontFace`, `document.fonts`).

- [ ] **Step 1: Failing tests.**
  - `text.test.ts`: `letterSpacing: 2` and `lineHeight: 30` reach the pixi style (`view.style.letterSpacing`, `view.style.lineHeight`); `0` leaves the renderer default (`lineHeight` 0 → the style's own default, not 0); `fitWidth: 100` with a long string → the view's measured width ≤ 100 and its `style.fontSize` < `size`; a short string (width < 100) → `fontSize === size` exactly; `fitWidth: 0` → `fontSize === size` for any length; with `wrap: 80` and `fitWidth: 60` → wrapping at 80 first, then the widest line fitted to 60 (measure the view's width ≤ 60); an `update` that changes `text` from long to short restores `fontSize === size`; a bitmap-font text (`font` set, BitmapText) gets the same fit (use the test file's existing BitmapText setup if it has one; if BitmapText cannot measure in jsdom, assert through a stubbed `width` getter and say so).
  - `runtime.test.ts` (read how it boots the row with a fake `fetchFn`): with `fonts: [{ family: 'E8Test', src: 'assets/f.woff2' }]` and fake `fontFace`/`fonts`, the face is created with `url(/assets/f.woff2)` and `{ weight: 'normal', style: 'normal' }`, added, and `load()` is awaited BEFORE `replace` mounts the documents (record the order); a face whose `load()` rejects → one diagnostic naming `assets/f.woff2`, and `scenes.ready` still settles with the documents mounted; `fonts: []` → no face, no delay.
  - `schema.test.ts`: the walker still passes with the new leaves (every leaf default + description); `fonts[].src` carries the asset extra.
- [ ] **Step 2: Implement.** `styleOf` adds `letterSpacing: props.letterSpacing` and, only when `props.lineHeight > 0`, `lineHeight: props.lineHeight`. Fit (a helper used by both `mount` and `update`, after the style is assigned):

```ts
/** Shrinks the font until the laid-out text fits `fitWidth` (never grows it). */
function fitText(t: Text, props: TextProps): void {
  if (!(props.fitWidth > 0)) return;
  const width = t.width;            // measured with the full size first
  if (width <= props.fitWidth) return;
  t.style.fontSize = Math.max(1, props.size * (props.fitWidth / width));
}
```

(Pixi `Text.width` is the measured width in local space; assigning `style.fontSize` re-measures on the next read. Set the full `size` BEFORE measuring — `styleOf` already builds from `props.size`, so a re-fit after a shorter `text` starts from `size`.) Runtime: inside `scenes.ready`'s IIFE, before the GET's `scenes.replace`, `await loadFonts(config.fonts ?? [])` where each entry becomes `new FontFace(family, \`url(/${src})\`, { weight, style })`, `fonts.add(face)`, and all `face.load()` are awaited with `Promise.allSettled`; a rejected one reports `diagnostic('warning', 'scenes', src, \`font "${family}" did not load: …\`, 'check the file under the project')`. No `FontFace`/`document.fonts` in the environment (node) → skip silently.
- [ ] **Step 3:** `npm test -w @energy8engine/scenes`, typecheck; `npm test -w @energy8engine/ide-host` ALONE (it reads row schemas) — PASS / 0.
- [ ] **Step 4: Commit** — `Scenes: text gets letter spacing, line height and fit-to-width; scenes1.fonts loads web fonts before the first mount`.

---

### Task 3: flow — a `load` kind, and `emit { wait }` said for plugins (F16, F17)

**Files:**
- Modify: `engine/game/flow/src/kinds.ts` (new `load` kind beside `show`/`hide`; `emit.wait` description), `engine/game/flow/README.md` (or the package's doc file — find it; one line under `emit`, one entry for `load`)
- Test: `engine/game/flow/tests/kinds.test.ts`, `engine/game/flow/tests/events.test.ts`; `engine/game/flow-fx/tests/` (tween on a nested node)

**Interfaces:**
- Consumes: Task 1's `scenes.load(id)`, `view()`.
- Produces: flow kind `load { scene }` (`scene` with `.extra('pick', 'scene')`, required), outs `['next']`; waits `scenes.ready` like `show`; a missing `scenes` service → a warning report and `next`; an undeclared scene → the scenes service's own diagnostic, `next`.

- [ ] **Step 1: Failing tests.**
  - `kinds.test.ts`: `load { scene: 'a' }` calls `scenes.load('a')` once (after `scenes.ready`), leaves by `next`; no `scenes` service → reports a warning, `next`; `load` is in the registered kinds list the IDE palette reads (read how the registry lists kinds).
  - `events.test.ts` / `kinds.test.ts`: a plugin listener `events.on('pd.x', () => new Promise((r) => (release = r)))`; a flow `emit { event: 'pd.x', wait: true }` does not leave by `next` until `release()`; with `wait: false` it leaves at once.
  - `flow-fx`: a `tween` whose target is a node of a document nested in a shown host moves the copy on screen (the harness: a real `createScenes` with two documents, `show` the host, run the tween's `run` to the end, assert the embedded copy's `x`, not the own mount's).
- [ ] **Step 2: Implement** the `load` kind next to `show` (same `scenes` lookup and `ready` wait); the `emit.wait` description: `'hold this branch until every run the event started has ended and every plugin handler\'s returned promise has settled'`; README lines.
- [ ] **Step 3:** `npm test -w @energy8engine/flow`, `npm test -w @energy8engine/flow-fx`, typecheck both; `npm test -w @energy8engine/ide-host` ALONE (flow kinds reach the IDE palette) — PASS / 0.
- [ ] **Step 4: Commit** — `Flow: a load node readies a document to pose before show; emit's wait says it waits for a plugin's promise too`.

---

### Task 4: the shell bar can be hidden and gives its height back (F20)

**Files:**
- Modify: `engine/game/shell-pixi/src/index.ts` (provide a wrapped handle)
- Modify: `engine/game/flow/src/kinds.ts` (`shell` kind: `visible`; `ShellLike.setVisible`)
- Test: `engine/game/shell-pixi/tests/row.test.ts`, `engine/game/flow/tests/kinds.test.ts`

**Interfaces:**
- Produces: the `shell` service handle's `setVisible(v: boolean)` hides/shows the bar AND makes `barHeight` and `safeArea.bottom` answer `0` while hidden (the real values when shown, read live); every other member passes through to the Pixi shell; flow `shell` kind prop `visible: '' | 'true' | 'false'` (default `''`), applied through `flag('visible', (b) => shell.setVisible(b))`.

- [ ] **Step 1: Failing tests.**
  - `row.test.ts` (read how it builds the row with a fake `createPixiShell` or the real one): `shell.setVisible(false)` → `shell.barHeight === 0`, `shell.safeArea.bottom === 0`, and the Pixi shell's own `setVisible(false)` was called; `setVisible(true)` → both answer the Pixi shell's current values; Review Focus 5: while hidden, the Pixi shell's bar height changes (stub it) → still `0`; shown again → the NEW height; `shell.state`, `actions`, the setters still reach the Pixi shell (one of each).
  - `kinds.test.ts`: `shell { visible: 'false' }` calls `setVisible(false)`; `''` does not call it; `'maybe'` reports a bad boolean.
- [ ] **Step 2: Implement.** In `shell-pixi`, provide a `Proxy` (or an object built with `Object.create(shell)` plus own getters) over the Pixi shell: `hidden` flag; `setVisible(v) { hidden = !v; shell.setVisible(v); }`; `get barHeight() { return hidden ? 0 : shell.barHeight; }`; `get safeArea() { const s = shell.safeArea; return hidden ? { ...s, bottom: 0 } : s; }`; everything else forwarded (methods bound to the real shell). The flow root (`provideRoot('shell', () => shell.state)`) and the relay keep using the real shell. Scenes reads `ctx.reflect.get('shell').safeArea` on every fit (`runtime.ts` `insets`), so the wrapped handle is what it sees — check that a hide/show triggers a re-fit: if scenes only re-fits on resize, have the wrapper's `setVisible` also call `(ctx.reflect.get('scenes', false))?.refit?.()` if such a method exists, else emit the renderer's resize (read `scenes/src/runtime.ts`'s fit trigger and pick the least invasive; add a `refit()` to the scenes service only if nothing else re-fits, with a test in scenes).
- [ ] **Step 3:** `npm test -w @energy8engine/shell-pixi`, `npm test -w @energy8engine/flow`, `npm test -w @energy8engine/scenes` (if touched), typecheck each — PASS / 0.
- [ ] **Step 4: Commit** — `Shell: a flow can hide the bar, and a hidden bar gives its height back to the scenes`.

---

### Task 5: e2e — round 7 on a real game

**Files:**
- Create: `engine/apps/web/tests/e2e/round7.spec.ts`

**Interfaces:**
- Consumes: Tasks 1–4; `project-fixture.ts` (`projectCopy`, `startDevHost`); the game page's `window.__e8` (read `engine/examples/first-slot/src/main.ts` for what exists — add a hook only if nothing answers the question, in BOTH `main.ts` copies, byte-identical, `cmp`).

- [ ] **Step 1:** In the suite's style (read `features.spec.ts` for writing fixture documents into the project copy before `startDevHost`), write:
  - **pose before show**: a document `posed` with an image; a fixture flow (`boot → load posed → prop posed/img.x = 7 → show posed`); after boot, the image's on-screen x (through `__e8` or the scenes service via a hook) is 7 in the first frame after `show` — sample it until `posed` is visible and assert the first visible sample is 7;
  - **nested tween**: a document `inner` (a node `dot`) embedded in `outer`; the flow shows `outer`, then a `tween inner/dot x → 200`; the copy inside `outer` ends at 200 (read through `views`/`view` via a hook);
  - **fonts**: copy a real font file into the project copy (find one in the repo — e.g. under `packages/shell` — reading `packages/*` is fine, never editing), set `scenes1.fonts: [{ family: 'E8Test', src: 'assets/fonts/<file>' }]` in the copy's `e8.patch.yml`; after boot `document.fonts.check('24px "E8Test"')` is true in the game page, and a text node with `family: E8Test` renders (its style's `fontFamily` is `E8Test`);
  - **shell**: a flow `shell { visible: 'false' }` → the scenes' fitted design box grows by the bar height (read the fit through an existing hook — `__e8.fit()` exists in `main.ts`); `visible: 'true'` → back;
  - **fitWidth**: a text node with a long string and `fitWidth: 200` → its measured width ≤ 200.
- [ ] **Step 2:** Run `E8_E2E_HOST_PORT=5779 npx playwright test tests/e2e/round7.spec.ts` ALONE — PASS; `npm run typecheck -w @energy8engine/ide-web` — 0.
- [ ] **Step 3: Commit** — `E2E: round 7 — a pose set before show, a tween on a nested copy, a composed web font, a hidden bar and a fitted caption, on a real game`.

---

## After the tasks

Unit gate (each alone): `scenes`, `flow`, `flow-fx`, `shell-pixi`, `game-runtime`, `scene-edit`, `ide-client`, `ide-host` (ALONE); typecheck each. Full Playwright ALONE: `cd engine/apps/web && E8_E2E_HOST_PORT=5779 npx playwright test`.
