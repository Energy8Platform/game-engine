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
    expect(c.loading).toBe(loading);
    expect(c.audio).toBe(audio);
    expect(c.pixi).toBe(pixi);
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
