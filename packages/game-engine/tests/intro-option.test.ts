// packages/game-engine/tests/intro-option.test.ts
// The host no longer resolves an "intro option": every scene is registered up
// front and the host injects `goto` into each scene's start data. These tests
// cover the two pieces that replaced resolveIntro: (1) the built-in IntroScene
// navigating via the injected `goto`, and (2) the duck-typed controller binding
// rule the host uses to pick the current scene to bind play/bet to.
import { describe, it, expect } from 'vitest';
import { IntroScene } from '@/scenes/IntroScene';
import type { SlotSceneController } from '@/host/sceneController';

/** Find the full-screen tap target the IntroScene installs. */
function tap(scene: IntroScene): void {
  // The scene adds a single Graphics hit area as the last child of its layer.
  const layer = scene.container.children[0] as { children: any[] };
  const hit = layer.children[layer.children.length - 1];
  hit.emit('pointerdown');
}

describe('built-in IntroScene navigation', () => {
  it('calls the injected goto(next ?? "game") on tap', async () => {
    const scene = new IntroScene();
    let target: string | null = null;
    await scene.onEnter({ goto: (k: string) => { target = k; } });
    tap(scene);
    expect(target).toBe('game');
  });

  it('honours an explicit next key', async () => {
    const scene = new IntroScene();
    let target: string | null = null;
    await scene.onEnter({ next: 'lobby', goto: (k: string) => { target = k; } });
    tap(scene);
    expect(target).toBe('lobby');
  });

  it('prefers an explicit onStart over goto', async () => {
    const scene = new IntroScene();
    let started = false;
    let gotoCalled = false;
    await scene.onEnter({ onStart: () => { started = true; }, goto: () => { gotoCalled = true; } });
    tap(scene);
    expect(started).toBe(true);
    expect(gotoCalled).toBe(false);
  });
});

/** Mirrors the host's gameScene() resolver: the current scene IFF it implements present(). */
function isController(scene: unknown): scene is Partial<SlotSceneController> {
  return typeof (scene as Partial<SlotSceneController> | undefined)?.present === 'function';
}

describe('controller duck-type (host binding rule)', () => {
  it('recognizes a scene that implements present', () => {
    const controller = { present: async () => {} };
    expect(isController(controller)).toBe(true);
  });

  it('rejects a scene without present (e.g. an intro scene)', () => {
    expect(isController({})).toBe(false);
    expect(isController(undefined)).toBe(false);
    // a scene from the OLD contract (bindHost only, no present) is no longer a controller
    expect(isController({ bindHost() {} })).toBe(false);
  });
});
