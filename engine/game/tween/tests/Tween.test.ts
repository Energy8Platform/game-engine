// New for @energy8engine/tween — drives pixi's Ticker.shared the way
// engine/game/reel-core/tests/tumbleController.test.ts does.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { Ticker } from 'pixi.js';
import { Tween } from '../src/Tween';

/** Same ticker-pinning trick as tests/tumbleController.test.ts — see there for why it's needed. */
const keepTickerAlive = (): void => {};
const clock = { t: 0 };
beforeAll(() => {
  (globalThis as any).requestAnimationFrame ??= () => 0;
  (globalThis as any).cancelAnimationFrame ??= () => {};
  Ticker.shared.add(keepTickerAlive);
  Ticker.shared.update(clock.t);
});
afterAll(() => {
  Ticker.shared.remove(keepTickerAlive);
});
afterEach(() => {
  Tween.reset();
});

/** Advance the shared ticker by exactly `ms`, yielding after each frame so queued awaits run. */
async function tick(ms: number, stepMs = 16): Promise<void> {
  let elapsed = 0;
  while (elapsed < ms) {
    const d = Math.min(stepMs, ms - elapsed);
    clock.t += d;
    elapsed += d;
    Ticker.shared.update(clock.t);
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

describe('Tween', () => {
  it('Tween.to animates the property to the target and resolves', async () => {
    const obj = { x: 0 };
    let resolved = false;
    const done = Tween.to(obj, { x: 10 }, 100).then(() => {
      resolved = true;
    });
    await tick(120);
    expect(obj.x).toBe(10);
    expect(resolved).toBe(true);
    await done;
  });

  it('Tween.fromTo starts near the "from" value and ends at the "to" value', async () => {
    const obj = { x: 999 };
    const done = Tween.fromTo(obj, { x: 0 }, { x: 5 }, 50);
    // fromTo sets the "from" props synchronously, before the ticker has run a single frame.
    expect(obj.x).toBeCloseTo(0, 0);
    await tick(60);
    expect(obj.x).toBe(5);
    await done;
  });

  it('Tween.killTweensOf resolves the pending promise and stops the target from changing', async () => {
    const obj = { x: 0 };
    let resolved = false;
    const done = Tween.to(obj, { x: 10 }, 200).then(() => {
      resolved = true;
    });
    await tick(80); // mid-tween — nowhere near 200ms
    expect(Tween.activeTweens).toBe(1);

    Tween.killTweensOf(obj);
    await done; // resolves even though the tween never reached raw >= 1
    expect(resolved).toBe(true);
    expect(Tween.activeTweens).toBe(0);

    const stoppedAt = obj.x;
    await tick(80); // further ticks must not touch it — the tween is gone
    expect(obj.x).toBe(stoppedAt);
  });

  it('Tween.delay resolves only once the requested ticker time has elapsed', async () => {
    let resolved = false;
    const done = Tween.delay(60).then(() => {
      resolved = true;
    });
    await tick(40);
    expect(resolved).toBe(false);
    await tick(30);
    expect(resolved).toBe(true);
    await done;
  });

  it('activeTweens counts concurrent tweens and drops back to 0 once they end', async () => {
    expect(Tween.activeTweens).toBe(0);
    const a = { x: 0 };
    const b = { x: 0 };
    const doneA = Tween.to(a, { x: 1 }, 50);
    const doneB = Tween.to(b, { x: 1 }, 50);
    expect(Tween.activeTweens).toBe(2);
    await tick(60);
    await Promise.all([doneA, doneB]);
    expect(Tween.activeTweens).toBe(0);
  });
});
