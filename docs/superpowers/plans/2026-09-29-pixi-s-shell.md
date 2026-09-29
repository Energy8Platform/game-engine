# S Pixi Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@energy8platform/shell/pixi-s`, a Pixi skin that reuses HB's renderer and overlays but draws a side-column control bar of skewed black/yellow halftone "slabs".

**Architecture:** `PixiHbRenderer` gains a `bar` factory option and asks the bar for its `safeArea`. The new `src/ui/pixi-s/` holds only the palette, font, three glyphs, the `Slab` primitive, S widgets and the `SideBar`. `createPixiSShell` wires `new PixiHbRenderer({ …, bar: (ctx) => new SideBar(ctx) })`. HB overlays are imported unchanged.

**Tech Stack:** TypeScript 5.6, PixiJS 8.20, Vitest 2 (jsdom + the shared canvas stub), Rollup 4.

**Spec:** `docs/superpowers/specs/2026-09-29-pixi-s-shell-design.md`

## Global Constraints

- Package `@energy8platform/shell` (`packages/shell`). New code lives in `packages/shell/src/ui/pixi-s/`. The sub-path is `./pixi-s`. The public factories are `createPixiSShell` and `removePixiSShell`.
- HB overlays (`src/ui/pixi-hb/components/{Menu,GameInfo,BuyBonus,Modal,ReplayModal,pickers}.ts`) are not modified. HB behaviour stays the same: every existing test in `tests/pixi-hb/` and `tests/pixi/` passes unchanged.
- Palette values, verbatim: yellow `#f8be45`, yellowDot `#d8a63d`, plate `#0b0b0b`, plateDot `#2e2614`, shadow alpha `.45`, fg `#f4f2eb`, ink `#0b0b0b`, red `#e0301e`, disabled alpha `0.4`.
- No new npm dependencies. No version bumps or releases. No game-engine re-export.
- Font: Montserrat ExtraBold 800, Latin + Cyrillic subsets from `@fontsource/montserrat@5.3.0`, family name `MontserratS`.
- Run a single test file from the package dir: `cd packages/shell && npx vitest run <path>`. Run the full suite from the repo root: `npm test --workspace @energy8platform/shell`. Typecheck: `npm run typecheck --workspace @energy8platform/shell`. (Root-level `npx vitest run <path>` gives false failures. Do not use it.)
- Commits: stage only the files the task lists. Never stage `engine/`. Never use `git stash`, `git checkout -- <file>` or `git restore` on files you did not write. To look at a base version, use `git show HEAD:<path>` into a scratch file. Retry on `index.lock`. The commit message is a subject line, a blank line, then this trailer: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
- Code style: match HB. Write short English doc comments on exported things and on non-obvious lines. Use 2-space indent, single quotes and semicolons.

## Review Focus

1. **Huge values and long feature titles.** A balance of `€10,000,000,000.00` or a BET label `WARRIOR ANTE` makes a slab grow. The columns must still not overlap on a laptop, and the mobile block must scale down to stay on screen. Tests in Task 5.
2. **Landscape phone (844×390).** This is the wide layout at a small scale. Both columns must stay inside the screen. Test in Task 5.
3. **Replay without free spins.** There is no hero (SPIN or counter), so there are no tabs. The right column is BET only, and nothing may throw. Test in Task 5.
4. **No buy-bonus configured** (`buyBonus: false`, no `onBonusBuy`). On mobile BUY is absent, and both columns still sit on the bottom line. Test in Task 5.
5. **Rebuild churn.** The bar is destroyed and rebuilt on about 20 state changes per spin. The shared dot and icon `GraphicsContext`s must survive `destroy({ children: true })`. Test in Task 3.

---

### Task 1: Renderer bar hook

**Files:**
- Modify: `packages/shell/src/ui/pixi-hb/PixiHbRenderer.ts`
- Modify: `packages/shell/src/ui/pixi-hb/components/BottomBar.ts`
- Test: `packages/shell/tests/pixi-hb/renderer-bar.test.ts` (create)

**Interfaces:**
- Produces:
  - `export interface HbBar extends Container { balanceValue?: Text; winValue?: Text; applyFit(): void; menuAnchor(): Rect | null; menuPlate(): Rect | null; fitScale(): number; safeArea(): SafeArea }`, in `PixiHbRenderer.ts`.
  - `PixiHbRendererOptions.bar?: (ctx: PixiComponentContext) => HbBar`.
  - `export function autoplayDiscMode(state): SpinAutoplayMode`, in `BottomBar.ts`. It exists today and is only made public.
  - `BottomBar.safeArea(): SafeArea`.

- [ ] **Step 1: Write the failing test**

Create `packages/shell/tests/pixi-hb/renderer-bar.test.ts`:

```ts
import '../pixi/setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect } from 'vitest';
import { Container } from 'pixi.js';
import type { Application } from 'pixi.js';
import { PixiHbRenderer, type HbBar } from '@/ui/pixi-hb/PixiHbRenderer';
import { ShellController } from '@/core/ShellController';

const stubTicker = { add() {}, remove() {} };

/** Minimal Application stub exposing only what the renderer's mount + resize touch. */
function fakeApp(w: number, h: number): Application {
  return {
    screen: { width: w, height: h },
    ticker: stubTicker,
    renderer: { on() {}, off() {} },
    stage: new Container(),
  } as unknown as Application;
}

function fakeBar(): HbBar {
  const bar = new Container() as HbBar;
  Object.assign(bar, {
    applyFit() {},
    menuAnchor: () => null,
    menuPlate: () => null,
    fitScale: () => 1,
    safeArea: () => ({ top: 0, right: 120, bottom: 0, left: 80 }),
  });
  return bar;
}

function mount(renderer: PixiHbRenderer): ShellController {
  return new ShellController({
    renderer,
    language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [1, 2],
    defaultBet: 1,
    currentBet: null,
    balance: 100,
    win: 0,
    mode: 'base',
    gameInfo: { sections: [] },
    features: { turbo: 0, autoplay: false, buyBonus: false },
  });
}

describe('PixiHbRenderer — pluggable bar', () => {
  it('builds the injected bar and reports its safe area; barHeight is its bottom inset', () => {
    let built = 0;
    const r = new PixiHbRenderer({
      app: fakeApp(1200, 675),
      parent: new Container(),
      bar: () => {
        built++;
        return fakeBar();
      },
    });
    mount(r);
    expect(built).toBeGreaterThan(0);
    expect(r.safeArea).toEqual({ top: 0, right: 120, bottom: 0, left: 80 });
    expect(r.barHeight).toBe(0);
  });

  it('defaults to the HB bottom bar: bottom-only inset equal to barHeight', () => {
    const r = new PixiHbRenderer({ app: fakeApp(1200, 675), parent: new Container() });
    mount(r);
    expect(r.safeArea.left).toBe(0);
    expect(r.safeArea.right).toBe(0);
    expect(r.barHeight).toBeGreaterThan(0);
    expect(r.safeArea.bottom).toBe(r.barHeight);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd packages/shell && npx vitest run tests/pixi-hb/renderer-bar.test.ts`
Expected: FAIL. The first test's `safeArea` equals `{top:0,right:0,bottom:<n>,left:0}`, because the `bar` option is ignored.

- [ ] **Step 3: Add the hook to `PixiHbRenderer.ts`**

Change the `@/core/renderer` type import to also bring `SafeArea`, and add the `Rect` import:

```ts
import type { ShellRenderer, ShellHost, OverlayRequest, OverlayHandle, SafeArea } from '@/core/renderer';
import type { Rect } from '@/core/popover';
```

Replace the `PixiHbRendererOptions` interface with:

```ts
/** What PixiHbRenderer needs from a control bar. HB's BottomBar and the S skin's SideBar implement
 *  it; the renderer rebuilds the bar through `PixiHbRendererOptions.bar` on every renderBar(). */
export interface HbBar extends Container {
  /** Value Texts `animateMoney` counts up (absent when that readout is hidden). */
  balanceValue?: Text;
  winValue?: Text;
  /** Position and scale the freshly built bar for the current screen. */
  applyFit(): void;
  /** Screen rect of the burger — the menu popover's pointer. */
  menuAnchor(): Rect | null;
  /** Screen rect the menu popover places itself against. */
  menuPlate(): Rect | null;
  /** The bar's own content scale (the popover matches it). */
  fitScale(): number;
  /** Screen-space insets the scene should avoid. */
  safeArea(): SafeArea;
}

export interface PixiHbRendererOptions {
  app: Application;
  parent?: Container;
  /** Build the control bar. Default: HB's BottomBar. */
  bar?: (ctx: PixiComponentContext) => HbBar;
}
```

In the class, change the `bar` field type and add the factory field:

```ts
  private bar?: HbBar;
  private makeBar: (ctx: PixiComponentContext) => HbBar;
```

Constructor:

```ts
  constructor(opts: PixiHbRendererOptions) {
    this.app = opts.app;
    this.parent = opts.parent;
    this.makeBar = opts.bar ?? ((ctx) => new BottomBar(ctx));
  }
```

In `renderBar()`, replace `this.bar = new BottomBar(this.ctx);` with:

```ts
    this.bar = this.makeBar(this.ctx);
```

Replace the `barHeight` and `safeArea` getters (the block under `// ── safe area / visibility`) with:

```ts
  /** The bar's bottom inset in px — 0 before first layout, or for a bar that reserves no bottom strip. */
  get barHeight(): number {
    return this.safeArea.bottom;
  }

  /** Insets a scene should avoid, as the bar reports them (HB: the bottom strip; S: the side columns). */
  get safeArea(): SafeArea {
    return this.bar?.safeArea() ?? { top: 0, right: 0, bottom: 0, left: 0 };
  }
```

- [ ] **Step 4: Make `BottomBar` implement `HbBar`**

In `packages/shell/src/ui/pixi-hb/components/BottomBar.ts`:

Add imports:

```ts
import type { HbBar } from '../PixiHbRenderer';
import type { SafeArea } from '@/core/renderer';
```

Export the existing helper (change `function autoplayDiscMode` to `export function autoplayDiscMode`).

Change the class line to `export class BottomBar extends Container implements HbBar {`.

Add this method right after `fitScale()`:

```ts
  /** Only the bottom strip is reserved; the rest of the screen is full-bleed. */
  safeArea(): SafeArea {
    return { top: 0, right: 0, bottom: this.height, left: 0 };
  }
```

- [ ] **Step 5: Run the new test and the whole shell suite**

Run: `cd packages/shell && npx vitest run tests/pixi-hb/renderer-bar.test.ts`
Expected: PASS (2 tests).

Run: `npm test --workspace @energy8platform/shell` (from the repo root)
Expected: every test passes. HB's suites are unchanged.

Run: `npm run typecheck --workspace @energy8platform/shell`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add packages/shell/src/ui/pixi-hb/PixiHbRenderer.ts packages/shell/src/ui/pixi-hb/components/BottomBar.ts packages/shell/tests/pixi-hb/renderer-bar.test.ts
git commit -m "Let a skin supply its own bar to the HB renderer

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: S foundations — palette, font, text, glyphs

**Files:**
- Create: `packages/shell/src/ui/pixi-s/theme.ts`
- Create: `packages/shell/fonts/montserrat-latin-800.woff2`, `packages/shell/fonts/montserrat-cyrillic-800.woff2`, `packages/shell/fonts/OFL-montserrat.txt` (downloaded)
- Create: `packages/shell/scripts/build-s-fonts.mjs`
- Create: `packages/shell/src/ui/pixi-s/fonts.ts` (generated by the script)
- Create: `packages/shell/src/ui/pixi-s/text.ts`
- Create: `packages/shell/src/ui/pixi-s/icons.ts`
- Test: `packages/shell/tests/pixi-s/foundation.test.ts` (create)

**Interfaces:**
- Consumes: `makeText`, `FONT_FAMILY` from `../pixi-hb/text`; `installFontFaces(css, styleId)` from `@/core/fontface`.
- Produces:
  - `S` (palette object), `SHADOW_ALPHA = 0.45` and `DISABLED_ALPHA = 0.4`, from `theme.ts`.
  - `S_FONT_FAMILY = 'MontserratS'` and `S_FONT_CSS`, from `fonts.ts`.
  - From `text.ts`: `S_FAMILY: string`, `installSFont(): void`, `sLabel(str: string, size: number, color?: string): Text` (uppercase, default `S.yellow`) and `sValue(str: string, size: number, color?: string): Text` (default `S.fg`).
  - From `icons.ts`: `type SIconName = 'mask' | 'play' | 'bolt'`, `S_ICON_NAMES`, `sIconSVG(name, color): string` and `sIcon(name: SIconName, size: number, color: string): Graphics`. `sIcon` returns a `size × size` box with a cached, shared context per `name|color`.

- [ ] **Step 1: Write the failing test**

Create `packages/shell/tests/pixi-s/foundation.test.ts`:

```ts
import '../pixi/setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect } from 'vitest';
import { parseFontFaces } from '@/core/fontface';
import { S_FONT_CSS, S_FONT_FAMILY } from '@/ui/pixi-s/fonts';
import { sIcon, sIconSVG, S_ICON_NAMES } from '@/ui/pixi-s/icons';
import { sLabel, sValue, S_FAMILY } from '@/ui/pixi-s/text';
import { S } from '@/ui/pixi-s/theme';

describe('S foundations', () => {
  it('embeds Montserrat 800 as one Latin and one Cyrillic face', () => {
    const faces = parseFontFaces(S_FONT_CSS);
    expect(faces.map((f) => f.family)).toEqual([S_FONT_FAMILY, S_FONT_FAMILY]);
    expect(faces.every((f) => f.weight === '800')).toBe(true);
    expect(faces[0].unicodeRange).toContain('U+0000-00FF');
    expect(faces[1].unicodeRange).toContain('U+0400-045F');
    expect(faces.every((f) => f.b64.length > 10_000)).toBe(true);
  });

  it('labels are uppercase yellow in the S family; values keep their case', () => {
    const label = sLabel('Balance', 14);
    expect(label.text).toBe('BALANCE');
    expect(label.style.fill).toBe(S.yellow);
    expect(label.style.fontFamily).toBe(S_FAMILY);
    expect(label.style.fontWeight).toBe('800');
    const value = sValue('€1,000.00', 24);
    expect(value.text).toBe('€1,000.00');
    expect(value.style.fill).toBe(S.fg);
  });

  it('glyphs: the colour is substituted, the box scales to size, contexts are shared', () => {
    for (const n of S_ICON_NAMES) expect(sIconSVG(n, '#123456')).not.toContain('currentColor');
    const a = sIcon('mask', 48, S.ink);
    const b = sIcon('mask', 30, S.ink);
    expect(a.context).toBe(b.context);
    expect(a.scale.x).toBe(2);
    expect(sIcon('mask', 24, S.yellow).context).not.toBe(a.context);
    expect(a.getLocalBounds().width).toBeGreaterThan(20); // the mask spans most of its 24-unit box
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd packages/shell && npx vitest run tests/pixi-s/foundation.test.ts`
Expected: FAIL. Vite reports that `@/ui/pixi-s/fonts` cannot be resolved.

- [ ] **Step 3: Palette**

Create `packages/shell/src/ui/pixi-s/theme.ts`:

```ts
/** The S palette — sampled from the reference screenshot (2026-09-29). Fixed by brand, like HB:
 *  `theme.scheme` / `theme.accent` never reach the S bar. */
export const S = {
  yellow: '#f8be45', // SPIN / BUY faces, labels, ± glyphs, an engaged tab
  yellowHover: '#e9ae36',
  yellowDot: '#d8a63d', // halftone on yellow
  plate: '#0b0b0b', // the black slab
  plateHover: '#1b1b1b',
  plateDot: '#1c1c1c', // halftone on black
  red: '#e0301e', // BUY while a feature is active
  redHover: '#c42716',
  shadow: '#000000',
  fg: '#f4f2eb', // values, white glyphs
  ink: '#0b0b0b', // glyphs and text on yellow
} as const;

export const SHADOW_ALPHA = 0.45;
export const DISABLED_ALPHA = 0.4;
```

- [ ] **Step 4: Download the font subsets and the licence**

Run from the repo root:

```bash
cd packages/shell
curl -sfLo fonts/montserrat-latin-800.woff2 https://cdn.jsdelivr.net/npm/@fontsource/montserrat@5.3.0/files/montserrat-latin-800-normal.woff2
curl -sfLo fonts/montserrat-cyrillic-800.woff2 https://cdn.jsdelivr.net/npm/@fontsource/montserrat@5.3.0/files/montserrat-cyrillic-800-normal.woff2
curl -sfLo fonts/OFL-montserrat.txt https://cdn.jsdelivr.net/npm/@fontsource/montserrat@5.3.0/LICENSE
ls -l fonts/montserrat-*.woff2 fonts/OFL-montserrat.txt
head -c 4 fonts/montserrat-latin-800.woff2 | od -c | head -1
```

Expected: the latin file is about 19KB, the cyrillic file about 11KB, and the licence starts with "Copyright 2011 The Montserrat Project Authors". The first 4 bytes are `w O F 2`.

- [ ] **Step 5: The font generator**

Create `packages/shell/scripts/build-s-fonts.mjs`:

```js
#!/usr/bin/env node
// Regenerates src/ui/pixi-s/fonts.ts — the S shell face, Montserrat ExtraBold (800, SIL OFL 1.1,
// fonts/OFL-montserrat.txt), embedded as base64 woff2 so the shell renders identically everywhere with
// no runtime fetch (same approach as build-hb-fonts.mjs). Two subsets from @fontsource/montserrat@5.3.0,
// each with its Google Fonts unicode-range so the browser picks the face per glyph:
//   fonts/montserrat-latin-800.woff2, fonts/montserrat-cyrillic-800.woff2
// Run from the package root:  node scripts/build-s-fonts.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const FAMILY = 'MontserratS'; // not 'Montserrat' — never collide with a game's own copy of the family
const SUBSETS = [
  [
    'montserrat-latin-800.woff2',
    'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
  ],
  ['montserrat-cyrillic-800.woff2', 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116'],
];

let css = '';
const sizes = [];
for (const [file, range] of SUBSETS) {
  const buf = await readFile(resolve(here, '../fonts', file));
  sizes.push(`${file} ${buf.length}B`);
  css +=
    `@font-face{font-family:'${FAMILY}';font-style:normal;font-display:swap;font-weight:800;` +
    `src:url(data:font/woff2;base64,${buf.toString('base64')}) format('woff2');unicode-range:${range};}`;
}

const header = `/* eslint-disable */
// S shell face: Montserrat ExtraBold (800, SIL OFL 1.1 — fonts/OFL-montserrat.txt) as base64 woff2,
// Latin + Cyrillic subsets. GENERATED by scripts/build-s-fonts.mjs — regenerate, don't hand-edit.
`;
const body =
  `export const S_FONT_FAMILY = '${FAMILY}';\n\n` +
  `export const S_FONT_CSS =\n  \`${css}\`;\n`;
await writeFile(resolve(here, '../src/ui/pixi-s/fonts.ts'), header + '\n' + body);
console.log(`wrote fonts.ts: ${sizes.join(', ')}`);
```

Run: `cd packages/shell && node scripts/build-s-fonts.mjs`
Expected: `wrote fonts.ts: montserrat-latin-800.woff2 19012B, montserrat-cyrillic-800.woff2 11180B` (the sizes may differ slightly), and `src/ui/pixi-s/fonts.ts` now exists.

- [ ] **Step 6: Text helpers**

Create `packages/shell/src/ui/pixi-s/text.ts`:

```ts
import type { Text } from 'pixi.js';
import { installFontFaces } from '@/core/fontface';
import { makeText, FONT_FAMILY } from '../pixi-hb/text';
import { S_FONT_CSS, S_FONT_FAMILY } from './fonts';
import { S } from './theme';

// The S bar draws every label and value in Montserrat ExtraBold. HB's overlays keep their own faces
// (installed by the HB renderer); this module only adds the S face and two text styles.

const STYLE_ID = '__ge-pixi-s-font__';

/** Montserrat first, then the shell's Inter stack — glyphs outside the two subsets (e.g. ₽) fall back. */
export const S_FAMILY = `${S_FONT_FAMILY}, ${FONT_FAMILY}`;

let installed = false;

/** Idempotently register the S face (FontFace-from-bytes — Stake's CSP blocks data: font URLs). */
export function installSFont(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  installFontFaces(S_FONT_CSS, STYLE_ID);
  // `.load()` returns a promise — a try/catch only traps a synchronous throw, so swallow the rejection
  // too (WebKit rejects when a base64 face fails to decode; see pixi-hb/text.ts).
  try {
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    fonts?.load(`800 1em ${S_FONT_FAMILY}`)?.catch(() => {/* ignore — fallback fonts render meanwhile */});
  } catch {
    /* ignore — fonts API access threw synchronously */
  }
}

/** An uppercase bar label (WIN / BALANCE / BET). */
export function sLabel(str: string, size: number, color: string = S.yellow): Text {
  return makeText(str, { size, family: S_FAMILY, weight: '800', color, upper: true, letterSpacing: size * 0.02 });
}

/** A money / counter value. */
export function sValue(str: string, size: number, color: string = S.fg): Text {
  return makeText(str, { size, family: S_FAMILY, weight: '800', color });
}
```

- [ ] **Step 7: Glyphs**

Create `packages/shell/src/ui/pixi-s/icons.ts`:

```ts
import { Graphics, GraphicsContext } from 'pixi.js';

// S glyphs: 24×24 fragments with one colour slot (`currentColor`). The rest of the bar's glyphs
// (spin, stop, close, menu, minus, plus) come from HB's sheet through makeIcon.
const SVGS = {
  // The reference's mask: two eye outlines crossing in the middle, a pupil in the right eye and a
  // small wedge on each side.
  mask:
    `<path d="M19.5 6.5L9.8 17.5L7.5 17.5L5.5 15L4.5 6.5L14.2 17.5L16.5 17.5L18.5 15Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="miter"/>` +
    `<path d="M16.6 11.5L17.5 12.4L16.6 13.3L15.7 12.4Z" fill="currentColor"/>` +
    `<path d="M0.5 9.2L2.9 8.2L2.9 11.6Z" fill="currentColor"/>` +
    `<path d="M23.5 9.2L21.1 8.2L21.1 11.6Z" fill="currentColor"/>`,
  play: `<path d="M6 3.5L20 12L6 20.5Z" fill="currentColor"/>`,
  bolt: `<path d="M14 2L5 13.5L11 13.5L9.5 22L19 9.5L13 9.5L14 2Z" fill="currentColor"/>`,
} as const;

export type SIconName = keyof typeof SVGS;
export const S_ICON_NAMES = Object.keys(SVGS) as SIconName[];

/** A standalone, parseable SVG document with the colour resolved. */
export function sIconSVG(name: SIconName, color: string): string {
  return `<svg viewBox="0 0 24 24">${SVGS[name].split('currentColor').join(color)}</svg>`;
}

const cache = new Map<string, GraphicsContext>();

/** An S glyph as a `size × size` box. Contexts are parsed once per name|colour and shared: the bar
 *  is rebuilt on most state changes, and `destroy({ children: true })` leaves a shared context alone. */
export function sIcon(name: SIconName, size: number, color: string): Graphics {
  const key = `${name}|${color}`;
  let ctx = cache.get(key);
  if (!ctx) {
    ctx = new GraphicsContext().svg(sIconSVG(name, color));
    cache.set(key, ctx);
  }
  const g = new Graphics(ctx);
  g.scale.set(size / 24);
  return g;
}
```

- [ ] **Step 8: Run the test and typecheck**

Run: `cd packages/shell && npx vitest run tests/pixi-s/foundation.test.ts`
Expected: PASS (3 tests).

If `label.style.fontWeight` reads back as a different type, compare with `String(...)`. Do not change the style.

Run: `npm run typecheck --workspace @energy8platform/shell` (from the repo root)
Expected: exits 0.

- [ ] **Step 9: Commit**

```bash
git add packages/shell/src/ui/pixi-s/theme.ts packages/shell/src/ui/pixi-s/fonts.ts packages/shell/src/ui/pixi-s/text.ts packages/shell/src/ui/pixi-s/icons.ts packages/shell/scripts/build-s-fonts.mjs packages/shell/fonts/montserrat-latin-800.woff2 packages/shell/fonts/montserrat-cyrillic-800.woff2 packages/shell/fonts/OFL-montserrat.txt packages/shell/tests/pixi-s/foundation.test.ts
git commit -m "S shell foundations: palette, Montserrat ExtraBold, mask/play/bolt glyphs

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The slab primitive

**Files:**
- Create: `packages/shell/src/ui/pixi-s/slab.ts`
- Test: `packages/shell/tests/pixi-s/slab.test.ts` (create)

**Interfaces:**
- Consumes: `S` and `SHADOW_ALPHA` from `./theme`.
- Produces, from `slab.ts`:
  - `type Corners`, `FLAT` and `SKEW` (presets `menu`, `readout`, `bet`, `buy`, `spin`, `tab`);
  - constants `DOT_STEP = 6`, `DOT_R = 1.1`, `SHADOW_OFFSET = 3`, `TOOTH_W = 8`, `TOOTH_D = 5`;
  - `slabPoints(w, h, corners?, sawtooth?): number[]` (a flat `[x,y,…]` list, clockwise from the top-left);
  - `halftone(w, h, corners, sawtooth, fade): Array<[x, y, r]>`;
  - `interface SlabOpts { face: string; dots?: string; fade?: boolean; corners?: Corners; sawtooth?: boolean; shadow?: boolean }`;
  - `class Slab extends Container`, with `readonly w`, `readonly h` (both rounded to whole px) and `setFace(color)`. Its children are, in order: shadow (when on), face, dots (when `dots` is set).

- [ ] **Step 1: Write the failing test**

Create `packages/shell/tests/pixi-s/slab.test.ts`:

```ts
import '../pixi/setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect } from 'vitest';
import type { Graphics } from 'pixi.js';
import { Slab, SKEW, FLAT, TOOTH_D, DOT_R, slabPoints, halftone } from '@/ui/pixi-s/slab';
import { S } from '@/ui/pixi-s/theme';

const dotsOf = (s: Slab) => s.children[s.children.length - 1] as Graphics;

describe('slab', () => {
  it('every skew preset keeps the quad inside its box', () => {
    for (const corners of Object.values(SKEW)) {
      const p = slabPoints(100, 40, corners);
      expect(p).toHaveLength(8);
      for (let i = 0; i < p.length; i += 2) {
        expect(p[i]).toBeGreaterThanOrEqual(0);
        expect(p[i]).toBeLessThanOrEqual(100);
        expect(p[i + 1]).toBeGreaterThanOrEqual(0);
        expect(p[i + 1]).toBeLessThanOrEqual(40);
      }
    }
  });

  it('the sawtooth hangs its teeth to the box bottom and ends on the base line at bottom-left', () => {
    const p = slabPoints(200, 100, FLAT, true);
    const ys = p.filter((_, i) => i % 2 === 1);
    expect(Math.max(...ys)).toBe(100);
    expect(p.slice(-2)).toEqual([0, 100 - TOOTH_D]);
    expect(p.length / 2).toBeGreaterThan(20);
  });

  it('halftone dots lie inside the quad; on black they thin out toward the top-right', () => {
    const dots = halftone(240, 60, SKEW.readout, false, true);
    expect(dots.length).toBeGreaterThan(50);
    for (const [x, y, r] of dots) {
      expect(x - r).toBeGreaterThanOrEqual(0);
      expect(x + r).toBeLessThanOrEqual(240);
      expect(y - r).toBeGreaterThanOrEqual(0);
      expect(y + r).toBeLessThanOrEqual(60);
    }
    const mass = (pick: (x: number, y: number) => boolean) =>
      dots.filter(([x, y]) => pick(x, y)).reduce((a, d) => a + d[2] * d[2], 0);
    expect(mass((x, y) => x < 120 && y > 30)).toBeGreaterThan(2 * mass((x, y) => x >= 120 && y <= 30));
  });

  it('uniform halftone (SPIN) uses one radius and skips the teeth', () => {
    const dots = halftone(200, 100, SKEW.spin, true, false);
    expect(dots.every(([, , r]) => r === DOT_R)).toBe(true);
    expect(dots.every(([, y, r]) => y + r <= 100 - TOOTH_D)).toBe(true);
  });

  it('draws shadow, face and dots; no shadow and no dots when asked', () => {
    expect(new Slab(120, 40, { face: S.plate, dots: S.plateDot }).children).toHaveLength(3);
    expect(new Slab(120, 40, { face: S.yellow, shadow: false }).children).toHaveLength(1);
    const s = new Slab(120.4, 39.6, { face: S.plate });
    expect([s.w, s.h]).toEqual([120, 40]);
  });

  it('identical slabs share one dot context, and it survives a rebuild (destroy with children)', () => {
    const opts = { face: S.plate, dots: S.plateDot, corners: SKEW.readout };
    const a = new Slab(200, 50, opts);
    const b = new Slab(200, 50, opts);
    expect(dotsOf(a).context).toBe(dotsOf(b).context);
    a.destroy({ children: true });
    const c = new Slab(200, 50, opts);
    expect(dotsOf(c).context).toBe(dotsOf(b).context);
    expect(dotsOf(c).context.destroyed).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd packages/shell && npx vitest run tests/pixi-s/slab.test.ts`
Expected: FAIL. `@/ui/pixi-s/slab` cannot be resolved.

- [ ] **Step 3: Implement `slab.ts`**

Create `packages/shell/src/ui/pixi-s/slab.ts`:

```ts
import { Container, Graphics, GraphicsContext } from 'pixi.js';
import { S, SHADOW_ALPHA } from './theme';

// THE S pattern: a skewed plate with a drop shadow and a halftone dot texture. Every bar element is a
// Slab, so the look has a single owner (like HB's `plaque`).

/** Per-corner offsets [dx, dy] from the w×h box, clockwise from top-left. Each points INTO the box,
 *  so the quad never leaves it. Fixed per element: the "torn" skew is identical on every render. */
export type Corners = readonly [
  readonly [number, number],
  readonly [number, number],
  readonly [number, number],
  readonly [number, number],
];

export const FLAT: Corners = [[0, 0], [0, 0], [0, 0], [0, 0]];

/** Skew presets per element, in design px (they scale with the bar). */
export const SKEW = {
  menu: [[4, 0], [0, 3], [-2, 0], [0, -2]],
  readout: [[6, 2], [0, 0], [-4, 0], [0, -3]],
  bet: [[8, 0], [0, 3], [-2, 0], [0, -2]],
  buy: [[6, 0], [0, 4], [-4, 0], [4, 0]],
  spin: [[4, 3], [0, 0], [-6, -2], [0, 0]],
  tab: [[3, 0], [0, 2], [0, 0], [0, -2]],
} as const satisfies Record<string, Corners>;

export const DOT_STEP = 6;
export const DOT_R = 1.1;
export const SHADOW_OFFSET = 3;
/** Sawtooth: one tooth is TOOTH_W wide and hangs TOOTH_D below the body. */
export const TOOTH_W = 8;
export const TOOTH_D = 5;

/** The slab outline as a flat [x,y,…] list, clockwise from top-left. With `sawtooth` the body's bottom
 *  edge sits TOOTH_D higher and the teeth hang from it down to the box bottom, ending on the base line
 *  at the bottom-left corner. */
export function slabPoints(w: number, h: number, corners: Corners = FLAT, sawtooth = false): number[] {
  const base = sawtooth ? h - TOOTH_D : h;
  const [tl, tr, br, bl] = corners;
  const quad = [tl[0], tl[1], w + tr[0], tr[1], w + br[0], base + br[1], bl[0], base + bl[1]];
  if (!sawtooth) return quad;
  const [x1, y1, x0, y0] = [quad[4], quad[5], quad[6], quad[7]]; // bottom edge, br → bl
  // An even segment count, so the walk ends on the base line (tooth tips are the odd points).
  const n = Math.max(2, 2 * Math.round(Math.hypot(x1 - x0, y1 - y0) / TOOTH_W));
  const pts = quad.slice(0, 6); // tl, tr, br
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const x = x1 + (x0 - x1) * t;
    const y = y1 + (y0 - y1) * t;
    pts.push(x, i % 2 === 1 ? y + TOOTH_D : y);
  }
  return pts;
}

/** Even-odd point-in-polygon over a flat [x,y,…] list. */
function inside(pts: number[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i];
    const yi = pts[i + 1];
    const xj = pts[j];
    const yj = pts[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Halftone dot centres and radii. A dot is kept only when its four extreme points lie inside the
 *  body quad (so no mask is needed). `fade`: the radius shrinks from full at the bottom-left to
 *  nothing toward the top-right, as on the reference's black plates; otherwise every dot is DOT_R. */
export function halftone(w: number, h: number, corners: Corners, sawtooth: boolean, fade: boolean): Array<[number, number, number]> {
  const quad = slabPoints(w, sawtooth ? h - TOOTH_D : h, corners);
  const out: Array<[number, number, number]> = [];
  for (let y = DOT_STEP / 2; y < h; y += DOT_STEP) {
    for (let x = DOT_STEP / 2; x < w; x += DOT_STEP) {
      const k = fade ? Math.min(1, Math.max(0, 0.15 + (y / h) * 1.1 - (x / w) * 0.35)) : 1;
      const r = DOT_R * k;
      if (r < 0.35) continue;
      if (inside(quad, x - r, y) && inside(quad, x + r, y) && inside(quad, x, y - r) && inside(quad, x, y + r)) {
        out.push([x, y, r]);
      }
    }
  }
  return out;
}

// One context per slab size / corners / colour / fade — the bar is rebuilt on ~20 state changes per
// spin, and with whole-px sizes the cache is bounded by the number of distinct slabs.
const dotCache = new Map<string, GraphicsContext>();

function dotContext(w: number, h: number, corners: Corners, sawtooth: boolean, fade: boolean, color: string): GraphicsContext {
  const key = `${w}|${h}|${corners.flat().join(',')}|${sawtooth}|${fade}|${color}`;
  let ctx = dotCache.get(key);
  if (!ctx) {
    ctx = new GraphicsContext();
    for (const [x, y, r] of halftone(w, h, corners, sawtooth, fade)) ctx.circle(x, y, r);
    ctx.fill(color);
    dotCache.set(key, ctx);
  }
  return ctx;
}

export interface SlabOpts {
  face: string;
  /** Halftone dot colour; omitted = a plain face. */
  dots?: string;
  /** Dots thin out toward the top-right (black plates). Default true; SPIN passes false. */
  fade?: boolean;
  corners?: Corners;
  /** Zig-zag bottom edge (SPIN / FS counter). */
  sawtooth?: boolean;
  /** Offset darker copy behind the face. Default true. */
  shadow?: boolean;
}

/** One skewed plate: shadow + face (repainted by `setFace`, e.g. on hover) + a shared dot context. */
export class Slab extends Container {
  readonly w: number;
  readonly h: number;
  private faceG = new Graphics();
  private points: number[];

  constructor(w: number, h: number, opts: SlabOpts) {
    super();
    this.w = Math.round(w);
    this.h = Math.round(h);
    const corners = opts.corners ?? FLAT;
    const sawtooth = !!opts.sawtooth;
    this.points = slabPoints(this.w, this.h, corners, sawtooth);
    if (opts.shadow !== false) {
      const shadow = new Graphics().poly(this.points).fill({ color: S.shadow, alpha: SHADOW_ALPHA });
      shadow.position.set(SHADOW_OFFSET, SHADOW_OFFSET);
      this.addChild(shadow);
    }
    this.addChild(this.faceG);
    this.setFace(opts.face);
    if (opts.dots) {
      this.addChild(new Graphics(dotContext(this.w, this.h, corners, sawtooth, opts.fade !== false, opts.dots)));
    }
  }

  setFace(color: string): void {
    this.faceG.clear().poly(this.points).fill(color);
  }
}
```

- [ ] **Step 4: Run the test and typecheck**

Run: `cd packages/shell && npx vitest run tests/pixi-s/slab.test.ts`
Expected: PASS (6 tests).

Run: `npm run typecheck --workspace @energy8platform/shell`
Expected: exits 0. If TypeScript rejects `as const satisfies`, drop `satisfies Record<string, Corners>` and keep `as const`. The preset test still guards the shape.

- [ ] **Step 5: Commit**

```bash
git add packages/shell/src/ui/pixi-s/slab.ts packages/shell/tests/pixi-s/slab.test.ts
git commit -m "S slab: skewed plate, drop shadow, cached halftone, sawtooth edge

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: S widgets

**Files:**
- Create: `packages/shell/src/ui/pixi-s/widgets.ts`
- Test: `packages/shell/tests/pixi-s/widgets.test.ts` (create)

**Interfaces:**
- Consumes:
  - `attachHover`, `attachPress` and `type SpinAutoplayMode` (`'off' | 'running' | 'paused'`) from `../pixi-hb/primitives/widgets`;
  - `makeIcon(name, size, { ink, fill })` and `IconView` (it has `spin` and `iconName`) from `../pixi-hb/pixi-icon`;
  - `Slab`, `SKEW`, `TOOTH_D`, `slabPoints` and `Corners` from `./slab`;
  - `sIcon` from `./icons`;
  - `sLabel` and `sValue` from `./text`;
  - `S` and `DISABLED_ALPHA` from `./theme`.
- Produces, from `widgets.ts`:
  - `type SFace = 'plate' | 'yellow' | 'red'`.
  - `interface Sized extends Container { measureSize(): { w: number; h: number } }`.
  - `class SButton(opts: SButtonOpts)`, with `readonly slab`, `face` and `glyph`, `disabled` get/set, and `measureSize()`.
  - `class SStep(name: 'minus' | 'plus', glyph: number, box: number, onTap)`, with `disabled` get/set.
  - `class SReadout(opts)`, with `readonly valueText`, `labelText` and `slab`, and `measureSize()`.
  - `class SBet(opts)`, with `readonly valueText`, `labelText`, `slab` and `valueHit`, `up?: SStep`, `down?: SStep`, and `measureSize()`.
  - `class SSpin(opts)`, with `mode` (`'spin' | 'stop' | 'resume'`), `count?: string`, `setBusy(b)`, `disabled` get/set, and `measureSize()`.
  - `class SFsCounter(opts)`, with `readonly valueText` and `slab`, and `measureSize()`.

- [ ] **Step 1: Write the failing test**

Create `packages/shell/tests/pixi-s/widgets.test.ts`:

```ts
import '../pixi/setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect, vi } from 'vitest';
import type { Ticker } from 'pixi.js';
import { SButton, SReadout, SBet, SSpin, SFsCounter, type SSpinOpts } from '@/ui/pixi-s/widgets';
import { SKEW } from '@/ui/pixi-s/slab';
import { sIcon } from '@/ui/pixi-s/icons';
import { S, DISABLED_ALPHA } from '@/ui/pixi-s/theme';

const tap = (n: { emit(event: string, ...args: unknown[]): unknown }) => n.emit('pointertap', {});

function fakeTicker(): { fns: Set<unknown>; ticker: Ticker } {
  const fns = new Set<unknown>();
  return { fns, ticker: { add: (f: unknown) => fns.add(f), remove: (f: unknown) => fns.delete(f) } as unknown as Ticker };
}

function spin(over: Partial<SSpinOpts> = {}): { s: SSpin; calls: string[] } {
  const calls: string[] = [];
  const s = new SSpin({
    w: 260,
    h: 136,
    glyph: 84,
    ticker: fakeTicker().ticker,
    autoplay: 'off',
    remaining: 0,
    onSpin: () => calls.push('spin'),
    onStop: () => calls.push('stop'),
    onResume: () => calls.push('resume'),
    ...over,
  });
  return { s, calls };
}

describe('S widgets', () => {
  it('SButton taps unless disabled; disabled dims and stops hit-testing', () => {
    const onTap = vi.fn();
    const b = new SButton({ w: 64, h: 44, face: 'plate', corners: SKEW.menu, glyph: sIcon('play', 20, S.fg), glyphSize: 20, onTap });
    tap(b);
    expect(onTap).toHaveBeenCalledTimes(1);
    b.disabled = true;
    tap(b);
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(b.alpha).toBe(DISABLED_ALPHA);
    expect(b.eventMode).toBe('none');
    expect(b.measureSize()).toEqual({ w: 64, h: 44 });
  });

  it('SButton centres its glyph in the part not tucked under a neighbour', () => {
    const g = sIcon('bolt', 20, S.fg);
    new SButton({ w: 52, h: 40, face: 'plate', corners: SKEW.tab, glyph: g, glyphSize: 20, insetRight: 12, onTap: () => {} });
    expect(g.x).toBe(10);
    expect(g.y).toBe(10);
  });

  it('SReadout keeps its design width for short values and grows for long ones', () => {
    const short = new SReadout({ label: 'Win', value: '€0.00', w: 280, h: 54, labelSize: 15, valueSize: 26 });
    expect(short.measureSize()).toEqual({ w: 280, h: 54 });
    const long = new SReadout({ label: 'Balance', value: '€10,000,000,000.00', w: 280, h: 54, labelSize: 15, valueSize: 26 });
    expect(long.measureSize().w).toBeGreaterThan(280);
    expect(long.valueText.x + long.valueText.width).toBeLessThanOrEqual(long.measureSize().w);
    expect(long.labelText.text).toBe('BALANCE');
  });

  it('SBet: ± step (unless disabled), the value opens the picker, no stepper when asked', () => {
    const steps: number[] = [];
    const onValue = vi.fn();
    const bet = new SBet({ label: 'Bet', value: '€1.00', w: 290, h: 46, labelSize: 14, valueSize: 24, stepper: true, onStep: (d) => steps.push(d), onValue });
    tap(bet.up!);
    tap(bet.down!);
    tap(bet.valueHit);
    expect(steps).toEqual([1, -1]);
    expect(onValue).toHaveBeenCalledTimes(1);
    bet.up!.disabled = true;
    tap(bet.up!);
    expect(steps).toEqual([1, -1]);
    expect(bet.up!.x + 46).toBe(bet.measureSize().w); // + sits at the right end, − at the left
    expect(bet.down!.x).toBe(0);
    const bare = new SBet({ label: 'Bet', value: '€1.00', w: 290, h: 46, labelSize: 14, valueSize: 24, stepper: false, onStep: () => {} });
    expect(bare.up).toBeUndefined();
    expect(bare.down).toBeUndefined();
  });

  it('SSpin: spin / stop / resume by autoplay state; the count shows, ∞ for an endless run', () => {
    const a = spin();
    tap(a.s);
    expect(a.s.mode).toBe('spin');
    expect(a.calls).toEqual(['spin']);
    const r = spin({ autoplay: 'running', remaining: 5 });
    tap(r.s);
    expect(r.s.mode).toBe('stop');
    expect(r.s.count).toBe('5');
    expect(r.calls).toEqual(['stop']);
    const p = spin({ autoplay: 'paused', remaining: 4 });
    tap(p.s);
    expect(p.s.mode).toBe('resume');
    expect(p.s.count).toBe('4');
    expect(p.calls).toEqual(['resume']);
    expect(spin({ autoplay: 'running', remaining: Infinity }).s.count).toBe('∞');
  });

  it('SSpin: disabled ignores taps; busy rotates the glyph on the ticker until destroyed', () => {
    const { fns, ticker } = fakeTicker();
    const { s, calls } = spin({ ticker });
    s.disabled = true;
    tap(s);
    expect(calls).toEqual([]);
    expect(s.disabled).toBe(true);
    s.setBusy(true);
    s.setBusy(true);
    expect(fns.size).toBe(1);
    s.destroy({ children: true });
    expect(fns.size).toBe(0);
  });

  it('SFsCounter shows the label and the counter, centred', () => {
    const fs = new SFsCounter({ w: 260, h: 136, label: 'Free spins', value: '3 / 10', labelSize: 15, valueSize: 34 });
    expect(fs.valueText.text).toBe('3 / 10');
    expect(fs.valueText.x).toBeCloseTo((260 - fs.valueText.width) / 2, 5);
    expect(fs.measureSize()).toEqual({ w: 260, h: 136 });
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd packages/shell && npx vitest run tests/pixi-s/widgets.test.ts`
Expected: FAIL. `@/ui/pixi-s/widgets` cannot be resolved.

- [ ] **Step 3: Implement `widgets.ts`**

Create `packages/shell/src/ui/pixi-s/widgets.ts`:

```ts
import { Container, Graphics, Rectangle, type Text, type Ticker } from 'pixi.js';
import { attachHover, attachPress, type SpinAutoplayMode } from '../pixi-hb/primitives/widgets';
import { makeIcon, type IconView } from '../pixi-hb/pixi-icon';
import { Slab, SKEW, TOOTH_D, slabPoints, type Corners } from './slab';
import { sIcon } from './icons';
import { sLabel, sValue } from './text';
import { S, DISABLED_ALPHA } from './theme';

// S interactive pieces. Each is built fresh on every bar render (the renderer rebuilds the bar on
// state changes), so none of them needs an "update" path — they read their state once.

export type SFace = 'plate' | 'yellow' | 'red';

const FACES: Record<SFace, { fill: string; hover: string }> = {
  plate: { fill: S.plate, hover: S.plateHover },
  yellow: { fill: S.yellow, hover: S.yellowHover },
  red: { fill: S.red, hover: S.redHover },
};

/** Anything the SideBar stacks: a Container that knows its design box. */
export interface Sized extends Container {
  measureSize(): { w: number; h: number };
}

function setDisabled(node: Container, v: boolean): void {
  node.alpha = v ? DISABLED_ALPHA : 1;
  node.eventMode = v ? 'none' : 'static';
  node.cursor = v ? 'default' : 'pointer';
}

export interface SButtonOpts {
  w: number;
  h: number;
  face: SFace;
  corners: Corners;
  /** The glyph; its box is `glyphSize` square (an IconView or an sIcon). */
  glyph: Container;
  glyphSize: number;
  /** Right strip hidden under a neighbour (the tabs under SPIN): the glyph centres in what is left. */
  insetRight?: number;
  onTap: () => void;
}

/** A slab with a centred glyph: the burger, BUY and the autoplay / turbo tabs. Only black slabs carry
 *  the halftone — the yellow and red faces are plain, as in the reference. */
export class SButton extends Container implements Sized {
  readonly slab: Slab;
  readonly face: SFace;
  readonly glyph: Container;
  private _disabled = false;

  constructor(o: SButtonOpts) {
    super();
    const f = FACES[o.face];
    this.face = o.face;
    this.slab = new Slab(o.w, o.h, { face: f.fill, dots: o.face === 'plate' ? S.plateDot : undefined, corners: o.corners });
    this.glyph = o.glyph;
    this.glyph.position.set((o.w - (o.insetRight ?? 0) - o.glyphSize) / 2, (o.h - o.glyphSize) / 2);
    this.addChild(this.slab, this.glyph);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.hitArea = new Rectangle(0, 0, o.w, o.h);
    attachHover(this, () => this.slab.setFace(f.hover), () => this.slab.setFace(f.fill));
    attachPress(this, 0.94, () => {
      if (!this._disabled) o.onTap();
    });
  }

  set disabled(v: boolean) {
    this._disabled = v;
    setDisabled(this, v);
  }
  get disabled(): boolean {
    return this._disabled;
  }

  measureSize(): { w: number; h: number } {
    return { w: this.slab.w, h: this.slab.h };
  }
}

/** A bare yellow ± glyph with a square hit box (the bet stepper). */
export class SStep extends Container {
  private _disabled = false;

  constructor(name: 'minus' | 'plus', glyph: number, box: number, onTap: () => void) {
    super();
    const g = makeIcon(name, glyph, { ink: S.yellow, fill: S.yellow });
    g.position.set((box - glyph) / 2, (box - glyph) / 2);
    this.addChild(g);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.hitArea = new Rectangle(0, 0, box, box);
    attachPress(this, 0.9, () => {
      if (!this._disabled) onTap();
    });
  }

  set disabled(v: boolean) {
    this._disabled = v;
    setDisabled(this, v);
  }
  get disabled(): boolean {
    return this._disabled;
  }
}

export interface SReadoutOpts {
  label: string;
  value: string;
  w: number;
  h: number;
  labelSize: number;
  valueSize: number;
}

/** WIN / BALANCE / TOTAL WIN: the yellow caps label, then the white value, on a black slab. Grows past
 *  `w` when the value would not fit; the bar's fit scale then shrinks the whole column. */
export class SReadout extends Container implements Sized {
  readonly labelText: Text;
  readonly valueText: Text;
  readonly slab: Slab;

  constructor(o: SReadoutOpts) {
    super();
    const pad = Math.round(o.h * 0.34);
    const gap = Math.round(o.valueSize * 0.5);
    this.labelText = sLabel(o.label, o.labelSize);
    this.valueText = sValue(o.value, o.valueSize);
    const need = pad + this.labelText.width + gap + this.valueText.width + pad;
    this.slab = new Slab(Math.max(o.w, Math.ceil(need)), o.h, { face: S.plate, dots: S.plateDot, corners: SKEW.readout });
    this.labelText.position.set(pad, (o.h - this.labelText.height) / 2);
    this.valueText.position.set(pad + this.labelText.width + gap, (o.h - this.valueText.height) / 2);
    this.addChild(this.slab, this.labelText, this.valueText);
  }

  measureSize(): { w: number; h: number } {
    return { w: this.slab.w, h: this.slab.h };
  }
}

export interface SBetOpts {
  label: string;
  /** Label colour — white for BET, yellow when it names an active feature. */
  labelColor?: string;
  value: string;
  w: number;
  h: number;
  labelSize: number;
  valueSize: number;
  /** Show − / + at the slab's ends (base mode). */
  stepper: boolean;
  onStep: (dir: 1 | -1) => void;
  /** Tap on the label/value area (opens the bet picker); omitted = not tappable. */
  onValue?: () => void;
}

/** − BET value + on one black slab. The ± hit boxes are h×h squares at the ends. */
export class SBet extends Container implements Sized {
  readonly labelText: Text;
  readonly valueText: Text;
  readonly slab: Slab;
  readonly valueHit = new Container();
  readonly up?: SStep;
  readonly down?: SStep;

  constructor(o: SBetOpts) {
    super();
    const gap = Math.round(o.valueSize * 0.4);
    this.labelText = sLabel(o.label, o.labelSize, o.labelColor ?? S.fg);
    this.valueText = sValue(o.value, o.valueSize);
    const mid = this.labelText.width + gap + this.valueText.width;
    const side = o.stepper ? o.h : Math.round(o.h * 0.4);
    const w = Math.max(o.w, Math.ceil(mid + 2 * side + 2 * gap));
    this.slab = new Slab(w, o.h, { face: S.plate, dots: S.plateDot, corners: SKEW.bet });
    const x0 = (w - mid) / 2;
    this.labelText.position.set(x0, (o.h - this.labelText.height) / 2);
    this.valueText.position.set(x0 + this.labelText.width + gap, (o.h - this.valueText.height) / 2);
    this.valueHit.hitArea = new Rectangle(side, 0, w - 2 * side, o.h);
    this.addChild(this.slab, this.labelText, this.valueText, this.valueHit);
    if (o.onValue) {
      this.valueHit.eventMode = 'static';
      this.valueHit.cursor = 'pointer';
      this.valueHit.on('pointertap', o.onValue);
    }
    if (o.stepper) {
      const glyph = Math.round(o.h * 0.42);
      this.down = new SStep('minus', glyph, o.h, () => o.onStep(-1));
      this.up = new SStep('plus', glyph, o.h, () => o.onStep(1));
      this.up.position.set(w - o.h, 0);
      this.addChild(this.down, this.up);
    }
  }

  measureSize(): { w: number; h: number } {
    return { w: this.slab.w, h: this.slab.h };
  }
}

export interface SSpinOpts {
  w: number;
  h: number;
  glyph: number;
  ticker: Ticker;
  /** HB's autoplay face: off → SPIN, running → STOP + count, paused → resume + count. */
  autoplay: SpinAutoplayMode;
  remaining: number;
  onSpin: () => void;
  onStop: () => void;
  onResume: () => void;
}

/** The yellow sawtooth SPIN slab with HB's spin glyph in ink. Busy: the glyph rotates. Disabled: a
 *  dark veil over the slab (not alpha — a half-transparent yellow hero would wash out over the game). */
export class SSpin extends Container implements Sized {
  readonly slab: Slab;
  private glyph: IconView;
  private veil: Graphics;
  private countText?: Text;
  private ticker: Ticker;
  private rotTick?: (t: Ticker) => void;
  private _mode: 'spin' | 'stop' | 'resume' = 'spin';
  private _disabled = false;

  constructor(o: SSpinOpts) {
    super();
    this.ticker = o.ticker;
    this.slab = new Slab(o.w, o.h, { face: S.yellow, dots: S.yellowDot, fade: false, corners: SKEW.spin, sawtooth: true });
    const body = o.h - TOOTH_D;
    this.glyph = makeIcon('spin', o.glyph, { ink: S.ink, fill: S.ink });
    this.glyph.position.set((o.w - o.glyph) / 2, (body - o.glyph) / 2);
    this.veil = new Graphics().poly(slabPoints(o.w, o.h, SKEW.spin, true)).fill({ color: 0x000000, alpha: 0.35 });
    this.veil.visible = false;
    this.addChild(this.slab, this.glyph);
    if (o.autoplay !== 'off') this.buildAutoplay(o.autoplay === 'running', o.remaining, o.w, body);
    this.addChild(this.veil);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.hitArea = new Rectangle(0, 0, o.w, o.h);
    attachHover(this, () => this.slab.setFace(S.yellowHover), () => this.slab.setFace(S.yellow));
    attachPress(this, 0.96, () => {
      if (this._disabled) return;
      if (this._mode === 'stop') o.onStop();
      else if (this._mode === 'resume') o.onResume();
      else o.onSpin();
    });
  }

  /** Running: a black STOP square with the remaining count in yellow on it. Halted with spins left: a
   *  play glyph over the count in ink (tap resumes). */
  private buildAutoplay(running: boolean, remaining: number, w: number, body: number): void {
    this._mode = running ? 'stop' : 'resume';
    this.glyph.visible = false;
    const sq = Math.round(body * 0.62);
    const top = (body - sq) / 2;
    if (running) {
      const stop = makeIcon('stop', sq, { ink: S.ink, fill: S.ink });
      stop.position.set((w - sq) / 2, top);
      this.addChild(stop);
    } else {
      const p = Math.round(sq * 0.45);
      const play = sIcon('play', p, S.ink);
      play.position.set((w - p) / 2, top);
      this.addChild(play);
    }
    this.countText = sValue(Number.isFinite(remaining) ? String(remaining) : '∞', Math.round(sq * 0.42), running ? S.yellow : S.ink);
    const y = running ? (body - this.countText.height) / 2 : top + sq * 0.55;
    this.countText.position.set((w - this.countText.width) / 2, y);
    this.addChild(this.countText);
  }

  get mode(): 'spin' | 'stop' | 'resume' {
    return this._mode;
  }
  get count(): string | undefined {
    return this.countText?.text;
  }

  setBusy(busy: boolean): void {
    if (!busy || this._mode !== 'spin') {
      this.stopRotation();
      return;
    }
    if (this.rotTick) return;
    this.rotTick = (t: Ticker) => {
      this.glyph.spin += (t.deltaMS / 800) * Math.PI * 2;
    };
    this.ticker.add(this.rotTick);
  }

  private stopRotation(): void {
    if (this.rotTick) {
      this.ticker.remove(this.rotTick);
      this.rotTick = undefined;
    }
    this.glyph.spin = 0;
  }

  set disabled(v: boolean) {
    this._disabled = v;
    this.veil.visible = v;
    this.eventMode = v ? 'none' : 'static';
    this.cursor = v ? 'default' : 'pointer';
  }
  get disabled(): boolean {
    return this._disabled;
  }

  destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.stopRotation();
    super.destroy(options);
  }

  measureSize(): { w: number; h: number } {
    return { w: this.slab.w, h: this.slab.h };
  }
}

export interface SFsCounterOpts {
  w: number;
  h: number;
  label: string;
  value: string;
  labelSize: number;
  valueSize: number;
}

/** Replaces SPIN in free spins: the yellow sawtooth slab with an ink caps label over the counter. */
export class SFsCounter extends Container implements Sized {
  readonly slab: Slab;
  readonly valueText: Text;

  constructor(o: SFsCounterOpts) {
    super();
    this.slab = new Slab(o.w, o.h, { face: S.yellow, dots: S.yellowDot, fade: false, corners: SKEW.spin, sawtooth: true });
    const label = sLabel(o.label, o.labelSize, S.ink);
    this.valueText = sValue(o.value, o.valueSize, S.ink);
    const body = o.h - TOOTH_D;
    const gap = Math.round(o.labelSize * 0.4);
    const top = (body - label.height - gap - this.valueText.height) / 2;
    label.position.set((o.w - label.width) / 2, top);
    this.valueText.position.set((o.w - this.valueText.width) / 2, top + label.height + gap);
    this.addChild(this.slab, label, this.valueText);
  }

  measureSize(): { w: number; h: number } {
    return { w: this.slab.w, h: this.slab.h };
  }
}
```

- [ ] **Step 4: Run the test and typecheck**

Run: `cd packages/shell && npx vitest run tests/pixi-s/widgets.test.ts`
Expected: PASS (7 tests).

Run: `npm run typecheck --workspace @energy8platform/shell`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/shell/src/ui/pixi-s/widgets.ts packages/shell/tests/pixi-s/widgets.test.ts
git commit -m "S widgets: slab button, bet stepper, readout, sawtooth SPIN, FS counter

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: SideBar — wide and mobile layouts

**Files:**
- Create: `packages/shell/src/ui/pixi-s/SideBar.ts`
- Test: `packages/shell/tests/pixi-s/sidebar.test.ts` (create)

**Interfaces:**
- Consumes:
  - `HbBar` from `../pixi-hb/PixiHbRenderer` (Task 1);
  - `autoplayDiscMode` from `../pixi-hb/components/BottomBar` (Task 1);
  - `makeIcon` from `../pixi-hb/pixi-icon`;
  - `bonusBuyLocked` from `@/core/state`;
  - `Rect` from `@/core/popover`;
  - `SafeArea` from `@/core/renderer`;
  - `PixiComponentContext` from `../pixi/context`;
  - Tasks 2–4 exports.
- Produces:
  - `class SideBar extends Container implements HbBar`, constructed as `new SideBar(ctx)`.
  - Exported constants `OUTER = 16`, `SAFE_GAP = 12`, `WIDE_REF_W = 1280`, `WIDE_REF_H = 720`, `WIDE_MIN_SCALE = 0.35`, `M_REF_W = 370`, `M_SIDE = 10`, `M_BOTTOM = 8`, `M_COL_GAP = 12`.
  - Private fields that tests read through a cast: `leftCol`, `rightCol`, `block`, `menuBtn`, `totalWin?`, `win`, `balance?`, `buy?`, `bet`, `spin?`, `fs?`, `autoTab?`, `turboTab?`.

- [ ] **Step 1: Write the failing test**

Create `packages/shell/tests/pixi-s/sidebar.test.ts`:

```ts
import '../pixi/setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect } from 'vitest';
import type { Container, Graphics } from 'pixi.js';
import type { IconView } from '@/ui/pixi-hb/pixi-icon';
import { SideBar, OUTER, SAFE_GAP } from '@/ui/pixi-s/SideBar';
import type { SButton, SBet, SSpin, SFsCounter, SReadout } from '@/ui/pixi-s/widgets';
import { sIcon } from '@/ui/pixi-s/icons';
import { S } from '@/ui/pixi-s/theme';
import type { PixiComponentContext } from '@/ui/pixi/context';
import { makeContext, defaultConfig } from '../pixi/_host';

interface Parts {
  leftCol: Container;
  rightCol: Container;
  block: Container;
  menuBtn: SButton;
  totalWin?: SReadout;
  win: SReadout;
  balance?: SReadout;
  buy?: SButton;
  bet: SBet;
  spin?: SSpin;
  fs?: SFsCounter;
  autoTab?: SButton;
  turboTab?: SButton;
}
const parts = (b: SideBar) => b as unknown as Parts;

type Box = { x: number; y: number; r: number; b: number };
const box = (n: Container): Box => {
  const k = n.getBounds();
  return { x: k.x, y: k.y, r: k.x + k.width, b: k.y + k.height };
};

const FULL = { features: { turbo: 2, autoplay: {}, buyBonus: [] } };

function host(w: number, h: number, cfg: Record<string, unknown> = FULL, over: Record<string, unknown> = {}): PixiComponentContext {
  return makeContext({ config: defaultConfig(cfg), layout: h > w ? 'mobile' : 'wide', screenW: w, screenH: h, ...over });
}

function build(ctx: PixiComponentContext): SideBar {
  const bar = new SideBar(ctx);
  bar.applyFit();
  return bar;
}

function expectOnScreen(bar: SideBar, w: number, h: number): void {
  for (const col of [parts(bar).leftCol, parts(bar).rightCol]) {
    const k = box(col);
    expect(k.x).toBeGreaterThanOrEqual(0);
    expect(k.y).toBeGreaterThanOrEqual(0);
    expect(k.r).toBeLessThanOrEqual(w);
    expect(k.b).toBeLessThanOrEqual(h);
  }
}

const ANTE = { id: 'ante', type: 'feature' as const, title: 'Warrior Ante', description: '', priceMultiplier: 1.25 };

describe('S side bar — wide', () => {
  it('two bottom-anchored columns at the screen edges; menu, win, balance top to bottom', () => {
    const p = parts(build(host(1280, 720)));
    expect(p.leftCol.x).toBe(OUTER);
    const r = box(p.rightCol);
    expect(r.r).toBeGreaterThan(1280 - OUTER - 1);
    expect(r.r).toBeLessThanOrEqual(1280 - OUTER + 3); // + the slab shadow
    for (const b of [box(p.balance!).b, r.b]) {
      expect(b).toBeGreaterThan(720 - OUTER - 1);
      expect(b).toBeLessThanOrEqual(720 - OUTER + 3);
    }
    expect(box(p.menuBtn).y).toBeLessThan(box(p.win).y);
    expect(box(p.win).y).toBeLessThan(box(p.balance!).y);
  });

  it('BUY sits above BET; the tabs tuck under SPIN from its left', () => {
    const bar = build(host(1280, 720));
    const { buy, bet, spin, autoTab, turboTab, rightCol } = parts(bar);
    expect(box(buy!).b).toBeLessThanOrEqual(box(bet).y + 3);
    expect(Math.abs(box(buy!).r - box(bet).r)).toBeLessThan(1);
    const s = box(spin!);
    const a = box(autoTab!);
    const t = box(turboTab!);
    expect(a.x).toBeLessThan(s.x);
    expect(a.r).toBeGreaterThan(s.x);
    expect(a.y).toBeGreaterThan(s.y);
    expect(t.y).toBeGreaterThan(a.y);
    expect(t.b).toBeLessThan(s.b);
    expect(rightCol.getChildIndex(autoTab!)).toBeLessThan(rightCol.getChildIndex(spin!)); // SPIN draws over
  });

  it('reserves the sides: the safe insets reach just past each column', () => {
    const bar = build(host(1280, 720));
    const l = box(parts(bar).leftCol);
    const r = box(parts(bar).rightCol);
    const sa = bar.safeArea();
    expect(sa.top).toBe(0);
    expect(sa.bottom).toBe(0);
    expect(sa.left).toBeGreaterThanOrEqual(l.r - 3);
    expect(sa.left).toBeLessThanOrEqual(l.r + SAFE_GAP);
    expect(1280 - sa.right).toBeLessThanOrEqual(r.x);
    expect(1280 - sa.right).toBeGreaterThanOrEqual(r.x - SAFE_GAP);
    // nothing in the right column pokes past its reserved edge — the tabs included
    expect(1280 - sa.right + SAFE_GAP).toBeLessThanOrEqual(box(parts(bar).autoTab!).x + 0.5);
  });

  it('menu popover: points at the burger, placed against the left column', () => {
    const bar = build(host(1280, 720));
    const plate = bar.menuPlate()!;
    const anchor = bar.menuAnchor()!;
    expect(plate.x).toBe(OUTER);
    expect(anchor.x).toBeGreaterThanOrEqual(plate.x);
    expect(anchor.y).toBeGreaterThanOrEqual(plate.y - 0.5);
    expect(anchor.y + anchor.h).toBeLessThanOrEqual(plate.y + plate.h + 3);
    expect(bar.fitScale()).toBe(1);
  });

  it('fits Stake popout S (400×225), a laptop (1024×576) and a landscape phone (844×390)', () => {
    for (const [w, h] of [[400, 225], [1024, 576], [844, 390]]) expectOnScreen(build(host(w, h)), w, h);
    expect(build(host(400, 225)).fitScale()).toBe(0.35);
  });

  it('a huge balance and a long feature title never make the columns overlap', () => {
    const ctx = host(1024, 576);
    ctx.state.balance = 10_000_000_000;
    ctx.state.activeFeature = ANTE;
    const sa = build(ctx).safeArea();
    expect(sa.left).toBeLessThan(1024 - sa.right);
  });
});

describe('S side bar — mobile', () => {
  it('BUY is SPIN-sized, bottom-left, level with SPIN', () => {
    const { buy, spin } = parts(build(host(390, 844)));
    expect(buy!.measureSize()).toEqual(spin!.measureSize());
    const b = box(buy!);
    const s = box(spin!);
    expect(b.r).toBeLessThan(s.x);
    expect(Math.abs(b.b - s.b)).toBeLessThan(1);
  });

  it('the block reserves the bottom: safeArea.bottom reaches its top edge', () => {
    const bar = build(host(390, 844));
    const k = box(parts(bar).block);
    const sa = bar.safeArea();
    expect(sa.left).toBe(0);
    expect(sa.right).toBe(0);
    expect(Math.abs(sa.bottom - (844 - k.y))).toBeLessThan(1);
    expect(k.b).toBeLessThanOrEqual(844);
    expect(k.x).toBeGreaterThanOrEqual(0);
    expect(k.r).toBeLessThanOrEqual(390);
  });

  it('a narrow phone with a huge balance: the block scales down to fit', () => {
    const ctx = host(320, 568);
    ctx.state.balance = 10_000_000_000;
    const bar = build(ctx);
    const k = box(parts(bar).block);
    expect(k.x).toBeGreaterThanOrEqual(0);
    expect(k.r).toBeLessThanOrEqual(320);
    expect(bar.fitScale()).toBeLessThan((320 - 20) / 370);
  });

  it('no buy-bonus configured: no BUY, and the columns still share the bottom line', () => {
    const p = parts(build(host(390, 844, { features: { turbo: 2, autoplay: {}, buyBonus: false } })));
    expect(p.buy).toBeUndefined();
    expect(Math.abs(box(p.balance!).b - box(p.spin!).b)).toBeLessThan(1);
  });
});

describe('S side bar — modes and controls', () => {
  it('free spins: the counter replaces SPIN, TOTAL WIN joins the left column, no BUY, no stepper', () => {
    const ctx = host(1280, 720);
    ctx.state.mode = 'freeSpins';
    ctx.state.freeSpins = { current: 3, total: 10, totalWin: 12 };
    const p = parts(build(ctx));
    expect(p.spin).toBeUndefined();
    expect(p.fs!.valueText.text).toBe('3 / 10');
    expect(p.totalWin!.valueText.text).toBe('€12.00');
    expect(p.buy).toBeUndefined();
    expect(p.bet.up).toBeUndefined();
  });

  it('replay without free spins: no balance, no hero, no tabs — and still on screen', () => {
    const ctx = host(1280, 720);
    ctx.state.mode = 'replay';
    ctx.state.replay = true;
    const bar = build(ctx);
    const p = parts(bar);
    expect(p.balance).toBeUndefined();
    expect(bar.balanceValue).toBeUndefined();
    expect(p.spin).toBeUndefined();
    expect(p.fs).toBeUndefined();
    expect(p.turboTab).toBeUndefined();
    expectOnScreen(bar, 1280, 720);
  });

  it('an active feature: red BUY with a cross, a locked stepper, the multiplied bet', () => {
    const ctx = host(1280, 720);
    ctx.state.activeFeature = ANTE;
    const p = parts(build(ctx));
    expect(p.buy!.face).toBe('red');
    expect((p.buy!.glyph as IconView).iconName).toBe('close');
    expect(p.bet.up!.disabled).toBe(true);
    expect(p.bet.down!.disabled).toBe(true);
    expect(p.bet.valueText.text).toBe('€1.25');
    expect(p.bet.labelText.text).toBe('WARRIOR ANTE');
  });

  it('autoplay running: a yellow tab with STOP and SPIN stops the run; halted: SPIN resumes with the count', () => {
    const run = host(1280, 720);
    run.state.autoplay = { active: true, remaining: 5 };
    const a = parts(build(run));
    expect(a.autoTab!.face).toBe('yellow');
    expect((a.autoTab!.glyph as IconView).iconName).toBe('stop');
    expect(a.spin!.mode).toBe('stop');
    expect(a.spin!.count).toBe('5');
    const halt = host(1280, 720);
    halt.state.autoplay = { active: false, remaining: 4 };
    const h = parts(build(halt));
    expect(h.spin!.mode).toBe('resume');
    expect(h.spin!.count).toBe('4');
  });

  it('the turbo level picks the tab face and the bolt colour', () => {
    const expectTab = (level: number, face: string, color: string) => {
      const ctx = host(1280, 720);
      ctx.state.turbo = level;
      const t = parts(build(ctx)).turboTab!;
      expect(t.face).toBe(face);
      expect((t.glyph as Graphics).context).toBe(sIcon('bolt', 1, color).context);
    };
    expectTab(0, 'plate', S.fg);
    expectTab(1, 'plate', S.yellow);
    expectTab(2, 'yellow', S.ink);
  });

  it('busy: SPIN and autoplay disabled, the bet locked', () => {
    const ctx = host(1280, 720);
    ctx.state.busy = true;
    const p = parts(build(ctx));
    expect(p.spin!.disabled).toBe(true);
    expect(p.autoTab!.disabled).toBe(true);
    expect(p.bet.up!.disabled).toBe(true);
    expect(p.bet.valueHit.eventMode).toBe('none');
  });

  it('taps route to the controller actions', () => {
    const calls: string[] = [];
    const ctx = host(1280, 720, FULL, {
      actions: {
        spin: () => calls.push('spin'),
        openMenu: () => calls.push('menu'),
        openBuyBonus: () => calls.push('buy'),
        cycleTurbo: () => calls.push('turbo'),
        openAutoplayPicker: () => calls.push('auto'),
        stepBet: (d: number) => calls.push(`bet${d}`),
        openBetPicker: () => calls.push('picker'),
      },
    });
    const p = parts(build(ctx));
    for (const n of [p.spin!, p.menuBtn, p.buy!, p.turboTab!, p.autoTab!, p.bet.up!, p.bet.valueHit]) n.emit('pointertap', {});
    expect(calls).toEqual(['spin', 'menu', 'buy', 'turbo', 'auto', 'bet1', 'picker']);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd packages/shell && npx vitest run tests/pixi-s/sidebar.test.ts`
Expected: FAIL. `@/ui/pixi-s/SideBar` cannot be resolved.

- [ ] **Step 3: Implement `SideBar.ts`**

Create `packages/shell/src/ui/pixi-s/SideBar.ts`:

```ts
import { Container, type Text } from 'pixi.js';
import type { PixiComponentContext } from '../pixi/context';
import type { HbBar } from '../pixi-hb/PixiHbRenderer';
import { autoplayDiscMode } from '../pixi-hb/components/BottomBar';
import { makeIcon } from '../pixi-hb/pixi-icon';
import type { Rect } from '@/core/popover';
import type { SafeArea } from '@/core/renderer';
import { bonusBuyLocked } from '@/core/state';
import { SKEW, TOOTH_D } from './slab';
import { sIcon } from './icons';
import { S } from './theme';
import { SButton, SReadout, SBet, SSpin, SFsCounter, type Sized } from './widgets';

// ── design constants ─────────────────────────────────────────────────────────
interface Sizes {
  menu: [number, number];
  menuGlyph: number;
  readout: [number, number];
  labelSize: number;
  valueSize: number;
  bet: [number, number];
  betLabel: number;
  betValue: number;
  buy: [number, number];
  buyGlyph: number;
  spin: [number, number];
  spinGlyph: number;
  tab: [number, number];
  tabGlyph: number;
  tabGap: number;
  /** How far the tabs tuck under SPIN's left edge. */
  tabOverlap: number;
  /** Vertical gap between stacked slabs. */
  gap: number;
}

const WIDE: Sizes = {
  menu: [64, 44], menuGlyph: 24,
  readout: [280, 54], labelSize: 15, valueSize: 26,
  bet: [290, 46], betLabel: 14, betValue: 24,
  buy: [96, 52], buyGlyph: 60,
  spin: [260, 136], spinGlyph: 84,
  tab: [52, 40], tabGlyph: 22, tabGap: 4, tabOverlap: 12,
  gap: 10,
};

/** Left (172) + M_COL_GAP (12) + right (186) = M_REF_W (370) = a 390 phone minus the side padding.
 *  BUY is SPIN's size on mobile. */
const MOBILE: Sizes = {
  menu: [52, 38], menuGlyph: 20,
  readout: [172, 44], labelSize: 11, valueSize: 17,
  bet: [186, 40], betLabel: 11, betValue: 17,
  buy: [150, 90], buyGlyph: 76,
  spin: [150, 90], spinGlyph: 56,
  tab: [42, 34], tabGlyph: 18, tabGap: 4, tabOverlap: 8,
  gap: 8,
};

/** Wide fit: designed for 1280×720, scaled by the smaller ratio, never above 1. The floor keeps
 *  Stake popout S (400×225) readable, as in HB. */
export const WIDE_REF_W = 1280;
export const WIDE_REF_H = 720;
export const WIDE_MIN_SCALE = 0.35;
/** Screen padding around the wide columns. */
export const OUTER = 16;
/** Extra room between a column and the scene's safe rect. */
export const SAFE_GAP = 12;
/** Mobile block: design width, side / bottom padding, and the gap between its two columns. */
export const M_REF_W = 370;
export const M_SIDE = 10;
export const M_BOTTOM = 8;
export const M_COL_GAP = 12;

/** Stack `items` top to bottom into `col`, aligned to its left or right edge; returns the column size. */
function stack(col: Container, items: Sized[], gap: number, align: 'left' | 'right'): { w: number; h: number } {
  const w = Math.max(0, ...items.map((i) => i.measureSize().w));
  let y = 0;
  for (const item of items) {
    const s = item.measureSize();
    item.position.set(align === 'left' ? 0 : w - s.w, y);
    col.addChild(item);
    y += s.h + gap;
  }
  return { w, h: Math.max(0, y - gap) };
}

/** The S control bar: two side columns instead of a bottom strip. Wide: the left column (menu,
 *  TOTAL WIN in FS, WIN, BALANCE) and the right one (BUY, BET, SPIN with the autoplay / turbo tabs)
 *  sit in the bottom corners and the scene gets side insets. Mobile: the same columns pulled into
 *  one bottom block, BUY SPIN-sized at the bottom-left. Rebuilt on every render(). */
export class SideBar extends Container implements HbBar {
  balanceValue?: Text;
  winValue?: Text;
  private host: PixiComponentContext;
  private mobile: boolean;
  private z: Sizes;
  // wide: both columns sit on the bar, each scaled; mobile: both sit in `block`, scaled together
  private leftCol = new Container();
  private rightCol = new Container();
  private block = new Container();
  private leftW = 0;
  private leftH = 0;
  private rightW = 0;
  private rightH = 0;
  private plate: Rect | null = null;
  private safe: SafeArea = { top: 0, right: 0, bottom: 0, left: 0 };
  private menuBtn!: SButton;
  private totalWin?: SReadout;
  private win!: SReadout;
  private balance?: SReadout;
  private buy?: SButton;
  private bet!: SBet;
  private spin?: SSpin;
  private fs?: SFsCounter;
  private autoTab?: SButton;
  private turboTab?: SButton;

  constructor(host: PixiComponentContext) {
    super();
    this.host = host;
    this.mobile = host.layout === 'mobile';
    this.z = this.mobile ? MOBILE : WIDE;
    this.buildLeft();
    this.buildRight();
    if (this.mobile) {
      this.block.addChild(this.leftCol, this.rightCol);
      this.addChild(this.block);
    } else {
      this.addChild(this.leftCol, this.rightCol);
    }
    this.applyBusy();
  }

  // ── HbBar ─────────────────────────────────────────────────────────────────
  menuAnchor(): Rect | null {
    if (this.destroyed || this.menuBtn.destroyed) return null;
    const b = this.menuBtn.getBounds();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  }

  /** Wide: the left column; mobile: the whole block — the popover opens above it. */
  menuPlate(): Rect | null {
    return this.destroyed ? null : this.plate;
  }

  fitScale(): number {
    if (this.destroyed) return 1;
    return (this.mobile ? this.block : this.leftCol).scale.x;
  }

  safeArea(): SafeArea {
    return this.safe;
  }

  applyFit(): void {
    const { screenW: W, screenH: H } = this.host;
    if (this.mobile) {
      const blockW = Math.max(M_REF_W, this.leftW + M_COL_GAP + this.rightW);
      const blockH = Math.max(this.leftH, this.rightH);
      // both columns bottom-aligned, so BUY and SPIN share one bottom line
      this.leftCol.position.set(0, blockH - this.leftH);
      this.rightCol.position.set(blockW - this.rightW, blockH - this.rightH);
      const s = Math.min(1, (W - 2 * M_SIDE) / blockW);
      const top = H - M_BOTTOM - blockH * s;
      this.block.scale.set(s);
      this.block.position.set((W - blockW * s) / 2, top);
      this.safe = { top: 0, right: 0, bottom: H - top, left: 0 };
      this.plate = { x: this.block.x, y: top, w: blockW * s, h: blockH * s };
      return;
    }
    const s = Math.max(WIDE_MIN_SCALE, Math.min(1, W / WIDE_REF_W, H / WIDE_REF_H));
    const lx = OUTER;
    const ly = H - OUTER - this.leftH * s;
    const rx = W - OUTER - this.rightW * s;
    const ry = H - OUTER - this.rightH * s;
    this.leftCol.scale.set(s);
    this.rightCol.scale.set(s);
    this.leftCol.position.set(lx, ly);
    this.rightCol.position.set(rx, ry);
    this.safe = { top: 0, right: W - rx + SAFE_GAP, bottom: 0, left: lx + this.leftW * s + SAFE_GAP };
    this.plate = { x: lx, y: ly, w: this.leftW * s, h: this.leftH * s };
  }

  // ── columns ───────────────────────────────────────────────────────────────
  /** menu · (TOTAL WIN) · WIN · BALANCE · (mobile, base: BUY) — top to bottom, left-aligned. */
  private buildLeft(): void {
    const { state } = this.host;
    const z = this.z;
    const items: Sized[] = [];
    this.menuBtn = new SButton({
      w: z.menu[0],
      h: z.menu[1],
      face: 'plate',
      corners: SKEW.menu,
      glyph: makeIcon('menu', z.menuGlyph, { ink: S.fg, fill: S.fg }),
      glyphSize: z.menuGlyph,
      onTap: () => this.host.actions.openMenu(),
    });
    items.push(this.menuBtn);
    if (this.showFs()) {
      this.totalWin = this.readout('Total win', this.host.fmtWin(state.freeSpins.totalWin));
      items.push(this.totalWin);
    }
    this.win = this.readout('Win', this.host.fmtWin(state.win));
    this.winValue = this.win.valueText;
    items.push(this.win);
    if (!state.replay) {
      this.balance = this.readout('Balance', this.host.fmt(state.balance));
      this.balanceValue = this.balance.valueText;
      items.push(this.balance);
    }
    if (this.mobile && this.isBase()) {
      this.buy = this.buildBuy();
      if (this.buy) items.push(this.buy);
    }
    const size = stack(this.leftCol, items, z.gap, 'left');
    this.leftW = size.w;
    this.leftH = size.h;
  }

  /** (wide, base: BUY) · BET · SPIN or the FS counter — right-aligned; the tabs hang off the hero's
   *  left edge, under it. Without a hero (replay) there are no tabs. */
  private buildRight(): void {
    const { config } = this.host;
    const z = this.z;
    const items: Sized[] = [];
    if (!this.mobile && this.isBase()) {
      this.buy = this.buildBuy();
      if (this.buy) items.push(this.buy);
    }
    this.bet = this.buildBet();
    items.push(this.bet);
    let hero: Sized | undefined;
    if (this.isBase()) hero = this.spin = this.buildSpin();
    else if (this.showFs()) hero = this.fs = this.buildFs();
    if (hero) items.push(hero);
    const size = stack(this.rightCol, items, z.gap, 'right');
    let colW = size.w;

    const tabs: SButton[] = [];
    if (hero && this.isBase() && config.features.autoplay) tabs.push((this.autoTab = this.buildAutoTab()));
    if (hero && config.features.turbo > 0) tabs.push((this.turboTab = this.buildTurboTab()));
    if (hero && tabs.length) {
      const [tw, th] = z.tab;
      const total = tabs.length * th + (tabs.length - 1) * z.tabGap;
      const body = hero.measureSize().h - TOOTH_D;
      const x = hero.x - tw + z.tabOverlap;
      let y = hero.y + (body - total) / 2;
      for (const t of tabs) {
        t.position.set(x, y);
        this.rightCol.addChildAt(t, 0); // under the hero
        y += th + z.tabGap;
      }
      if (x < 0) {
        // the tabs poke out past the widest slab: shift everything so the column starts at 0
        for (const c of this.rightCol.children) c.x -= x;
        colW -= x;
      }
    }
    this.rightW = colW;
    this.rightH = size.h;
  }

  // ── pieces ────────────────────────────────────────────────────────────────
  private readout(label: string, value: string): SReadout {
    const z = this.z;
    return new SReadout({ label: this.host.t(label), value, w: z.readout[0], h: z.readout[1], labelSize: z.labelSize, valueSize: z.valueSize });
  }

  /** The mask tab; with a feature active it turns red with a white cross (tap = deactivate). */
  private buildBuy(): SButton | undefined {
    const { state, config } = this.host;
    if (config.features.buyBonus === false && !config.onBonusBuy) return undefined;
    const z = this.z;
    const feature = state.activeFeature;
    const cross = Math.round(z.buyGlyph * 0.5);
    return new SButton({
      w: z.buy[0],
      h: z.buy[1],
      face: feature ? 'red' : 'yellow',
      corners: SKEW.buy,
      glyph: feature ? makeIcon('close', cross, { ink: S.fg, fill: S.fg }) : sIcon('mask', z.buyGlyph, S.ink),
      glyphSize: feature ? cross : z.buyGlyph,
      onTap: () => (feature ? this.host.actions.deactivateFeature() : this.host.actions.openBuyBonus()),
    });
  }

  /** − BET +. With a feature active the label names it (yellow) and the value is the feature price. */
  private buildBet(): SBet {
    const { state } = this.host;
    const z = this.z;
    const feature = state.activeFeature;
    const isBase = this.isBase();
    return new SBet({
      label: feature ? feature.title : this.host.t('Bet'),
      labelColor: feature ? S.yellow : S.fg,
      value: this.host.fmt(feature ? state.bet * feature.priceMultiplier : state.bet),
      w: z.bet[0],
      h: z.bet[1],
      labelSize: z.betLabel,
      valueSize: z.betValue,
      stepper: isBase,
      onStep: (dir) => {
        if (!this.host.state.busy) this.host.actions.stepBet(dir);
      },
      onValue: isBase && !feature
        ? () => {
            if (!this.betLocked()) this.host.actions.openBetPicker();
          }
        : undefined,
    });
  }

  private buildSpin(): SSpin {
    const { state } = this.host;
    const z = this.z;
    const spin = new SSpin({
      w: z.spin[0],
      h: z.spin[1],
      glyph: z.spinGlyph,
      ticker: this.host.ticker,
      autoplay: autoplayDiscMode(state),
      remaining: state.autoplay.remaining,
      onSpin: () => this.host.actions.spin(),
      onStop: () => this.host.actions.stopAutoplay(),
      onResume: () => this.host.actions.startAutoplay(this.host.state.autoplay.remaining),
    });
    if (state.busy) spin.setBusy(true);
    return spin;
  }

  private buildFs(): SFsCounter {
    const { state } = this.host;
    const z = this.z;
    const fs = state.freeSpins;
    const value = state.bonus?.value ?? (fs.current == null ? `${fs.total}` : `${fs.current} / ${fs.total}`);
    return new SFsCounter({
      w: z.spin[0],
      h: z.spin[1],
      label: this.host.t(state.bonus?.label ?? 'Free spins'),
      value,
      labelSize: z.labelSize,
      valueSize: Math.round(z.valueSize * 1.3),
    });
  }

  /** ▶ — a running run shows a yellow face with STOP (tap stops it); idle opens the picker. */
  private buildAutoTab(): SButton {
    const z = this.z;
    const g = z.tabGlyph;
    const running = this.host.state.autoplay.active;
    return new SButton({
      w: z.tab[0],
      h: z.tab[1],
      face: running ? 'yellow' : 'plate',
      corners: SKEW.tab,
      glyph: running ? makeIcon('stop', g, { ink: S.ink, fill: S.ink }) : sIcon('play', g, S.fg),
      glyphSize: g,
      insetRight: z.tabOverlap,
      onTap: () => {
        const { active, remaining } = this.host.state.autoplay;
        if (active || remaining > 0) this.host.actions.stopAutoplay();
        else this.host.actions.openAutoplayPicker();
      },
    });
  }

  /** ⚡ — L0 white bolt, L1 yellow bolt, L2 yellow face with an ink bolt. */
  private buildTurboTab(): SButton {
    const z = this.z;
    const g = z.tabGlyph;
    const level = this.host.state.turbo;
    const color = level >= 2 ? S.ink : level === 1 ? S.yellow : S.fg;
    return new SButton({
      w: z.tab[0],
      h: z.tab[1],
      face: level >= 2 ? 'yellow' : 'plate',
      corners: SKEW.tab,
      glyph: sIcon('bolt', g, color),
      glyphSize: g,
      insetRight: z.tabOverlap,
      onTap: () => this.host.actions.cycleTurbo(),
    });
  }

  // ── state ─────────────────────────────────────────────────────────────────
  private isBase(): boolean {
    return this.host.state.mode === 'base';
  }

  /** Free spins / bonus, or a replay of a free-spins round. */
  private showFs(): boolean {
    const s = this.host.state;
    return s.mode === 'freeSpins' || s.mode === 'bonus' || (s.mode === 'replay' && s.freeSpins.total > 0);
  }

  private betLocked(): boolean {
    return this.host.state.busy || this.host.state.autoplay.active;
  }

  /** Same locks as HB's BottomBar.applyBusy. */
  private applyBusy(): void {
    const { state } = this.host;
    const auto = state.autoplay.active;
    const lockBet = state.busy || auto || !!state.activeFeature;
    const i = state.availableBets.indexOf(state.bet);
    if (this.bet.up) this.bet.up.disabled = lockBet || i >= state.availableBets.length - 1;
    if (this.bet.down) this.bet.down.disabled = lockBet || i <= 0;
    if (this.spin) this.spin.disabled = state.busy && !auto;
    if (this.autoTab) this.autoTab.disabled = state.busy && !auto;
    if (this.buy) this.buy.disabled = bonusBuyLocked(state);
    if (lockBet) {
      this.bet.valueHit.eventMode = 'none';
      this.bet.valueHit.cursor = 'default';
    }
  }
}
```

- [ ] **Step 4: Run the test and typecheck**

Run: `cd packages/shell && npx vitest run tests/pixi-s/sidebar.test.ts`
Expected: PASS (17 tests).

If a geometry assertion is off by the 3px slab shadow, fix the TEST tolerance only when the rule it guards still holds. The rules are: "on screen", "bottom-anchored", "BUY level with SPIN" and "insets just past the columns". Any other fix goes in the code.

Run: `npm run typecheck --workspace @energy8platform/shell`
Expected: exits 0.

- [ ] **Step 5: Prove the gates can fail**

Each change below is temporary. Make it, run `npx vitest run tests/pixi-s/sidebar.test.ts`, confirm the named test fails, then undo it by hand (retype the line — do not use `git checkout`).

1. In `applyFit`, mobile branch: change `this.rightCol.position.set(blockW - this.rightW, blockH - this.rightH)` to `this.rightCol.position.set(blockW - this.rightW, 0)`. Expected failure: "BUY is SPIN-sized, bottom-left, level with SPIN".
2. In `applyFit`, wide branch: change `left: lx + this.leftW * s + SAFE_GAP` to `left: lx + SAFE_GAP`. Expected failure: "reserves the sides".
3. In `buildRight`: delete the `if (x < 0) { … }` block. Expected failure: "reserves the sides" (the `autoTab` assertion).

Record the three outcomes in the task report. If a mutation does NOT fail its test, strengthen that test until it does, and say so in the report.

- [ ] **Step 6: Commit**

```bash
git add packages/shell/src/ui/pixi-s/SideBar.ts packages/shell/tests/pixi-s/sidebar.test.ts
git commit -m "S side bar: two bottom-anchored columns, spin-sized BUY on mobile, side safe area

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Package entry `./pixi-s`

**Files:**
- Create: `packages/shell/src/ui/pixi-s/index.ts`
- Modify: `packages/shell/package.json` (the `exports` map)
- Modify: `packages/shell/rollup.config.mjs`
- Modify: `CLAUDE.md` (repo root, the shell note)
- Test: `packages/shell/tests/pixi-s/shell.test.ts` (create)

**Interfaces:**
- Consumes:
  - `PixiHbRenderer` and its `bar` option (Task 1);
  - `SideBar` (Task 5);
  - `installSFont` (Task 2);
  - `createShell` from `@/core`;
  - the types `PixiShellConfig`, `PixiGameShell`, `PixiShellSurface`, `BonusOption` and `GameInfoSection` from `../pixi-hb`.
- Produces: `createPixiSShell(config: PixiShellConfig): PixiGameShell`, `removePixiSShell(): Promise<void>`, `S`, the re-exported types and `export * from '@/core'`.

- [ ] **Step 1: Write the failing test**

Create `packages/shell/tests/pixi-s/shell.test.ts`:

```ts
import '../pixi/setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect, afterEach } from 'vitest';
import { Container } from 'pixi.js';
import type { Application } from 'pixi.js';
import { createPixiSShell, removePixiSShell, type PixiShellConfig } from '@/ui/pixi-s';

const stubTicker = { add() {}, remove() {} };

function fakeApp(w: number, h: number): Application {
  return {
    screen: { width: w, height: h },
    ticker: stubTicker,
    renderer: { on() {}, off() {} },
    stage: new Container(),
  } as unknown as Application;
}

function config(app: Application): PixiShellConfig {
  return {
    app,
    language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [0.5, 1, 2],
    defaultBet: 1,
    currentBet: null,
    balance: 1000,
    win: 0,
    mode: 'base',
    gameInfo: { sections: [] },
    features: { turbo: 2, autoplay: {}, buyBonus: [] },
  } as PixiShellConfig;
}

// The fade-out tween never ticks on the stub ticker, so don't await — `active` clears synchronously.
afterEach(() => {
  void removePixiSShell();
});

describe('createPixiSShell', () => {
  it('desktop: the columns reserve the sides, not a bottom strip', () => {
    const shell = createPixiSShell(config(fakeApp(1280, 720)));
    expect(shell.safeArea.left).toBeGreaterThan(100);
    expect(shell.safeArea.right).toBeGreaterThan(100);
    expect(shell.safeArea.bottom).toBe(0);
    expect(shell.barHeight).toBe(0);
  });

  it('portrait: one bottom block; barHeight is its height', () => {
    const shell = createPixiSShell(config(fakeApp(390, 844)));
    expect(shell.safeArea.left).toBe(0);
    expect(shell.safeArea.right).toBe(0);
    expect(shell.safeArea.bottom).toBeGreaterThan(150);
    expect(shell.barHeight).toBe(shell.safeArea.bottom);
  });

  it('one active shell at a time', () => {
    const a = createPixiSShell(config(fakeApp(1280, 720)));
    expect(createPixiSShell(config(fakeApp(1280, 720)))).toBe(a);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd packages/shell && npx vitest run tests/pixi-s/shell.test.ts`
Expected: FAIL. `@/ui/pixi-s` cannot be resolved (there is no `index.ts` yet).

- [ ] **Step 3: The entry**

Create `packages/shell/src/ui/pixi-s/index.ts`:

```ts
import { createShell } from '@/core';
import { PixiHbRenderer } from '../pixi-hb/PixiHbRenderer';
import type { PixiShellConfig, PixiGameShell } from '../pixi-hb';
import { SideBar } from './SideBar';
import { installSFont } from './text';

// The S shell: HB's renderer and overlays (menu, game info, buy bonus, pickers, modals) with the S
// side-column bar. Same config, events and surface as every shell — a game switches with
// `shellFactory: createPixiSShell`.

export type { PixiShellConfig, PixiGameShell, PixiShellSurface, BonusOption, GameInfoSection } from '../pixi-hb';

let active: PixiGameShell | null = null;

/** Create the S game shell. Like `createPixiHbShell`, only one is active at a time — returns the
 *  existing instance if one is. */
export function createPixiSShell(config: PixiShellConfig): PixiGameShell {
  if (active) return active;
  installSFont(); // before the renderer mounts: its first render waits on document.fonts.ready
  const renderer = new PixiHbRenderer({ app: config.app, parent: config.parent, bar: (ctx) => new SideBar(ctx) });
  active = createShell({ ...config, renderer });
  return active;
}

/** Tear down the active S shell (fade out, detach listeners, remove its display objects). */
export function removePixiSShell(): Promise<void> {
  if (!active) return Promise.resolve();
  const shell = active;
  active = null;
  return shell.destroy();
}

export { S } from './theme';
export * from '@/core';
```

- [ ] **Step 4: Run the test**

Run: `cd packages/shell && npx vitest run tests/pixi-s/shell.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Package exports, Rollup and CLAUDE.md**

In `packages/shell/package.json`, add this after the `"./pixi-hb"` entry inside `"exports"`:

```json
    "./pixi-s": {
      "import": "./dist/pixi-s.esm.js",
      "require": "./dist/pixi-s.cjs.js",
      "types": "./dist/pixi-s.d.ts"
    }
```

Remember the comma after the `"./pixi-hb"` block.

In `packages/shell/rollup.config.mjs`, add this after the `pixi-hb` bundle line:

```js
  ...bundle('src/ui/pixi-s/index.ts', 'pixi-s', ['pixi.js', SOCIAL]),
```

In the root `CLAUDE.md`, replace the text ``demo `examples/pixi-hb-shell-demo`). The i18n helpers`` with:

```
demo `examples/pixi-hb-shell-demo`), and `@energy8platform/shell/pixi-s` (`createPixiSShell` — the S skin: HB's renderer and overlays with a side-column bar of skewed black/yellow halftone slabs, Montserrat ExtraBold; `src/ui/pixi-s/`, plugged in through `PixiHbRenderer`'s `bar` option, font via `scripts/build-s-fonts.mjs`; on desktop it reports `safeArea.left/right`, not a bottom inset; demo `examples/pixi-s-shell-demo`). The i18n helpers
```

- [ ] **Step 6: Build and run the full gates**

Run: `npm run build --workspace @energy8platform/shell` (from the repo root)
Expected: exits 0. `ls packages/shell/dist/pixi-s.*` lists `pixi-s.esm.js`, `pixi-s.cjs.js`, `pixi-s.d.ts` and the source maps.

Run: `grep -c "MontserratS" packages/shell/dist/pixi-s.esm.js`
Expected: at least 1, so the font is bundled.

Run: `npm run typecheck --workspace @energy8platform/shell && npm test --workspace @energy8platform/shell`
Expected: both exit 0, and every suite passes.

- [ ] **Step 7: Commit**

```bash
git add packages/shell/src/ui/pixi-s/index.ts packages/shell/package.json packages/shell/rollup.config.mjs packages/shell/tests/pixi-s/shell.test.ts CLAUDE.md
git commit -m "Publish the S shell as @energy8platform/shell/pixi-s

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

(`dist/` is gitignored. Do not force-add it.)

---

### Task 7: Demo and visual check

**Files:**
- Create: `examples/pixi-s-shell-demo/{index.html,package.json,tsconfig.json,vite.config.ts,src/main.ts}` (copied from `examples/pixi-hb-shell-demo`, then edited)
- Scratch (never committed): `<scratchpad>/shots.mjs`, `<scratchpad>/shots/*.png`

**Interfaces:**
- Consumes: `createPixiSShell` and the types `PixiGameShell` and `ShellMode` from `@energy8platform/shell/pixi-s` (built `dist`, Task 6).

- [ ] **Step 1: Copy the HB demo**

```bash
cd /Users/mrphelko/Documents/repo/game-engine
mkdir -p examples/pixi-s-shell-demo
cp -R examples/pixi-hb-shell-demo/index.html examples/pixi-hb-shell-demo/package.json examples/pixi-hb-shell-demo/tsconfig.json examples/pixi-hb-shell-demo/vite.config.ts examples/pixi-hb-shell-demo/src examples/pixi-s-shell-demo/
```

- [ ] **Step 2: Point the copy at the S shell**

`examples/pixi-s-shell-demo/package.json`: set `"name": "pixi-s-shell-demo-example"`.

`examples/pixi-s-shell-demo/index.html`:
- Set `<title>` and `<h1>` to `Pixi S Game Shell — Screen Presets Demo`.
- Replace the `<p>` under the `h1` with: `The S shell: HB's renderer and overlays with a side-column bar. The blue frame is the scene's safe rect (shell.safeArea) — the reels go there.`

`examples/pixi-s-shell-demo/src/main.ts`:

1. Replace the two import lines from `@energy8platform/shell/pixi-hb` with:

```ts
import { createPixiSShell } from '@energy8platform/shell/pixi-s';
import type { PixiGameShell, ShellMode } from '@energy8platform/shell/pixi-s';
```

2. In `SCREENS`, add `{ id: 'stake-s', label: 'Stake S', width: 400, height: 225 },` after the `popout-s` entry. Add `{ id: 'phone', label: 'Phone', width: 390, height: 844 },` before the `mobile-l` entry.

3. Replace `createPixiHbShell({` with `createPixiSShell({`.

4. Directly after the `createPixiSShell({ … });` statement closes, add:

```ts
// The scene's safe rect (shell.safeArea) — where a game would lay out its reels. Redrawn each frame
// because the insets change with the screen, the layout and the bar's content.
const safeFrame = new Graphics();
app.stage.addChildAt(safeFrame, 1); // above the faux game canvas, below the shell root
app.ticker.add(() => {
  const sa = shell.safeArea;
  const w = app.screen.width - sa.left - sa.right;
  const h = app.screen.height - sa.top - sa.bottom;
  safeFrame.clear().rect(sa.left, sa.top, w, h).fill({ color: 0x3b82f6, alpha: 0.12 }).stroke({ color: 0x60a5fa, width: 2, alpha: 0.7 });
});
```

5. Delete the `if (params.get('icons')) { … }` block. It uses HB's `makeIcon` / `HB_ICON_NAMES`, which the S entry does not export.

Run: `cd examples/pixi-s-shell-demo && npx tsc --noEmit`
Expected: exits 0. It resolves `@energy8platform/shell/pixi-s` through the built `dist` types from Task 6. If it cannot, rebuild with `npm run build --workspace @energy8platform/shell` first.

- [ ] **Step 3: Serve the demo**

```bash
cd /Users/mrphelko/Documents/repo/game-engine
npm run build --workspace @energy8platform/shell
cd examples/pixi-s-shell-demo && npx vite --port 4331 --strictPort --force
```

Run the Vite command in the background, then wait until `curl -s localhost:4331 | grep -q "Pixi S"` succeeds. (`--force` matters: Vite pre-bundles the package `dist`, and a stale pre-bundle shows the old UI.)

- [ ] **Step 4: Screenshot the states**

Create `<scratchpad>/shots.mjs`, where `<scratchpad>` is the session scratchpad directory given in your system prompt:

```js
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

// Playwright from the repo root. channel 'chromium' = full Chromium in new headless mode: the
// headless-shell build has no WebGL, and Pixi v8 needs it (swiftshader supplies it here).
const require = createRequire('/Users/mrphelko/Documents/repo/game-engine/package.json');
const { chromium } = require('playwright');
const OUT = new URL('./shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const SHOTS = [
  ['desktop', 'screen=desktop'],
  ['desktop-fs', 'screen=desktop&mode=freeSpins'],
  ['desktop-ante', 'screen=desktop&ante=1'],
  ['laptop', 'screen=laptop'],
  ['stake-s', 'screen=stake-s'],
  ['phone', 'screen=phone'],
  ['phone-fs', 'screen=phone&mode=freeSpins'],
  ['mobile-s', 'screen=mobile-s'],
];

const browser = await chromium.launch({
  channel: 'chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1500 }, deviceScaleFactor: 2 });
for (const [name, query] of SHOTS) {
  await page.goto(`http://localhost:4331/?${query}`);
  await page.waitForSelector('#game canvas');
  await page.waitForTimeout(2500);
  await (await page.$('#game')).screenshot({ path: `${OUT}${name}.png` });
  console.log('shot', name);
}
await browser.close();
```

Run: `node <scratchpad>/shots.mjs`
Expected: eight `shot <name>` lines, and eight PNGs in `<scratchpad>/shots/`.

If the canvas area comes out blank, fall back to the CLI recipe. Run `~/.cache/puppeteer/chrome/mac_arm-150.0.7871.24/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing` with `--headless=new --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --disable-gpu-sandbox --force-device-scale-factor=2 --window-size=1600,1500 --virtual-time-budget=5000 --screenshot=<out> <url>`.

- [ ] **Step 5: Look at every screenshot and compare with the reference**

Open each PNG with the Read tool. Also open the reference, `/private/tmp/claude-501/-Users-mrphelko-Documents-repo-game-engine/968dd56f-f1b3-4442-a728-5f12a6cdbb98/images/1.png`.

Check:
- Desktop has the left column (burger, ВЫИГРЫШ/WIN, БАЛАНС/BALANCE) and the right column (yellow mask tab, − BET +, the yellow sawtooth SPIN with ▶ and ⚡ tabs tucked under its left edge).
- The blue safe frame lies between the columns.
- Stake S: nothing is clipped, and the text is still legible.
- Phone: BUY and SPIN are the same size on one bottom line, BUY on the left. The safe frame ends above the block.
- FS: the yellow counter replaces SPIN, TOTAL WIN shows, and there is no mask tab.
- Ante: the mask tab is red with a white ✕, and the BET label reads WARRIOR ANTE.

You may tune only these, and the Task 5 suite must stay green after any tuning:
- the size constants in `SideBar.ts`;
- the `SKEW` presets and the `halftone` fade coefficients in `slab.ts`;
- the hover shades in `theme.ts`;
- the glyph sizes;
- the three glyph paths in `icons.ts`.

After a tune, rebuild the shell, restart Vite with `--force`, and re-shoot. Run at most 3 tune rounds. List the remaining visual differences in the task report rather than chasing them.

- [ ] **Step 6: Stop the server and commit the demo**

Stop the background Vite process you started (only that one). Then:

```bash
cd /Users/mrphelko/Documents/repo/game-engine
git add examples/pixi-s-shell-demo/index.html examples/pixi-s-shell-demo/package.json examples/pixi-s-shell-demo/tsconfig.json examples/pixi-s-shell-demo/vite.config.ts examples/pixi-s-shell-demo/src/main.ts
git status --short examples/pixi-s-shell-demo   # expect only those five files, no node_modules
git commit -m "S shell demo with the scene's safe rect drawn

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

If Step 5 tuned any source, commit those files in a separate commit before the demo commit, with the subject `Tune the S bar against the reference` and the same trailer. Re-run `npm test --workspace @energy8platform/shell` before that commit.

- [ ] **Step 7: Report**

In the task report, list:
- the screenshot paths;
- what you tuned;
- the remaining visual differences against the reference;
- the final result of `npm test --workspace @energy8platform/shell` and of the typecheck.
