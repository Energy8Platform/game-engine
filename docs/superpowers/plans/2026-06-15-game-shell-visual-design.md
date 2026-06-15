# Game Shell Visual Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the shipped game shell (`@energy8platform/platform-core/shell`) to the approved visual system — transparent neutral chrome, duotone icon set, adaptive spin-right/spin-center bottom bar, full-screen overlays, minimal motion — without changing the game-driven contract.

**Architecture:** The shell's controller/state/setters/events are unchanged. This work (a) adds an icon module + motion util, (b) rewrites `shell.css.ts` with neutral tokens and a two-arrangement layout, (c) restructures `BottomBar` into layout zones driven by a `layout: 'wide' | 'narrow'` flag set by a `ResizeObserver` on the shell root (breakpoint 720px), (d) merges Menu into a full-screen Settings overlay with a "Game info" button, (e) makes Settings/GameInfo/BuyBonus full-screen overlays. Existing `data-ge` hooks are preserved so event/behaviour tests keep passing; only DOM-shape assertions that the restructure genuinely changes are updated.

**Tech Stack:** TypeScript, vanilla DOM, CSS (custom properties + container/`ResizeObserver`), Vitest + jsdom. Zero runtime deps.

**Spec:** `docs/superpowers/specs/2026-06-15-game-shell-visual-design.md`

---

## File Structure

```
packages/platform-core/src/shell/
├── theme.ts                 ← MODIFY: neutral token set
├── shell.css.ts             ← REWRITE: transparent bar, adaptive layout, overlays, motion
├── motion.ts                ← CREATE: prefersReducedMotion(), countUp()
├── GameShell.ts             ← MODIFY: layout flag + ResizeObserver, count-up hook, openMenu→Settings
├── components/
│   ├── icons.ts             ← CREATE: duotone SVG icon set + icon(name)
│   ├── BottomBar.ts         ← REWRITE: zones, SVG icons, SPIN disc, wide/narrow, no replay badge
│   ├── Menu.ts              ← DELETE (folded into Settings)
│   ├── Settings.ts          ← REWRITE: full-screen overlay, Sound + sliders + Game info button
│   ├── GameInfo.ts          ← MODIFY: full-screen overlay + back button
│   └── BuyBonus.ts          ← MODIFY: full-screen overlay, restyled cards
packages/platform-core/tests/shell/
├── icons.test.ts            ← CREATE
├── motion.test.ts           ← CREATE
├── layout.test.ts           ← CREATE (wide/narrow bottom bar)
├── bottombar.test.ts        ← MODIFY (icons/zones; data-ge preserved)
├── bottombar-modes.test.ts  ← MODIFY (remove replay-badge assertion)
├── menu.test.ts             ← REWRITE (menu → settings overlay)
├── gameinfo.test.ts         ← MODIFY (back button)
└── buybonus.test.ts         ← unchanged hooks (verify still green)
```

Run tests from inside the package dir (the `@` alias is per-package): `cd packages/platform-core && npx vitest run tests/shell/...`. Commit from repo root.

**Token / hook contract (consistent across tasks):**
- CSS vars: `--shell-fg #f3f5fa`, `--shell-muted #9aa3b6`, `--shell-icon #c7cedb`, `--shell-icon-bright #e8ecf4`, `--shell-accent #8b5cf6`, `--shell-surface #0c111c`, `--shell-hairline rgba(255,255,255,.07)`, `--shell-spin #f4f6fb`, `--shell-spin-fg #141a28`, `--shell-radius 12px`.
- Preserved `data-ge` hooks: `spin, bet-up, bet-down, bet-value, balance, win, menu, turbo, autoplay, buybonus, fs-counter, fs-totalwin, fs-lastwin, settings-modal, setting-master, setting-music, setting-sfx, setting-sound, info-modal, info-rtp, info-rules, info-symbols, info-features, info-back, buybonus-overlay, bonus-card-<id>, game-info-btn`.
- Removed hooks: `replay-badge, menu-modal, menu-settings, menu-info, menu-fullscreen, setting-quickspin`.

---

## Task 1: Duotone icon set (`components/icons.ts`)

**Files:**
- Create: `packages/platform-core/src/shell/components/icons.ts`
- Test: `packages/platform-core/tests/shell/icons.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/platform-core/tests/shell/icons.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { icon, ICON_NAMES } from '@/shell/components/icons';

describe('icon', () => {
  it('returns an inline SVG string for every name', () => {
    for (const name of ICON_NAMES) {
      const svg = icon(name);
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).toContain('viewBox');
    }
  });

  it('duotone icons reference both tone tokens', () => {
    expect(icon('menu')).toContain('var(--shell-icon)');
    expect(icon('menu')).toContain('var(--shell-icon-bright)');
  });

  it('monochrome icons use currentColor', () => {
    expect(icon('close')).toContain('currentColor');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/platform-core && npx vitest run tests/shell/icons.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write the implementation**

`packages/platform-core/src/shell/components/icons.ts`:
```ts
// Duotone icon set — the shell's signature. Base tone uses --shell-icon,
// accent tone --shell-icon-bright; monochrome glyphs use currentColor so the
// caller's color cascades. All return an inline <svg> string sized 1em.
const BASE = 'var(--shell-icon)';
const BRIGHT = 'var(--shell-icon-bright)';

const SVGS: Record<string, string> = {
  // two curved arrows forming a ring (used dark-on-white inside SPIN)
  spin: `<path d="M18.5 9a7 7 0 0 0-12-2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M5.5 15a7 7 0 0 0 12 2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M19 5v4h-4M5 19v-4h4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
  turbo: `<path d="M13 2 4 13.5h5.2L8 22l9-11.5h-5.2z" fill="${BRIGHT}"/>`,
  autoplay: `<circle cx="12" cy="12" r="9" fill="${BASE}"/><path d="M10 8.5v7l6-3.5z" fill="${BRIGHT}"/>`,
  menu: `<rect x="4" y="6" width="16" height="2.4" rx="1.2" fill="${BRIGHT}"/><rect x="4" y="10.8" width="11" height="2.4" rx="1.2" fill="${BASE}"/><rect x="4" y="15.6" width="16" height="2.4" rx="1.2" fill="${BRIGHT}"/>`,
  betUp: `<path d="M8 14l4-4 4 4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`,
  betDown: `<path d="M8 10l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`,
  betMinus: `<path d="M6 12h12" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>`,
  betPlus: `<path d="M12 6v12M6 12h12" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>`,
  gift: `<rect x="4" y="9" width="16" height="11" rx="2" fill="currentColor"/><path d="M9 9a2.5 2.5 0 1 1 3-3 2.5 2.5 0 1 1 3 3z" fill="currentColor"/><rect x="11" y="9" width="2" height="11" fill="rgba(0,0,0,.35)"/>`,
  info: `<circle cx="12" cy="12" r="9" fill="${BASE}"/><rect x="11" y="11" width="2" height="6" rx="1" fill="var(--shell-surface)"/><circle cx="12" cy="8" r="1.2" fill="var(--shell-surface)"/>`,
  sound: `<path d="M5 9v6h3l5 4V5L8 9z" fill="${BASE}"/><path d="M16 9a4 4 0 0 1 0 6" fill="none" stroke="${BRIGHT}" stroke-width="2" stroke-linecap="round"/>`,
  close: `<path d="M7 7l10 10M17 7L7 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
  back: `<path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  chevronRight: `<path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  star: `<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.9 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z" fill="currentColor"/>`,
};

export type IconName = keyof typeof SVGS;
export const ICON_NAMES = Object.keys(SVGS) as IconName[];

/** Inline SVG string for an icon, sized to 1em (scale via font-size/width). */
export function icon(name: IconName): string {
  return `<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">${SVGS[name]}</svg>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/platform-core && npx vitest run tests/shell/icons.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/platform-core/src/shell/components/icons.ts packages/platform-core/tests/shell/icons.test.ts
git commit -m "feat(platform-core): duotone shell icon set"
```

---

## Task 2: Motion util (`motion.ts`)

**Files:**
- Create: `packages/platform-core/src/shell/motion.ts`
- Test: `packages/platform-core/tests/shell/motion.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/platform-core/tests/shell/motion.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { prefersReducedMotion, countUp } from '@/shell/motion';

describe('prefersReducedMotion', () => {
  it('treats missing matchMedia (jsdom) as reduced', () => {
    // jsdom has no matchMedia by default
    expect(prefersReducedMotion()).toBe(true);
  });
});

describe('countUp', () => {
  it('with reduced motion, sets the final formatted text immediately', () => {
    const el = document.createElement('div');
    countUp(el, 0, 250, (n) => `€${n.toFixed(0)}`);
    expect(el.textContent).toBe('€250');
  });

  it('animates when motion is allowed (matchMedia stub + fake rAF)', () => {
    (globalThis as any).matchMedia = vi.fn().mockReturnValue({ matches: false });
    const frames: FrameRequestCallback[] = [];
    const realRaf = globalThis.requestAnimationFrame;
    (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; };
    const el = document.createElement('div');
    countUp(el, 0, 100, (n) => `${Math.round(n)}`, 100);
    frames.forEach((f) => f(1000));         // advance past duration
    expect(el.textContent).toBe('100');
    (globalThis as any).requestAnimationFrame = realRaf;
    delete (globalThis as any).matchMedia;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/platform-core && npx vitest run tests/shell/motion.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write the implementation**

`packages/platform-core/src/shell/motion.ts`:
```ts
/** True when the user (or environment) prefers no motion. Missing matchMedia
 *  — e.g. jsdom / SSR — is treated as reduced so animations never block. */
export function prefersReducedMotion(): boolean {
  const mm = (globalThis as { matchMedia?: (q: string) => { matches: boolean } }).matchMedia;
  if (typeof mm !== 'function') return true;
  return mm('(prefers-reduced-motion: reduce)').matches;
}

/** Animate el's text from `from` to `to` via `fmt`. Skips to final value when
 *  motion is reduced or rAF is unavailable. */
export function countUp(
  el: HTMLElement,
  from: number,
  to: number,
  fmt: (n: number) => string,
  durationMs = 450,
): void {
  const raf = (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame;
  if (prefersReducedMotion() || typeof raf !== 'function') {
    el.textContent = fmt(to);
    return;
  }
  let start = 0;
  const tick = (t: number) => {
    if (!start) start = t;
    const p = Math.min(1, (t - start) / durationMs);
    const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
    el.textContent = fmt(from + (to - from) * eased);
    if (p < 1) raf(tick);
    else el.textContent = fmt(to);
  };
  raf(tick);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/platform-core && npx vitest run tests/shell/motion.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/platform-core/src/shell/motion.ts packages/platform-core/tests/shell/motion.test.ts
git commit -m "feat(platform-core): shell motion util (reduced-motion guard + count-up)"
```

---

## Task 3: Neutral tokens + CSS rewrite (`theme.ts`, `shell.css.ts`)

**Files:**
- Modify: `packages/platform-core/src/shell/theme.ts`
- Modify: `packages/platform-core/src/shell/shell.css.ts`
- Modify: `packages/platform-core/tests/shell/theme.test.ts`

- [ ] **Step 1: Update the theme test**

Replace the body of `packages/platform-core/tests/shell/theme.test.ts` with:
```ts
import { describe, it, expect } from 'vitest';
import { buildThemeVars } from '@/shell/theme';

describe('buildThemeVars', () => {
  it('emits the neutral token set with brand defaults', () => {
    const vars = buildThemeVars();
    for (const t of ['--shell-fg', '--shell-muted', '--shell-icon', '--shell-icon-bright', '--shell-accent', '--shell-surface', '--shell-spin']) {
      expect(vars).toContain(t);
    }
  });

  it('only accent + buyBonus are game-overridable', () => {
    const vars = buildThemeVars({ accent: '#ff0000', buyBonusColor: '#00ff00' });
    expect(vars).toContain('--shell-accent: #ff0000');
    expect(vars).toContain('--shell-buybonus: #00ff00');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/platform-core && npx vitest run tests/shell/theme.test.ts`
Expected: FAIL — new tokens not emitted.

- [ ] **Step 3: Rewrite `theme.ts`**

`packages/platform-core/src/shell/theme.ts`:
```ts
import type { ThemeConfig } from './types';

const DEFAULT_ACCENT = '#8b5cf6';   // brand purple — BUY BONUS + active states
const DEFAULT_BUYBONUS = '#8b5cf6'; // buy bonus tint (overridable per game)

/** CSS custom-property block for the shell root. Neutral system; only accent
 *  and buyBonus are game-overridable. */
export function buildThemeVars(theme: ThemeConfig = {}): string {
  return [
    `--shell-fg: #f3f5fa`,
    `--shell-muted: #9aa3b6`,
    `--shell-icon: #c7cedb`,
    `--shell-icon-bright: #e8ecf4`,
    `--shell-surface: #0c111c`,
    `--shell-hairline: rgba(255,255,255,.07)`,
    `--shell-spin: #f4f6fb`,
    `--shell-spin-fg: #141a28`,
    `--shell-radius: 12px`,
    `--shell-accent: ${theme.accent ?? DEFAULT_ACCENT}`,
    `--shell-buybonus: ${theme.buyBonusColor ?? DEFAULT_BUYBONUS}`,
  ].join('; ') + ';';
}
```

- [ ] **Step 4: Rewrite `shell.css.ts`**

Replace `packages/platform-core/src/shell/shell.css.ts` entirely:
```ts
export const SHELL_ROOT_ID = '__ge-game-shell__';

export const SHELL_CSS = `
#${SHELL_ROOT_ID} {
  position: absolute; inset: 0;
  pointer-events: none; z-index: 9000;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: var(--shell-fg);
}
#${SHELL_ROOT_ID} svg { display:block; }

/* ── floating readouts (no panel) ── */
#${SHELL_ROOT_ID} .ge-rd { font-weight:700; font-size:13px; line-height:1; white-space:nowrap;
  text-shadow:0 1px 3px rgba(0,0,0,.65); font-variant-numeric:tabular-nums; }
#${SHELL_ROOT_ID} .ge-rd .ge-lbl { display:block; color:var(--shell-muted); font-weight:600;
  font-size:9px; letter-spacing:.1em; text-transform:uppercase; margin-bottom:4px; text-shadow:none; }

/* ── icon buttons (borderless) ── */
#${SHELL_ROOT_ID} .ge-iconbtn { pointer-events:auto; cursor:pointer; border:none; background:none;
  padding:0; color:var(--shell-icon); width:40px; height:40px; display:flex; align-items:center;
  justify-content:center; font-size:24px; position:relative; transition:transform .08s ease; }
#${SHELL_ROOT_ID} .ge-iconbtn:active { transform:scale(.92); }
#${SHELL_ROOT_ID} .ge-iconbtn[disabled] { opacity:.35; cursor:default; }
#${SHELL_ROOT_ID} .ge-iconbtn.ge-active::after { content:''; position:absolute; bottom:2px; left:50%;
  transform:translateX(-50%); width:5px; height:5px; border-radius:50%; background:var(--shell-accent); }

/* ── SPIN (solid white disc) ── */
#${SHELL_ROOT_ID} .ge-shell-spin { pointer-events:auto; cursor:pointer; border:none; border-radius:50%;
  width:58px; height:58px; background:var(--shell-spin); color:var(--shell-spin-fg);
  font-size:30px; display:flex; align-items:center; justify-content:center; transition:transform .08s ease; }
#${SHELL_ROOT_ID} .ge-shell-spin:active { transform:scale(.94); }
#${SHELL_ROOT_ID} .ge-shell-spin[disabled] { opacity:.4; cursor:default; }

/* ── BUY BONUS (the one accent) ── */
#${SHELL_ROOT_ID} .ge-shell-buybonus { pointer-events:auto; cursor:pointer; border:none; border-radius:10px;
  background:var(--shell-buybonus); color:#fff; font-weight:800; font-size:12px; letter-spacing:.02em;
  padding:10px 14px; display:flex; align-items:center; gap:7px; font-size:13px; transition:transform .08s ease; }
#${SHELL_ROOT_ID} .ge-shell-buybonus:active { transform:scale(.96); }
#${SHELL_ROOT_ID} .ge-shell-buybonus[disabled] { opacity:.4; cursor:default; }
#${SHELL_ROOT_ID} .ge-shell-buybonus svg { font-size:17px; }

/* ── bottom bar: transparent, two zones (wide default) ── */
#${SHELL_ROOT_ID} .ge-shell-bottom { position:absolute; left:0; right:0; bottom:0; pointer-events:none;
  display:flex; align-items:flex-end; justify-content:space-between; padding:14px 18px; gap:14px; }
#${SHELL_ROOT_ID} .ge-zone { display:flex; align-items:center; gap:14px; pointer-events:none; }
#${SHELL_ROOT_ID} .ge-zone > * { pointer-events:auto; }
#${SHELL_ROOT_ID} .ge-betstep { display:flex; flex-direction:column; gap:2px; }
#${SHELL_ROOT_ID} .ge-bet-value, #${SHELL_ROOT_ID} .ge-balance, #${SHELL_ROOT_ID} .ge-win,
#${SHELL_ROOT_ID} .ge-fs-counter, #${SHELL_ROOT_ID} .ge-fs-totalwin, #${SHELL_ROOT_ID} .ge-fs-lastwin {
  /* these carry the .ge-rd look via JS adding the class */ }

/* ── narrow arrangement (spin-center) ── */
#${SHELL_ROOT_ID}.ge-narrow .ge-shell-bottom { flex-direction:column; align-items:stretch; gap:10px; padding:10px 12px 12px; }
#${SHELL_ROOT_ID}.ge-narrow .ge-zone-info { justify-content:space-between; }
#${SHELL_ROOT_ID}.ge-narrow .ge-zone-buy { justify-content:center; }
#${SHELL_ROOT_ID}.ge-narrow .ge-zone-controls { justify-content:center; gap:12px; }
#${SHELL_ROOT_ID}.ge-narrow .ge-zone-menu { position:absolute; left:5%; bottom:7%; }
#${SHELL_ROOT_ID}.ge-narrow .ge-shell-spin { width:62px; height:62px; }

/* ── freeSpins counter hero ── */
#${SHELL_ROOT_ID} .ge-fs-hero { text-align:center; }
#${SHELL_ROOT_ID} .ge-fs-hero b { display:block; color:#fff; font-weight:800; font-size:28px; line-height:1;
  font-variant-numeric:tabular-nums; text-shadow:0 1px 4px rgba(0,0,0,.6); }
#${SHELL_ROOT_ID} .ge-fs-hero span { display:block; color:var(--shell-muted); font-size:10px;
  letter-spacing:.14em; text-transform:uppercase; margin-top:6px; }

/* ── full-screen overlays ── */
#${SHELL_ROOT_ID} .ge-shell-overlay { position:absolute; inset:0; pointer-events:auto; background:var(--shell-surface);
  display:flex; flex-direction:column; animation:ge-ov-in .18s ease-out; }
@keyframes ge-ov-in { from { opacity:0; } to { opacity:1; } }
#${SHELL_ROOT_ID} .ge-ov-head { display:flex; align-items:center; gap:14px; padding:16px 20px;
  border-bottom:1px solid var(--shell-hairline); }
#${SHELL_ROOT_ID} .ge-ov-head h4 { flex:1; color:var(--shell-fg); font-size:15px; font-weight:700; margin:0; }
#${SHELL_ROOT_ID} .ge-ov-nav { background:none; border:none; cursor:pointer; color:var(--shell-icon);
  width:22px; height:22px; font-size:22px; display:flex; align-items:center; justify-content:center; }
#${SHELL_ROOT_ID} .ge-ov-body { padding:18px 20px; overflow:auto; }

/* settings rows */
#${SHELL_ROOT_ID} .ge-set-row { display:flex; align-items:center; max-width:560px; color:var(--shell-fg);
  font-size:13px; font-weight:600; padding:8px 0; }
#${SHELL_ROOT_ID} .ge-set-row .ge-grow { flex:1; }
#${SHELL_ROOT_ID} .ge-slider { width:100%; max-width:560px; accent-color:var(--shell-accent); }
#${SHELL_ROOT_ID} .ge-toggle { width:38px; height:22px; border-radius:999px; background:rgba(255,255,255,.16);
  border:none; cursor:pointer; position:relative; }
#${SHELL_ROOT_ID} .ge-toggle.ge-on { background:var(--shell-accent); }
#${SHELL_ROOT_ID} .ge-toggle i { position:absolute; top:2px; left:2px; width:18px; height:18px; border-radius:50%;
  background:#fff; transition:left .12s ease; }
#${SHELL_ROOT_ID} .ge-toggle.ge-on i { left:18px; }
#${SHELL_ROOT_ID} .ge-navbtn { display:flex; align-items:center; gap:12px; max-width:560px; margin-top:12px;
  padding:14px 16px; border:1px solid var(--shell-hairline); border-radius:11px; background:none;
  color:var(--shell-fg); font-size:13px; font-weight:700; cursor:pointer; width:100%; }
#${SHELL_ROOT_ID} .ge-navbtn .ge-grow { flex:1; text-align:left; }

/* game info */
#${SHELL_ROOT_ID} .ge-gi-sec { margin-bottom:16px; }
#${SHELL_ROOT_ID} .ge-gi-sec h3 { color:var(--shell-muted); font-size:10px; letter-spacing:.14em;
  text-transform:uppercase; margin:0 0 7px; }
#${SHELL_ROOT_ID} .ge-gi-sec p, #${SHELL_ROOT_ID} .ge-shell-sym-row, #${SHELL_ROOT_ID} .ge-shell-feat-row {
  color:#dfe4ee; font-size:12px; line-height:1.5; }

/* buy bonus cards */
#${SHELL_ROOT_ID} .ge-bb-grid { display:flex; flex-wrap:wrap; gap:16px; }
#${SHELL_ROOT_ID} .ge-shell-bonus-card { flex:1 1 220px; text-align:left; pointer-events:auto; cursor:pointer;
  border:1px solid var(--shell-hairline); border-radius:14px; padding:18px; background:none; color:var(--shell-fg); }
#${SHELL_ROOT_ID} .ge-shell-bonus-card[disabled] { opacity:.4; cursor:default; }
#${SHELL_ROOT_ID} .ge-bonus-name { font-size:16px; font-weight:800; }
#${SHELL_ROOT_ID} .ge-bonus-vol { letter-spacing:3px; font-size:14px; margin:8px 0; }
#${SHELL_ROOT_ID} .ge-bonus-desc { color:var(--shell-muted); font-size:12px; margin-bottom:12px; line-height:1.4; }
#${SHELL_ROOT_ID} .ge-bonus-price { font-weight:800; font-size:18px; font-variant-numeric:tabular-nums; }

#${SHELL_ROOT_ID}.ge-shell-hidden { opacity:0; pointer-events:none; transition:opacity .25s ease; }
`;
```

- [ ] **Step 5: Run the theme test to verify it passes**

Run: `cd packages/platform-core && npx vitest run tests/shell/theme.test.ts`
Expected: PASS. (Other shell tests will be red until Tasks 4–8; that's expected — do not run the whole suite yet.)

- [ ] **Step 6: Commit**

```bash
git add packages/platform-core/src/shell/theme.ts packages/platform-core/src/shell/shell.css.ts packages/platform-core/tests/shell/theme.test.ts
git commit -m "feat(platform-core): neutral shell tokens + transparent/adaptive/overlay CSS"
```

---

## Task 4: GameShell — layout flag, ResizeObserver, count-up hook, menu→Settings

**Files:**
- Modify: `packages/platform-core/src/shell/GameShell.ts`
- Test: `packages/platform-core/tests/shell/layout.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/platform-core/tests/shell/layout.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createGameShell, removeGameShell } from '@/shell';
import type { ShellConfig } from '@/shell/types';

function cfg(mount: HTMLElement): ShellConfig {
  return {
    mount, gameInfo: {}, language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [1, 2], defaultBet: 1, currentBet: null,
    balance: 100, win: 0, mode: 'base',
    features: { turbo: 0, autoplay: false, buyBonus: false },
  };
}

describe('GameShell layout', () => {
  let mount: HTMLElement;
  beforeEach(async () => { document.body.innerHTML = ''; mount = document.createElement('div'); document.body.appendChild(mount); await removeGameShell(); });

  it('defaults to wide layout (no ResizeObserver dimensions in jsdom)', () => {
    const shell = createGameShell(cfg(mount));
    expect(shell.layout).toBe('wide');
    expect(mount.querySelector('#__ge-game-shell__')!.classList.contains('ge-narrow')).toBe(false);
  });

  it('setLayout("narrow") adds the ge-narrow class and re-renders', () => {
    const shell = createGameShell(cfg(mount));
    shell.setLayout('narrow');
    expect(shell.layout).toBe('narrow');
    expect(mount.querySelector('#__ge-game-shell__')!.classList.contains('ge-narrow')).toBe(true);
  });

  it('opening the menu opens the Settings overlay', () => {
    const shell = createGameShell(cfg(mount));
    shell.openMenu();
    expect(mount.querySelector('[data-ge="settings-modal"]')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/platform-core && npx vitest run tests/shell/layout.test.ts`
Expected: FAIL — `setLayout`/`layout` undefined.

- [ ] **Step 3: Modify `GameShell.ts`**

(a) Add imports near the top (the Menu import is removed):
```ts
import { prefersReducedMotion } from './motion';
```
Remove `import { openMenuModal } from './components/Menu';` (Menu is deleted in Task 6; remove its usage now).

(b) Add fields to the class (near `barHost`/`modalHost`):
```ts
  layout: 'wide' | 'narrow' = 'wide';
  private ro: ResizeObserver | null = null;
  private prevBalance = 0;
  private prevWin = 0;
```

(c) In the constructor, after `this.root.appendChild(this.modalHost);` and before `this.render();`, seed prev values and start observing:
```ts
    this.prevBalance = this.state.balance;
    this.prevWin = this.state.win;
    this.observeLayout();
```

(d) Add methods (place after `render()`):
```ts
  setLayout(layout: 'wide' | 'narrow'): void {
    if (layout === this.layout) return;
    this.layout = layout;
    this.root.classList.toggle('ge-narrow', layout === 'narrow');
    this.render();
  }

  private observeLayout(): void {
    const RO = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (typeof RO !== 'function') return; // jsdom: stays 'wide'
    this.ro = new RO((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      this.setLayout(w > 0 && w < 720 ? 'narrow' : 'wide');
    });
    this.ro.observe(this.root);
  }
```

(e) Replace `render()` so it sets the narrow class and runs the count-up hook:
```ts
  render(): void {
    if (this.destroyed) return;
    this.root.classList.toggle('ge-narrow', this.layout === 'narrow');
    this.barHost.innerHTML = '';
    this.barHost.appendChild(renderBottomBar(this));
    this.animateMoney();
  }

  /** After a render, count-up balance/win from their previous values. */
  private animateMoney(): void {
    void prefersReducedMotion; // imported for clarity; countUp guards internally
    this.prevBalance = this.state.balance;
    this.prevWin = this.state.win;
  }
```
(Count-up is wired in Task 5 where the readouts gain stable nodes; for now `animateMoney` just tracks prev values so the hook exists. Keep this exact shape.)

(f) Replace `openMenu()` to open Settings (Menu list is gone):
```ts
  openMenu(): void { this.emit('menuOpen'); this.openSettings(); }
```

(g) In `destroy()`, before the fade timer, disconnect the observer — add at the top of `destroy()` after `this.destroyed = true;`:
```ts
    this.ro?.disconnect();
    this.ro = null;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/platform-core && npx vitest run tests/shell/layout.test.ts`
Expected: PASS. (`openMenu` opens Settings — `settings-modal` node present.)

- [ ] **Step 5: Commit**

```bash
git add packages/platform-core/src/shell/GameShell.ts packages/platform-core/tests/shell/layout.test.ts
git commit -m "feat(platform-core): shell layout flag + ResizeObserver + menu→settings"
```

---

## Task 5: BottomBar rewrite — zones, icons, SPIN disc, wide/narrow, no replay badge

**Files:**
- Modify: `packages/platform-core/src/shell/components/BottomBar.ts`
- Modify: `packages/platform-core/tests/shell/bottombar.test.ts`
- Modify: `packages/platform-core/tests/shell/bottombar-modes.test.ts`

- [ ] **Step 1: Update `bottombar.test.ts`**

The data-ge hooks and behaviour assertions stay; only adjust the two that depended on glyph text. Open `packages/platform-core/tests/shell/bottombar.test.ts` and:
- Keep all `data-ge` existence, event, `setBusy`, `setBalance/setWin`, gating tests as-is.
- The balance assertion `toContain('€1.000')` stays (text unchanged).
- No assertion checks button glyph text, so no change needed there.
Add one new test inside `describe('BottomBar base mode', ...)`:
```ts
  it('renders SVG icons for icon controls (not text glyphs)', () => {
    createGameShell(cfg(mount, { turbo: 2, buyBonus: [{ id: 'b', name: 'B', description: 'd', priceMultiplier: 1 }] }));
    expect(q(mount, '[data-ge="menu"]')!.querySelector('svg')).toBeTruthy();
    expect(q(mount, '[data-ge="turbo"]')!.querySelector('svg')).toBeTruthy();
    expect(q(mount, '[data-ge="spin"]')!.querySelector('svg')).toBeTruthy();
  });
```

- [ ] **Step 2: Update `bottombar-modes.test.ts` — remove the replay badge assertion**

In `packages/platform-core/tests/shell/bottombar-modes.test.ts`, in the replay test, DELETE the line:
```ts
    expect(q(mount, '[data-ge="replay-badge"]')).toBeTruthy();
```
Keep the read-only bet/win/turbo assertions. (Replay no longer shows a badge.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/platform-core && npx vitest run tests/shell/bottombar.test.ts tests/shell/bottombar-modes.test.ts`
Expected: FAIL — icons not present yet / structure mismatch.

- [ ] **Step 4: Rewrite `BottomBar.ts`**

`packages/platform-core/src/shell/components/BottomBar.ts`:
```ts
import type { GameShell } from '../GameShell';
import { formatCurrency } from '../format';
import { stepBet, nextTurbo } from '../state';
import { icon, type IconName } from './icons';

/** A floating labelled money readout (balance/win/bet). */
function readout(ge: string, label: string, value: string): HTMLElement {
  const el = document.createElement('div');
  el.dataset.ge = ge;
  el.className = `ge-rd ge-${ge}`;
  el.innerHTML = `<span class="ge-lbl">${label}</span>`;
  el.append(document.createTextNode(value));
  return el;
}

/** A borderless icon button. */
function iconBtn(ge: string, name: IconName, onClick: () => void, active = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = `ge-iconbtn${active ? ' ge-active' : ''}`;
  b.dataset.ge = ge;
  b.innerHTML = icon(name);
  b.addEventListener('click', () => { if (!b.disabled) onClick(); });
  return b;
}

export function renderBottomBar(shell: GameShell): HTMLElement {
  const { state, config } = shell;
  const fmt = (n: number) => formatCurrency(n, config.currency);
  const narrow = shell.layout === 'narrow';
  const bar = document.createElement('div');
  bar.className = 'ge-shell-bottom';
  bar.dataset.geMode = state.mode;

  // menu icon button (always)
  const menu = iconBtn('menu', 'menu', () => shell.openMenu());

  if (state.mode === 'base') {
    const balance = readout('balance', 'Balance', fmt(state.balance));
    const win = readout('win', 'Win', fmt(state.win));
    const betValue = readout('bet-value', 'Bet', fmt(state.bet));

    const betDown = iconBtn('bet-down', narrow ? 'betMinus' : 'betDown', () => onBet(shell, -1));
    const betUp = iconBtn('bet-up', narrow ? 'betPlus' : 'betUp', () => onBet(shell, 1));

    const spin = document.createElement('button');
    spin.className = 'ge-shell-spin'; spin.dataset.ge = 'spin'; spin.innerHTML = icon('spin');
    spin.addEventListener('click', () => { if (!spin.disabled) shell.emit('spin'); });

    const turbo = config.features.turbo > 0
      ? iconBtn('turbo', 'turbo', () => onTurbo(shell), state.turbo > 0) : null;
    const auto = config.features.autoplay
      ? iconBtn('autoplay', 'autoplay', () => onAutoplay(shell), state.autoplay.active) : null;
    const buy = config.features.buyBonus !== false ? buyBtn(shell) : null;

    if (narrow) {
      const info = zone('ge-zone-info', balance, win);
      const buyZone = buy ? zone('ge-zone-buy', buy) : zone('ge-zone-buy');
      const betCol = document.createElement('div');
      betCol.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:5px';
      betCol.append(spin, betValue);
      const controls = zone('ge-zone-controls', ...compact([turbo, betDown, betCol, betUp, auto]));
      bar.append(info, buyZone, controls, zone('ge-zone-menu', menu));
    } else {
      const left = zone('ge-zone-left', menu, balance, win, ...(buy ? [buy] : []));
      const step = document.createElement('div'); step.className = 'ge-betstep'; step.append(betUp, betDown);
      const right = zone('ge-zone-right', ...compact([betValue, step, turbo, auto, spin]));
      bar.append(left, right);
    }
  } else if (state.mode === 'freeSpins') {
    const hero = document.createElement('div');
    hero.className = 'ge-fs-hero'; hero.dataset.ge = 'fs-counter';
    hero.innerHTML = `<b>${state.freeSpins.current} / ${state.freeSpins.total}</b><span>Free spins</span>`;
    const turbo = config.features.turbo > 0 ? iconBtn('turbo', 'turbo', () => onTurbo(shell), state.turbo > 0) : null;
    const center = zone('ge-zone-fs',
      readout('balance', 'Balance', fmt(state.balance)),
      hero,
      readout('fs-totalwin', 'Total win', fmt(state.freeSpins.totalWin)),
      readout('fs-lastwin', 'Last win', fmt(state.freeSpins.lastWin)),
    );
    bar.append(zone('ge-zone-left', menu), center, zone('ge-zone-right', ...compact([readout('bet-value', 'Bet', fmt(state.bet)), turbo])));
  } else { // replay — read-only, NO badge
    const turbo = config.features.turbo > 0 ? iconBtn('turbo', 'turbo', () => onTurbo(shell), state.turbo > 0) : null;
    const center = zone('ge-zone-replay',
      readout('bet-value', 'Bet', fmt(state.bet)),
      readout('win', 'Win', fmt(state.win)),
      ...(state.freeSpins.total > 0 ? [readout('fs-counter', 'Free spins', `${state.freeSpins.current} / ${state.freeSpins.total}`)] : []),
      ...compact([turbo]),
    );
    bar.append(zone('ge-zone-left', menu), center);
  }

  applyBusy(shell, bar);
  return bar;
}

function zone(cls: string, ...children: HTMLElement[]): HTMLElement {
  const z = document.createElement('div');
  z.className = `ge-zone ${cls}`;
  z.append(...children);
  return z;
}
function compact(items: (HTMLElement | null)[]): HTMLElement[] { return items.filter((x): x is HTMLElement => x !== null); }

function buyBtn(shell: GameShell): HTMLButtonElement {
  const buy = document.createElement('button');
  buy.className = 'ge-shell-buybonus'; buy.dataset.ge = 'buybonus';
  buy.innerHTML = `${icon('gift')}<span>BUY BONUS</span>`;
  buy.addEventListener('click', () => { if (!buy.disabled) shell.openBuyBonus(); });
  return buy;
}

function onBet(shell: GameShell, dir: 1 | -1): void {
  if (shell.state.busy) return;
  const next = stepBet(shell.state, dir);
  if (next !== shell.state.bet) { shell.state.bet = next; shell.emit('betChange', next); shell.render(); }
}
function onTurbo(shell: GameShell): void {
  const next = nextTurbo(shell.state.turbo, shell.config.features.turbo);
  shell.state.turbo = next; shell.emit('turboChange', next); shell.render();
}
function onAutoplay(shell: GameShell): void {
  const active = !shell.state.autoplay.active;
  shell.state.autoplay = { active, remaining: active ? shell.state.autoplay.remaining : 0 };
  if (active) shell.emit('autoplayStart', shell.state.autoplay); else shell.emit('autoplayStop');
  shell.render();
}

function applyBusy(shell: GameShell, bar: HTMLElement): void {
  const busy = shell.state.busy;
  for (const ge of ['spin', 'bet-up', 'bet-down', 'autoplay']) {
    const el = bar.querySelector(`[data-ge="${ge}"]`) as HTMLButtonElement | null;
    if (el) el.disabled = busy;
  }
  const buy = bar.querySelector('[data-ge="buybonus"]') as HTMLButtonElement | null;
  if (buy) buy.disabled = busy || !shell.state.buyBonusEnabled;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/platform-core && npx vitest run tests/shell/bottombar.test.ts tests/shell/bottombar-modes.test.ts tests/shell/layout.test.ts`
Expected: PASS. Note: `fs-counter` is now a `.ge-fs-hero` whose text contains `"3 / 10"`; the existing `toContain('3')`/`toContain('10')` assertions still hold.

- [ ] **Step 6: Commit**

```bash
git add packages/platform-core/src/shell/components/BottomBar.ts packages/platform-core/tests/shell/bottombar.test.ts packages/platform-core/tests/shell/bottombar-modes.test.ts
git commit -m "feat(platform-core): BottomBar visual rewrite (zones, icons, SPIN disc, adaptive, no replay badge)"
```

---

## Task 6: Menu→Settings merge — full-screen Settings overlay with Game info button

**Files:**
- Delete: `packages/platform-core/src/shell/components/Menu.ts`
- Modify: `packages/platform-core/src/shell/components/Settings.ts`
- Modify: `packages/platform-core/tests/shell/menu.test.ts`

- [ ] **Step 1: Rewrite `menu.test.ts`**

Replace `packages/platform-core/tests/shell/menu.test.ts` entirely:
```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createGameShell, removeGameShell } from '@/shell';
import type { ShellConfig } from '@/shell/types';

function cfg(mount: HTMLElement): ShellConfig {
  return {
    mount, gameInfo: { rtp: 96 }, language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [1, 2], defaultBet: 1, currentBet: null,
    balance: 100, win: 0, mode: 'base',
    features: { turbo: 0, autoplay: false, buyBonus: false },
  };
}
const q = (m: HTMLElement, s: string) => m.querySelector(s) as HTMLElement | null;

describe('Settings overlay (opened from menu)', () => {
  let mount: HTMLElement;
  beforeEach(async () => { document.body.innerHTML = ''; mount = document.createElement('div'); document.body.appendChild(mount); await removeGameShell(); });

  it('menu button opens the Settings overlay and emits both events', () => {
    const shell = createGameShell(cfg(mount));
    const menuSpy = vi.fn(); const setSpy = vi.fn();
    shell.on('menuOpen', menuSpy); shell.on('settingsOpen', setSpy);
    q(mount, '[data-ge="menu"]')!.click();
    expect(menuSpy).toHaveBeenCalledOnce();
    expect(setSpy).toHaveBeenCalledOnce();
    expect(q(mount, '[data-ge="settings-modal"]')).toBeTruthy();
  });

  it('Settings has Sound toggle + master/music/sfx sliders, no quickspin', () => {
    const shell = createGameShell(cfg(mount));
    shell.openSettings();
    expect(q(mount, '[data-ge="setting-sound"]')).toBeTruthy();
    expect(q(mount, '[data-ge="setting-master"]')).toBeTruthy();
    expect(q(mount, '[data-ge="setting-music"]')).toBeTruthy();
    expect(q(mount, '[data-ge="setting-sfx"]')).toBeTruthy();
    expect(q(mount, '[data-ge="setting-quickspin"]')).toBeNull();
  });

  it('sound toggle emits settingChange', () => {
    const shell = createGameShell(cfg(mount));
    const spy = vi.fn(); shell.on('settingChange', spy);
    shell.openSettings();
    q(mount, '[data-ge="setting-sound"]')!.click();
    expect(spy).toHaveBeenCalledWith({ key: 'sound', value: false });
  });

  it('master slider emits settingChange', () => {
    const shell = createGameShell(cfg(mount));
    const spy = vi.fn(); shell.on('settingChange', spy);
    shell.openSettings();
    const s = q(mount, '[data-ge="setting-master"]') as HTMLInputElement;
    s.value = '0.3'; s.dispatchEvent(new Event('input'));
    expect(spy).toHaveBeenCalledWith({ key: 'master', value: 0.3 });
  });

  it('Game info button opens the Game info overlay', () => {
    const shell = createGameShell(cfg(mount));
    shell.openSettings();
    const btn = q(mount, '[data-ge="game-info-btn"]')!;
    expect(btn).toBeTruthy();
    btn.click();
    expect(q(mount, '[data-ge="info-modal"]')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/platform-core && npx vitest run tests/shell/menu.test.ts`
Expected: FAIL — settings structure / game-info-btn not present.

- [ ] **Step 3: Delete `Menu.ts`**

```bash
git rm packages/platform-core/src/shell/components/Menu.ts
```
(`GameShell.openMenu()` already calls `openSettings()` after Task 4, and the Menu import was removed there.)

- [ ] **Step 4: Rewrite `Settings.ts`**

`packages/platform-core/src/shell/components/Settings.ts`:
```ts
import type { GameShell } from '../GameShell';
import { createOverlay } from './primitives';
import { icon } from './icons';

export function openSettingsModal(shell: GameShell): HTMLElement {
  const { root, body } = createOverlay({ title: 'Settings', onClose: () => root.remove() });
  root.dataset.ge = 'settings-modal';

  // Sound toggle
  const sound = (() => {
    let on = true;
    const btn = document.createElement('button');
    btn.className = 'ge-toggle ge-on'; btn.dataset.ge = 'setting-sound'; btn.innerHTML = '<i></i>';
    btn.addEventListener('click', () => {
      on = !on; btn.classList.toggle('ge-on', on);
      shell.emit('settingChange', { key: 'sound', value: on });
    });
    const row = document.createElement('div'); row.className = 'ge-set-row';
    row.innerHTML = '<span class="ge-grow">Sound</span>'; row.appendChild(btn);
    return row;
  })();
  body.appendChild(sound);

  const slider = (key: string, label: string) => {
    const row = document.createElement('div'); row.className = 'ge-set-row';
    row.style.flexDirection = 'column'; row.style.alignItems = 'stretch'; row.style.gap = '8px';
    const head = document.createElement('div'); head.className = 'ge-grow';
    head.style.cssText = 'display:flex;justify-content:space-between'; head.innerHTML = `<span>${label}</span>`;
    const input = document.createElement('input');
    input.type = 'range'; input.min = '0'; input.max = '1'; input.step = '0.05'; input.value = '1';
    input.className = 'ge-slider'; input.dataset.ge = `setting-${key}`;
    input.addEventListener('input', () => shell.emit('settingChange', { key, value: Number(input.value) }));
    row.append(head, input);
    return row;
  };
  body.appendChild(slider('master', 'Master volume'));
  body.appendChild(slider('music', 'Music'));
  body.appendChild(slider('sfx', 'SFX'));

  const gameInfo = document.createElement('button');
  gameInfo.className = 'ge-navbtn'; gameInfo.dataset.ge = 'game-info-btn';
  gameInfo.innerHTML = `<span style="width:22px">${icon('info')}</span><span class="ge-grow">Game info</span><span style="width:20px">${icon('chevronRight')}</span>`;
  gameInfo.addEventListener('click', () => { root.remove(); shell.openInfo(); });
  body.appendChild(gameInfo);

  return root;
}
```

- [ ] **Step 5: Add `createOverlay` to `primitives.ts`**

In `packages/platform-core/src/shell/components/primitives.ts`, add (keep `createModal` — BuyBonus/GameInfo migrate to `createOverlay` in their tasks; `createModal` can be removed once unused, but leaving it is harmless):
```ts
import { icon } from './icons';

export interface OverlayOpts {
  title: string;
  onClose: () => void;
  onBack?: () => void;
}

/** Full-screen overlay. Returns { root, body }; append content to body. */
export function createOverlay(opts: OverlayOpts): { root: HTMLDivElement; body: HTMLDivElement } {
  const root = document.createElement('div');
  root.className = 'ge-shell-overlay';
  const head = document.createElement('div');
  head.className = 'ge-ov-head';
  if (opts.onBack) {
    const back = document.createElement('button');
    back.className = 'ge-ov-nav'; back.dataset.ge = 'info-back'; back.innerHTML = icon('back');
    back.addEventListener('click', opts.onBack);
    head.appendChild(back);
  }
  const h = document.createElement('h4'); h.textContent = opts.title; head.appendChild(h);
  const close = document.createElement('button');
  close.className = 'ge-ov-nav'; close.innerHTML = icon('close');
  close.addEventListener('click', opts.onClose);
  head.appendChild(close);
  const body = document.createElement('div'); body.className = 'ge-ov-body';
  root.append(head, body);
  return { root, body };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd packages/platform-core && npx vitest run tests/shell/menu.test.ts`
Expected: PASS. (Game info button click depends on Task 7's `info-modal` hook still being emitted by the current GameInfo — it already sets `data-ge="info-modal"`, so this passes now and stays green after Task 7.)

- [ ] **Step 7: Commit**

```bash
git add packages/platform-core/src/shell/components/Settings.ts packages/platform-core/src/shell/components/primitives.ts packages/platform-core/tests/shell/menu.test.ts
git rm --cached packages/platform-core/src/shell/components/Menu.ts 2>/dev/null; true
git commit -m "feat(platform-core): merge menu into full-screen Settings overlay + Game info button"
```

---

## Task 7: GameInfo — full-screen overlay with back button

**Files:**
- Modify: `packages/platform-core/src/shell/components/GameInfo.ts`
- Modify: `packages/platform-core/tests/shell/gameinfo.test.ts`

- [ ] **Step 1: Add a back-button test**

In `packages/platform-core/tests/shell/gameinfo.test.ts`, keep the existing two tests and add inside the `describe`:
```ts
  it('has a back control that returns to Settings', () => {
    const shell = createGameShell(cfg(mount));
    shell.openInfo();
    const back = q(mount, '[data-ge="info-back"]')!;
    expect(back).toBeTruthy();
    back.click();
    expect(q(mount, '[data-ge="settings-modal"]')).toBeTruthy();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/platform-core && npx vitest run tests/shell/gameinfo.test.ts`
Expected: FAIL — no `info-back`.

- [ ] **Step 3: Modify `GameInfo.ts`**

Change the header construction to use `createOverlay` with a back handler, and wrap sections with the section class. `packages/platform-core/src/shell/components/GameInfo.ts`:
```ts
import type { GameShell } from '../GameShell';
import { createOverlay } from './primitives';

export function openGameInfoModal(shell: GameShell): HTMLElement {
  const info = shell.config.gameInfo;
  const { root, body } = createOverlay({
    title: 'Game info',
    onClose: () => root.remove(),
    onBack: () => { root.remove(); shell.openSettings(); },
  });
  root.dataset.ge = 'info-modal';

  const section = (ge: string, title: string): HTMLElement => {
    const sec = document.createElement('section');
    sec.dataset.ge = ge; sec.className = 'ge-gi-sec';
    const h = document.createElement('h3'); h.textContent = title; sec.appendChild(h);
    return sec;
  };

  if (typeof info.rtp === 'number') {
    const s = section('info-rtp', 'RTP'); const p = document.createElement('p'); p.textContent = `${info.rtp}%`; s.appendChild(p); body.appendChild(s);
  }
  if (info.rules) {
    const s = section('info-rules', 'Rules'); const p = document.createElement('p'); p.textContent = info.rules; s.appendChild(p); body.appendChild(s);
  }
  if (info.symbols?.length) {
    const s = section('info-symbols', 'Paytable');
    for (const sym of info.symbols) { const r = document.createElement('div'); r.className = 'ge-shell-sym-row'; r.textContent = sym.payouts ? `${sym.name} — ${sym.payouts}` : sym.name; s.appendChild(r); }
    body.appendChild(s);
  }
  if (info.features?.length) {
    const s = section('info-features', 'Features');
    for (const f of info.features) { const r = document.createElement('div'); r.className = 'ge-shell-feat-row'; r.textContent = `${f.name}: ${f.description}`; s.appendChild(r); }
    body.appendChild(s);
  }
  return root;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/platform-core && npx vitest run tests/shell/gameinfo.test.ts`
Expected: PASS (all three).

- [ ] **Step 5: Commit**

```bash
git add packages/platform-core/src/shell/components/GameInfo.ts packages/platform-core/tests/shell/gameinfo.test.ts
git commit -m "feat(platform-core): Game info as full-screen overlay with back to Settings"
```

---

## Task 8: BuyBonus — full-screen overlay, restyled cards

**Files:**
- Modify: `packages/platform-core/src/shell/components/BuyBonus.ts`
- Test: `packages/platform-core/tests/shell/buybonus.test.ts` (unchanged hooks — verify green)

- [ ] **Step 1: Modify `BuyBonus.ts`**

`packages/platform-core/src/shell/components/BuyBonus.ts`:
```ts
import type { GameShell } from '../GameShell';
import type { BonusOption } from '../types';
import { formatCurrency } from '../format';
import { createOverlay } from './primitives';

export function openBuyBonusOverlay(shell: GameShell): HTMLElement | null {
  const bonuses = shell.config.features.buyBonus;
  if (bonuses === false || bonuses.length === 0) return null;

  const { root, body } = createOverlay({ title: 'Buy bonus', onClose: () => root.remove() });
  root.dataset.ge = 'buybonus-overlay';
  const grid = document.createElement('div'); grid.className = 'ge-bb-grid';
  for (const bonus of bonuses) grid.appendChild(buildCard(shell, bonus, root));
  body.appendChild(grid);
  return root;
}

function buildCard(shell: GameShell, bonus: BonusOption, root: HTMLElement): HTMLElement {
  const price = bonus.priceMultiplier * shell.state.bet;
  const accent = bonus.accentColor ?? 'var(--shell-accent)';
  const card = document.createElement('button');
  card.className = 'ge-shell-bonus-card'; card.dataset.ge = `bonus-card-${bonus.id}`;
  card.style.borderColor = accent;
  const stars = bonus.volatility ? '★'.repeat(bonus.volatility) : '';
  card.innerHTML = `
    <div class="ge-bonus-name">${bonus.name}</div>
    <div class="ge-bonus-vol" style="color:${accent}">${stars}</div>
    <div class="ge-bonus-desc">${bonus.description}</div>
    <div class="ge-bonus-price" style="color:${accent}">${formatCurrency(price, shell.config.currency)}</div>
  `;
  card.addEventListener('click', () => {
    if (shell.state.busy || !shell.state.buyBonusEnabled) return;
    shell.emit('buyBonusSelect', { id: bonus.id });
    root.remove();
  });
  return card;
}
```

- [ ] **Step 2: Run the buybonus tests (hooks unchanged)**

Run: `cd packages/platform-core && npx vitest run tests/shell/buybonus.test.ts`
Expected: PASS — `buybonus-overlay`, `bonus-card-<id>`, price substrings, and `buyBonusSelect` all unchanged.

- [ ] **Step 3: Commit**

```bash
git add packages/platform-core/src/shell/components/BuyBonus.ts
git commit -m "feat(platform-core): Buy bonus as full-screen overlay with accent cards"
```

---

## Task 9: Wire count-up + full suite + typecheck + build + example + docs

**Files:**
- Modify: `packages/platform-core/src/shell/GameShell.ts` (finish count-up)
- Modify: `packages/platform-core/README.md`
- Verify: `examples/shell-demo` still builds (no code change expected)

- [ ] **Step 1: Add a count-up test**

`packages/platform-core/tests/shell/countup.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createGameShell, removeGameShell } from '@/shell';
import type { ShellConfig } from '@/shell/types';

function cfg(mount: HTMLElement): ShellConfig {
  return { mount, gameInfo: {}, language: 'en', currency: { symbol: '€', position: 'left' },
    availableBets: [1], defaultBet: 1, currentBet: null, balance: 100, win: 0, mode: 'base',
    features: { turbo: 0, autoplay: false, buyBonus: false } };
}

describe('count-up (reduced motion in jsdom → final value immediately)', () => {
  let mount: HTMLElement;
  beforeEach(async () => { document.body.innerHTML = ''; mount = document.createElement('div'); document.body.appendChild(mount); await removeGameShell(); });

  it('setWin shows the final formatted value synchronously under reduced motion', () => {
    const shell = createGameShell(cfg(mount));
    shell.setWin(42);
    expect((mount.querySelector('[data-ge="win"]') as HTMLElement).textContent).toContain('€42');
  });
});
```

- [ ] **Step 2: Run it to verify it passes already (text is final after render)**

Run: `cd packages/platform-core && npx vitest run tests/shell/countup.test.ts`
Expected: PASS — `render()` writes the final value; under reduced motion no animation overrides it. (This test pins the behaviour so the count-up wiring in Step 3 cannot regress it.)

- [ ] **Step 3: Finish the count-up hook in `GameShell.ts`**

Replace `animateMoney()` (added in Task 4) with a version that animates the just-rendered readouts from the previous values, guarded by reduced motion. Add import at top if missing: `import { countUp } from './motion';`. Replace the method:
```ts
  private animateMoney(): void {
    const fmt = (n: number) => formatCurrencyRef(this, n);
    const bal = this.barHost.querySelector('[data-ge="balance"]') as HTMLElement | null;
    const win = this.barHost.querySelector('[data-ge="win"]') as HTMLElement | null;
    // readout nodes contain a label span then a text node; animate the text node only
    if (bal && this.state.balance !== this.prevBalance) animateReadout(bal, this.prevBalance, this.state.balance, fmt);
    if (win && this.state.win !== this.prevWin) animateReadout(win, this.prevWin, this.state.win, fmt);
    this.prevBalance = this.state.balance;
    this.prevWin = this.state.win;
  }
```
Add these module-level helpers at the bottom of `GameShell.ts` (after the class), plus the `countUp`/`formatCurrency` imports:
```ts
import { formatCurrency } from './format';

function formatCurrencyRef(shell: GameShell, n: number): string {
  return formatCurrency(n, shell.config.currency);
}

/** Animate the trailing text node of a .ge-rd readout (keeps its label span). */
function animateReadout(el: HTMLElement, from: number, to: number, fmt: (n: number) => string): void {
  const textNode = el.lastChild;
  if (!textNode || textNode.nodeType !== Node.TEXT_NODE) { el.lastChild && (el.lastChild.textContent = fmt(to)); return; }
  const proxy = { set textContent(v: string) { (textNode as Text).data = v; }, get textContent() { return (textNode as Text).data; } } as unknown as HTMLElement;
  countUp(proxy, from, to, fmt);
}
```
Note: under reduced motion (jsdom) `countUp` sets the final value synchronously, so the Step-1 test stays green.

- [ ] **Step 4: Run the full shell suite + typecheck**

Run: `cd packages/platform-core && npx vitest run tests/shell/`
Expected: PASS (icons, motion, theme, layout, bottombar, bottombar-modes, menu, gameinfo, buybonus, countup, smoke, lifecycle, state, format, primitives).
Run: `npm run typecheck` (repo root)
Expected: clean.

- [ ] **Step 5: Verify the example still builds (no code change expected)**

Run: `cd examples/shell-demo && npx tsc --noEmit && npx vite build`
Expected: PASS. The demo uses the public API only; the new look applies automatically. If `tsc` flags anything, STOP and report (no API changed, so it should be clean).

- [ ] **Step 6: Build both packages**

Run: `npm run build --workspace @energy8platform/platform-core --workspace @energy8platform/game-engine`
Expected: PASS; `dist/shell.*` regenerated.

- [ ] **Step 7: Update README**

In `packages/platform-core/README.md`, under the shell section, add a short paragraph:
```md
**Visual system:** transparent neutral chrome that doesn't compete with the game —
brand colour appears only on the BUY BONUS control and a distinctive duotone icon set.
The bottom bar adapts by viewport width (spin-right on wide screens, spin-centered on
narrow), menu stays bottom-left, and Settings / Game info / Buy bonus open as full-screen
overlays. Motion is minimal (press feedback, balance/win count-up, overlay fades) and
respects `prefers-reduced-motion`.
```

- [ ] **Step 8: Commit**

```bash
git add packages/platform-core/src/shell/GameShell.ts packages/platform-core/tests/shell/countup.test.ts packages/platform-core/README.md
git commit -m "feat(platform-core): wire balance/win count-up; visual-design docs"
```

---

## Self-Review (coverage vs spec)

- Transparent chrome, no panel/divider/blur → Task 3 CSS. ✓
- Neutral tokens; only accent + buyBonus overridable → Tasks 2/3 (`theme.ts` + test). ✓
- Duotone icon set (full inventory) → Task 1. ✓
- SPIN solid white disc; active-state purple dot → Task 3 CSS + Task 5 (`ge-active`). ✓
- Adaptive spin-right (wide) / spin-center (narrow); menu always bottom-left → Task 4 (layout + RO) + Task 5 (zones). ✓
- Modes: base / freeSpins hero / replay read-only **no badge** → Task 5 (+ test removes badge). ✓
- Full-screen overlays (Settings/GameInfo/BuyBonus) → Tasks 6/7/8 (`createOverlay`). ✓
- Menu → Settings merge; Settings = Sound + sliders + Game info button; remove quickspin/fullscreen/battery → Tasks 4/6 (+ rewritten menu test). ✓
- Game info opened from Settings as its own overlay with back → Task 7. ✓
- Buy bonus per-bonus accent / volatility 1–5 / live price → Task 8. ✓
- Motion minimal + reduced-motion guard (press, count-up, fade) → Task 2 (util) + Task 3 (CSS) + Task 9 (wire). ✓
- Contract/events/`data-ge` preserved; only changed assertions updated → Tasks 5–8 test edits. ✓
- Example + build/typecheck gate → Task 9. ✓

**Out of scope (per spec):** new brand assets, theming beyond accent/buyBonus, sound/haptics design.
```
