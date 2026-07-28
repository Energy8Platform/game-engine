# Shell Menu Popover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shell's full-screen Settings overlay with a compact popover anchored to the bar's burger button, whose rows are declared as a configurable list and whose values live in shell state.

**Architecture:** The menu model and the popover geometry are pure logic in `packages/shell/src/core` (`menu.ts`, `popover.ts`) — presets expand into normalized `MenuRow`s and placement is a pure function over rectangles. The two renderers (`ui/html`, `ui/pixi`) consume the same rows and the same placement math and only draw. `ShellState` gains a `menu` value map; `ShellController` gains `setMenu` / `getMenuValue` / `setMenuValue` and toggles the popover from `openMenu()`.

**Tech Stack:** TypeScript 5.6, Rollup, Vitest 2 (jsdom for DOM suites, node + a canvas stub for Pixi suites), PixiJS v8 as an optional peer.

## Global Constraints

- Work happens in `packages/shell` unless a task says otherwise. Run its tests with
  `npm test --workspace @energy8platform/shell` — a root-level `npx vitest run <path>` reports false
  failures because each package owns its vitest config.
- Path alias inside the package: `@/*` → `packages/shell/src/*`.
- `master` volume is removed everywhere. `VolumeKey` becomes `'music' | 'sfx'`.
- Built-in menu presets are exactly: `sound`, `music`, `sfx`, `gameInfo`. The default list is
  `[sound, music, sfx, separator, gameInfo]`.
- The popover is light-dismiss: no dim, no blur backdrop, no Pixi `RenderTexture` snapshot.
- Geometry constants, shared by both renderers: `margin 8`, `gap 8`, `arrowInset 14`, `minH 120`,
  width clamped to `[220, min(320, surfaceWidth - 16)]`.
- Both renderers must render one node per resolved `MenuRow`, in the same order — `tests/pixi/parity.test.ts` asserts it.
- `src/core/locales.ts` is NOT edited. The now-unused `'Master volume'` and `'Settings'` keys stay;
  `tests/core/locales.test.ts` asserts `Settings` exists.
- Spec: `docs/superpowers/specs/2026-07-28-shell-menu-popover-design.md`.

---

### Task 1: Shared icon-name union in core

`MenuItem.icon` needs a name type that core can hold and validate. Today each renderer's generated
`icons.ts` declares `IconName = keyof typeof SVGS`, which resolves to plain `string` (the map is
typed `Record<string, string>`), and an unknown name throws inside Pixi's `iconSVG`.

**Files:**
- Create: `packages/shell/src/core/icon-names.ts` (generated)
- Modify: `packages/shell/scripts/gen-icons-from-svg.mjs` (the `emit` function + a new call)
- Modify: `packages/shell/src/ui/html/icons.ts`, `packages/shell/src/ui/pixi/icons.ts` (regenerated)
- Test: `packages/shell/tests/core/icon-names.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ICON_NAMES: readonly IconName[]` and `type IconName` from `@/core/icon-names`.
  Both `ui/html/icons.ts` and `ui/pixi/icons.ts` re-export `IconName` from there and keep their
  existing `icon(name)` / `iconSVG(name, color)` signatures.

- [ ] **Step 1: Write the failing test**

Create `packages/shell/tests/core/icon-names.test.ts`:

```ts
// @vitest-environment node
import { it, expect } from 'vitest';
import { ICON_NAMES } from '@/core/icon-names';
import { icon } from '@/ui/html/icons';

it('exposes the shared glyph names the menu presets rely on', () => {
  for (const n of ['menu', 'info', 'soundOn', 'soundOff', 'chevronRight', 'ticket'] as const) {
    expect(ICON_NAMES, `${n} must be a known icon`).toContain(n);
  }
});

it('every shared name resolves to a non-empty DOM glyph', () => {
  for (const n of ICON_NAMES) {
    const svg = icon(n);
    expect(svg, `icon(${n})`).toContain('<svg');
    expect(svg, `icon(${n}) must not be empty`).not.toContain('undefined');
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @energy8platform/shell -- tests/core/icon-names.test.ts`
Expected: FAIL — `Cannot find module '@/core/icon-names'`.

- [ ] **Step 3: Teach the generator to emit the shared names**

In `packages/shell/scripts/gen-icons-from-svg.mjs`, inside `emit(targetRel, withIconSVG)`, replace the
line that derives the type:

```js
  out += `export type IconName = keyof typeof SVGS;\n`;
  out += `export const ICON_NAMES = Object.keys(SVGS) as IconName[];\n\n`;
```

with a re-export of the core union:

```js
  out += `export type { IconName } from '@/core/icon-names';\n`;
  out += `import type { IconName } from '@/core/icon-names';\n`;
  out += `export { ICON_NAMES } from '@/core/icon-names';\n\n`;
```

Then, right after the two existing `emit(...)` calls at the bottom of the script, add the core emitter
and call it FIRST (the renderer files import from it):

```js
function emitCoreNames(keys) {
  const path = join(ROOT, 'src', 'core/icon-names.ts');
  const list = keys.map((n) => `  '${n}',`).join('\n');
  const out =
    `${HEADER}\n` +
    `// The single glyph-name union, shared by core (menu items) and both renderers.\n` +
    `export const ICON_NAMES = [\n${list}\n] as const;\n\n` +
    `export type IconName = (typeof ICON_NAMES)[number];\n`;
  writeFileSync(path, out);
  console.log(`wrote core/icon-names.ts: ${keys.length} names`);
}
```

`emit()` already computes `keys` locally; hoist that computation so both emitters see the same list —
change `emit` to take the key list as a parameter:

```js
function keyOrder(targetRel) {
  const { order } = parseSvgs(readFileSync(join(ROOT, 'src', targetRel), 'utf8'));
  return [...order, ...names.filter((n) => !order.includes(n))];
}
const KEYS = keyOrder('ui/html/icons.ts');
emitCoreNames(KEYS);
```

and inside `emit`, replace `const keys = [...order, ...names.filter(...)]` with `const keys = KEYS;`.

- [ ] **Step 4: Regenerate**

Run: `cd packages/shell && node scripts/gen-icons-from-svg.mjs`
Expected: three "wrote …" lines — `core/icon-names.ts`, `ui/html/icons.ts`, `ui/pixi/icons.ts`.
Check `src/core/icon-names.ts` starts with the AUTO-GENERATED header and lists `'menu'`, `'info'`,
`'soundOn'`, `'soundOff'`, `'chevronRight'`, `'ticket'`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test --workspace @energy8platform/shell -- tests/core/icon-names.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Typecheck the whole package**

Run: `npm run typecheck --workspace @energy8platform/shell`
Expected: clean. `IconName` is now a real union, so any call site passing a bad literal fails here —
fix such call sites by using a real glyph name.

- [ ] **Step 7: Commit**

```bash
git add packages/shell/scripts/gen-icons-from-svg.mjs packages/shell/src/core/icon-names.ts \
        packages/shell/src/ui/html/icons.ts packages/shell/src/ui/pixi/icons.ts \
        packages/shell/tests/core/icon-names.test.ts
git commit -m "refactor(shell): single generated IconName union in core"
```

---

### Task 2: Popover placement math in core

Pure geometry, shared by both renderers so the popover sits identically in DOM and Pixi.

**Files:**
- Create: `packages/shell/src/core/popover.ts`
- Test: `packages/shell/tests/core/popover.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  interface Rect { x: number; y: number; w: number; h: number }
  interface Surface { w: number; h: number }
  interface PopoverPlacement { x: number; y: number; maxH: number; arrowX: number; below: boolean }
  const POPOVER = { margin: 8, gap: 8, arrowInset: 14, minH: 120, minW: 220, maxW: 320 };
  function popoverWidth(surfaceW: number, contentW: number): number;
  function placePopover(anchor: Rect | null, surface: Surface, size: { w: number; h: number }): PopoverPlacement;
  ```
  `arrowX` is relative to the popover's own left edge; `-1` means "no arrow" (centred fallback).

- [ ] **Step 1: Write the failing test**

Create `packages/shell/tests/core/popover.test.ts`:

```ts
// @vitest-environment node
import { it, expect } from 'vitest';
import { placePopover, popoverWidth, POPOVER } from '@/core/popover';

const surface = { w: 1000, h: 600 };

it('opens above the anchor, left-aligned to it', () => {
  const p = placePopover({ x: 100, y: 540, w: 40, h: 40 }, surface, { w: 260, h: 300 });
  expect(p.below).toBe(false);
  expect(p.x).toBe(100);
  expect(p.y).toBe(540 - POPOVER.gap - 300);
  expect(p.arrowX).toBe(120 - 100); // anchor centre, relative to the popover
});

it('clamps x inside the surface margins', () => {
  const left = placePopover({ x: 2, y: 540, w: 40, h: 40 }, surface, { w: 260, h: 300 });
  expect(left.x).toBe(POPOVER.margin);
  const right = placePopover({ x: 980, y: 540, w: 40, h: 40 }, surface, { w: 260, h: 300 });
  expect(right.x).toBe(surface.w - 260 - POPOVER.margin);
});

it('keeps the arrow inside the rounded corners', () => {
  const p = placePopover({ x: 2, y: 540, w: 12, h: 12 }, surface, { w: 260, h: 300 });
  expect(p.arrowX).toBe(POPOVER.arrowInset);
});

it('flips below when there is not enough room above', () => {
  const p = placePopover({ x: 100, y: 20, w: 40, h: 40 }, surface, { w: 260, h: 300 });
  expect(p.below).toBe(true);
  expect(p.y).toBe(20 + 40 + POPOVER.gap);
  expect(p.maxH).toBe(surface.h - 60 - POPOVER.gap - POPOVER.margin);
});

it('caps maxH to the space on the chosen side', () => {
  const p = placePopover({ x: 100, y: 400, w: 40, h: 40 }, surface, { w: 260, h: 900 });
  expect(p.maxH).toBe(400 - POPOVER.gap - POPOVER.margin);
});

it('centres and hides the arrow without an anchor', () => {
  const p = placePopover(null, surface, { w: 260, h: 300 });
  expect(p.x).toBe((1000 - 260) / 2);
  expect(p.y).toBe((600 - 300) / 2);
  expect(p.arrowX).toBe(-1);
});

it('clamps the width between minW and the surface', () => {
  expect(popoverWidth(1000, 180)).toBe(POPOVER.minW);
  expect(popoverWidth(1000, 400)).toBe(POPOVER.maxW);
  expect(popoverWidth(240, 400)).toBe(240 - 16);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @energy8platform/shell -- tests/core/popover.test.ts`
Expected: FAIL — `Cannot find module '@/core/popover'`.

- [ ] **Step 3: Write the implementation**

Create `packages/shell/src/core/popover.ts`:

```ts
/** Geometry for the bar-menu popover. Pure math over rectangles so the DOM and Pixi renderers
 *  place it identically — the renderers only supply measured sizes and apply the result. */

export interface Rect { x: number; y: number; w: number; h: number }
export interface Surface { w: number; h: number }

export interface PopoverPlacement {
  /** Top-left of the popover card, in surface coordinates. */
  x: number;
  y: number;
  /** Height cap for the card on the chosen side; the row list scrolls inside it. */
  maxH: number;
  /** Arrow centre, relative to the card's left edge. `-1` when there is no anchor to point at. */
  arrowX: number;
  /** True when the card opens below the anchor (arrow flips to the top edge). */
  below: boolean;
}

export const POPOVER = {
  /** Keep-out from the surface edges. */
  margin: 8,
  /** Space between the anchor and the card. */
  gap: 8,
  /** Minimum distance from the arrow tip to either rounded corner. */
  arrowInset: 14,
  /** A card shorter than this does not fit — flip to the other side instead. */
  minH: 120,
  minW: 220,
  maxW: 320,
} as const;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Card width: content width clamped to [minW, maxW] and never wider than the surface. */
export function popoverWidth(surfaceW: number, contentW: number): number {
  const hi = Math.min(POPOVER.maxW, surfaceW - POPOVER.margin * 2);
  return clamp(contentW, Math.min(POPOVER.minW, hi), hi);
}

/** Place the card above the anchor (below if it does not fit), left-aligned to the anchor and
 *  clamped inside the surface. `anchor === null` (no bar / hidden shell) centres it, arrow off. */
export function placePopover(
  anchor: Rect | null,
  surface: Surface,
  size: { w: number; h: number },
): PopoverPlacement {
  const { margin, gap, arrowInset, minH } = POPOVER;
  if (!anchor) {
    return {
      x: Math.max(margin, (surface.w - size.w) / 2),
      y: Math.max(margin, (surface.h - size.h) / 2),
      maxH: Math.max(minH, surface.h - margin * 2),
      arrowX: -1,
      below: false,
    };
  }
  const spaceAbove = anchor.y - gap - margin;
  const spaceBelow = surface.h - (anchor.y + anchor.h) - gap - margin;
  // Prefer above; flip only when the card would be squeezed below its usable minimum AND there is
  // genuinely more room on the other side.
  const below = spaceAbove < Math.min(size.h, minH) && spaceBelow > spaceAbove;
  const maxH = Math.max(minH, below ? spaceBelow : spaceAbove);
  const h = Math.min(size.h, maxH);
  const x = clamp(anchor.x, margin, Math.max(margin, surface.w - size.w - margin));
  const y = below ? anchor.y + anchor.h + gap : anchor.y - gap - h;
  const arrowX = clamp(anchor.x + anchor.w / 2 - x, arrowInset, Math.max(arrowInset, size.w - arrowInset));
  return { x, y, maxH, arrowX, below };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace @energy8platform/shell -- tests/core/popover.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shell/src/core/popover.ts packages/shell/tests/core/popover.test.ts
git commit -m "feat(shell): pure popover placement math in core"
```

---

### Task 3: Menu model in core

**Files:**
- Create: `packages/shell/src/core/menu.ts`
- Test: `packages/shell/tests/core/menu.test.ts`

**Interfaces:**
- Consumes: `IconName` from Task 1.
- Produces:
  ```ts
  type MenuPresetId = 'sound' | 'music' | 'sfx' | 'gameInfo';
  type MenuItem = …            // the config union
  type MenuRow = …             // the normalized render descriptor
  const DEFAULT_MENU: MenuItem[];
  function isPresetId(id: string): id is MenuPresetId;
  function rangeBounds(item): { min: number; max: number; step: number };
  function seedMenuValues(items: MenuItem[], prev?: Record<string, boolean | number>): Record<string, boolean | number>;
  function resolveMenu(host: MenuHost): MenuRow[];
  interface MenuHost { menu: MenuItem[]; t(s: string): string;
    getMenuValue(id: string): boolean | number | undefined;
    setMenuValue(id: string, v: boolean | number): void;
    actions: { openInfo(): void } }
  ```
  Task 4 makes `ShellHost` satisfy `MenuHost`; Tasks 5 and 7 render `MenuRow[]`.

- [ ] **Step 1: Write the failing test**

Create `packages/shell/tests/core/menu.test.ts`:

```ts
// @vitest-environment node
import { it, expect, vi } from 'vitest';
import { resolveMenu, seedMenuValues, DEFAULT_MENU, type MenuItem, type MenuHost } from '@/core/menu';

function host(items: MenuItem[], over: Partial<MenuHost> = {}): MenuHost & { values: Record<string, boolean | number> } {
  const values: Record<string, boolean | number> = { sound: true, music: 0.5, sfx: 0.5, ...seedMenuValues(items) };
  return {
    values,
    menu: items,
    t: (s) => s,
    getMenuValue: (id) => values[id],
    setMenuValue: (id, v) => { values[id] = v; },
    actions: { openInfo: vi.fn() },
    ...over,
  } as never;
}

it('expands the default list into sound/music/sfx/separator/gameInfo', () => {
  const rows = resolveMenu(host(DEFAULT_MENU));
  expect(rows.map((r) => r.kind)).toEqual(['toggle', 'range', 'range', 'separator', 'button']);
  expect(rows.map((r) => ('id' in r ? r.id : '—'))).toEqual(['sound', 'music', 'sfx', '—', 'gameInfo']);
});

it('gives presets their translated labels and volume bounds', () => {
  const rows = resolveMenu(host(DEFAULT_MENU));
  const music = rows[1];
  expect(music).toMatchObject({ kind: 'range', label: 'Music', min: 0, max: 1, step: 0.05 });
  if (music.kind !== 'range') throw new Error('range expected');
  expect(music.format(0.5)).toBe('50%');
  expect(rows[4]).toMatchObject({ kind: 'button', label: 'Game info', icon: 'info', chevron: true });
});

it("swaps the sound row's glyph with its value", () => {
  const rows = resolveMenu(host(DEFAULT_MENU));
  const sound = rows[0];
  if (sound.kind !== 'toggle') throw new Error('toggle expected');
  expect(sound.icon(true)).toBe('soundOn');
  expect(sound.icon(false)).toBe('soundOff');
});

it('routes a preset row through get/set on the host', () => {
  const h = host(DEFAULT_MENU);
  const rows = resolveMenu(h);
  const sound = rows[0];
  if (sound.kind !== 'toggle') throw new Error('toggle expected');
  expect(sound.get()).toBe(true);
  sound.set(false);
  expect(h.values.sound).toBe(false);
});

it('gameInfo select() opens the info overlay', () => {
  const h = host(DEFAULT_MENU);
  const row = resolveMenu(h)[4];
  if (row.kind !== 'button') throw new Error('button expected');
  row.select();
  expect(h.actions.openInfo).toHaveBeenCalledOnce();
});

it('derives a custom range step from its span and calls onChange', () => {
  const onChange = vi.fn();
  const items: MenuItem[] = [{ id: 'speed', type: 'range', label: 'Speed', min: 1, max: 5, value: 2, onChange }];
  const h = host(items);
  const row = resolveMenu(h)[0];
  if (row.kind !== 'range') throw new Error('range expected');
  expect(row).toMatchObject({ min: 1, max: 5, step: 0.2 });
  expect(row.get()).toBe(2);
  row.set(3);
  expect(h.values.speed).toBe(3);
  expect(onChange).toHaveBeenCalledWith(3);
});

it('uses a custom format when given, percent only for a 0..1 range', () => {
  const items: MenuItem[] = [
    { id: 'speed', type: 'range', label: 'Speed', min: 1, max: 5, value: 2, format: (v) => `×${v}` },
    { id: 'mix', type: 'range', label: 'Mix', value: 0.25 },
  ];
  const rows = resolveMenu(host(items));
  if (rows[0].kind !== 'range' || rows[1].kind !== 'range') throw new Error('ranges expected');
  expect(rows[0].format(2)).toBe('×2');
  expect(rows[1].format(0.25)).toBe('25%');
});

it('renders custom toggle and button rows', () => {
  const onSelect = vi.fn();
  const items: MenuItem[] = [
    { id: 'lefty', type: 'toggle', label: 'Left-hand', value: false },
    { id: 'paytable', type: 'button', label: 'Paytable', icon: 'ticket', onSelect },
  ];
  const rows = resolveMenu(host(items));
  expect(rows[0]).toMatchObject({ kind: 'toggle', id: 'lefty', label: 'Left-hand', disabled: false });
  if (rows[0].kind !== 'toggle') throw new Error('toggle expected');
  expect(rows[0].icon(false)).toBeUndefined();
  if (rows[1].kind !== 'button') throw new Error('button expected');
  expect(rows[1]).toMatchObject({ icon: 'ticket', chevron: false });
  rows[1].select();
  expect(onSelect).toHaveBeenCalledOnce();
});

it('drops an unknown id and an unknown icon, warning once for the id', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const items = [
    { id: 'nope' },
    { id: 'x', type: 'button', label: 'X', icon: 'not-a-glyph' },
  ] as unknown as MenuItem[];
  const rows = resolveMenu(host(items));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ kind: 'button', icon: undefined });
  expect(warn).toHaveBeenCalledTimes(1);
  warn.mockRestore();
});

it('seeds custom values and keeps ones already known', () => {
  const items: MenuItem[] = [
    { id: 'sound' },
    { id: 'lefty', type: 'toggle', value: true, label: 'L' },
    { id: 'speed', type: 'range', min: 1, max: 5, value: 2, label: 'S' },
    { id: 'noval', type: 'range', min: 2, max: 8, label: 'N' },
    { id: 'go', type: 'button', label: 'Go' },
    { type: 'separator' },
  ];
  expect(seedMenuValues(items)).toEqual({ lefty: true, speed: 2, noval: 2 });
  expect(seedMenuValues(items, { speed: 4 })).toEqual({ lefty: true, speed: 4, noval: 2 });
});

it('marks disabled rows', () => {
  const rows = resolveMenu(host([{ id: 'gameInfo', disabled: true }]));
  expect(rows[0].kind === 'button' && rows[0].disabled).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @energy8platform/shell -- tests/core/menu.test.ts`
Expected: FAIL — `Cannot find module '@/core/menu'`.

- [ ] **Step 3: Write the implementation**

Create `packages/shell/src/core/menu.ts`:

```ts
import { ICON_NAMES, type IconName } from './icon-names';

/** Built-in presets: the id alone is enough — the shell knows the label, icon and behaviour. */
export type MenuPresetId = 'sound' | 'music' | 'sfx' | 'gameInfo';
const PRESET_IDS: readonly string[] = ['sound', 'music', 'sfx', 'gameInfo'];

export function isPresetId(id: string): id is MenuPresetId {
  return PRESET_IDS.includes(id);
}

interface MenuItemBase {
  id: string;
  /** Overrides the preset/default label. Run through the shell translator. */
  label?: string;
  icon?: IconName;
  disabled?: boolean;
}

export type MenuPresetItem = { id: MenuPresetId } & Omit<MenuItemBase, 'id'>;
export type MenuToggleItem = { type: 'toggle'; value?: boolean; onChange?(v: boolean): void } & MenuItemBase;
export type MenuRangeItem = {
  type: 'range';
  min?: number;
  max?: number;
  step?: number;
  value?: number;
  /** Right-hand readout. Defaults to percent for a 0..1 range, else the raw number. */
  format?(v: number): string;
  onChange?(v: number): void;
} & MenuItemBase;
export type MenuButtonItem = { type: 'button'; chevron?: boolean; onSelect?(): void } & MenuItemBase;
export type MenuSeparatorItem = { type: 'separator' };

export type MenuItem =
  | MenuPresetItem
  | MenuToggleItem
  | MenuRangeItem
  | MenuButtonItem
  | MenuSeparatorItem;

/** The rows shown when `ShellConfig.menu` is omitted — today's Settings content, minus master. */
export const DEFAULT_MENU: MenuItem[] = [
  { id: 'sound' },
  { id: 'music' },
  { id: 'sfx' },
  { type: 'separator' },
  { id: 'gameInfo' },
];

/** What `resolveMenu` reads. `ShellController` satisfies it; tests can supply a small literal. */
export interface MenuHost {
  readonly menu: MenuItem[];
  t(text: string): string;
  getMenuValue(id: string): boolean | number | undefined;
  setMenuValue(id: string, value: boolean | number): void;
  readonly actions: { openInfo(): void };
}

/** A row, ready to draw: no preset knowledge left, no config shapes, just kind + accessors. */
export type MenuRow =
  | { kind: 'separator' }
  | {
      kind: 'toggle';
      id: string;
      label: string;
      disabled: boolean;
      /** Glyph for the current value (the sound preset swaps speaker on/off). */
      icon(value: boolean): IconName | undefined;
      get(): boolean;
      set(value: boolean): void;
    }
  | {
      kind: 'range';
      id: string;
      label: string;
      icon?: IconName;
      disabled: boolean;
      min: number;
      max: number;
      step: number;
      get(): number;
      set(value: number): void;
      format(value: number): string;
    }
  | {
      kind: 'button';
      id: string;
      label: string;
      icon?: IconName;
      disabled: boolean;
      chevron: boolean;
      select(): void;
    };

const isSeparator = (i: MenuItem): i is MenuSeparatorItem =>
  (i as { type?: string }).type === 'separator';

/** Range bounds with defaults: 0..1 like a volume slider, step = a twentieth of the span. */
export function rangeBounds(item: { min?: number; max?: number; step?: number }): {
  min: number;
  max: number;
  step: number;
} {
  const min = item.min ?? 0;
  const max = item.max ?? 1;
  return { min, max, step: item.step ?? (max - min) / 20 };
}

/** Initial values for CUSTOM items (presets keep their own homes). Values already in `prev` win, so
 *  a later `setMenu()` with the same ids does not reset what the player has changed. */
export function seedMenuValues(
  items: MenuItem[],
  prev: Record<string, boolean | number> = {},
): Record<string, boolean | number> {
  const out: Record<string, boolean | number> = {};
  for (const item of items) {
    if (isSeparator(item)) continue;
    const type = (item as { type?: string }).type;
    if (!type || isPresetId(item.id)) continue;
    if (item.id in prev) {
      out[item.id] = prev[item.id];
      continue;
    }
    if (type === 'toggle') out[item.id] = (item as MenuToggleItem).value ?? false;
    else if (type === 'range') {
      const r = item as MenuRangeItem;
      out[item.id] = r.value ?? rangeBounds(r).min;
    }
  }
  return out;
}

const percent = (v: number): string => `${Math.round(v * 100)}%`;

function safeIcon(name: string | undefined): IconName | undefined {
  return name && (ICON_NAMES as readonly string[]).includes(name) ? (name as IconName) : undefined;
}

/** Expand the configured list into render-ready rows. Unknown ids are dropped with one warning —
 *  a typo in a preset id must be visible, not silently invisible. */
export function resolveMenu(host: MenuHost): MenuRow[] {
  const rows: MenuRow[] = [];
  for (const item of host.menu) {
    if (isSeparator(item)) {
      rows.push({ kind: 'separator' });
      continue;
    }
    const type = (item as { type?: string }).type;
    if (!type) {
      const row = preset(host, item as MenuPresetItem);
      if (row) rows.push(row);
      else console.warn(`[shell] unknown menu preset id "${item.id}" — item skipped`);
      continue;
    }
    rows.push(custom(host, item as MenuToggleItem | MenuRangeItem | MenuButtonItem, type));
  }
  return rows;
}

function preset(host: MenuHost, item: MenuPresetItem): MenuRow | null {
  const disabled = item.disabled ?? false;
  const label = host.t(item.label ?? DEFAULT_LABELS[item.id] ?? item.id);
  switch (item.id) {
    case 'sound':
      return {
        kind: 'toggle',
        id: 'sound',
        label,
        disabled,
        icon: (v) => safeIcon(item.icon) ?? (v ? 'soundOn' : 'soundOff'),
        get: () => host.getMenuValue('sound') !== false,
        set: (v) => host.setMenuValue('sound', v),
      };
    case 'music':
    case 'sfx': {
      const id = item.id;
      return {
        kind: 'range',
        id,
        label,
        icon: safeIcon(item.icon),
        disabled,
        min: 0,
        max: 1,
        step: 0.05,
        get: () => Number(host.getMenuValue(id) ?? 1),
        set: (v) => host.setMenuValue(id, v),
        format: percent,
      };
    }
    case 'gameInfo':
      return {
        kind: 'button',
        id: 'gameInfo',
        label,
        icon: safeIcon(item.icon) ?? 'info',
        disabled,
        chevron: true,
        select: () => host.actions.openInfo(),
      };
    default:
      return null;
  }
}

const DEFAULT_LABELS: Record<string, string> = {
  sound: 'Sound',
  music: 'Music',
  sfx: 'SFX',
  gameInfo: 'Game info',
};

function custom(
  host: MenuHost,
  item: MenuToggleItem | MenuRangeItem | MenuButtonItem,
  type: string,
): MenuRow {
  const disabled = item.disabled ?? false;
  const label = host.t(item.label ?? item.id);
  const icon = safeIcon(item.icon);
  if (type === 'toggle') {
    const it = item as MenuToggleItem;
    return {
      kind: 'toggle',
      id: it.id,
      label,
      disabled,
      icon: () => icon,
      get: () => host.getMenuValue(it.id) === true,
      set: (v) => {
        host.setMenuValue(it.id, v);
        it.onChange?.(v);
      },
    };
  }
  if (type === 'range') {
    const it = item as MenuRangeItem;
    const { min, max, step } = rangeBounds(it);
    return {
      kind: 'range',
      id: it.id,
      label,
      icon,
      disabled,
      min,
      max,
      step,
      get: () => Number(host.getMenuValue(it.id) ?? min),
      set: (v) => {
        host.setMenuValue(it.id, v);
        it.onChange?.(v);
      },
      format: it.format ?? (min === 0 && max === 1 ? percent : (v) => String(v)),
    };
  }
  const it = item as MenuButtonItem;
  return {
    kind: 'button',
    id: it.id,
    label,
    icon,
    disabled,
    chevron: it.chevron ?? false,
    select: () => it.onSelect?.(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace @energy8platform/shell -- tests/core/menu.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shell/src/core/menu.ts packages/shell/tests/core/menu.test.ts
git commit -m "feat(shell): configurable menu model with preset expansion"
```

---

### Task 4: State + controller wiring (menu values, toggle, `master` removal)

Everything must stay green at the end of this task, so the renderers keep drawing the OLD
full-screen Settings — only now behind `{ kind: 'menu' }` and with the master slider gone. Tasks 5
and 7 swap in the popover.

**Files:**
- Modify: `packages/shell/src/core/types.ts` (VolumeKey, ShellState.menu, ShellConfig.menu, ResolvedShellConfig)
- Modify: `packages/shell/src/core/state.ts` (volumes, menu seeding)
- Modify: `packages/shell/src/core/renderer.ts` (ShellHost, OverlayRequest, drop refreshSoundIcon)
- Modify: `packages/shell/src/core/ShellController.ts`
- Modify: `packages/shell/src/core/index.ts` (export the menu module)
- Modify: `packages/shell/src/ui/html/components/Settings.ts`, `packages/shell/src/ui/pixi/components/Settings.ts` (drop master slider + swap the refreshers)
- Modify: `packages/shell/src/ui/html/HtmlRenderer.ts`, `packages/shell/src/ui/pixi/PixiRenderer.ts` (`case 'settings'` → `case 'menu'`, drop `refreshSoundIcon`)
- Modify: `packages/shell/tests/core/FakeRenderer.ts`, `packages/shell/tests/pixi/_host.ts`
- Modify: `packages/shell/tests/html/menu.test.ts`, `packages/shell/tests/html/shell-volume.test.ts` (drop master)
- Modify: `packages/game-engine/src/host/createSlotGame.ts:273-275` (drop `case 'master'`)
- Test: `packages/shell/tests/core/controller.test.ts` (append), `packages/shell/tests/core/state.test.ts` (append)

**Interfaces:**
- Consumes: `MenuItem`, `DEFAULT_MENU`, `seedMenuValues`, `isPresetId` (Task 3).
- Produces, on `ShellController` (and therefore on `ShellHost`):
  ```ts
  readonly menu: MenuItem[];
  setMenu(items: MenuItem[]): void;
  getMenuValue(id: string): boolean | number | undefined;
  setMenuValue(id: string, value: boolean | number): void;
  setMenuRefresh(fn: ((id: string, value: boolean | number) => void) | null): void;
  ```
  `OverlayRequest` now has `{ kind: 'menu' }` and no `{ kind: 'settings' }`.
  `ShellHost.setSoundRefresh` / `setVolumeRefresh` and `ShellRenderer.refreshSoundIcon` are gone.

- [ ] **Step 1: Write the failing tests**

Append to `packages/shell/tests/core/state.test.ts`:

```ts
import { createInitialState } from '@/core/state';

it('seeds volumes without master and menu values from the item list', () => {
  const s = createInitialState({
    language: 'en', currency: { symbol: '€', position: 'left' },
    availableBets: [1], defaultBet: 1, currentBet: null, balance: 0, win: 0,
    mode: 'base', gameInfo: {}, features: { turbo: 0, autoplay: null, buyBonus: false },
    volumes: { music: 0.4 },
    menu: [{ id: 'sound' }, { id: 'lefty', type: 'toggle', label: 'L', value: true }],
  } as never);
  expect(s.volumes).toEqual({ music: 0.4, sfx: 1 });
  expect(s.menu).toEqual({ lefty: true });
});
```

Append to `packages/shell/tests/core/controller.test.ts`:

```ts
import { DEFAULT_MENU } from '@/core/menu';

describe('menu', () => {
  it('opens the menu overlay and toggles it closed on a second call', () => {
    const r = new FakeRenderer();
    const shell = createShell({ ...baseConfig(), renderer: r });
    const opened = vi.fn();
    shell.on('menuOpen', opened);
    shell.openMenu();
    expect(r.overlays.at(-1)).toEqual({ kind: 'menu' });
    expect(opened).toHaveBeenCalledOnce();
    const closedBefore = r.closed;
    shell.openMenu();
    expect(r.closed).toBe(closedBefore + 1);
    expect(opened).toHaveBeenCalledOnce(); // the second call closed, it did not re-open
  });

  it('openSettings stays as a deprecated alias', () => {
    const r = new FakeRenderer();
    const shell = createShell({ ...baseConfig(), renderer: r });
    const settings = vi.fn();
    shell.on('settingsOpen', settings);
    shell.openSettings();
    expect(settings).toHaveBeenCalledOnce();
    expect(r.overlays.at(-1)).toEqual({ kind: 'menu' });
  });

  it('defaults to DEFAULT_MENU and swaps the list with setMenu', () => {
    const shell = createShell({ ...baseConfig(), renderer: new FakeRenderer() });
    expect(shell.menu).toEqual(DEFAULT_MENU);
    shell.setMenu([{ id: 'sound' }, { id: 'speed', type: 'range', label: 'S', min: 1, max: 5, value: 3 }]);
    expect(shell.getMenuValue('speed')).toBe(3);
  });

  it('routes menu values to sound, volumes and the custom map', () => {
    const shell = createShell({
      ...baseConfig(),
      menu: [{ id: 'sound' }, { id: 'music' }, { id: 'lefty', type: 'toggle', label: 'L' }],
      renderer: new FakeRenderer(),
    });
    const changes: Array<{ key: string; value: unknown }> = [];
    shell.on('settingChange', (e) => changes.push(e));

    shell.setMenuValue('sound', false);
    expect(shell.soundOn).toBe(false);
    expect(shell.getMenuValue('sound')).toBe(false);

    shell.setMenuValue('music', 5); // out of range → clamped
    expect(shell.getVolume('music')).toBe(1);
    expect(shell.getMenuValue('music')).toBe(1);

    shell.setMenuValue('lefty', true);
    expect(shell.state.menu.lefty).toBe(true);
    expect(shell.getMenuValue('lefty')).toBe(true);

    expect(changes).toEqual([
      { key: 'sound', value: false },
      { key: 'music', value: 1 },
      { key: 'lefty', value: true },
    ]);
  });

  it('clamps a custom range to its declared bounds', () => {
    const shell = createShell({
      ...baseConfig(),
      menu: [{ id: 'speed', type: 'range', label: 'S', min: 1, max: 5, value: 2 }],
      renderer: new FakeRenderer(),
    });
    shell.setMenuValue('speed', 99);
    expect(shell.getMenuValue('speed')).toBe(5);
    shell.setMenuValue('speed', -3);
    expect(shell.getMenuValue('speed')).toBe(1);
  });

  it('pushes every value change to a registered refresher', () => {
    const shell = createShell({ ...baseConfig(), renderer: new FakeRenderer() });
    const seen: Array<[string, unknown]> = [];
    shell.setMenuRefresh((id, v) => seen.push([id, v]));
    shell.setSound(false);
    shell.setVolume('sfx', 0.25);
    expect(seen).toEqual([['sound', false], ['sfx', 0.25]]);
    shell.setMenuRefresh(null);
    shell.setVolume('sfx', 0.5);
    expect(seen).toHaveLength(2);
  });
});
```

> `baseConfig()` is the existing helper in that file. If it is named differently there, reuse
> whatever the file already uses to build a `ShellConfig` — do not invent a second helper.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace @energy8platform/shell -- tests/core`
Expected: FAIL — `shell.menu` / `setMenuValue` are not functions, `state.menu` undefined.

- [ ] **Step 3: Narrow the volume types and add the menu state**

In `packages/shell/src/core/types.ts`:

```ts
/** The two independent volume sliders shown in the bar menu. */
export type VolumeKey = 'music' | 'sfx';
```

Update the `ShellConfig.volumes` doc-comment to say "music/sfx" instead of "master/music/sfx", and add
to `ShellConfig` (import `MenuItem` from `./menu`):

```ts
  /** Bar-menu items, in order. Omit for the default list (sound, music, sfx, ─, game info). */
  menu?: MenuItem[];
```

Add `menu` to the `Pick<...>` list in `ResolvedShellConfig`'s second half (it is optional, so it goes
in the same `Pick<ShellConfig, 'currentBet' | 'theme' | 'onBonusBuy' | 'volumes' | 'menu'>`).

In `ShellState`, replace the `volumes` doc + add the map:

```ts
  /** Volume slider positions (0..1) for the two sliders in the menu. */
  volumes: VolumeLevels;
  /** Values of CUSTOM menu items, keyed by id. Seeded from the item list; preset values live in
   *  their own homes (`soundOn`, `volumes`) and are reached through `getMenuValue`. */
  menu: Record<string, boolean | number>;
```

- [ ] **Step 4: Seed the new state**

In `packages/shell/src/core/state.ts`, import `{ DEFAULT_MENU, seedMenuValues }` from `./menu` and
replace the `volumes` block plus add `menu`:

```ts
    volumes: {
      music: clampVolume(config.volumes?.music),
      sfx: clampVolume(config.volumes?.sfx),
    },
    menu: seedMenuValues(config.menu ?? DEFAULT_MENU),
```

- [ ] **Step 5: Update the renderer contract**

In `packages/shell/src/core/renderer.ts`:

- In `OverlayRequest`, replace `| { kind: 'settings' }` with `| { kind: 'menu' }`.
- Delete `refreshSoundIcon?(on: boolean): void;` from `ShellRenderer`.
- In `ShellHost`, delete `setSoundRefresh` and `setVolumeRefresh`, and add:

```ts
  /** The configured menu items (see core/menu.ts). */
  readonly menu: MenuItem[];
  /** Current value of a menu item — presets included (sound → soundOn, music/sfx → volumes). */
  getMenuValue(id: string): boolean | number | undefined;
  /** Set a menu value: clamps ranges, stores, emits `settingChange`, refreshes an open menu. */
  setMenuValue(id: string, value: boolean | number): void;
  /** An open menu registers a row updater here (null clears it on close). */
  setMenuRefresh(fn: ((id: string, value: boolean | number) => void) | null): void;
```

Import `MenuItem` from `./menu` at the top.

- [ ] **Step 6: Wire the controller**

In `packages/shell/src/core/ShellController.ts`:

Imports — add `import { DEFAULT_MENU, rangeBounds, seedMenuValues, type MenuItem, type MenuRangeItem } from './menu';`

In `resolveConfig`, pass the list through: `menu: config.menu,`.

Replace the two refresher fields with one, and track the open overlay kind:

```ts
  private menuItems: MenuItem[];
  private menuRefresh: ((id: string, value: boolean | number) => void) | null = null;
  private overlayKind: OverlayRequest['kind'] | null = null;
```

In the constructor, after `this.state = createInitialState(this.config);`:

```ts
    this.menuItems = this.config.menu ?? DEFAULT_MENU;
```

Delete the `soundRefresh` / `volumeRefresh` fields and their `setSoundRefresh` / `setVolumeRefresh`
methods. Add the menu API:

```ts
  // ── menu ───────────────────────────────────────────────────────────────────
  get menu(): MenuItem[] {
    return this.menuItems;
  }
  /** Replace the item list. Values of ids already in state are kept; new ids are seeded. */
  setMenu(items: MenuItem[]): void {
    this.menuItems = items;
    this.state.menu = seedMenuValues(items, this.state.menu);
    if (this.overlayKind === 'menu') this.show({ kind: 'menu' });
  }
  getMenuValue(id: string): boolean | number | undefined {
    if (id === 'sound') return this.soundOn;
    if (id === 'music' || id === 'sfx') return this.state.volumes[id];
    return this.state.menu[id];
  }
  /** Set a menu value. Presets route to their own homes so there is never a second copy. */
  setMenuValue(id: string, value: boolean | number): void {
    if (id === 'sound') {
      this.setSound(value !== false);
      return;
    }
    if (id === 'music' || id === 'sfx') {
      this.setVolume(id, Number(value));
      return;
    }
    const next = typeof value === 'number' ? this.clampRange(id, value) : value;
    this.state.menu[id] = next;
    this.emit('settingChange', { key: id, value: next });
    this.menuRefresh?.(id, next);
  }
  setMenuRefresh(fn: ((id: string, value: boolean | number) => void) | null): void {
    this.menuRefresh = fn;
  }
  /** Clamp to the declared bounds of a custom `range` item (a non-range id passes through). */
  private clampRange(id: string, value: number): number {
    const item = this.menuItems.find((i) => (i as { id?: string }).id === id) as
      | MenuRangeItem
      | undefined;
    if (!item || (item as { type?: string }).type !== 'range') return value;
    const { min, max } = rangeBounds(item);
    return Math.max(min, Math.min(max, value));
  }
```

Route the existing sound/volume setters through the single refresher:

```ts
  setSound(on: boolean): void {
    this.soundOn = on;
    this.emit('settingChange', { key: 'sound', value: on });
    this.menuRefresh?.('sound', on);
  }
```

```ts
  setVolume(key: VolumeKey, value: number): void {
    const v = Math.max(0, Math.min(1, value));
    this.state.volumes[key] = v;
    this.emit('settingChange', { key, value: v });
    this.menuRefresh?.(key, v);
  }
```

Overlay flow — track the kind and make the burger toggle:

```ts
  private show(req: OverlayRequest): void {
    this.closeModal();
    this.overlay = this.renderer.openOverlay(req) ?? null;
    this.overlayKind = this.overlay ? req.kind : null;
  }
  /** Open the bar menu. Called again while it is open, it closes it — the burger toggles. */
  openMenu(): void {
    if (this.overlayKind === 'menu') {
      this.closeModal();
      return;
    }
    this.emit('menuOpen');
    this.show({ kind: 'menu' });
  }
  /** @deprecated The Settings overlay is gone — this opens the bar menu. */
  openSettings(): void {
    this.emit('settingsOpen');
    this.openMenu();
  }
```

In `closeModal()`, clear the kind and the refresher:

```ts
  closeModal(): void {
    if (!this.overlay) return;
    this.overlay = null;
    this.overlayKind = null;
    this.menuRefresh = null;
    this.renderer.closeOverlay();
  }
```

- [ ] **Step 7: Export the menu module**

In `packages/shell/src/core/index.ts`, add next to the other re-exports:

```ts
export { DEFAULT_MENU, resolveMenu, seedMenuValues, rangeBounds, isPresetId } from './menu';
export type { MenuItem, MenuRow, MenuHost, MenuPresetId } from './menu';
export { placePopover, popoverWidth, POPOVER } from './popover';
export type { PopoverPlacement, Rect as PopoverRect } from './popover';
```

- [ ] **Step 8: Keep the existing views compiling**

These are transitional edits; Tasks 5 and 7 delete both Settings files.

`packages/shell/src/ui/html/components/Settings.ts`:
- delete the `body.appendChild(slider('master', host.t('Master volume')));` line;
- replace `host.setSoundRefresh(paint);` with `host.setMenuRefresh((id, v) => { if (id === 'sound') paint(v === true); else updaters[id as VolumeKey]?.(Number(v)); });`
  and delete the later `host.setVolumeRefresh(...)` call. Move the `updaters` declaration above the
  sound block so the callback can see it.

`packages/shell/src/ui/pixi/components/Settings.ts`:
- delete the `col.add(sliderRow(host, width, 'master', host.t('Master volume'), updaters));` line;
- replace `host.setSoundRefresh?.((on) => {…})` + `host.setVolumeRefresh?.(...)` with one
  `host.setMenuRefresh((id, v) => { if (id === 'sound') { if (speaker.destroyed) return; speaker.setIcon(v ? 'soundOn' : 'soundOff'); speaker.active = v === true; } else updaters[id as VolumeKey]?.(Number(v)); });`

`packages/shell/src/ui/html/HtmlRenderer.ts` and `packages/shell/src/ui/pixi/PixiRenderer.ts`:
- rename `case 'settings':` to `case 'menu':` in `buildOverlay` / `openOverlay`;
- delete the `refreshSoundIcon` method from both.

`packages/shell/src/ui/pixi/context.ts`: delete `setSoundRefresh` / `setVolumeRefresh` if they are
re-declared there; `PixiComponentContext` inherits the new members from `ShellHost`.

- [ ] **Step 9: Update the test doubles and the master-era assertions**

`packages/shell/tests/core/FakeRenderer.ts` — nothing to add (it implements `ShellRenderer`, and
`refreshSoundIcon` was optional). Confirm it still compiles.

`packages/shell/tests/pixi/_host.ts` — in `makeContext`, replace `setSoundRefresh` / `setVolumeRefresh`
with the menu members:

```ts
    menu: over.menu ?? [{ id: 'sound' }, { id: 'music' }, { id: 'sfx' }, { type: 'separator' }, { id: 'gameInfo' }],
    getMenuValue: over.getMenuValue ?? ((id: string) =>
      id === 'sound' ? true : id === 'music' || id === 'sfx' ? state.volumes[id] : state.menu[id]),
    setMenuValue: over.setMenuValue ?? ((id: string, v: boolean | number) => {
      if (id === 'music' || id === 'sfx') state.volumes[id] = Math.max(0, Math.min(1, Number(v)));
      else state.menu[id] = v;
      emit('settingChange', { key: id, value: v });
    }),
    setMenuRefresh: over.setMenuRefresh ?? noop,
```

`packages/shell/tests/html/shell-volume.test.ts` — delete every `master` case (the `master()` helper,
its assertions, and the `volumes: { master: 0.2, … }` expectation for master; keep the `music` half).

`packages/shell/tests/html/menu.test.ts` — delete the `master slider emits settingChange` test and the
`setting-master` assertion in the slider test. (Task 5 rewrites this file wholesale; this keeps the
suite green in between.)

- [ ] **Step 10: Drop the dead `master` branch in the engine host**

In `packages/game-engine/src/host/createSlotGame.ts`, delete these three lines from the
`settingChange` switch:

```ts
        case 'master':
          game.audio.setMasterVolume(Number(value));
          break;
```

- [ ] **Step 11: Run the suites**

Run: `npm test --workspace @energy8platform/shell`
Expected: PASS, including the new controller/state tests.
Run: `npm run typecheck --workspace @energy8platform/shell && npm run typecheck --workspace @energy8platform/game-engine`
Expected: clean.

- [ ] **Step 12: Commit**

```bash
git add packages/shell/src packages/shell/tests packages/game-engine/src/host/createSlotGame.ts
git commit -m "feat(shell): menu state + controller API, drop master volume"
```

---

### Task 5: DOM popover

**Files:**
- Create: `packages/shell/src/ui/html/components/Menu.ts`
- Modify: `packages/shell/src/ui/html/primitives.ts` (add `createPopover`)
- Modify: `packages/shell/src/ui/html/shell.css.ts` (popover styles)
- Modify: `packages/shell/src/ui/html/HtmlRenderer.ts` (build the menu, reposition on resize)
- Delete: `packages/shell/src/ui/html/components/Settings.ts`
- Test: rewrite `packages/shell/tests/html/menu.test.ts`; retarget `packages/shell/tests/html/shell-volume.test.ts`

**Interfaces:**
- Consumes: `resolveMenu`, `MenuRow` (Task 3); `placePopover`, `popoverWidth`, `POPOVER` (Task 2);
  `host.setMenuRefresh` (Task 4).
- Produces:
  ```ts
  // primitives.ts
  interface PopoverOpts { ge: string; surface: HTMLElement; anchor: HTMLElement | null; onClose(): void }
  function createPopover(opts: PopoverOpts): { root: HTMLDivElement; card: HTMLDivElement; body: HTMLDivElement; position(): void };
  // components/Menu.ts
  function openMenuPopover(host: ShellHost, surface: HTMLElement):
    { root: HTMLElement; position(): void };
  ```
  Row test hooks: `[data-ge="menu-popover"]` (dismiss layer), `[data-ge="menu-card"]`,
  `[data-ge="menu-row-<id>"]`, `[data-ge="menu-item-<id>"]` (the control), `[data-ge="menu-sep"]`.

- [ ] **Step 1: Write the failing test**

Replace `packages/shell/tests/html/menu.test.ts` entirely:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createGameShell, removeGameShell } from '@/ui/html';
import type { ShellConfig } from '@/core/types';

function cfg(mount: HTMLElement, over: Partial<ShellConfig> = {}): ShellConfig & { mount: HTMLElement } {
  return {
    mount, gameInfo: {}, language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [1, 2], defaultBet: 1, currentBet: null,
    balance: 100, win: 0, mode: 'base',
    features: { turbo: 0, autoplay: null, buyBonus: false },
    ...over,
  } as ShellConfig & { mount: HTMLElement };
}
const q = (m: HTMLElement, s: string) => m.querySelector(s) as HTMLElement | null;

describe('bar menu popover', () => {
  let mount: HTMLElement;
  beforeEach(async () => {
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
    await removeGameShell();
  });

  it('burger opens the popover with the default rows, in order', () => {
    const shell = createGameShell(cfg(mount));
    const opened = vi.fn();
    shell.on('menuOpen', opened);
    q(mount, '[data-ge="menu"]')!.click();
    expect(opened).toHaveBeenCalledOnce();
    expect(q(mount, '[data-ge="menu-popover"]')).toBeTruthy();
    const rows = Array.from(mount.querySelectorAll('[data-ge^="menu-row-"], [data-ge="menu-sep"]'));
    expect(rows.map((r) => (r as HTMLElement).dataset.ge)).toEqual([
      'menu-row-sound', 'menu-row-music', 'menu-row-sfx', 'menu-sep', 'menu-row-gameInfo',
    ]);
    expect(q(mount, '[data-ge="settings-modal"]')).toBeNull(); // the overlay is gone for good
  });

  it('a second burger tap closes it', () => {
    createGameShell(cfg(mount));
    const burger = q(mount, '[data-ge="menu"]')!;
    burger.click();
    expect(q(mount, '[data-ge="menu-popover"]')).toBeTruthy();
    burger.click();
    expect(q(mount, '[data-ge="menu-popover"]')).toBeNull();
  });

  it('closes on a click outside and on Escape', () => {
    createGameShell(cfg(mount));
    q(mount, '[data-ge="menu"]')!.click();
    q(mount, '[data-ge="menu-popover"]')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(q(mount, '[data-ge="menu-popover"]')).toBeNull();

    q(mount, '[data-ge="menu"]')!.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
    expect(q(mount, '[data-ge="menu-popover"]')).toBeNull();
  });

  it('sound row toggles and swaps its glyph', () => {
    const shell = createGameShell(cfg(mount));
    const spy = vi.fn();
    shell.on('settingChange', spy);
    shell.openMenu();
    const row = q(mount, '[data-ge="menu-row-sound"]')!;
    expect(row.querySelector('svg')).toBeTruthy();
    q(mount, '[data-ge="menu-item-sound"]')!.click();
    expect(spy).toHaveBeenCalledWith({ key: 'sound', value: false });
    expect(shell.soundOn).toBe(false);
  });

  it('volume rows move the shell volumes', () => {
    const shell = createGameShell(cfg(mount));
    const spy = vi.fn();
    shell.on('settingChange', spy);
    shell.openMenu();
    const s = q(mount, '[data-ge="menu-item-music"]') as HTMLInputElement;
    s.value = '0.3';
    s.dispatchEvent(new Event('input'));
    expect(spy).toHaveBeenCalledWith({ key: 'music', value: 0.3 });
    expect(shell.getVolume('music')).toBe(0.3);
  });

  it('game info row opens the info overlay', () => {
    const shell = createGameShell(cfg(mount));
    shell.openMenu();
    q(mount, '[data-ge="menu-item-gameInfo"]')!.click();
    expect(q(mount, '[data-ge="info-modal"]')).toBeTruthy();
    expect(q(mount, '[data-ge="menu-popover"]')).toBeNull();
  });

  it('renders custom toggle / range / button rows and runs their callbacks', () => {
    const onSelect = vi.fn();
    const onChange = vi.fn();
    const shell = createGameShell(cfg(mount, {
      menu: [
        { id: 'lefty', type: 'toggle', label: 'Left-hand', value: false, onChange },
        { id: 'speed', type: 'range', label: 'Speed', min: 1, max: 5, step: 1, value: 2, format: (v) => `×${v}` },
        { id: 'paytable', type: 'button', label: 'Paytable', icon: 'ticket', chevron: true, onSelect },
      ],
    }));
    shell.openMenu();
    q(mount, '[data-ge="menu-item-lefty"]')!.click();
    expect(onChange).toHaveBeenCalledWith(true);
    expect(shell.getMenuValue('lefty')).toBe(true);

    const speed = q(mount, '[data-ge="menu-item-speed"]') as HTMLInputElement;
    expect(speed.min).toBe('1');
    expect(speed.max).toBe('5');
    expect(q(mount, '[data-ge="menu-row-speed"]')!.textContent).toContain('×2');

    q(mount, '[data-ge="menu-item-paytable"]')!.click();
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('live-updates an open popover from setMenuValue', () => {
    const shell = createGameShell(cfg(mount));
    shell.openMenu();
    shell.setMenuValue('sfx', 0.25);
    const s = q(mount, '[data-ge="menu-item-sfx"]') as HTMLInputElement;
    expect(s.value).toBe('0.25');
    expect(q(mount, '[data-ge="menu-row-sfx"]')!.textContent).toContain('25%');
  });

  it('places the card above the burger, clamped inside the shell root', () => {
    const shell = createGameShell(cfg(mount));
    const root = mount.querySelector('#__ge-game-shell__') as HTMLElement;
    Object.defineProperty(root, 'clientWidth', { value: 1000, configurable: true });
    Object.defineProperty(root, 'clientHeight', { value: 600, configurable: true });
    root.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600, toJSON: () => ({}) }) as DOMRect;
    const burger = q(mount, '[data-ge="menu"]')!;
    burger.getBoundingClientRect = () => ({ x: 20, y: 540, left: 20, top: 540, width: 40, height: 40, right: 60, bottom: 580, toJSON: () => ({}) }) as DOMRect;
    shell.openMenu();
    const card = q(mount, '[data-ge="menu-card"]')!;
    expect(parseFloat(card.style.left)).toBe(20);
    expect(parseFloat(card.style.top)).toBeLessThan(540);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @energy8platform/shell -- tests/html/menu.test.ts`
Expected: FAIL — no `[data-ge="menu-popover"]`; the old Settings overlay still opens.

- [ ] **Step 3: Add the popover primitive**

Append to `packages/shell/src/ui/html/primitives.ts`:

```ts
import { placePopover, popoverWidth, POPOVER, type Rect } from '@/core/popover';

export interface PopoverOpts {
  ge: string;
  /** The shell root — the popover is placed in its coordinate space and clamped to it. */
  surface: HTMLElement;
  /** The control the card points at; `null` centres the card and hides the arrow. */
  anchor: HTMLElement | null;
  onClose: () => void;
}

/** A light-dismiss popover: a transparent full-surface layer (closes on pointerdown) holding a
 *  card with an arrow that points at `anchor`. Append rows to `body`; call `position()` after the
 *  card is in the DOM and again on resize. */
export function createPopover(opts: PopoverOpts): {
  root: HTMLDivElement;
  card: HTMLDivElement;
  body: HTMLDivElement;
  position(): void;
} {
  const root = document.createElement('div');
  root.className = 'ge-pop-layer';
  root.dataset.ge = opts.ge;
  const card = document.createElement('div');
  card.className = 'ge-pop';
  card.dataset.ge = 'menu-card';
  const body = document.createElement('div');
  body.className = 'ge-pop-body';
  const arrow = document.createElement('span');
  arrow.className = 'ge-pop-arrow';
  card.append(body, arrow);
  root.appendChild(card);
  // Clicks inside the card must not reach the dismiss layer.
  card.addEventListener('pointerdown', (e) => e.stopPropagation());
  root.addEventListener('pointerdown', opts.onClose);

  const position = (): void => {
    const surfaceRect = opts.surface.getBoundingClientRect();
    const surface = { w: surfaceRect.width || opts.surface.clientWidth, h: surfaceRect.height || opts.surface.clientHeight };
    if (surface.w <= 0 || surface.h <= 0) return;
    const w = popoverWidth(surface.w, card.scrollWidth || POPOVER.minW);
    card.style.width = `${w}px`;
    let anchor: Rect | null = null;
    if (opts.anchor) {
      const a = opts.anchor.getBoundingClientRect();
      if (a.width > 0 || a.height > 0) {
        anchor = { x: a.left - surfaceRect.left, y: a.top - surfaceRect.top, w: a.width, h: a.height };
      }
    }
    const p = placePopover(anchor, surface, { w, h: card.offsetHeight || POPOVER.minH });
    card.style.left = `${p.x}px`;
    card.style.top = `${p.y}px`;
    card.style.maxHeight = `${p.maxH}px`;
    card.classList.toggle('ge-pop-below', p.below);
    if (p.arrowX < 0) arrow.style.display = 'none';
    else {
      arrow.style.display = '';
      arrow.style.left = `${p.arrowX}px`;
    }
  };
  return { root, card, body, position };
}
```

- [ ] **Step 4: Add the popover CSS**

In `packages/shell/src/ui/html/shell.css.ts`, insert before the `/* game info — … */` block:

```ts
/* bar menu popover — light dismiss (no dim, no blur), card anchored to the burger */
#${SHELL_ROOT_ID} .ge-pop-layer { position:absolute; inset:0; z-index:55; pointer-events:auto; }
#${SHELL_ROOT_ID} .ge-pop { position:absolute; box-sizing:border-box; display:flex; flex-direction:column;
  padding:8px; border-radius:18px; background:var(--shell-plaque-dark);
  box-shadow:0 14px 38px rgba(0,0,0,.5); backdrop-filter:blur(12px) saturate(120%);
  -webkit-backdrop-filter:blur(12px) saturate(120%); animation:ge-ov-in .12s ease-out; }
#${SHELL_ROOT_ID} .ge-pop-body { overflow-y:auto; overflow-x:hidden; min-height:0; }
#${SHELL_ROOT_ID} .ge-pop .ge-ov-row { padding:10px 12px; margin-bottom:6px; font-size:13px; }
#${SHELL_ROOT_ID} .ge-pop .ge-ov-row:last-child { margin-bottom:0; }
#${SHELL_ROOT_ID} .ge-pop-sep { height:1px; margin:6px 4px; background:var(--shell-plaque-line); opacity:.5; }
#${SHELL_ROOT_ID} .ge-pop-arrow { position:absolute; bottom:-7px; width:14px; height:14px; margin-left:-7px;
  background:var(--shell-plaque-dark); transform:rotate(45deg); border-radius:3px; }
#${SHELL_ROOT_ID} .ge-pop.ge-pop-below .ge-pop-arrow { bottom:auto; top:-7px; }
#${SHELL_ROOT_ID} .ge-pop .ge-mi-icon { flex:0 0 auto; width:20px; font-size:20px; display:flex; }
#${SHELL_ROOT_ID} .ge-pop .ge-mi-chev { flex:0 0 auto; width:16px; font-size:16px; color:var(--shell-muted); display:flex; }
```

- [ ] **Step 5: Build the menu component**

Create `packages/shell/src/ui/html/components/Menu.ts`:

```ts
import type { ShellHost } from '@/core/renderer';
import { resolveMenu, type MenuRow } from '@/core/menu';
import { createPopover } from '../primitives';
import { icon, type IconName } from '../icons';

/** The bar menu, as a light-dismiss popover anchored to the burger. Rows come from the core model,
 *  so DOM and Pixi always show the same list in the same order. */
export function openMenuPopover(
  host: ShellHost,
  surface: HTMLElement,
): { root: HTMLElement; position(): void } {
  const anchor = surface.querySelector('[data-ge="menu"]') as HTMLElement | null;
  const pop = createPopover({
    ge: 'menu-popover',
    surface,
    anchor,
    onClose: () => host.actions.closeOverlay(),
  });
  const updaters: Record<string, (v: boolean | number) => void> = {};
  for (const row of resolveMenu(host)) {
    pop.body.appendChild(buildRow(host, row, updaters, () => pop.position()));
  }
  // Live updates while open (host.setMenuValue / setSound / setVolume); cleared by the controller.
  host.setMenuRefresh((id, v) => updaters[id]?.(v));
  return { root: pop.root, position: pop.position };
}

function glyph(name: IconName | undefined, cls: string): HTMLElement | null {
  if (!name) return null;
  const el = document.createElement('span');
  el.className = cls;
  el.innerHTML = icon(name);
  return el;
}

function buildRow(
  host: ShellHost,
  row: MenuRow,
  updaters: Record<string, (v: boolean | number) => void>,
  reposition: () => void,
): HTMLElement {
  if (row.kind === 'separator') {
    const sep = document.createElement('div');
    sep.className = 'ge-pop-sep';
    sep.dataset.ge = 'menu-sep';
    return sep;
  }
  if (row.kind === 'button') {
    // The row hook goes on a wrapper so both `menu-row-<id>` (order assertions) and
    // `menu-item-<id>` (the clickable control) exist, as they do for toggle/range rows.
    const wrap = document.createElement('div');
    wrap.dataset.ge = `menu-row-${row.id}`;
    const btn = document.createElement('button');
    btn.className = 'ge-ov-row';
    btn.dataset.ge = `menu-item-${row.id}`;
    btn.disabled = row.disabled;
    const label = document.createElement('span');
    label.className = 'ge-grow';
    label.textContent = row.label;
    const ico = glyph(row.icon, 'ge-mi-icon');
    const chev = row.chevron ? glyph('chevronRight', 'ge-mi-chev') : null;
    for (const el of [ico, label, chev]) if (el) btn.appendChild(el);
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      host.actions.closeOverlay();
      row.select();
    });
    wrap.appendChild(btn);
    return wrap;
  }
  if (row.kind === 'toggle') {
    const el = document.createElement('div');
    el.className = 'ge-ov-row';
    el.dataset.ge = `menu-row-${row.id}`;
    const ico = glyph(row.icon(row.get()), 'ge-mi-icon');
    const label = document.createElement('span');
    label.className = 'ge-grow';
    label.textContent = row.label;
    const btn = document.createElement('button');
    btn.className = 'ge-toggle';
    btn.dataset.ge = `menu-item-${row.id}`;
    btn.disabled = row.disabled;
    btn.innerHTML = '<i></i>';
    const paint = (v: boolean): void => {
      btn.classList.toggle('ge-on', v);
      btn.setAttribute('aria-pressed', String(v));
      const next = row.icon(v);
      if (ico && next) ico.innerHTML = icon(next);
    };
    paint(row.get());
    btn.addEventListener('click', () => {
      if (!btn.disabled) row.set(!row.get());
    });
    updaters[row.id] = (v) => paint(v === true);
    if (ico) el.appendChild(ico);
    el.append(label, btn);
    return el;
  }
  // range
  const el = document.createElement('div');
  el.className = 'ge-ov-row ge-col';
  el.dataset.ge = `menu-row-${row.id}`;
  const head = document.createElement('div');
  head.className = 'ge-row-head';
  const name = document.createElement('span');
  name.textContent = row.label;
  const val = document.createElement('span');
  val.className = 'ge-val';
  head.append(name, val);
  const input = document.createElement('input');
  input.type = 'range';
  input.className = 'ge-slider';
  input.dataset.ge = `menu-item-${row.id}`;
  input.min = String(row.min);
  input.max = String(row.max);
  input.step = String(row.step);
  input.disabled = row.disabled;
  const paint = (v: number): void => {
    input.value = String(v);
    val.textContent = row.format(v);
  };
  paint(row.get());
  input.addEventListener('input', () => {
    const v = Number(input.value);
    val.textContent = row.format(v);
    row.set(v);
  });
  updaters[row.id] = (v) => {
    paint(Number(v));
    reposition();
  };
  el.append(head, input);
  return el;
}
```

> The button row is wrapped so both `menu-row-<id>` and `menu-item-<id>` exist — the wrapper carries
> the row hook, the `<button>` carries the item hook. Set `btn.dataset.ge` once (`menu-item-…`); do
> not also set `menu-row-…` on it.

- [ ] **Step 6: Wire the renderer and delete Settings**

In `packages/shell/src/ui/html/HtmlRenderer.ts`:

- replace `import { openSettingsModal } from './components/Settings';` with
  `import { openMenuPopover } from './components/Menu';`
- in `buildOverlay`, replace the `case 'menu'` body with:

```ts
      case 'menu': {
        const { root, position } = openMenuPopover(this.host, this.root);
        this.popoverPosition = position;
        return { root };
      }
```

- add the field and clear it on close:

```ts
  private popoverPosition: (() => void) | null = null;
```

```ts
  closeOverlay(): void {
    this.modalOnKey = undefined;
    this.popoverPosition = null;
    this.modalHost.innerHTML = '';
  }
```

- in `showModal`, after `this.fitModals();`, add `this.popoverPosition?.();` so the card is placed
  once it has been measured in the DOM.
- in `observeLayout`'s ResizeObserver callback, after `this.fitModals();`, add `this.popoverPosition?.();`.

Delete `packages/shell/src/ui/html/components/Settings.ts`.

- [ ] **Step 7: Retarget the volume suite**

In `packages/shell/tests/html/shell-volume.test.ts`, replace every `[data-ge="setting-music"]` /
`[data-ge="setting-sfx"]` selector with `[data-ge="menu-item-music"]` / `[data-ge="menu-item-sfx"]`,
and every `shell.openSettings()` with `shell.openMenu()`.

- [ ] **Step 8: Run the DOM suites**

Run: `npm test --workspace @energy8platform/shell -- tests/html`
Expected: PASS, including the 9 rewritten menu tests.

- [ ] **Step 9: Commit**

```bash
git add packages/shell/src/ui/html packages/shell/tests/html
git commit -m "feat(shell): DOM bar-menu popover replaces the Settings overlay"
```

---

### Task 6: Pixi popover primitive

**Files:**
- Create: `packages/shell/src/ui/pixi/primitives/popover.ts`
- Modify: `packages/shell/src/ui/pixi/primitives/controls.ts` (add `Toggle`)
- Modify: `packages/shell/src/ui/pixi/PixiRenderer.ts` (`pushLayer` backdrop option)
- Modify: `packages/shell/src/ui/pixi/context.ts` (`pushLayer` signature)
- Modify: `packages/shell/src/ui/pixi/components/BottomBar.ts` (`menuAnchor()`)
- Test: `packages/shell/tests/pixi/popover.test.ts`

**Interfaces:**
- Consumes: `placePopover`, `popoverWidth`, `POPOVER` (Task 2).
- Produces:
  ```ts
  class Popover extends Container implements ShellLayer {
    constructor(host: PixiComponentContext, opts: { tag?: string; anchor(): Rect | null; onClose(): void; build(width: number): Container });
    resize(w: number, h: number): void;
    onKey(e: KeyboardEvent): boolean;   // false → the controller closes on Escape
    onRemove(): void;
  }
  class Toggle extends Container { constructor(value: boolean, onChange: (v: boolean) => void); setValue(v: boolean): void }
  // BottomBar
  menuAnchor(): { x: number; y: number; w: number; h: number } | null;
  // PixiRenderer / PixiComponentContext
  pushLayer(node: ShellLayer, opts?: { backdrop?: boolean }): LayerHandle;
  ```

- [ ] **Step 1: Write the failing test**

Create `packages/shell/tests/pixi/popover.test.ts`:

```ts
import './setup-canvas';
import { describe, it, expect, vi } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import { Popover } from '@/ui/pixi/primitives/popover';
import { Toggle } from '@/ui/pixi/primitives/controls';
import { makeContext } from './_host';

describe('Pixi popover', () => {
  it('places its card above the anchor and points the arrow at it', () => {
    const host = makeContext({ screenW: 1000, screenH: 600 });
    const pop = new Popover(host, {
      anchor: () => ({ x: 100, y: 540, w: 40, h: 40 }),
      onClose: () => {},
      build: () => new Container(),
    });
    pop.resize(1000, 600);
    expect(pop.cardX).toBe(100);
    expect(pop.cardY).toBeLessThan(540);
    expect(pop.arrowX).toBeCloseTo(20, 0); // anchor centre relative to the card
  });

  it('centres itself when there is no anchor', () => {
    const host = makeContext({ screenW: 1000, screenH: 600 });
    const pop = new Popover(host, { anchor: () => null, onClose: () => {}, build: () => new Container() });
    pop.resize(1000, 600);
    expect(pop.cardX).toBeGreaterThan(300);
    expect(pop.arrowVisible).toBe(false);
  });

  it('closes when the dismiss layer is tapped, not when the card is', () => {
    const onClose = vi.fn();
    const host = makeContext();
    const pop = new Popover(host, { anchor: () => null, onClose, build: () => new Container() });
    pop.resize(1000, 600);
    pop.dismissLayer.emit('pointertap');
    expect(onClose).toHaveBeenCalledOnce();
    pop.card.emit('pointertap');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('lets Escape through to the controller', () => {
    const host = makeContext();
    const pop = new Popover(host, { anchor: () => null, onClose: () => {}, build: () => new Container() });
    expect(pop.onKey(new KeyboardEvent('keydown', { code: 'Escape' }))).toBe(false);
  });
});

describe('Toggle', () => {
  it('flips on tap and paints its knob', () => {
    const onChange = vi.fn();
    const t = new Toggle(false, onChange);
    expect(t.value).toBe(false);
    t.emit('pointertap');
    expect(onChange).toHaveBeenCalledWith(true);
    t.setValue(true);
    expect(t.value).toBe(true);
    expect(t.children.some((c) => c instanceof Graphics)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @energy8platform/shell -- tests/pixi/popover.test.ts`
Expected: FAIL — `Cannot find module '@/ui/pixi/primitives/popover'`.

- [ ] **Step 3: Add the `Toggle` control**

Append to `packages/shell/src/ui/pixi/primitives/controls.ts`:

```ts
/** Pill switch — the Pixi twin of the DOM `.ge-toggle`. 42×24, knob 20, accent when on. */
export class Toggle extends Container {
  private track = new Graphics();
  private knob = new Graphics();
  private _value: boolean;
  private onChange: (v: boolean) => void;
  private accent: string;
  private offFill: string;

  constructor(value: boolean, onChange: (v: boolean) => void, accent = '#8b5cf6', off = 'rgba(255,255,255,.22)') {
    super();
    this._value = value;
    this.onChange = onChange;
    this.accent = accent;
    this.offFill = off;
    this.addChild(this.track, this.knob);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.hitArea = new Rectangle(0, 0, 42, 24);
    this.on('pointertap', () => this.onChange(!this._value));
    this.paint();
  }

  get value(): boolean {
    return this._value;
  }
  setValue(v: boolean): void {
    this._value = v;
    this.paint();
  }
  private paint(): void {
    this.track.clear();
    this.track.roundRect(0, 0, 42, 24, 12);
    this.track.fill(this._value ? this.accent : this.offFill);
    this.knob.clear();
    this.knob.circle(this._value ? 30 : 12, 12, 10);
    this.knob.fill('#ffffff');
  }
  measureSize(): { w: number; h: number } {
    return { w: 42, h: 24 };
  }
  setLayoutSize(): void {
    /* fixed size */
  }
}
```

Make sure `Rectangle` and `Graphics` are in that file's `pixi.js` import list.

- [ ] **Step 4: Add the popover layer**

Create `packages/shell/src/ui/pixi/primitives/popover.ts`:

```ts
import { Container, Graphics, Rectangle } from 'pixi.js';
import { placePopover, popoverWidth, POPOVER, type Rect } from '@/core/popover';
import type { PixiComponentContext, ShellLayer } from '../context';
import { ScrollBox } from './scroll';
import { FlexBox } from './flex';

export interface PopoverOpts {
  tag?: string;
  /** Anchor rect in screen coordinates, re-read on every layout (the bar rebuilds often). */
  anchor(): Rect | null;
  onClose(): void;
  /** Build the card content for a given inner width. */
  build(width: number): Container;
}

/** Light-dismiss popover: a transparent full-screen hit rect + a rounded card with an arrow.
 *  No veil, no frosted snapshot — the game stays visible and unblurred behind it. */
export class Popover extends Container implements ShellLayer {
  readonly tag?: string;
  readonly dismissLayer = new Graphics();
  readonly card = new Container();
  private bg = new Graphics();
  private arrow = new Graphics();
  private scroll: ScrollBox;
  private host: PixiComponentContext;
  private opts: PopoverOpts;
  private _cardX = 0;
  private _cardY = 0;
  private _arrowX = -1;

  constructor(host: PixiComponentContext, opts: PopoverOpts) {
    super();
    this.host = host;
    this.opts = opts;
    this.tag = opts.tag;
    this.scroll = new ScrollBox(host.canvas);
    this.card.addChild(this.bg, this.arrow, this.scroll);
    this.addChild(this.dismissLayer, this.card);
    this.dismissLayer.eventMode = 'static';
    this.dismissLayer.on('pointertap', () => this.opts.onClose());
    // Taps on the card must not fall through to the dismiss layer.
    this.card.eventMode = 'static';
    this.card.on('pointertap', (e: { stopPropagation?: () => void }) => e.stopPropagation?.());
    this.resize(host.screenW, host.screenH);
  }

  get cardX(): number { return this._cardX; }
  get cardY(): number { return this._cardY; }
  get arrowX(): number { return this._arrowX; }
  get arrowVisible(): boolean { return this.arrow.visible; }

  resize(w: number, h: number): void {
    this.dismissLayer.clear();
    this.dismissLayer.rect(0, 0, w, h).fill({ color: 0x000000, alpha: 0 });
    this.dismissLayer.hitArea = new Rectangle(0, 0, w, h);

    const pad = 8;
    const width = popoverWidth(w, POPOVER.minW);
    const content = this.opts.build(width - pad * 2);
    if (content instanceof FlexBox) content.setLayoutSize(width - pad * 2, undefined);
    const contentH = content.getSize().height;

    const p = placePopover(this.opts.anchor(), { w, h }, { w: width, h: contentH + pad * 2 });
    const cardH = Math.min(contentH + pad * 2, p.maxH);

    this.scroll.content.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.scroll.position.set(pad, pad);
    this.scroll.setViewport(width - pad * 2, cardH - pad * 2);
    this.scroll.content.addChild(content);
    this.scroll.refresh();

    this.bg.clear();
    this.bg.roundRect(0, 0, width, cardH, 18);
    this.bg.fill(this.host.tokens.plaqueDark);

    // Arrow: a 14×7 triangle on the edge that faces the anchor.
    this.arrow.clear();
    this.arrow.visible = p.arrowX >= 0;
    if (this.arrow.visible) {
      const edge = p.below ? 0 : cardH;      // the card edge the arrow sits on
      const tip = p.below ? -7 : cardH + 7;  // the tip, pointing at the anchor
      this.arrow.moveTo(p.arrowX - 7, edge);
      this.arrow.lineTo(p.arrowX + 7, edge);
      this.arrow.lineTo(p.arrowX, tip);
      this.arrow.fill(this.host.tokens.plaqueDark);
    }

    this.card.position.set(p.x, p.y);
    this._cardX = p.x;
    this._cardY = p.y;
    this._arrowX = p.arrowX;
  }

  /** Arrow keys scroll a long list; everything else (Escape included) goes to the controller. */
  onKey(e: KeyboardEvent): boolean {
    if (e.code === 'ArrowDown') { this.scroll.scrollBy(40); return true; }
    if (e.code === 'ArrowUp') { this.scroll.scrollBy(-40); return true; }
    return false;
  }

  fit(): void {
    this.resize(this.host.screenW, this.host.screenH);
  }

  onRemove(): void {
    this.scroll.destroy({ children: true });
  }
}
```

- [ ] **Step 5: Make the backdrop optional and expose the bar anchor**

In `packages/shell/src/ui/pixi/context.ts`, widen the signature:

```ts
  pushLayer(node: ShellLayer, opts?: { backdrop?: boolean }): LayerHandle;
```

In `packages/shell/src/ui/pixi/PixiRenderer.ts`:

```ts
  pushLayer(node: ShellLayer, opts?: { backdrop?: boolean }): LayerHandle {
    this.clearLayer();
    if (opts?.backdrop !== false) this.makeBackdrop();
    this.currentLayer = node;
    this.modalLayer.addChild(node);
    this.fitModals();
    return {
      root: node,
      close: () => {
        if (this.currentLayer === node) this.closeLayer();
      },
    };
  }
```

In `packages/shell/src/ui/pixi/components/BottomBar.ts`, keep a reference in BOTH builders. In
`buildWide`, replace the inline `new IconButton('menu', {...})` argument with:

```ts
    this.menuBtn = new IconButton('menu', {
      size: 36,
      glyph: 30,
      color: '#ffffff',
      hover: tokens.accent,
      onTap: () => this.host.actions.openMenu(),
    });
    left.add(this.menuBtn);
```

and in the mobile builder assign the existing `const menu = new IconButton('menu', {...})` to
`this.menuBtn = menu;` right after it is created. Add the field and the accessor:

```ts
  private menuBtn?: IconButton;

  /** Screen-space rect of the burger, for anchoring the menu popover. */
  menuAnchor(): { x: number; y: number; w: number; h: number } | null {
    if (!this.menuBtn || this.menuBtn.destroyed) return null;
    const p = this.menuBtn.getGlobalPosition();
    const s = this.menuBtn.getSize();
    return { x: p.x, y: p.y, w: s.width, h: s.height };
  }
```

- [ ] **Step 6: Run the test**

Run: `npm test --workspace @energy8platform/shell -- tests/pixi/popover.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/shell/src/ui/pixi packages/shell/tests/pixi/popover.test.ts
git commit -m "feat(shell): pixi popover layer + toggle control + bar anchor"
```

---

### Task 7: Pixi menu component

**Files:**
- Create: `packages/shell/src/ui/pixi/components/Menu.ts`
- Modify: `packages/shell/src/ui/pixi/PixiRenderer.ts` (build the menu for `{ kind: 'menu' }`)
- Delete: `packages/shell/src/ui/pixi/components/Settings.ts`
- Test: `packages/shell/tests/pixi/menu.test.ts`; extend `packages/shell/tests/pixi/parity.test.ts`

**Interfaces:**
- Consumes: `Popover`, `Toggle` (Task 6); `resolveMenu`, `MenuRow` (Task 3).
- Produces: `openMenu(host: PixiComponentContext): ShellLayer` — the layer the renderer pushes with
  `{ backdrop: false }`. Each row container carries `label = 'menu-row-<id>'` (Pixi's node label is
  the test hook, mirroring the DOM's `data-ge`), separators `label = 'menu-sep'`.

- [ ] **Step 1: Write the failing test**

Create `packages/shell/tests/pixi/menu.test.ts`:

```ts
import './setup-canvas';
import { describe, it, expect, vi } from 'vitest';
import { openMenu } from '@/ui/pixi/components/Menu';
import { Toggle } from '@/ui/pixi/primitives/controls';
import { makeContext } from './_host';

function labels(node: { children: Array<{ label?: string; children?: unknown[] }> }): string[] {
  const out: string[] = [];
  const walk = (n: { label?: string; children?: unknown[] }): void => {
    if (n.label && (n.label.startsWith('menu-row-') || n.label === 'menu-sep')) out.push(n.label);
    for (const c of (n.children ?? []) as Array<{ label?: string; children?: unknown[] }>) walk(c);
  };
  walk(node as never);
  return out;
}

describe('Pixi bar menu', () => {
  it('renders the default rows in order', () => {
    const layer = openMenu(makeContext());
    expect(labels(layer as never)).toEqual([
      'menu-row-sound', 'menu-row-music', 'menu-row-sfx', 'menu-sep', 'menu-row-gameInfo',
    ]);
  });

  it('renders custom rows and runs a button callback', () => {
    const onSelect = vi.fn();
    const host = makeContext({
      menu: [
        { id: 'lefty', type: 'toggle', label: 'Left-hand', value: false },
        { id: 'paytable', type: 'button', label: 'Paytable', onSelect },
      ],
    });
    const layer = openMenu(host);
    expect(labels(layer as never)).toEqual(['menu-row-lefty', 'menu-row-paytable']);
    const row = findByLabel(layer as never, 'menu-row-paytable')!;
    row.emit('pointertap');
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('toggling a row writes through the host', () => {
    const host = makeContext({ menu: [{ id: 'lefty', type: 'toggle', label: 'L', value: false }] });
    const layer = openMenu(host);
    const row = findByLabel(layer as never, 'menu-row-lefty')!;
    const toggle = row.children.find((c: unknown) => c instanceof Toggle) as Toggle;
    toggle.emit('pointertap');
    expect(host.getMenuValue('lefty')).toBe(true);
  });
});

function findByLabel(n: any, label: string): any {
  if (n.label === label) return n;
  for (const c of n.children ?? []) {
    const hit = findByLabel(c, label);
    if (hit) return hit;
  }
  return null;
}
```

Append to `packages/shell/tests/pixi/parity.test.ts`:

```ts
import { resolveMenu, DEFAULT_MENU } from '@/core/menu';

it('the menu model both renderers draw has one row per configured item', () => {
  const shell = createPixiShell(makeConfig());
  const rows = resolveMenu(shell as never);
  expect(rows).toHaveLength(DEFAULT_MENU.length);
  expect(rows.map((r) => r.kind)).toEqual(['toggle', 'range', 'range', 'separator', 'button']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace @energy8platform/shell -- tests/pixi`
Expected: FAIL — `Cannot find module '@/ui/pixi/components/Menu'`.

- [ ] **Step 3: Build the component**

Create `packages/shell/src/ui/pixi/components/Menu.ts`:

```ts
import { Container, Graphics, Text } from 'pixi.js';
import { resolveMenu, type MenuRow } from '@/core/menu';
import type { PixiComponentContext, ShellLayer } from '../context';
import { Popover } from '../primitives/popover';
import { FlexBox } from '../primitives/flex';
import { Slider, Spacer, Toggle } from '../primitives/controls';
import { makeText } from '../text';
import { makeIcon } from '../pixi-icon';
import { attachHover } from '../primitives/widgets';
import type { BottomBar } from './BottomBar';

/** The bar menu as a Pixi popover. Same rows, same order as the DOM — both come from resolveMenu. */
export function openMenu(host: PixiComponentContext, bar?: BottomBar): ShellLayer {
  const updaters: Record<string, (v: boolean | number) => void> = {};
  const layer = new Popover(host, {
    tag: 'menu',
    anchor: () => bar?.menuAnchor() ?? null,
    onClose: () => host.closeLayer(),
    build: (width) => {
      const col = new FlexBox({ direction: 'column', align: 'stretch', gap: 6 });
      for (const row of resolveMenu(host)) col.add(buildRow(host, row, width, updaters));
      return col;
    },
  });
  host.setMenuRefresh((id, v) => updaters[id]?.(v));
  return layer;
}

function label(text: string): Text {
  return makeText(text, { size: 13, weight: '600', color: '#ffffff' }) as Text;
}

function rowBox(host: PixiComponentContext, name: string, column = false): FlexBox {
  const box = new FlexBox({
    direction: column ? 'column' : 'row',
    align: column ? 'stretch' : 'center',
    gap: column ? 8 : 10,
    padding: { top: 10, bottom: 10, left: 12, right: 12 },
    minHeight: column ? undefined : 44,
    background: { fill: host.tokens.plaqueGlass, radius: 14 },
  });
  box.label = name;
  return box;
}

function buildRow(
  host: PixiComponentContext,
  row: MenuRow,
  width: number,
  updaters: Record<string, (v: boolean | number) => void>,
): Container {
  if (row.kind === 'separator') {
    const sep = new Container();
    sep.label = 'menu-sep';
    const line = new Graphics().rect(4, 6, width - 8, 1).fill(host.tokens.plaqueLine);
    line.alpha = 0.5;
    sep.addChild(line);
    return sep;
  }
  if (row.kind === 'button') {
    const box = rowBox(host, `menu-row-${row.id}`);
    if (row.icon) box.add(makeIcon(row.icon, 20, '#ffffff'));
    const text = label(row.label);
    box.add(text);
    box.add(new Spacer(), { grow: 1 });
    if (row.chevron) box.add(makeIcon('chevronRight', 16, host.tokens.muted));
    if (!row.disabled) {
      box.setInteractive(true);
      box.on('pointertap', () => {
        host.closeLayer();
        row.select();
      });
      attachHover(
        box,
        () => { box.setBgFill(host.tokens.plaqueGlassHover); text.style.fill = host.tokens.accent; },
        () => { box.setBgFill(host.tokens.plaqueGlass); text.style.fill = '#ffffff'; },
      );
    } else {
      box.alpha = 0.5;
    }
    return box;
  }
  if (row.kind === 'toggle') {
    const box = rowBox(host, `menu-row-${row.id}`);
    const glyph = row.icon(row.get());
    const iconNode = glyph ? makeIcon(glyph, 20, '#ffffff') : null;
    if (iconNode) box.add(iconNode);
    box.add(label(row.label));
    box.add(new Spacer(), { grow: 1 });
    const toggle = new Toggle(row.get(), (v) => row.set(v), host.tokens.accent, host.tokens.plaqueLine);
    box.add(toggle);
    updaters[row.id] = (v) => {
      const on = v === true;
      toggle.setValue(on);
      const next = row.icon(on);
      if (iconNode && next) iconNode.setIcon?.(next);
    };
    return box;
  }
  const box = rowBox(host, `menu-row-${row.id}`, true);
  const head = new FlexBox({ direction: 'row', align: 'center' });
  const value = makeText(row.format(row.get()), { size: 12, weight: '700', color: host.tokens.plaqueLabel });
  head.add(label(row.label));
  head.add(new Spacer(), { grow: 1 });
  head.add(value);
  // Slider works in 0..1; map to the row's declared bounds.
  const toUnit = (v: number): number => (row.max === row.min ? 0 : (v - row.min) / (row.max - row.min));
  const fromUnit = (u: number): number => {
    const raw = row.min + u * (row.max - row.min);
    return Math.round(raw / row.step) * row.step;
  };
  const slider = new Slider(host, toUnit(row.get()), (u) => {
    const v = fromUnit(u);
    value.text = row.format(v);
    row.set(v);
  });
  updaters[row.id] = (v) => {
    const n = Number(v);
    value.text = row.format(n);
    slider.setValue(toUnit(n));
  };
  box.add(head);
  box.add(slider);
  return box;
}
```

> `makeIcon` returns an `IconView` with `setColor`; if it has no `setIcon`, add one to
> `packages/shell/src/ui/pixi/pixi-icon.ts` mirroring `setColor` (rebuild the geometry from
> `iconSVG(name, color)`), since the sound row swaps its glyph. The `iconNode.setIcon?.()` call above
> is written defensively so it compiles either way — but implement `setIcon` so the glyph really swaps.

- [ ] **Step 4: Wire the renderer and delete Settings**

In `packages/shell/src/ui/pixi/PixiRenderer.ts`:

- replace `import { openSettings } from './components/Settings';` with
  `import { openMenu } from './components/Menu';`
- in `openOverlay`, the `case 'menu'` becomes `layer = openMenu(this.ctx, this.bar);`
- push it without a backdrop — replace the tail of `openOverlay`:

```ts
    if (!layer) return;
    this.pushLayer(layer, { backdrop: req.kind !== 'menu' });
```

Delete `packages/shell/src/ui/pixi/components/Settings.ts`.

- [ ] **Step 5: Run the Pixi suites**

Run: `npm test --workspace @energy8platform/shell -- tests/pixi`
Expected: PASS, including the 3 new menu tests and the parity addition.

- [ ] **Step 6: Run everything**

Run: `npm test --workspace @energy8platform/shell && npm run typecheck --workspace @energy8platform/shell && npm run lint --workspace @energy8platform/shell`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add packages/shell/src/ui/pixi packages/shell/tests/pixi
git commit -m "feat(shell): pixi bar-menu popover replaces the Settings overlay"
```

---

### Task 8: Examples, version, full verification

**Files:**
- Modify: `packages/shell/package.json` (version bump)
- Modify: `examples/shell-demo/src/main.ts`, `examples/pixi-shell-demo/src/main.ts`
- Modify: `CLAUDE.md` (one line in the shell paragraph)

**Interfaces:**
- Consumes: the whole public API from Tasks 3–7.
- Produces: nothing new.

- [ ] **Step 1: Bump the package version**

In `packages/shell/package.json`, set `"version": "0.7.0"` (menu API + removed Settings overlay +
narrowed `VolumeKey`).

- [ ] **Step 2: Exercise the new API in both demos**

In `examples/shell-demo/src/main.ts`, add a `menu` to the shell config that shows one row of each
custom kind alongside the presets:

```ts
  menu: [
    { id: 'sound' },
    { id: 'music' },
    { id: 'sfx' },
    { type: 'separator' },
    { id: 'gameInfo' },
    { id: 'lefty', type: 'toggle', label: 'Left-hand mode', value: false,
      onChange: (v) => log(`left-hand: ${v}`) },
    { id: 'speed', type: 'range', label: 'Reel speed', min: 1, max: 5, step: 1, value: 2,
      format: (v) => `×${v}`, onChange: (v) => log(`speed: ${v}`) },
    { id: 'paytable', type: 'button', label: 'Paytable', icon: 'ticket', chevron: true,
      onSelect: () => log('paytable') },
  ],
```

Apply the same block to `examples/pixi-shell-demo/src/main.ts`. Leave the existing
`shell.on('settingsOpen', …)` listeners and the `?open=settings` branch as they are — they still
work through the deprecated alias, and keeping them proves the alias.

- [ ] **Step 3: Document the change**

In `CLAUDE.md`, in the paragraph that describes `@energy8platform/shell`, append:

```
> The burger on the bar opens a **configurable popover menu** (`ShellConfig.menu`: preset ids
> `sound`/`music`/`sfx`/`gameInfo` plus custom `toggle`/`range`/`button`/`separator` rows), whose
> values live in shell state (`getMenuValue`/`setMenuValue`). The old full-screen Settings overlay
> is gone; `openSettings()` is a deprecated alias for `openMenu()`.
```

- [ ] **Step 4: Full monorepo verification**

Run, and paste the real output into the completion note:

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

Expected: all four clean. `npm test` covers game-engine + platform-core + shell.

- [ ] **Step 5: Visual check**

```bash
npm run build --workspace @energy8platform/shell
cd examples/shell-demo && npx vite --force
```

Open the demo, click the burger in landscape and in a portrait-sized window, confirm: the card sits
above the burger with its arrow on it, the game stays visible (no dim), clicking outside and Escape
both close it, the custom rows work. Repeat for `examples/pixi-shell-demo`. Screenshot via puppeteer's
bundled Chromium (the system headless Chrome cannot initialise Pixi v8).

- [ ] **Step 6: Commit**

```bash
git add packages/shell/package.json examples CLAUDE.md
git commit -m "feat(shell): menu popover demos, docs and 0.7.0"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
| --- | --- |
| Popover replaces Settings overlay | 5 (DOM), 7 (Pixi) |
| Declarative item list, presets by id, custom by type | 3 |
| Default list `[sound, music, sfx, ─, gameInfo]` | 3 |
| Values in shell state, seeded from the list, live updates | 4 |
| Two volume sliders, `master` removed | 4 |
| `setMenu` / `getMenuValue` / `setMenuValue` / burger toggles | 4 |
| `setMenuRefresh` replaces the two refreshers + `refreshSoundIcon` | 4 |
| `OverlayRequest` gains `menu`, loses `settings` | 4 |
| Anchor is a renderer concern; no anchor → centred | 2 (math), 5 (DOM), 6 (Pixi) |
| Light dismiss, no blur/backdrop, Escape closes | 5 (DOM), 6–7 (Pixi) |
| Shared geometry constants and placement | 2 |
| `IconName` shared + unknown-icon guard | 1, 3 |
| `createSlotGame` `case 'master'` removed | 4 |
| Examples, version bump, docs | 8 |
| Test list (core/menu, controller, html/menu, shell-volume, pixi/menu, parity, icons) | 1, 3, 4, 5, 6, 7 |

**Type consistency check**

- `MenuRow.toggle.icon` is a function `(v: boolean) => IconName | undefined` in Task 3 and is called
  as `row.icon(row.get())` in Tasks 5 and 7. ✔
- `pushLayer(node, opts?)` widened in Task 6 (`context.ts` + `PixiRenderer`) and called with
  `{ backdrop: req.kind !== 'menu' }` in Task 7. ✔
- `openMenuPopover(host, surface)` (DOM, Task 5) vs `openMenu(host, bar)` (Pixi, Task 7) — different
  names on purpose: the DOM one returns `{ root, position }`, the Pixi one returns a `ShellLayer`.
- `setMenuRefresh` is declared on `ShellHost` in Task 4 and consumed in Tasks 5 and 7. ✔
- `placePopover` / `popoverWidth` / `POPOVER` from Task 2 are used verbatim in Tasks 5 and 6. ✔
- `seedMenuValues(items, prev)` from Task 3 is used by `createInitialState` and `setMenu` in Task 4. ✔
