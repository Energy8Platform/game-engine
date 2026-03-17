# @energy8platform/game-engine

A universal casino game engine built on [PixiJS v8](https://pixijs.com/) and [@energy8platform/game-sdk](https://github.com/energy8platform/game-sdk). Provides a batteries-included framework for developing slot machines, card games, and other iGaming titles with responsive scaling, animated loading screens, scene management, audio, state machines, tweens, and a rich UI component library.

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
  - [Tween](#tween)
  - [Timeline](#timeline)
  - [SpriteAnimation](#spriteanimation)
  - [Spine Animations](#spine-animations)
- [UI Components](#ui-components)
  - [Layout](#layout)
  - [ScrollContainer](#scrollcontainer)
  - [Button](#button)
  - [Label](#label)
  - [BalanceDisplay](#balancedisplay)
  - [WinDisplay](#windisplay)
  - [ProgressBar](#progressbar)
  - [Panel](#panel)
  - [Modal](#modal)
  - [Toast](#toast)
- [Input](#input)
- [Vite Configuration](#vite-configuration)
- [DevBridge](#devbridge)
- [Debug](#debug)
- [Flexbox-First Layout](#flexbox-first-layout)
- [Using with React (`@pixi/react`)](#using-with-react-pixireact)
- [API Reference](#api-reference)
- [License](#license)

---

## Quick Start

```bash
# Create a new project
mkdir my-game && cd my-game
npm init -y

# Install dependencies
npm install pixi.js @energy8platform/game-sdk @energy8platform/game-engine

# Install UI layout dependencies (optional — needed for Layout, Panel, ScrollContainer)
npm install @pixi/ui @pixi/layout yoga-layout

# (Optional) React integration
npm install @pixi/react react react-dom

# (Optional) install spine and audio support
npm install @pixi/sound @esotericsoftware/spine-pixi-v8
```

Create the entry point:

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
      backgroundGradient:
        'linear-gradient(135deg, #0a0a1a 0%, #1a1a3e 50%, #0a0a1a 100%)',
      showPercentage: true,
      tapToStart: true,
      tapToStartText: 'TAP TO PLAY',
      minDisplayTime: 2000,
    },
    manifest: {
      bundles: [
        { name: 'preload', assets: [] },
        {
          name: 'game',
          assets: [
            { alias: 'background', src: 'background.png' },
            { alias: 'symbols', src: 'symbols.json' },
          ],
        },
      ],
    },
    audio: {
      music: 0.5,
      sfx: 1.0,
      persist: true,
    },
    debug: true,
  });

  game.scenes.register('game', GameScene);

  game.on('initialized', () => console.log('Engine initialized'));
  game.on('loaded', () => console.log('Assets loaded'));
  game.on('started', () => console.log('Game started'));
  game.on('error', (err) => console.error('Error:', err));

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
| `@pixi/ui` | `^2.3.0` | Optional — for Button, ScrollContainer, ProgressBar |
| `@pixi/layout` | `^3.2.0` | Optional — for Layout, Panel (Yoga flexbox) |
| `yoga-layout` | `^3.0.0` | Optional — peer dep of `@pixi/layout` |
| `@pixi/sound` | `^6.0.0` | Optional — for audio |
| `@esotericsoftware/spine-pixi-v8` | `~4.2.0` | Optional — for Spine animations |
| `@pixi/react` | `^8.0.0` | Optional — for React integration (see [Using with React](#using-with-react-pixireact)) |

### Sub-path Exports

The package exposes granular entry points for tree-shaking:

```typescript
import { GameApplication } from '@energy8platform/game-engine';        // full bundle
import { Scene, SceneManager } from '@energy8platform/game-engine/core';
import { AssetManager } from '@energy8platform/game-engine/assets';
import { AudioManager } from '@energy8platform/game-engine/audio';
import { Button, Label, Modal, Layout, ScrollContainer, Panel, Toast } from '@energy8platform/game-engine/ui';
import { Tween, Timeline, Easing, SpriteAnimation } from '@energy8platform/game-engine/animation';
import { DevBridge, FPSOverlay } from '@energy8platform/game-engine/debug';
import { defineGameConfig } from '@energy8platform/game-engine/vite';
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

1. **CSS Preloader** — an instant HTML/CSS overlay shown while PixiJS initializes (inline SVG logo with a shimmer animation and "Loading..." text).
2. **PixiJS initialization** — creates `Application`, initializes `ResizeObserver`.
3. **SDK handshake** — connects to the casino host (or DevBridge in dev mode via shared `MemoryChannel`).
4. **Canvas Loading Screen** — `LoadingScene` displays the SVG logo with an animated progress bar, `preload` bundle is loaded first.
5. **Asset loading** — remaining bundles are loaded; the progress bar fills in real time.
6. **Tap-to-start** — optional screen shown after loading (required on mobile for audio unlock).
7. **First scene** — transitions to the registered first scene.

---

## Configuration

### `GameApplicationConfig`

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `container` | `HTMLElement \| string` | `document.body` | Container element or CSS selector |
| `designWidth` | `number` | `1920` | Reference design width |
| `designHeight` | `number` | `1080` | Reference design height |
| `scaleMode` | `ScaleMode` | `FIT` | Scaling strategy |
| `orientation` | `Orientation` | `ANY` | Preferred orientation |
| `loading` | `LoadingScreenConfig` | — | Loading screen options |
| `manifest` | `AssetManifest` | — | Asset manifest |
| `audio` | `AudioConfig` | — | Audio configuration |
| `sdk` | `object \| false` | — | SDK options; `false` to disable |
| `sdk.devMode` | `boolean` | `false` | Use in-memory channel instead of `postMessage` (no iframe needed) |
| `sdk.parentOrigin` | `string` | — | Expected parent origin for `postMessage` validation |
| `sdk.timeout` | `number` | — | SDK handshake timeout in ms |
| `sdk.debug` | `boolean` | — | Enable SDK debug logging |
| `pixi` | `Partial<ApplicationOptions>` | — | PixiJS pass-through options |
| `debug` | `boolean` | `false` | Enable FPS overlay |

### `LoadingScreenConfig`

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `backgroundColor` | `number \| string` | `0x0a0a1a` | Background color |
| `backgroundGradient` | `string` | — | CSS gradient for the preloader background |
| `logoAsset` | `string` | — | Logo texture alias from `preload` bundle |
| `logoScale` | `number` | `1` | Logo scale factor |
| `showPercentage` | `boolean` | `true` | Show loading percentage text |
| `progressTextFormatter` | `(progress: number) => string` | — | Custom progress text formatter |
| `tapToStart` | `boolean` | `true` | Show "Tap to start" overlay |
| `tapToStartText` | `string` | `'TAP TO START'` | Tap-to-start label |
| `minDisplayTime` | `number` | `1500` | Minimum display time (ms) |
| `cssPreloaderHTML` | `string` | — | Custom HTML for the CSS preloader |

### `AudioConfig`

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `music` | `number` | `0.7` | Default music volume (0–1) |
| `sfx` | `number` | `1` | Default SFX volume |
| `ui` | `number` | `0.8` | Default UI sounds volume |
| `ambient` | `number` | `0.5` | Default ambient volume |
| `persist` | `boolean` | `true` | Save mute state to localStorage |
| `storageKey` | `string` | `'ge_audio'` | localStorage key prefix |

### Enums

```typescript
enum ScaleMode {
  FIT = 'FIT',       // Letterbox/pillarbox — preserves aspect ratio
  FILL = 'FILL',     // Fill container, crop edges
  STRETCH = 'STRETCH' // Stretch to fill (distorts)
}

enum Orientation {
  LANDSCAPE = 'landscape',
  PORTRAIT = 'portrait',
  ANY = 'any'
}

enum TransitionType {
  NONE = 'none',
  FADE = 'fade',
  SLIDE_LEFT = 'slide-left',
  SLIDE_RIGHT = 'slide-right'
}
```

---

## Scenes

All game screens are scenes. Extend the base `Scene` class and override lifecycle hooks:

```typescript
import { Scene } from '@energy8platform/game-engine';
import { Sprite, Assets } from 'pixi.js';

export class GameScene extends Scene {
  async onEnter(data?: unknown) {
    const bg = new Sprite(Assets.get('background'));
    this.container.addChild(bg);
  }

  onUpdate(dt: number) {
    // Called every frame (dt = delta time from PixiJS ticker)
  }

  onResize(width: number, height: number) {
    // Called on viewport resize — use for responsive layout
  }

  async onExit() {
    // Cleanup before leaving the scene
  }

  onDestroy() {
    // Final cleanup when the scene is removed from the stack
  }
}
```

> **Tip:** After processing a play result, call `sdk.playAck(result)` to signal the host that animations are finished and the player can interact again.

### Scene Navigation

```typescript
const scenes = game.scenes;

// Register scenes
scenes.register('menu', MenuScene);
scenes.register('game', GameScene);
scenes.register('bonus', BonusScene);

// Navigate (replaces entire stack)
await scenes.goto('game');

// Push overlay/modal (previous scene stays rendered)
await scenes.push('bonus', { multiplier: 3 });

// Pop back
await scenes.pop();

// Replace top scene
await scenes.replace('game');
```

### Transitions

```typescript
import { TransitionType } from '@energy8platform/game-engine';

await scenes.goto('game', undefined, {
  type: TransitionType.FADE,
  duration: 500,    // ms
});

await scenes.push('bonus', { data: 42 }, {
  type: TransitionType.SLIDE_LEFT,
  duration: 300,
  easing: Easing.easeOutCubic,
});
```

---

## Lifecycle

`GameApplication` emits the following events:

| Event | Payload | When |
| --- | --- | --- |
| `initialized` | `void` | Engine initialized, PixiJS and SDK are ready |
| `loaded` | `void` | All asset bundles loaded |
| `started` | `void` | First scene entered, game loop running |
| `resize` | `{ width, height }` | Viewport resized |
| `orientationChange` | `Orientation` | Device orientation changed |
| `sceneChange` | `{ from, to }` | Scene transition completed |
| `balanceUpdate` | `{ balance }` | Player balance changed (forwarded from SDK) |
| `error` | `Error` | An error occurred |
| `destroyed` | `void` | Engine destroyed |

```typescript
game.on('resize', ({ width, height }) => {
  console.log(`New size: ${width}x${height}`);
});

game.once('started', () => {
  // Runs once after the first scene starts
});

game.on('balanceUpdate', ({ balance }) => {
  // SDK balance changed (after play action or host-pushed update)
  console.log(`New balance: ${balance}`);
});
```

---

## Assets

### Asset Manifest

Assets are organized in named **bundles**:

```typescript
const manifest: AssetManifest = {
  bundles: [
    {
      name: 'preload',
      assets: [
        { alias: 'logo', src: 'logo.png' },
      ],
    },
    {
      name: 'game',
      assets: [
        { alias: 'background', src: 'bg.webp' },
        { alias: 'symbols', src: 'symbols.json' },
        { alias: 'win-sound', src: 'sounds/win.mp3' },
      ],
    },
    {
      name: 'bonus',
      assets: [
        { alias: 'bonus-bg', src: 'bonus/bg.webp' },
      ],
    },
  ],
};
```

The `preload` bundle is loaded first (before the progress bar fills). All other bundles load together with a combined progress indicator.

### AssetManager API

```typescript
const assets = game.assets;

// Load on demand
await assets.loadBundle('bonus', (progress) => {
  console.log(`${Math.round(progress * 100)}%`);
});

// Synchronous cache access
const texture = assets.get<Texture>('background');

// Background preloading (low priority)
await assets.backgroundLoad('bonus');

// Unload to free memory
await assets.unloadBundle('bonus');

// Check state
assets.isBundleLoaded('game');  // true
assets.getBundleNames();         // ['preload', 'game', 'bonus']
```

---

## Audio

`AudioManager` wraps `@pixi/sound` with category-based volume management. If `@pixi/sound` is not installed, all methods work silently as no-ops.

### Audio Categories

Four categories with independent volume and mute controls: `music`, `sfx`, `ui`, `ambient`.

```typescript
const audio = game.audio;

// Play a sound effect
audio.play('click', 'ui');
audio.play('coin-drop', 'sfx', { volume: 0.8 });

// Music with crossfade (smooth volume transition between tracks)
audio.playMusic('main-theme', 1000); // 1s crossfade
audio.stopMusic();

// Volume control
audio.setVolume('music', 0.3);
audio.muteCategory('sfx');
audio.unmuteCategory('sfx');
audio.toggleCategory('sfx'); // returns new state

// Global mute
audio.muteAll();
audio.unmuteAll();
audio.toggleMute(); // returns new state

// Music ducking (e.g., during a big win animation)
audio.duckMusic(0.2);  // reduce to 20%
audio.unduckMusic();    // restore
```

### Mobile Audio Unlock

On iOS and many mobile browsers, audio cannot play until the first user interaction. The engine handles this automatically when `tapToStart: true` is set — the tap event serves as the audio context unlock.

---

## Viewport & Scaling

`ViewportManager` handles responsive scaling using `ResizeObserver` with debouncing.

### Scale Modes

| Mode | Behavior |
| --- | --- |
| `FIT` | Fits the entire design area inside the container. Adds letterbox (horizontal bars) or pillarbox (vertical bars) as needed. **Industry standard for iGaming.** |
| `FILL` | Fills the entire container, cropping edges. No bars, but some content may be hidden. |
| `STRETCH` | Stretches to fill the container. Distorts aspect ratio. Not recommended. |

```typescript
const vp = game.viewport;

// Current dimensions
console.log(vp.width, vp.height, vp.scale);
console.log(vp.orientation); // 'landscape' | 'portrait'

// Reference design size
console.log(vp.designWidth, vp.designHeight);

// Force re-calculation
vp.refresh();

// Listen for changes
game.on('resize', ({ width, height }) => {
  // Respond to viewport changes
});
```

---

## State Machine

`StateMachine` is a generic finite state machine with typed context, async hooks, guards, and per-frame updates.

```typescript
import { StateMachine } from '@energy8platform/game-engine';

interface GameContext {
  balance: number;
  bet: number;
  lastWin: number;
}

const fsm = new StateMachine<GameContext>({
  balance: 10000,
  bet: 100,
  lastWin: 0,
});

fsm.addState('idle', {
  enter: (ctx) => console.log('Waiting for player...'),
  update: (ctx, dt) => { /* per-frame logic */ },
});

fsm.addState('spinning', {
  enter: async (ctx) => {
    // Play spin animation
    await spinReels();
    // Auto-transition to result
    await fsm.transition('result');
  },
});

fsm.addState('result', {
  enter: async (ctx) => {
    if (ctx.lastWin > 0) {
      await showWinAnimation(ctx.lastWin);
    }
    await fsm.transition('idle');
  },
});

// Guards
fsm.addGuard('idle', 'spinning', (ctx) => ctx.balance >= ctx.bet);

// Events
fsm.on('transition', ({ from, to }) => {
  console.log(`${from} → ${to}`);
});

// Start
await fsm.start('idle');

// Trigger transitions
const success = await fsm.transition('spinning');
if (!success) {
  console.log('Transition blocked by guard');
}

// Per-frame update (usually called from Scene.onUpdate)
fsm.update(dt);
```

---

## Animation

### Tween

`Tween` provides a Promise-based animation system integrated with the PixiJS Ticker:

```typescript
import { Tween, Easing } from '@energy8platform/game-engine';

// Animate to target values
await Tween.to(sprite, { alpha: 0, y: 100 }, 500, Easing.easeOutCubic);

// Animate from starting values to current
await Tween.from(sprite, { scale: 0 }, 300, Easing.easeOutBack);

// Animate between two sets of values
await Tween.fromTo(sprite, { x: -100 }, { x: 500 }, 1000, Easing.easeInOutQuad);

// Wait (uses PixiJS Ticker for consistent timing)
await Tween.delay(1000);

// Cancel tweens
Tween.killTweensOf(sprite);
Tween.killAll();

// Full reset — kill all tweens and remove ticker listener
// Useful for cleanup between game instances, tests, or hot-reload
Tween.reset();

// Supports nested properties
await Tween.to(sprite, { 'scale.x': 2, 'position.y': 300 }, 500);
```

### Timeline

`Timeline` chains sequential and parallel animation steps:

```typescript
import { Timeline, Tween, Easing } from '@energy8platform/game-engine';

const tl = new Timeline();

tl.to(title, { alpha: 1, y: 0 }, 500, Easing.easeOutCubic)
  .delay(200)
  .parallel(
    () => Tween.to(btn1, { alpha: 1 }, 300),
    () => Tween.to(btn2, { alpha: 1 }, 300),
    () => Tween.to(btn3, { alpha: 1 }, 300),
  )
  .call(() => console.log('Intro complete!'));

await tl.play();
```

### Available Easings

All 24 easing functions:

| Linear | Quad | Cubic | Quart |
| --- | --- | --- | --- |
| `linear` | `easeInQuad` | `easeInCubic` | `easeInQuart` |
| | `easeOutQuad` | `easeOutCubic` | `easeOutQuart` |
| | `easeInOutQuad` | `easeInOutCubic` | `easeInOutQuart` |

| Sine | Expo | Back | Bounce / Elastic |
| --- | --- | --- | --- |
| `easeInSine` | `easeInExpo` | `easeInBack` | `easeOutBounce` |
| `easeOutSine` | `easeOutExpo` | `easeOutBack` | `easeInBounce` |
| `easeInOutSine` | `easeInOutExpo` | `easeInOutBack` | `easeInOutBounce` |
| | | | `easeOutElastic` |
| | | | `easeInElastic` |

### SpriteAnimation

Frame-based animation helper wrapping PixiJS `AnimatedSprite`. Cheaper than Spine for simple frame sequences — perfect for coin showers, symbol animations, sparkle trails, and win celebrations.

```typescript
import { SpriteAnimation } from '@energy8platform/game-engine';
import { Assets } from 'pixi.js';

// From an array of textures
const coinAnim = SpriteAnimation.create(coinTextures, {
  fps: 30,
  loop: true,
});
scene.container.addChild(coinAnim);

// From a spritesheet using a name prefix
const sheet = Assets.get('effects');
const sparkle = SpriteAnimation.fromSpritesheet(sheet, 'sparkle_', {
  fps: 24,
  loop: true,
});

// From a numbered range (e.g., 'explosion_00' to 'explosion_24')
const explosion = SpriteAnimation.fromRange(sheet, 'explosion_{i}', 0, 24, {
  fps: 60,
  loop: false,
  onComplete: () => explosion.destroy(),
});

// From pre-loaded texture aliases
const anim = SpriteAnimation.fromAliases(
  ['frame_0', 'frame_1', 'frame_2', 'frame_3'],
  { fps: 12 },
);

// Fire-and-forget: play once and auto-destroy
const { sprite, finished } = SpriteAnimation.playOnce(coinTextures, {
  fps: 30,
});
scene.container.addChild(sprite);
await finished; // resolves when animation completes
```

#### SpriteAnimationConfig

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `fps` | `number` | `24` | Frames per second |
| `loop` | `boolean` | `true` | Whether to loop |
| `autoPlay` | `boolean` | `true` | Start playing immediately |
| `onComplete` | `() => void` | — | Callback when animation completes (non-looping) |
| `anchor` | `number \| { x, y }` | `0.5` | Anchor point |

### Spine Animations

If `@esotericsoftware/spine-pixi-v8` is installed:

```typescript
import { SpineHelper } from '@energy8platform/game-engine';

// Create a Spine instance
const spine = await SpineHelper.create('character-skel', 'character-atlas', {
  scale: 0.5,
});
container.addChild(spine);

// Play animation (returns Promise that resolves on completion)
await SpineHelper.playAnimation(spine, 'idle', true); // loop

// Queue animation
SpineHelper.addAnimation(spine, 'walk', 0.2, true);

// Skins
SpineHelper.setSkin(spine, 'warrior');
console.log(SpineHelper.getSkinNames(spine));
console.log(SpineHelper.getAnimationNames(spine));
```

---

## UI Components

> UI components are built on top of [`@pixi/ui`](https://github.com/pixijs/ui) and [`@pixi/layout`](https://github.com/pixijs/layout) (Yoga flexbox). Install them as peer dependencies:
>
> ```bash
> npm install @pixi/ui @pixi/layout yoga-layout
> ```
>
> **Important:** These packages are optional peer dependencies. Import UI components from the `@energy8platform/game-engine/ui` sub-path to ensure tree-shaking works correctly. The root `@energy8platform/game-engine` barrel re-exports UI components but does **not** activate the `@pixi/layout` mixin — that only happens when importing from `/ui`.
>
> **Direct access:** The engine wraps only the most common UI components. For anything else from `@pixi/ui` (e.g. `Slider`, `CheckBox`, `Input`, `Select`, `RadioGroup`, `List`, `DoubleSlider`, `Switcher`) or `@pixi/layout` (e.g. `LayoutContainer`, `LayoutView`, `Trackpad`, layout-aware sprites), import directly from the source package:
>
> ```typescript
> // Engine-wrapped components
> import { Button, Panel, Layout, ScrollContainer } from '@energy8platform/game-engine/ui';
>
> // Raw @pixi/ui components (not wrapped by the engine)
> import { Slider, CheckBox, Input, Select, RadioGroup } from '@pixi/ui';
>
> // Raw @pixi/layout components
> import { LayoutContainer, LayoutView } from '@pixi/layout/components';
> import type { LayoutStyles } from '@pixi/layout';
> ```

### Layout

Responsive layout container powered by `@pixi/layout` (Yoga flexbox engine). Supports horizontal, vertical, grid, and wrap modes with alignment, padding, gap, anchor positioning, and viewport breakpoints.

```typescript
import { Layout } from '@energy8platform/game-engine';

// Horizontal toolbar anchored to bottom-center
const toolbar = new Layout({
  direction: 'horizontal',
  gap: 20,
  alignment: 'center',
  anchor: 'bottom-center',
  padding: 16,
  breakpoints: {
    768: { direction: 'vertical', gap: 10 },
  },
});

toolbar.addItem(spinButton);
toolbar.addItem(betLabel);
toolbar.addItem(balanceDisplay);
scene.container.addChild(toolbar);

// Update position on resize
toolbar.updateViewport(width, height);
```

```typescript
// Grid layout for a symbol paytable
const grid = new Layout({
  direction: 'grid',
  columns: 3,
  gap: 16,
  alignment: 'center',
  anchor: 'center',
  padding: [20, 40, 20, 40],
});

symbols.forEach((sym) => grid.addItem(sym));
grid.updateViewport(viewWidth, viewHeight);
```

```typescript
// Wrap layout — items flow and wrap to next line
const tags = new Layout({
  direction: 'wrap',
  gap: 8,
  maxWidth: 600,
});
```

#### LayoutConfig

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `direction` | `'horizontal' \| 'vertical' \| 'grid' \| 'wrap'` | `'vertical'` | Layout direction |
| `gap` | `number` | `0` | Gap between children (px) |
| `padding` | `number \| [top, right, bottom, left]` | `0` | Inner padding |
| `alignment` | `'start' \| 'center' \| 'end' \| 'stretch'` | `'start'` | Cross-axis alignment |
| `anchor` | `LayoutAnchor` | `'top-left'` | Position relative to viewport |
| `columns` | `number` | `2` | Column count (grid mode only) |
| `maxWidth` | `number` | `Infinity` | Max width before wrapping (wrap mode) |
| `autoLayout` | `boolean` | `true` | Auto-recalculate on add/remove |
| `breakpoints` | `Record<number, Partial<LayoutConfig>>` | — | Override config per viewport width |

**Anchor values:** `top-left`, `top-center`, `top-right`, `center-left`, `center`, `center-right`, `bottom-left`, `bottom-center`, `bottom-right`

> **Under the hood**: Layout maps `direction` → Yoga `flexDirection`/`flexWrap`, `alignment` → `alignItems`, and uses `@pixi/layout`'s `container.layout = { ... }` mixin. Grid mode uses `flexGrow`/`flexBasis` when `gap > 0` to correctly distribute space, and percentage widths when `gap === 0`.

### ScrollContainer

Scrollable container powered by `@pixi/ui` ScrollBox. Provides touch/drag scrolling, mouse wheel support, inertia, and dynamic rendering optimization for off-screen items.

```typescript
import { ScrollContainer } from '@energy8platform/game-engine';

const scroll = new ScrollContainer({
  width: 600,
  height: 400,
  direction: 'vertical',
  elementsMargin: 8,
  borderRadius: 12,
  backgroundColor: 0x1a1a2e,
});

// Add items directly
for (let i = 0; i < 50; i++) {
  scroll.addItem(createRow(i));
}

scene.container.addChild(scroll);
```

```typescript
// Or set content from a Container
const list = new Container();
items.forEach((item) => list.addChild(item));
scroll.setContent(list);

// Scroll to a specific item index
scroll.scrollToItem(5);

// Current position
const { x, y } = scroll.scrollPosition;
```

#### ScrollContainerConfig

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `width` | `number` | — | Visible viewport width |
| `height` | `number` | — | Visible viewport height |
| `direction` | `'vertical' \| 'horizontal' \| 'both'` | `'vertical'` | Scroll direction |
| `backgroundColor` | `ColorSource` | — | Background color (transparent if omitted) |
| `borderRadius` | `number` | `0` | Mask border radius |
| `elementsMargin` | `number` | `0` | Gap between items |
| `padding` | `number` | `0` | Content padding |
| `disableDynamicRendering` | `boolean` | `false` | Render all items even when off-screen |
| `disableEasing` | `boolean` | `false` | Disable scroll inertia/easing |
| `globalScroll` | `boolean` | `true` | Scroll even when mouse is not over the component |

> **Note:** ScrollContainer extends `@pixi/ui` `ScrollBox`. All `ScrollBox` methods and options are available.

### Button

Powered by `@pixi/ui` `FancyButton`. Supports both texture-based and Graphics-based rendering with per-state views, press animation, and built-in text.

```typescript
import { Button } from '@energy8platform/game-engine';

const spinBtn = new Button({
  width: 200,
  height: 60,
  borderRadius: 12,
  colors: {
    default: 0xffd700,
    hover: 0xffe44d,
    pressed: 0xccac00,
    disabled: 0x666666,
  },
  pressScale: 0.95,
  animationDuration: 100,
  text: 'SPIN',
});

// Connect press event (Signal-based)
spinBtn.onPress.connect(() => {
  console.log('Spin!');
});

// Or use texture-based states
const btn = new Button({
  textures: {
    default: 'btn-default',
    hover: 'btn-hover',
    pressed: 'btn-pressed',
    disabled: 'btn-disabled',
  },
});

btn.enable();
btn.disable();
```

> **Breaking change:** Button states renamed from `normal` to `default`. The `onTap` callback is replaced by `onPress.connect()` (typed-signals Signal).

### Label

```typescript
import { Label } from '@energy8platform/game-engine';

const label = new Label({
  text: 'TOTAL WIN',
  style: { fontSize: 36, fill: 0xffffff },
});
```

### BalanceDisplay

Displays player balance with formatting:

```typescript
import { BalanceDisplay } from '@energy8platform/game-engine';

const balance = new BalanceDisplay({
  currency: 'USD',
  animated: true,
  // ... text style options
});

balance.setValue(9500); // Animates the balance change
```

### WinDisplay

Animated win amount display with countup:

```typescript
import { WinDisplay } from '@energy8platform/game-engine';

const winDisplay = new WinDisplay({
  countupDuration: 2000,
  // ... text style options
});

await winDisplay.showWin(5000); // Show $50.00, countup over 2 seconds
winDisplay.hide();
```

### ProgressBar

Horizontal progress bar powered by `@pixi/ui` ProgressBar. Supports animated smooth fill.

```typescript
import { ProgressBar } from '@energy8platform/game-engine';

const bar = new ProgressBar({
  width: 400,
  height: 20,
  fillColor: 0x00ff00,
  trackColor: 0x333333,
  borderRadius: 10,
  animated: true,
});

bar.progress = 0.75; // 75%

// Call each frame for smooth animation
bar.update(dt);
```

### Panel

Background panel powered by `@pixi/layout` `LayoutContainer`. Supports both Graphics-based (color + border) and 9-slice sprite backgrounds. Children added to `content` participate in flexbox layout.

```typescript
import { Panel } from '@energy8platform/game-engine';

// Simple colored panel
const panel = new Panel({
  width: 600,
  height: 400,
  backgroundColor: 0x1a1a2e,
  borderRadius: 16,
  backgroundAlpha: 0.9,
  padding: 16,
});

panel.content.addChild(myText);

// 9-slice panel (texture-based)
const nineSlicePanel = new Panel({
  nineSliceTexture: 'panel-bg',
  nineSliceBorders: [20, 20, 20, 20],
  width: 400,
  height: 300,
});
```

### Modal

Full-screen overlay dialog:

```typescript
import { Modal } from '@energy8platform/game-engine';

const modal = new Modal({
  overlayAlpha: 0.7,
  overlayColor: 0x000000,
  closeOnOverlay: true,
  animationDuration: 300,
});

await modal.show(viewWidth, viewHeight);
await modal.hide();
```

### Toast

Brief notification messages with animated appearance/dismissal.

```typescript
import { Toast } from '@energy8platform/game-engine';

const toast = new Toast({
  duration: 2000,
  bottomOffset: 60,
});

// Show with type and viewport size
await toast.show('Free spins activated!', 'success', viewWidth, viewHeight);

// Dismiss manually
await toast.dismiss();
```

**Toast types:** `info`, `success`, `warning`, `error` — each with a distinct color.

---

### Using Raw `@pixi/ui` and `@pixi/layout` Components

The engine wraps the most common components, but both libraries offer much more. Here are examples of using raw components alongside the engine:

```typescript
import { Slider, CheckBox, Input, Select } from '@pixi/ui';
import { LayoutContainer } from '@pixi/layout/components';
import type { LayoutStyles } from '@pixi/layout';

// Slider (not wrapped by the engine)
const volumeSlider = new Slider({
  bg: bgSprite,
  fill: fillSprite,
  slider: handleSprite,
  min: 0,
  max: 100,
  value: 50,
});

// CheckBox
const muteCheck = new CheckBox({
  style: {
    unchecked: uncheckedView,
    checked: checkedView,
  },
});

// LayoutContainer with flexbox styles
const row = new LayoutContainer();
row.layout = {
  flexDirection: 'row',
  gap: 12,
  alignItems: 'center',
  padding: 16,
} satisfies LayoutStyles;
row.addChild(volumeSlider, muteCheck);
```

> **Tip:** Any container created after importing `@energy8platform/game-engine/ui` can use the `container.layout = { ... }` mixin — the `@pixi/layout` side-effect is automatically activated.

---

## Flexbox-First Layout

> **Best practice:** Use `@pixi/layout` flexbox instead of manual pixel positioning. Flexbox adapts to screen sizes, handles RTL, and eliminates fragile `x = width / 2 - 100` math.

### ❌ Avoid: Manual Pixel Positioning

```typescript
// Fragile — breaks when screen size, text length, or element sizes change
onResize(width: number, height: number) {
  this.title.x = width / 2;
  this.title.y = 80;
  this.balance.x = width / 2;
  this.balance.y = 220;
  this.spinButton.x = width / 2;
  this.spinButton.y = height - 120;
}
```

### ✅ Prefer: Flexbox Layout

```typescript
import { Layout } from '@energy8platform/game-engine/ui';
import { LayoutContainer } from '@pixi/layout/components';
import type { LayoutStyles } from '@pixi/layout';

// Root layout — fills the screen, stacks children vertically
const root = new LayoutContainer();
root.layout = {
  width: '100%',
  height: '100%',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: 40,
} satisfies LayoutStyles;

// Header area
const header = new LayoutContainer();
header.layout = {
  flexDirection: 'column',
  alignItems: 'center',
  gap: 12,
};
header.addChild(title, subtitle, balance);

// Center area — expands to fill available space
const center = new LayoutContainer();
center.layout = {
  flexGrow: 1,
  alignItems: 'center',
  justifyContent: 'center',
};
center.addChild(winDisplay);

// Footer toolbar
const footer = new Layout({
  direction: 'horizontal',
  gap: 20,
  alignment: 'center',
});
footer.addItem(betLabel);
footer.addItem(spinButton);

root.addChild(header, center, footer);
scene.container.addChild(root);
```

### When to Use Each Approach

| Approach | Use When |
|---|---|
| Engine `Layout` | Toolbar-style rows/columns with anchor positioning and breakpoints |
| `LayoutContainer` (raw) | Full flexbox control — `flexGrow`, `justifyContent`, percentage sizes |
| `container.layout = { ... }` (mixin) | Adding flex styles to any existing PixiJS container |
| Manual pixel positioning | Exact artistic placement (e.g. particle emitters, spine anchors) |

### Nested Flexbox Example

```typescript
// settings-panel.ts — responsive settings UI
import { LayoutContainer } from '@pixi/layout/components';
import { Slider, CheckBox } from '@pixi/ui';
import { Panel, Label } from '@energy8platform/game-engine/ui';

const panel = new Panel({
  width: 500,
  height: 400,
  backgroundColor: 0x1a1a2e,
  borderRadius: 16,
  padding: 24,
});

// Each row: label on left, control on right
function settingsRow(labelText: string, control: Container): LayoutContainer {
  const row = new LayoutContainer();
  row.layout = {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    height: 48,
  };
  row.addChild(new Label({ text: labelText }), control);
  return row;
}

panel.content.addChild(
  settingsRow('Music Volume', musicSlider),
  settingsRow('SFX Volume', sfxSlider),
  settingsRow('Mute', muteCheckbox),
);
```

---

## Using with React (`@pixi/react`)

For React-based projects, [`@pixi/react`](https://github.com/pixijs/pixi-react) provides declarative JSX components for PixiJS. The engine is framework-agnostic — `@pixi/react` is **not** a dependency, but works seamlessly alongside it.

### Installation

```bash
npm install @pixi/react react react-dom
```

### Wrapping the Engine in React

```tsx
import { Application, extend } from '@pixi/react';
import { Container, Graphics, Text } from 'pixi.js';
import { GameApplication, Scene } from '@energy8platform/game-engine';

// Register PixiJS components for JSX
extend({ Container, Graphics, Text });

function GameWrapper() {
  return (
    <Application
      width={1920}
      height={1080}
      background={0x0f0f23}
    >
      <GameContent />
    </Application>
  );
}
```

### Using Engine Components in JSX

Engine components (`Button`, `Panel`, `Layout`, etc.) are PixiJS `Container` subclasses — use them with `@pixi/react`'s `extend`:

```tsx
import { extend, useTick } from '@pixi/react';
import { Button, Label, Panel, ProgressBar } from '@energy8platform/game-engine/ui';

// Register engine components for JSX
extend({ Button, Label, Panel, ProgressBar });

function GameHUD({ balance, bet }: { balance: number; bet: number }) {
  return (
    <container>
      <panel
        width={400}
        height={80}
        backgroundColor={0x1a1a2e}
        borderRadius={12}
        padding={16}
      >
        <label text={`Balance: $${balance.toFixed(2)}`} />
        <label text={`Bet: $${bet.toFixed(2)}`} />
      </panel>
    </container>
  );
}
```

### Combining Flexbox with React

```tsx
import { extend } from '@pixi/react';
import { LayoutContainer } from '@pixi/layout/components';

extend({ LayoutContainer });

function FlexRow({ children }: { children: React.ReactNode }) {
  return (
    <layoutContainer
      layout={{
        flexDirection: 'row',
        gap: 16,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </layoutContainer>
  );
}

function Toolbar() {
  return (
    <FlexRow>
      <button text="SPIN" width={180} height={60} />
      <label text="BET: $1.00" />
    </FlexRow>
  );
}
```

> **Note:** `@pixi/react` is entirely optional. The engine works without React. Choose whichever approach fits your team and project.

---

## Input

`InputManager` provides unified touch/mouse/keyboard handling with gesture detection:

```typescript
const input = game.input;

// Tap/click
input.on('tap', ({ x, y }) => {
  console.log(`Tap at ${x}, ${y}`);
});

// Swipe gesture
input.on('swipe', ({ direction, velocity }) => {
  console.log(`Swipe ${direction} at ${velocity}px/s`);
  // direction: 'up' | 'down' | 'left' | 'right'
});

// Keyboard
input.on('keydown', ({ key, code }) => {
  if (code === 'Space') startSpin();
});

// Check current key state
if (input.isKeyDown('ArrowLeft')) {
  // Move left
}

// Lock input during animations
input.lock();
// ... animation plays ...
input.unlock();

// Convert DOM canvas position to game-world coordinates
// (accounts for viewport scaling and offset)
const worldPos = input.getWorldPosition(canvasX, canvasY);
console.log(worldPos.x, worldPos.y);
```

**Events:** `tap`, `press`, `release`, `move`, `swipe`, `keydown`, `keyup`

> **Note:** The viewport transform for coordinate mapping is wired up automatically by `GameApplication`. Call `getWorldPosition()` when you need to convert raw DOM coordinates to game-world space.

---

## Vite Configuration

The engine provides a pre-configured Vite setup via `defineGameConfig`:

```typescript
// vite.config.ts
import { defineGameConfig } from '@energy8platform/game-engine/vite';

export default defineGameConfig({
  base: '/games/my-slot/',
  devBridge: true, // Auto-inject DevBridge in dev mode
  devBridgeConfig: './dev.config', // Custom config path (optional)
  vite: {
    // Additional Vite config overrides
  },
});
```

### `GameConfig`

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `base` | `string` | `'/'` | Vite `base` path for deployment |
| `devBridge` | `boolean` | `false` | Auto-inject DevBridge in dev mode |
| `devBridgeConfig` | `string` | `'./dev.config'` | Path to DevBridge config file |
| `vite` | `UserConfig` | — | Additional Vite config to merge |

### What `defineGameConfig` Provides

- **Build target: ESNext** — required for `yoga-layout` WASM (uses top-level `await`)
- **Asset inlining** — files under 8KB are auto-inlined
- **PixiJS chunk splitting** — `pixi.js` is extracted into a separate chunk for caching
- **DevBridge injection** — automatically available in dev mode via virtual module
- **Dev server** — port 3000, auto-open browser
- **Dependency deduplication** — `resolve.dedupe` ensures a single copy of `pixi.js`, `@pixi/layout`, `@pixi/ui`, and `yoga-layout` across all packages (prevents registration issues when used as a linked dependency)
- **Dependency optimization** — `pixi.js`, `@pixi/layout`, `@pixi/layout/components`, `@pixi/ui`, and `yoga-layout/load` are pre-bundled for faster dev starts; `yoga-layout` main entry is excluded from pre-bundling because it contains a top-level `await` incompatible with esbuild's default target

### Custom DevBridge Configuration

Create `dev.config.ts` at the project root:

```typescript
// dev.config.ts
import type { DevBridgeConfig } from '@energy8platform/game-engine/debug';

export default {
  balance: 50000,
  currency: 'EUR',
  networkDelay: 100,
  onPlay: ({ action, bet }) => {
    // Custom play result logic
    const win = Math.random() < 0.3 ? bet * 10 : 0;
    return { win, balance: 50000 - bet + win };
  },
} satisfies DevBridgeConfig;
```

This file is auto-imported by the Vite plugin when `devBridge: true`. The plugin injects a virtual module (`/@dev-bridge-entry.js`) that starts DevBridge **before** importing your app entry point, ensuring the `MemoryChannel` is ready when the SDK calls `ready()`.

---

## DevBridge

`DevBridge` simulates a casino host for local development. It uses the SDK's `Bridge` class in `devMode`, communicating with `CasinoGameSDK` through a shared in-memory `MemoryChannel` — no `postMessage` or iframe required.

> **Requires `@energy8platform/game-sdk` >= 2.7.0**

```typescript
import { DevBridge } from '@energy8platform/game-engine/debug';

const bridge = new DevBridge({
  balance: 10000,
  currency: 'USD',
  assetsUrl: '/assets/',
  networkDelay: 200,
  debug: true,
  gameConfig: {
    id: 'my-slot',
    type: 'slot',
    viewport: { width: 1920, height: 1080 },
    betLevels: [0.1, 0.2, 0.5, 1, 2, 5, 10],
  },
  onPlay: ({ action, bet, roundId }) => {
    // Return custom play result
    const win = Math.random() < 0.4 ? bet * 5 : 0;
    return { win };
  },
});

bridge.start(); // Creates SDK Bridge({ devMode: true }) + registers handlers

// Update balance programmatically
bridge.setBalance(5000);

// Cleanup
bridge.destroy();
```

When using the Vite plugin with `devBridge: true`, the SDK is automatically configured with `devMode: true` so both sides use the same `MemoryChannel`.

### Handled Messages

| Message | Description |
| --- | --- |
| `GAME_READY` | SDK initialization handshake |
| `PLAY_REQUEST` | Player action (spin, deal, etc.) |
| `PLAY_RESULT_ACK` | Acknowledge play result |
| `GET_BALANCE` | Balance query |
| `GET_STATE` | Game state query |
| `OPEN_DEPOSIT` | Deposit dialog request |

---

## Debug

### FPS Overlay

```typescript
import { FPSOverlay } from '@energy8platform/game-engine/debug';

const fps = new FPSOverlay(game.app);
fps.show();
fps.toggle();
fps.hide();
```

When `debug: true` is set in `GameApplicationConfig`, the FPS overlay is created and shown automatically — no manual setup needed.

The overlay displays:
- Average FPS
- Minimum FPS
- Frame time (ms)

Updated every ~500ms, sampled over 60 frames.

---

## API Reference

### GameApplication

```typescript
class GameApplication extends EventEmitter<GameEngineEvents> {
  // Fields
  app: Application;
  scenes: SceneManager;
  assets: AssetManager;
  audio: AudioManager;
  input: InputManager;
  viewport: ViewportManager;
  sdk: CasinoGameSDK | null;
  initData: InitData | null;
  readonly config: GameApplicationConfig;

  // Getters
  get gameConfig(): GameConfigData | null;
  get session(): SessionData | null;
  get balance(): number;
  get currency(): string;
  get isRunning(): boolean;

  // Methods
  constructor(config?: GameApplicationConfig);
  async start(firstScene: string, sceneData?: unknown): Promise<void>;
  destroy(): void;
}
```

### SceneManager

```typescript
class SceneManager extends EventEmitter<{ change: { from: string | null; to: string } }> {
  get current(): SceneEntry | null;
  get currentKey(): string | null;
  get isTransitioning(): boolean;

  setRoot(root: Container): void;
  register(key: string, ctor: SceneConstructor): this;
  async goto(key: string, data?: unknown, transition?: TransitionConfig): Promise<void>;
  async push(key: string, data?: unknown, transition?: TransitionConfig): Promise<void>;
  async pop(transition?: TransitionConfig): Promise<void>;
  async replace(key: string, data?: unknown, transition?: TransitionConfig): Promise<void>;
  update(dt: number): void;
  resize(width: number, height: number): void;
  destroy(): void;
}
```

### AssetManager

```typescript
class AssetManager {
  get initialized(): boolean;
  get basePath(): string;
  get loadedBundles(): ReadonlySet<string>;

  constructor(basePath?: string, manifest?: AssetManifest);
  async init(): Promise<void>;
  async loadBundle(name: string, onProgress?: (p: number) => void): Promise<Record<string, unknown>>;
  async loadBundles(names: string[], onProgress?: (p: number) => void): Promise<Record<string, unknown>>;
  async load<T>(urls: string | string[], onProgress?: (p: number) => void): Promise<T>;
  get<T>(alias: string): T;
  async unloadBundle(name: string): Promise<void>;
  async backgroundLoad(name: string): Promise<void>;
  getBundleNames(): string[];
  isBundleLoaded(name: string): boolean;
}
```

### AudioManager

```typescript
class AudioManager {
  get initialized(): boolean;
  get muted(): boolean;

  constructor(config?: AudioConfig);
  async init(): Promise<void>;
  play(alias: string, category?: AudioCategoryName, options?: { volume?: number; loop?: boolean; speed?: number }): void;
  playMusic(alias: string, fadeDuration?: number): void;
  stopMusic(): void;
  stopAll(): void;
  setVolume(category: AudioCategoryName, volume: number): void;
  getVolume(category: AudioCategoryName): number;
  muteCategory(category: AudioCategoryName): void;
  unmuteCategory(category: AudioCategoryName): void;
  toggleCategory(category: AudioCategoryName): boolean;
  muteAll(): void;
  unmuteAll(): void;
  toggleMute(): boolean;
  duckMusic(factor: number): void;
  unduckMusic(): void;
  destroy(): void;
}
```

### ViewportManager

```typescript
class ViewportManager extends EventEmitter<ViewportEvents> {
  get width(): number;
  get height(): number;
  get scale(): number;
  get orientation(): Orientation;
  get designWidth(): number;
  get designHeight(): number;

  constructor(app: Application, container: HTMLElement, config: ViewportConfig);
  refresh(): void;
  destroy(): void;
}
```

### StateMachine

```typescript
class StateMachine<TContext> extends EventEmitter<StateMachineEvents> {
  get current(): string | null;
  get isTransitioning(): boolean;
  get context(): TContext;

  constructor(context: TContext);
  addState(name: string, config: { enter?, exit?, update? }): this;
  addGuard(from: string, to: string, guard: (ctx: TContext) => boolean): this;
  async start(initialState: string, data?: unknown): Promise<void>;
  async transition(to: string, data?: unknown): Promise<boolean>;
  update(dt: number): void;
  hasState(name: string): boolean;
  canTransition(to: string): boolean;
  async reset(): Promise<void>;
  async destroy(): Promise<void>;
}
```

### Tween

```typescript
class Tween {
  static get activeTweens(): number;

  static to(target: any, props: Record<string, number>, duration: number, easing?: EasingFunction, onUpdate?: (p: number) => void): Promise<void>;
  static from(target: any, props: Record<string, number>, duration: number, easing?, onUpdate?): Promise<void>;
  static fromTo(target: any, fromProps: Record<string, number>, toProps: Record<string, number>, duration: number, easing?, onUpdate?): Promise<void>;
  static delay(ms: number): Promise<void>;  // Uses PixiJS Ticker
  static killTweensOf(target: any): void;
  static killAll(): void;
  static reset(): void;  // Kill all + remove ticker listener
}
```

### Timeline

```typescript
class Timeline {
  get isPlaying(): boolean;

  to(target: any, props: Record<string, number>, duration: number, easing?: EasingFunction): this;
  from(target: any, props: Record<string, number>, duration: number, easing?: EasingFunction): this;
  delay(ms: number): this;
  call(fn: () => void | Promise<void>): this;
  parallel(...fns: Array<() => Promise<void>>): this;
  async play(): Promise<void>;
  cancel(): void;
  clear(): this;
}
```

### InputManager

```typescript
class InputManager extends EventEmitter<InputEvents> {
  get locked(): boolean;

  constructor(canvas: HTMLCanvasElement);
  lock(): void;
  unlock(): void;
  isKeyDown(key: string): boolean;
  setViewportTransform(scale: number, offsetX: number, offsetY: number): void;
  getWorldPosition(canvasX: number, canvasY: number): { x: number; y: number };
  destroy(): void;
}
```

### Layout

> Powered by `@pixi/layout` (Yoga flexbox). Uses the `@pixi/layout` mixin on a standard `Container`.

```typescript
class Layout extends Container {
  get items(): readonly Container[];

  constructor(config?: LayoutConfig);
  addItem(child: Container): this;
  removeItem(child: Container): this;
  clearItems(): this;
  updateViewport(width: number, height: number): void;
}
```

### ScrollContainer

> Extends `@pixi/ui` ScrollBox — inherits touch/drag scrolling, mouse wheel, inertia, and dynamic rendering.

```typescript
class ScrollContainer extends ScrollBox {
  get scrollPosition(): { x: number; y: number };

  constructor(config: ScrollContainerConfig);
  setContent(content: Container): void;
  addItem(...items: Container[]): Container;
  scrollToItem(index: number): void;
}
```

### Button

> Extends `@pixi/ui` FancyButton — per-state views, press animation, and text.

```typescript
class Button extends FancyButton {
  get disabled(): boolean;

  constructor(config?: ButtonConfig);
  enable(): void;
  disable(): void;

  // Inherited from FancyButton
  onPress: Signal;   // btn.onPress.connect(() => { … })
  enabled: boolean;
}
```

### Panel

> Extends `@pixi/layout/components` LayoutContainer — flex-layout background panel with optional 9-slice texture.

```typescript
class Panel extends LayoutContainer {
  get content(): Container;  // children added here participate in flexbox layout

  constructor(config?: PanelConfig);
  setSize(width: number, height: number): void;
}
```

### ProgressBar

> Wraps `@pixi/ui` ProgressBar — optional smooth animated fill via per-frame `update()`.

```typescript
class ProgressBar extends Container {
  get progress(): number;
  set progress(value: number);    // 0..1

  constructor(config?: ProgressBarConfig);
  update(dt: number): void;       // call each frame when animated: true
}
```

### Toast

> Lightweight toast using `Graphics` for the background. Supports info / success / warning / error types.

```typescript
class Toast extends Container {
  constructor(config?: ToastConfig);
  async show(message: string, type?: ToastType, viewWidth?: number, viewHeight?: number): Promise<void>;
  async dismiss(): Promise<void>;
}
```

### SpriteAnimation

```typescript
class SpriteAnimation {
  static create(textures: Texture[], config?: SpriteAnimationConfig): AnimatedSprite;
  static fromSpritesheet(sheet: Spritesheet, prefix: string, config?: SpriteAnimationConfig): AnimatedSprite;
  static fromRange(sheet: Spritesheet, pattern: string, start: number, end: number, config?: SpriteAnimationConfig): AnimatedSprite;
  static fromAliases(aliases: string[], config?: SpriteAnimationConfig): AnimatedSprite;
  static playOnce(textures: Texture[], config?: SpriteAnimationConfig): { sprite: AnimatedSprite; finished: Promise<void> };
  static getTexturesByPrefix(sheet: Spritesheet, prefix: string): Texture[];
}
```

### EventEmitter

```typescript
class EventEmitter<TEvents extends {}> {
  on<K>(event: K, handler: (data: TEvents[K]) => void): this;
  once<K>(event: K, handler: (data: TEvents[K]) => void): this;
  off<K>(event: K, handler: (data: TEvents[K]) => void): this;
  // Void events can be emitted without a data argument
  emit<K>(event: K, ...args): void;
  removeAllListeners(event?: keyof TEvents): this;
}
```

---

## License

MIT
