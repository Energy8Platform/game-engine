// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createGameShell, removeGameShell } from '@energy8platform/platform-core/shell';
import type { ShellConfig, BonusOption, GameShell } from '@energy8platform/platform-core/shell';
import { createSlotPlay } from '@/host/slotPlay';
import type { SlotSceneController, SlotHostApi } from '@/host/sceneController';

/**
 * End-to-end wiring proof for ANTE + BUY BONUS, WITHOUT booting Pixi.
 *
 * Drives a REAL GameShell (its buy-bonus overlay + confirm DOM) and replicates the EXACT
 * base-mode handler block from createSlotGame against a stub scene that implements the real
 * SlotSceneController contract over the real createSlotPlay. Asserts the chain reaches
 * platformSession.play({ action: 'ante' | 'buy_bonus' | 'spin', bet }).
 *
 * createSlotGame() itself can't be unit-tested (GameApplication.init() drives Pixi, which hangs
 * headless); this pins the wiring it contains. The live click→spin is a manual `npm run dev`
 * check — this proves every link between the shell event and play({action,bet}) is connected.
 */

interface SpinResult { totalWin: number; freeSpins?: { awarded?: number } }

/** Stub scene = the generated GameScene contract over the real host play pipeline. */
function makeScene(): SlotSceneController<SpinResult> {
  let host: SlotHostApi<SpinResult> | undefined;
  return {
    bindHost(api) { host = api; },
    setBet() {},
    async spin(bet) { await host!.play('spin', bet); },
    async buyBonus(actionId, bet) { await host!.play(actionId, bet); },
  };
}

/** The verbatim base-mode wiring from createSlotGame.ts (the block under `if (mode === 'base')`). */
function wireBaseMode(shell: GameShell, gameScene: () => SlotSceneController<SpinResult> | undefined, getBet: () => number) {
  let activeFeature: string | null = null;
  shell.on('featureActivate', ({ id }) => { activeFeature = id; });
  shell.on('featureDeactivate', () => { activeFeature = null; });
  shell.on('spin', () => {
    const s = gameScene();
    if (activeFeature) void s?.buyBonus?.(activeFeature, getBet());
    else void s?.spin?.(getBet());
  });
  shell.on('buyBonusSelect', ({ id }) => { void gameScene()?.buyBonus?.(id, getBet()); });
}

const cfg = (buyBonus: BonusOption[]): ShellConfig => ({
  mount: document.body,
  gameInfo: { sections: [] },
  language: 'en',
  currency: { symbol: '€', position: 'left' },
  availableBets: [1],
  defaultBet: 1,
  currentBet: 1,
  balance: 100000,
  win: 0,
  mode: 'base',
  features: { turbo: 0, buyBonus },
});

const ANTE: BonusOption = { id: 'ante', type: 'feature', title: 'ANTE BET', description: 'boost', priceMultiplier: 1.5 };
const BUY: BonusOption = { id: 'buy_bonus', type: 'bonus', title: 'BUY BONUS', description: 'buy', priceMultiplier: 100 };

/** Stand up shell + scene + the real createSlotPlay, recording every play({action,bet}). */
function harness(options: BonusOption[]) {
  const plays: Array<{ action: string; bet: number }> = [];
  const slotPlay = createSlotPlay<SpinResult>({
    play: (p) => { plays.push(p); return Promise.resolve({ data: { total_win: 0 } }); },
    normalize: () => ({ totalWin: 0 }),
  });
  const scene = makeScene();
  scene.bindHost!({ play: slotPlay });
  const shell = createGameShell(cfg(options));
  wireBaseMode(shell, () => scene, () => 1);
  return { shell, plays };
}

const card = (id: string) => document.querySelector(`[data-ge="bonus-card-${id}"]`) as HTMLElement;
const confirmBuy = () => document.querySelector('[data-ge="bonus-confirm-buy"]') as HTMLElement;

describe('createSlotGame shell → scene wiring (ANTE + BUY BONUS)', () => {
  beforeEach(async () => { await removeGameShell(); document.body.innerHTML = ''; });

  it('bar BUY BONUS button opens the overlay (button → openBuyBonus link)', () => {
    harness([BUY]);
    const barBtn = document.querySelector('[data-ge="buybonus"]') as HTMLElement;
    expect(barBtn).toBeTruthy();        // button renders when the model has buy/feature actions
    barBtn.click();
    expect(document.querySelector('[data-ge="buybonus-overlay"]')).toBeTruthy();
  });

  it('BUY BONUS card → confirm → play({ action: "buy_bonus", bet })', async () => {
    const { shell, plays } = harness([BUY]);
    shell.openBuyBonus();
    card('buy_bonus').click(); // opens confirm
    confirmBuy().click();      // emits buyBonusSelect → scene.buyBonus → host.play
    await Promise.resolve();
    expect(plays).toEqual([{ action: 'buy_bonus', bet: 1 }]);
  });

  it('ANTE card → Activate → featureActivate, then SPIN routes to play({ action: "ante", bet })', async () => {
    const { shell, plays } = harness([ANTE]);
    shell.openBuyBonus();
    card('ante').click();
    confirmBuy().click();  // feature → activateFeature → emits featureActivate (no play yet)
    await Promise.resolve();
    expect(plays).toEqual([]);           // activating the ante does NOT spend a spin
    shell.emit('spin');                   // the SPIN disc would emit this
    await Promise.resolve();
    expect(plays).toEqual([{ action: 'ante', bet: 1 }]); // routed to the ante action, not 'spin'
  });

  it('without an active feature, SPIN routes to play({ action: "spin", bet })', async () => {
    const { shell, plays } = harness([BUY]);
    shell.emit('spin');
    await Promise.resolve();
    expect(plays).toEqual([{ action: 'spin', bet: 1 }]);
  });

  it('deactivating the ante reverts SPIN back to the base action', async () => {
    const { shell, plays } = harness([ANTE]);
    shell.openBuyBonus();
    card('ante').click();
    confirmBuy().click();
    shell.deactivateFeature(); // BUY BONUS button becomes DISABLE → emits featureDeactivate
    shell.emit('spin');
    await Promise.resolve();
    expect(plays).toEqual([{ action: 'spin', bet: 1 }]);
  });
});
