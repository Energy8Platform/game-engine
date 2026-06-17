# @energy8platform/pixi-shell

The Energy8 branded game shell, rendered entirely in **PixiJS v8** — a 1:1 port of the
renderer-agnostic DOM shell in
[`@energy8platform/platform-core/shell`](../platform-core/src/shell). Same visual language
(styles, scaling, icons), same public API and events, drawn with Pixi `Container`/`Graphics`/`Text`
instead of DOM + CSS so it composes directly into a Pixi game's stage.

> Use this when your game is already a Pixi application and you want the control bar, menu,
> settings, game info and buy-bonus chrome to live **inside** the WebGL canvas (one render tree,
> one resize path) rather than as a DOM overlay on top of it.

## What it draws

Everything the DOM shell draws, pixel-for-pixel where it matters:

- **Bottom control bar** — grouped dark/glass plaques, the black-rim SPIN disc, the round BUY BONUS
  badge, balance/win/bet readouts with count-up, bet stepper, autoplay (with STOP + countdown),
  turbo. Wide (landscape) and stacked mobile (portrait) layouts, with the same overflow behaviour
  (lift the WIN pill, then fit-scale the whole stack).
- **Overlays** — Settings (sound + volume sliders + game-info link) and Game info (modes, controls,
  paytable, win illustrations incl. `classic` / `cluster` / `anywhere` / `ways` / `shapes`,
  custom).
- **Card modals** — bet & autoplay pickers, the generic `openModal`, the non-dismissable replay
  summary, and the buy-bonus overlay + confirm.
- **Theming** — dark/light scheme + game accent, social-casino vocabulary, the bundled Inter
  webfont, and the same SVG icon set (rendered as Pixi vector graphics via `GraphicsContext.svg`).

The icons, colours, currency formatter, social word-swap and state helpers are ported from
platform-core so the two shells stay in lock-step.

## Usage

```ts
import { Application } from 'pixi.js';
import { createPixiShell } from '@energy8platform/pixi-shell';

const app = new Application();
await app.init({ width: 1280, height: 720, background: '#0b0820', antialias: true });
document.body.appendChild(app.canvas);

const shell = createPixiShell({
  app, // the shell attaches to app.stage and fills app.screen
  theme: { scheme: 'dark', accent: '#8b5cf6' },
  language: 'en',
  currency: { symbol: '€', position: 'left' },
  availableBets: [0.2, 0.5, 1, 2, 5],
  defaultBet: 1,
  currentBet: null,
  balance: 1000,
  win: 0,
  mode: 'base',
  gameInfo: { sections: [/* modes, controls, paytable, wins… */] },
  features: { turbo: 3, autoplay: {}, buyBonus: [/* … */] },
});

shell.on('spin', () => { /* run a spin, then shell.setBusy(false), shell.setWin(…) */ });
shell.on('betChange', (bet) => { /* … */ });
```

The config mirrors `@energy8platform/platform-core/shell`'s `ShellConfig` field-for-field, swapping
`mount: HTMLElement` for the Pixi `app`. Events (`spin`, `betChange`, `autoplayStart`,
`buyBonusSelect`, `featureActivate`, …) and the imperative setters (`setBalance`, `setWin`,
`setMode`, `setBusy`, `setAutoplay`, `setFreeSpins`, `setTheme`, `setSocial`, …) are identical.

Tear down with `removePixiShell()`.

## Notes

- Peer dependency: `pixi.js` `^8.16`. Depends on `@energy8platform/platform-core` for the shared
  shell type contract.
- Backdrop blur (the DOM `backdrop-filter`) is approximated with a frosted dark veil — true
  per-pixel blur of the game behind would require compositing the game layer into the same filter
  pass.
- See [`examples/pixi-shell-demo`](../../examples/pixi-shell-demo) for a full, interactive demo
  (screen presets, modes, theme, language, replay) — `npm run dev` inside it.
