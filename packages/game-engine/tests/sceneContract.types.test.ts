import { describe, it, expect } from 'vitest';
import type { SlotSceneController, SceneApi } from '@/host/sceneController';
import type { CascadeStepData, ReelSystem } from '@/slot';
import type { SlotSpinResultBase } from '@energy8platform/platform-core/slot-result';

describe('scene contract shape', () => {
  it('a scene implementing the required core lifecycle hooks compiles', () => {
    const scene: SlotSceneController<SlotSpinResultBase> = {
      onCreate(_api) { /* grab capabilities */ },
      onSpinStart() {},
      async onSpin(result, ctx) { void result; void ctx.bet; void ctx.signal; },
      async onEnterMode(_r, _ctx) {},
      async onExitMode(_r, _ctx) {},
      onSpinEnd(_r, _ctx) {},
    };
    expect(typeof scene.onSpin).toBe('function');
    expect(typeof scene.onCreate).toBe('function');
    expect(typeof scene.onSpinEnd).toBe('function');
  });
  it('SceneApi exposes playback-only audio (no setVolume)', () => {
    // @ts-expect-error setVolume must NOT exist on the scene's audio handle
    const bad: SceneApi['audio']['setVolume'] = undefined;
    void bad;
  });
  it('a cascade scene reports its per-step win through the generic onStep (scaffold shape)', () => {
    // Mirrors what `npm create @energy8platform/slot` generates for a cascade game: the game's own
    // step type carries the step's win, and `onStep` hands that type back (not the bare TumbleStep).
    type CascadeStep = CascadeStepData & { win: number };
    const present = async (api: SceneApi, system: ReelSystem, steps: CascadeStep[]) => {
      let paid = 0;
      await system.cascade(steps, {
        turbo: api.turbo > 0,
        onStep: (_i, step) => {
          paid += step.win; // typed as CascadeStep, so `win` resolves
          api.shell.reportWin(paid, { durationMs: 220 });
        },
      });
    };
    expect(typeof present).toBe('function');
  });
  it('SceneApi.shell has no other shell controls (the host owns bet/balance/mode)', () => {
    // @ts-expect-error the scene must not be able to set the balance readout
    const bad: SceneApi['shell']['setBalance'] = undefined;
    void bad;
  });
});
