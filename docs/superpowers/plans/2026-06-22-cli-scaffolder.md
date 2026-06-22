# CLI Scaffolder + Host Shell Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (Phase A) make `createSlotGame` stand up the platform shell — control bar, balance/bet/win sync, event routing to the scene, and the Stake-replay loop; (Phase B) ship `@energy8platform/create-slot` so `npm create @energy8platform/slot` generates a playable thin game over the 4 packages.

**Architecture:** Phase A extends `packages/game-engine/src/host` with two pure helpers (`buildShellConfig`, `resolveReplayBonusId`) and a thin shell-wiring block in the `createSlotGame` orchestrator; the scene implements a small `SlotSceneController` duck-typed contract. Phase B is a new in-repo workspace `packages/create-slot` with a `bin` CLI: prompts/flags → answers → `generate()` (copy `template/` with `${VAR}` substitution + programmatic codegen of spec-derived files). Anti-drift is a CI smoke test that scaffolds into a temp dir and typechecks against the local packages.

**Tech Stack:** TypeScript, Vitest 2.x (node), Rollup (host bundle already wired), Node `fs`/`path` for the CLI, npm `create-*` bin convention. Consumes `@energy8platform/platform-core/shell` (`createGameShell`, `ShellConfig`, `ShellEvents`, `BonusOption`, `ReplayModalOptions`), `game-spec`, `stake-kit`, `game-engine/slot`.

## Global Constraints

- Phase A lives in `packages/game-engine/src/host/`; renderer-free unit tests for the pure helpers only. The shell wiring inside `createSlotGame` (which boots Pixi + DOM shell) is NOT unit-tested — verified by typecheck + spec-slot.
- `createGameShell(config: ShellConfig): GameShell` — `GameShell extends EventEmitter<ShellEvents>` with `setBalance(n)`, `setBet(n)`, `setWin(n)`, `setMode(m)`, `openReplay(opts)`, `destroy()`. Events: `spin: void`, `betChange: number`, `buyBonusSelect: { id: string }` (+ others not wired here).
- `ReplayModalOptions = { bonusId: string; bet: number; payoutMultiplier: number; onReplay: () => void|Promise<void> }`. The shell reopens the modal after `onReplay` resolves.
- The scene instance after start is `game.scenes.current?.scene`. The scene reads the session via `(this.__engineApp as GameApplication).platformSession` (the engine injects `__engineApp`). `platformSession.play(params)` + `platformSession.on('balanceUpdate', cb)`.
- `SlotSceneController` is duck-typed: host calls `scene.spin?.(bet)` etc.; if absent, the event is a no-op (shell still mounts).
- Phase B: `packages/create-slot` is a new workspace (`workspaces: ["packages/*","examples/*"]`); `bin` → `create-slot`. The `template/` dir holds FIXED files copied with `${id}`/`${title}` substitution; codegen writes spec-derived files programmatically.
- Minimal CLI questions: `id` (kebab, required), `title` (default Title-case of id), `mechanic` (`cascade`|`lines`|`ways`, default `cascade`), `grid` (default `6x6` cascade / `5x3` lines), `stake` (yes/no, default yes). All have flags (`--id`, `--title`, `--mechanic`, `--grid`, `--stake`/`--no-stake`, `--yes`). Everything else uses sensible defaults in the generated `game.spec.ts`.
- gameDefinition strategy: exported from spec via `exportGame` (no hand-authored gameDefinition file in generated games).
- Anti-drift smoke: `generate()` into a temp dir, rewrite the 4 `@energy8platform/*` deps to `file:` paths at the local package dirs, then `tsc --noEmit` the generated game (its node smoke too). Built `dist/` of the packages must exist first.
- Tests renderer-free; codegen + helpers are pure/string-producing → fully node-testable.
- Commit after each task. Branch: `feat/game-spec-define-game` (continuing).

## File Structure

```
packages/game-engine/src/host/
  shellConfig.ts        buildShellConfig (pure) + SlotShellOptions
  replay.ts             resolveReplayBonusId (pure)
  sceneController.ts    SlotSceneController interface
  types.ts              + shell?: SlotShellOptions on CreateSlotGameOptions; + shell on SlotGameHandle
  createSlotGame.ts     + shell wiring block (normal + replay)
packages/game-engine/tests/host/
  shellConfig.test.ts replay.test.ts
packages/create-slot/
  package.json rollup.config.ts tsconfig.json vitest.config.ts
  src/{cli.ts,prompts.ts,answers.ts,generate.ts}
  src/codegen/{gameSpec.ts,packageJson.ts,gameScene.ts,luaLogic.ts,stakeAdapter.ts,mainTs.ts}
  template/{vite.config.ts,index.html,tsconfig.json,_gitignore,dev.config.ts,README.md,
            src/theme.ts,src/slot/symbols.ts,public/assets/*/NAMING.md}
  test/{answers.test.ts,gameSpec.test.ts,packageJson.test.ts,gameScene.test.ts,
        luaLogic.test.ts,stakeAdapter.test.ts,scaffold.test.ts}
examples/spec-slot/
  main.ts GameScene.ts   (updated: shell config + SlotSceneController)
```

---

## Phase A — host shell integration

### Task A1: `SlotShellOptions` + `buildShellConfig` (pure)

**Files:**
- Create: `packages/game-engine/src/host/shellConfig.ts`
- Modify: `packages/game-engine/src/host/types.ts` (add `shell?`, `SlotSceneController` re-type later), `src/host/index.ts` (export)
- Test: `packages/game-engine/tests/host/shellConfig.test.ts`

**Interfaces:**
- Produces: `SlotShellOptions`, `buildShellConfig(opts, model, balance, mode): ShellConfig`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/game-engine/tests/host/shellConfig.test.ts
import { describe, it, expect } from 'vitest';
import { buildShellConfig } from '../../src/host/shellConfig';
import type { GameModel } from '@energy8platform/platform-core/game-spec';

const model = { spec: { betLevels: [0.1, 1, 5], defaultBet: 1 } } as unknown as GameModel;
const mount = {} as HTMLElement;

describe('buildShellConfig', () => {
  it('maps model bet levels + balance + mode into a ShellConfig', () => {
    const c = buildShellConfig(
      { mount, currency: { code: 'EUR' } as any, gameInfo: { sections: [] } as any },
      model, 1000, 'base',
    );
    expect(c.availableBets).toEqual([0.1, 1, 5]);
    expect(c.defaultBet).toBe(1);
    expect(c.balance).toBe(1000);
    expect(c.win).toBe(0);
    expect(c.mode).toBe('base');
    expect(c.mount).toBe(mount);
  });
  it('passes buyBonus options through to features', () => {
    const buyBonus = [{ id: 'buy_bonus', title: 'BUY', description: '', priceMultiplier: 50 }];
    const c = buildShellConfig(
      { mount, currency: { code: 'EUR' } as any, gameInfo: { sections: [] } as any, buyBonus: buyBonus as any },
      model, 0, 'replay',
    );
    expect(c.mode).toBe('replay');
    expect(c.features.buyBonus).toEqual(buyBonus);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/game-engine/tests/host/shellConfig.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `shellConfig.ts`**

```ts
// packages/game-engine/src/host/shellConfig.ts
import type {
  ShellConfig, ShellMode, CurrencyConfig, GameInfoContent, BonusOption, ShellFeatures,
} from '@energy8platform/platform-core/shell';
import type { GameModel } from '@energy8platform/platform-core/game-spec';
import type { WinTier } from '../slot';

export interface SlotShellOptions {
  mount?: HTMLElement;
  currency: CurrencyConfig;
  gameInfo: GameInfoContent;
  buyBonus?: BonusOption[];
  tiers?: WinTier[];
  features?: Partial<ShellFeatures>;
}

/** Pure: assemble a ShellConfig from the model + runtime balance + mode. */
export function buildShellConfig(
  opts: SlotShellOptions,
  model: GameModel,
  balance: number,
  mode: ShellMode,
): ShellConfig {
  const betLevels = model.spec.betLevels;
  const defaultBet = model.spec.defaultBet ?? betLevels[0];
  return {
    mount: opts.mount ?? (typeof document !== 'undefined' ? document.body : (undefined as never)),
    language: 'en',
    currency: opts.currency,
    gameInfo: opts.gameInfo,
    availableBets: [...betLevels],
    defaultBet,
    currentBet: defaultBet,
    balance,
    win: 0,
    mode,
    features: {
      turbo: 0,
      spacebar: true,
      autoplay: {},
      ...(opts.buyBonus ? { buyBonus: opts.buyBonus } : {}),
      ...(opts.features ?? {}),
    } as ShellFeatures,
  };
}
```

- [ ] **Step 4: Export + run test**

In `packages/game-engine/src/host/index.ts` append:
```ts
export { buildShellConfig } from './shellConfig';
export type { SlotShellOptions } from './shellConfig';
```
Run: `npx vitest run packages/game-engine/tests/host/shellConfig.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/game-engine/src/host/shellConfig.ts packages/game-engine/src/host/index.ts \
        packages/game-engine/tests/host/shellConfig.test.ts
git commit -m "feat(game-engine): buildShellConfig (pure ShellConfig assembly)"
```

---

### Task A2: `resolveReplayBonusId` (pure) + `SlotSceneController`

**Files:**
- Create: `packages/game-engine/src/host/replay.ts`, `packages/game-engine/src/host/sceneController.ts`
- Modify: `src/host/index.ts` (export)
- Test: `packages/game-engine/tests/host/replay.test.ts`

**Interfaces:**
- Produces: `resolveReplayBonusId(model, stakeMode): string`; `SlotSceneController` interface.

- [ ] **Step 1: Write the failing test**

```ts
// packages/game-engine/tests/host/replay.test.ts
import { describe, it, expect } from 'vitest';
import { resolveReplayBonusId } from '../../src/host/replay';
import type { GameModel } from '@energy8platform/platform-core/game-spec';

const model = { modeMap: { spin: 'BASE', buy_bonus: 'BONUS' } } as unknown as GameModel;

describe('resolveReplayBonusId', () => {
  it('reverses modeMap (Stake mode → action key)', () => {
    expect(resolveReplayBonusId(model, 'BONUS')).toBe('buy_bonus');
  });
  it('returns the base action id for the base mode', () => {
    expect(resolveReplayBonusId(model, 'BASE')).toBe('spin');
  });
  it('falls back to the raw mode string when unmapped', () => {
    expect(resolveReplayBonusId(model, 'WAT')).toBe('WAT');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/game-engine/tests/host/replay.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `replay.ts` + `sceneController.ts`**

```ts
// packages/game-engine/src/host/replay.ts
import type { GameModel } from '@energy8platform/platform-core/game-spec';

/** Reverse the model's modeMap (Stake bet mode → SDK action key) for replay labelling/cost. */
export function resolveReplayBonusId(model: GameModel, stakeMode: string): string {
  for (const [action, mode] of Object.entries(model.modeMap)) {
    if (mode === stakeMode) return action;
  }
  return stakeMode;
}
```

```ts
// packages/game-engine/src/host/sceneController.ts
/** Thin contract a slot scene implements; the host calls it on shell events. Duck-typed. */
export interface SlotSceneController {
  spin(bet: number): Promise<void>;
  setBet(bet: number): void;
  buyBonus?(actionId: string, bet: number): Promise<void>;
}
```

- [ ] **Step 4: Export + run test**

In `src/host/index.ts` append:
```ts
export { resolveReplayBonusId } from './replay';
export type { SlotSceneController } from './sceneController';
```
Run: `npx vitest run packages/game-engine/tests/host/replay.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/game-engine/src/host/replay.ts packages/game-engine/src/host/sceneController.ts \
        packages/game-engine/src/host/index.ts packages/game-engine/tests/host/replay.test.ts
git commit -m "feat(game-engine): resolveReplayBonusId + SlotSceneController contract"
```

---

### Task A3: wire the shell into `createSlotGame` (normal + replay)

**Files:**
- Modify: `packages/game-engine/src/host/types.ts` (`CreateSlotGameOptions.shell?`, `SlotGameHandle.shell`), `packages/game-engine/src/host/createSlotGame.ts`
- No new unit test (Pixi + DOM shell). Verified by typecheck + Task A4 spec-slot.

**Interfaces:**
- Consumes: `buildShellConfig` (A1), `resolveReplayBonusId` + `SlotSceneController` (A2); `createGameShell` from `@energy8platform/platform-core/shell`.
- Produces: `createSlotGame` mounts the shell when `opts.shell` is set; `handle.shell: GameShell | null`.

- [ ] **Step 1: Extend `types.ts`**

In `packages/game-engine/src/host/types.ts`:
- import: `import type { SlotShellOptions } from './shellConfig';` and `import type { GameShell } from '@energy8platform/platform-core/shell';`
- add to `CreateSlotGameOptions`: `shell?: SlotShellOptions;`
- change `SlotGameHandle`: add `shell: GameShell | null;`

- [ ] **Step 2: Add the shell-wiring block to `createSlotGame.ts`**

After `await game.start(opts.scene.key);` (and before `return`), insert:
```ts
  let shell: SlotGameHandle['shell'] = null;
  if (opts.shell) {
    const { createGameShell } = await import('@energy8platform/platform-core/shell');
    const { buildShellConfig } = await import('./shellConfig');
    const { resolveReplayBonusId } = await import('./replay');

    const ps = game.platformSession;
    const balance = (game.initData?.balance?.amount as number | undefined) ?? 0;
    const isReplay = !!(stakeBridge && (stakeBridge as { isReplay?: boolean }).isReplay);
    const mode = isReplay ? 'replay' : 'base';
    shell = createGameShell(buildShellConfig(opts.shell, opts.model, balance, mode));

    // live balance sync
    ps?.on('balanceUpdate', (d: { amount: number }) => shell!.setBalance(d.amount));

    const sceneInst = game.scenes.current?.scene as Partial<import('./sceneController').SlotSceneController> | undefined;
    let currentBet = opts.model.spec.defaultBet ?? opts.model.spec.betLevels[0];

    if (mode === 'base') {
      shell.on('spin', () => { void sceneInst?.spin?.(currentBet); });
      shell.on('betChange', (bet: number) => { currentBet = bet; sceneInst?.setBet?.(bet); });
      shell.on('buyBonusSelect', ({ id }: { id: string }) => { void sceneInst?.buyBonus?.(id, currentBet); });
    } else {
      const stakeMode = (stakeBridge as { url?: { replay?: { mode?: string } } }).url?.replay?.mode ?? 'BASE';
      const bonusId = resolveReplayBonusId(opts.model, stakeMode);
      const openLoop = () => {
        shell!.openReplay({
          bonusId,
          bet: currentBet,
          payoutMultiplier: 0,
          onReplay: async () => { await sceneInst?.spin?.(currentBet); openLoop(); },
        });
      };
      openLoop();
    }
  }

  return { game, stakeBridge, shell };
```
Also update the existing two `return { game, stakeBridge };` is replaced by the single `return { game, stakeBridge, shell };` above; ensure the early `bootGuard`/error paths still compile (they throw, not return a handle).

- [ ] **Step 3: Build + typecheck (no unit test — Pixi/DOM)**

Run: `npm run build --workspace @energy8platform/platform-core && npm run build --workspace @energy8platform/game-engine`
Expected: game-engine builds; `dist/host.*` emitted; no unresolved shell import (it's a lazy import; add `@energy8platform/platform-core/shell` to game-engine rollup `external` if a warning appears — it likely already is via platform-core entries).
Run: `npm run typecheck --workspace @energy8platform/game-engine`
Expected: clean (the shell wiring typechecks against ShellEvents/GameShell).
Run: `npx vitest run packages/game-engine/tests/host/`
Expected: A1+A2 host tests still pass (no regression).

- [ ] **Step 4: Commit**

```bash
git add packages/game-engine/src/host/types.ts packages/game-engine/src/host/createSlotGame.ts
git commit -m "feat(game-engine): createSlotGame mounts shell + Stake-replay loop"
```

---

### Task A4: prove Phase A in spec-slot

**Files:**
- Modify: `examples/spec-slot/GameScene.ts` (implement `SlotSceneController`), `examples/spec-slot/main.ts` (pass `shell` config)

**Interfaces:**
- Consumes: `createSlotGame` shell option, `SlotSceneController`, `ReelGrid`/`CascadeController`/`BigWinOverlay` (slice 4).

- [ ] **Step 1: Update `GameScene.ts` to implement the controller + spin loop**

```ts
// examples/spec-slot/GameScene.ts
import { Scene } from '@energy8platform/game-engine/core';
import { ReelGrid, BigWinOverlay } from '@energy8platform/game-engine/slot';
import type { SlotSceneController } from '@energy8platform/game-engine/host';
import { model } from './game.spec';
import { resolveSymbol } from './slot/symbols';

export class GameScene extends Scene implements SlotSceneController {
  private grid!: ReelGrid;
  private overlay!: BigWinOverlay;
  private bet = model.spec.defaultBet ?? model.spec.betLevels[0];

  async onEnter(): Promise<void> {
    const { cols, rows } = model.spec.grid;
    this.grid = new ReelGrid({ cols, rows, cellSize: 96, gap: 6, resolve: resolveSymbol });
    this.container.addChild(this.grid);
    this.overlay = new BigWinOverlay({
      tiers: [{ id: 'big', minMultiplier: 10, title: 'BIG WIN', accentColor: 0xffd24a }],
      formatMoney: (v) => `€${v.toFixed(2)}`,
      width: 1920, height: 1080,
    });
    this.container.addChild(this.overlay);
  }

  setBet(bet: number): void { this.bet = bet; }

  async spin(bet: number): Promise<void> {
    const ps = (this as unknown as { __engineApp?: { platformSession?: { play(p: unknown): Promise<{ totalWin: number }> } } }).__engineApp?.platformSession;
    if (!ps) return;
    const result = await ps.play({ action: 'spin', bet });
    if (result.totalWin > 0) await this.overlay.show(result.totalWin, bet);
  }
}
```

- [ ] **Step 2: Update `main.ts` to pass shell config**

```ts
// examples/spec-slot/main.ts
import { createSlotGame } from '@energy8platform/game-engine/host';
import { model } from './game.spec';
import { GameScene } from './GameScene';

createSlotGame({
  model,
  scene: { key: 'game', scene: GameScene },
  manifest: { bundles: [] },
  design: { width: 1920, height: 1080 },
  fonts: ['400 24px "Inter"'],
  textureDefaults: true,
  dev: (import.meta as any).env?.DEV ?? false,
  shell: {
    currency: { code: 'EUR' } as any,
    gameInfo: { sections: [] } as any,
    buyBonus: [{ id: 'buy_bonus', title: 'BUY BONUS', description: 'Buy the feature', priceMultiplier: 50 }],
  },
}).catch((err) => { console.error('[spec-slot] failed to start', err); });
```

- [ ] **Step 3: Build deps + typecheck the example + smoke**

Run: `npm run build --workspace @energy8platform/platform-core && npm run build --workspace @energy8platform/game-engine`
Run: `cd examples/spec-slot && npx tsc --noEmit && cd ../..`
Expected: passes — proving the shell option + `SlotSceneController` compose against the real types. If `CurrencyConfig`/`GameInfoContent` require more fields than the `as any` stubs supply, fill in the minimal real fields (read `platform-core/src/shell/types.ts`) rather than leaving `as any` — report what was needed.
Run: `npm run smoke --workspace spec-slot-example`
Expected: `SMOKE PASS` (node path unchanged).

- [ ] **Step 4: Commit**

```bash
git add examples/spec-slot/GameScene.ts examples/spec-slot/main.ts
git commit -m "docs(examples): spec-slot wires the shell via SlotSceneController"
```

---

## Phase B — `@energy8platform/create-slot`

### Task B1: package scaffold + `answers` + `prompts`/flags

**Files:**
- Create: `packages/create-slot/package.json`, `rollup.config.ts`, `tsconfig.json`, `vitest.config.ts`
- Create: `packages/create-slot/src/answers.ts`, `packages/create-slot/src/prompts.ts`
- Test: `packages/create-slot/test/answers.test.ts`

**Interfaces:**
- Produces: `Answers`, `DEFAULTS`, `parseFlags(argv): Partial<Answers>`, `applyDefaults(partial): Answers`, `validate(answers): void`.

- [ ] **Step 1: Scaffold the package config** (mirror `packages/stake-kit`; CLI uses Node built-ins only)

`packages/create-slot/package.json`:
```json
{
  "name": "@energy8platform/create-slot",
  "version": "0.1.0",
  "type": "module",
  "bin": { "create-slot": "dist/cli.js" },
  "files": ["dist", "template"],
  "scripts": {
    "build": "rollup -c rollup.config.ts --configPlugin @rollup/plugin-typescript",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@rollup/plugin-typescript": "^12.1.0",
    "@types/node": "^20.0.0",
    "rollup": "^4.24.0",
    "tslib": "^2.8.0",
    "typescript": "^5.6.0",
    "vitest": "^2.0.0"
  }
}
```
`tsconfig.json` (mirror stake-kit), `vitest.config.ts` (`include: ['test/**/*.test.ts']`), `rollup.config.ts` (single `src/cli.ts` ESM entry → `dist/cli.js` with a `#!/usr/bin/env node` banner via `output.banner: '#!/usr/bin/env node'`; externalize `node:*`).

- [ ] **Step 2: Write the failing test**

```ts
// packages/create-slot/test/answers.test.ts
import { describe, it, expect } from 'vitest';
import { parseFlags, applyDefaults, validate } from '../src/answers';

describe('parseFlags', () => {
  it('parses id/mechanic/grid + --no-stake', () => {
    const a = parseFlags(['--id', 'moon-spice', '--mechanic', 'cascade', '--grid', '6x6', '--no-stake']);
    expect(a).toEqual({ id: 'moon-spice', mechanic: 'cascade', grid: { cols: 6, rows: 6 }, stake: false });
  });
});

describe('applyDefaults', () => {
  it('fills title (Title-case), default grid for mechanic, stake=true', () => {
    const a = applyDefaults({ id: 'moon-spice', mechanic: 'cascade' });
    expect(a.title).toBe('Moon Spice');
    expect(a.grid).toEqual({ cols: 6, rows: 6 });
    expect(a.stake).toBe(true);
  });
  it('lines mechanic defaults to a 5x3 grid', () => {
    expect(applyDefaults({ id: 'g', mechanic: 'lines' }).grid).toEqual({ cols: 5, rows: 3 });
  });
});

describe('validate', () => {
  it('rejects a non-kebab id', () => {
    expect(() => validate(applyDefaults({ id: 'Moon Spice', mechanic: 'cascade' }))).toThrow(/id/);
  });
  it('rejects a bad mechanic', () => {
    expect(() => validate({ ...applyDefaults({ id: 'g' }), mechanic: 'plinko' as any })).toThrow(/mechanic/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run packages/create-slot/test/answers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write `answers.ts`**

```ts
// packages/create-slot/src/answers.ts
export type Mechanic = 'cascade' | 'lines' | 'ways';
export interface Answers {
  id: string;
  title: string;
  mechanic: Mechanic;
  grid: { cols: number; rows: number };
  stake: boolean;
}

const DEFAULT_GRID: Record<Mechanic, { cols: number; rows: number }> = {
  cascade: { cols: 6, rows: 6 },
  lines: { cols: 5, rows: 3 },
  ways: { cols: 5, rows: 3 },
};

function titleCase(id: string): string {
  return id.split(/[-_]/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

export function parseFlags(argv: string[]): Partial<Answers> {
  const out: Partial<Answers> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--id') out.id = argv[++i];
    else if (a === '--title') out.title = argv[++i];
    else if (a === '--mechanic') out.mechanic = argv[++i] as Mechanic;
    else if (a === '--grid') { const [c, r] = argv[++i].split('x').map(Number); out.grid = { cols: c, rows: r }; }
    else if (a === '--stake') out.stake = true;
    else if (a === '--no-stake') out.stake = false;
  }
  return out;
}

export function applyDefaults(partial: Partial<Answers>): Answers {
  const mechanic = partial.mechanic ?? 'cascade';
  return {
    id: partial.id ?? '',
    title: partial.title ?? titleCase(partial.id ?? ''),
    mechanic,
    grid: partial.grid ?? DEFAULT_GRID[mechanic],
    stake: partial.stake ?? true,
  };
}

export function validate(a: Answers): void {
  if (!/^[a-z][a-z0-9-]*$/.test(a.id)) throw new Error(`invalid id (must be kebab-case): "${a.id}"`);
  if (!['cascade', 'lines', 'ways'].includes(a.mechanic)) throw new Error(`invalid mechanic: "${a.mechanic}"`);
  if (a.grid.cols <= 0 || a.grid.rows <= 0) throw new Error('grid dimensions must be > 0');
}
```

- [ ] **Step 5: Write `prompts.ts` (interactive fallback, Node readline)**

```ts
// packages/create-slot/src/prompts.ts
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { applyDefaults, type Answers, type Mechanic } from './answers';

/** Ask the 5 questions interactively, applying defaults for blank answers. */
export async function prompt(seed: Partial<Answers>): Promise<Answers> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const id = seed.id ?? (await rl.question('Game id (kebab-case): ')).trim();
    const title = seed.title ?? (await rl.question(`Title [${applyDefaults({ id }).title}]: `)).trim() || undefined;
    const mechanic = (seed.mechanic ?? ((await rl.question('Mechanic (cascade|lines|ways) [cascade]: ')).trim() || 'cascade')) as Mechanic;
    const gridStr = (await rl.question('Grid colsxrows [default for mechanic]: ')).trim();
    const grid = seed.grid ?? (gridStr ? { cols: Number(gridStr.split('x')[0]), rows: Number(gridStr.split('x')[1]) } : undefined);
    const stakeAns = seed.stake ?? ((await rl.question('Stake integration? (Y/n): ')).trim().toLowerCase() !== 'n');
    return applyDefaults({ id, title, mechanic, grid, stake: stakeAns });
  } finally {
    rl.close();
  }
}
```

- [ ] **Step 6: Install the workspace + run tests + typecheck**

Run: `npm install` (links the new workspace).
Run: `npx vitest run packages/create-slot/test/answers.test.ts`
Expected: PASS.
Run: `npm run typecheck --workspace @energy8platform/create-slot`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/create-slot/package.json packages/create-slot/rollup.config.ts packages/create-slot/tsconfig.json \
        packages/create-slot/vitest.config.ts packages/create-slot/src/answers.ts packages/create-slot/src/prompts.ts \
        packages/create-slot/test/answers.test.ts package-lock.json
git commit -m "feat(create-slot): package scaffold + answers + prompts"
```

---

### Task B2: codegen `gameSpec` + `packageJson`

**Files:**
- Create: `packages/create-slot/src/codegen/gameSpec.ts`, `packages/create-slot/src/codegen/packageJson.ts`
- Test: `packages/create-slot/test/gameSpec.test.ts`, `packages/create-slot/test/packageJson.test.ts`

**Interfaces:**
- Produces: `genGameSpec(answers): string`, `genPackageJson(answers, versions): string`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/create-slot/test/gameSpec.test.ts
import { describe, it, expect } from 'vitest';
import { genGameSpec } from '../src/codegen/gameSpec';

describe('genGameSpec', () => {
  const src = genGameSpec({ id: 'moon-spice', title: 'Moon Spice', mechanic: 'cascade', grid: { cols: 6, rows: 6 }, stake: true });
  it("emits the spec id and grid from answers", () => {
    expect(src).toContain("id: 'moon-spice'");
    expect(src).toContain('grid: { cols: 6, rows: 6 }');
  });
  it('includes a default symbol set + base/free/buy actions + exports model', () => {
    expect(src).toContain("kind: 'wild'");
    expect(src).toContain("kind: 'scatter'");
    expect(src).toContain("spin: { role: 'base' }");
    expect(src).toContain("free_spin: { role: 'free' }");
    expect(src).toContain('export const model = defineGame(spec)');
  });
});
```

```ts
// packages/create-slot/test/packageJson.test.ts
import { describe, it, expect } from 'vitest';
import { genPackageJson } from '../src/codegen/packageJson';

describe('genPackageJson', () => {
  const json = JSON.parse(genPackageJson(
    { id: 'moon-spice', title: 'Moon Spice', mechanic: 'cascade', grid: { cols: 6, rows: 6 }, stake: true },
    { 'platform-core': '^0.24.4', 'game-engine': '^0.17.0', 'stake-kit': '^0.1.0', 'stake-bridge': '^0.2.1' },
  ));
  it('names the package from the id and pins the 4 deps', () => {
    expect(json.name).toBe('moon-spice');
    expect(json.dependencies['@energy8platform/platform-core']).toBe('^0.24.4');
    expect(json.dependencies['@energy8platform/game-engine']).toBe('^0.17.0');
    expect(json.dependencies['@energy8platform/stake-kit']).toBe('^0.1.0');
  });
  it('has dev/build/typecheck/smoke scripts', () => {
    expect(json.scripts.dev).toBe('vite');
    expect(json.scripts.build).toContain('vite build');
    expect(json.scripts.typecheck).toBe('tsc --noEmit');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/create-slot/test/gameSpec.test.ts packages/create-slot/test/packageJson.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `gameSpec.ts`**

```ts
// packages/create-slot/src/codegen/gameSpec.ts
import type { Answers } from '../answers';

/** Emit a game.spec.ts with a sensible default symbol set + actions; author edits it. */
export function genGameSpec(a: Answers): string {
  return `import { defineGame, type GameSpec } from '@energy8platform/platform-core/game-spec';

// Single source of truth. Edit symbols / paytable / bet levels / actions to design your game.
export const spec: GameSpec = {
  id: '${a.id}',
  type: 'slot',
  grid: { cols: ${a.grid.cols}, rows: ${a.grid.rows} },
  betLevels: [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100],
  defaultBet: 1,
  maxWin: 5000,
  currency: 'EUR',
  symbols: [
    { id: 'H1', name: 'High 1', kind: 'high', pay: { 3: 10, 4: 25, 5: 100 } },
    { id: 'H2', name: 'High 2', kind: 'high', pay: { 3: 8, 4: 20, 5: 80 } },
    { id: 'H3', name: 'High 3', kind: 'high', pay: { 3: 6, 4: 15, 5: 60 } },
    { id: 'H4', name: 'High 4', kind: 'high', pay: { 3: 5, 4: 12, 5: 50 } },
    { id: 'L1', name: 'Low 1', kind: 'low', pay: { 3: 1, 4: 2, 5: 5 } },
    { id: 'L2', name: 'Low 2', kind: 'low', pay: { 3: 0.8, 4: 1.5, 5: 4 } },
    { id: 'L3', name: 'Low 3', kind: 'low', pay: { 3: 0.6, 4: 1.2, 5: 3 } },
    { id: 'L4', name: 'Low 4', kind: 'low', pay: { 3: 0.5, 4: 1, 5: 2.5 } },
    { id: 'WILD', name: 'Wild', kind: 'wild' },
    { id: 'SCATTER', name: 'Scatter', kind: 'scatter' },
  ],
  actions: {
    spin: { role: 'base' },
    free_spin: { role: 'free' },
    buy_bonus: { role: 'buy', cost: 100, feature: { spins: 10 } },
  },
};

export const model = defineGame(spec);
`;
}
```

- [ ] **Step 4: Write `packageJson.ts`**

```ts
// packages/create-slot/src/codegen/packageJson.ts
import type { Answers } from '../answers';

export interface DepVersions {
  'platform-core': string; 'game-engine': string; 'stake-kit': string; 'stake-bridge': string;
}

export function genPackageJson(a: Answers, v: DepVersions): string {
  const simulate: Record<string, string> = {};
  // one simulate:* script per non-base/free action would be derived from the spec at build;
  // emit the canonical base sim here (author adds buy modes after editing the spec).
  simulate['simulate'] = 'platform-core-simulate --config ./sim.config.ts --action spin';

  const pkg = {
    name: a.id,
    private: true,
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'tsc --noEmit && vite build',
      typecheck: 'tsc --noEmit',
      smoke: 'tsx smoke.ts',
      ...simulate,
    },
    dependencies: {
      '@energy8platform/platform-core': v['platform-core'],
      '@energy8platform/game-engine': v['game-engine'],
      ...(a.stake ? { '@energy8platform/stake-kit': v['stake-kit'], '@energy8platform/stake-bridge': v['stake-bridge'] } : { '@energy8platform/stake-kit': v['stake-kit'] }),
      'pixi.js': '^8.16.0',
      ...(a.stake ? { zod: '^3.23.0' } : {}),
    },
    devDependencies: {
      '@types/node': '^20.0.0',
      tsx: '^4.21.0',
      typescript: '^5.6.0',
      vite: '^6.0.0',
    },
  };
  return JSON.stringify(pkg, null, 2) + '\n';
}
```

- [ ] **Step 5: Run tests + commit**

Run: `npx vitest run packages/create-slot/test/gameSpec.test.ts packages/create-slot/test/packageJson.test.ts`
Expected: PASS.
```bash
git add packages/create-slot/src/codegen/gameSpec.ts packages/create-slot/src/codegen/packageJson.ts \
        packages/create-slot/test/gameSpec.test.ts packages/create-slot/test/packageJson.test.ts
git commit -m "feat(create-slot): gameSpec + packageJson codegen"
```

---

### Task B3: codegen `gameScene` (mechanic→controller) + `luaLogic`

**Files:**
- Create: `packages/create-slot/src/codegen/gameScene.ts`, `packages/create-slot/src/codegen/luaLogic.ts`
- Test: `packages/create-slot/test/gameScene.test.ts`, `packages/create-slot/test/luaLogic.test.ts`

**Interfaces:**
- Produces: `genGameScene(answers): string`, `genLuaLogic(answers): string`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/create-slot/test/gameScene.test.ts
import { describe, it, expect } from 'vitest';
import { genGameScene } from '../src/codegen/gameScene';

describe('genGameScene', () => {
  it('uses CascadeController for cascade mechanic', () => {
    const s = genGameScene({ id: 'g', title: 'G', mechanic: 'cascade', grid: { cols: 6, rows: 6 }, stake: true });
    expect(s).toContain('CascadeController');
    expect(s).not.toContain('ReelSpinController');
    expect(s).toContain('implements SlotSceneController');
    expect(s).toContain('async spin(');
  });
  it('uses ReelSpinController for lines/ways', () => {
    const s = genGameScene({ id: 'g', title: 'G', mechanic: 'lines', grid: { cols: 5, rows: 3 }, stake: true });
    expect(s).toContain('ReelSpinController');
    expect(s).not.toContain('CascadeController');
  });
});
```

```ts
// packages/create-slot/test/luaLogic.test.ts
import { describe, it, expect } from 'vitest';
import { genLuaLogic } from '../src/codegen/luaLogic';

describe('genLuaLogic', () => {
  it('cascade skeleton returns a cascades field', () => {
    const lua = genLuaLogic({ id: 'g', title: 'G', mechanic: 'cascade', grid: { cols: 6, rows: 6 }, stake: true });
    expect(lua).toContain('function execute(state)');
    expect(lua).toContain('cascades');
    expect(lua).toContain('total_win');
  });
  it('lines skeleton returns a matrix field', () => {
    const lua = genLuaLogic({ id: 'g', title: 'G', mechanic: 'lines', grid: { cols: 5, rows: 3 }, stake: true });
    expect(lua).toContain('matrix');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/create-slot/test/gameScene.test.ts packages/create-slot/test/luaLogic.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `gameScene.ts`**

```ts
// packages/create-slot/src/codegen/gameScene.ts
import type { Answers } from '../answers';

export function genGameScene(a: Answers): string {
  const cascade = a.mechanic === 'cascade';
  const ctrl = cascade ? 'CascadeController' : 'ReelSpinController';
  const runBlock = cascade
    ? `    // cascade: animate each step the Lua returned
    for (const step of (result.data.cascades ?? [])) {
      await this.controller.run({
        winningCells: step.winning ?? [], removedCells: step.removed ?? [],
        newCells: step.new ?? [], settledGrid: step.grid ?? [],
      } as any);
    }`
    : `    // lines/ways: spin the reels onto the result matrix, then present wins
    await this.controller.run({ targetGrid: (result.data.matrix ?? []) as any });`;
  return `import { Scene } from '@energy8platform/game-engine/core';
import { ReelGrid, ${ctrl}, BigWinOverlay } from '@energy8platform/game-engine/slot';
import type { SlotSceneController } from '@energy8platform/game-engine/host';
import { model } from './game.spec';
import { resolveSymbol } from './slot/symbols';

export class GameScene extends Scene implements SlotSceneController {
  private grid!: ReelGrid;
  private controller!: ${ctrl};
  private overlay!: BigWinOverlay;
  private bet = model.spec.defaultBet ?? model.spec.betLevels[0];

  async onEnter(): Promise<void> {
    const { cols, rows } = model.spec.grid;
    this.grid = new ReelGrid({ cols, rows, cellSize: 110, gap: 6, resolve: resolveSymbol });
    this.container.addChild(this.grid);
    this.controller = new ${ctrl}(this.grid);
    this.overlay = new BigWinOverlay({
      tiers: [
        { id: 'big', minMultiplier: 10, title: 'BIG WIN', accentColor: 0xffd24a },
        { id: 'mega', minMultiplier: 50, title: 'MEGA WIN', accentColor: 0x7ad7ff },
      ],
      formatMoney: (v) => v.toFixed(2),
      width: 1920, height: 1080,
    });
    this.container.addChild(this.overlay);
  }

  setBet(bet: number): void { this.bet = bet; }

  async spin(bet: number): Promise<void> {
    const ps = (this as unknown as { __engineApp?: { platformSession?: { play(p: unknown): Promise<{ totalWin: number; data: any }> } } }).__engineApp?.platformSession;
    if (!ps) return;
    const result = await ps.play({ action: 'spin', bet });
${runBlock}
    if (result.totalWin > 0) await this.overlay.show(result.totalWin, bet);
  }
}
`;
}
```

- [ ] **Step 4: Write `luaLogic.ts`**

```ts
// packages/create-slot/src/codegen/luaLogic.ts
import type { Answers } from '../answers';

export function genLuaLogic(a: Answers): string {
  const cascade = a.mechanic === 'cascade';
  const ret = cascade
    ? `  return {
    total_win = win,          -- bet-multiplier; the platform multiplies by the actual bet
    cascades = {},            -- TODO: emit cascade steps { winning, removed, new, grid }
  }`
    : `  return {
    total_win = win,          -- bet-multiplier
    matrix = grid,            -- 2D array of SYM.* ids
    wins = {},                -- TODO: emit line/way wins
  }`;
  return `-- Game logic. The spec-derived prelude (SPEC/SYMBOLS/SYM/PAYTABLE) is injected above this file.
-- Reel weights / RTP tuning live here. Implement your mechanic; return a bet-multiplier in total_win.
function execute(state)
  -- state.action ('spin' | 'free_spin' | 'buy_bonus'), state.bet, state.action_config.feature_data
  local grid = {}
  for c = 1, SPEC.cols do
    grid[c] = {}
    for r = 1, SPEC.rows do
      grid[c][r] = engine.random(1, #SYMBOLS)
    end
  end
  local win = 0   -- TODO: evaluate ${cascade ? 'cluster/cascade' : 'line/way'} wins from PAYTABLE
${ret}
end
`;
}
```

- [ ] **Step 5: Run tests + commit**

Run: `npx vitest run packages/create-slot/test/gameScene.test.ts packages/create-slot/test/luaLogic.test.ts`
Expected: PASS.
```bash
git add packages/create-slot/src/codegen/gameScene.ts packages/create-slot/src/codegen/luaLogic.ts \
        packages/create-slot/test/gameScene.test.ts packages/create-slot/test/luaLogic.test.ts
git commit -m "feat(create-slot): gameScene + luaLogic codegen (mechanic-driven)"
```

---

### Task B4: codegen `stakeAdapter` + `mainTs`

**Files:**
- Create: `packages/create-slot/src/codegen/stakeAdapter.ts`, `packages/create-slot/src/codegen/mainTs.ts`
- Test: `packages/create-slot/test/stakeAdapter.test.ts`

**Interfaces:**
- Produces: `genStakeAdapter(answers): { adapter: string; schema: string }`, `genMainTs(answers): string`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/create-slot/test/stakeAdapter.test.ts
import { describe, it, expect } from 'vitest';
import { genStakeAdapter } from '../src/codegen/stakeAdapter';
import { genMainTs } from '../src/codegen/mainTs';

const a = { id: 'g', title: 'G', mechanic: 'cascade', grid: { cols: 6, rows: 6 }, stake: true } as const;

describe('genStakeAdapter', () => {
  const { adapter, schema } = genStakeAdapter(a);
  it('builds createGameAdapter with the model + schema + segmentOf', () => {
    expect(adapter).toContain('createGameAdapter');
    expect(adapter).toContain('segmentOf');
    expect(adapter).toContain("import { model } from '../game.spec'");
  });
  it('schema is a zod object', () => {
    expect(schema).toContain("import { z } from 'zod'");
    expect(schema).toContain('z.object');
  });
});

describe('genMainTs', () => {
  it('calls createSlotGame with a shell config', () => {
    const m = genMainTs(a);
    expect(m).toContain('createSlotGame');
    expect(m).toContain('shell:');
    expect(m).toContain('buyBonus');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/create-slot/test/stakeAdapter.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `stakeAdapter.ts`**

```ts
// packages/create-slot/src/codegen/stakeAdapter.ts
import type { Answers } from '../answers';

export function genStakeAdapter(a: Answers): { adapter: string; schema: string } {
  const cascade = a.mechanic === 'cascade';
  const schema = `import { z } from 'zod';

export const spinSchema = z.object({
  total_win: z.number().optional(),
  free_spins_awarded: z.number().optional(),
  ${cascade ? 'cascades: z.array(z.object({})).optional(),' : 'matrix: z.array(z.array(z.number())).optional(),'}
});
export type SpinData = z.infer<typeof spinSchema>;
`;
  const adapter = `import { createGameAdapter, type SegmentCore } from '@energy8platform/stake-kit';
import { model } from '../game.spec';
import { spinSchema, type SpinData } from './schema';

export const adapter = createGameAdapter<SpinData>({
  model,
  schema: spinSchema,
  segmentOf: ({ event, payload, round }) => {
    const isFs = (event as { stage?: string }).stage === 'free_spins';
    const core: SegmentCore<SpinData> = {
      action: isFs ? 'free_spin' : round.triggerAction,
      winX: payload.total_win ?? 0,
      session: { roundId: round.roundId },
    };
    if (!isFs && (payload.free_spins_awarded ?? 0) > 0) {
      core.bonusFreeSpin = { grantId: 1, remainingSpins: payload.free_spins_awarded! };
    }
    return core;
  },
});

export default adapter;
`;
  return { adapter, schema };
}
```

- [ ] **Step 4: Write `mainTs.ts`**

```ts
// packages/create-slot/src/codegen/mainTs.ts
import type { Answers } from '../answers';

export function genMainTs(a: Answers): string {
  const stakeImport = a.stake ? `import adapter from './stake/adapter';\n` : '';
  const stakeOpt = a.stake ? `  stake: { adapter },\n` : '';
  return `import { createSlotGame } from '@energy8platform/game-engine/host';
import { model } from './game.spec';
import { GameScene } from './GameScene';
${stakeImport}
createSlotGame({
  model,
  scene: { key: 'game', scene: GameScene },
  manifest: { bundles: [] },
  design: { width: 1920, height: 1080 },
  fonts: ['400 24px "Inter"'],
  textureDefaults: true,
  dev: (import.meta as any).env?.DEV ?? false,
${stakeOpt}  shell: {
    currency: { code: model.spec.currency ?? 'EUR' } as any,
    gameInfo: { sections: [] } as any,
    buyBonus: [{ id: 'buy_bonus', title: 'BUY BONUS', description: 'Buy the feature', priceMultiplier: 100 }],
  },
}).catch((err) => { console.error('[${a.id}] failed to start', err); });
`;
}
```

- [ ] **Step 5: Run test + commit**

Run: `npx vitest run packages/create-slot/test/stakeAdapter.test.ts`
Expected: PASS.
```bash
git add packages/create-slot/src/codegen/stakeAdapter.ts packages/create-slot/src/codegen/mainTs.ts \
        packages/create-slot/test/stakeAdapter.test.ts
git commit -m "feat(create-slot): stakeAdapter + mainTs codegen"
```

---

### Task B5: `template/` files + `generate()` + `cli.ts`

**Files:**
- Create: `packages/create-slot/template/` files (vite.config.ts, index.html, tsconfig.json, _gitignore, dev.config.ts, README.md, src/theme.ts, src/slot/symbols.ts, public/assets/{symbols,bg,audio,vfx}/NAMING.md)
- Create: `packages/create-slot/src/generate.ts`, `packages/create-slot/src/cli.ts`
- Test: `packages/create-slot/test/generate.test.ts`

**Interfaces:**
- Consumes: all codegen (B2–B4), `applyDefaults`/`validate` (B1).
- Produces: `generate(answers, targetDir, versions): Promise<void>`; `cli.ts` entry.

- [ ] **Step 1: Write the template files** (FIXED, `${id}`/`${title}` substituted by generate)

`template/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
    <title>${title}</title>
    <style>
      html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: #0a0a12; }
      #game { position: fixed; inset: 0; }
      canvas { display: block; }
    </style>
  </head>
  <body>
    <div id="game"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`template/vite.config.ts`:
```ts
import { defineGameConfig } from '@energy8platform/game-engine/vite';

export default defineGameConfig({
  base: './',
  devBridge: true,
  devBridgeConfig: './dev.config',
  vite: { server: { port: 5173 }, optimizeDeps: { include: ['pixi.js'], exclude: ['fengari'] } },
});
```

`template/dev.config.ts`:
```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLuaScript } from '@energy8platform/platform-core/game-spec';
import { model } from './src/game.spec';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const logic = readFileSync(resolve(__dirname, 'src/game/script.logic.lua'), 'utf8');

export default {
  balance: 100000,
  currency: model.spec.currency ?? 'EUR',
  networkDelay: 80,
  debug: true,
  gameDefinition: model.gameDefinition,
  luaScript: buildLuaScript(model, logic),
  luaSeed: 12345,
};
```

`template/tsconfig.json`:
```json
{
  "extends": "@energy8platform/game-engine/tsconfig",
  "compilerOptions": { "module": "ESNext", "moduleResolution": "Bundler", "noEmit": true, "types": ["node"] },
  "include": ["src/**/*.ts"]
}
```
(If `@energy8platform/game-engine/tsconfig` is not exported, inline a standalone tsconfig — target ES2022, strict, ESNext/Bundler. Verify and use whichever resolves; report the choice.)

`template/src/theme.ts`:
```ts
export const DESIGN_W = 1920;
export const DESIGN_H = 1080;
export const COLORS = { bg: 0x0a0a12, accent: 0xffd24a };
```

`template/src/slot/symbols.ts`:
```ts
import { Texture } from 'pixi.js';
import { AnimatedSymbol, type SymbolResolver } from '@energy8platform/game-engine/slot';

// Placeholder resolver: every symbol is a blank tile. Swap in real textures from public/assets/symbols.
export const resolveSymbol: SymbolResolver = (id: string) =>
  new AnimatedSymbol({ textures: { base: id ? Texture.WHITE : Texture.EMPTY }, size: 110 });
```

`template/_gitignore`:
```
node_modules
dist
dist-stake
```

`template/README.md`:
```markdown
# ${title}

Generated with `npm create @energy8platform/slot`. Built on @energy8platform game-spec / host / stake-kit / slot.

## Develop
- `npm install`
- `npm run dev` — runs the game in a browser (Vite + in-process DevBridge running your Lua)
- Edit `src/game.spec.ts` (symbols/paytable/bet levels/actions) and `src/game/script.logic.lua` (math).
- Swap placeholder art in `public/assets/` (see NAMING.md) and wire it in `src/slot/symbols.ts`.

## Verify
- `npm run typecheck`
- `npm run smoke` — proves spec → export artifacts

See the `slot-game-creator` skill for the full mechanics → math → art → UI workflow.
```

`template/public/assets/symbols/NAMING.md` (and copies in bg/audio/vfx):
```markdown
# Asset naming
Name each symbol sprite after its spec symbol id, lowercased: `h1.webp`, `wild.webp`, `scatter.webp`.
Backgrounds: `bg-base.webp`, `bg-fs.webp`. Audio: `bgm-base.mp3`, `sfx-spin.mp3`. VFX: spritesheets per effect.
```

- [ ] **Step 2: Write the failing generate test**

```ts
// packages/create-slot/test/generate.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate } from '../src/generate';
import { applyDefaults } from '../src/answers';

let dir = '';
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

const versions = { 'platform-core': '*', 'game-engine': '*', 'stake-kit': '*', 'stake-bridge': '*' };

describe('generate', () => {
  it('writes the canonical thin-game tree with substituted + codegen files', async () => {
    dir = mkdtempSync(join(tmpdir(), 'cs-'));
    await generate(applyDefaults({ id: 'moon-spice', mechanic: 'cascade' }), dir, versions);
    expect(existsSync(join(dir, 'game.spec.ts'))).toBe(false); // spec lives under src/
    expect(readFileSync(join(dir, 'src/game.spec.ts'), 'utf8')).toContain("id: 'moon-spice'");
    expect(readFileSync(join(dir, 'index.html'), 'utf8')).toContain('<title>Moon Spice</title>');
    expect(readFileSync(join(dir, 'package.json'), 'utf8')).toContain('"name": "moon-spice"');
    expect(readFileSync(join(dir, 'src/GameScene.ts'), 'utf8')).toContain('CascadeController');
    expect(existsSync(join(dir, '.gitignore'))).toBe(true); // _gitignore renamed
    expect(existsSync(join(dir, 'src/stake/adapter.ts'))).toBe(true);
  });
  it('omits stake/ when stake=false', async () => {
    dir = mkdtempSync(join(tmpdir(), 'cs-'));
    await generate(applyDefaults({ id: 'no-stake', mechanic: 'lines', stake: false }), dir, versions);
    expect(existsSync(join(dir, 'src/stake'))).toBe(false);
    expect(readFileSync(join(dir, 'src/GameScene.ts'), 'utf8')).toContain('ReelSpinController');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run packages/create-slot/test/generate.test.ts`
Expected: FAIL — `generate` not found.

- [ ] **Step 4: Write `generate.ts`**

```ts
// packages/create-slot/src/generate.ts
import { cpSync, mkdirSync, writeFileSync, renameSync, readFileSync, readdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Answers } from './answers';
import { validate } from './answers';
import { genGameSpec } from './codegen/gameSpec';
import { genPackageJson, type DepVersions } from './codegen/packageJson';
import { genGameScene } from './codegen/gameScene';
import { genLuaLogic } from './codegen/luaLogic';
import { genStakeAdapter } from './codegen/stakeAdapter';
import { genMainTs } from './codegen/mainTs';

const TEMPLATE_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '../template');

function substituteTree(dir: string, vars: Record<string, string>): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { substituteTree(p, vars); continue; }
    let text = readFileSync(p, 'utf8');
    for (const [k, val] of Object.entries(vars)) text = text.split('${' + k + '}').join(val);
    writeFileSync(p, text);
  }
}

export async function generate(a: Answers, targetDir: string, versions: DepVersions): Promise<void> {
  validate(a);
  mkdirSync(targetDir, { recursive: true });
  // 1) copy fixed template
  cpSync(TEMPLATE_DIR, targetDir, { recursive: true });
  // _gitignore → .gitignore
  if (existsSync(join(targetDir, '_gitignore'))) renameSync(join(targetDir, '_gitignore'), join(targetDir, '.gitignore'));
  // 2) substitute ${id}/${title}
  substituteTree(targetDir, { id: a.id, title: a.title });
  // 3) codegen files
  mkdirSync(join(targetDir, 'src/game'), { recursive: true });
  writeFileSync(join(targetDir, 'src/game.spec.ts'), genGameSpec(a));
  writeFileSync(join(targetDir, 'package.json'), genPackageJson(a, versions));
  writeFileSync(join(targetDir, 'src/GameScene.ts'), genGameScene(a));
  writeFileSync(join(targetDir, 'src/main.ts'), genMainTs(a));
  writeFileSync(join(targetDir, 'src/game/script.logic.lua'), genLuaLogic(a));
  if (a.stake) {
    mkdirSync(join(targetDir, 'src/stake'), { recursive: true });
    const { adapter, schema } = genStakeAdapter(a);
    writeFileSync(join(targetDir, 'src/stake/adapter.ts'), adapter);
    writeFileSync(join(targetDir, 'src/stake/schema.ts'), schema);
  } else if (existsSync(join(targetDir, 'src/stake'))) {
    rmSync(join(targetDir, 'src/stake'), { recursive: true, force: true });
  }
}
```
Note: the template ships no `src/stake/` (codegen creates it only when `stake`), and `src/main.ts`/`src/game.spec.ts`/`src/GameScene.ts` are codegen-written (not in template). Ensure `template/src/` contains only `theme.ts` + `slot/symbols.ts`.

- [ ] **Step 5: Write `cli.ts`**

```ts
// packages/create-slot/src/cli.ts
import { argv, exit } from 'node:process';
import { resolve } from 'node:path';
import { parseFlags, applyDefaults } from './answers';
import { prompt } from './prompts';
import { generate } from './generate';

const PUBLISHED: Parameters<typeof generate>[2] = {
  'platform-core': '^0.24.4', 'game-engine': '^0.17.0', 'stake-kit': '^0.1.0', 'stake-bridge': '^0.2.1',
};

async function main(): Promise<void> {
  const flags = parseFlags(argv.slice(2));
  const target = argv.slice(2).find((a) => !a.startsWith('--') && !/^[a-z0-9.]/i.test(a) === false && a !== flags.id);
  const yes = argv.includes('--yes');
  const answers = yes || flags.id ? applyDefaults(flags) : await prompt(flags);
  const dir = resolve(process.cwd(), target ?? answers.id);
  await generate(answers, dir, PUBLISHED);
  console.log(`\n✓ Created ${answers.id} at ${dir}\n  cd ${answers.id} && npm install && npm run dev\n`);
}

main().catch((err) => { console.error(err.message); exit(1); });
```

- [ ] **Step 6: Run generate test + typecheck + commit**

Run: `npx vitest run packages/create-slot/test/generate.test.ts`
Expected: PASS.
Run: `npm run typecheck --workspace @energy8platform/create-slot`
Expected: clean.
```bash
git add packages/create-slot/template packages/create-slot/src/generate.ts packages/create-slot/src/cli.ts \
        packages/create-slot/test/generate.test.ts
git commit -m "feat(create-slot): template files + generate() + cli"
```

---

### Task B6: anti-drift scaffold-to-temp smoke

**Files:**
- Create: `packages/create-slot/test/scaffold.test.ts`

**Interfaces:**
- Consumes: `generate` (B5). Proves a scaffolded game typechecks against the LOCAL built packages.

- [ ] **Step 1: Write the smoke test**

```ts
// packages/create-slot/test/scaffold.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { generate } from '../src/generate';
import { applyDefaults } from '../src/answers';

let dir = '';
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

// Absolute paths to the local packages (built dist must exist).
const REPO = resolve(__dirname, '../../..');
const LOCAL = {
  'platform-core': 'file:' + join(REPO, 'packages/platform-core'),
  'game-engine': 'file:' + join(REPO, 'packages/game-engine'),
  'stake-kit': 'file:' + join(REPO, 'packages/stake-kit'),
  'stake-bridge': 'file:' + join(REPO, 'packages/stake-bridge'),
};

describe('scaffold anti-drift', () => {
  it('a generated game typechecks against the local packages', () => {
    dir = mkdtempSync(join(tmpdir(), 'cs-scaffold-'));
    // generate with file: deps so npm install resolves the LOCAL built packages
    // (catches drift between the template/codegen and the real package APIs)
    return generate(applyDefaults({ id: 'drift-check', mechanic: 'cascade' }), dir, LOCAL as any).then(() => {
      execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'inherit' });
      // typecheck the generated game against the local package .d.ts
      execFileSync('npx', ['tsc', '--noEmit'], { cwd: dir, stdio: 'inherit' });
      expect(readFileSync(join(dir, 'src/GameScene.ts'), 'utf8')).toContain('CascadeController');
    });
  }, 180_000);
});
```

- [ ] **Step 2: Build the local packages so their dist + types exist**

Run: `npm run build --workspace @energy8platform/platform-core && npm run build --workspace @energy8platform/stake-bridge && npm run build --workspace @energy8platform/stake-kit && npm run build --workspace @energy8platform/game-engine`
Expected: all dist present (the generated game's `tsc` resolves `@energy8platform/*` types from these).

- [ ] **Step 3: Run the smoke test**

Run: `npx vitest run packages/create-slot/test/scaffold.test.ts`
Expected: PASS — `npm install` links the file: packages and `tsc --noEmit` of the generated game is clean. If `tsc` surfaces a REAL API mismatch between the generated code and a package (not an install/types-resolution nit), STOP — that is a genuine drift finding to fix in the codegen/template, not to silence.

- [ ] **Step 4: Run the full create-slot suite + commit**

Run: `npx vitest run packages/create-slot/test/`
Expected: all create-slot tests pass (answers, gameSpec, packageJson, gameScene, luaLogic, stakeAdapter, generate, scaffold).
```bash
git add packages/create-slot/test/scaffold.test.ts
git commit -m "test(create-slot): anti-drift scaffold-to-temp typecheck smoke"
```

---

## Self-Review

**Spec coverage:**
- Phase A: `buildShellConfig` (A1), `resolveReplayBonusId` + `SlotSceneController` (A2), shell wiring + replay loop in createSlotGame (A3), spec-slot proof (A4). ✓
- Phase B: package + answers/prompts/flags (B1), gameSpec/packageJson codegen (B2), gameScene/luaLogic mechanic-driven (B3), stakeAdapter/mainTs (B4), template + generate + cli (B5), anti-drift smoke (B6). ✓
- Minimal questions (id/title/mechanic/grid/stake) + flags → answers (B1). ✓
- gameDefinition exported from spec (template dev.config uses `model.gameDefinition`/`buildLuaScript`; no hand-authored file). ✓
- Stake-replay on shell (A3 replay branch). ✓
- Anti-drift via local-package file: deps + tsc (B6). ✓
- Out-of-scope (skill integration, art, npm publish, real-game migration) → absent. ✓

**Placeholder scan:** No TBD/TODO in plan steps (the generated Lua/scene carry `// TODO` markers BY DESIGN — they're the author's fill-in points, not plan gaps). Conditional notes (tsconfig extends fallback in B5 Step 1; event-name verification) carry exact fallbacks. ✓

**Type consistency:** `Answers`/`Mechanic` (B1) consumed unchanged by all codegen (B2–B5). `SlotShellOptions`/`buildShellConfig` (A1) used by A3. `resolveReplayBonusId`/`SlotSceneController` (A2) used by A3 + the generated/spec-slot scenes. `DepVersions` (B2) used by generate/cli (B5) + smoke (B6). `generate(answers, dir, versions)` signature identical across B5 def + B6 use. ✓

**Risks flagged:**
- Exact `ShellEvents` names verified during planning (`spin`/`betChange`/`buyBonusSelect`) and used in A3.
- `stakeBridge.isReplay` / `url.replay.mode` access in A3 is defensive (cast); if the bridge surface differs, A3's typecheck/build will surface it.
- B6 smoke requires built local dist (Step 2 sequences the builds) and runs a real `npm install` (180s timeout); it's the load-bearing anti-drift gate.
- Template must NOT contain `src/main.ts`/`src/game.spec.ts`/`src/GameScene.ts` (codegen writes them) — B5 Step 4 note enforces this.
