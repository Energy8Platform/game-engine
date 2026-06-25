# Spec B — Host composition + scene lifecycle

**Date:** 2026-06-25
**Status:** Approved (brainstorm), pending implementation plan
**Packages:** `@energy8platform/game-engine` (host, core, audio, slot), `@energy8platform/pixi-shell`

## Goal

One architectural pass over the slot host that:

1. Wires the shell's sound settings to a real `AudioManager` (today they are dead UI). — *idea #3*
2. Swaps the host from the DOM shell to **pixi-shell**, making the stage a single layered Pixi canvas. — *idea #4*
3. Replaces the thin scene contract with a richer, slot-aware **lifecycle**, and gives the scene first-class capabilities: audio playback, a host-owned **overlay** layer, and **safe-area** access to the shell bounds. — *idea #5*

These are one spec because they all converge on the host: pixi-shell makes layering (scene → shell → overlay) a Pixi z-order concern, and the `AudioManager` the host must own to wire `settingChange` is the same handle the scene needs for sfx/bgm.

## Current state

- The scene contract is the duck-typed `SlotSceneController<T>` ([`packages/game-engine/src/host/sceneController.ts`](../../../packages/game-engine/src/host/sceneController.ts)): `present(result, ctx)` + optional `onBonusEnter/onBonusExit`, on top of the generic `Scene` hooks (`onEnter/onExit/onUpdate/onResize/onDestroy`).
- The host ([`packages/game-engine/src/host/createSlotGame.ts:133,193`](../../../packages/game-engine/src/host/createSlotGame.ts)) creates the **DOM** shell via `createGameShell`. `createPixiShell` exists with feature parity but is unused by the host.
- The host never creates an `AudioManager` and never listens to `settingChange`; the shell's sound toggle + master/music/sfx sliders move nothing. The wiring exists only in the pixi-shell **demo**, not the host.
- The only host-level overlays are DOM fatal-error / reconnect modals. BigWin is per-scene ([`packages/game-engine/src/slot/overlay/BigWinOverlay.ts`](../../../packages/game-engine/src/slot/overlay/BigWinOverlay.ts)).
- No pause/resume on tab focus; no skip; no bet/turbo/autoplay notifications to the scene.

## Design

### 1. Scene contract — clean rename, no back-compat

Stays a duck-typed interface (`SlotSceneController`); the scene still extends the generic `Scene` for its container and `onEnter/onResize/onDestroy`. Renames are a hard break — no deprecated aliases:

- `present` → `onSpin`
- `onBonusEnter` / `onBonusExit` → `onEnterMode` / `onExitMode`

All slot scenes in the repo **and** the create-slot template are rewritten to the new names.

### 2. Lifecycle hooks

A "round" = one player action drained fully (including the free-spins loop). All hooks except `onSpin` are optional.

| Hook | Timing | Purpose |
|---|---|---|
| `onCreate(api)` | once, before first enter | receive capabilities, one-time setup, subscriptions (audio is already initialised by the host) |
| `onEnter(data?)` / `onExit()` / `onDestroy()` | per activation / removal | unchanged from `Scene` |
| `onSpinStart()` | once per round, **before** the network result | start reels / anticipation immediately; host locks controls |
| `onSpin(result, ctx)` | **per segment**, after the result | render (required) |
| `onEnterMode(result, ctx)` / `onExitMode(result, ctx)` | on `ctx.mode` diff between segments (`BASE` is the resting mode; entering it at round start does not fire) | mode / bonus entry & exit |
| `onSpinEnd(result, ctx)` | once per round, after full drain | controls unlocked, settle to idle |
| `onBetChanged(bet)` | shell event (incl. idle) | react to stake |
| `onTurboChanged(level)` | shell event | react to turbo (0..3) |
| `onAutoplayChanged({ running, remaining })` | autoplay start/stop/count | react to autoplay |
| `onSkip()` | double-tap on the game area during an active `onSpin`, gated by the `skipGesture` setting | collapse current animation to final state |
| `onPause()` / `onResume()` | `visibilitychange` | pause/resume scene-owned timers outside the ticker |
| `onUpdate(dt)` | every frame of the active scene | idle ambient animation (existing `Scene` hook) |
| `onResize(w, h)` | resize; **full canvas** | relayout |

`onSpinStart`/`onSpinEnd` bracket the whole round and fire **once** each — free-spin segments inside do not re-fire them. Each auto-round (and each manual round) gets its own bracket.

### 3. `SceneApi` (delivered once via `onCreate`)

```ts
interface SceneApi {
  audio: {
    play(alias: string, opts?: { volume?: number; loop?: boolean; speed?: number }): void;
    playMusic(alias: string, fadeMs?: number): void;
    stopMusic(): void;
    duck(factor: number): void;
    unduck(): void;
    // NOTE: no volume / mute control — that belongs to the shell settings → host.
  };
  overlay: {
    show(opts: {
      build: (container: Container, size: { width: number; height: number }) => void;
      autoCloseMs?: number;          // auto-close after N ms
      closeOn?: 'tap' | false;       // default 'tap'; single tap dismisses
      dim?: number;                  // optional host-drawn backdrop alpha; default none
    }): Promise<void>;               // resolves when closed
    close(): void;                   // manual close (when closeOn:false and no autoClose)
  };
  shell: {
    readonly safeArea: { top: number; right: number; bottom: number; left: number }; // live getter; bottom = bar height
  };
  formatAmount(value: number): string;
  readonly bet: number;
  readonly mode: string;
  readonly turbo: number;
}
```

- `audio` exposes **playback only**. Volume/mute is driven by the shell's `settingChange` → host wiring, never by the game.
- `overlay` is a single-instance, host-owned layer above the scene and the shell. It installs a full-screen pointer-eating hit area so the shell's controls are unreachable while open. `build` draws the content; the game owns its own visuals (host only optionally draws a `dim` backdrop). Concurrent `show()` while one is open: queue or reject (decide in plan; default reject + warn).
- `shell.safeArea` is a live getter the scene reads inside `onResize` (the `bottom` inset changes with the shell's wide/mobile layout and is not derivable from canvas size).
- Live `bet`/`mode`/`turbo` getters exist for hooks that receive no `ctx` (`onPause`, `onBetChanged`, idle `onUpdate`).

### 4. `ctx` (per-segment, passed to `onSpin`/`onEnterMode`/`onExitMode`/`onSpinEnd`)

```ts
interface RenderContext {
  bet: number;             // stable for the round
  action: string;          // trigger action ('spin', 'buy_bonus', ...)
  mode: string;            // Stake bet-mode ('BASE', 'FREE_SPINS', ...)
  readonly turbo: number;  // live getter, 0..3
  signal: AbortSignal;     // aborted on skip — scene's async pacing can race/cancel on it
}
```

### 5. Stage composition (pixi-shell in host)

Committed: the host uses `createPixiShell`, not `createGameShell`. The stage is one layered canvas:

```
app.stage
 ├─ sceneRoot      (SceneManager root) — bottom, full canvas
 ├─ shellContainer (pixi-shell)        — middle, transparent background, "absolute" (bar does not push scene layout)
 └─ overlayLayer   (host overlay)      — top, eats pointer events above the shell
```

**Safe-area model:** `onResize(w, h)` gives the scene the **full canvas**. The scene reads `api.shell.safeArea` to know the bar height and decides itself what to inset/avoid. The shell renders transparent and absolute; the scene draws full-screen behind it. The host does not auto-inset the scene root — the safe area is informational.

### 6. Audio

The host **owns** the `AudioManager`:

- Creates it and calls `init()` during host boot (before the first `onSpin`), exposes it as `api.audio` (playback subset). The scene never inits audio.
- Listens to shell `settingChange` and applies to the manager: `sound` → global mute toggle, `music`/`sfx` → category volume, `master` → a new global gain multiplier (the manager has no master today; add one).
- Audio assets load through the existing asset **manifest** (bundles may contain sounds); `api.audio.play(alias)` references loaded aliases.
- **BGM switching is scene-driven**: the scene calls `api.audio.playMusic(...)` in `onEnterMode`/`onExitMode`/`onSpinStart`. No host-side mode→track map.

### 7. Pause/resume (full auto-pause)

On `visibilitychange → hidden` the host automatically:

- stops the Pixi ticker (freezes tweens, `onUpdate`, and any in-flight `onSpin` animation — it resumes on focus return),
- pauses/mutes music (restored on resume),
- does **not** start the next auto-round (the current round finishes; the next is held until resume),
- calls `scene.onPause()` / `scene.onResume()` for scene-owned timers/particles outside the ticker.

### 8. Skip gesture

- The host captures **double-tap** on the game area (below the shell bar) during an active `onSpin`.
- It is gated by a `skipGesture` setting (default **on**). A toggle is added to the **pixi-shell** Settings modal, emitting `settingChange { key: 'skipGesture', value }`; the host stores the flag and gates the handler. (DOM-shell parity optional, since the host uses pixi-shell.)
- On a valid skip: abort `ctx.signal` and call `scene.onSkip()`. The scene is responsible for collapsing its current animation to the final state; the host keeps controls locked until `onSpin` resolves.

## Out of scope (follow-ups)

- Migrating the engine's `BigWinOverlay` from scene-level onto `api.overlay`. Kept scene-level for now; `api.overlay` ships as a new generic facility. Migration is a separate, later change.
- DOM-shell parity for the `skipGesture` toggle (host uses pixi-shell).

## Risks / open implementation questions (resolve in the plan)

- **Concurrent overlay** policy: queue vs reject. Default: reject + warn.
- **Ticker-freeze vs in-flight network**: a round awaiting the network when the tab hides — the network promise still resolves, but the animation that follows is frozen until resume. Confirm this is acceptable (it matches "pause the animation").
- **Host boot vs async `audio.init()`**: the host's `init()` dynamically imports `@pixi/sound`; ensure boot awaits it before the first `onSpin`, and that any `api.audio.play` before readiness is a safe no-op (the manager already degrades to no-op without `@pixi/sound`).
- **pixi-shell transparency/bounds**: verify pixi-shell exposes its bar height/layout and renders no opaque full-screen background; add a `safeArea`/bounds getter if missing.

## Testing

- Scene-contract type test: a scene implementing the new interface compiles; `present`/`onBonusEnter`/`onBonusExit` no longer exist.
- Host play-loop tests: `onSpinStart` fires once before the first segment; `onSpin` per segment; `onEnterMode`/`onExitMode` fire on `mode` diff (not on `BASE` at round start); `onSpinEnd` once after drain.
- Shell-event relay: `onBetChanged`/`onTurboChanged`/`onAutoplayChanged({running,remaining})` fire from the corresponding shell events.
- Audio wiring: `settingChange` for sound/master/music/sfx calls the matching `AudioManager` methods; `play` before `init` is a safe no-op.
- Overlay: `show()` resolves on tap, on `autoCloseMs`, and on `close()`; pointer events do not reach the shell while open.
- Pause: hidden stops the ticker, pauses music, holds the next auto-round, fires `onPause`; visible reverses it.
- Skip: double-tap during `onSpin` with `skipGesture` on aborts `ctx.signal` and calls `onSkip`; with it off, does nothing.
- Composition: `onResize` passes full canvas; `api.shell.safeArea.bottom` reflects the bar height across wide/mobile.
