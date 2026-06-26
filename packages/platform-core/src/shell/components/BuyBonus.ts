import type { GameShell } from '../GameShell';
import type { BonusOption } from '../types';
import { formatCurrency } from '../format';
import { stepBet } from '../state';
import { effectiveAccent, contrastText } from '../colors';
import { createOverlay, createCardModal } from './primitives';
import { icon, type IconName } from './icons';

/** Mutable state shared between the overlay DOM and the onKey handler. */
interface OverlayState {
  /** Index into the affordable-card subset; -1 = none (no affordable cards). */
  focusIndex: number;
  /** The bonus whose confirm dialog is currently open, or undefined. */
  confirmBonus: BonusOption | undefined;
}

/** Buy-bonus overlay — a grid of art-forward cards, one per option.
 *  Returns the overlay element + a keyboard handler for the shell's `showModal`. */
export function openBuyBonusOverlay(shell: GameShell): { root: HTMLElement; onKey: (e: KeyboardEvent) => boolean } | null {
  const bonuses = shell.config.features.buyBonus;
  if (bonuses === false || bonuses.length === 0) return null;

  const st: OverlayState = { focusIndex: -1, confirmBonus: undefined };

  const { root, body } = createOverlay({ title: shell.t('Buy bonus'), onClose: () => shell.closeModal() });
  root.dataset.ge = 'buybonus-overlay';

  // Re-render the grid whenever the bet changes so every card's price stays live.
  const renderGrid = (): void => {
    body.innerHTML = '';
    const grid = document.createElement('div'); grid.className = 'ge-bb-grid';
    const affordable: BonusOption[] = [];
    for (const bonus of bonuses) {
      const card = buildCard(shell, bonus, root, st);
      grid.appendChild(card);
      if (isAffordable(shell, bonus)) affordable.push(bonus);
    }
    body.appendChild(grid);
    // Initialize or restore focus index
    if (affordable.length > 0) {
      if (st.focusIndex < 0) st.focusIndex = 0;
      else st.focusIndex = Math.min(st.focusIndex, affordable.length - 1);
      applyFocusClass(root, bonuses, affordable, st.focusIndex);
    } else {
      st.focusIndex = -1;
    }
  };

  renderGrid();
  root.appendChild(buildBetBar(shell, renderGrid)); // thin bottom footer, only as tall as the pill

  /** Keyboard handler for both browse and confirm phases. */
  const onKey = (e: KeyboardEvent): boolean => {
    const affordable = bonuses.filter((b) => isAffordable(shell, b));

    // ── Confirm phase ──
    if (st.confirmBonus) {
      switch (e.code) {
        case 'Enter':
        case 'Space': {
          const bonus = st.confirmBonus;
          if (!isAffordable(shell, bonus)) return true;
          if (bonus.type === 'feature') shell.activateFeature(bonus);
          else shell.emit('buyBonusSelect', { id: bonus.id });
          shell.closeModal();
          return true;
        }
        case 'Escape':
          // Remove the confirm dialog, return to browse
          closeConfirm(root, st);
          return true;
        default:
          return false;
      }
    }

    // ── Browse phase ──
    const last = affordable.length - 1;

    switch (e.code) {
      case 'ArrowRight':
      case 'ArrowDown':
        if (last < 0) return true;
        if (st.focusIndex < last) {
          st.focusIndex++;
          applyFocusClass(root, bonuses, affordable, st.focusIndex);
        }
        return true;
      case 'ArrowLeft':
      case 'ArrowUp':
        if (last < 0) return true;
        if (st.focusIndex > 0) {
          st.focusIndex--;
          applyFocusClass(root, bonuses, affordable, st.focusIndex);
        }
        return true;
      case 'Enter':
      case 'Space':
        if (last < 0 || st.focusIndex < 0) return true;
        {
          const bonus = affordable[st.focusIndex];
          openConfirm(shell, bonus, root, st);
        }
        return true;
      case 'Equal':
      case 'NumpadAdd': {
        const next = stepBet(shell.state, 1);
        if (next !== shell.state.bet) {
          shell.state.bet = next; shell.emit('betChange', next); shell.render();
          renderGrid();
        }
        return true;
      }
      case 'Minus':
      case 'NumpadSubtract': {
        const next = stepBet(shell.state, -1);
        if (next !== shell.state.bet) {
          shell.state.bet = next; shell.emit('betChange', next); shell.render();
          renderGrid();
        }
        return true;
      }
      case 'Escape':
        shell.closeModal();
        return true;
      default:
        return false;
    }
  };

  return { root, onKey };
}

/** Apply a CSS keyboard-focus class to the currently focused affordable card. */
function applyFocusClass(overlay: HTMLElement, bonuses: BonusOption[], affordable: BonusOption[], focusIndex: number): void {
  for (const b of bonuses) {
    const card = overlay.querySelector(`[data-ge="bonus-card-${b.id}"]`) as HTMLElement | null;
    if (!card) continue;
    card.classList.remove('ge-bonus-card--kbd-focus');
  }
  const focused = affordable[focusIndex];
  if (!focused) return;
  const card = overlay.querySelector(`[data-ge="bonus-card-${focused.id}"]`) as HTMLElement | null;
  if (card) card.classList.add('ge-bonus-card--kbd-focus');
}

/** Open the confirm dialog for the given bonus and track it in overlay state. */
function openConfirm(shell: GameShell, bonus: BonusOption, overlay: HTMLElement, st: OverlayState): void {
  closeConfirm(overlay, st); // remove any existing confirm
  st.confirmBonus = bonus;
  overlay.appendChild(buildConfirm(shell, bonus, overlay, st));
  shell.fitModals();
}

/** Remove the confirm dialog and clear the overlay state. */
function closeConfirm(overlay: HTMLElement, st: OverlayState): void {
  // The confirm dialog is a .ge-sheet with data-ge="bonus-confirm" appended directly to overlay.
  const sheet = overlay.querySelector('[data-ge="bonus-confirm"]') as HTMLElement | null;
  if (sheet) sheet.remove();
  st.confirmBonus = undefined;
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
function buildCard(shell: GameShell, bonus: BonusOption, overlay: HTMLElement, st: OverlayState): HTMLElement {
  const accent = effectiveAccent(bonus);
  const card = document.createElement('div');
  card.className = 'ge-bonus-card'; card.dataset.ge = `bonus-card-${bonus.id}`;
  card.style.setProperty('--card-acc', accent);
  card.style.setProperty('--card-ink', contrastText(accent));

  const enabled = isAffordable(shell, bonus);
  // Stack the confirm on top of the overlay grid (cancel returns to the grid). Re-checks
  // affordability at click time, so it's a safe no-op when the option can't be bought.
  const select = (): void => {
    if (!isAffordable(shell, bonus)) return;
    openConfirm(shell, bonus, overlay, st);
  };

  // Game-supplied card UI: the shell keeps the wrapper (grid sizing + accent vars) and runs the
  // buy flow when the game calls ctx.select(); the game owns everything inside.
  if (bonus.custom) {
    card.classList.add('ge-bonus-card--custom');
    const price = bonus.priceMultiplier * shell.state.bet;
    card.appendChild(bonus.custom({
      bonus, bet: shell.state.bet, price,
      priceText: formatCurrency(price, shell.config.currency),
      disabled: !enabled, accent, select,
    }));
    return card;
  }

  card.appendChild(cardBody(shell, bonus));
  const cta = document.createElement('button');
  cta.className = 'ge-bonus-cta'; cta.dataset.ge = `bonus-cta-${bonus.id}`;
  cta.textContent = shell.t(actionLabel(bonus));
  card.appendChild(cta);

  if (!enabled) {
    card.classList.add('ge-bonus-off');
    cta.disabled = true;
  } else {
    card.addEventListener('click', select);
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
function buildConfirm(shell: GameShell, bonus: BonusOption, overlay: HTMLElement, st: OverlayState): HTMLElement {
  const accent = effectiveAccent(bonus);
  const ui = createCardModal({ ge: 'bonus-confirm', title: bonus.title, accent, onClose: () => { closeConfirm(overlay, st); } });

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
  cancel.addEventListener('click', () => closeConfirm(overlay, st));
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
    shell.closeModal();
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
