// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createGameShell, removeGameShell } from '@/shell';
import type { ShellConfig, ReplayModalOptions } from '@/shell/types';

function cfg(mount: HTMLElement): ShellConfig {
  return {
    mount, gameInfo: {}, language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [1, 2, 5], defaultBet: 2, currentBet: null,
    balance: 1000, win: 0, mode: 'replay',
    features: {
      turbo: 0, autoplay: false,
      buyBonus: [{ id: 'fs', title: 'Buy Free Spins', description: '10 free spins', priceMultiplier: 100 }],
    },
  };
}
const q = (m: HTMLElement, s: string) => m.querySelector(s) as HTMLElement | null;
const tick = () => new Promise((r) => setTimeout(r));

describe('Replay modal', () => {
  let mount: HTMLElement;
  beforeEach(async () => {
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
    await removeGameShell();
  });

  const open = (mount: HTMLElement, over: Partial<ReplayModalOptions> = {}) => {
    const shell = createGameShell(cfg(mount));
    const onReplay = vi.fn();
    shell.openReplay({ bonusId: 'fs', bet: 2, payoutMultiplier: 10, onReplay, ...over });
    return { shell, onReplay };
  };

  it('shows the summary derived from the bonus, bet and payout multiplier', () => {
    open(mount);
    const modal = q(mount, '[data-ge="replay-modal"]')!;
    expect(modal).toBeTruthy();
    const t = modal.textContent!;
    expect(t).toContain('Buy Free Spins'); // MODE ← bonus title
    expect(t).toContain('100×');           // COST MULTIPLIER ← priceMultiplier
    expect(t).toContain('€200');           // TOTAL COST = bet × costMultiplier
    expect(t).toContain('10×');            // PAYOUT MULTIPLIER
    expect(t).toContain('€20');            // TOTAL WIN = payoutMultiplier × bet
  });

  it('is not dismissable — no ✕ and no backdrop close', () => {
    open(mount);
    expect(q(mount, '[data-ge="modal-close"]')).toBeNull();
    // clicking the backdrop (the .ge-sheet root) leaves the modal in place
    (q(mount, '[data-ge="replay-modal"]') as HTMLElement).click();
    expect(q(mount, '[data-ge="replay-modal"]')).toBeTruthy();
  });

  it('falls back to the bonusId and ×1 cost when the bonus is unknown', () => {
    open(mount, { bonusId: 'mystery' });
    const t = q(mount, '[data-ge="replay-modal"]')!.textContent!;
    expect(t).toContain('mystery'); // MODE ← bonusId
    expect(t).toContain('1×');      // COST MULTIPLIER fallback
  });

  it('START REPLAY closes the modal, runs onReplay, then reopens', async () => {
    const { onReplay } = open(mount);
    q(mount, '[data-ge="replay-start"]')!.click();
    expect(onReplay).toHaveBeenCalledOnce();
    expect(q(mount, '[data-ge="replay-modal"]')).toBeNull(); // closed immediately
    await tick();
    expect(q(mount, '[data-ge="replay-modal"]')).toBeTruthy(); // reopened
  });

  it('reopens even when onReplay rejects, so the user is never stranded', async () => {
    let reject!: (e: unknown) => void;
    const onReplay = vi.fn(() => new Promise<void>((_, r) => { reject = r; }));
    const shell = createGameShell(cfg(mount));
    shell.openReplay({ bonusId: 'fs', bet: 2, payoutMultiplier: 10, onReplay });
    q(mount, '[data-ge="replay-start"]')!.click();
    await tick();
    expect(q(mount, '[data-ge="replay-modal"]')).toBeNull(); // closed while replaying
    reject(new Error('play failed'));
    await tick();
    expect(q(mount, '[data-ge="replay-modal"]')).toBeTruthy(); // reopened despite the failure
  });

  it('reopens only after an async onReplay resolves', async () => {
    let release!: () => void;
    const onReplay = vi.fn(() => new Promise<void>((r) => { release = r; }));
    const shell = createGameShell(cfg(mount));
    shell.openReplay({ bonusId: 'fs', bet: 2, payoutMultiplier: 10, onReplay });
    q(mount, '[data-ge="replay-start"]')!.click();
    await tick();
    expect(q(mount, '[data-ge="replay-modal"]')).toBeNull(); // still closed while replaying
    release();
    await tick();
    expect(q(mount, '[data-ge="replay-modal"]')).toBeTruthy(); // reopened after resolve
  });
});
