// packages/game-engine/tests/host/buildConfig.test.ts
import { describe, it, expect } from 'vitest';
import { buildAppConfig } from '../../src/host/buildConfig';
import { ScaleMode, Orientation } from '../../src/types';
import type { CreateSlotGameOptions } from '../../src/host/types';
import type { GameModel } from '@energy8platform/platform-core/game-spec';

const minimal = (over: Partial<CreateSlotGameOptions> = {}): CreateSlotGameOptions => ({
  model: {} as GameModel,
  scene: { key: 'game', scene: class {} as never },
  manifest: { bundles: [] },
  ...over,
});

describe('buildAppConfig', () => {
  it('applies defaults (container, design, scale, orientation)', () => {
    const c = buildAppConfig(minimal(), false);
    expect(c.container).toBe('#game');
    expect(c.designWidth).toBe(1920);
    expect(c.designHeight).toBe(1080);
    expect(c.scaleMode).toBe(ScaleMode.FILL);
    expect(c.orientation).toBe(Orientation.ANY);
  });
  it('passes through manifest/loading/audio/pixi/design overrides', () => {
    const loading = { backgroundColor: 0x010203 };
    const audio = { music: 0.5 };
    const pixi = { antialias: true };
    const c = buildAppConfig(
      minimal({ design: { width: 1080, height: 1920 }, loading, audio, pixi }),
      false,
    );
    expect(c.designWidth).toBe(1080);
    expect(c.designHeight).toBe(1920);
    expect(c.loading).toMatchObject(loading);
    expect(c.audio).toBe(audio);
    expect(c.pixi).toBe(pixi);
  });
  /**
   * `loading` is MERGED with the host's defaults, not replaced by the game's object.
   *
   * Replacing was the bug: the engine's own default for `tapToStart` is `true` (for direct
   * GameApplication users), the host's is `false`, so a game that set any single loading option
   * silently re-armed tap-to-start. The Artube target made it visible — a game supplying only
   * `externalOverlay` inside its Artube branch waited for a tap there and nowhere else, from one
   * source line. This is exactly the kind of thing that regresses silently, hence the suite.
   */
  describe('loading defaults survive a partial override', () => {
    const loadingOf = (loading?: CreateSlotGameOptions['loading']) =>
      buildAppConfig(minimal({ loading }), false).loading!;

    it('defaults to no tap gate and a 600ms minimum when the game says nothing', () => {
      expect(loadingOf()).toEqual({ tapToStart: false, minDisplayTime: 600 });
    });

    it('keeps tapToStart:false when the game overrides only minDisplayTime', () => {
      expect(loadingOf({ minDisplayTime: 900 })).toEqual({
        tapToStart: false,
        minDisplayTime: 900,
      });
    });

    it('keeps tapToStart:false when the game supplies only an external overlay', () => {
      // The scaffolded Artube branch, verbatim: `{ loading: { externalOverlay: artubeLoader } }`.
      const overlay = { showLoader() {}, updateProgress() {}, hideLoader() {} };
      const c = loadingOf({ externalOverlay: overlay });
      expect(c.tapToStart).toBe(false);
      expect(c.minDisplayTime).toBe(600);
      expect(c.externalOverlay).toBe(overlay);
    });

    it('still lets a game ask for a tap explicitly', () => {
      expect(loadingOf({ tapToStart: true }).tapToStart).toBe(true);
    });

    it('does not mutate the game’s own object', () => {
      const loading = { minDisplayTime: 900 };
      buildAppConfig(minimal({ loading }), false);
      expect(loading).toEqual({ minDisplayTime: 900 });
    });
  });
  it('computes sdk.devMode across all isStakeNow/dev combinations', () => {
    const dm = (isStakeNow: boolean, dev?: boolean) =>
      (buildAppConfig(minimal({ dev }), isStakeNow).sdk as { devMode: boolean }).devMode;
    expect(dm(false, false)).toBe(false);
    expect(dm(false, undefined)).toBe(false);
    expect(dm(true, false)).toBe(true);
    expect(dm(false, true)).toBe(true);
  });
  it('an Artube launch also forces sdk.devMode (the bridge is in-process)', () => {
    const dm = (isArtubeNow: boolean, dev?: boolean) =>
      (buildAppConfig(minimal({ dev }), false, isArtubeNow).sdk as { devMode: boolean }).devMode;
    expect(dm(true, false)).toBe(true);
    expect(dm(true, undefined)).toBe(true);
    expect(dm(false, false)).toBe(false); // omitted → unchanged from the pre-Artube behaviour
  });
});
