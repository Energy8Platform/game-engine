// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createGameShell, removeGameShell } from '@energy8platform/platform-core/shell';
import type { ShellConfig, BonusOption, GameShell } from '@energy8platform/platform-core/shell';
import { createSlotPlay } from '@/host/slotPlay';
import { runRound } from '@/host/runRound';
import type { RenderContext, SlotSceneController } from '@/host/sceneController';

/**
 * End-to-end wiring proof for ANTE + BUY BONUS, WITHOUT booting Pixi.
 *
 * Drives a REAL GameShell (its buy-bonus overlay + confirm DOM) and replicates the EXACT base-mode
 * `playRound` wiring from createSlotGame against the real runRound + createSlotPlay, over a stub
 * scene that only implements `onSpin`. Asserts the chain reaches play({ action, bet }).
 *
 * createSlotGame() itself can't be unit-tested (GameApplication.init() drives Pixi, which hangs
 * headless); this pins the wiring + the host loop it contains.
 */

interface SpinResult { totalWin: number; roundId?: string; nextActions?: string[]; complete?: boolean }

/** Stub scene = the generated GameScene contract: onSpin only (host owns the loop). */
function makeScene(): SlotSceneController<SpinResult> {
  return { async onSpin() {} };
}

/** The verbatim base-mode wiring from createSlotGame.ts (playRound + handlers). */
function wireBaseMode(
  shell: GameShell,
  slotPlay: { play: (a: string, b: number, r?: string) => Promise<SpinResult>; ack: () => void },
  gameScene: () => SlotSceneController<SpinResult> | undefined,
  getBet: () => number,
) {
  let activeFeature: string | null = null;
  const ctx = (action: string): RenderContext => ({
    bet: getBet(), action, mode: 'BASE', formatAmount: String, get turbo() { return 0; },
  });
  const playRound = async (action: string) => {
    const scene = gameScene();
    if (!scene) return;
    await runRound<SpinResult>(
      { play: slotPlay.play, ack: slotPlay.ack, scene, context: ctx, roleOf: () => 'base' },
      action,
    );
  };
  shell.on('featureActivate', ({ id }) => { activeFeature = id; });
  shell.on('featureDeactivate', () => { activeFeature = null; });
  shell.on('spin', () => { void playRound(activeFeature ?? 'spin'); });
  shell.on('buyBonusSelect', ({ id }) => { void playRound(id); });
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
    play: (p) => { plays.push({ action: p.action, bet: p.bet }); return Promise.resolve({ totalWin: 0, complete: true }); },
    normalize: () => ({ totalWin: 0 }),
  });
  const scene = makeScene();
  const shell = createGameShell(cfg(options));
  wireBaseMode(shell, slotPlay, () => scene, () => 1);
  return { shell, plays };
}

const card = (id: string) => document.querySelector(`[data-ge="bonus-card-${id}"]`) as HTMLElement;
const confirmBuy = () => document.querySelector('[data-ge="bonus-confirm-buy"]') as HTMLElement;

describe('createSlotGame shell → host loop wiring (ANTE + BUY BONUS)', () => {
  beforeEach(async () => { await removeGameShell(); document.body.innerHTML = ''; });

  it('bar BUY BONUS button opens the overlay (button → openBuyBonus link)', () => {
    harness([BUY]);
    const barBtn = document.querySelector('[data-ge="buybonus"]') as HTMLElement;
    expect(barBtn).toBeTruthy();
    barBtn.click();
    expect(document.querySelector('[data-ge="buybonus-overlay"]')).toBeTruthy();
  });

  it('BUY BONUS card → confirm → play({ action: "buy_bonus", bet })', async () => {
    const { shell, plays } = harness([BUY]);
    shell.openBuyBonus();
    card('buy_bonus').click();
    confirmBuy().click();
    await Promise.resolve(); await Promise.resolve();
    expect(plays).toEqual([{ action: 'buy_bonus', bet: 1 }]);
  });

  it('ANTE card → Activate → featureActivate, then SPIN routes to play({ action: "ante", bet })', async () => {
    const { shell, plays } = harness([ANTE]);
    shell.openBuyBonus();
    card('ante').click();
    confirmBuy().click();
    await Promise.resolve();
    expect(plays).toEqual([]);
    shell.emit('spin');
    await Promise.resolve(); await Promise.resolve();
    expect(plays).toEqual([{ action: 'ante', bet: 1 }]);
  });

  it('without an active feature, SPIN routes to play({ action: "spin", bet })', async () => {
    const { shell, plays } = harness([BUY]);
    shell.emit('spin');
    await Promise.resolve(); await Promise.resolve();
    expect(plays).toEqual([{ action: 'spin', bet: 1 }]);
  });

  it('deactivating the ante reverts SPIN back to the base action', async () => {
    const { shell, plays } = harness([ANTE]);
    shell.openBuyBonus();
    card('ante').click();
    confirmBuy().click();
    shell.deactivateFeature();
    shell.emit('spin');
    await Promise.resolve(); await Promise.resolve();
    expect(plays).toEqual([{ action: 'spin', bet: 1 }]);
  });
});
