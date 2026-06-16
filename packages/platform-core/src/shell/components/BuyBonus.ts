import type { GameShell } from '../GameShell';
import type { BonusOption } from '../types';
import { formatCurrency } from '../format';
import { stepBet } from '../state';
import { effectiveAccent, contrastText } from '../colors';
import { createOverlay, createCardModal } from './primitives';
import { icon, type IconName } from './icons';

/** Buy-bonus overlay — a grid of art-forward cards, one per option. */
export function openBuyBonusOverlay(shell: GameShell): HTMLElement | null {
  const bonuses = shell.config.features.buyBonus;
  if (bonuses === false || bonuses.length === 0) return null;

  const { root, body } = createOverlay({ title: shell.t('Buy bonus'), onClose: () => root.remove() });
  root.dataset.ge = 'buybonus-overlay';
  // Re-render the grid whenever the bet changes so every card's price stays live.
  const renderGrid = () => {
    body.innerHTML = '';
    const grid = document.createElement('div'); grid.className = 'ge-bb-grid';
    for (const bonus of bonuses) grid.appendChild(buildCard(shell, bonus, root));
    body.appendChild(grid);
  };
  renderGrid();
  root.appendChild(buildBetBar(shell, renderGrid)); // thin bottom footer, only as tall as the pill
  return root;
}

/** Bet control — a compact −/+ pill around the live stake, in a thin footer at the screen bottom.
 *  Stepping repaints the value, re-prices the cards, and updates the control bar. */
function buildBetBar(shell: GameShell, onChange: () => void): HTMLElement {
  const bar = document.createElement('div'); bar.className = 'ge-bb-betbar';
  const pill = document.createElement('div'); pill.className = 'ge-bb-betpill';
  const val = document.createElement('div'); val.className = 'ge-bb-betval';
  const down = stepButton('bb-bet-down', 'minus');
  const up = stepButton('bb-bet-up', 'plus');
  // Mirror the control bar: disable a stepper at the end of the bet range, and lock both
  // while busy — so changing the stake behaves identically here and on the bottom bar.
  const paint = () => {
    val.innerHTML = `<span>${shell.t('Bet')}</span><b>${formatCurrency(shell.state.bet, shell.config.currency)}</b>`;
    const i = shell.state.availableBets.indexOf(shell.state.bet);
    down.disabled = shell.state.busy || i <= 0;
    up.disabled = shell.state.busy || i >= shell.state.availableBets.length - 1;
  };
  const step = (dir: 1 | -1) => () => {
    const next = stepBet(shell.state, dir);
    if (next === shell.state.bet) return;
    shell.state.bet = next; shell.emit('betChange', next); shell.render();
    paint(); onChange();
  };
  down.addEventListener('click', step(-1));
  up.addEventListener('click', step(1));
  paint();
  pill.append(down, val, up);
  bar.appendChild(pill);
  return bar;
}

function stepButton(ge: string, name: IconName): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'ge-bb-betstep'; b.dataset.ge = ge; b.innerHTML = icon(name);
  return b;
}

/** A grid card: title → thumbnail → description → volatility → price → full-bleed CTA.
 *  Clicking (when affordable) opens the confirmation modal. */
function buildCard(shell: GameShell, bonus: BonusOption, overlay: HTMLElement): HTMLElement {
  const accent = effectiveAccent(bonus);
  const card = document.createElement('div');
  card.className = 'ge-bonus-card'; card.dataset.ge = `bonus-card-${bonus.id}`;
  card.style.setProperty('--card-acc', accent);
  card.style.setProperty('--card-ink', contrastText(accent));
  card.appendChild(cardBody(shell, bonus));

  const cta = document.createElement('button');
  cta.className = 'ge-bonus-cta'; cta.dataset.ge = `bonus-cta-${bonus.id}`;
  cta.textContent = shell.t(actionLabel(bonus));
  card.appendChild(cta);

  const enabled = isAffordable(shell, bonus);
  if (!enabled) {
    card.classList.add('ge-bonus-off');
    cta.disabled = true;
  } else {
    // Stack the confirm on top of the overlay grid (cancel returns to the grid).
    card.addEventListener('click', () => { overlay.appendChild(buildConfirm(shell, bonus, overlay)); shell.fitModals(); });
  }
  return card;
}

/** The shared card interior (everything above the action area), reused by the confirm modal. */
function cardBody(shell: GameShell, bonus: BonusOption): HTMLElement {
  const price = bonus.priceMultiplier * shell.state.bet;
  const wrap = document.createElement('div'); wrap.className = 'ge-bonus-body';
  wrap.innerHTML =
    `<div class="ge-bonus-title">${bonus.title}</div>` +
    `<div class="ge-bonus-thumb">${thumb(bonus)}</div>` +
    `<div class="ge-bonus-desc">${bonus.description}</div>` +
    `<div class="ge-bonus-spacer"></div>` +
    (bonus.volatility ? `<div class="ge-bonus-vol">${volatility(bonus.volatility)}</div>` : '') +
    `<div class="ge-bonus-price">${formatCurrency(price, shell.config.currency)}</div>`;
  return wrap;
}

/** Confirmation modal — the shared card chrome (accent title heading, no ✕) with a bonus
 *  preview body and a full-bleed Cancel + action footer. */
function buildConfirm(shell: GameShell, bonus: BonusOption, overlay: HTMLElement): HTMLElement {
  const accent = effectiveAccent(bonus);
  const ui = createCardModal({ ge: 'bonus-confirm', title: bonus.title, accent, onClose: () => ui.root.remove() });

  const price = bonus.priceMultiplier * shell.state.bet;
  const preview = document.createElement('div'); preview.className = 'ge-confirm-preview';
  preview.innerHTML =
    `<div class="ge-bonus-thumb">${thumb(bonus)}</div>` +
    `<div class="ge-bonus-desc">${bonus.description}</div>` +
    (bonus.volatility ? `<div class="ge-bonus-vol">${volatility(bonus.volatility)}</div>` : '') +
    `<div class="ge-bonus-price">${formatCurrency(price, shell.config.currency)}</div>`;
  ui.body.appendChild(preview);

  const actions = document.createElement('div'); actions.className = 'ge-modal-actions';
  const cancel = document.createElement('button');
  cancel.className = 'ge-modal-btn ge-modal-btn--ghost'; cancel.dataset.ge = 'bonus-confirm-cancel';
  cancel.textContent = shell.t('Cancel');
  cancel.addEventListener('click', () => ui.root.remove());
  const buy = document.createElement('button');
  buy.className = 'ge-modal-btn ge-modal-btn--accent'; buy.dataset.ge = 'bonus-confirm-buy';
  buy.textContent = shell.t(actionLabel(bonus));
  buy.style.color = contrastText(accent); // bg comes from --card-acc on the card
  buy.addEventListener('click', () => {
    // Re-check at click time: the confirm modal stays open across state changes, so a spin
    // starting (busy), buy-bonus being disabled, or the balance dropping must block the purchase.
    if (!isAffordable(shell, bonus)) return;
    if (bonus.type === 'feature') shell.activateFeature(bonus);
    else shell.emit('buyBonusSelect', { id: bonus.id });
    ui.root.remove();
    overlay.remove();
  });
  actions.append(cancel, buy);
  ui.card.appendChild(actions);

  return ui.root;
}

function thumb(bonus: BonusOption): string {
  if (bonus.thumbnail) return `<img src="${bonus.thumbnail}" alt="${bonus.title}">`;
  return `<span class="ge-bonus-thumb-ph">${icon('gift')}</span>`;
}

/** Volatility as five lightning bolts (the supplied SVG); `level` lit in the accent, rest dimmed. */
function volatility(level: number): string {
  const n = Math.max(0, Math.min(5, level));
  const bolt = icon('lightning');
  return `<span class="ge-bonus-vol-on">${bolt.repeat(n)}</span>` +
    `<span class="ge-bonus-vol-off">${bolt.repeat(5 - n)}</span>`;
}

function actionLabel(bonus: BonusOption): string {
  return bonus.type === 'feature' ? 'Activate' : 'Buy';
}

function isAffordable(shell: GameShell, bonus: BonusOption): boolean {
  if (shell.state.busy || !shell.state.buyBonusEnabled) return false;
  return bonus.priceMultiplier * shell.state.bet <= shell.state.balance;
}
