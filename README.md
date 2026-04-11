# @energy8platform/game-engine

A casino game engine built on [PixiJS v8](https://pixijs.com/) and [@energy8platform/game-sdk](https://github.com/energy8platform/game-sdk). Provides scene management, responsive scaling, audio, state machines, tweens, UI components, Lua scripting, and React integration for developing slot machines, card games, and other iGaming titles.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Installation](#installation)
- [Architecture](#architecture)
- [Configuration](#configuration)
- [Scenes](#scenes)
- [Lifecycle](#lifecycle)
- [Assets](#assets)
- [Audio](#audio)
- [Viewport & Scaling](#viewport--scaling)
- [State Machine](#state-machine)
- [Animation](#animation)
- [UI Components](#ui-components)
- [Input](#input)
- [Vite Configuration](#vite-configuration)
- [Lua Engine](#lua-engine)
- [DevBridge](#devbridge)
- [React Integration](#react-integration)
- [Debug](#debug)
- [License](#license)

---

## Quick Start

```bash
# Install dependencies
npm install pixi.js @energy8platform/game-sdk @energy8platform/game-engine

# Optional peer dependencies
npm install @pixi/ui @pixi/layout yoga-layout    # UI components (Layout, Panel, ScrollContainer)
npm install @pixi/sound                           # Audio
npm install @esotericsoftware/spine-pixi-v8       # Spine animations
npm install react react-dom react-reconciler      # React integration
npm install fengari                               # Lua engine
```

```typescript
// src/main.ts
import { GameApplication, ScaleMode } from '@energy8platform/game-engine';
import { GameScene } from './scenes/GameScene';

async function bootstrap() {
  const game = new GameApplication({
    container: '#game',
    designWidth: 1920,
    designHeight: 1080,
    scaleMode: ScaleMode.FIT,
    loading: {
      backgroundColor: 0x0a0a1a,
      tapToStart: true,
      minDisplayTime: 2000,
    },
    manifest: {
      bundles: [
        { name: 'preload', assets: [] },
        { name: 'game', assets: [
          { alias: 'background', src: 'background.png' },
          { alias: 'symbols', src: 'symbols.json' },
        ]},
      ],
    },
    audio: { music: 0.5, sfx: 1.0, persist: true },
    debug: true,
  });

  game.scenes.register('game', GameScene);
  await game.start('game');
}

bootstrap();
```

---

## Installation

### Peer Dependencies

| Package | Version | Required |
| --- | --- | --- |
| `pixi.js` | `^8.16.0` | Yes |
| `@energy8platform/game-sdk` | `^2.7.0` | Yes |
| `@pixi/ui` | `^2.3.0` | Optional — Button, ScrollContainer, ProgressBar |
| `@pixi/layout` | `^3.2.0` | Optional — Layout, Panel (Yoga flexbox) |
| `yoga-layout` | `^3.0.0` | Optional — peer dep of `@pixi/layout` |
| `@pixi/sound` | `^6.0.0` | Optional — audio |
| `@esotericsoftware/spine-pixi-v8` | `~4.2.0` | Optional — Spine animations |
| `react`, `react-dom` | `>=18.0.0` | Optional — ReactScene |
| `react-reconciler` | `>=0.29.0` | Optional — ReactScene (custom PixiJS reconciler) |
| `fengari` | `^0.1.4` | Optional — Lua engine |

### Sub-path Exports

```typescript
import { GameApplication } from '@energy8platform/game-engine';             // full bundle
import { Scene, SceneManager } from '@energy8platform/game-engine/core';
import { AssetManager } from '@energy8platform/game-engine/assets';
import { AudioManager } from '@energy8platform/game-engine/audio';
import { Button, Label, Modal, Layout, ScrollContainer, Panel, Toast } from '@energy8platform/game-engine/ui';
import { Tween, Timeline, Easing, SpriteAnimation } from '@energy8platform/game-engine/animation';
import { DevBridge, FPSOverlay } from '@energy8platform/game-engine/debug';
import { ReactScene, createPixiRoot, useSDK, useViewport } from '@energy8platform/game-engine/react';
import { defineGameConfig } from '@energy8platform/game-engine/vite';
import { LuaEngine, ActionRouter } from '@energy8platform/game-engine/lua';
```

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                   GameApplication                    │
│  (orchestrates lifecycle, holds all sub-systems)     │
├──────────┬───────────┬───────────┬───────────────────┤
│ Viewport │  Scenes   │  Assets   │  Audio  │  Input  │
│ Manager  │  Manager  │  Manager  │ Manager │ Manager │
├──────────┴───────────┴───────────┴─────────┴─────────┤
│                    PixiJS v8 Application              │
├──────────────────────────────────────────────────────┤
│              @energy8platform/game-sdk                │
└──────────────────────────────────────────────────────┘
```

### Boot Sequence

1. **CSS Preloader** — HTML/CSS overlay while PixiJS initializes
2. **PixiJS initialization** — creates `Application`, initializes `ResizeObserver`
3. **SDK handshake** — connects to casino host (or DevBridge in dev mode)
4. **Canvas Loading Screen** — progress bar, `preload` bundle loaded first
5. **Asset loading** — remaining bundles loaded with combined progress
6. **Tap-to-start** — optional (required on mobile for audio unlock)
7. **First scene** — transitions to the registered first scene

---

## Configuration

### `GameApplicationConfig`

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `container` | `HTMLElement \| string` | `document.body` | Container element or CSS selector |
| `designWidth` | `number` | `1920` | Reference design width |
| `designHeight` | `number` | `1080` | Reference design height |
| `scaleMode` | `ScaleMode` | `FIT` | `FIT` (letterbox), `FILL` (crop), `STRETCH` |
| `orientation` | `Orientation` | `ANY` | `LANDSCAPE`, `PORTRAIT`, `ANY` |
| `loading` | `LoadingScreenConfig` | — | Loading screen options (see types) |
| `manifest` | `AssetManifest` | — | Asset manifest |
| `audio` | `AudioConfig` | — | `{ music, sfx, ui, ambient }` volumes (0-1), `persist` flag |
| `sdk` | `object \| false` | — | SDK options; `false` to disable |
| `pixi` | `Partial<ApplicationOptions>` | — | PixiJS pass-through options |
| `debug` | `boolean` | `false` | Enable FPS overlay |

> Full config types including `LoadingScreenConfig`, `AudioConfig`, `TransitionType` are documented in `src/types.ts`.

---

## Scenes

All game screens are scenes. Extend the base `Scene` class:

```typescript
import { Scene } from '@energy8platform/game-engine';
import { Sprite, Assets } from 'pixi.js';

export class GameScene extends Scene {
  async onEnter(data?: unknown) {
    this.container.addChild(new Sprite(Assets.get('background')));
  }

  onUpdate(dt: number) { /* called every frame */ }
  onResize(width: number, height: number) { /* responsive layout */ }
  async onExit() { /* cleanup before leaving */ }
  onDestroy() { /* final cleanup */ }
}
```

### Scene Navigation

```typescript
const scenes = game.scenes;

scenes.register('menu', MenuScene);
scenes.register('game', GameScene);
scenes.register('bonus', BonusScene);

await scenes.goto('game');                    // replaces entire stack
await scenes.push('bonus', { multiplier: 3 }); // overlay (previous stays)
await scenes.pop();                           // pop back
await scenes.replace('game');                 // replace top scene

// With transitions
await scenes.goto('game', undefined, {
  type: TransitionType.FADE,
  duration: 500,
});
```

---

## Lifecycle

`GameApplication` events:

| Event | Payload | When |
| --- | --- | --- |
| `initialized` | `void` | Engine initialized, PixiJS and SDK ready |
| `loaded` | `void` | All asset bundles loaded |
| `started` | `void` | First scene entered, game loop running |
| `resize` | `{ width, height }` | Viewport resized |
| `orientationChange` | `Orientation` | Device orientation changed |
| `sceneChange` | `{ from, to }` | Scene transition completed |
| `balanceUpdate` | `{ balance }` | Player balance changed (from SDK) |
| `error` | `Error` | An error occurred |
| `destroyed` | `void` | Engine destroyed |

---

## Assets

Assets are organized in named bundles. The `preload` bundle loads first, the rest load together with a combined progress bar.

```typescript
const manifest = {
  bundles: [
    { name: 'preload', assets: [{ alias: 'logo', src: 'logo.png' }] },
    { name: 'game', assets: [
      { alias: 'background', src: 'bg.webp' },
      { alias: 'symbols', src: 'symbols.json' },
    ]},
  ],
};

// Runtime API
const assets = game.assets;
await assets.loadBundle('bonus', (progress) => console.log(`${Math.round(progress * 100)}%`));
const texture = assets.get<Texture>('background');
await assets.backgroundLoad('bonus');       // low-priority preload
await assets.unloadBundle('bonus');          // free memory
```

---

## Audio

`AudioManager` wraps `@pixi/sound` with category-based volume. All methods are no-ops if `@pixi/sound` is not installed.

```typescript
const audio = game.audio;

audio.play('click', 'ui');
audio.play('coin-drop', 'sfx', { volume: 0.8 });
audio.playMusic('main-theme', 1000);  // 1s crossfade
audio.stopMusic();

audio.setVolume('music', 0.3);
audio.muteCategory('sfx');
audio.muteAll();
audio.toggleMute();

// Ducking during big win animations
audio.duckMusic(0.2);
audio.unduckMusic();
```

**Categories:** `music`, `sfx`, `ui`, `ambient` — each with independent volume and mute.

> Mobile audio unlock is handled automatically when `tapToStart: true`.

---

## Viewport & Scaling

`ViewportManager` handles responsive scaling using `ResizeObserver` with debouncing.

| Mode | Behavior |
| --- | --- |
| `FIT` | Letterbox/pillarbox — preserves aspect ratio. **Industry standard for iGaming.** |
| `FILL` | Fills container, crops edges |
| `STRETCH` | Stretches to fill (distorts). Not recommended. |

```typescript
const vp = game.viewport;
console.log(vp.width, vp.height, vp.scale, vp.orientation);
vp.refresh(); // force re-calculation
```

---

## State Machine

Generic typed FSM with transition guards, async hooks, and per-frame updates.

```typescript
import { StateMachine } from '@energy8platform/game-engine';

const fsm = new StateMachine<{ balance: number; bet: number }>({
  balance: 10000, bet: 100,
});

fsm.addState('idle', {
  enter: (ctx) => console.log('Waiting...'),
});

fsm.addState('spinning', {
  enter: async (ctx) => {
    await spinReels();
    await fsm.transition('idle');
  },
});

fsm.addGuard('idle', 'spinning', (ctx) => ctx.balance >= ctx.bet);

await fsm.start('idle');
const success = await fsm.transition('spinning'); // false if guard blocks
fsm.update(dt); // call from Scene.onUpdate
```

---

## Animation

### Tween

Promise-based animation system on the PixiJS Ticker. No external libraries.

```typescript
import { Tween, Easing } from '@energy8platform/game-engine';

await Tween.to(sprite, { alpha: 0, y: 100 }, 500, Easing.easeOutCubic);
await Tween.from(sprite, { scale: 0 }, 300, Easing.easeOutBack);
await Tween.fromTo(sprite, { x: -100 }, { x: 500 }, 1000, Easing.easeInOutQuad);
await Tween.delay(1000);

Tween.killTweensOf(sprite);
Tween.killAll();
Tween.reset(); // kill all + remove ticker listener
```

All standard easings available: `linear`, `easeIn/Out/InOut` for `Quad`, `Cubic`, `Quart`, `Sine`, `Expo`, `Back`, `Bounce`, `Elastic`.

### Timeline

Chains sequential and parallel animation steps:

```typescript
const tl = new Timeline();
tl.to(title, { alpha: 1, y: 0 }, 500, Easing.easeOutCubic)
  .delay(200)
  .parallel(
    () => Tween.to(btn1, { alpha: 1 }, 300),
    () => Tween.to(btn2, { alpha: 1 }, 300),
  )
  .call(() => console.log('Done!'));
await tl.play();
```

### SpriteAnimation

Frame-based animation wrapping PixiJS `AnimatedSprite`. Config: `{ fps, loop, autoPlay, onComplete, anchor }`.

```typescript
import { SpriteAnimation } from '@energy8platform/game-engine';

const coin = SpriteAnimation.create(coinTextures, { fps: 30, loop: true });
const sparkle = SpriteAnimation.fromSpritesheet(sheet, 'sparkle_', { fps: 24 });

// Fire-and-forget
const { sprite, finished } = SpriteAnimation.playOnce(textures, { fps: 30 });
container.addChild(sprite);
await finished;
```

### Spine Animations

Requires `@esotericsoftware/spine-pixi-v8`:

```typescript
import { SpineHelper } from '@energy8platform/game-engine';

const spine = await SpineHelper.create('character-skel', 'character-atlas', { scale: 0.5 });
await SpineHelper.playAnimation(spine, 'idle', true);
SpineHelper.setSkin(spine, 'warrior');
```

---

## UI Components

> Requires `@pixi/ui` and `@pixi/layout` + `yoga-layout` as peer dependencies. Import from `@energy8platform/game-engine/ui`.
>
> For components not wrapped by the engine (`Slider`, `CheckBox`, `Input`, `Select`, etc.), import directly from `@pixi/ui`.

### Layout

Responsive flexbox container powered by `@pixi/layout`. Supports `horizontal`, `vertical`, `grid`, `wrap` modes with alignment, padding, gap, anchoring, and viewport breakpoints.

```typescript
import { Layout } from '@energy8platform/game-engine/ui';

const toolbar = new Layout({
  direction: 'horizontal',
  gap: 20,
  alignment: 'center',
  anchor: 'bottom-center',
  padding: 16,
  breakpoints: { 768: { direction: 'vertical', gap: 10 } },
});
toolbar.addItem(spinButton);
toolbar.addItem(betLabel);
toolbar.updateViewport(width, height);
```

**Anchors:** `top-left`, `top-center`, `top-right`, `center-left`, `center`, `center-right`, `bottom-left`, `bottom-center`, `bottom-right`

### ScrollContainer

Touch/drag scrollable container with mouse wheel, inertia, and dynamic rendering. Extends `@pixi/ui` ScrollBox.

```typescript
const scroll = new ScrollContainer({
  width: 600, height: 400,
  direction: 'vertical',
  elementsMargin: 8,
  backgroundColor: 0x1a1a2e,
});
for (let i = 0; i < 50; i++) scroll.addItem(createRow(i));
```

### Button

Extends `@pixi/ui` FancyButton. Supports Graphics-based and texture-based states, press animation, and text.

```typescript
const spinBtn = new Button({
  width: 200, height: 60,
  borderRadius: 12,
  colors: { default: 0xffd700, hover: 0xffe44d, pressed: 0xccac00, disabled: 0x666666 },
  pressScale: 0.95,
  text: 'SPIN',
});
spinBtn.onPress.connect(() => console.log('Spin!'));
spinBtn.disable();
spinBtn.enable();
```

### Other UI Components

**Label** — styled text wrapper:
```typescript
new Label({ text: 'TOTAL WIN', style: { fontSize: 36, fill: 0xffffff } });
```

**BalanceDisplay** — animated currency display:
```typescript
const balance = new BalanceDisplay({ currency: 'USD', animated: true });
balance.setValue(9500);
```

**WinDisplay** — countup win animation:
```typescript
await winDisplay.showWin(5000); // countup over 2 seconds
```

**ProgressBar** — animated fill bar (wraps `@pixi/ui`):
```typescript
const bar = new ProgressBar({ width: 400, height: 20, fillColor: 0x00ff00, animated: true });
bar.progress = 0.75;
bar.update(dt); // call each frame for animation
```

**Panel** — background panel with flex layout (Graphics or 9-slice):
```typescript
const panel = new Panel({ width: 600, height: 400, backgroundColor: 0x1a1a2e, borderRadius: 16, padding: 16 });
panel.content.addChild(myText); // children participate in flexbox
```

**Modal** — full-screen overlay dialog:
```typescript
const modal = new Modal({ overlayAlpha: 0.7, closeOnOverlay: true, animationDuration: 300 });
await modal.show(viewWidth, viewHeight);
```

**Toast** — notification messages (`info`, `success`, `warning`, `error`):
```typescript
await toast.show('Free spins activated!', 'success', viewWidth, viewHeight);
```

---

## Input

`InputManager` provides unified touch/mouse/keyboard handling with gesture detection.

```typescript
const input = game.input;

input.on('tap', ({ x, y }) => console.log(`Tap at ${x}, ${y}`));
input.on('swipe', ({ direction, velocity }) => console.log(`Swipe ${direction}`));
input.on('keydown', ({ key, code }) => { if (code === 'Space') startSpin(); });
if (input.isKeyDown('ArrowLeft')) { /* move left */ }

input.lock();   // lock during animations
input.unlock();

const worldPos = input.getWorldPosition(canvasX, canvasY); // DOM → game-world coords
```

**Events:** `tap`, `press`, `release`, `move`, `swipe`, `keydown`, `keyup`

---

## Vite Configuration

```typescript
// vite.config.ts
import { defineGameConfig } from '@energy8platform/game-engine/vite';

export default defineGameConfig({
  base: '/games/my-slot/',
  devBridge: true,
  devBridgeConfig: './dev.config', // optional custom config path
  vite: { /* additional Vite config */ },
});
```

**What `defineGameConfig` provides:** ESNext build target (for yoga-layout WASM), asset inlining (<8KB), PixiJS chunk splitting, DevBridge auto-injection in dev mode, dependency deduplication (`pixi.js`, `@pixi/layout`, `react`, etc.), and pre-bundling optimization.

---

## Lua Engine

Runs platform Lua game scripts in the browser via `fengari` (Lua 5.3, pure JS). Replicates server-side execution for development — no backend required.

### DevBridge Integration (recommended)

```typescript
// dev.config.ts
import luaScript from './game.lua?raw';

export default {
  balance: 5000,
  currency: 'USD',
  luaScript,
  gameDefinition: {
    id: 'my-slot',
    type: 'SLOT',
    actions: {
      spin: {
        stage: 'base_game', debit: 'bet', credit: 'win',
        transitions: [
          { condition: 'free_spins_awarded > 0', creates_session: true, next_actions: ['free_spin'] },
          { condition: 'always', next_actions: ['spin'] },
        ],
      },
      free_spin: { stage: 'free_spins', debit: 'none', requires_session: true,
        transitions: [{ condition: 'always', next_actions: ['free_spin'] }],
      },
    },
    bet_levels: [0.2, 0.5, 1, 2, 5],
  },
};
```

### Standalone Usage

```typescript
const engine = new LuaEngine({ script: luaSource, gameDefinition, seed: 42 });
const result = engine.execute({ action: 'spin', bet: 1.0 });
// result: { totalWin, data, nextActions, session }
engine.destroy();
```

### Platform API (`engine.*` in Lua)

| Function | Description |
| --- | --- |
| `engine.random(min, max)` | Random integer `[min, max]` |
| `engine.random_float()` | Random float `[0.0, 1.0)` |
| `engine.random_weighted(weights)` | 1-based index from weight table |
| `engine.shuffle(arr)` | Fisher-Yates shuffle, returns copy |
| `engine.log(level, msg)` | Log (`"debug"`, `"info"`, `"warn"`, `"error"`) |
| `engine.get_config()` | Returns `{id, type, bet_levels}` |

**Features:** Action routing, transition evaluation (`>`, `>=`, `==`, `!=`, `&&`, `||`, `"always"`), session management (free spins, retriggers), cross-spin persistent state, max win cap, buy bonus, deterministic seeded PRNG (xoshiro128**).

### RTP Simulation (CLI)

Run the same Lua script from `dev.config.ts` through millions of iterations to verify math:

```bash
# Regular spins (1M iterations, default)
npx game-engine-simulate

# Buy bonus simulation
npx game-engine-simulate --action buy_bonus

# Ante bet
npx game-engine-simulate --params '{"ante_bet":true}'

# Custom parameters
npx game-engine-simulate --iterations 5000000 --bet 1 --seed 42 --config ./dev.config.ts
```

Output matches the platform's server-side simulation format:

```
Starting simulation for my-slot (1000000 iterations, action: spin)...
Progress: 100000/1000000 (10%)
...

--- Simulation Results ---
Game: my-slot
Action: spin
Iterations: 1,000,000
Duration: 45.2s
Total RTP: 96.48%
Base Game RTP: 72.31%
Bonus RTP: 24.17%
Hit Frequency: 28.45%
Max Win: 5234.50x
Max Win Hits: 3 (rounds capped by max_win)
Bonus Triggered: 4,521 (1 in 221 spins)
Bonus Spins Played: 52,847
```

The CLI reads `luaScript` and `gameDefinition` from your `dev.config.ts` — the same config used for DevBridge. Programmatic usage:

```typescript
import { SimulationRunner, formatSimulationResult } from '@energy8platform/game-engine/lua';

const runner = new SimulationRunner({
  script: luaSource,
  gameDefinition,
  iterations: 1_000_000,
  bet: 1.0,
  seed: 42,
  onProgress: (done, total) => console.log(`${done}/${total}`),
});

const result = runner.run();
console.log(formatSimulationResult(result));
```

---

## DevBridge

Simulates a casino host for local development using SDK's `Bridge` in `devMode` (shared `MemoryChannel`, no iframe needed).

```typescript
import { DevBridge } from '@energy8platform/game-engine/debug';

const bridge = new DevBridge({
  balance: 10000,
  currency: 'USD',
  networkDelay: 200,
  debug: true,
  gameConfig: { id: 'my-slot', type: 'slot', betLevels: [0.1, 0.5, 1, 5, 10] },
  onPlay: ({ action, bet }) => {
    const win = Math.random() < 0.4 ? bet * 5 : 0;
    return { win };
  },
  // OR use Lua: luaScript, gameDefinition, luaSeed
});

bridge.start();
bridge.setBalance(5000);
bridge.destroy();
```

**Handled messages:** `GAME_READY`, `PLAY_REQUEST`, `PLAY_RESULT_ACK`, `GET_BALANCE`, `GET_STATE`, `OPEN_DEPOSIT`.

> With the Vite plugin (`devBridge: true`), DevBridge is injected automatically before your app entry point.

---

## React Integration

Built-in React reconciler for PixiJS. No `@pixi/react` needed — renders React trees directly into PixiJS Containers.

```tsx
import { ReactScene, extendPixiElements, useSDK, useViewport, useBalance } from '@energy8platform/game-engine/react';

extendPixiElements(); // register PixiJS elements for JSX (call once)

export class GameScene extends ReactScene {
  render() { return <GameRoot />; }
}

function GameRoot() {
  const { width, height } = useViewport();
  const balance = useBalance();
  const sdk = useSDK();

  return (
    <container>
      <text text={`Balance: $${balance.toFixed(2)}`} style={{ fontSize: 32, fill: 0xffffff }} />
      <text text="SPIN" style={{ fontSize: 48, fill: 0xffd700 }}
        eventMode="static" cursor="pointer"
        onClick={async () => {
          const result = await sdk?.play({ action: 'spin', bet: 1 });
          sdk?.playAck(result!);
        }}
      />
    </container>
  );
}
```

### Hooks

| Hook | Returns | Description |
| --- | --- | --- |
| `useEngine()` | `EngineContextValue` | Full engine context |
| `useSDK()` | `CasinoGameSDK \| null` | SDK instance |
| `useAudio()` | `AudioManager` | Audio manager |
| `useInput()` | `InputManager` | Input manager |
| `useViewport()` | `{ width, height, scale, isPortrait }` | Reactive viewport |
| `useBalance()` | `number` | Reactive balance |
| `useSession()` | `SessionData \| null` | Current session |
| `useGameConfig<T>()` | `T \| null` | Game config from SDK |

### Element Registration

```typescript
import { extendPixiElements, extendLayoutElements, extend } from '@energy8platform/game-engine/react';

extendPixiElements();                              // Container, Sprite, Text, Graphics, etc.
extendLayoutElements(await import('@pixi/layout/components')); // @pixi/layout (if installed)
extend({ Button, Panel });                         // custom classes
```

After registration, use as lowercase JSX: `<container>`, `<sprite>`, `<text>`, `<graphics>`, `<button>`.

**Props:** Regular props set directly (`alpha`, `visible`, `scale`). Nested via dash: `position-x`, `scale-y`. Events: `onClick` → `onclick`, `onPointerDown` → `onpointerdown`.

> React is entirely optional. Imperative (`Scene`) and React (`ReactScene`) scenes can coexist.

---

## Debug

When `debug: true` in config, an FPS overlay (avg FPS, min FPS, frame time) is shown automatically.

```typescript
import { FPSOverlay } from '@energy8platform/game-engine/debug';
const fps = new FPSOverlay(game.app);
fps.show();
fps.toggle();
fps.hide();
```

---

## API Types

All API types are fully documented in TypeScript. Explore `src/types.ts` for config interfaces, enums, and re-exported SDK types. Individual class APIs are visible via IDE autocompletion or by reading the source modules directly.

---

## License

MIT
