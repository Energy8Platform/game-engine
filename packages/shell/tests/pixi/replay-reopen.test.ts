import './setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { Application, Ticker } from 'pixi.js';
import { Container } from 'pixi.js';
import { createPixiShell, removePixiShell, type PixiShellConfig } from '@/ui/pixi/index';

// Regression: after START REPLAY runs a round and the modal reopens itself, the controller must
// still track the open overlay. The reopen used to bypass the controller (renderer-direct push),
// leaving `overlay` null — so the NEXT START REPLAY's close (routed through the controller's
// guarded closeOverlay) no-op'd and the button appeared dead. hasOpenLayer() must stay true.

function makeStubApp(): Application {
  const ticker = { add() {}, remove() {} } as unknown as Ticker;
  const stage = new Container();
  const pixiRenderer = { on() {}, off() {}, render() {}, width: 1200, height: 675 };
  return {
    ticker, stage, renderer: pixiRenderer, canvas: undefined,
    screen: { width: 1200, height: 675 },
  } as unknown as Application;
}

function makeConfig(over: Partial<PixiShellConfig> = {}): PixiShellConfig {
  return {
    app: makeStubApp(),
    language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [0.5, 1, 2, 5],
    defaultBet: 1,
    currentBet: null,
    balance: 100,
    win: 0,
    mode: 'replay',
    gameInfo: {},
    features: { turbo: 0, autoplay: false, buyBonus: false },
    ...over,
  } as PixiShellConfig;
}

function hasPointerTap(node: Container): boolean {
  const listens = (node as unknown as { listenerCount?: (e: string) => number }).listenerCount;
  return typeof listens === 'function' && listens.call(node, 'pointertap') > 0;
}

/** Concatenate the text of every Text descendant (labels live on child Text nodes). */
function subtreeText(node: Container): string {
  const own = (node as unknown as { text?: unknown }).text;
  let acc = typeof own === 'string' ? own : '';
  for (const child of node.children as Container[]) acc += ' ' + subtreeText(child);
  return acc;
}

/** The modal's START REPLAY button: a `pointertap`-wired node whose label reads "…replay…".
 *  (Bar controls are also tappable, so match on the label rather than "first tappable".) */
function findReplayButton(node: Container): Container | null {
  if (hasPointerTap(node) && /replay/i.test(subtreeText(node))) return node;
  for (const child of node.children as Container[]) {
    const hit = findReplayButton(child);
    if (hit) return hit;
  }
  return null;
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

afterEach(() => removePixiShell());

describe('Pixi replay modal — reopen keeps the overlay tracked', () => {
  it('a second START REPLAY still works after the first round reopens the modal', async () => {
    const app = makeStubApp();
    const shell = createPixiShell(makeConfig({ app }));
    const onReplay = vi.fn(() => Promise.resolve());

    shell.openReplay({ bonusId: 'BASE', bet: 1, payoutMultiplier: 0.3, onReplay });
    expect((shell as unknown as { overlay: unknown }).overlay !== null).toBe(true);

    // Tap START REPLAY: closes the modal, runs onReplay, then reopens.
    const btn1 = findReplayButton(app.stage);
    expect(btn1).not.toBeNull();
    btn1!.emit('pointertap', {} as never);
    await flush();

    expect(onReplay).toHaveBeenCalledTimes(1);
    // The reopened modal must be tracked by the controller — else the next close no-ops.
    expect((shell as unknown as { overlay: unknown }).overlay !== null).toBe(true);

    // The reopened button must be live: a second tap fires onReplay again.
    const btn2 = findReplayButton(app.stage);
    expect(btn2).not.toBeNull();
    btn2!.emit('pointertap', {} as never);
    await flush();
    expect(onReplay).toHaveBeenCalledTimes(2);
    expect((shell as unknown as { overlay: unknown }).overlay !== null).toBe(true);
  });
});
