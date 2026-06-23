# Scaffold Polish + General Spin-Result Coercion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** four scaffold/runtime improvements — a general zod spin-schema with `{}`→`[]` coercion for ALL games (fixing the live `(x ?? []).map` crash), a game-owned `IntroScene` subclass, a `build:stake` target, and a `postbuild` zip.

**Architecture:** the spin coercion reuses stake-kit's already-shipped `deriveArrayFields(schema)` + recursive `coerceLuaArrays(data, fieldSet)` (today used only by `createGameAdapter`) in the generated `normalize`, driven by one generated `src/game/schema.ts` the stake adapter also imports. The host's `intro` option gains a custom-`Scene`-class form; the scaffold generates an owned `IntroScene` subclass. `build:stake` + `postbuild` are codegen'd package.json scripts plus a `BUILD_TARGET` branch in the template vite config.

**Tech Stack:** TypeScript, zod v3, Vitest 2.x, the create-slot codegen + template, `@energy8platform/{game-engine,stake-kit}`.

## Global Constraints

- **Spin coercion reuses existing exports** — `deriveArrayFields` + `coerceLuaArrays` from `@energy8platform/stake-kit` (both already exported; `coerceLuaArrays` is recursive at any depth). NO new helper, NO `luaArray` wrapper, NO change to stake-kit.
- **One schema, all games** — `src/game/schema.ts` (zod) is generated for EVERY game (not just stake). It describes the inner **Lua data table** (`total_win`, `cascades`/`matrix`+`wins`, `multiplier`, `free_spins:{awarded,total}`) with array fields as plain `z.array(...)`. Both `normalize` (on `raw.data`) and the stake adapter (on `event.data`) use it. No `src/stake/schema.ts` anymore.
- **`free_spins` convention** is the nested `{ awarded: number, total: number }` form everywhere (reconcile the stake adapter to it; drop the old flat `free_spins_awarded`).
- **`normalize` never throws on shape** — `coerceLuaArrays(raw.data, deriveArrayFields(spinSchema))` then `spinSchema.safeParse(...)` with a fallback to the coerced object. NO `?? []` on an array field.
- **`zod` is a universal scaffold dependency** (`genPackageJson` always includes it, `^3.23.0`).
- **`intro` is additive** — `CreateSlotGameOptions.intro` accepts the existing `IntroSceneConfig` OR `{ scene: SceneConstructor; data?: unknown }`; the config path stays unchanged so `spec-slot` keeps working.
- **The anti-drift scaffold smoke must stay green** — generated `schema.ts` + `src/scenes/IntroScene.ts` typecheck against real packages; verify with `npx vitest run --root packages/create-slot`.
- Commit after each task. Branch `feat/game-spec-define-game`. Trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Out of scope: migrating bespoke games' normalizers; a non-zod path; enriching the game-engine built-in `IntroScene` primitive.

## File Structure

```
packages/create-slot/src/codegen/schema.ts        (new) genSchema(a) → src/game/schema.ts
packages/create-slot/src/codegen/normalize.ts      (change) coerce via schema, drop ?? []
packages/create-slot/src/codegen/stakeAdapter.ts   (change) import ../game/schema; drop own schema; free_spins nested
packages/create-slot/src/codegen/packageJson.ts    (change) zod universal; postbuild; build:stake/dev:stake/stake:bundle
packages/create-slot/src/codegen/introScene.ts     (new) genIntroScene(a) → src/scenes/IntroScene.ts
packages/create-slot/src/codegen/mainTs.ts         (change) intro: { scene: IntroScene }
packages/create-slot/src/generate.ts               (change) write src/game/schema.ts + src/scenes/IntroScene.ts; stake = adapter only
packages/create-slot/template/vite.config.ts       (change) BUILD_TARGET=stake branch
packages/create-slot/test/{schema,normalize,packageJson,introScene,mainTs}.test.ts  (new/change)
packages/game-engine/src/host/types.ts             (change) intro union
packages/game-engine/src/host/createSlotGame.ts    (change) resolve intro union
packages/game-engine/tests/intro-option.test.ts    (new)
examples/spec-slot/{game/schema.ts, normalize.ts, scenes/IntroScene.ts, main.ts}  (change) proof + regression
```

---

## Task 1: General spin schema + coercion in normalize (#4 — the spine)

**Files:**
- Create: `packages/create-slot/src/codegen/schema.ts`, `packages/create-slot/test/schema.test.ts`
- Modify: `packages/create-slot/src/codegen/normalize.ts`, `packages/create-slot/src/codegen/stakeAdapter.ts`, `packages/create-slot/src/codegen/packageJson.ts`, `packages/create-slot/src/generate.ts`
- Test: `packages/create-slot/test/normalize.test.ts` (new), update `packages/create-slot/test/packageJson.test.ts`

**Interfaces:**
- Consumes: `Answers` (`{ id, title, mechanic, grid, stake, cascades }`); stake-kit exports `deriveArrayFields(schema)` and `coerceLuaArrays(data, fieldSet: Set<string>)`.
- Produces: `genSchema(a: Answers): string` → `src/game/schema.ts` exporting `spinSchema` + `type SpinDataRaw`; `genNormalize` emits schema-driven coercion; `genStakeAdapter` imports `../game/schema`.

- [ ] **Step 1: Write the failing test for `genSchema`**

```ts
// packages/create-slot/test/schema.test.ts
import { describe, it, expect } from 'vitest';
import { genSchema } from '../src/codegen/schema';

describe('genSchema', () => {
  it('cascade game: zod schema with a plain z.array cascades field + free_spins {awarded,total}', () => {
    const s = genSchema({ id: 'g', title: 'G', mechanic: 'cluster', grid: { cols: 7, rows: 7 }, stake: true, cascades: true });
    expect(s).toContain("import { z } from 'zod'");
    expect(s).toContain('export const spinSchema = z.object(');
    expect(s).toContain('cascades: z.array(');         // plain z.array so deriveArrayFields finds it
    expect(s).toContain('free_spins: z.object({ awarded: z.number(), total: z.number() })');
    expect(s).toContain('export type SpinDataRaw = z.infer<typeof spinSchema>');
    expect(s).not.toContain('@energy8platform/stake-kit');  // schema is plain zod; coercion lives in normalize
  });
  it('reel game: matrix + wins arrays instead of cascades', () => {
    const s = genSchema({ id: 'g', title: 'G', mechanic: 'lines', grid: { cols: 5, rows: 3 }, stake: false, cascades: false });
    expect(s).toContain('matrix: z.array(z.array(z.number()))');
    expect(s).toContain('wins: z.array(');
    expect(s).not.toContain('cascades');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/create-slot/test/schema.test.ts`
Expected: FAIL — `genSchema` not found.

- [ ] **Step 3: Implement `genSchema`**

```ts
// packages/create-slot/src/codegen/schema.ts
import type { Answers } from '../answers';

/** Generate src/game/schema.ts: the zod schema for the inner Lua data table.
 * Array fields are plain z.array(...) so stake-kit's deriveArrayFields() finds them
 * and coerceLuaArrays() can turn Lua {} into [] (used by normalize AND the stake adapter). */
export function genSchema(a: Answers): string {
  const cascade = a.cascades === true;
  const arrayFields = cascade
    ? `    cascades: z.array(z.object({}).passthrough()).optional(),`
    : `    matrix: z.array(z.array(z.number())).optional(),
    wins: z.array(z.object({}).passthrough()).optional(),`;
  return `import { z } from 'zod';

/** The inner Lua "data" table your script.logic.lua returns (the engine nests it under result.data).
 * Edit these fields to match your math. Array fields MUST stay z.array(...) so Lua {} coerces to []. */
export const spinSchema = z.object({
  total_win: z.number().optional(),
${arrayFields}
  multiplier: z.number().optional(),
  free_spins: z.object({ awarded: z.number(), total: z.number() }).optional(),
});
export type SpinDataRaw = z.infer<typeof spinSchema>;
`;
}
```

- [ ] **Step 4: Run the schema test to verify it passes**

Run: `npx vitest run packages/create-slot/test/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the new `genNormalize`**

```ts
// packages/create-slot/test/normalize.test.ts
import { describe, it, expect } from 'vitest';
import { genNormalize } from '../src/codegen/normalize';

describe('genNormalize', () => {
  const s = genNormalize({ id: 'g', title: 'G', mechanic: 'cluster', grid: { cols: 7, rows: 7 }, stake: true, cascades: true });
  it('coerces via the schema array fields and never uses `?? []` on an array', () => {
    expect(s).toContain("import { deriveArrayFields, coerceLuaArrays } from '@energy8platform/stake-kit'");
    expect(s).toContain("import { spinSchema, type SpinDataRaw } from './schema'");
    expect(s).toContain('deriveArrayFields(spinSchema)');
    expect(s).toContain('coerceLuaArrays(');
    expect(s).toContain('spinSchema.safeParse(');
    expect(s).not.toContain('?? []).map');             // the crash idiom must be gone
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run packages/create-slot/test/normalize.test.ts`
Expected: FAIL — current `genNormalize` still emits `?? []`.

- [ ] **Step 7: Rewrite `genNormalize`**

Replace the body of `packages/create-slot/src/codegen/normalize.ts` with:

```ts
import type { Answers } from '../answers';

/** Generate src/game/normalize.ts: game-declared SpinData + the host normalizer.
 * Coercion (Lua {} → []) is schema-driven via stake-kit's deriveArrayFields + coerceLuaArrays. */
export function genNormalize(a: Answers): string {
  const cascade = a.cascades === true;

  const dataShape = cascade
    ? `  /** Cascade steps the scene animates via CascadeController. */
  steps: CascadeStepData[];
  /** Optional running multiplier the scene reflects. */
  multiplier?: number;`
    : `  /** Result grid by column for the reel spin. */
  targetGrid: CellData[][];`;

  const mapBody = cascade
    ? `    steps: (d.cascades ?? []).map((step: any) => ({
      winningCells: step.winning ?? [],
      removedCells: step.removed ?? [],
      newCells: step.new ?? [],
      settledGrid: step.grid ?? [],
    })),
    multiplier: d.multiplier,`
    : `    targetGrid: d.matrix ?? [],`;

  return `import type { SlotSpinResultBase, SlotResultNormalizer } from '@energy8platform/platform-core/slot-result';
import type { ${cascade ? 'CascadeStepData' : 'CellData'} } from '@energy8platform/game-engine/slot';
import { deriveArrayFields, coerceLuaArrays } from '@energy8platform/stake-kit';
import { spinSchema, type SpinDataRaw } from './schema';

/** The game's typed play result. Extend with any fields your script.logic.lua returns. */
export interface SpinData extends SlotSpinResultBase {
${dataShape}
}

// Array fields are derived from the schema once (Lua empty tables {} → []), so the
// scene-facing mapping below can rely on real arrays — no \`(x ?? []).map\` crashes.
const arrayFields = deriveArrayFields(spinSchema);

/** REQUIRED: map the raw play result into SpinData. The host calls this on every play. */
export const normalize: SlotResultNormalizer<SpinData> = (raw) => {
  const r = (raw ?? {}) as { totalWin?: number; data?: unknown };
  const coerced = coerceLuaArrays((r.data ?? {}) as Record<string, unknown>, arrayFields);
  const parsed = spinSchema.safeParse(coerced);
  const d = (parsed.success ? parsed.data : coerced) as SpinDataRaw;
  return {
    totalWin: r.totalWin ?? 0,
    freeSpins: d.free_spins ? { awarded: d.free_spins.awarded, total: d.free_spins.total } : undefined,
${mapBody}
  };
};
`;
}
```

(`(d.cascades ?? []).map` here is safe — `d.cascades` is post-coercion an array or `undefined`, never `{}`; the `?? []` now only guards `undefined`. The crash came from `{}` which coercion has removed.)

- [ ] **Step 8: Run the normalize test to verify it passes**

Run: `npx vitest run packages/create-slot/test/normalize.test.ts`
Expected: PASS.

- [ ] **Step 9: Update `genStakeAdapter` to import the shared schema**

Replace `packages/create-slot/src/codegen/stakeAdapter.ts` with (returns only the adapter string now — no schema half):

```ts
import type { Answers } from '../answers';

/** Generate src/stake/adapter.ts. The spin schema is the shared src/game/schema.ts (one schema for all games). */
export function genStakeAdapter(_a: Answers): { adapter: string } {
  const adapter = `import { createGameAdapter, type SegmentCore } from '@energy8platform/stake-kit';
import { model } from '../game.spec';
import { spinSchema, type SpinDataRaw } from '../game/schema';

export const adapter = createGameAdapter<SpinDataRaw>({
  model,
  schema: spinSchema,
  segmentOf: ({ event, payload, round }) => {
    const isFs = (event as { stage?: string }).stage === 'free_spins';
    const core: SegmentCore<SpinDataRaw> = {
      action: isFs ? 'free_spin' : round.triggerAction,
      winX: payload.total_win ?? 0,
      session: { roundId: round.roundId },
    };
    const awarded = payload.free_spins?.awarded ?? 0;
    if (!isFs && awarded > 0) {
      core.bonusFreeSpin = { grantId: 1, remainingSpins: awarded };
    }
    return core;
  },
});

export default adapter;
`;
  return { adapter };
}
```

- [ ] **Step 10: Wire `generate.ts` + make `zod` universal in `packageJson.ts`**

In `packages/create-slot/src/generate.ts`:
- Add the import: `import { genSchema } from './codegen/schema';`
- After writing `src/game/normalize.ts`, write the shared schema:
  ```ts
  writeFileSync(join(targetDir, 'src/game/schema.ts'), genSchema(a));
  ```
- In the `if (a.stake)` block, write ONLY the adapter (the schema now lives in `src/game/schema.ts`):
  ```ts
  if (a.stake) {
    mkdirSync(join(targetDir, 'src/stake'), { recursive: true });
    const { adapter } = genStakeAdapter(a);
    writeFileSync(join(targetDir, 'src/stake/adapter.ts'), adapter);
  } else if (existsSync(join(targetDir, 'src/stake'))) {
    rmSync(join(targetDir, 'src/stake'), { recursive: true, force: true });
  }
  ```

In `packages/create-slot/src/codegen/packageJson.ts`, move `zod` out of the stake-only branch into the always-on `dependencies`:
```ts
    dependencies: {
      '@energy8platform/platform-core': v['platform-core'],
      '@energy8platform/game-engine': v['game-engine'],
      ...(a.stake ? { '@energy8platform/stake-kit': v['stake-kit'], '@energy8platform/stake-bridge': v['stake-bridge'] } : { '@energy8platform/stake-kit': v['stake-kit'] }),
      'pixi.js': '^8.16.0',
      zod: '^3.23.0',
    },
```
(Remove the old `...(a.stake ? { zod: '^3.23.0' } : {})` line.)

- [ ] **Step 11: Update the packageJson test for universal zod**

In `packages/create-slot/test/packageJson.test.ts`, add/adjust an assertion that `zod` is present for a NON-stake game:
```ts
it('includes zod even for non-stake games (general spin schema)', () => {
  const j = JSON.parse(genPackageJson({ id: 'g', title: 'G', mechanic: 'lines', grid: { cols: 5, rows: 3 }, stake: false, cascades: false }, V));
  expect(j.dependencies.zod).toBe('^3.23.0');
});
```
(`V` = the existing `DepVersions` fixture in that test file.)

- [ ] **Step 12: Run the create-slot suite (incl. scaffold smoke) + commit**

Run: `npm run build --workspace @energy8platform/stake-kit && npm run build --workspace @energy8platform/platform-core && npm run build --workspace @energy8platform/game-engine`
Run: `npx vitest run --root packages/create-slot`
Expected: PASS — schema/normalize/packageJson tests green; the scaffold smoke typechecks the generated `src/game/schema.ts` + schema-driven `normalize` + stake adapter against the built packages.
```bash
git add packages/create-slot/src/codegen/schema.ts packages/create-slot/src/codegen/normalize.ts \
        packages/create-slot/src/codegen/stakeAdapter.ts packages/create-slot/src/codegen/packageJson.ts \
        packages/create-slot/src/generate.ts packages/create-slot/test/schema.test.ts \
        packages/create-slot/test/normalize.test.ts packages/create-slot/test/packageJson.test.ts
git commit -m "feat(create-slot): general zod spin-schema + schema-driven {} → [] coercion in normalize (fixes the ?? [] crash)"
```

---

## Task 2: Game-owned IntroScene + host custom-scene support (#2)

**Files:**
- Modify: `packages/game-engine/src/host/types.ts`, `packages/game-engine/src/host/createSlotGame.ts`
- Create: `packages/game-engine/tests/intro-option.test.ts`, `packages/create-slot/src/codegen/introScene.ts`, `packages/create-slot/test/introScene.test.ts`
- Modify: `packages/create-slot/src/codegen/mainTs.ts`, `packages/create-slot/src/generate.ts`, `packages/create-slot/test/mainTs.test.ts` (or add one)

**Interfaces:**
- Consumes: `SceneConstructor` (from `game-engine/src/types`); `IntroSceneConfig` (existing). `createSlotGame` registers/starts the intro.
- Produces: `CreateSlotGameOptions.intro` accepts `IntroSceneConfig | { scene: SceneConstructor; data?: unknown }`; `genIntroScene(a): string` → `src/scenes/IntroScene.ts`; `main.ts` wires `intro: { scene: IntroScene }`.

- [ ] **Step 1: Write the failing host unit test**

```ts
// packages/game-engine/tests/intro-option.test.ts
import { describe, it, expect } from 'vitest';
import { resolveIntro } from '@/host/introOption';
import { Scene } from '@/core/Scene';

class MyIntro extends Scene { async onEnter() {} onExit() {} }

describe('resolveIntro', () => {
  it('class form: returns the provided scene ctor + data, marks custom', () => {
    const r = resolveIntro({ scene: MyIntro, data: { foo: 1 } });
    expect(r?.ctor).toBe(MyIntro);
    expect(r?.data).toEqual({ foo: 1 });
  });
  it('config form: returns the built-in IntroScene ctor + the config as data', () => {
    const r = resolveIntro({ title: 'Hi' });
    expect(r?.ctor.name).toBe('IntroScene');
    expect(r?.data).toEqual({ title: 'Hi' });
  });
  it('undefined: returns null', () => {
    expect(resolveIntro(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --root packages/game-engine packages/game-engine/tests/intro-option.test.ts`
Expected: FAIL — `@/host/introOption` not found.

- [ ] **Step 3: Add the `intro` union type**

In `packages/game-engine/src/host/types.ts`:
- Add `SceneConstructor` to the existing import from `../types`:
  ```ts
  import type { AudioConfig, ScaleMode, Orientation, SceneConstructor } from '../types';
  ```
  (already imported — confirm `SceneConstructor` is in the list.)
- Replace the `intro?` field:
  ```ts
  /** Intro shown before the game scene. Either a built-in IntroScene config,
   *  or a custom Scene class the game owns (the scaffold generates one). */
  intro?: import('../scenes/IntroScene').IntroSceneConfig | { scene: SceneConstructor; data?: unknown };
  ```

- [ ] **Step 4: Implement `resolveIntro`**

```ts
// packages/game-engine/src/host/introOption.ts
import type { SceneConstructor } from '../types';
import { IntroScene, type IntroSceneConfig } from '../scenes/IntroScene';

export type IntroOption = IntroSceneConfig | { scene: SceneConstructor; data?: unknown };

/** Resolve the intro option into a scene ctor + start data. null when no intro. */
export function resolveIntro(opt: IntroOption | undefined): { ctor: SceneConstructor; data: unknown } | null {
  if (!opt) return null;
  if ('scene' in opt && typeof opt.scene === 'function') return { ctor: opt.scene, data: opt.data };
  return { ctor: IntroScene as unknown as SceneConstructor, data: opt };
}
```

- [ ] **Step 5: Run the host test to verify it passes**

Run: `npx vitest run --root packages/game-engine packages/game-engine/tests/intro-option.test.ts`
Expected: PASS.

- [ ] **Step 6: Use `resolveIntro` in `createSlotGame`**

In `packages/game-engine/src/host/createSlotGame.ts`, replace the intro registration block (currently lines ~54-60):

```ts
  game.scenes.register(opts.scene.key, opts.scene.scene);
  let firstScene = opts.scene.key;
  const { resolveIntro } = await import('./introOption');
  const intro = resolveIntro(opts.intro);
  if (intro) {
    game.scenes.register('__intro__', intro.ctor);
    firstScene = '__intro__';
  }
  try {
    await game.start(
      firstScene,
      intro ? { ...(intro.data as object), onStart: () => { void game.scenes.goto(opts.scene.key); } } : undefined,
    );
  } catch (err) {
    fatal('Could not start the game.');
    throw err;
  }
```

(The built-in `IntroScene` reads `onStart` from its config; a custom scene receives `{ ...data, onStart }` and calls `onStart()` to advance.)

- [ ] **Step 7: Write the failing test for `genIntroScene`**

```ts
// packages/create-slot/test/introScene.test.ts
import { describe, it, expect } from 'vitest';
import { genIntroScene } from '../src/codegen/introScene';

describe('genIntroScene', () => {
  const s = genIntroScene({ id: 'g', title: 'My Game', mechanic: 'cluster', grid: { cols: 7, rows: 7 }, stake: true, cascades: true });
  it('is a Scene subclass that calls the injected onStart and shows the title', () => {
    expect(s).toContain("import { Scene } from '@energy8platform/game-engine/core'");
    expect(s).toContain('export class IntroScene extends Scene');
    expect(s).toContain('My Game');
    expect(s).toContain('onStart');         // calls the host-injected callback
  });
  it('imports no node: builtins (browser-safe)', () => {
    expect(s).not.toContain("from 'node:");
  });
});
```

- [ ] **Step 8: Run it to verify it fails**

Run: `npx vitest run packages/create-slot/test/introScene.test.ts`
Expected: FAIL — `genIntroScene` not found.

- [ ] **Step 9: Implement `genIntroScene`**

```ts
// packages/create-slot/src/codegen/introScene.ts
import type { Answers } from '../answers';

/** Generate src/scenes/IntroScene.ts: a real game-owned Scene subclass (edit freely).
 * The host injects onStart via scene start data; call it to advance to the game. */
export function genIntroScene(a: Answers): string {
  return `import { Container, Graphics, Text } from 'pixi.js';
import { Scene } from '@energy8platform/game-engine/core';
import { Tween } from '@energy8platform/game-engine/animation';

/** Start data the host injects (onStart advances to the game scene). */
interface IntroData { onStart?: () => void; }

/** Full intro scene for ${a.title}. Edit this freely — background, logo, buttons, animation. */
export class IntroScene extends Scene {
  private layer?: Container;

  async onEnter(data?: unknown): Promise<void> {
    const { onStart } = (data ?? {}) as IntroData;
    const layer = new Container();
    this.layer = layer;
    this.container.addChild(layer);

    // Background — replace with a texture sprite once you have art.
    const bg = new Graphics().rect(0, 0, 1920, 1080).fill({ color: 0x0b0f1a });
    layer.addChild(bg);

    const title = new Text({ text: '${a.title}', style: { fill: 0xffffff, fontSize: 110, fontFamily: 'Inter', fontWeight: '700', align: 'center' } });
    title.anchor.set(0.5); title.position.set(960, 420);
    layer.addChild(title);

    const subtitle = new Text({ text: 'Press PLAY to begin', style: { fill: 0x9fb3c8, fontSize: 34, fontFamily: 'Inter' } });
    subtitle.anchor.set(0.5); subtitle.position.set(960, 520);
    layer.addChild(subtitle);

    // PLAY button (replace with the engine UI Button or your own art).
    const btn = new Container(); btn.position.set(960, 660);
    const bgBtn = new Graphics().roundRect(-150, -45, 300, 90, 16).fill({ color: 0xffd24a });
    const label = new Text({ text: 'PLAY', style: { fill: 0x0b0f1a, fontSize: 40, fontFamily: 'Inter', fontWeight: '700' } });
    label.anchor.set(0.5);
    btn.addChild(bgBtn, label);
    btn.eventMode = 'static'; btn.cursor = 'pointer';
    btn.once('pointerdown', () => onStart?.());
    layer.addChild(btn);

    layer.alpha = 0;
    await Tween.to(layer, { alpha: 1 }, { duration: 0.4 });
  }

  onExit(): void {
    this.layer?.destroy({ children: true });
    this.layer = undefined;
  }
}
`;
}
```

- [ ] **Step 10: Run the introScene test to verify it passes**

Run: `npx vitest run packages/create-slot/test/introScene.test.ts`
Expected: PASS.

- [ ] **Step 11: Wire `mainTs.ts` + `generate.ts`**

In `packages/create-slot/src/codegen/mainTs.ts`, import the generated scene and switch the intro option to the class form:
```ts
  return `import { createSlotGame } from '@energy8platform/game-engine/host';
import { model } from './game.spec';
import { GameScene } from './GameScene';
import { IntroScene } from './scenes/IntroScene';
import { normalize } from './game/normalize';
${stakeImport}
createSlotGame({
  model,
  normalize,
  scene: { key: 'game', scene: GameScene },
  manifest: { bundles: [] },
  design: { width: 1920, height: 1080 },
  fonts: ['400 24px "Inter"'],
  textureDefaults: true,
  dev: (import.meta as any).env?.DEV ?? false,
  intro: { scene: IntroScene },
${stakeOpt}  shell: {}, // buy/ante cards + currency derive from the spec + initData
}).catch((err) => { console.error('[${a.id}] failed to start', err); });
`;
```

In `packages/create-slot/src/generate.ts`:
- Add `import { genIntroScene } from './codegen/introScene';`
- Create the dir + write the scene (after writing main.ts):
  ```ts
  mkdirSync(join(targetDir, 'src/scenes'), { recursive: true });
  writeFileSync(join(targetDir, 'src/scenes/IntroScene.ts'), genIntroScene(a));
  ```

- [ ] **Step 12: Add the main.ts wiring assertion**

In `packages/create-slot/test/mainTs.test.ts` (create if absent), assert:
```ts
import { describe, it, expect } from 'vitest';
import { genMainTs } from '../src/codegen/mainTs';
describe('genMainTs', () => {
  it('wires the generated IntroScene class as the intro', () => {
    const s = genMainTs({ id: 'g', title: 'G', mechanic: 'cluster', grid: { cols: 7, rows: 7 }, stake: false, cascades: true });
    expect(s).toContain("import { IntroScene } from './scenes/IntroScene'");
    expect(s).toContain('intro: { scene: IntroScene }');
  });
});
```

- [ ] **Step 13: Verify `Scene`/`Tween` are exported where the generated scene imports them**

Confirm `@energy8platform/game-engine/core` exports `Scene` and `@energy8platform/game-engine/animation` exports `Tween` (grep the package `core`/`animation` index). If the static-import guard in the scaffold test flags any import, adjust the generated import path to the correct sub-path. Do NOT add `node:` imports.

- [ ] **Step 14: Run game-engine + create-slot suites + commit**

Run: `npx vitest run --root packages/game-engine`
Expected: PASS (256+ incl. the new intro-option test).
Run: `npm run build --workspace @energy8platform/game-engine && npx vitest run --root packages/create-slot`
Expected: PASS — the scaffold smoke typechecks the generated `src/scenes/IntroScene.ts` + the `intro: { scene }` main.ts.
```bash
git add packages/game-engine/src/host/types.ts packages/game-engine/src/host/introOption.ts \
        packages/game-engine/src/host/createSlotGame.ts packages/game-engine/tests/intro-option.test.ts \
        packages/create-slot/src/codegen/introScene.ts packages/create-slot/src/codegen/mainTs.ts \
        packages/create-slot/src/generate.ts packages/create-slot/test/introScene.test.ts \
        packages/create-slot/test/mainTs.test.ts
git commit -m "feat(intro): game-owned IntroScene subclass + host intro accepts a custom Scene class"
```

---

## Task 3: build:stake + postbuild zip (#3 + #1)

**Files:**
- Modify: `packages/create-slot/src/codegen/packageJson.ts`, `packages/create-slot/template/vite.config.ts`
- Test: update `packages/create-slot/test/packageJson.test.ts`

**Interfaces:**
- Consumes: `Answers` (`id`, `stake`). Produces: package.json `postbuild` (all games) + `dev:stake`/`build:stake`/`stake:bundle` (stake games); the template vite config branches on `BUILD_TARGET`.

- [ ] **Step 1: Write the failing packageJson test**

```ts
// add to packages/create-slot/test/packageJson.test.ts
it('adds postbuild zip (all games) and build:stake scripts (stake games)', () => {
  const stake = JSON.parse(genPackageJson({ id: 'foo-slot', title: 'Foo', mechanic: 'cluster', grid: { cols: 7, rows: 7 }, stake: true, cascades: true }, V));
  expect(stake.scripts.postbuild).toContain('foo-slot.zip');
  expect(stake.scripts.postbuild).toContain('cd dist && zip -r');
  expect(stake.scripts['build:stake']).toBe('BUILD_TARGET=stake vite build');
  expect(stake.scripts['dev:stake']).toBe('BUILD_TARGET=stake vite');
  expect(stake.scripts['stake:bundle']).toContain('build:stake');

  const plain = JSON.parse(genPackageJson({ id: 'bar', title: 'Bar', mechanic: 'lines', grid: { cols: 5, rows: 3 }, stake: false, cascades: false }, V));
  expect(plain.scripts.postbuild).toContain('bar.zip');
  expect(plain.scripts['build:stake']).toBeUndefined();   // stake-only
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/create-slot/test/packageJson.test.ts`
Expected: FAIL — no `postbuild`/`build:stake`.

- [ ] **Step 3: Add the scripts in `genPackageJson`**

In `packages/create-slot/src/codegen/packageJson.ts`, build the scripts object so `postbuild` is always present and the stake scripts are conditional:

```ts
  const scripts: Record<string, string> = {
    dev: 'vite',
    build: 'tsc --noEmit && vite build',
    postbuild: `rm -f ${a.id}.zip && cd dist && zip -r ../${a.id}.zip .`,
    typecheck: 'tsc --noEmit',
    smoke: 'tsx smoke.ts',
    sim: 'e8-math sim --config ./math.config.ts',
    pool: 'e8-math pool --config ./math.config.ts',
    curate: 'e8-math curate --config ./math.config.ts',
    math: 'e8-math all --config ./math.config.ts',
  };
  if (a.stake) {
    scripts['dev:stake'] = 'BUILD_TARGET=stake vite';
    scripts['build:stake'] = 'BUILD_TARGET=stake vite build';
    scripts['stake:bundle'] =
      `rm -rf dist-stake stake-math ${a.id}-stake.zip stake-math.zip && npm run build:stake && npm run math && cd dist-stake && zip -r ../${a.id}-stake.zip . && cd ../stake-math && zip -r ../stake-math.zip . && cd .. && echo 'Stake artifacts: ${a.id}-stake.zip + stake-math.zip'`;
  }
```
Then use `scripts` in the `pkg` object (replace the inline `scripts: { ... }` literal with `scripts,`).

- [ ] **Step 4: Run the packageJson test to verify it passes**

Run: `npx vitest run packages/create-slot/test/packageJson.test.ts`
Expected: PASS.

- [ ] **Step 5: Branch the template vite config on `BUILD_TARGET`**

Replace `packages/create-slot/template/vite.config.ts` with:

```ts
import { defineGameConfig } from '@energy8platform/game-engine/vite';

const isStake = process.env.BUILD_TARGET === 'stake';

export default defineGameConfig({
  base: './',
  // Stake builds run inside the Stake RGS shell — no local DevBridge, separate output dir.
  devBridge: !isStake,
  devBridgeConfig: './dev.config',
  vite: {
    server: { port: 5173 },
    optimizeDeps: { include: ['pixi.js'], exclude: ['fengari'] },
    ...(isStake ? { build: { outDir: 'dist-stake' } } : {}),
  },
});
```

- [ ] **Step 6: Verify `defineGameConfig` forwards `vite.build.outDir`**

Read `packages/platform-core/src/vite` (or `game-engine/src/vite`) `defineGameConfig` to confirm it merges the `vite` block (incl. `build`) into the returned Vite config. If it does not forward `build`, set the outDir via whatever option it does expose, and adjust this step's code. (No test asserts the build output dir — the smoke only typechecks; this is verified by reading the helper.)

- [ ] **Step 7: Run the create-slot suite + commit**

Run: `npx vitest run --root packages/create-slot`
Expected: PASS — packageJson tests green; scaffold smoke still typechecks (the vite config change is config-only).
```bash
git add packages/create-slot/src/codegen/packageJson.ts packages/create-slot/template/vite.config.ts \
        packages/create-slot/test/packageJson.test.ts
git commit -m "feat(create-slot): postbuild zip + build:stake/dev:stake/stake:bundle scripts + vite BUILD_TARGET branch"
```

---

## Task 4: spec-slot proof + regression test

**Files:**
- Create: `examples/spec-slot/game/schema.ts`, `examples/spec-slot/scenes/IntroScene.ts`
- Modify: `examples/spec-slot/normalize.ts`, `examples/spec-slot/main.ts`
- Test: `examples/spec-slot/normalize.test.ts` (new — the runtime regression) OR `packages/create-slot/test/coercion-regression.test.ts`

**Interfaces:** consumes everything above. spec-slot demonstrates the schema + intro flow; the regression test proves a Lua `{}` array no longer crashes normalize.

- [ ] **Step 1: Add `examples/spec-slot/game/schema.ts`**

spec-slot is a cascade-family example (grid 3×3, cluster-ish). Mirror `genSchema(cascade=true)`:
```ts
import { z } from 'zod';

export const spinSchema = z.object({
  total_win: z.number().optional(),
  cascades: z.array(z.object({}).passthrough()).optional(),
  multiplier: z.number().optional(),
  free_spins: z.object({ awarded: z.number(), total: z.number() }).optional(),
});
export type SpinDataRaw = z.infer<typeof spinSchema>;
```
(Confirm spec-slot's directory layout — if it keeps source flat at `examples/spec-slot/`, put `schema.ts` beside `normalize.ts` and adjust the import path in Step 2 accordingly.)

- [ ] **Step 2: Rewrite `examples/spec-slot/normalize.ts` to the schema-driven form**

Match the new `genNormalize` output (cascade): import `deriveArrayFields`/`coerceLuaArrays` from `@energy8platform/stake-kit`, `spinSchema`/`SpinDataRaw` from `./game/schema` (or `./schema` per the real layout), derive `arrayFields` once, coerce `raw.data`, `safeParse`, map `steps` from `d.cascades`. (Use the exact code shape from Task 1 Step 7.)

- [ ] **Step 3: Write the runtime regression test**

```ts
// examples/spec-slot/normalize.test.ts
import { describe, it, expect } from 'vitest';
import { normalize } from './normalize';

describe('spec-slot normalize — Lua {} coercion', () => {
  it('does NOT crash when an array field arrives as an empty Lua table {}', () => {
    // fengari decodes empty Lua tables as JS {} — the old `?? []` let `{}.map` throw.
    const raw = { totalWin: 0, data: { total_win: 0, cascades: {} } };
    const out = normalize(raw as any);
    expect(out.totalWin).toBe(0);
    expect(out.steps).toEqual([]);          // {} coerced to [] → .map yields []
  });
  it('maps real cascade steps when present', () => {
    const raw = { totalWin: 5, data: { cascades: [{ winning: [1], removed: [], new: [], grid: [] }] } };
    const out = normalize(raw as any);
    expect(out.steps).toHaveLength(1);
    expect(out.steps[0].winningCells).toEqual([1]);
  });
});
```

- [ ] **Step 4: Add the spec-slot intro subclass + wire main.ts**

- Create `examples/spec-slot/scenes/IntroScene.ts` mirroring `genIntroScene` (title from spec-slot's spec, e.g. `'Spec Slot'`).
- In `examples/spec-slot/main.ts`, import it and pass `intro: { scene: IntroScene }` (replace the existing `intro: { title: ... }` config if present).

- [ ] **Step 5: Determine which vitest project runs the spec-slot test**

spec-slot is under `examples/`. Confirm whether a vitest config includes `examples/spec-slot/*.test.ts`. If not, place the regression test where it runs — e.g. `packages/create-slot/test/coercion-regression.test.ts` importing the coercion mechanism directly:
```ts
import { describe, it, expect } from 'vitest';
import { deriveArrayFields, coerceLuaArrays } from '@energy8platform/stake-kit';
import { z } from 'zod';
const schema = z.object({ cascades: z.array(z.object({}).passthrough()).optional() });
describe('schema-driven Lua {} coercion', () => {
  it('turns a nested {} array field into []', () => {
    const fields = deriveArrayFields(schema);
    const out = coerceLuaArrays({ data: { cascades: {} } } as any, fields) as any;
    expect(out.data.cascades).toEqual([]);
  });
});
```
(Keep BOTH if spec-slot tests run; otherwise this mechanism test is the portable regression.)

- [ ] **Step 6: Verify spec-slot typecheck + run the suites**

Run: `npm run build --workspace @energy8platform/stake-kit && npm run build --workspace @energy8platform/platform-core && npm run build --workspace @energy8platform/game-engine`
Run: `cd examples/spec-slot && npx tsc --noEmit && cd ../..`
Expected: clean (schema + schema-driven normalize + intro subclass typecheck).
Run: `npx vitest run --root packages/create-slot` and (if spec-slot tests run) the spec-slot regression.
Expected: PASS — the `{}`-array regression proves the crash is gone.

- [ ] **Step 7: Commit**

```bash
git add examples/spec-slot/
git commit -m "docs(examples): spec-slot adopts the general spin-schema + IntroScene subclass; {} coercion regression test"
```

---

## Self-Review

**1. Spec coverage:**
- Piece 1 (postbuild) → Task 3. Piece 2 (build:stake) → Task 3. Piece 3 (intro) → Task 2. Piece 4 (general schema/coercion) → Task 1. Proof → Task 4. ✓
- Global constraint "reuse deriveArrayFields + coerceLuaArrays, no stake-kit change" → Task 1 imports them, no stake-kit file touched. ✓
- "zod universal" → Task 1 Step 10/11. "free_spins nested {awarded,total}" → Task 1 Steps 3/9. "intro additive" → Task 2 Step 3 (union) keeps the config branch. ✓

**2. Placeholder scan:** Task 4 Steps 1/2/5 say "confirm the real layout / which project runs the test" — these are genuine verification steps (spec-slot's exact on-disk layout must be checked at execution), each with concrete fallback code, not deferred work. Task 2 Step 13 + Task 3 Step 6 are verify-the-export steps with explicit fallback instructions. No code step is left as prose-only.

**3. Type consistency:** `spinSchema`/`SpinDataRaw` (Task 1) are imported identically in normalize + stakeAdapter + spec-slot. `resolveIntro`/`IntroOption` (Task 2) match the `intro` union in `types.ts`. `genStakeAdapter` now returns `{ adapter }` only — `generate.ts` (Task 1 Step 10) destructures `{ adapter }` accordingly (was `{ adapter, schema }`). ✓
