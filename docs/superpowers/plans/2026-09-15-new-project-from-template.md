# New Project From a Template — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the Projects sidebar, pick a template, type an id, press Create — the host copies the template into the workspace, substitutes the id, opens the project, and the game spins.

**Architecture:** A template is a directory under `engine/templates/<id>/` with an `e8.template.yml` manifest. The host's `workspace` service lists templates and gains `create({ template, id })` (validate → `cpSync` without `node_modules` → `{{id}}` substitution in three files → `rescan` → `open`), exposed as `POST /api/workspace/create`; `WorkspaceState.templates` travels on the existing wire. The client's `workspace` plugin gains `create`; `Projects.tsx` gains the form.

**Tech Stack:** Node `fs` (`cpSync`, `rmSync`), js-yaml, cordis, React 18, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-15-new-project-from-template-design.md`

## Global Constraints

- Template id and project id: `^[a-z0-9][a-z0-9-]{0,63}$`; a project id must not exist under the root.
- `{{id}}` is substituted in exactly `package.json`, `game/spec.json`, `index.html`; nothing else is rewritten; `node_modules` is never copied.
- `rootIsProject` (`e8 dev`) → `templates: []`, `create` refused with a diagnostic; the form is not drawn.
- Failure is data: unknown template / bad id / exists → 400 `{ diagnostics }`; copy failure → partial directory removed, 500; no throw out of `workspace`.
- `create` is serialized on the same chain as `open`/`close`/`rescan`.
- `slot-basic/src/main.ts` is byte-identical to `engine/examples/first-slot/src/main.ts` (pinned by a test); the template differs from `first-slot` only in `plugins/` (absent), `e8.yml` (only `bridge1`), `e8.patch.yml` (`base_game: classic`, no `reel-step` row), `package.json` (`{{id}}`, no plugin scripts), `game/spec.json` (`id`/`name` `{{id}}`, shorter description), `index.html` (`{{id}}` title).
- New projects under `engine/examples/` are git-ignored (everything but the three shipped examples).
- Every assertion with a mutation confirmed LANDED by before/after count on the ORIGINAL file.
- Playwright ALONE; `pgrep -fl e8-server | grep -v pantheon` before/after; no `e8-compose-*` and no leftover created projects under `engine/examples/` after a run.
- UI copy English. Shell zsh: no trailing `#` comments. Nothing under `packages/` staged.

---

## File map

| Task | Files |
|---|---|
| 1 | `engine/templates/slot-basic/**` (new), `.gitignore`, `engine/ide/host/tests/template.test.ts` |
| 2 | `engine/core/contracts/src/protocol.ts`, `engine/ide/host/src/plugins/workspace.ts`, `engine/ide/host/src/index.ts`, tests `workspace.test.ts`, `host.test.ts` |
| 3 | `engine/ide/client/src/plugins/workspace.ts`, `src/shell/Projects.tsx`, `src/styles.css`, tests `workspace.test.ts`, `projects.test.tsx` |
| 4 | `engine/apps/web/tests/e2e/new-project.spec.ts`, `project-fixture.ts` |

---

### Task 1: The first template

**Files:** create `engine/templates/slot-basic/{e8.template.yml,e8.yml,e8.profile.yml,e8.patch.yml,index.html,package.json,tsconfig.json,src/main.ts,game/spec.json,game/script.spin}`; modify `.gitignore`; test `engine/ide/host/tests/template.test.ts`.

- [ ] **Step 1: Test (red)** — `template.test.ts` (paths resolved from `import.meta.url` up to the repo root):
  - `slot-basic/src/main.ts` equals `first-slot/src/main.ts` byte for byte; `game/script.spin` and `tsconfig.json` and `e8.profile.yml` likewise.
  - `e8.template.yml` parses to `{ name: string, description: string }`.
  - `e8.yml` parses to exactly `[{ id: 'bridge1', name: '@energy8engine/ide-bridge', config: {} }]`.
  - `e8.patch.yml` parses; the row that binds `base_game` says `classic`; no row named `reel-step`.
  - `{{id}}` occurs in `package.json`, `game/spec.json`, `index.html` and in NO other file of the template (walk the tree).
  - no `plugins/` directory; no `node_modules`.
- [ ] **Step 2: Create the template** — `cp -R` the nine files from `first-slot`, then edit: `e8.yml` → the `bridge1` entry only (keep a two-line comment); `e8.patch.yml` → `base_game: classic`, delete the `reel-step` row and its comment; `package.json` → `{ "name": "{{id}}", "version": "0.0.0", "private": true, "type": "module", "dependencies": <first-slot's minus nothing> }` (no `scripts`); `game/spec.json` → `"id": "{{id}}", "name": "{{id}}", "description": "A 5x3 lines slot from the slot-basic template."` (rest unchanged); `index.html` `<title>{{id}} — e8 dev</title>`; `e8.template.yml`: `name: Basic slot`, `description: A 5x3 lines game with the e8-base bundle, the classic mechanic and a placeholder art set.`
- [ ] **Step 3: `.gitignore`** — replace `/engine/examples/e8-compose-*/` with:
  ```
  # Projects created by the IDE (and the Playwright copies) live beside the
  # shipped examples; only the three shipped ones are tracked.
  /engine/examples/*
  !/engine/examples/first-slot/
  !/engine/examples/probe-plugin/
  !/engine/examples/workspace/
  ```
  Verify `git status` shows nothing new and `git ls-files engine/examples | wc -l` is unchanged.
- [ ] **Step 4: Green; mutations** (edit the template: put `reel-step` back → red; add `{{id}}` to `tsconfig.json` → red; drift one byte in `main.ts` → red). Commit — "Ship the first template: a basic slot"

---

### Task 2: The host creates a project

**Files:** `engine/core/contracts/src/protocol.ts` (`Template { id, name, description }`, `WorkspaceState.templates: Template[]`), `engine/ide/host/src/plugins/workspace.ts`, `engine/ide/host/src/index.ts` (route), tests.

**Interfaces:**
```ts
export interface WorkspaceConfig { root; scope; templatesDir?: string }   // default: repo engine/templates, env E8_TEMPLATES wins
export interface WorkspaceService { …; create(input: { template: string; id: string }): Promise<Diagnostic[]> }
```

- [ ] **Step 1: Tests (red)** — `workspace.test.ts` with a temp `templatesDir` holding `good/` (manifest + files with `{{id}}` in the three places + a `node_modules/junk` file + a nested `src/x.ts` that contains the literal `{{id}}` which must NOT be substituted), `nomanifest/`, `noname/` (manifest without `name`):
  - `state().templates` = `[{ id: 'good', name, description }]`; `noname` → one `workspace` diagnostic naming it; `nomanifest` silently skipped.
  - `create({ template: 'good', id: 'new-one' })` → `[]`; directory exists; `package.json`/`spec.json`/`index.html` contain `new-one` and no `{{id}}`; `src/x.ts` still contains `{{id}}`; no `node_modules`; `state().projects` includes `new-one`; `active === 'new-one'`; the fake scope was booted with that cwd.
  - bad ids: `''`, `'A'`, `'-x'`, `'a b'`, 65 chars → refused, nothing created; existing id → refused `already exists`; unknown template → refused.
  - `rootIsProject` → `templates: []`, `create` refused.
  - copy failure: a template file made unreadable (`chmodSync(…, 0)`) → refused with the error text, `join(root, id)` absent afterwards.
  - serialization: `create` queued behind an in-flight `open` (log order).
  - `host.test.ts`: `POST /api/workspace/create` → 200 with `active`; bad body → 400; unknown template → 400; copy failure → 500.
- [ ] **Step 2: Implement** — `TEMPLATE_MANIFEST = 'e8.template.yml'`, `ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/`, `SUBSTITUTED = ['package.json', 'game/spec.json', 'index.html']`; `scanTemplates()` at boot and on `rescan()`; `create` via `enqueue`: validate → `cpSync(src, dest, { recursive: true, filter: (p) => basename(p) !== 'node_modules' })` inside try → on throw `rmSync(dest, { recursive: true, force: true })` + diagnostic → substitute (`readFileSync`/`replaceAll('{{id}}', id)`/`writeFileSync`, skip missing) → `await scan()` → `changed()` → `doOpen(id)` (same chain: call the inner function, not `service.open`, to avoid a nested enqueue). Route in `index.ts` mirroring `open`'s status mapping (400 when the refusal is validation, 500 when it names a copy failure — tag refusals with `code: 'invalid' | 'exists' | 'unknown-template' | 'copy-failed'` on the diagnostic and map codes → status, never prose).
- [ ] **Step 3: Suites; mutations** (drop `node_modules` filter; substitute in every file; skip `rmSync` on failure; `ID_PATTERN` loosened; `rootIsProject` guard dropped; code→status map broken). Commit — "Let the workspace create a project from a template"

---

### Task 3: The form

**Files:** `engine/ide/client/src/plugins/workspace.ts` (`create(input): Promise<Diagnostic[]>` — POST `/api/workspace/create`; 200 → state replaced, `[]`; else diagnostics returned AND reported), `src/shell/Projects.tsx` (section `New project`: `<select data-testid="new-project-template">` with `<option value=id>name</option>` and the selected template's `description` as muted text; `<input data-testid="new-project-id" placeholder="my-slot">`; `<button data-testid="new-project-create">Create</button>` disabled unless `ID_PATTERN` matches; Enter submits; refusals rendered as `.e8-explorer-diagnostic` under the form (`data-testid="new-project-refusal"`); on success the input clears; hidden when `templates.length === 0`), `styles.css` (a `.e8-new-project` block: grid of label/control rows using existing tokens), tests.

- [ ] **Step 1: Tests (red)** — `workspace.test.ts` (client): `create` POSTs the body; 200 → state; 400 → returned + reported. `projects.test.tsx`: form present with templates, absent without; button disabled for `A`, enabled for `my-slot`; submit → `create({ template, id })`; refusal shown under the form; success clears the input.
- [ ] **Step 2: Implement; mutations** (drop the pattern gate; drop the hidden rule; drop the refusal render; POST wrong path). Suites; typecheck; styles guards green. Commit — "Offer a new project in the sidebar"

---

### Task 4: Prove it in a browser

**Files:** `engine/apps/web/tests/e2e/new-project.spec.ts`; `project-fixture.ts` (`startHost` accepts `templatesDir?` — default the repo's `engine/templates`).

Tests (each `try/finally` with `host.stop()` + `rmSync` of the workspace copy):
1. two projects → `new-project-template` lists `slot-basic` (option text `Basic slot`); type `third-slot`, Create → `project-third-slot` has `aria-current="true"` (poll ≤ 20 s), `status-project` shows `third-slot`, `explorer-game/script.spin` visible, the preview frame's `#status` non-empty (≤ 30 s: vite optimizes deps for a fresh root); `GET /api/workspace` lists three ids.
2. `startDevHost` (single project) → no `new-project-template`.
3. id `third-slot` again after test 1's flow in the same host → `new-project-refusal` contains `already exists`; id `Bad Id` → button disabled.
Mutations: substitution skipped → test 1's `status-project` shows `{{id}}` → red; `templates: []` unconditionally → test 1 red; pattern gate dropped → test 3 red.
Cleanup: the created project lives inside the temp workspace copy (`workspaceCopy`), which `rmSync` removes — assert after the run that `engine/examples/` holds only the three shipped examples plus nothing (`ls`).
Then the whole suite alone → 85/85. Commit — "Measure a project born in the browser"

---

## Self-review
- Spec §3 rows → T1 (template, gitignore), T2 (host, route, codes), T3 (form), T4 (e2e). §6 refusal cases → T2 tests + T4 test 3. §8 risks → T1's byte-identity test; gitignore in T1; vite per-root already true.
- Type consistency: `Template`/`WorkspaceState.templates` (T2) read by T3's form and T4's `GET`; `create` input shape identical on both sides; refusal `code`s named in T2 are what T3 renders (text only — codes unused on the client, fine).
