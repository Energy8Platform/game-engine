import type { GameShell } from '../GameShell';
import type { ReplayModalOptions } from '../types';
import { formatCurrency } from '../format';
import { createCardModal } from './primitives';

/** The replay summary modal — built on the shared card chrome, but NOT dismissable: no ✕,
 *  and the backdrop never closes it. The only way out is START REPLAY, which closes the
 *  modal, runs `onReplay`, then reopens it (whether the handler resolves OR rejects, so a
 *  failed replay can't strand the user). */
export function buildReplayModal(shell: GameShell, opts: ReplayModalOptions): HTMLElement {
  const { bonusId, bet, payoutMultiplier } = opts;
  const fmt = (n: number) => formatCurrency(n, shell.config.currency);
  const fmtWin = (n: number) => formatCurrency(n, shell.config.currency, true); // total win: variable decimals
  const bonus = Array.isArray(shell.config.features.buyBonus)
    ? shell.config.features.buyBonus.find((b) => b.id === bonusId)
    : undefined;
  const mode = bonus?.title ?? bonusId;
  const costMultiplier = bonus?.priceMultiplier ?? 1;

  const ui = createCardModal({
    ge: 'replay-modal',
    title: shell.t('Replay'),
    closable: false, // no ✕; the backdrop never dismisses it either
    onClose: () => {}, // unused — there is no close affordance
  });

  const rows = document.createElement('div'); rows.className = 'ge-replay-rows';
  const row = (label: string, value: string, total = false): void => {
    const r = document.createElement('div'); r.className = `ge-replay-row${total ? ' ge-replay-total' : ''}`;
    const l = document.createElement('span'); l.textContent = shell.t(label);
    const v = document.createElement('b'); v.textContent = value;
    r.append(l, v); rows.appendChild(r);
  };
  row('Mode', mode);
  row('Base bet', fmt(bet));
  row('Cost multiplier', `${costMultiplier}×`);
  row('Total cost bet', fmt(bet * costMultiplier));
  row('Payout multiplier', `${payoutMultiplier}×`);
  row('Total win', fmtWin(payoutMultiplier * bet), true);
  ui.body.appendChild(rows);

  const actions = document.createElement('div'); actions.className = 'ge-modal-actions';
  const btn = document.createElement('button');
  btn.className = 'ge-modal-btn ge-modal-btn--accent'; btn.dataset.ge = 'replay-start';
  btn.textContent = shell.t('Start replay');
  btn.addEventListener('click', () => {
    ui.root.remove(); // close immediately
    // Reopen after the handler settles. On rejection we still reopen — this modal is the only
    // way out of replay mode, so a failed play must not strand the user on an empty screen.
    const reopen = (): void => { shell.openReplay(opts); };
    Promise.resolve(opts.onReplay()).then(reopen, reopen);
  });
  actions.appendChild(btn);
  ui.card.appendChild(actions);

  return ui.root;
}
