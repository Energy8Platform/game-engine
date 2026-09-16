# Syntax Highlighting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every file the IDE opens is highlighted — TypeScript, JavaScript, JSON, YAML, CSS, HTML, Markdown through Monaco's own Monarch grammars, `.spin` through a grammar of our own — and any plugin can add or replace a language.

**Architecture:** A new client plugin `languages` holds language definitions (`id`, `extensions`, a lazy `load()` returning a Monarch grammar and an optional language configuration). `Monaco.tsx` reads that list after Monaco has loaded, registers every id synchronously before creating the editor, then loads each grammar and hands it to `setMonarchTokensProvider`; it subscribes for later registrations. Two core plugins register the languages: `languages-basic` (Monaco's grammars, lazily imported, plus a ~20-line JSON grammar of our own) and `language-spin`. `EditorDocument` asks `ctx.languages.languageFor(path)` instead of `isSpin ? 'spin' : 'plaintext'`.

**Tech Stack:** cordis 4.0.0-rc.8, React, monaco-editor 0.56.0 (Monarch tokenizers only — no language-service workers), vitest + @testing-library/react, Playwright 1.63.

**Spec:** `docs/superpowers/specs/2026-09-16-syntax-highlighting-design.md`

## Global Constraints

- **Monaco loads lazily; nothing outside `Monaco.tsx`'s `load()` evaluates Monaco.** `plugins/languages.ts`, `languages-basic.ts`, `language-spin.ts` import Monaco types only through `import type … from '../editor/monacoSlice'`. Grammar modules under `monaco-editor/languages/definitions/*` import `editor/editor.api.js` and are therefore reached only through `def.load()` (a dynamic `import()`), never a static import.
- **Monaco specifiers are spelled `monaco-editor/<path under esm/vs>`** — never `monaco-editor/esm/vs/<path>` (the package's exports map adds `esm/vs/`; spelling it twice fails `vite build`). See `engine/ide/client/src/editor/monacoSlice.ts`'s module doc.
- **No new workers.** `npm run build -w @energy8engine/ide-web` must produce the same number of `*worker*` chunks in `engine/apps/web/dist/assets` as before (measure before Task 1: `ls engine/apps/web/dist/assets | grep -c worker`).
- **A refusal is data, not state**: a grammar that fails to load is a diagnostic with `plugin: 'languages'`, retracted when the same id is registered again; the editor keeps working as plaintext.
- **Copy is English throughout** (`DESIGN.md`).
- **Do not stage anything under `packages/*`** (another session's uncommitted edits live there). `engine/examples/first-slot/concept.png` is untracked and not ours — leave it alone.
- Each task: run `npm test --workspace @energy8engine/ide-client` (whole package) and `npm run typecheck --workspace @energy8engine/ide-client` before committing. Prettier: `npx prettier --check <changed files>` from the repo root.
- Commit messages: imperative summary line; end with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

## File map

| File | Responsibility |
|---|---|
| `engine/ide/client/src/plugins/languages.ts` (new) | The `languages` service: registry of `LanguageDef`, `languageFor(path)`, `subscribe`, `failed` (reports a load failure as a diagnostic, retracted on re-registration). |
| `engine/ide/client/src/editor/Monaco.tsx` (modify) | New optional prop `languages`; registers ids before `create`, loads grammars, subscribes for late ones. |
| `engine/ide/client/src/shell/EditorDocument.tsx` (modify) | `language={ctx.languages.languageFor(path)}`, passes `languages={ctx.languages}`. |
| `engine/ide/client/src/plugins/languages-basic.ts` (new) | Registers `typescript javascript yaml css html markdown` from Monaco's definitions (lazy) and `json` from an inline Monarch grammar. |
| `engine/ide/client/src/plugins/language-spin.ts` (new) | Registers `spin`: Monarch grammar + language configuration. |
| `engine/ide/client/src/context.ts` (modify) | Composes `languages` after `slots`, `languagesBasic` and `languageSpin` after `check`. |
| `engine/ide/client/src/index.ts` (modify) | Exports `LanguageDef`, `LanguagesService` types. |
| `engine/ide/client/tests/languages.test.ts` (new) | Service unit tests. |
| `engine/ide/client/tests/monarch.ts` (new, test helper) | `tokenizeRoot(lexer, line)` — a root-state walker over a compiled Monarch grammar. |
| `engine/ide/client/tests/languages-basic.test.ts`, `language-spin.test.ts` (new) | Extension mapping; grammars compile; sample lines tokenize as expected. |
| `engine/ide/client/tests/monaco.test.tsx`, `editor-document.test.tsx` (modify) | Wrapper applies languages; document picks language from the service. |
| `engine/apps/web/tests/e2e/syntax.spec.ts` (new) | Real browser: four files, distinct `mtk*` classes, `check` markers still drawn. |

---

### Task 1: The `languages` service

**Files:**
- Create: `engine/ide/client/src/plugins/languages.ts`
- Modify: `engine/ide/client/src/context.ts` (compose after `slots`, before `shell`)
- Modify: `engine/ide/client/src/index.ts` (export types)
- Test: `engine/ide/client/tests/languages.test.ts`

**Interfaces:**
- Consumes: `createRegistry` from `@energy8engine/registry` (`{ policy: 'last-wins' }`; `add(id, value) → off`, `get(id)`, `keys()` insertion-ordered), `diagnostic()` from `@energy8engine/contracts`, `ConnectionService.report(diag) → retract` (read leniently via `ctx.reflect.get('connection', false)`, as `slots.tsx` does).
- Produces (used by Tasks 2–6):

```ts
export interface LanguageDef {
  id: string;
  /** With the dot, lower-case: '.ts'. */
  extensions: string[];
  load(): Promise<{ language: languages.IMonarchLanguage; conf?: languages.LanguageConfiguration }>;
}
export interface LanguagesService {
  register(def: LanguageDef): () => void;
  languageFor(path: string): string;
  list(): readonly LanguageDef[];
  subscribe(listener: () => void): () => void;
  failed(id: string, message: string): void;
}
export const name = 'languages';
export function apply(ctx: Context): void;
```

- [ ] **Step 1: Write the failing tests**

`engine/ide/client/tests/languages.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Context } from 'cordis';
import type { Diagnostic } from '@energy8engine/contracts';
import * as languages from '../src/plugins/languages';
import type { LanguageDef } from '../src/plugins/languages';

const grammar = async () => ({ language: { tokenizer: { root: [] } } });

function def(id: string, extensions: string[]): LanguageDef {
  return { id, extensions, load: grammar };
}

/** A stand-in for `connection`: records reports, hands back a retract that removes the entry. */
function fakeConnection() {
  const reported: Diagnostic[] = [];
  return {
    reported,
    report(diag: Diagnostic) {
      reported.push(diag);
      return () => {
        const i = reported.indexOf(diag);
        if (i >= 0) reported.splice(i, 1);
      };
    },
  };
}

async function boot(connection?: ReturnType<typeof fakeConnection>) {
  const ctx = new Context();
  if (connection) ctx.provide('connection', connection);
  await ctx.plugin(languages);
  return ctx;
}

describe('languages', () => {
  it('lists what was registered, in registration order', async () => {
    const ctx = await boot();
    ctx.languages.register(def('yaml', ['.yml', '.yaml']));
    ctx.languages.register(def('spin', ['.spin']));
    expect(ctx.languages.list().map((d) => d.id)).toEqual(['yaml', 'spin']);
  });

  it('maps a path to a language by its last extension, case-insensitively', async () => {
    const ctx = await boot();
    ctx.languages.register(def('typescript', ['.ts', '.tsx']));
    expect(ctx.languages.languageFor('src/main.ts')).toBe('typescript');
    expect(ctx.languages.languageFor('src/App.TSX')).toBe('typescript');
    expect(ctx.languages.languageFor('src/main.test.ts')).toBe('typescript');
  });

  it('answers plaintext for an unknown extension, a dotfile, and no extension', async () => {
    const ctx = await boot();
    ctx.languages.register(def('typescript', ['.ts']));
    expect(ctx.languages.languageFor('game/script.spin')).toBe('plaintext');
    expect(ctx.languages.languageFor('.gitignore')).toBe('plaintext');
    expect(ctx.languages.languageFor('Makefile')).toBe('plaintext');
    expect(ctx.languages.languageFor('a.ts/README')).toBe('plaintext');
  });

  it('the last registration for an extension wins, and says so', async () => {
    const connection = fakeConnection();
    const ctx = await boot(connection);
    ctx.languages.register(def('json', ['.json']));
    ctx.languages.register(def('jsonc', ['.json']));
    expect(ctx.languages.languageFor('x.json')).toBe('jsonc');
    expect(connection.reported).toHaveLength(1);
    expect(connection.reported[0]).toMatchObject({ severity: 'warning', plugin: 'languages', where: 'jsonc' });
    expect(connection.reported[0].message).toContain('.json');
  });

  it('registering the same id again replaces the definition', async () => {
    const ctx = await boot();
    const first = def('spin', ['.spin']);
    const second = def('spin', ['.spin', '.spinml']);
    ctx.languages.register(first);
    ctx.languages.register(second);
    expect(ctx.languages.list()).toEqual([second]);
    expect(ctx.languages.languageFor('a.spinml')).toBe('spin');
  });

  it('a retract removes the definition; a stale retract removes nothing', async () => {
    const ctx = await boot();
    const off = ctx.languages.register(def('spin', ['.spin']));
    ctx.languages.register(def('spin', ['.spin']));
    off(); // stale: the second registration is current
    expect(ctx.languages.list()).toHaveLength(1);
    expect(ctx.languages.languageFor('a.spin')).toBe('spin');
  });

  it('notifies subscribers on register and on retract, not on a stale retract', async () => {
    const ctx = await boot();
    let calls = 0;
    ctx.languages.subscribe(() => calls++);
    const off = ctx.languages.register(def('spin', ['.spin']));
    expect(calls).toBe(1);
    off();
    expect(calls).toBe(2);
    off();
    expect(calls).toBe(2);
  });

  it('failed() reports an error diagnostic, retracted when the id is registered again', async () => {
    const connection = fakeConnection();
    const ctx = await boot(connection);
    ctx.languages.register(def('spin', ['.spin']));
    ctx.languages.failed('spin', 'bad regex');
    expect(connection.reported).toHaveLength(1);
    expect(connection.reported[0]).toMatchObject({ severity: 'error', plugin: 'languages', where: 'spin' });
    expect(connection.reported[0].message).toContain('bad regex');
    ctx.languages.failed('spin', 'still bad');
    expect(connection.reported).toHaveLength(1);
    expect(connection.reported[0].message).toContain('still bad');
    ctx.languages.register(def('spin', ['.spin']));
    expect(connection.reported).toHaveLength(0);
  });

  it('works without a connection: failed() and collisions are silent', async () => {
    const ctx = await boot();
    ctx.languages.register(def('json', ['.json']));
    ctx.languages.register(def('jsonc', ['.json']));
    expect(() => ctx.languages.failed('json', 'x')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd engine/ide/client && npx vitest run tests/languages.test.ts`
Expected: FAIL — `Cannot find module '../src/plugins/languages'`.

- [ ] **Step 3: Write the service**

`engine/ide/client/src/plugins/languages.ts`:

```ts
import type { Context } from 'cordis';
import { diagnostic } from '@energy8engine/contracts';
import { createRegistry } from '@energy8engine/registry';
import type { languages } from '../editor/monacoSlice';
import type { ConnectionService } from './connection';

/**
 * One editor language. `load` is lazy on purpose: Monaco's own grammar
 * modules (`monaco-editor/languages/definitions/<lang>/<lang>.js`) import
 * `editor/editor.api.js`, which must not be evaluated before `Monaco.tsx`'s
 * own `load()` (jsdom throws; the bundle would carry it eagerly). Our own
 * grammars use the same shape so there is one shape.
 */
export interface LanguageDef {
  id: string;
  /** With the dot, lower-case: '.ts'. */
  extensions: string[];
  load(): Promise<{ language: languages.IMonarchLanguage; conf?: languages.LanguageConfiguration }>;
}

declare module 'cordis' {
  interface Context {
    languages: LanguagesService;
  }
}

export interface LanguagesService {
  /** Same id again replaces (and retracts that id's `failed` diagnostic); the return retracts this registration. */
  register(def: LanguageDef): () => void;
  /** The language for a path by its last extension, or `'plaintext'`. */
  languageFor(path: string): string;
  list(): readonly LanguageDef[];
  subscribe(listener: () => void): () => void;
  /** A grammar that could not be loaded or compiled — reported as a diagnostic; `Monaco.tsx` calls this. */
  failed(id: string, message: string): void;
}

export const name = 'languages';

/** The extension of a path's basename, with the dot, lower-cased; '' for a dotfile or no dot. */
function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

export function apply(ctx: Context) {
  const entries = createRegistry<LanguageDef>({ policy: 'last-wins' });
  const listeners = new Set<() => void>();
  const failures = new Map<string, () => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  // Read leniently, as `slots` does: this service has no static dependency
  // on `connection` and keeps working (silently) without it.
  const connection = () => ctx.reflect.get('connection', false) as ConnectionService | undefined;

  const service: LanguagesService = {
    register(def) {
      for (const other of service.list()) {
        if (other.id === def.id) continue;
        const shared = def.extensions.filter((ext) => other.extensions.includes(ext));
        if (shared.length > 0)
          connection()?.report(
            diagnostic(
              'warning',
              'languages',
              def.id,
              `"${def.id}" also claims ${shared.join(', ')}, already claimed by "${other.id}" — the later registration wins`,
              'give each extension one language',
            ),
          );
      }
      failures.get(def.id)?.();
      failures.delete(def.id);
      const off = entries.add(def.id, def);
      notify();
      return () => {
        const isCurrent = entries.get(def.id) === def;
        off();
        if (isCurrent) notify();
      };
    },
    languageFor(path) {
      const ext = extensionOf(path);
      if (ext === '') return 'plaintext';
      // Reverse: the LAST registration claiming an extension wins.
      const defs = service.list();
      for (let i = defs.length - 1; i >= 0; i--)
        if (defs[i].extensions.includes(ext)) return defs[i].id;
      return 'plaintext';
    },
    list() {
      const result: LanguageDef[] = [];
      for (const id of entries.keys()) {
        const def = entries.get(id);
        if (def) result.push(def);
      }
      return result;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    failed(id, message) {
      failures.get(id)?.();
      const retract = connection()?.report(
        diagnostic(
          'error',
          'languages',
          id,
          `language "${id}": ${message}`,
          'fix the grammar and register the language again',
        ),
      );
      failures.set(id, retract ?? (() => {}));
    },
  };

  ctx.provide('languages', service);
}
```

Note on `list()` order after a replace: `createRegistry`'s `add` under `last-wins` keeps the ORIGINAL insertion position of an id or moves it to the end — read `engine/core/registry/src/index.ts` and, if a replaced id keeps its old position, that is fine for every test above (the "same id again" test asserts `[second]` on a single id). Do not change the registry.

- [ ] **Step 4: Compose it and export the types**

In `engine/ide/client/src/context.ts`, add the import next to the others and compose right after `slots`:

```ts
import * as languages from './plugins/languages';
…
  await ctx.plugin(slots);
  // Languages are a contribution like slots: a registry a plugin's client
  // half adds to. Composed before `shell` so that anything composed after
  // — a project plugin included — can register one.
  await ctx.plugin(languages);
  …
  await ctx.plugin(shell);
```

In `engine/ide/client/src/index.ts`, next to the `slots` export line:

```ts
export { type LanguageDef, type LanguagesService } from './plugins/languages';
```

- [ ] **Step 5: Run the tests, typecheck, prettier**

Run: `cd engine/ide/client && npx vitest run tests/languages.test.ts && npm test && npm run typecheck && cd ../../.. && npx prettier --check engine/ide/client/src/plugins/languages.ts engine/ide/client/src/context.ts engine/ide/client/src/index.ts engine/ide/client/tests/languages.test.ts`
Expected: all PASS; prettier clean (run `npx prettier --write` on the same files if not).

- [ ] **Step 6: Commit**

```bash
git add engine/ide/client/src/plugins/languages.ts engine/ide/client/src/context.ts engine/ide/client/src/index.ts engine/ide/client/tests/languages.test.ts
git commit -m "Add the languages contribution: definitions, extension lookup, a reported failure

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `Monaco.tsx` applies the registered languages

**Files:**
- Modify: `engine/ide/client/src/editor/Monaco.tsx`
- Test: `engine/ide/client/tests/monaco.test.tsx`

**Interfaces:**
- Consumes: `LanguageDef`, `LanguagesService` from Task 1 (only `list`, `subscribe`, `failed`).
- Produces: `MonacoProps.languages?: LanguageSource` where

```ts
export type LanguageSource = Pick<LanguagesService, 'list' | 'subscribe' | 'failed'>;
```

**Order matters:** Monaco binds a model to a language at `create` time; an id it has not heard of becomes `plaintext` and never recovers. So every id is passed to `monaco.languages.register({ id, extensions })` synchronously BEFORE `monaco.editor.create`; the grammar (`def.load()` → `setMonarchTokensProvider`) may arrive later — Monaco retokenizes when a provider is set.

- [ ] **Step 1: Extend the fake and write the failing tests**

In `engine/ide/client/tests/monaco.test.tsx`, inside the `vi.hoisted` block, add a languages API factory and expose it on the fake object:

```ts
  /** The `monaco.languages` surface the wrapper drives; fresh per test, same as `editor`. */
  const makeLanguagesApi = () => {
    const api = {
      registered: [] as Array<{ id: string; extensions?: string[] }>,
      providers: {} as Record<string, unknown>,
      configurations: {} as Record<string, unknown>,
      /** Ids whose `setMonarchTokensProvider` throws — the compile-failure seam. */
      broken: new Set<string>(),
      register(def: { id: string; extensions?: string[] }) {
        api.registered.push(def);
      },
      setMonarchTokensProvider(id: string, grammar: unknown) {
        if (api.broken.has(id)) throw new Error(`cannot compile ${id}`);
        api.providers[id] = grammar;
      },
      setLanguageConfiguration(id: string, conf: unknown) {
        api.configurations[id] = conf;
      },
    };
    return api;
  };
```

and in the returned object: `makeLanguagesApi, languages: makeLanguagesApi(),`. In `beforeEach`, add `fake.languages = fake.makeLanguagesApi();`.

Add a source fake and the tests (at the end of the `describe('Monaco', …)` block):

```ts
  /** A stand-in for `ctx.languages`: the three members the wrapper reads. */
  function source(defs: Array<{ id: string; extensions: string[]; load: () => Promise<any> }>) {
    const listeners = new Set<() => void>();
    const failures: [string, string][] = [];
    return {
      defs,
      failures,
      list: () => defs,
      subscribe(fn: () => void) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      failed(id: string, message: string) {
        failures.push([id, message]);
      },
      add(def: { id: string; extensions: string[]; load: () => Promise<any> }) {
        defs.push(def);
        listeners.forEach((fn) => fn());
      },
    };
  }

  const spinGrammar = { tokenizer: { root: [] } };
  const spinConf = { comments: { lineComment: '--' } };

  it('registers every language id before creating the editor', async () => {
    const src = source([
      { id: 'spin', extensions: ['.spin'], load: async () => ({ language: spinGrammar, conf: spinConf }) },
      { id: 'yaml', extensions: ['.yml'], load: async () => ({ language: { tokenizer: { root: [] } } }) },
    ]);
    await mount({ languages: src });
    expect(fake.languages.registered.map((d) => d.id)).toEqual(['spin', 'yaml']);
    expect(fake.languages.registered[0].extensions).toEqual(['.spin']);
    // `registered` is filled inside `load().then(...)` before `create` — the fake records creation order through `editors`.
    expect(fake.editors).toHaveLength(1);
  });

  it('hands each grammar and configuration to Monaco once loaded', async () => {
    const src = source([
      { id: 'spin', extensions: ['.spin'], load: async () => ({ language: spinGrammar, conf: spinConf }) },
      { id: 'yaml', extensions: ['.yml'], load: async () => ({ language: { tokenizer: { root: [] } } }) },
    ]);
    await mount({ languages: src });
    await waitFor(() => expect(fake.languages.providers.spin).toBe(spinGrammar));
    expect(fake.languages.configurations.spin).toBe(spinConf);
    expect(fake.languages.providers.yaml).toBeDefined();
    expect(fake.languages.configurations.yaml).toBeUndefined();
    expect(src.failures).toEqual([]);
  });

  it('a language registered after the editor exists is applied too', async () => {
    const src = source([]);
    await mount({ languages: src });
    src.add({ id: 'late', extensions: ['.late'], load: async () => ({ language: spinGrammar }) });
    await waitFor(() => expect(fake.languages.providers.late).toBe(spinGrammar));
    expect(fake.languages.registered.map((d) => d.id)).toEqual(['late']);
  });

  it('a grammar that fails to load is reported through failed(); the others still apply', async () => {
    const src = source([
      { id: 'bad', extensions: ['.bad'], load: async () => { throw new Error('no such module'); } },
      { id: 'spin', extensions: ['.spin'], load: async () => ({ language: spinGrammar }) },
    ]);
    await mount({ languages: src });
    await waitFor(() => expect(src.failures).toEqual([['bad', 'no such module']]));
    await waitFor(() => expect(fake.languages.providers.spin).toBe(spinGrammar));
    expect(fake.languages.registered.map((d) => d.id)).toEqual(['bad', 'spin']);
  });

  it('a grammar Monaco cannot compile is reported the same way', async () => {
    fake.languages.broken.add('spin');
    const src = source([{ id: 'spin', extensions: ['.spin'], load: async () => ({ language: spinGrammar }) }]);
    await mount({ languages: src });
    await waitFor(() => expect(src.failures).toEqual([['spin', 'cannot compile spin']]));
  });

  it('the same definition is not applied twice across two editors on one page', async () => {
    const def = { id: 'spin', extensions: ['.spin'], load: vi.fn(async () => ({ language: spinGrammar })) };
    const src = source([def]);
    await mount({ languages: src });
    await mount({ languages: src });
    await waitFor(() => expect(fake.languages.providers.spin).toBe(spinGrammar));
    expect(def.load).toHaveBeenCalledTimes(1);
    expect(fake.languages.registered).toHaveLength(1);
  });

  it('a replaced definition (same id, new object) is loaded again', async () => {
    const src = source([{ id: 'spin', extensions: ['.spin'], load: async () => ({ language: spinGrammar }) }]);
    await mount({ languages: src });
    await waitFor(() => expect(fake.languages.providers.spin).toBe(spinGrammar));
    const next = { tokenizer: { root: [[/x/, 'x']] } };
    src.defs.length = 0;
    src.add({ id: 'spin', extensions: ['.spin'], load: async () => ({ language: next }) });
    await waitFor(() => expect(fake.languages.providers.spin).toBe(next));
  });

  it('works without a languages source, as before', async () => {
    await mount();
    expect(fake.languages.registered).toEqual([]);
  });
```

`mount` already spreads `props` over the defaults, so `mount({ languages: src })` needs no change to the helper.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd engine/ide/client && npx vitest run tests/monaco.test.tsx`
Expected: the new tests FAIL (`registered` stays `[]`); the existing ones still pass.

- [ ] **Step 3: Implement**

In `engine/ide/client/src/editor/Monaco.tsx`:

Add the imports and prop:

```ts
import type { LanguageDef, LanguagesService } from '../plugins/languages';

/** What the wrapper reads from `ctx.languages` — a source of definitions, and somewhere to report a grammar that failed. */
export type LanguageSource = Pick<LanguagesService, 'list' | 'subscribe' | 'failed'>;

export interface MonacoProps {
  value: string;
  language: string;
  /** Markers, placed by `Diagnostic.at`. A diagnostic without `at` is not drawn. */
  diagnostics: readonly Diagnostic[];
  /** Where languages come from; without it the editor knows only Monaco's own `plaintext`. */
  languages?: LanguageSource;
  onChange(next: string): void;
}
```

Add, after the `defined` WeakMap:

```ts
/**
 * Which definition each language id was last applied FROM, per Monaco API
 * object — `monaco.languages` is global to the page, so two editors must
 * not register (or load) the same definition twice, while a REPLACED
 * definition (same id, new object) must be loaded again. Keyed by the API
 * object for the same reason `defined` is: a test with a fresh fake starts
 * empty. Monaco cannot unregister a language, so a retracted definition
 * simply stops being re-applied; its id stays known to Monaco.
 */
const applied = new WeakMap<Api['languages'], Map<string, LanguageDef>>();

/**
 * Registers every id Monaco has not seen (synchronously — a model created
 * for an unknown id is plaintext for good), then loads each grammar and
 * hands it over; a grammar that cannot be loaded or compiled goes to
 * `source.failed`, and the other languages are unaffected.
 */
function applyLanguages(monaco: Api, source: LanguageSource): void {
  let seen = applied.get(monaco.languages);
  if (!seen) applied.set(monaco.languages, (seen = new Map()));
  for (const def of source.list()) {
    if (seen.get(def.id) === def) continue;
    seen.set(def.id, def);
    monaco.languages.register({ id: def.id, extensions: def.extensions });
    def
      .load()
      .then(({ language, conf }) => {
        // Replaced while loading: the newer definition's own load applies.
        if (seen!.get(def.id) !== def) return;
        monaco.languages.setMonarchTokensProvider(def.id, language);
        if (conf) monaco.languages.setLanguageConfiguration(def.id, conf);
      })
      .catch((error: unknown) => {
        source.failed(def.id, error instanceof Error ? error.message : String(error));
      });
  }
}
```

In the component: add `languages` to the destructured props, and inside `load().then((monaco) => { … })`, immediately after the `self.MonacoEnvironment ??= …` line and BEFORE `monaco.editor.create`:

```ts
        let unsubscribe: (() => void) | undefined;
        if (languages) {
          applyLanguages(monaco, languages);
          unsubscribe = languages.subscribe(() => applyLanguages(monaco, languages));
        }
```

`unsubscribe` must be declared in the effect's outer scope (next to `editor`, `observer`) so the cleanup can call it: add `let unsubscribe: (() => void) | undefined;` beside `let observer …`, assign inside `.then`, and in the cleanup add `unsubscribe?.();`. Keep `languages` out of the effect's dependency array (creation-time, like `value`/`language`; the existing eslint-disable comment covers it) — the source object is stable for the life of a document.

- [ ] **Step 4: Run the tests, typecheck, prettier**

Run: `cd engine/ide/client && npx vitest run tests/monaco.test.tsx tests/monaco-jsdom.test.tsx && npm test && npm run typecheck && cd ../../.. && npx prettier --check engine/ide/client/src/editor/Monaco.tsx engine/ide/client/tests/monaco.test.tsx`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add engine/ide/client/src/editor/Monaco.tsx engine/ide/client/tests/monaco.test.tsx
git commit -m "Teach the editor the registered languages: ids before create, grammars as they load

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `EditorDocument` asks the service

**Files:**
- Modify: `engine/ide/client/src/shell/EditorDocument.tsx:72-74, 233-241`
- Test: `engine/ide/client/tests/editor-document.test.tsx`

**Interfaces:**
- Consumes: `ctx.languages.languageFor(path)` (Task 1), `MonacoProps.languages` (Task 2). The test harness's `createIdeClient` composes `languages` since Task 1, so `ctx.languages` exists in every existing test.

- [ ] **Step 1: Write the failing tests**

In `engine/ide/client/tests/editor-document.test.tsx`, add a `describe` at the end. The file's `fake` for `monacoSlice` records `options` per editor (`editorOn(el).options`) — see its `create` in the hoisted block; `languageFor` is what this asserts through. Read the file's existing `harness`/`openTab`/`files` helpers and use them as the neighbouring tests do:

```ts
describe('EditorDocument language', () => {
  it('asks ctx.languages for the language of the path', async () => {
    const ctx = await harness(files({ 'src/main.ts': 'const a = 1' }));
    ctx.languages.register({ id: 'typescript', extensions: ['.ts'], load: async () => ({ language: { tokenizer: { root: [] } } }) });
    openTab(ctx, 'src/main.ts');
    render(<EditorDocument ctx={ctx} path="src/main.ts" />);
    const el = await screen.findByTestId('editor');
    await waitFor(() => expect(editorOn(el).options.language).toBe('typescript'));
  });

  it('a path no language claims is plaintext', async () => {
    const ctx = await harness(files({ 'notes.txt': 'hi' }));
    openTab(ctx, 'notes.txt');
    render(<EditorDocument ctx={ctx} path="notes.txt" />);
    const el = await screen.findByTestId('editor');
    await waitFor(() => expect(editorOn(el).options.language).toBe('plaintext'));
  });

  it('hands the languages service to the editor', async () => {
    const ctx = await harness(files({ 'game/script.spin': 'game "x" {}' }));
    const grammar = { tokenizer: { root: [] } };
    ctx.languages.register({ id: 'spin', extensions: ['.spin'], load: async () => ({ language: grammar }) });
    openTab(ctx, 'game/script.spin');
    render(<EditorDocument ctx={ctx} path="game/script.spin" />);
    await screen.findByTestId('editor');
    await waitFor(() => expect(fake.languages.providers.spin).toBe(grammar));
  });

  it('still checks only .spin files', async () => {
    const ctx = await harness(files({ 'src/main.ts': 'const a = 1' }));
    ctx.languages.register({ id: 'typescript', extensions: ['.ts'], load: async () => ({ language: { tokenizer: { root: [] } } }) });
    openTab(ctx, 'src/main.ts');
    render(<EditorDocument ctx={ctx} path="src/main.ts" />);
    await screen.findByTestId('editor');
    await act(async () => {});
    expect(ctx.check.calls).toEqual([]);
  });
});
```

This file has its own hoisted `monacoSlice` fake (line ~47: `return { editors, MarkerSeverity, editor: { create … } }`) with NO `languages` member — and after this task `Monaco.tsx` calls `monaco.languages.register` for every mount that passes a source, which is every `<EditorDocument/>` here. A missing member would throw inside `load().then(…)` and turn every existing test into "the editor could not start here". So, unconditionally: copy `makeLanguagesApi` from `tests/monaco.test.tsx` (Task 2) into this file's hoisted block verbatim, add `makeLanguagesApi, languages: makeLanguagesApi(),` to the returned object, and add `fake.languages = fake.makeLanguagesApi();` to the existing top-level `beforeEach` (line ~226, the one resetting `location.hash`). `harness(...)` returns the `ctx` itself (see the existing tests: `const ctx = await harness(files(...))`); the tests above follow that.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd engine/ide/client && npx vitest run tests/editor-document.test.tsx`
Expected: the first and third new tests FAIL (`language` is `'plaintext'`; no provider handed over).

- [ ] **Step 3: Implement**

In `engine/ide/client/src/shell/EditorDocument.tsx`, keep `isSpin` (it still gates `check`) and change the `<Monaco/>` element:

```tsx
      <Monaco
        value={text}
        language={ctx.languages.languageFor(path)}
        languages={ctx.languages}
        diagnostics={checkDiagnostics}
        onChange={(next) => {
          setText(next);
          if (isSpin(path)) scheduleCheck(next);
        }}
      />
```

Update `isSpin`'s doc comment to say the language of the DOCUMENT now comes from `ctx.languages`; this predicate only decides what `ctx.check` reads.

- [ ] **Step 4: Run the tests, typecheck, prettier**

Run: `cd engine/ide/client && npm test && npm run typecheck && cd ../../.. && npx prettier --check engine/ide/client/src/shell/EditorDocument.tsx engine/ide/client/tests/editor-document.test.tsx`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add engine/ide/client/src/shell/EditorDocument.tsx engine/ide/client/tests/editor-document.test.tsx
git commit -m "Let the document ask which language it is in

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `languages-basic` — Monaco's grammars, and JSON

**Files:**
- Create: `engine/ide/client/src/plugins/languages-basic.ts`
- Create: `engine/ide/client/tests/monarch.ts` (test helper)
- Create: `engine/ide/client/tests/languages-basic.test.ts`
- Modify: `engine/ide/client/src/context.ts` (compose after `check`)

**Interfaces:**
- Consumes: `LanguageDef`, `ctx.languages.register` (Task 1).
- Produces: `tokenizeRoot(lexer, line): string[]` in `tests/monarch.ts` (Task 5 uses it); `export const json: languages.IMonarchLanguage` and `export const DEFINITIONS: readonly LanguageDef[]` from `languages-basic.ts`.

**Measured facts (2026-09-16):** `monaco-editor/editor/standalone/common/monarch/monarchCompile.js` loads under this package's vitest; so does `monaco-editor/languages/definitions/yaml/yaml.js` (and by the same token the other six). A compiled rule has `regex` (`^(?:…)`-anchored), `action` (a plain string like `'comment'` or `'@brackets'`; or an object with `test(matched, matches, state, eos)` returning the string for `{ cases: … }`), and `matchOnlyAtLineStart`. Monaco's `json` has no Monarch grammar — its tokenizer lives in the JSON language service — hence our own below.

- [ ] **Step 1: Write the helper**

`engine/ide/client/tests/monarch.ts`:

```ts
import { compile } from 'monaco-editor/editor/standalone/common/monarch/monarchCompile.js';
import type { languages } from '../src/editor/monacoSlice';

type Compiled = ReturnType<typeof compile>;

export function compileGrammar(id: string, grammar: languages.IMonarchLanguage): Compiled {
  return compile(id, grammar);
}

/**
 * A root-state walk over a compiled Monarch grammar: at each position the
 * first rule whose regex matches wins, exactly Monarch's own order, and its
 * token string is recorded. Only the `root` state is walked — a rule that
 * switches state (`next`) is followed no further, so grammars under test
 * keep single-line constructs (strings, `--` comments) in `root`. `'?'`
 * marks a character no rule matched. Not a claim about Monaco's lexer; a
 * claim about which RULE a piece of text falls to.
 */
export function tokenizeRoot(lexer: Compiled, line: string): string[] {
  const out: string[] = [];
  let pos = 0;
  while (pos < line.length) {
    const rest = line.slice(pos);
    let matched = false;
    for (const rule of lexer.tokenizer.root as any[]) {
      if (rule.matchOnlyAtLineStart && pos > 0) continue;
      const m = rule.regex.exec(rest) as RegExpExecArray | null;
      if (!m || m.index !== 0 || m[0].length === 0) continue;
      const action = rule.action;
      const token: string =
        typeof action === 'string'
          ? action
          : typeof action.test === 'function'
            ? action.test(m[0], m, 'root', pos + m[0].length === line.length)
            : action.token;
      out.push(token);
      pos += m[0].length;
      matched = true;
      break;
    }
    if (!matched) {
      out.push('?');
      pos++;
    }
  }
  return out;
}

/** The tokens of `line` with `white` dropped — what a reader's eye sees. */
export function visible(lexer: Compiled, line: string): string[] {
  return tokenizeRoot(lexer, line).filter((t) => t !== 'white');
}
```

- [ ] **Step 2: Write the failing tests**

`engine/ide/client/tests/languages-basic.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Context } from 'cordis';
import * as languages from '../src/plugins/languages';
import * as basic from '../src/plugins/languages-basic';
import { compileGrammar, visible } from './monarch';

async function boot() {
  const ctx = new Context();
  await ctx.plugin(languages);
  await ctx.plugin(basic);
  return ctx;
}

describe('languages-basic', () => {
  it('claims the extensions the projects use', async () => {
    const ctx = await boot();
    const cases: [string, string][] = [
      ['src/main.ts', 'typescript'],
      ['src/App.tsx', 'typescript'],
      ['vite.config.js', 'javascript'],
      ['bin/e8.mjs', 'javascript'],
      ['x.cjs', 'javascript'],
      ['x.jsx', 'javascript'],
      ['game/spec.json', 'json'],
      ['tsconfig.jsonc', 'json'],
      ['e8.yml', 'yaml'],
      ['e8.yaml', 'yaml'],
      ['styles.css', 'css'],
      ['index.html', 'html'],
      ['README.md', 'markdown'],
      ['game/script.spin', 'plaintext'],
    ];
    for (const [path, id] of cases) expect(ctx.languages.languageFor(path), path).toBe(id);
  });

  it("every Monaco grammar loads and compiles (the module path is the one that fails a build when misspelled)", async () => {
    for (const def of basic.DEFINITIONS) {
      const { language } = await def.load();
      expect(() => compileGrammar(def.id, language), def.id).not.toThrow();
    }
  }, 20_000);

  it('the JSON grammar tells keys from values, and comments from both', () => {
    const lexer = compileGrammar('json', basic.json);
    expect(visible(lexer, '{ "cols": 5, "name": "x", "on": true, "v": null, "f": -1.5e3 }')).toEqual([
      '@brackets',
      'type', 'delimiter', 'number', 'delimiter',
      'type', 'delimiter', 'string', 'delimiter',
      'type', 'delimiter', 'keyword', 'delimiter',
      'type', 'delimiter', 'keyword', 'delimiter',
      'type', 'delimiter', 'number.float',
      '@brackets',
    ]);
    expect(visible(lexer, '["a", 1] // trailing')).toEqual(['@brackets', 'string', 'delimiter', 'number', '@brackets', 'comment']);
    expect(visible(lexer, '"esc\\"aped": 1')).toEqual(['type', 'delimiter', 'number']);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd engine/ide/client && npx vitest run tests/languages-basic.test.ts`
Expected: FAIL — `Cannot find module '../src/plugins/languages-basic'`.

- [ ] **Step 4: Write the plugin**

`engine/ide/client/src/plugins/languages-basic.ts`:

```ts
import type { Context } from 'cordis';
import type { languages } from '../editor/monacoSlice';
import type { LanguageDef } from './languages';

/**
 * The languages a slot project is written in, from Monaco's own Monarch
 * grammars — tokenizers only, none of the language SERVICES (TypeScript's
 * alone is 9.4 MB of workers; see `monacoSlice.ts`). Each grammar module
 * imports `editor/editor.api.js`, so each is reached through a dynamic
 * `import()` inside `load` and never at module evaluation: the bundle
 * gets one small chunk per grammar, fetched on the first file of that
 * kind, and this module stays loadable where Monaco is not (jsdom).
 *
 * Specifiers are `monaco-editor/languages/definitions/<lang>/<lang>.js`,
 * with no `esm/vs/` segment — the package's exports map supplies it.
 */
export const DEFINITIONS: readonly LanguageDef[] = [
  {
    id: 'typescript',
    extensions: ['.ts', '.tsx'],
    load: () => import('monaco-editor/languages/definitions/typescript/typescript.js'),
  },
  {
    id: 'javascript',
    extensions: ['.js', '.mjs', '.cjs', '.jsx'],
    load: () => import('monaco-editor/languages/definitions/javascript/javascript.js'),
  },
  {
    id: 'yaml',
    extensions: ['.yml', '.yaml'],
    load: () => import('monaco-editor/languages/definitions/yaml/yaml.js'),
  },
  { id: 'css', extensions: ['.css'], load: () => import('monaco-editor/languages/definitions/css/css.js') },
  { id: 'html', extensions: ['.html'], load: () => import('monaco-editor/languages/definitions/html/html.js') },
  {
    id: 'markdown',
    extensions: ['.md'],
    load: () => import('monaco-editor/languages/definitions/markdown/markdown.js'),
  },
  { id: 'json', extensions: ['.json', '.jsonc'], load: async () => ({ language: json, conf: jsonConf }) },
];

/**
 * Monaco ships no Monarch grammar for JSON — its tokenizer is part of the
 * JSON language service, which brings a worker. Twenty lines here instead:
 * a key (a string followed by `:`) is `type`, so keys and values read
 * differently; `//` and block comments for the `.jsonc` files tooling
 * writes.
 */
export const json: languages.IMonarchLanguage = {
  tokenizer: {
    root: [
      [/\/\/.*$/, 'comment'],
      [/\/\*/, 'comment', '@comment'],
      [/"(?:[^"\\]|\\.)*"(?=\s*:)/, 'type'],
      [/"(?:[^"\\]|\\.)*"/, 'string'],
      [/-?\d+\.\d+(?:[eE][-+]?\d+)?/, 'number.float'],
      [/-?\d+(?:[eE][-+]?\d+)?/, 'number'],
      [/\b(?:true|false|null)\b/, 'keyword'],
      [/[{}[\]]/, '@brackets'],
      [/[,:]/, 'delimiter'],
      [/\s+/, 'white'],
    ],
    comment: [
      [/[^*/]+/, 'comment'],
      [/\*\//, 'comment', '@pop'],
      [/[*/]/, 'comment'],
    ],
  },
};

const jsonConf: languages.LanguageConfiguration = {
  comments: { lineComment: '//', blockComment: ['/*', '*/'] },
  brackets: [
    ['{', '}'],
    ['[', ']'],
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '"', close: '"', notIn: ['string'] },
  ],
};

export const name = 'languages-basic';

export const inject = ['languages'];

export function apply(ctx: Context) {
  for (const def of DEFINITIONS) ctx.effect(() => ctx.languages.register(def));
}
```

`import()` of a grammar module resolves to `{ conf, language }` — exactly `LanguageDef.load`'s return shape, so the arrow needs no mapping. If `tsc` complains that the module's `conf`/`language` types are not assignable (Monaco types them against its own `languages` namespace, which is the same object `monacoSlice` re-exports), wrap: `load: () => import('…').then(({ conf, language }) => ({ conf, language }))` — and do it uniformly for all six.

- [ ] **Step 5: Compose it**

In `engine/ide/client/src/context.ts`, after `await ctx.plugin(check, config);`:

```ts
import * as languagesBasic from './plugins/languages-basic';
…
  // The two core language providers: Monaco's own grammars for the files
  // a project is made of, and `.spin`. Composed last — they are pure
  // contributions to `languages`, and a project plugin composed later
  // may replace either by registering the same id.
  await ctx.plugin(languagesBasic);
```

- [ ] **Step 6: Run the tests, typecheck, prettier**

Run: `cd engine/ide/client && npx vitest run tests/languages-basic.test.ts && npm test && npm run typecheck && cd ../../.. && npx prettier --check engine/ide/client/src/plugins/languages-basic.ts engine/ide/client/src/context.ts engine/ide/client/tests/monarch.ts engine/ide/client/tests/languages-basic.test.ts`
Expected: all PASS. If `editor-document.test.tsx` now sees a real language for `.ts` where a test asserted `plaintext`, that test was asserting the old default — update its expectation to the real language id.

- [ ] **Step 7: Commit**

```bash
git add engine/ide/client/src/plugins/languages-basic.ts engine/ide/client/src/context.ts engine/ide/client/tests/monarch.ts engine/ide/client/tests/languages-basic.test.ts
git commit -m "Register Monaco's grammars for the project's own file kinds, and a JSON of our own

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `language-spin`

**Files:**
- Create: `engine/ide/client/src/plugins/language-spin.ts`
- Create: `engine/ide/client/tests/language-spin.test.ts`
- Modify: `engine/ide/client/src/context.ts` (compose after `languagesBasic`)

**Interfaces:**
- Consumes: `ctx.languages.register` (Task 1); `compileGrammar`, `visible` from `tests/monarch.ts` (Task 4).
- Produces: `export const spin: languages.IMonarchLanguage`, `export const spinConf: languages.LanguageConfiguration`.

**The language, measured from `spinml`'s lexer/parser/types (`casino_platform/e8/crates/spinml/src/`):** lexer keywords `fn let if else while for in return break continue true false`; top-level declarations are identifiers the parser checks at statement start: `record enum game action const`; `tag` is contextual (`enum Name tag stage {`); types `int float bool ctx outcome str`, arrays `[T]` and `[T; N]`; `--` line comments; `"…"` strings with no newline; `int`/`float` literals; operators `&& || !`, comparisons, arithmetic, `->` return arrow; context methods `c.<ident>(…)`.

- [ ] **Step 1: Write the failing tests**

`engine/ide/client/tests/language-spin.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Context } from 'cordis';
import * as languages from '../src/plugins/languages';
import * as spinLanguage from '../src/plugins/language-spin';
import { compileGrammar, visible } from './monarch';

const lexer = compileGrammar('spin', spinLanguage.spin);

describe('language-spin', () => {
  it('claims .spin', async () => {
    const ctx = new Context();
    await ctx.plugin(languages);
    await ctx.plugin(spinLanguage);
    expect(ctx.languages.languageFor('game/script.spin')).toBe('spin');
    const { language, conf } = await ctx.languages.list()[0].load();
    expect(language).toBe(spinLanguage.spin);
    expect(conf?.comments?.lineComment).toBe('--');
  });

  it('a function header: keyword, name, parameters with types, the arrow, the return type', () => {
    expect(visible(lexer, 'fn pay_for(sym: int, count: int) -> float {')).toEqual([
      'keyword', 'identifier', '@brackets',
      'identifier', 'delimiter', 'type', 'delimiter',
      'identifier', 'delimiter', 'type',
      '@brackets', 'operator', 'type', '@brackets',
    ]);
  });

  it('a comment runs to the end of the line, whatever it contains', () => {
    expect(visible(lexer, 'let x = 1 -- fn "not a string" {')).toEqual(['keyword', 'identifier', 'operator', 'number', 'comment']);
  });

  it('strings, numbers, booleans', () => {
    expect(visible(lexer, 'game "first-slot" {')).toEqual(['keyword', 'string', '@brackets']);
    expect(visible(lexer, 'bet_levels = [0.2, 1.0, 5.0]')).toEqual([
      'identifier', 'operator', '@brackets', 'number.float', 'delimiter', 'number.float', 'delimiter', 'number.float', '@brackets',
    ]);
    expect(visible(lexer, 'if a && !b || c == true {')).toEqual([
      'keyword', 'identifier', 'operator', 'operator', 'identifier', 'operator', 'identifier', 'operator', 'keyword', '@brackets',
    ]);
  });

  it('declarations are keywords at the start of a line, identifiers elsewhere', () => {
    expect(visible(lexer, 'record Vars {')).toEqual(['keyword', 'identifier', '@brackets']);
    expect(visible(lexer, 'const SYM_W: [int; 6] = [5, 10]')).toEqual([
      'keyword', 'identifier', 'delimiter', '@brackets', 'type', 'delimiter', 'number', '@brackets',
      'operator', '@brackets', 'number', 'delimiter', 'number', '@brackets',
    ]);
    expect(visible(lexer, 'action spin {')).toEqual(['keyword', 'identifier', '@brackets']);
    expect(visible(lexer, 'let record = 1')).toEqual(['keyword', 'identifier', 'operator', 'number']);
  });

  it('tag is a keyword only in an enum header', () => {
    expect(visible(lexer, 'enum SpinData tag stage {')).toEqual(['keyword', 'identifier', 'keyword', 'identifier', '@brackets']);
    expect(visible(lexer, 'let tag = 2')).toEqual(['keyword', 'identifier', 'operator', 'number']);
  });

  it('a context method is a function; the context itself is a type', () => {
    expect(visible(lexer, 'fn fill(c: ctx) { let r = c.rand(6)')).toEqual([
      'keyword', 'identifier', '@brackets', 'identifier', 'delimiter', 'type', '@brackets', '@brackets',
      'keyword', 'identifier', 'operator', 'function', '@brackets', 'number', '@brackets',
    ]);
  });

  it('nothing in the reference script falls to no rule', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const here = fileURLToPath(new URL('.', import.meta.url));
    const text = readFileSync(`${here}/../../../examples/first-slot/game/script.spin`, 'utf8');
    for (const line of text.split('\n')) expect(visible(lexer, line), line).not.toContain('?');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd engine/ide/client && npx vitest run tests/language-spin.test.ts`
Expected: FAIL — `Cannot find module '../src/plugins/language-spin'`.

- [ ] **Step 3: Write the plugin**

`engine/ide/client/src/plugins/language-spin.ts`:

```ts
import type { Context } from 'cordis';
import type { languages } from '../editor/monacoSlice';

/**
 * A Monarch grammar for `.spin` (SpinML), written from the language's
 * own lexer and parser (`casino_platform/e8/crates/spinml/src/`): the
 * lexer's keyword table, the parser's top-level declaration words —
 * identifiers to the lexer, keywords to a reader, so they are keywords
 * here only at the start of a line, where the parser accepts them — and
 * `tag`, which the parser recognises only inside an enum header. Every
 * construct is single-line (a `--` comment ends with the line, a string
 * may not contain a newline), so the whole grammar is one `root` state,
 * which is also what lets `tests/monarch.ts` walk it.
 */
export const spin: languages.IMonarchLanguage = {
  keywords: ['fn', 'let', 'if', 'else', 'while', 'for', 'in', 'return', 'break', 'continue', 'true', 'false'],
  declarations: ['record', 'enum', 'game', 'action', 'const'],
  types: ['int', 'float', 'bool', 'ctx', 'outcome', 'str'],
  tokenizer: {
    root: [
      [/--.*$/, 'comment'],
      [/"[^"\n]*"/, 'string'],
      // A declaration word opens a top-level block, and top level is column 0.
      [/^(?:record|enum|game|action|const)\b/, 'keyword'],
      // `enum Name tag stage {` — `tag` followed by the tag's name and the block.
      [/\btag\b(?=\s+[a-zA-Z_]\w*\s*\{)/, 'keyword'],
      // A context method: `c.rand(6)`, `c.pick(...)`.
      [/\bc\.[a-zA-Z_]\w*/, 'function'],
      [/[a-zA-Z_]\w*/, { cases: { '@keywords': 'keyword', '@types': 'type', '@default': 'identifier' } }],
      [/\d+\.\d+/, 'number.float'],
      [/\d+/, 'number'],
      [/[{}()[\]]/, '@brackets'],
      [/->|&&|\|\||[!=<>]=|[!=<>+\-*/%]/, 'operator'],
      [/[;,.:]/, 'delimiter'],
      [/\s+/, 'white'],
    ],
  },
};

export const spinConf: languages.LanguageConfiguration = {
  comments: { lineComment: '--' },
  brackets: [
    ['{', '}'],
    ['[', ']'],
    ['(', ')'],
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"', notIn: ['string', 'comment'] },
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"' },
  ],
};

export const name = 'language-spin';

export const inject = ['languages'];

export function apply(ctx: Context) {
  ctx.effect(() =>
    ctx.languages.register({ id: 'spin', extensions: ['.spin'], load: async () => ({ language: spin, conf: spinConf }) }),
  );
}
```

If a test's expected token list disagrees with what the grammar produces for a construct that is genuinely in the language (e.g. the reference script's `->` or a `[int; 15]`), fix the GRAMMAR, not the expectation; if the expectation itself was miscounted (a delimiter the test forgot), fix the test and say so in the report. The "nothing falls to no rule" test is the arbiter: every character of `first-slot`'s script must reach a rule.

- [ ] **Step 4: Compose it**

In `engine/ide/client/src/context.ts`, right after `await ctx.plugin(languagesBasic);`:

```ts
import * as languageSpin from './plugins/language-spin';
…
  await ctx.plugin(languageSpin);
```

- [ ] **Step 5: Run the tests, typecheck, prettier**

Run: `cd engine/ide/client && npx vitest run tests/language-spin.test.ts && npm test && npm run typecheck && cd ../../.. && npx prettier --check engine/ide/client/src/plugins/language-spin.ts engine/ide/client/src/context.ts engine/ide/client/tests/language-spin.test.ts`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add engine/ide/client/src/plugins/language-spin.ts engine/ide/client/src/context.ts engine/ide/client/tests/language-spin.test.ts
git commit -m "Write .spin a grammar of its own

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: The browser sees colours — `syntax.spec.ts`, the build measured, the docs true

**Files:**
- Create: `engine/apps/web/tests/e2e/syntax.spec.ts`
- Modify: `engine/ide/client/src/editor/monacoSlice.ts` (module doc: grammars now arrive through `languages`, still no language services)
- Modify: `DESIGN.md` (one line under the editor section, if it describes Monaco's contents; otherwise leave it)

**Interfaces:**
- Consumes: everything above through a live `e8 dev` host; `projectCopy`, `startDevHost` from `engine/apps/web/tests/e2e/project-fixture.ts`; the Explorer's `data-testid="explorer-<path>"` rows; `code.spec.ts`'s `EditContext` init script pattern.

- [ ] **Step 1: Measure the build before**

Run from the repo root: `npm run build -w @energy8engine/ide-web 2>&1 | tail -3; ls engine/apps/web/dist/assets | grep -c worker; du -sk engine/apps/web/dist/assets | cut -f1`
Record the worker count and the kilobytes in the task report — the note of the slice carries the delta. (`dist` at this point is built from the branch INCLUDING Tasks 1–5; the "before" number is the one in `docs/superpowers/notes/2026-09-16-slice-13-carried-forward.md` if recorded there, otherwise `git stash`-free: check out `67ce1ca` in a temporary worktree — `git worktree add /tmp/e8-before 67ce1ca && (cd /tmp/e8-before && npm install --no-audit --no-fund >/dev/null 2>&1; npm run build -w @energy8engine/ide-web >/dev/null 2>&1; ls engine/apps/web/dist/assets | grep -c worker; du -sk engine/apps/web/dist/assets | cut -f1); git worktree remove --force /tmp/e8-before`.) If the worktree route is too slow (>5 min), report the "after" numbers alone and say so.

- [ ] **Step 2: Write the spec**

`engine/apps/web/tests/e2e/syntax.spec.ts`:

```ts
import { rmSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { projectCopy, startDevHost, type DevHost } from './project-fixture';

/**
 * Highlighting in a real browser: every file kind a project is made of
 * opens with more than one token colour, and `.spin`'s own grammar tells
 * a keyword from a name. Monaco paints each token as a `<span>` with a
 * theme class `mtk<N>`; two different classes on one line is what "has
 * highlighting" means here, and it is measured on the rendered
 * `.view-line`s, not on any model. The `check` markers of `code.spec.ts`
 * are re-asserted once because the tokenizer and the marker decorations
 * share the same line renderer.
 */
const IDE_URL = 'http://127.0.0.1:5680/';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // @ts-expect-error test-only: see code.spec.ts — Monaco's textarea input is the one Playwright drives.
    delete window.EditContext;
  });
});

let dir: string;
let host: DevHost;

test.beforeEach(async () => {
  dir = projectCopy();
  host = await startDevHost(dir);
});

test.afterEach(async () => {
  await host.stop();
  rmSync(dir, { recursive: true, force: true });
});

/** Opens a file from the Explorer and waits for Monaco to have painted at least one line. */
async function open(page: Page, path: string): Promise<void> {
  await page.getByTestId(`explorer-${path}`).click();
  await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.view-line').first()).toBeVisible();
}

/** The distinct `mtk*` classes painted across the visible lines. */
async function tokenClasses(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const classes = new Set<string>();
    for (const span of document.querySelectorAll('.view-line span'))
      for (const cls of span.classList) if (/^mtk\d+$/.test(cls)) classes.add(cls);
    return [...classes].sort();
  });
}

/** The `mtk*` class of the first painted span whose text is exactly `word`. */
async function classOf(page: Page, word: string): Promise<string | null> {
  return page.evaluate((w) => {
    for (const span of document.querySelectorAll('.view-line span')) {
      if (span.textContent === w) {
        const cls = [...span.classList].find((c) => /^mtk\d+$/.test(c));
        if (cls) return cls;
      }
    }
    return null;
  }, word);
}

for (const path of ['game/script.spin', 'e8.yml', 'src/main.ts', 'game/spec.json']) {
  test(`${path} opens with more than one token colour`, async ({ page }) => {
    await page.goto(IDE_URL);
    await open(page, path);
    await expect.poll(async () => (await tokenClasses(page)).length, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  });
}

test('in .spin a keyword and a name are painted differently', async ({ page }) => {
  await page.goto(IDE_URL);
  await open(page, 'game/script.spin');
  // `fn pay_for(` is in the reference script; scroll it into view by revealing the line.
  await page.evaluate(() => {
    const editor = document.querySelector('.monaco-editor');
    editor?.scrollIntoView();
  });
  await page.getByTestId('editor').click();
  await page.keyboard.press('Control+End');
  await expect.poll(() => classOf(page, 'fn'), { timeout: 10_000 }).not.toBeNull();
  const keyword = await classOf(page, 'fn');
  const name = await classOf(page, 'pay_for');
  expect(name, 'pay_for should be visible after Control+End (it is near the end of the script)').not.toBeNull();
  expect(keyword).not.toBe(name);
});

test('the check marker is still drawn on a highlighted .spin', async ({ page }) => {
  await page.goto(IDE_URL);
  await open(page, 'game/script.spin');
  await page.getByTestId('editor').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nrecord {');
  await expect(page.locator('.squiggly-warning').first()).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => (await tokenClasses(page)).length).toBeGreaterThanOrEqual(2);
});
```

If `pay_for` is not on screen after `Control+End` (Monaco virtualises lines), replace the second test's navigation with `page.keyboard.press('Control+Home')` and use words from the script's first lines instead — `record` and `Vars` (`record Vars {` is line 39; the script's first 40 lines are on screen at any reasonable viewport). Keep the assertion: keyword class ≠ identifier class.

- [ ] **Step 3: Run the spec alone, then the whole suite**

Run: `cd engine/apps/web && npx playwright test tests/e2e/syntax.spec.ts` — expected: 6 passed.
Then, with nothing else running from the repo: `git branch --show-current` (must print `feat/slot-webide-cordis`), `npx playwright test` — expected: 96 passed (90 + 6). After the run: `pgrep -fl e8-server | grep -v pantheon` must print nothing, and `ls engine/examples` must print exactly `first-slot probe-plugin workspace`.

- [ ] **Step 4: Make the docs true**

In `engine/ide/client/src/editor/monacoSlice.ts`'s module doc, after the sentence ending "…so the build carries one worker and no grammars.", append:

```
 * Grammars arrive another way since the highlighting slice: the
 * `languages` plugin holds definitions, `languages-basic` registers
 * Monaco's own Monarch tokenizers (lazily, one chunk each) and
 * `language-spin` ours, and `Monaco.tsx` hands them over after this
 * module has loaded. Still no language services, still one worker.
```

Reword "and no grammars" in the earlier sentence to "and no eager grammars". In `DESIGN.md`, if the editor is described, add one sentence: "Token colours come from Monaco's `vs-dark`/`vs` themes through `e8-dark`/`e8-light`'s `inherit: true`; the shell defines no token rules of its own." If `DESIGN.md` does not describe the editor, skip it and say so.

- [ ] **Step 5: Measure the build after, then commit**

Run: `npm run build -w @energy8engine/ide-web 2>&1 | tail -3; ls engine/apps/web/dist/assets | grep -c worker; du -sk engine/apps/web/dist/assets | cut -f1; ls engine/apps/web/dist/assets | grep -iE 'typescript|yaml|markdown|css|html|javascript' `
Expected: the worker count equals the "before" count; grammar chunks are separate files. Record both numbers in the report.

```bash
npx prettier --check engine/apps/web/tests/e2e/syntax.spec.ts engine/ide/client/src/editor/monacoSlice.ts DESIGN.md
git add engine/apps/web/tests/e2e/syntax.spec.ts engine/ide/client/src/editor/monacoSlice.ts DESIGN.md
git commit -m "See the colours in a browser; say where the grammars come from now

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

(Drop `DESIGN.md` from `git add` if it was not changed.)

---

## Self-review

- **Spec coverage.** §2 service shape (`register`/`languageFor`/`list`/`subscribe`) → Task 1; `failed` (spec §4's diagnostic with retract) → Tasks 1–2; `Monaco.tsx` applies + late registration → Task 2; `EditorDocument` → Task 3; six Monaco grammars + own JSON → Task 4; `.spin` grammar + conf → Task 5; themes untouched (no task — by design); build measured, Playwright, doc → Task 6. §4 collision warning → Task 1. §4 "path without extension → plaintext" → Task 1.
- **Placeholders.** None; every code step carries its code. Task 6's "before" measurement has an explicit fallback.
- **Type consistency.** `LanguageDef.load(): Promise<{ language; conf? }>` — Tasks 1, 2 (`applyLanguages` destructures `{ language, conf }`), 4 (grammar modules export `conf`/`language`; the JSON def returns `{ language: json, conf: jsonConf }`), 5 (`{ language: spin, conf: spinConf }`). `LanguageSource = Pick<LanguagesService, 'list' | 'subscribe' | 'failed'>` — Task 2 defines, Task 3 passes the whole service. `tokenizeRoot`/`visible`/`compileGrammar` — Task 4 defines, Task 5 imports the same names. Token strings asserted in Tasks 4–5 match the grammars' own (`type`, `string`, `number.float`, `keyword`, `@brackets`, `delimiter`, `operator`, `function`, `comment`, `identifier`).
