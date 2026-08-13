# Plugin Kernel (`@energy8engine/kernel`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@energy8engine/kernel` — the dependency-free package that defines what a plugin is, resolves a project's plugins into a serializable plan, and activates their contributions lazily.

**Architecture:** Everything is a pure function over data. A plugin is a side-effect-free manifest declaring *points* (extension slots it opens) and *contributions* (things it plugs into points), each carrying a mandatory schema. `resolvePlan()` turns `{project, manifests, launch}` into a `ResolvedPlan` plus a list of diagnostics — it never throws. Only `activatePoint()` touches async factories, and it isolates their failures so one broken contribution cannot take the game down.

**Tech Stack:** TypeScript ~5.6 (ESM, `strict`), Rollup (ESM + `.d.ts`), Vitest 2.0, Node 22. **Zero runtime dependencies.**

**Spec:** [docs/superpowers/specs/2026-08-13-slot-ide-v2-design.md](../specs/2026-08-13-slot-ide-v2-design.md) — this plan implements §5 (Ядро) only.

## Scope

This is **phase 1 of 4** in Срез 0. It produces a working, tested, publishable package and nothing else — no plugins, no game changes, no IDE. The remaining phases get their own plans, written against what this one actually produces:

- **Phase 2** — six plugins (`renderer-pixi`, `loader`, `shell-html`, `session-dev`, `session-stake`, `reel-system`) + a copy of `moon-spice-market` booting through `runGame({project})`.
- **Phase 3** — project format on disk + `.spin` parser producing `SpinSchema`.
- **Phase 4** — the IDE application.

## Global Constraints

Copied verbatim from the spec; every task's requirements implicitly include these.

- **Zero dependencies.** `packages/kernel/package.json` must have no `dependencies` and no `peerDependencies`. No `pixi.js`, no DOM, no SDK, no node builtins. Task 11 enforces this with a test.
- **Schema is mandatory.** A contribution without a resolvable schema is not registered. There is no "schemaless" path.
- **A point belongs to exactly one phase** (`runtime` | `build` | `editor`).
- **Effective schema = point schema + contribution schema.** A contribution may ADD fields; it may not redefine a field the point already owns.
- **Errors are data, never exceptions.** `resolvePlan()` and `activatePoint()` return `{..., diagnostics}`. Nothing in this package throws on bad input.
- **The plan is serializable.** `ResolvedPlan` carries factories; `toSnapshot()` projects it to `PlanSnapshot`, which is plain JSON — that is what the IDE and the agent read.
- **Deterministic output.** Same input → byte-identical plan. Ties in ordering break by plugin id, ascending.
- **Hooks are a closed list, and the kernel does not own it.** The kernel supplies the mechanism (`createHookBus(ids)`); the game-runtime layer (phase 2) supplies the ids. The kernel must not name `beforeSpin` or any other game-domain hook.
- **English identifiers and comments** (repo convention).
- **Test invocation:** `npm test --workspace @energy8engine/kernel`. Do NOT run `npx vitest run <path>` from the repo root — the workspace config makes it report false failures.
- **Build one package at a time.** Parallel rollup runs saturate this machine (load 80–130 observed).

---

## File Structure

```
packages/kernel/
├── package.json
├── tsconfig.json
├── rollup.config.mjs
├── vitest.config.ts
├── README.md
├── src/
│   ├── index.ts                 public barrel
│   ├── diagnostics.ts           Diagnostic, Severity, error(), warning(), hasErrors()
│   ├── schema/
│   │   ├── types.ts             FieldSchema union, Schema, STRING_KINDS
│   │   ├── validate.ts          validate(), defaultOf()
│   │   └── merge.ts             mergeSchemas()
│   ├── manifest/
│   │   ├── types.ts             PluginManifest, PointDef, Contribution, Factory, PointId
│   │   └── define.ts            definePlugin(), checkManifestShape()
│   ├── resolve/
│   │   ├── types.ts             ProjectDoc, ResolvedPlan, PlanSnapshot, LaunchContext, Matcher
│   │   ├── semver.ts            parseVersion(), satisfies(), isValidRange()
│   │   ├── order.ts             orderPlugins()
│   │   ├── match.ts             matches(), isDefaultMatcher(), describeMatcher()
│   │   ├── resolve.ts           resolvePlan()
│   │   └── snapshot.ts          toSnapshot()
│   └── runtime/
│       ├── activate.ts          activatePoint()
│       └── hooks.ts             createHookBus()
└── tests/
    ├── skeleton.test.ts
    ├── schema-validate.test.ts
    ├── schema-merge.test.ts
    ├── manifest.test.ts
    ├── semver.test.ts
    ├── order.test.ts
    ├── match.test.ts
    ├── resolve.test.ts
    ├── activate.test.ts
    ├── hooks.test.ts
    └── purity.test.ts
```

Why this split: `schema/` is consumed by the IDE on its own (it renders forms from it), `resolve/` is the part the agent reads, `runtime/` is the only part that does anything asynchronous. Each directory can be understood without the others.

---

## Phase 1 — Foundations

### Task 1: Package skeleton + workspace wiring

**Files:**
- Create: `packages/kernel/package.json`
- Create: `packages/kernel/tsconfig.json`
- Create: `packages/kernel/rollup.config.mjs`
- Create: `packages/kernel/vitest.config.ts`
- Create: `packages/kernel/src/index.ts`
- Test: `packages/kernel/tests/skeleton.test.ts`

**Interfaces:**
- Produces: workspace package `@energy8engine/kernel`, exporting `KERNEL_VERSION: string`.

- [ ] **Step 1: Branch off main**

```bash
git checkout main && git pull --ff-only && git checkout -b feat/kernel
```

- [ ] **Step 2: Write `packages/kernel/package.json`**

```json
{
  "name": "@energy8engine/kernel",
  "version": "0.1.0",
  "description": "Plugin kernel for Energy8 games — points, contributions, schemas, resolution.",
  "type": "module",
  "main": "./dist/index.esm.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.esm.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist", "src", "README.md"],
  "scripts": {
    "build": "rollup -c rollup.config.mjs",
    "clean": "rm -rf dist",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@rollup/plugin-typescript": "^12.1.0",
    "rollup": "^4.24.0",
    "rollup-plugin-dts": "^6.1.0",
    "tslib": "^2.8.0",
    "typescript": "^5.6.0",
    "vitest": "^2.0.0"
  },
  "license": "MIT"
}
```

There is deliberately no `dependencies` key and no `peerDependencies` key. Task 11 asserts this.

- [ ] **Step 3: Write `packages/kernel/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": []
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

`"lib": ["ES2022"]` without `DOM` is load-bearing: it makes any accidental use of `document` or `window` a compile error rather than something Task 11 has to catch later.

- [ ] **Step 4: Write `packages/kernel/rollup.config.mjs`**

```js
import { defineConfig } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';

export default defineConfig([
  {
    input: 'src/index.ts',
    output: { file: 'dist/index.esm.js', format: 'esm', sourcemap: true },
    plugins: [
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        declarationMap: false,
        sourceMap: true,
      }),
    ],
  },
  {
    input: 'src/index.ts',
    output: { file: 'dist/index.d.ts', format: 'esm' },
    plugins: [dts()],
  },
]);
```

No `external` array: the kernel has nothing to externalize, and if a dependency ever sneaks in, the bundle grows and the purity test in Task 11 fails.

- [ ] **Step 5: Write `packages/kernel/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 6: Write `packages/kernel/src/index.ts`**

```ts
/**
 * @energy8engine/kernel — the plugin kernel.
 *
 * Everything here is a pure function over plain data. The kernel knows nothing about renderers,
 * slots, spins or the DOM; it knows only how plugins declare extension points, how contributions
 * plug into them, and how a project's choices resolve into a plan.
 */

/** Kernel version. Plugin manifests declare the range they need via `engine`. */
export const KERNEL_VERSION = '0.1.0';
```

- [ ] **Step 7: Write the failing test `packages/kernel/tests/skeleton.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { KERNEL_VERSION } from '@/index';

describe('kernel package', () => {
  it('exposes its version', () => {
    expect(KERNEL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
```

- [ ] **Step 8: Install and run the test**

```bash
npm install
npm test --workspace @energy8engine/kernel
```

Expected: PASS, 1 test. (`npm install` links the new workspace; `packages/*` in the root `workspaces` glob already covers it, so no root `package.json` change is needed.)

- [ ] **Step 9: Verify typecheck and build**

```bash
npm run typecheck --workspace @energy8engine/kernel
npm run build --workspace @energy8engine/kernel
```

Expected: both succeed; `packages/kernel/dist/index.esm.js` and `dist/index.d.ts` exist.

- [ ] **Step 10: Commit**

```bash
git add packages/kernel package-lock.json
git commit -m "feat(kernel): package skeleton for @energy8engine/kernel"
```

---

### Task 2: Diagnostics and schema validation

**Files:**
- Create: `packages/kernel/src/diagnostics.ts`
- Create: `packages/kernel/src/schema/types.ts`
- Create: `packages/kernel/src/schema/validate.ts`
- Test: `packages/kernel/tests/schema-validate.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Severity = 'error' | 'warning'`
  - `interface Diagnostic { severity; code; message; pluginId?; pointId?; contributionId?; path?; fix? }`
  - `error(code: string, message: string, rest?: Partial<Diagnostic>): Diagnostic`
  - `warning(code: string, message: string, rest?: Partial<Diagnostic>): Diagnostic`
  - `hasErrors(diagnostics: readonly Diagnostic[]): boolean`
  - `type FieldSchema` (12-member union), `type Schema = Record<string, FieldSchema>`
  - `defaultOf(field: FieldSchema): unknown`
  - `validate(input: unknown, schema: Schema, base?: string): { value: Record<string, unknown>; diagnostics: Diagnostic[] }`

- [ ] **Step 1: Write the failing test `packages/kernel/tests/schema-validate.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import type { Schema } from '@/schema/types';
import { defaultOf, validate } from '@/schema/validate';

const FEATURE: Schema = {
  enabled: { kind: 'boolean', default: true },
  priority: { kind: 'number', default: 0, min: 0, max: 100 },
  label: { kind: 'text', default: 'Wild' },
  direction: {
    kind: 'enum',
    default: 'vertical',
    options: [
      { value: 'vertical', label: 'Vertical' },
      { value: 'horizontal', label: 'Horizontal' },
    ],
  },
  texture: { kind: 'asset', accept: 'image' },
};

describe('validate', () => {
  it('fills every missing field from its default', () => {
    const { value, diagnostics } = validate({}, FEATURE);
    expect(value).toEqual({
      enabled: true,
      priority: 0,
      label: 'Wild',
      direction: 'vertical',
      texture: '',
    });
    expect(diagnostics).toEqual([]);
  });

  it('keeps values that are already valid', () => {
    const { value, diagnostics } = validate({ priority: 42, label: 'Sticky' }, FEATURE);
    expect(value.priority).toBe(42);
    expect(value.label).toBe('Sticky');
    expect(diagnostics).toEqual([]);
  });

  it('reports a type mismatch and falls back to the default', () => {
    const { value, diagnostics } = validate({ priority: 'high' }, FEATURE);
    expect(value.priority).toBe(0);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'schema/type-mismatch',
      path: 'priority',
    });
  });

  it('clamps a number outside its range and warns', () => {
    const { value, diagnostics } = validate({ priority: 500 }, FEATURE);
    expect(value.priority).toBe(100);
    expect(diagnostics[0]).toMatchObject({ severity: 'warning', code: 'schema/out-of-range' });
  });

  it('rejects an enum value outside its options', () => {
    const { value, diagnostics } = validate({ direction: 'diagonal' }, FEATURE);
    expect(value.direction).toBe('vertical');
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'schema/not-an-option' });
    expect(diagnostics[0].message).toContain('vertical, horizontal');
  });

  it('warns about an unknown field and drops it', () => {
    const { value, diagnostics } = validate({ nonsense: 1 }, FEATURE);
    expect(value).not.toHaveProperty('nonsense');
    expect(diagnostics[0]).toMatchObject({ severity: 'warning', code: 'schema/unknown-field' });
  });

  it('treats every domain string kind as a plain string', () => {
    const { value, diagnostics } = validate({ texture: 'symbols/wild.png' }, FEATURE);
    expect(value.texture).toBe('symbols/wild.png');
    expect(diagnostics).toEqual([]);
  });

  it('validates nested objects and prefixes the diagnostic path', () => {
    const schema: Schema = {
      motion: { kind: 'object', fields: { speed: { kind: 'number', default: 1 } } },
    };
    const { value, diagnostics } = validate({ motion: { speed: 'fast' } }, schema);
    expect(value).toEqual({ motion: { speed: 1 } });
    expect(diagnostics[0].path).toBe('motion.speed');
  });

  it('validates every item of a list and indexes the path', () => {
    const schema: Schema = { stops: { kind: 'list', of: { kind: 'number', default: 0 } } };
    const { value, diagnostics } = validate({ stops: [1, 'two', 3] }, schema);
    expect(value).toEqual({ stops: [1, 0, 3] });
    expect(diagnostics[0].path).toBe('stops[1]');
  });

  it('reports a non-object input instead of throwing', () => {
    const { value, diagnostics } = validate('not an object', FEATURE);
    expect(value.enabled).toBe(true);
    expect(diagnostics.some((d) => d.code === 'schema/not-an-object')).toBe(true);
  });
});

describe('defaultOf', () => {
  it('builds a default object from nested fields', () => {
    expect(defaultOf({ kind: 'object', fields: { a: { kind: 'number', default: 7 } } })).toEqual({ a: 7 });
  });

  it('falls back to the first option for an enum with no default', () => {
    expect(defaultOf({ kind: 'enum', options: [{ value: 'x', label: 'X' }] })).toBe('x');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test --workspace @energy8engine/kernel
```

Expected: FAIL — cannot resolve `@/schema/types` and `@/schema/validate`.

- [ ] **Step 3: Write `packages/kernel/src/diagnostics.ts`**

```ts
/**
 * Diagnostics are how this package reports every failure. Nothing here throws: a bad manifest, a
 * mistyped setting or a broken factory becomes a value that travels to the IDE and to the player-
 * facing error screen. The previous editor lost patch rejections silently; that class of bug is
 * designed out by making refusal a return value.
 */

export type Severity = 'error' | 'warning';

export interface Diagnostic {
  severity: Severity;
  /** Stable machine code, e.g. 'schema/type-mismatch'. Tests and the IDE match on this, not on prose. */
  code: string;
  /** Human-readable sentence, shown verbatim in the IDE. */
  message: string;
  pluginId?: string;
  pointId?: string;
  contributionId?: string;
  /** Dotted path inside the value being validated, e.g. 'motion.speed' or 'stops[1]'. */
  path?: string;
  /** Actionable next step, shown verbatim in the IDE. */
  fix?: string;
}

export function error(code: string, message: string, rest: Partial<Diagnostic> = {}): Diagnostic {
  return { ...rest, severity: 'error', code, message };
}

export function warning(code: string, message: string, rest: Partial<Diagnostic> = {}): Diagnostic {
  return { ...rest, severity: 'warning', code, message };
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'error');
}
```

- [ ] **Step 4: Write `packages/kernel/src/schema/types.ts`**

```ts
/**
 * The schema language every contribution must speak.
 *
 * These kinds are deliberately DOMAIN-aware rather than generic JSON Schema types: `asset` becomes
 * an asset picker in the IDE, `symbol` a list drawn from the game spec, `spinPath` a picker over
 * the spin schema. That difference is what separates "configured through the UI" from "a form of
 * fifteen text inputs". Conversion to JSON Schema, for the marketplace and the agent, comes later.
 */

export interface FieldBase {
  /** Control label. Defaults to the field's key when absent. */
  label?: string;
  /** One-line help text shown next to the control, and read by the agent. */
  doc?: string;
}

export interface EnumOption {
  value: string;
  label: string;
}

export type AssetKind = 'image' | 'audio' | 'atlas' | 'any';

export type FieldSchema =
  | (FieldBase & { kind: 'number'; default?: number; min?: number; max?: number; step?: number })
  | (FieldBase & { kind: 'text'; default?: string; multiline?: boolean })
  | (FieldBase & { kind: 'boolean'; default?: boolean })
  | (FieldBase & { kind: 'color'; default?: string })
  | (FieldBase & { kind: 'enum'; default?: string; options: EnumOption[] })
  | (FieldBase & { kind: 'asset'; default?: string; accept?: AssetKind })
  | (FieldBase & { kind: 'symbol'; default?: string })
  | (FieldBase & { kind: 'spinPath'; default?: string; stage?: string })
  | (FieldBase & { kind: 'nodeRef'; default?: string })
  | (FieldBase & { kind: 'sound'; default?: string })
  | (FieldBase & { kind: 'object'; fields: Schema })
  | (FieldBase & { kind: 'list'; of: FieldSchema; default?: unknown[] });

export type Schema = Record<string, FieldSchema>;

/**
 * Kinds the kernel validates as a plain string. Their MEANING — does this asset exist, is this a
 * real path into the spin data — is resolved by higher layers. The kernel knows no assets, no
 * symbols and no spin schema, and must not pretend to.
 */
export const STRING_KINDS = [
  'text',
  'color',
  'asset',
  'symbol',
  'spinPath',
  'nodeRef',
  'sound',
] as const;
```

- [ ] **Step 5: Write `packages/kernel/src/schema/validate.ts`**

```ts
import { type Diagnostic, error, warning } from '../diagnostics';
import type { FieldSchema, Schema } from './types';

export interface ValidateResult {
  /** Every key of the schema, always present: valid input, or the field's default. */
  value: Record<string, unknown>;
  diagnostics: Diagnostic[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function typeName(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'an array';
  return `a ${typeof v}`;
}

/** The value a field falls back to: its declared default, or the zero value of its kind. */
export function defaultOf(field: FieldSchema): unknown {
  if (field.kind === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, sub] of Object.entries(field.fields)) out[key] = defaultOf(sub);
    return out;
  }
  if (field.kind === 'list') return field.default ? [...field.default] : [];
  if (field.default !== undefined) return field.default;
  if (field.kind === 'number') return 0;
  if (field.kind === 'boolean') return false;
  if (field.kind === 'enum') return field.options[0]?.value ?? '';
  return '';
}

/**
 * Validate a settings object against a schema. Never throws: bad input yields the field's default
 * plus a diagnostic, so a mistyped setting degrades one control instead of failing a whole game.
 */
export function validate(input: unknown, schema: Schema, base = ''): ValidateResult {
  const diagnostics: Diagnostic[] = [];
  const source = isRecord(input) ? input : {};

  if (input !== undefined && input !== null && !isRecord(input)) {
    diagnostics.push(
      error('schema/not-an-object', `Expected an object of settings, got ${typeName(input)}.`, {
        path: base || undefined,
      }),
    );
  }

  const value: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema)) {
    const path = base ? `${base}.${key}` : key;
    value[key] = key in source ? validateField(source[key], field, path, diagnostics) : defaultOf(field);
  }

  for (const key of Object.keys(source)) {
    if (key in schema) continue;
    diagnostics.push(
      warning('schema/unknown-field', `Unknown setting "${key}" — it will be ignored.`, {
        path: base ? `${base}.${key}` : key,
        fix: `Remove it, or declare "${key}" in the schema of the plugin that owns this setting.`,
      }),
    );
  }

  return { value, diagnostics };
}

function validateField(raw: unknown, field: FieldSchema, path: string, out: Diagnostic[]): unknown {
  if (raw === undefined || raw === null) return defaultOf(field);

  switch (field.kind) {
    case 'number': {
      if (typeof raw !== 'number' || Number.isNaN(raw)) {
        out.push(error('schema/type-mismatch', `Expected a number, got ${typeName(raw)}.`, { path }));
        return defaultOf(field);
      }
      let n = raw;
      if (field.min !== undefined && n < field.min) {
        out.push(
          warning('schema/out-of-range', `${n} is below the minimum ${field.min}; clamped.`, { path }),
        );
        n = field.min;
      }
      if (field.max !== undefined && n > field.max) {
        out.push(
          warning('schema/out-of-range', `${n} is above the maximum ${field.max}; clamped.`, { path }),
        );
        n = field.max;
      }
      return n;
    }

    case 'boolean': {
      if (typeof raw !== 'boolean') {
        out.push(error('schema/type-mismatch', `Expected true or false, got ${typeName(raw)}.`, { path }));
        return defaultOf(field);
      }
      return raw;
    }

    case 'enum': {
      const allowed = field.options.map((o) => o.value);
      if (typeof raw !== 'string' || !allowed.includes(raw)) {
        out.push(
          error('schema/not-an-option', `"${String(raw)}" is not one of: ${allowed.join(', ')}.`, {
            path,
            fix: `Use one of: ${allowed.join(', ')}.`,
          }),
        );
        return defaultOf(field);
      }
      return raw;
    }

    case 'object': {
      const nested = validate(raw, field.fields, path);
      out.push(...nested.diagnostics);
      return nested.value;
    }

    case 'list': {
      if (!Array.isArray(raw)) {
        out.push(error('schema/type-mismatch', `Expected a list, got ${typeName(raw)}.`, { path }));
        return defaultOf(field);
      }
      return raw.map((item, i) => validateField(item, field.of, `${path}[${i}]`, out));
    }

    default: {
      // Every remaining kind is a plain string here; its meaning belongs to a higher layer.
      if (typeof raw !== 'string') {
        out.push(error('schema/type-mismatch', `Expected a string, got ${typeName(raw)}.`, { path }));
        return defaultOf(field);
      }
      return raw;
    }
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
npm test --workspace @energy8engine/kernel
```

Expected: PASS — 12 tests in `schema-validate.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add packages/kernel/src/diagnostics.ts packages/kernel/src/schema packages/kernel/tests/schema-validate.test.ts
git commit -m "feat(kernel): diagnostics and schema validation"
```

---

### Task 3: Effective schema — merging point and contribution

**Files:**
- Create: `packages/kernel/src/schema/merge.ts`
- Test: `packages/kernel/tests/schema-merge.test.ts`

**Interfaces:**
- Consumes: `Schema` from `schema/types`, `Diagnostic`/`error` from `diagnostics`.
- Produces: `mergeSchemas(point: Schema, contribution: Schema | undefined, ctx: { pluginId: string; pointId: string; contributionId: string }): { schema: Schema; diagnostics: Diagnostic[] }`

- [ ] **Step 1: Write the failing test `packages/kernel/tests/schema-merge.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import type { Schema } from '@/schema/types';
import { mergeSchemas } from '@/schema/merge';

const CTX = { pluginId: '@e8/reel-system', pointId: 'reel.feature', contributionId: 'expandingWild' };

const POINT: Schema = {
  enabled: { kind: 'boolean', default: true },
  priority: { kind: 'number', default: 0 },
};

describe('mergeSchemas', () => {
  it('returns the point schema when the contribution adds nothing', () => {
    const { schema, diagnostics } = mergeSchemas(POINT, undefined, CTX);
    expect(Object.keys(schema)).toEqual(['enabled', 'priority']);
    expect(diagnostics).toEqual([]);
  });

  it('adds the contribution fields after the point fields', () => {
    const own: Schema = { holdSpins: { kind: 'number', default: 3 } };
    const { schema, diagnostics } = mergeSchemas(POINT, own, CTX);
    expect(Object.keys(schema)).toEqual(['enabled', 'priority', 'holdSpins']);
    expect(diagnostics).toEqual([]);
  });

  it('refuses a contribution field that redefines a point field', () => {
    const own: Schema = { priority: { kind: 'text', default: 'high' } };
    const { schema, diagnostics } = mergeSchemas(POINT, own, CTX);
    expect(schema.priority).toEqual(POINT.priority);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'schema/field-conflict',
      pluginId: '@e8/reel-system',
      pointId: 'reel.feature',
      contributionId: 'expandingWild',
      path: 'priority',
    });
  });

  it('does not mutate either input', () => {
    const own: Schema = { holdSpins: { kind: 'number', default: 3 } };
    mergeSchemas(POINT, own, CTX);
    expect(Object.keys(POINT)).toEqual(['enabled', 'priority']);
    expect(Object.keys(own)).toEqual(['holdSpins']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test --workspace @energy8engine/kernel
```

Expected: FAIL — cannot resolve `@/schema/merge`.

- [ ] **Step 3: Write `packages/kernel/src/schema/merge.ts`**

```ts
import { type Diagnostic, error } from '../diagnostics';
import type { Schema } from './types';

export interface MergeContext {
  pluginId: string;
  pointId: string;
  contributionId: string;
}

export interface MergeResult {
  schema: Schema;
  diagnostics: Diagnostic[];
}

/**
 * Effective schema = point schema + contribution schema.
 *
 * A contribution may ADD fields but may not redefine one the point already owns. Allowing that
 * would let a single plugin quietly change the meaning of a setting shared by every other
 * contribution to the same point — the IDE would render one control whose behaviour depends on
 * which contribution is selected.
 */
export function mergeSchemas(
  point: Schema,
  contribution: Schema | undefined,
  ctx: MergeContext,
): MergeResult {
  const diagnostics: Diagnostic[] = [];
  const schema: Schema = { ...point };

  for (const [key, field] of Object.entries(contribution ?? {})) {
    if (key in point) {
      diagnostics.push(
        error('schema/field-conflict', `Field "${key}" is already defined by point "${ctx.pointId}".`, {
          ...ctx,
          path: key,
          fix: `Rename the contribution's field, or drop it and use the point's.`,
        }),
      );
      continue;
    }
    schema[key] = field;
  }

  return { schema, diagnostics };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test --workspace @energy8engine/kernel
```

Expected: PASS — 4 new tests in `schema-merge.test.ts`; the suite stays green.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/schema/merge.ts packages/kernel/tests/schema-merge.test.ts
git commit -m "feat(kernel): merge point and contribution schemas"
```

---

### Task 4: Manifest types and shape checking

**Files:**
- Create: `packages/kernel/src/manifest/types.ts`
- Create: `packages/kernel/src/manifest/define.ts`
- Test: `packages/kernel/tests/manifest.test.ts`

**Interfaces:**
- Consumes: `Schema`, `Diagnostic`/`error`.
- Produces:
  - `type PointId = string`, `type Phase = 'runtime' | 'build' | 'editor'`, `type Arity = 'one' | 'many'`
  - `type Factory<T> = (settings: Record<string, unknown>) => T | Promise<T>`
  - `interface PointDef { phase; arity; schema; doc }`
  - `interface Contribution<T> { id; schema?; defaults?; activateWhen?; create; doc }`
  - `interface PluginManifest { id; version; engine; dependsOn?; points?; contributes?; hooks?; settings? }`
  - `definePlugin(manifest: PluginManifest): PluginManifest`
  - `checkManifestShape(manifest: PluginManifest): Diagnostic[]`

Note: `Matcher` is referenced by `Contribution.activateWhen` and is defined in Task 7 (`resolve/types.ts`). Declare the import now; Task 7 fills it in. To keep Task 4 compiling on its own, define `Matcher` in `resolve/types.ts` as part of THIS task's step 3 — the file is created here with only that one type, and Task 7 adds the rest.

- [ ] **Step 1: Write the failing test `packages/kernel/tests/manifest.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { checkManifestShape, definePlugin } from '@/manifest/define';
import type { PluginManifest } from '@/manifest/types';

function base(over: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: '@e8/reel-system',
    version: '1.0.0',
    engine: '^0.1.0',
    ...over,
  };
}

describe('definePlugin', () => {
  it('returns the manifest unchanged', () => {
    const m = base();
    expect(definePlugin(m)).toBe(m);
  });
});

describe('checkManifestShape', () => {
  it('accepts a minimal valid manifest', () => {
    expect(checkManifestShape(base())).toEqual([]);
  });

  it('rejects an empty id', () => {
    const d = checkManifestShape(base({ id: '' }));
    expect(d[0]).toMatchObject({ severity: 'error', code: 'manifest/missing-id' });
  });

  it('rejects a version that is not semver', () => {
    const d = checkManifestShape(base({ version: 'latest' }));
    expect(d[0]).toMatchObject({ severity: 'error', code: 'manifest/bad-version' });
  });

  it('rejects a missing engine range', () => {
    const d = checkManifestShape(base({ engine: '' }));
    expect(d[0]).toMatchObject({ severity: 'error', code: 'manifest/missing-engine' });
  });

  it('rejects a point declared without documentation', () => {
    const d = checkManifestShape(
      base({ points: { 'reel.feature': { phase: 'runtime', arity: 'many', schema: {}, doc: '' } } }),
    );
    expect(d[0]).toMatchObject({ severity: 'error', code: 'manifest/missing-doc', pointId: 'reel.feature' });
  });

  it('rejects two contributions sharing an id within one point', () => {
    const d = checkManifestShape(
      base({
        contributes: {
          'reel.feature': [
            { id: 'wild', doc: 'A', create: async () => () => null },
            { id: 'wild', doc: 'B', create: async () => () => null },
          ],
        },
      }),
    );
    expect(d[0]).toMatchObject({
      severity: 'error',
      code: 'manifest/duplicate-contribution',
      contributionId: 'wild',
    });
  });

  it('rejects a contribution with no documentation', () => {
    const d = checkManifestShape(
      base({ contributes: { 'reel.feature': [{ id: 'wild', doc: '', create: async () => () => null }] } }),
    );
    expect(d[0]).toMatchObject({ severity: 'error', code: 'manifest/missing-doc', contributionId: 'wild' });
  });

  it('collects every problem rather than stopping at the first', () => {
    const d = checkManifestShape(base({ id: '', version: 'nope', engine: '' }));
    expect(d).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test --workspace @energy8engine/kernel
```

Expected: FAIL — cannot resolve `@/manifest/define`.

- [ ] **Step 3: Write `packages/kernel/src/resolve/types.ts` (the `Matcher` half only)**

```ts
/**
 * Launch-time context and the declarative matcher that reads it. The rest of this file is written
 * in the task that introduces plan resolution.
 */

export interface LaunchContext {
  /** The full launch URL, including its query string. */
  url: string;
  /** The build target this bundle was produced for, e.g. 'stake' or 'artube'. */
  buildTarget?: string;
  /** Environment values the host chose to expose. */
  env?: Record<string, string>;
}

/**
 * Which launch a contribution is for. Declarative on purpose: the IDE must be able to SHOW when a
 * given session provider or boot overlay takes over, which it cannot do with an opaque predicate.
 * Every present condition must hold. `match` exists for genuinely irregular cases and is declared
 * in the manifest so the IDE at least knows an opaque rule is in play.
 */
export interface Matcher {
  /** Matches when this query parameter is present in the launch URL. */
  urlParam?: string;
  /** Matches when the build target equals this value. */
  buildTarget?: string;
  /** Marks the fallback used when no other candidate matches. */
  default?: true;
  /** Escape hatch for rules the declarative fields cannot express. */
  match?: (ctx: LaunchContext) => boolean;
}
```

- [ ] **Step 4: Write `packages/kernel/src/manifest/types.ts`**

```ts
import type { Schema } from '../schema/types';
import type { Matcher } from '../resolve/types';

export type PointId = string;

/** A point belongs to exactly one phase. A plugin needing two phases contributes to two points. */
export type Phase = 'runtime' | 'build' | 'editor';

/** 'one' — exactly one contribution is active (a shell, a renderer). 'many' — all enabled ones are. */
export type Arity = 'one' | 'many';

/**
 * What a contribution's lazily-loaded module ultimately provides: a function from validated
 * settings to a live instance.
 */
export type Factory<T = unknown> = (settings: Record<string, unknown>) => T | Promise<T>;

/** An extension point. Declared by a plugin — the kernel owns no list of points. */
export interface PointDef {
  phase: Phase;
  arity: Arity;
  /** Settings schema shared by every contribution to this point. */
  schema: Schema;
  /** Documentation for the IDE and the agent. Required: an undocumented point is unusable by both. */
  doc: string;
}

/** One extension plugged into a point. */
export interface Contribution<T = unknown> {
  /** Unique within its plugin and point. */
  id: string;
  /** Fields this contribution adds on top of the point's schema. */
  schema?: Schema;
  /** Overrides for the point schema's defaults, applied before validation. */
  defaults?: Record<string, unknown>;
  /** For `arity: 'one'` points with several candidates. Ignored on `arity: 'many'`. */
  activateWhen?: Matcher;
  /**
   * Lazily loads the implementation. Both shapes work, so a bare dynamic import is enough:
   *   create: () => import('./features/expandingWild')   // module with a default export
   *   create: async () => myFactory                      // the factory itself
   */
  create: () => Promise<Factory<T> | { default: Factory<T> }>;
  /** Documentation for the IDE and the agent. Required. */
  doc: string;
}

/**
 * A plugin manifest. Free of side effects and heavy imports so the IDE, the build and the agent can
 * read the full composition of a game in Node without starting it.
 */
export interface PluginManifest {
  id: string;
  /** This plugin's own version, semver. */
  version: string;
  /** Kernel version range this plugin needs, e.g. '^0.1.0'. */
  engine: string;
  /** Other plugins this one needs, id → semver range. Also fixes activation order. */
  dependsOn?: Record<string, string>;
  /** New extension points this plugin opens. */
  points?: Record<PointId, PointDef>;
  /** Extensions this plugin plugs into points — its own or another plugin's. */
  contributes?: Record<PointId, Contribution[]>;
  /** Hooks this plugin uses. Undeclared hooks are refused at registration. */
  hooks?: string[];
  /** Settings of the plugin itself, as opposed to those of any one contribution. */
  settings?: Schema;
}
```

- [ ] **Step 5: Write `packages/kernel/src/manifest/define.ts`**

```ts
import { type Diagnostic, error } from '../diagnostics';
import type { PluginManifest } from './types';

const SEMVER = /^\d+\.\d+\.\d+$/;

/** Identity helper. Exists so plugin authors get inference and autocomplete on the manifest shape. */
export function definePlugin(manifest: PluginManifest): PluginManifest {
  return manifest;
}

/**
 * Structural check of a single manifest, run before anything else looks at it. Collects every
 * problem rather than stopping at the first, because an author fixing a manifest wants the whole
 * list, not one error per round trip.
 */
export function checkManifestShape(manifest: PluginManifest): Diagnostic[] {
  const out: Diagnostic[] = [];
  const pluginId = manifest.id || '<unnamed>';

  if (!manifest.id) {
    out.push(error('manifest/missing-id', 'A plugin manifest needs an id.', { fix: `Add \`id: '@scope/name'\`.` }));
  }
  if (!SEMVER.test(manifest.version ?? '')) {
    out.push(
      error('manifest/bad-version', `Version "${manifest.version}" is not semver (major.minor.patch).`, {
        pluginId,
      }),
    );
  }
  if (!manifest.engine) {
    out.push(
      error('manifest/missing-engine', 'A plugin must declare the kernel range it needs.', {
        pluginId,
        fix: `Add \`engine: '^0.1.0'\`.`,
      }),
    );
  }

  for (const [pointId, point] of Object.entries(manifest.points ?? {})) {
    if (!point.doc) {
      out.push(
        error('manifest/missing-doc', `Point "${pointId}" has no documentation.`, {
          pluginId,
          pointId,
          fix: 'Describe what plugs in here — the IDE and the agent both read this text.',
        }),
      );
    }
  }

  for (const [pointId, list] of Object.entries(manifest.contributes ?? {})) {
    const seen = new Set<string>();
    for (const contribution of list) {
      if (seen.has(contribution.id)) {
        out.push(
          error('manifest/duplicate-contribution', `Two contributions to "${pointId}" share the id "${contribution.id}".`, {
            pluginId,
            pointId,
            contributionId: contribution.id,
          }),
        );
      }
      seen.add(contribution.id);

      if (!contribution.doc) {
        out.push(
          error('manifest/missing-doc', `Contribution "${contribution.id}" has no documentation.`, {
            pluginId,
            pointId,
            contributionId: contribution.id,
            fix: 'Describe what it does — the IDE and the agent both read this text.',
          }),
        );
      }
    }
  }

  return out;
}
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
npm test --workspace @energy8engine/kernel
```

Expected: PASS — 9 new tests in `manifest.test.ts`; the suite stays green.

- [ ] **Step 7: Commit**

```bash
git add packages/kernel/src/manifest packages/kernel/src/resolve/types.ts packages/kernel/tests/manifest.test.ts
git commit -m "feat(kernel): plugin manifest types and shape checking"
```

---

## Phase 2 — Resolution

### Task 5: Minimal semver range satisfaction

**Files:**
- Create: `packages/kernel/src/resolve/semver.ts`
- Test: `packages/kernel/tests/semver.test.ts`

**Interfaces:**
- Produces:
  - `parseVersion(v: string): [number, number, number] | null`
  - `isValidRange(range: string): boolean`
  - `satisfies(version: string, range: string): boolean`

The kernel has zero dependencies, so the `semver` package is not available. Only four range forms are needed and they are the only ones supported; anything else is invalid and reported as such rather than silently accepted. Pre-release and build-metadata versions are out of scope — `isValidRange` and `parseVersion` reject them.

- [ ] **Step 1: Write the failing test `packages/kernel/tests/semver.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { isValidRange, parseVersion, satisfies } from '@/resolve/semver';

describe('parseVersion', () => {
  it('parses a plain version', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
  });

  it('rejects anything that is not major.minor.patch', () => {
    expect(parseVersion('1.2')).toBeNull();
    expect(parseVersion('v1.2.3')).toBeNull();
    expect(parseVersion('1.2.3-beta.1')).toBeNull();
    expect(parseVersion('latest')).toBeNull();
  });
});

describe('isValidRange', () => {
  it('accepts the four supported forms and the wildcard', () => {
    for (const r of ['*', '1.2.3', '^1.2.3', '~1.2.3', '>=1.2.3']) {
      expect(isValidRange(r)).toBe(true);
    }
  });

  it('rejects unsupported syntax', () => {
    for (const r of ['1.x', '>1.2.3 <2.0.0', '^1.2', '']) {
      expect(isValidRange(r)).toBe(false);
    }
  });
});

describe('satisfies', () => {
  it('matches anything against the wildcard', () => {
    expect(satisfies('0.0.1', '*')).toBe(true);
  });

  it('matches an exact range only on equality', () => {
    expect(satisfies('1.2.3', '1.2.3')).toBe(true);
    expect(satisfies('1.2.4', '1.2.3')).toBe(false);
  });

  it('caret allows patch and minor, not major', () => {
    expect(satisfies('1.2.3', '^1.2.3')).toBe(true);
    expect(satisfies('1.9.0', '^1.2.3')).toBe(true);
    expect(satisfies('1.2.2', '^1.2.3')).toBe(false);
    expect(satisfies('2.0.0', '^1.2.3')).toBe(false);
  });

  it('caret on a 0.x major pins the minor, as npm does', () => {
    expect(satisfies('0.1.5', '^0.1.0')).toBe(true);
    expect(satisfies('0.2.0', '^0.1.0')).toBe(false);
  });

  it('tilde allows patch only', () => {
    expect(satisfies('1.2.9', '~1.2.3')).toBe(true);
    expect(satisfies('1.3.0', '~1.2.3')).toBe(false);
  });

  it('>= compares in version order, not lexically', () => {
    expect(satisfies('1.10.0', '>=1.9.0')).toBe(true);
    expect(satisfies('1.8.0', '>=1.9.0')).toBe(false);
  });

  it('returns false rather than throwing on unparseable input', () => {
    expect(satisfies('nope', '^1.0.0')).toBe(false);
    expect(satisfies('1.0.0', 'garbage')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test --workspace @energy8engine/kernel
```

Expected: FAIL — cannot resolve `@/resolve/semver`.

- [ ] **Step 3: Write `packages/kernel/src/resolve/semver.ts`**

```ts
/**
 * The smallest semver that does this job. The kernel takes no dependencies, and plugin ranges only
 * ever need four forms. Anything else is reported invalid rather than quietly accepted — a range
 * nobody can evaluate is worse than one that is refused with a message.
 *
 * Pre-release and build metadata are deliberately unsupported.
 */

export type Version = [number, number, number];

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;
const RANGE = /^(\^|~|>=)?(\d+)\.(\d+)\.(\d+)$/;

export function parseVersion(v: string): Version | null {
  const m = VERSION.exec(v ?? '');
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function isValidRange(range: string): boolean {
  return range === '*' || RANGE.test(range ?? '');
}

function compare(a: Version, b: Version): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

export function satisfies(version: string, range: string): boolean {
  if (range === '*') return parseVersion(version) !== null;

  const v = parseVersion(version);
  const m = RANGE.exec(range ?? '');
  if (!v || !m) return false;

  const operator = m[1] ?? '';
  const target: Version = [Number(m[2]), Number(m[3]), Number(m[4])];

  switch (operator) {
    case '':
      return compare(v, target) === 0;
    case '>=':
      return compare(v, target) >= 0;
    case '~':
      // Patch-level changes only.
      return v[0] === target[0] && v[1] === target[1] && compare(v, target) >= 0;
    case '^':
      // Minor and patch, except below 1.0.0 where npm treats the minor as the breaking digit.
      if (compare(v, target) < 0) return false;
      return target[0] === 0 ? v[0] === 0 && v[1] === target[1] : v[0] === target[0];
    default:
      return false;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test --workspace @energy8engine/kernel
```

Expected: PASS — 11 new tests in `semver.test.ts`; the suite stays green.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/resolve/semver.ts packages/kernel/tests/semver.test.ts
git commit -m "feat(kernel): minimal semver range satisfaction"
```

---

### Task 6: Deterministic plugin ordering

**Files:**
- Create: `packages/kernel/src/resolve/order.ts`
- Test: `packages/kernel/tests/order.test.ts`

**Interfaces:**
- Consumes: `PluginManifest`, `Diagnostic`/`error`.
- Produces: `orderPlugins(manifests: readonly PluginManifest[]): { order: string[]; diagnostics: Diagnostic[] }`

- [ ] **Step 1: Write the failing test `packages/kernel/tests/order.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { orderPlugins } from '@/resolve/order';
import type { PluginManifest } from '@/manifest/types';

function p(id: string, dependsOn?: Record<string, string>): PluginManifest {
  return { id, version: '1.0.0', engine: '*', ...(dependsOn ? { dependsOn } : {}) };
}

describe('orderPlugins', () => {
  it('sorts independent plugins by id so the plan is reproducible', () => {
    const { order, diagnostics } = orderPlugins([p('zeta'), p('alpha'), p('mid')]);
    expect(order).toEqual(['alpha', 'mid', 'zeta']);
    expect(diagnostics).toEqual([]);
  });

  it('places a dependency before its dependent', () => {
    const { order } = orderPlugins([p('game', { reels: '^1.0.0' }), p('reels')]);
    expect(order).toEqual(['reels', 'game']);
  });

  it('orders a chain transitively', () => {
    const { order } = orderPlugins([p('c', { b: '*' }), p('b', { a: '*' }), p('a')]);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('breaks ties by id at every level', () => {
    const { order } = orderPlugins([p('x', { core: '*' }), p('b', { core: '*' }), p('core')]);
    expect(order).toEqual(['core', 'b', 'x']);
  });

  it('reports a cycle and still returns the plugins outside it', () => {
    const { order, diagnostics } = orderPlugins([p('a', { b: '*' }), p('b', { a: '*' }), p('free')]);
    expect(order).toEqual(['free']);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'resolve/dependency-cycle' });
    expect(diagnostics[0].message).toContain('a');
    expect(diagnostics[0].message).toContain('b');
  });

  it('reports a dependency that is not installed', () => {
    const { order, diagnostics } = orderPlugins([p('game', { missing: '^1.0.0' })]);
    expect(order).toEqual(['game']);
    expect(diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'resolve/missing-dependency',
      pluginId: 'game',
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test --workspace @energy8engine/kernel
```

Expected: FAIL — cannot resolve `@/resolve/order`.

- [ ] **Step 3: Write `packages/kernel/src/resolve/order.ts`**

```ts
import { type Diagnostic, error } from '../diagnostics';
import type { PluginManifest } from '../manifest/types';

export interface OrderResult {
  /** Plugin ids, dependencies first. Excludes any plugin caught in a cycle. */
  order: string[];
  diagnostics: Diagnostic[];
}

/**
 * Kahn's algorithm with the ready set kept sorted by id.
 *
 * The sort is not cosmetic: the same project must always produce the same plan, or a snapshot the
 * IDE saved and a snapshot the build computed would differ for no reason.
 *
 * A cycle does not abort the resolution. The plugins outside it are still usable, and the player
 * sees one precise error instead of a blank screen.
 */
export function orderPlugins(manifests: readonly PluginManifest[]): OrderResult {
  const diagnostics: Diagnostic[] = [];
  const byId = new Map(manifests.map((m) => [m.id, m]));

  const deps = new Map<string, string[]>();
  for (const manifest of manifests) {
    const present: string[] = [];
    for (const depId of Object.keys(manifest.dependsOn ?? {})) {
      if (!byId.has(depId)) {
        diagnostics.push(
          error('resolve/missing-dependency', `Plugin "${manifest.id}" depends on "${depId}", which is not installed.`, {
            pluginId: manifest.id,
            fix: `Add "${depId}" to the project, or drop the dependency.`,
          }),
        );
        continue;
      }
      present.push(depId);
    }
    deps.set(manifest.id, present);
  }

  const remaining = new Set(byId.keys());
  const order: string[] = [];

  for (;;) {
    const ready = [...remaining]
      .filter((id) => (deps.get(id) ?? []).every((d) => !remaining.has(d)))
      .sort();
    if (ready.length === 0) break;
    for (const id of ready) {
      order.push(id);
      remaining.delete(id);
    }
  }

  if (remaining.size > 0) {
    const cycle = [...remaining].sort();
    diagnostics.push(
      error('resolve/dependency-cycle', `These plugins depend on each other in a cycle: ${cycle.join(' → ')}.`, {
        fix: 'Break the cycle by removing one of the dependsOn entries.',
      }),
    );
  }

  return { order, diagnostics };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test --workspace @energy8engine/kernel
```

Expected: PASS — 6 new tests in `order.test.ts`; the suite stays green.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/resolve/order.ts packages/kernel/tests/order.test.ts
git commit -m "feat(kernel): deterministic plugin ordering with cycle diagnostics"
```

---

### Task 7: Launch matchers

**Files:**
- Create: `packages/kernel/src/resolve/match.ts`
- Test: `packages/kernel/tests/match.test.ts`

**Interfaces:**
- Consumes: `Matcher`, `LaunchContext` from `resolve/types` (written in Task 4).
- Produces:
  - `matches(matcher: Matcher | undefined, ctx: LaunchContext): boolean`
  - `isDefaultMatcher(matcher: Matcher | undefined): boolean`
  - `describeMatcher(matcher: Matcher | undefined): string`

`describeMatcher` is not decoration: the spec promises the IDE can show *when* a given session provider takes over, and that sentence has to come from somewhere.

- [ ] **Step 1: Write the failing test `packages/kernel/tests/match.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { describeMatcher, isDefaultMatcher, matches } from '@/resolve/match';
import type { LaunchContext } from '@/resolve/types';

const ctx = (over: Partial<LaunchContext> = {}): LaunchContext => ({
  url: 'https://game.example/play',
  ...over,
});

describe('matches', () => {
  it('matches a url parameter that is present', () => {
    expect(matches({ urlParam: 'sessionId' }, ctx({ url: 'https://g/play?sessionId=abc' }))).toBe(true);
  });

  it('does not match a url parameter that is absent', () => {
    expect(matches({ urlParam: 'sessionId' }, ctx())).toBe(false);
  });

  it('matches an empty url parameter, because presence is the question', () => {
    expect(matches({ urlParam: 'replay' }, ctx({ url: 'https://g/play?replay=' }))).toBe(true);
  });

  it('matches a build target', () => {
    expect(matches({ buildTarget: 'stake' }, ctx({ buildTarget: 'stake' }))).toBe(true);
    expect(matches({ buildTarget: 'stake' }, ctx({ buildTarget: 'artube' }))).toBe(false);
  });

  it('requires every declared condition to hold', () => {
    const m = { urlParam: 'sessionId', buildTarget: 'artube' };
    expect(matches(m, ctx({ url: 'https://g/play?sessionId=1', buildTarget: 'artube' }))).toBe(true);
    expect(matches(m, ctx({ url: 'https://g/play?sessionId=1', buildTarget: 'stake' }))).toBe(false);
  });

  it('consults the escape-hatch predicate', () => {
    expect(matches({ match: (c) => c.env?.MODE === 'demo' }, ctx({ env: { MODE: 'demo' } }))).toBe(true);
    expect(matches({ match: (c) => c.env?.MODE === 'demo' }, ctx())).toBe(false);
  });

  it('treats a pure default matcher as no match, so fallbacks never beat a real rule', () => {
    expect(matches({ default: true }, ctx())).toBe(false);
  });

  it('treats an absent matcher as no match', () => {
    expect(matches(undefined, ctx())).toBe(false);
  });

  it('survives an unparseable url instead of throwing', () => {
    expect(matches({ urlParam: 'sessionId' }, ctx({ url: 'not a url' }))).toBe(false);
  });
});

describe('isDefaultMatcher', () => {
  it('is true only for a matcher whose sole content is default', () => {
    expect(isDefaultMatcher({ default: true })).toBe(true);
    expect(isDefaultMatcher({ default: true, buildTarget: 'stake' })).toBe(false);
    expect(isDefaultMatcher(undefined)).toBe(false);
  });
});

describe('describeMatcher', () => {
  it('describes each condition in words', () => {
    expect(describeMatcher({ urlParam: 'sessionId' })).toBe('when ?sessionId is present');
    expect(describeMatcher({ buildTarget: 'stake' })).toBe('when the build target is "stake"');
    expect(describeMatcher({ default: true })).toBe('when nothing else matches');
    expect(describeMatcher({ match: () => true })).toBe('when a custom rule matches');
    expect(describeMatcher(undefined)).toBe('always');
  });

  it('joins several conditions', () => {
    expect(describeMatcher({ urlParam: 'sessionId', buildTarget: 'artube' })).toBe(
      'when ?sessionId is present and when the build target is "artube"',
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test --workspace @energy8engine/kernel
```

Expected: FAIL — cannot resolve `@/resolve/match`.

- [ ] **Step 3: Write `packages/kernel/src/resolve/match.ts`**

```ts
import type { LaunchContext, Matcher } from './types';

function hasUrlParam(url: string, param: string): boolean {
  const query = url.indexOf('?');
  if (query < 0) return false;
  // Parsed by hand: URL is a DOM/Node global and this package depends on neither.
  const hash = url.indexOf('#', query);
  const search = url.slice(query + 1, hash < 0 ? undefined : hash);
  for (const pair of search.split('&')) {
    if (pair === param || pair.startsWith(`${param}=`)) return true;
  }
  return false;
}

/** True when every condition the matcher declares holds. A pure `default` matcher never matches. */
export function matches(matcher: Matcher | undefined, ctx: LaunchContext): boolean {
  if (!matcher) return false;

  const conditions: boolean[] = [];
  if (matcher.urlParam !== undefined) conditions.push(hasUrlParam(ctx.url, matcher.urlParam));
  if (matcher.buildTarget !== undefined) conditions.push(ctx.buildTarget === matcher.buildTarget);
  if (matcher.match !== undefined) conditions.push(matcher.match(ctx) === true);

  if (conditions.length === 0) return false;
  return conditions.every(Boolean);
}

/** True for the fallback marker — a matcher that says only "use me when nothing else matched". */
export function isDefaultMatcher(matcher: Matcher | undefined): boolean {
  if (!matcher || matcher.default !== true) return false;
  return matcher.urlParam === undefined && matcher.buildTarget === undefined && matcher.match === undefined;
}

/** One sentence the IDE shows so a person can see when a contribution takes over. */
export function describeMatcher(matcher: Matcher | undefined): string {
  if (!matcher) return 'always';

  const parts: string[] = [];
  if (matcher.urlParam !== undefined) parts.push(`when ?${matcher.urlParam} is present`);
  if (matcher.buildTarget !== undefined) parts.push(`when the build target is "${matcher.buildTarget}"`);
  if (matcher.match !== undefined) parts.push('when a custom rule matches');
  if (parts.length === 0 && matcher.default === true) return 'when nothing else matches';

  return parts.join(' and ');
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test --workspace @energy8engine/kernel
```

Expected: PASS — 12 new tests in `match.test.ts`; the suite stays green.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/resolve/match.ts packages/kernel/tests/match.test.ts
git commit -m "feat(kernel): declarative launch matchers with human descriptions"
```

---

### Task 8: `resolvePlan` and the serializable snapshot

**Files:**
- Modify: `packages/kernel/src/resolve/types.ts` (append the plan and project types)
- Create: `packages/kernel/src/resolve/resolve.ts`
- Create: `packages/kernel/src/resolve/snapshot.ts`
- Test: `packages/kernel/tests/resolve.test.ts`

**Interfaces:**
- Consumes: `validate`, `mergeSchemas`, `checkManifestShape`, `satisfies`, `orderPlugins`, `matches`, `isDefaultMatcher`, `describeMatcher`.
- Produces:
  - `interface ProjectDoc { plugins: Record<string, PluginEntry> }`
  - `interface PluginEntry { version: string; enabled?: boolean; settings?: Record<string, unknown>; contributions?: Record<string, ContributionSettings> }`
  - `interface ContributionSettings { enabled?: boolean; settings?: Record<string, unknown> }`
  - `interface ResolvedContribution { key; pluginId; pointId; id; enabled; active; activationLabel; settings; schema; doc; create }`
  - `interface ResolvedPoint { pointId; pluginId; phase; arity; schema; doc }`
  - `interface ResolvedPlugin { id; version; settings }`
  - `interface ResolvedPlan { plugins; points; contributions; order; hooks }`
  - `resolvePlan(input: ResolveInput): { plan: ResolvedPlan; diagnostics: Diagnostic[] }`
  - `type PlanSnapshot` and `toSnapshot(plan: ResolvedPlan): PlanSnapshot`

A note on the contribution key: it is `` `${pointId}:${contributionId}` `` — for instance `reel.feature:expandingWild`. That string is what `project.json` uses to address a contribution's settings, so it has to be readable by a person editing the file by hand during a debugging session.

A note on serializability: `ResolvedPlan` holds `create` functions and therefore is NOT JSON. `toSnapshot()` produces `PlanSnapshot`, which is — that is what the IDE reads over RPC and what the agent reads from disk. The spec's "the plan is serializable" means this pair, and this task is where the distinction becomes real.

- [ ] **Step 1: Write the failing test `packages/kernel/tests/resolve.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { resolvePlan } from '@/resolve/resolve';
import { toSnapshot } from '@/resolve/snapshot';
import type { ProjectDoc } from '@/resolve/types';
import type { Contribution, PluginManifest } from '@/manifest/types';

const noop: Contribution['create'] = async () => () => null;

function reelSystem(over: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: '@e8/reel-system',
    version: '1.0.0',
    engine: '^0.1.0',
    points: {
      'reel.feature': {
        phase: 'runtime',
        arity: 'many',
        schema: { enabled: { kind: 'boolean', default: true }, priority: { kind: 'number', default: 0 } },
        doc: 'A behaviour layered onto the reels.',
      },
    },
    contributes: {
      'reel.feature': [
        {
          id: 'expandingWild',
          schema: { holdSpins: { kind: 'number', default: 1, min: 1, max: 10 } },
          doc: 'Wild expands to fill its reel.',
          create: noop,
        },
      ],
    },
    ...over,
  };
}

function project(over: Partial<ProjectDoc['plugins']> = {}): ProjectDoc {
  return { plugins: { '@e8/reel-system': { version: '^1.0.0' }, ...over } };
}

const launch = { url: 'https://game.example/play' };
const KERNEL = '0.1.0';

describe('resolvePlan', () => {
  it('registers a point and its contribution with a merged, validated settings object', () => {
    const { plan, diagnostics } = resolvePlan({
      project: project(),
      manifests: [reelSystem()],
      launch,
      kernelVersion: KERNEL,
    });

    expect(diagnostics).toEqual([]);
    expect(Object.keys(plan.points)).toEqual(['reel.feature']);
    expect(plan.contributions).toHaveLength(1);

    const c = plan.contributions[0];
    expect(c.key).toBe('reel.feature:expandingWild');
    expect(Object.keys(c.schema)).toEqual(['enabled', 'priority', 'holdSpins']);
    expect(c.settings).toEqual({ enabled: true, priority: 0, holdSpins: 1 });
    expect(c.active).toBe(true);
  });

  it('applies project settings over the schema defaults', () => {
    const { plan } = resolvePlan({
      project: project({
        '@e8/reel-system': {
          version: '^1.0.0',
          contributions: { 'reel.feature:expandingWild': { settings: { holdSpins: 4 } } },
        },
      }),
      manifests: [reelSystem()],
      launch,
      kernelVersion: KERNEL,
    });
    expect(plan.contributions[0].settings.holdSpins).toBe(4);
  });

  it('applies a contribution defaults override before validation', () => {
    const manifest = reelSystem();
    manifest.contributes!['reel.feature'][0].defaults = { priority: 10 };
    const { plan } = resolvePlan({ project: project(), manifests: [manifest], launch, kernelVersion: KERNEL });
    expect(plan.contributions[0].settings.priority).toBe(10);
  });

  it('carries a settings diagnostic through, tagged with its plugin and contribution', () => {
    const { diagnostics } = resolvePlan({
      project: project({
        '@e8/reel-system': {
          version: '^1.0.0',
          contributions: { 'reel.feature:expandingWild': { settings: { holdSpins: 'many' } } },
        },
      }),
      manifests: [reelSystem()],
      launch,
      kernelVersion: KERNEL,
    });
    expect(diagnostics[0]).toMatchObject({
      code: 'schema/type-mismatch',
      pluginId: '@e8/reel-system',
      contributionId: 'expandingWild',
    });
  });

  it('marks a disabled contribution inactive but keeps it in the plan', () => {
    const { plan } = resolvePlan({
      project: project({
        '@e8/reel-system': {
          version: '^1.0.0',
          contributions: { 'reel.feature:expandingWild': { enabled: false } },
        },
      }),
      manifests: [reelSystem()],
      launch,
      kernelVersion: KERNEL,
    });
    expect(plan.contributions[0].enabled).toBe(false);
    expect(plan.contributions[0].active).toBe(false);
  });

  it('drops a plugin the project disabled', () => {
    const { plan } = resolvePlan({
      project: { plugins: { '@e8/reel-system': { version: '^1.0.0', enabled: false } } },
      manifests: [reelSystem()],
      launch,
      kernelVersion: KERNEL,
    });
    expect(plan.contributions).toHaveLength(0);
    expect(plan.order).toEqual([]);
  });

  it('rejects a plugin whose version does not satisfy the project range', () => {
    const { diagnostics } = resolvePlan({
      project: { plugins: { '@e8/reel-system': { version: '^2.0.0' } } },
      manifests: [reelSystem()],
      launch,
      kernelVersion: KERNEL,
    });
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'resolve/version-mismatch' });
  });

  it('rejects a plugin that needs a different kernel', () => {
    const { diagnostics } = resolvePlan({
      project: project(),
      manifests: [reelSystem({ engine: '^9.0.0' })],
      launch,
      kernelVersion: KERNEL,
    });
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'resolve/engine-mismatch' });
    expect(diagnostics[0].message).toContain('0.1.0');
  });

  it('reports a project entry with no installed manifest', () => {
    const { diagnostics } = resolvePlan({
      project: { plugins: { 'ghost-plugin': { version: '^1.0.0' } } },
      manifests: [],
      launch,
      kernelVersion: KERNEL,
    });
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'resolve/plugin-not-found' });
  });

  it('reports a contribution to a point nobody declared', () => {
    const orphan: PluginManifest = {
      id: 'orphan',
      version: '1.0.0',
      engine: '^0.1.0',
      contributes: { 'nowhere.point': [{ id: 'x', doc: 'x', create: noop }] },
    };
    const { diagnostics } = resolvePlan({
      project: { plugins: { orphan: { version: '^1.0.0' } } },
      manifests: [orphan],
      launch,
      kernelVersion: KERNEL,
    });
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'resolve/unknown-point' });
  });

  it('reports two plugins declaring the same point differently', () => {
    const other = reelSystem({ id: 'other' });
    other.points!['reel.feature'].arity = 'one';
    other.contributes = undefined;
    const { diagnostics } = resolvePlan({
      project: { plugins: { '@e8/reel-system': { version: '*' }, other: { version: '*' } } },
      manifests: [reelSystem(), other],
      launch,
      kernelVersion: KERNEL,
    });
    expect(diagnostics.some((d) => d.code === 'resolve/point-conflict')).toBe(true);
  });

  it('lets an identical duplicate point declaration pass', () => {
    const twin = reelSystem({ id: 'twin', contributes: undefined });
    const { diagnostics } = resolvePlan({
      project: { plugins: { '@e8/reel-system': { version: '*' }, twin: { version: '*' } } },
      manifests: [reelSystem(), twin],
      launch,
      kernelVersion: KERNEL,
    });
    expect(diagnostics.filter((d) => d.code === 'resolve/point-conflict')).toEqual([]);
  });

  it('orders contributions by plugin order, then by declaration order', () => {
    const core = reelSystem();
    const extra: PluginManifest = {
      id: 'acme-extra',
      version: '1.0.0',
      engine: '^0.1.0',
      dependsOn: { '@e8/reel-system': '^1.0.0' },
      contributes: {
        'reel.feature': [
          { id: 'cascadingWild', doc: 'Third-party.', create: noop },
          { id: 'creepingWild', doc: 'Third-party.', create: noop },
        ],
      },
    };
    const { plan, diagnostics } = resolvePlan({
      project: { plugins: { '@e8/reel-system': { version: '*' }, 'acme-extra': { version: '*' } } },
      manifests: [extra, core],
      launch,
      kernelVersion: KERNEL,
    });
    expect(diagnostics).toEqual([]);
    expect(plan.contributions.map((c) => c.id)).toEqual(['expandingWild', 'cascadingWild', 'creepingWild']);
  });
});

describe('resolvePlan — arity "one"', () => {
  function provider(id: string, activateWhen: Contribution['activateWhen']): PluginManifest {
    return {
      id,
      version: '1.0.0',
      engine: '^0.1.0',
      contributes: { 'session.provider': [{ id, activateWhen, doc: `${id} session.`, create: noop }] },
    };
  }

  const host: PluginManifest = {
    id: 'host',
    version: '1.0.0',
    engine: '^0.1.0',
    points: {
      'session.provider': { phase: 'runtime', arity: 'one', schema: {}, doc: 'Where rounds come from.' },
    },
  };

  const all = {
    plugins: { host: { version: '*' }, stake: { version: '*' }, artube: { version: '*' }, dev: { version: '*' } },
  };

  it('activates the candidate whose matcher fires', () => {
    const { plan, diagnostics } = resolvePlan({
      project: all,
      manifests: [host, provider('stake', { buildTarget: 'stake' }), provider('artube', { urlParam: 'sessionId' }), provider('dev', { default: true })],
      launch: { url: 'https://g/play', buildTarget: 'stake' },
      kernelVersion: KERNEL,
    });
    expect(diagnostics).toEqual([]);
    expect(plan.contributions.filter((c) => c.active).map((c) => c.id)).toEqual(['stake']);
  });

  it('falls back to the default candidate when none match', () => {
    const { plan } = resolvePlan({
      project: all,
      manifests: [host, provider('stake', { buildTarget: 'stake' }), provider('artube', { urlParam: 'sessionId' }), provider('dev', { default: true })],
      launch: { url: 'https://g/play' },
      kernelVersion: KERNEL,
    });
    expect(plan.contributions.filter((c) => c.active).map((c) => c.id)).toEqual(['dev']);
  });

  it('reports two matching candidates and activates neither', () => {
    const { plan, diagnostics } = resolvePlan({
      project: { plugins: { host: { version: '*' }, stake: { version: '*' }, artube: { version: '*' } } },
      manifests: [host, provider('stake', { buildTarget: 'stake' }), provider('artube', { buildTarget: 'stake' })],
      launch: { url: 'https://g/play', buildTarget: 'stake' },
      kernelVersion: KERNEL,
    });
    expect(plan.contributions.filter((c) => c.active)).toHaveLength(0);
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'resolve/ambiguous-activation' });
    expect(diagnostics[0].message).toContain('stake');
    expect(diagnostics[0].message).toContain('artube');
  });

  it('reports no candidate at all', () => {
    const { diagnostics } = resolvePlan({
      project: { plugins: { host: { version: '*' }, stake: { version: '*' } } },
      manifests: [host, provider('stake', { buildTarget: 'stake' })],
      launch: { url: 'https://g/play' },
      kernelVersion: KERNEL,
    });
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'resolve/no-activation' });
  });

  it('records a human sentence describing when each candidate activates', () => {
    const { plan } = resolvePlan({
      project: { plugins: { host: { version: '*' }, artube: { version: '*' } } },
      manifests: [host, provider('artube', { urlParam: 'sessionId' })],
      launch: { url: 'https://g/play?sessionId=1' },
      kernelVersion: KERNEL,
    });
    expect(plan.contributions[0].activationLabel).toBe('when ?sessionId is present');
  });
});

describe('toSnapshot', () => {
  it('produces a plan that survives a JSON round trip', () => {
    const { plan } = resolvePlan({
      project: project(),
      manifests: [reelSystem()],
      launch,
      kernelVersion: KERNEL,
    });
    const snapshot = toSnapshot(plan);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(snapshot.contributions[0]).not.toHaveProperty('create');
    expect(snapshot.contributions[0].key).toBe('reel.feature:expandingWild');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test --workspace @energy8engine/kernel
```

Expected: FAIL — cannot resolve `@/resolve/resolve`.

- [ ] **Step 3: Append the plan and project types to `packages/kernel/src/resolve/types.ts`**

Keep the existing `LaunchContext` and `Matcher` exactly as Task 4 wrote them. Put the three
`import type` lines at the TOP of the file, above the existing doc comment, and append everything
below `Matcher`:

```ts
// ↓ these three lines go at the top of the file
import type { Schema } from '../schema/types';
import type { Arity, Contribution, Phase, PluginManifest, PointId } from '../manifest/types';

// ↓ everything below goes after the existing Matcher interface

/** How a project addresses one contribution's settings: `${pointId}:${contributionId}`. */
export type ContributionKey = string;

export interface ContributionSettings {
  /** Default true. */
  enabled?: boolean;
  settings?: Record<string, unknown>;
}

export interface PluginEntry {
  /** Semver range the project accepts for this plugin. */
  version: string;
  /** Default true. */
  enabled?: boolean;
  /** Settings of the plugin itself. */
  settings?: Record<string, unknown>;
  /** Per-contribution settings, keyed by ContributionKey. */
  contributions?: Record<ContributionKey, ContributionSettings>;
}

/** The part of `project.json` the kernel reads. */
export interface ProjectDoc {
  plugins: Record<string, PluginEntry>;
}

export interface ResolvedPlugin {
  id: string;
  version: string;
  /** Validated plugin-level settings. */
  settings: Record<string, unknown>;
}

export interface ResolvedPoint {
  pointId: PointId;
  /** Which plugin opened this point. */
  pluginId: string;
  phase: Phase;
  arity: Arity;
  schema: Schema;
  doc: string;
}

export interface ResolvedContribution {
  key: ContributionKey;
  pluginId: string;
  pointId: PointId;
  id: string;
  /** The project's choice. */
  enabled: boolean;
  /** Enabled AND, on an `arity: 'one'` point, the winner of activation. */
  active: boolean;
  /** Human sentence describing when this contribution activates, for the IDE. */
  activationLabel: string;
  /** Effective schema: point fields then contribution fields. */
  schema: Schema;
  /** Validated settings — every schema key present. */
  settings: Record<string, unknown>;
  doc: string;
  create: Contribution['create'];
}

export interface ResolvedPlan {
  plugins: ResolvedPlugin[];
  points: Record<PointId, ResolvedPoint>;
  /** Ordered: by plugin activation order, then by declaration order within a plugin. */
  contributions: ResolvedContribution[];
  /** Plugin ids, dependencies first. */
  order: string[];
  /** Hook id → plugin ids that declared it. */
  hooks: Record<string, string[]>;
}

export interface ResolveInput {
  project: ProjectDoc;
  manifests: readonly PluginManifest[];
  launch: LaunchContext;
  /** Usually KERNEL_VERSION. Passed in so tests can pin it. */
  kernelVersion: string;
  /** When given, a hook a plugin declares that is not in this list is an error. */
  hookIds?: readonly string[];
}
```

- [ ] **Step 4: Write `packages/kernel/src/resolve/resolve.ts`**

```ts
import { type Diagnostic, error, warning } from '../diagnostics';
import { checkManifestShape } from '../manifest/define';
import type { PluginManifest } from '../manifest/types';
import { mergeSchemas } from '../schema/merge';
import { validate } from '../schema/validate';
import { describeMatcher, isDefaultMatcher, matches } from './match';
import { orderPlugins } from './order';
import { satisfies } from './semver';
import type {
  ResolveInput,
  ResolvedContribution,
  ResolvedPlan,
  ResolvedPlugin,
  ResolvedPoint,
} from './types';

export interface ResolveOutput {
  plan: ResolvedPlan;
  diagnostics: Diagnostic[];
}

/**
 * Turn a project's choices plus the installed manifests into a plan.
 *
 * Never throws. Every refusal is a diagnostic, so a broken project produces a precise list a person
 * can act on instead of a blank screen. The plan is still returned: whatever resolved cleanly is
 * usable, and the caller decides whether the errors are fatal.
 */
export function resolvePlan(input: ResolveInput): ResolveOutput {
  const diagnostics: Diagnostic[] = [];
  const { project, launch, kernelVersion } = input;

  // ── 1. Which manifests are in play ────────────────────────────────────────
  const byId = new Map<string, PluginManifest>();
  for (const manifest of input.manifests) {
    diagnostics.push(...checkManifestShape(manifest));
    if (manifest.id) byId.set(manifest.id, manifest);
  }

  const admitted: PluginManifest[] = [];
  for (const [pluginId, entry] of Object.entries(project.plugins)) {
    const manifest = byId.get(pluginId);
    if (!manifest) {
      diagnostics.push(
        error('resolve/plugin-not-found', `The project uses "${pluginId}", but it is not installed.`, {
          pluginId,
          fix: `Install ${pluginId}, or remove it from project.json.`,
        }),
      );
      continue;
    }
    if (entry.enabled === false) continue;

    if (!satisfies(manifest.version, entry.version)) {
      diagnostics.push(
        error(
          'resolve/version-mismatch',
          `"${pluginId}" is installed at ${manifest.version}, which does not satisfy ${entry.version}.`,
          { pluginId, fix: `Change the range in project.json, or install a matching version.` },
        ),
      );
      continue;
    }
    if (!satisfies(kernelVersion, manifest.engine)) {
      diagnostics.push(
        error(
          'resolve/engine-mismatch',
          `"${pluginId}" needs kernel ${manifest.engine}, but this kernel is ${kernelVersion}.`,
          { pluginId, fix: 'Upgrade the kernel, or use a build of the plugin that fits it.' },
        ),
      );
      continue;
    }
    admitted.push(manifest);
  }

  for (const manifest of input.manifests) {
    if (manifest.id && !(manifest.id in project.plugins)) {
      diagnostics.push(
        warning('resolve/not-in-project', `"${manifest.id}" is installed but not listed in the project; ignored.`, {
          pluginId: manifest.id,
          fix: `Add "${manifest.id}" to project.json to use it.`,
        }),
      );
    }
  }

  // ── 2. Dependencies and order ─────────────────────────────────────────────
  const ordering = orderPlugins(admitted);
  diagnostics.push(...ordering.diagnostics);

  const admittedById = new Map(admitted.map((m) => [m.id, m]));
  for (const manifest of admitted) {
    for (const [depId, range] of Object.entries(manifest.dependsOn ?? {})) {
      const dep = admittedById.get(depId);
      if (dep && !satisfies(dep.version, range)) {
        diagnostics.push(
          error(
            'resolve/dependency-version',
            `"${manifest.id}" needs "${depId}" ${range}, but ${dep.version} is installed.`,
            { pluginId: manifest.id },
          ),
        );
      }
    }
  }

  const ordered = ordering.order
    .map((id) => admittedById.get(id))
    .filter((m): m is PluginManifest => m !== undefined);

  // ── 3. Points ─────────────────────────────────────────────────────────────
  const points: Record<string, ResolvedPoint> = {};
  for (const manifest of ordered) {
    for (const [pointId, def] of Object.entries(manifest.points ?? {})) {
      const existing = points[pointId];
      if (existing) {
        const same =
          existing.phase === def.phase &&
          existing.arity === def.arity &&
          JSON.stringify(existing.schema) === JSON.stringify(def.schema);
        if (!same) {
          diagnostics.push(
            error(
              'resolve/point-conflict',
              `Point "${pointId}" is declared differently by "${existing.pluginId}" and "${manifest.id}".`,
              { pluginId: manifest.id, pointId, fix: 'Only one plugin should own a point; align or rename.' },
            ),
          );
        }
        continue;
      }
      points[pointId] = {
        pointId,
        pluginId: manifest.id,
        phase: def.phase,
        arity: def.arity,
        schema: def.schema,
        doc: def.doc,
      };
    }
  }

  // ── 4. Plugin-level settings ──────────────────────────────────────────────
  const plugins: ResolvedPlugin[] = [];
  for (const manifest of ordered) {
    const entry = project.plugins[manifest.id];
    const result = validate(entry.settings ?? {}, manifest.settings ?? {});
    diagnostics.push(...result.diagnostics.map((d) => ({ ...d, pluginId: manifest.id })));
    plugins.push({ id: manifest.id, version: manifest.version, settings: result.value });
  }

  // ── 5. Contributions ──────────────────────────────────────────────────────
  const contributions: ResolvedContribution[] = [];
  for (const manifest of ordered) {
    const entry = project.plugins[manifest.id];
    for (const [pointId, list] of Object.entries(manifest.contributes ?? {})) {
      const point = points[pointId];
      if (!point) {
        diagnostics.push(
          error('resolve/unknown-point', `"${manifest.id}" contributes to "${pointId}", which no plugin declares.`, {
            pluginId: manifest.id,
            pointId,
            fix: 'Install the plugin that opens this point, or fix the point id.',
          }),
        );
        continue;
      }

      for (const contribution of list) {
        const key = `${pointId}:${contribution.id}`;
        const tag = { pluginId: manifest.id, pointId, contributionId: contribution.id };

        const merged = mergeSchemas(point.schema, contribution.schema, tag);
        diagnostics.push(...merged.diagnostics);

        const chosen = entry.contributions?.[key];
        const raw = { ...(contribution.defaults ?? {}), ...(chosen?.settings ?? {}) };
        const validated = validate(raw, merged.schema);
        diagnostics.push(...validated.diagnostics.map((d) => ({ ...d, ...tag })));

        contributions.push({
          key,
          pluginId: manifest.id,
          pointId,
          id: contribution.id,
          enabled: chosen?.enabled !== false,
          active: false, // decided in step 6
          activationLabel: describeMatcher(contribution.activateWhen),
          schema: merged.schema,
          settings: validated.value,
          doc: contribution.doc,
          create: contribution.create,
        });
      }
    }
  }

  // ── 6. Activation ─────────────────────────────────────────────────────────
  for (const [pointId, point] of Object.entries(points)) {
    const candidates = contributions.filter((c) => c.pointId === pointId && c.enabled);

    if (point.arity === 'many') {
      for (const c of candidates) c.active = true;
      continue;
    }

    const manifestOf = (c: ResolvedContribution) =>
      admittedById.get(c.pluginId)?.contributes?.[pointId]?.find((x) => x.id === c.id);

    const matched = candidates.filter((c) => matches(manifestOf(c)?.activateWhen, launch));
    if (matched.length === 1) {
      matched[0].active = true;
      continue;
    }
    if (matched.length > 1) {
      diagnostics.push(
        error(
          'resolve/ambiguous-activation',
          `Point "${pointId}" allows one contribution, but these all match this launch: ${matched.map((c) => c.id).join(', ')}.`,
          { pointId, fix: 'Narrow the activateWhen matchers so exactly one fits.' },
        ),
      );
      continue;
    }

    const fallbacks = candidates.filter((c) => isDefaultMatcher(manifestOf(c)?.activateWhen));
    if (fallbacks.length === 1) {
      fallbacks[0].active = true;
      continue;
    }
    if (fallbacks.length > 1) {
      diagnostics.push(
        error(
          'resolve/ambiguous-activation',
          `Point "${pointId}" has more than one default: ${fallbacks.map((c) => c.id).join(', ')}.`,
          { pointId, fix: 'Exactly one contribution may be the default.' },
        ),
      );
      continue;
    }
    if (candidates.length > 0) {
      diagnostics.push(
        error(
          'resolve/no-activation',
          `Point "${pointId}" needs one contribution, but none matches this launch. Candidates: ${candidates.map((c) => `${c.id} (${c.activationLabel})`).join(', ')}.`,
          { pointId, fix: 'Add a contribution with `activateWhen: { default: true }`.' },
        ),
      );
    }
  }

  // ── 7. Hooks ──────────────────────────────────────────────────────────────
  const hooks: Record<string, string[]> = {};
  for (const manifest of ordered) {
    for (const hook of manifest.hooks ?? []) {
      if (input.hookIds && !input.hookIds.includes(hook)) {
        diagnostics.push(
          error('resolve/unknown-hook', `"${manifest.id}" declares hook "${hook}", which does not exist.`, {
            pluginId: manifest.id,
            fix: `Known hooks: ${input.hookIds.join(', ')}.`,
          }),
        );
        continue;
      }
      (hooks[hook] ??= []).push(manifest.id);
    }
  }

  return { plan: { plugins, points, contributions, order: ordering.order, hooks }, diagnostics };
}
```

- [ ] **Step 5: Write `packages/kernel/src/resolve/snapshot.ts`**

```ts
import type { ResolvedContribution, ResolvedPlan } from './types';

/** A ResolvedContribution minus its factory — plain JSON. */
export type ContributionSnapshot = Omit<ResolvedContribution, 'create'>;

/**
 * The plan as data. `ResolvedPlan` holds `create` functions and therefore is not JSON; this is what
 * travels to the IDE over RPC and what the agent reads. Both read exactly what the game runs — one
 * description of the composition, not three.
 */
export type PlanSnapshot = Omit<ResolvedPlan, 'contributions'> & {
  contributions: ContributionSnapshot[];
};

export function toSnapshot(plan: ResolvedPlan): PlanSnapshot {
  return {
    ...plan,
    contributions: plan.contributions.map(({ create: _create, ...rest }) => rest),
  };
}
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
npm test --workspace @energy8engine/kernel
```

Expected: PASS — 19 new tests in `resolve.test.ts`; the suite stays green.

- [ ] **Step 7: Commit**

```bash
git add packages/kernel/src/resolve packages/kernel/tests/resolve.test.ts
git commit -m "feat(kernel): resolvePlan and the serializable plan snapshot"
```

---

## Phase 3 — Runtime

### Task 9: Lazy activation with failure isolation

**Files:**
- Create: `packages/kernel/src/runtime/activate.ts`
- Test: `packages/kernel/tests/activate.test.ts`

**Interfaces:**
- Consumes: `ResolvedPlan`, `Diagnostic`.
- Produces:
  - `interface Activated<T> { key: string; pluginId: string; contributionId: string; value: T }`
  - `activatePoint<T>(plan: ResolvedPlan, pointId: string): Promise<{ instances: Activated<T>[]; diagnostics: Diagnostic[] }>`

- [ ] **Step 1: Write the failing test `packages/kernel/tests/activate.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { activatePoint } from '@/runtime/activate';
import { resolvePlan } from '@/resolve/resolve';
import type { Contribution, PluginManifest } from '@/manifest/types';

function host(list: Contribution[]): PluginManifest {
  return {
    id: 'host',
    version: '1.0.0',
    engine: '*',
    points: {
      'reel.feature': {
        phase: 'runtime',
        arity: 'many',
        schema: { power: { kind: 'number', default: 1 } },
        doc: 'A reel behaviour.',
      },
    },
    contributes: { 'reel.feature': list },
  };
}

function planFor(list: Contribution[]) {
  const { plan } = resolvePlan({
    project: { plugins: { host: { version: '*' } } },
    manifests: [host(list)],
    launch: { url: 'https://g/play' },
    kernelVersion: '0.1.0',
  });
  return plan;
}

describe('activatePoint', () => {
  it('calls the factory with the validated settings', async () => {
    let seen: unknown = null;
    const plan = planFor([
      {
        id: 'a',
        doc: 'A.',
        create: async () => (settings) => {
          seen = settings;
          return 'made-a';
        },
      },
    ]);
    const { instances, diagnostics } = await activatePoint<string>(plan, 'reel.feature');
    expect(diagnostics).toEqual([]);
    expect(instances).toEqual([{ key: 'reel.feature:a', pluginId: 'host', contributionId: 'a', value: 'made-a' }]);
    expect(seen).toEqual({ power: 1 });
  });

  it('accepts a module with a default export, so a bare dynamic import works', async () => {
    const plan = planFor([{ id: 'a', doc: 'A.', create: async () => ({ default: () => 'from-default' }) }]);
    const { instances } = await activatePoint<string>(plan, 'reel.feature');
    expect(instances[0].value).toBe('from-default');
  });

  it('awaits an async factory', async () => {
    const plan = planFor([{ id: 'a', doc: 'A.', create: async () => async () => 'async-value' }]);
    const { instances } = await activatePoint<string>(plan, 'reel.feature');
    expect(instances[0].value).toBe('async-value');
  });

  it('skips contributions the project disabled', async () => {
    const { plan } = resolvePlan({
      project: {
        plugins: {
          host: { version: '*', contributions: { 'reel.feature:b': { enabled: false } } },
        },
      },
      manifests: [
        host([
          { id: 'a', doc: 'A.', create: async () => () => 'a' },
          { id: 'b', doc: 'B.', create: async () => () => 'b' },
        ]),
      ],
      launch: { url: 'https://g/play' },
      kernelVersion: '0.1.0',
    });
    const { instances } = await activatePoint<string>(plan, 'reel.feature');
    expect(instances.map((i) => i.value)).toEqual(['a']);
  });

  it('isolates a factory that throws and keeps the others alive', async () => {
    const plan = planFor([
      { id: 'good1', doc: 'Fine.', create: async () => () => 'one' },
      {
        id: 'broken',
        doc: 'Explodes.',
        create: async () => () => {
          throw new Error('boom');
        },
      },
      { id: 'good2', doc: 'Fine.', create: async () => () => 'two' },
    ]);
    const { instances, diagnostics } = await activatePoint<string>(plan, 'reel.feature');
    expect(instances.map((i) => i.value)).toEqual(['one', 'two']);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'activate/factory-failed',
      contributionId: 'broken',
    });
    expect(diagnostics[0].message).toContain('boom');
  });

  it('isolates a create() whose import rejects', async () => {
    const plan = planFor([
      {
        id: 'missing',
        doc: 'Module is gone.',
        create: async () => {
          throw new Error('Cannot find module');
        },
      },
    ]);
    const { instances, diagnostics } = await activatePoint(plan, 'reel.feature');
    expect(instances).toEqual([]);
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'activate/load-failed' });
  });

  it('reports a module that resolves to something other than a factory', async () => {
    const plan = planFor([{ id: 'weird', doc: 'Not a factory.', create: async () => ({ nope: 1 }) as never }]);
    const { instances, diagnostics } = await activatePoint(plan, 'reel.feature');
    expect(instances).toEqual([]);
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'activate/not-a-factory' });
  });

  it('returns nothing for a point with no contributions', async () => {
    const plan = planFor([]);
    const { instances, diagnostics } = await activatePoint(plan, 'reel.feature');
    expect(instances).toEqual([]);
    expect(diagnostics).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test --workspace @energy8engine/kernel
```

Expected: FAIL — cannot resolve `@/runtime/activate`.

- [ ] **Step 3: Write `packages/kernel/src/runtime/activate.ts`**

```ts
import { type Diagnostic, error } from '../diagnostics';
import type { Factory } from '../manifest/types';
import type { ResolvedContribution, ResolvedPlan } from '../resolve/types';

export interface Activated<T> {
  key: string;
  pluginId: string;
  contributionId: string;
  value: T;
}

export interface ActivateResult<T> {
  instances: Activated<T>[];
  diagnostics: Diagnostic[];
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Instantiate every active contribution to a point, in plan order.
 *
 * This is the only asynchronous part of the kernel, and the only place a plugin's own code runs.
 * Each contribution is isolated: a module that fails to load, a value that is not a factory, or a
 * factory that throws costs exactly that one contribution. One broken third-party reel feature must
 * not be able to take a live game down.
 */
export async function activatePoint<T = unknown>(
  plan: ResolvedPlan,
  pointId: string,
): Promise<ActivateResult<T>> {
  const instances: Activated<T>[] = [];
  const diagnostics: Diagnostic[] = [];

  const wanted = plan.contributions.filter((c) => c.pointId === pointId && c.active);

  for (const contribution of wanted) {
    const tag = {
      pluginId: contribution.pluginId,
      pointId,
      contributionId: contribution.id,
    };

    let loaded: unknown;
    try {
      loaded = await contribution.create();
    } catch (err) {
      diagnostics.push(
        error('activate/load-failed', `Could not load "${contribution.key}": ${messageOf(err)}`, {
          ...tag,
          fix: 'Check the create() import path in the plugin manifest.',
        }),
      );
      continue;
    }

    const factory = pickFactory<T>(loaded);
    if (!factory) {
      diagnostics.push(
        error('activate/not-a-factory', `"${contribution.key}" did not resolve to a factory function.`, {
          ...tag,
          fix: 'create() must resolve to a function, or to a module whose default export is one.',
        }),
      );
      continue;
    }

    try {
      const value = await factory(contribution.settings);
      instances.push({
        key: contribution.key,
        pluginId: contribution.pluginId,
        contributionId: contribution.id,
        value: value as T,
      });
    } catch (err) {
      diagnostics.push(
        error('activate/factory-failed', `"${contribution.key}" failed to start: ${messageOf(err)}`, tag),
      );
    }
  }

  return { instances, diagnostics };
}

function pickFactory<T>(loaded: unknown): Factory<T> | null {
  if (typeof loaded === 'function') return loaded as Factory<T>;
  if (loaded && typeof loaded === 'object') {
    const candidate = (loaded as { default?: unknown }).default;
    if (typeof candidate === 'function') return candidate as Factory<T>;
  }
  return null;
}

/** Convenience for `arity: 'one'` points: the single active instance, or null. */
export async function activateOne<T = unknown>(
  plan: ResolvedPlan,
  pointId: string,
): Promise<{ instance: Activated<T> | null; diagnostics: Diagnostic[] }> {
  const { instances, diagnostics } = await activatePoint<T>(plan, pointId);
  return { instance: instances[0] ?? null, diagnostics };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test --workspace @energy8engine/kernel
```

Expected: PASS — 8 new tests in `activate.test.ts`; the suite stays green.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/runtime/activate.ts packages/kernel/tests/activate.test.ts
git commit -m "feat(kernel): lazy contribution activation with failure isolation"
```

---

### Task 10: Hook bus

**Files:**
- Create: `packages/kernel/src/runtime/hooks.ts`
- Test: `packages/kernel/tests/hooks.test.ts`

**Interfaces:**
- Consumes: `Diagnostic`/`error`.
- Produces:
  - `type HookFn = (payload: unknown) => void | Promise<void>`
  - `interface HookBus { ids(): readonly string[]; on(pluginId: string, hook: string, fn: HookFn): Diagnostic | null; emit(hook: string, payload?: unknown): Promise<Diagnostic[]> }`
  - `createHookBus(opts: { ids: readonly string[]; declared: Record<string, readonly string[]> }): HookBus`

The kernel supplies the mechanism and nothing else. The list of hook ids comes from the caller — the game-runtime layer in phase 2 — so that `beforeSpin` and its relatives never appear in a package that is supposed to know nothing about slots. `declared` is `plan.hooks` inverted: plugin id → the hooks it declared.

- [ ] **Step 1: Write the failing test `packages/kernel/tests/hooks.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import { createHookBus } from '@/runtime/hooks';

const IDS = ['bootstrap', 'dispose'] as const;

function bus(declared: Record<string, readonly string[]> = { a: ['bootstrap'], b: ['bootstrap', 'dispose'] }) {
  return createHookBus({ ids: IDS, declared });
}

describe('createHookBus', () => {
  it('exposes the ids it was built with', () => {
    expect(bus().ids()).toEqual(['bootstrap', 'dispose']);
  });

  it('registers a hook the plugin declared', async () => {
    const b = bus();
    const fn = vi.fn();
    expect(b.on('a', 'bootstrap', fn)).toBeNull();
    await b.emit('bootstrap', { n: 1 });
    expect(fn).toHaveBeenCalledWith({ n: 1 });
  });

  it('refuses a hook the plugin did not declare, and does not register it', async () => {
    const b = bus();
    const fn = vi.fn();
    const diagnostic = b.on('a', 'dispose', fn);
    expect(diagnostic).toMatchObject({ severity: 'error', code: 'hooks/undeclared', pluginId: 'a' });
    await b.emit('dispose');
    expect(fn).not.toHaveBeenCalled();
  });

  it('refuses a hook id that does not exist at all', () => {
    const b = bus();
    expect(b.on('a', 'nonsense', vi.fn())).toMatchObject({ code: 'hooks/unknown' });
  });

  it('runs handlers in registration order', async () => {
    const b = bus();
    const calls: string[] = [];
    b.on('a', 'bootstrap', () => void calls.push('a'));
    b.on('b', 'bootstrap', () => void calls.push('b'));
    await b.emit('bootstrap');
    expect(calls).toEqual(['a', 'b']);
  });

  it('awaits async handlers before resolving', async () => {
    const b = bus();
    let done = false;
    b.on('a', 'bootstrap', async () => {
      await new Promise((r) => setTimeout(r, 5));
      done = true;
    });
    await b.emit('bootstrap');
    expect(done).toBe(true);
  });

  it('isolates a throwing handler and still runs the rest', async () => {
    const b = bus();
    const after = vi.fn();
    b.on('a', 'bootstrap', () => {
      throw new Error('handler exploded');
    });
    b.on('b', 'bootstrap', after);
    const diagnostics = await b.emit('bootstrap');
    expect(after).toHaveBeenCalled();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'hooks/handler-failed', pluginId: 'a' });
    expect(diagnostics[0].message).toContain('handler exploded');
  });

  it('emitting a hook with no handlers is a no-op', async () => {
    expect(await bus().emit('dispose')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test --workspace @energy8engine/kernel
```

Expected: FAIL — cannot resolve `@/runtime/hooks`.

- [ ] **Step 3: Write `packages/kernel/src/runtime/hooks.ts`**

```ts
import { type Diagnostic, error } from '../diagnostics';

export type HookFn = (payload: unknown) => void | Promise<void>;

export interface HookBus {
  /** The hook ids this bus accepts. */
  ids(): readonly string[];
  /** Register a handler. Returns a diagnostic instead of registering when the call is not allowed. */
  on(pluginId: string, hook: string, fn: HookFn): Diagnostic | null;
  /** Run every handler of a hook, in registration order. Never rejects. */
  emit(hook: string, payload?: unknown): Promise<Diagnostic[]>;
}

export interface HookBusOptions {
  /** The closed list of hook ids. Supplied by the caller — the kernel names no game-domain hooks. */
  ids: readonly string[];
  /** Plugin id → the hooks that plugin declared in its manifest. */
  declared: Record<string, readonly string[]>;
}

/**
 * The escape hatch, deliberately narrow.
 *
 * A hook is opaque to the IDE — no schema, no form. That is why the list is closed and why a plugin
 * must DECLARE the hooks it uses: the IDE cannot show what a hook does, but it can at least show
 * that one exists and name the plugin responsible. Registering an undeclared hook is refused.
 */
export function createHookBus(opts: HookBusOptions): HookBus {
  const handlers = new Map<string, { pluginId: string; fn: HookFn }[]>();

  return {
    ids: () => opts.ids,

    on(pluginId, hook, fn) {
      if (!opts.ids.includes(hook)) {
        return error('hooks/unknown', `There is no hook called "${hook}".`, {
          pluginId,
          fix: `Known hooks: ${opts.ids.join(', ')}.`,
        });
      }
      if (!(opts.declared[pluginId] ?? []).includes(hook)) {
        return error('hooks/undeclared', `"${pluginId}" uses hook "${hook}" without declaring it.`, {
          pluginId,
          fix: `Add \`hooks: ['${hook}']\` to the plugin manifest.`,
        });
      }
      let list = handlers.get(hook);
      if (!list) {
        list = [];
        handlers.set(hook, list);
      }
      list.push({ pluginId, fn });
      return null;
    },

    async emit(hook, payload) {
      const diagnostics: Diagnostic[] = [];
      for (const { pluginId, fn } of handlers.get(hook) ?? []) {
        try {
          await fn(payload);
        } catch (err) {
          diagnostics.push(
            error(
              'hooks/handler-failed',
              `"${pluginId}" failed in hook "${hook}": ${err instanceof Error ? err.message : String(err)}`,
              { pluginId },
            ),
          );
        }
      }
      return diagnostics;
    },
  };
}

/** Invert `plan.hooks` (hook → plugin ids) into the `declared` map this bus wants. */
export function declaredFromPlan(hooks: Record<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [hook, pluginIds] of Object.entries(hooks)) {
    for (const pluginId of pluginIds) (out[pluginId] ??= []).push(hook);
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test --workspace @energy8engine/kernel
```

Expected: PASS — 8 new tests in `hooks.test.ts`; the suite stays green.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/runtime/hooks.ts packages/kernel/tests/hooks.test.ts
git commit -m "feat(kernel): closed hook bus with declaration enforcement"
```

---

## Phase 4 — Sealing the package

### Task 11: Purity guard, public barrel, README

**Files:**
- Modify: `packages/kernel/src/index.ts`
- Create: `packages/kernel/README.md`
- Test: `packages/kernel/tests/purity.test.ts`

**Interfaces:**
- Produces: the complete public API of `@energy8engine/kernel`.

The purity test is the enforcement mechanism for the constraint the whole design rests on. The kernel is imported by the game, by the build and by the IDE; the moment it acquires a dependency on pixi, on the DOM or on node builtins, one of those three can no longer use it.

- [ ] **Step 1: Write the failing test `packages/kernel/tests/purity.test.ts`**

```ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return name.endsWith('.ts') ? [full] : [];
  });
}

describe('kernel purity', () => {
  it('declares no runtime dependencies', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.peerDependencies).toBeUndefined();
  });

  it('imports nothing outside its own source tree', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const body = readFileSync(file, 'utf8');
      for (const match of body.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
        const specifier = match[1];
        if (specifier.startsWith('.')) continue;
        offenders.push(`${file.slice(ROOT.length + 1)} → ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('touches no browser globals', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const body = readFileSync(file, 'utf8');
      for (const global of ['document', 'window', 'localStorage', 'navigator']) {
        if (new RegExp(`\\b${global}\\b`).test(body)) {
          offenders.push(`${file.slice(ROOT.length + 1)} → ${global}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test**

```bash
npm test --workspace @energy8engine/kernel
```

This one is a **guard**, not a red-green cycle: it should PASS the moment it exists, because Tasks 1–10 were written under these constraints. If it fails, an earlier task smuggled in an import or a browser global — fix that source file now rather than relaxing the test.

- [ ] **Step 3: Write the public barrel `packages/kernel/src/index.ts`**

Replace the file's contents entirely:

```ts
/**
 * @energy8engine/kernel — the plugin kernel.
 *
 * Everything here is a pure function over plain data. The kernel knows nothing about renderers,
 * slots, spins or the DOM; it knows only how plugins declare extension points, how contributions
 * plug into them, and how a project's choices resolve into a plan.
 */

/** Kernel version. Plugin manifests declare the range they need via `engine`. */
export const KERNEL_VERSION = '0.1.0';

// Diagnostics
export { error, hasErrors, warning } from './diagnostics';
export type { Diagnostic, Severity } from './diagnostics';

// Schema
export { STRING_KINDS } from './schema/types';
export type { AssetKind, EnumOption, FieldBase, FieldSchema, Schema } from './schema/types';
export { defaultOf, validate } from './schema/validate';
export type { ValidateResult } from './schema/validate';
export { mergeSchemas } from './schema/merge';
export type { MergeContext, MergeResult } from './schema/merge';

// Manifest
export { checkManifestShape, definePlugin } from './manifest/define';
export type {
  Arity,
  Contribution,
  Factory,
  Phase,
  PluginManifest,
  PointDef,
  PointId,
} from './manifest/types';

// Resolution
export { isValidRange, parseVersion, satisfies } from './resolve/semver';
export type { Version } from './resolve/semver';
export { orderPlugins } from './resolve/order';
export type { OrderResult } from './resolve/order';
export { describeMatcher, isDefaultMatcher, matches } from './resolve/match';
export { resolvePlan } from './resolve/resolve';
export type { ResolveOutput } from './resolve/resolve';
export { toSnapshot } from './resolve/snapshot';
export type { ContributionSnapshot, PlanSnapshot } from './resolve/snapshot';
export type {
  ContributionKey,
  ContributionSettings,
  LaunchContext,
  Matcher,
  PluginEntry,
  ProjectDoc,
  ResolveInput,
  ResolvedContribution,
  ResolvedPlan,
  ResolvedPlugin,
  ResolvedPoint,
} from './resolve/types';

// Runtime
export { activateOne, activatePoint } from './runtime/activate';
export type { Activated, ActivateResult } from './runtime/activate';
export { createHookBus, declaredFromPlan } from './runtime/hooks';
export type { HookBus, HookBusOptions, HookFn } from './runtime/hooks';
```

- [ ] **Step 4: Extend the skeleton test to cover the barrel**

Replace `packages/kernel/tests/skeleton.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import * as kernel from '@/index';

describe('kernel package', () => {
  it('exposes its version', () => {
    expect(kernel.KERNEL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('exposes the whole public API from one entry point', () => {
    for (const name of [
      'error',
      'warning',
      'hasErrors',
      'validate',
      'defaultOf',
      'mergeSchemas',
      'definePlugin',
      'checkManifestShape',
      'satisfies',
      'orderPlugins',
      'matches',
      'describeMatcher',
      'resolvePlan',
      'toSnapshot',
      'activatePoint',
      'activateOne',
      'createHookBus',
    ]) {
      expect(typeof kernel[name as keyof typeof kernel]).toBe('function');
    }
  });
});
```

- [ ] **Step 5: Write `packages/kernel/README.md`**

````markdown
# @energy8engine/kernel

The plugin kernel for Energy8 games. It defines what a plugin is, resolves a project's plugins
into a plan, and activates their contributions lazily. It has **no dependencies** and knows
nothing about renderers, slots or the DOM.

## The model

A plugin **declares** rather than does. Its manifest is free of side effects, so the IDE, the
build and the agent can read the full composition of a game without starting it.

```ts
import { definePlugin } from '@energy8engine/kernel';

export default definePlugin({
  id: '@e8/reel-system',
  version: '1.0.0',
  engine: '^0.1.0',

  // A new extension point. The kernel owns no list of points — plugins open them.
  points: {
    'reel.feature': {
      phase: 'runtime',
      arity: 'many',
      schema: { enabled: { kind: 'boolean', default: true } },
      doc: 'A behaviour layered onto the reels.',
    },
  },

  // Contributions plug into a point — this plugin's own, or another's.
  contributes: {
    'reel.feature': [
      {
        id: 'expandingWild',
        schema: { holdSpins: { kind: 'number', default: 1, min: 1, max: 10 } },
        doc: 'A wild expands to fill its reel.',
        create: () => import('./features/expandingWild'),
      },
    ],
  },
});
```

Anyone can now add a fourteenth reel feature from their own plugin, without touching the engine.

## Two rules

1. **Schema is mandatory.** It is what lets the IDE render a settings form and what the agent
   reads as documentation. A contribution without one is not registered.
2. **What the IDE must configure lives in a contribution; what it merely needs to know about
   lives in a declared hook.** Hooks are opaque, so the list is closed and using one undeclared
   is refused.

## Using it

```ts
import { resolvePlan, activatePoint, toSnapshot, KERNEL_VERSION } from '@energy8engine/kernel';

const { plan, diagnostics } = resolvePlan({
  project,                       // parsed project.json
  manifests,                     // the installed plugins' manifests
  launch: { url: location.href, buildTarget: import.meta.env.BUILD_TARGET },
  kernelVersion: KERNEL_VERSION,
});

// Nothing threw. Errors arrived as data.
if (diagnostics.some((d) => d.severity === 'error')) showErrorScreen(diagnostics);

const { instances } = await activatePoint(plan, 'reel.feature');

// What the IDE and the agent read: the same plan, as plain JSON.
sendToIde(toSnapshot(plan));
```

## Effective schema

A contribution's settings form is the **point's schema plus its own**. A contribution may add
fields; it may not redefine one the point owns, because the IDE would then render a control whose
meaning changed depending on which contribution was selected.

## Tests

```bash
npm test --workspace @energy8engine/kernel
```

Run it from the repo root with that exact command — `npx vitest run <path>` reports false
failures under this workspace layout.
````

- [ ] **Step 6: Run the whole suite, typecheck and build**

```bash
npm test --workspace @energy8engine/kernel
npm run typecheck --workspace @energy8engine/kernel
npm run build --workspace @energy8engine/kernel
```

Expected: the whole suite green (91 tests as written above). Typecheck clean. `dist/index.esm.js` and `dist/index.d.ts` written.

- [ ] **Step 7: Verify the built bundle carries no imports**

```bash
grep -c "^import" packages/kernel/dist/index.esm.js || echo "0 imports — correct"
```

Expected: `0 imports — correct`. Any import in the built ESM means a dependency crept in.

- [ ] **Step 8: Commit**

```bash
git add packages/kernel/src/index.ts packages/kernel/README.md packages/kernel/tests
git commit -m "feat(kernel): public API barrel, README and purity guard"
```

- [ ] **Step 9: Push the branch**

```bash
git push -u origin feat/kernel
```

---

## Definition of Done

- `npm test --workspace @energy8engine/kernel` — whole suite green, no skipped tests.
- `npm run typecheck --workspace @energy8engine/kernel` — clean.
- `npm run build --workspace @energy8engine/kernel` — `dist/index.esm.js` contains zero imports.
- `packages/kernel/package.json` has no `dependencies` and no `peerDependencies`.
- Every public symbol is reachable from `@energy8engine/kernel` and documented in the README.

## What phase 2 will need from this

Phase 2 wraps the existing framework into six plugins. It consumes exactly:
`definePlugin`, `resolvePlan`, `activatePoint`, `activateOne`, `createHookBus`,
`declaredFromPlan`, `toSnapshot`, `KERNEL_VERSION`, and the `Schema` / `PluginManifest` /
`ResolvedPlan` types. Nothing in this plan is written for the kernel's own sake — every export
above has a named consumer in the next phase.
