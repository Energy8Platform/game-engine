import type { ShellHost } from '@/core/renderer';
import type { BonusOption } from '@/core/types';
import { betDir } from '@/core/keyboard';
import { effectiveAccent, contrastText } from '@/core/colors';
import { createOverlay, createCardModal } from '../primitives';
import { attachScrollAffordance, type ScrollAffordance } from '../scroll-affordance';
import { icon, type IconName } from '../icons';

/** Mutable state shared between the overlay DOM and the onKey handler. */
interface OverlayState {
  /** Index into the affordable-card subset; -1 = none (no affordable cards). */
  focusIndex: number;
  /** The bonus whose confirm dialog is currently open, or undefined. */
  confirmBonus: BonusOption | undefined;
}

/** Buy-bonus overlay — a grid of art-forward cards, one per option.
 *  Returns the overlay element + a keyboard handler for the shell's `showModal`. */
export function openBuyBonusOverlay(host: ShellHost): { root: HTMLElement; onKey: (e: KeyboardEvent) => boolean } | null {
  const bonuses = host.config.features.buyBonus;
  if (bonuses === false || bonuses.length === 0) return null;

  const st: OverlayState = { focusIndex: -1, confirmBonus: undefined };

  const { root, body, affordance } = createOverlay({ title: host.t('Buy bonus'), onClose: () => host.actions.closeOverlay() });
  root.dataset.ge = 'buybonus-overlay';

  // The strip's own X-scroll affordance, rebuilt with the grid it describes.
  let gridAffordance: ScrollAffordance | null = null;

  // Re-render the grid whenever the bet changes so every card's price stays live.
  const renderGrid = (): void => {
    gridAffordance?.destroy();
    body.innerHTML = '';
    const grid = document.createElement('div'); grid.className = 'ge-bb-grid';
    // Card count drives the width-fit clamp in CSS (each card is 18em; N cards must fit the frame
    // width), so the row scales to the available width instead of overflowing into an X-scroll.
    grid.style.setProperty('--ge-bb-n', String(bonuses.length));
    const affordable: BonusOption[] = [];
    for (const bonus of bonuses) {
      const card = buildCard(host, bonus, root, st);
      grid.appendChild(card);
      if (isAffordable(host, bonus)) affordable.push(bonus);
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
    // Two axes, two affordances. Below a ~340px frame the CSS stacks the cards and the OVERLAY
    // scrolls vertically (see the ge-bb-frame container query); above it the STRIP scrolls
    // horizontally. Each is attached unconditionally and stays silent on the axis that fits.
    gridAffordance = attachScrollAffordance(grid, { axis: 'x', cue: false });
    affordance.sync();
  };

  renderGrid();
  root.appendChild(buildBetBar(host, renderGrid)); // thin bottom footer, only as tall as the pill

  /** Step the bet by `dir` and re-render the grid (live prices + affordability) when it changed.
   *  Shared by the keyboard bet keys (the footer ± buttons keep their own copy). */
  const stepBetBy = (dir: 1 | -1): void => {
    const prev = host.state.bet;
    host.actions.stepBet(dir);
    // host.state.bet is updated synchronously by the controller action.
    if (host.state.bet !== prev) renderGrid();
  };

  /** Keyboard handler for both browse and confirm phases. */
  const onKey = (e: KeyboardEvent): boolean => {
    const affordable = bonuses.filter((b) => isAffordable(host, b));

    // ── Confirm phase ──
    if (st.confirmBonus) {
      switch (e.code) {
        case 'Enter':
        case 'Space': {
          const bonus = st.confirmBonus;
          if (!isAffordable(host, bonus)) return true;
          if (bonus.type === 'feature') host.actions.activateFeature(bonus);
          else host.actions.selectBuyBonus(bonus.id);
          host.actions.closeOverlay();
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
    const mobile = host.layout === 'mobile';

    // Bet stepping mirrors the bar's keys (Shift+↑/↓, Shift+=/-, Numpad ±). Checked BEFORE arrow
    // navigation so a bare arrow still moves card focus while a Shift+arrow changes the bet.
    const bet = betDir(e);
    if (bet !== null) { stepBetBy(bet); return true; }

    // Determine navigation direction from key code + layout (mobile uses vertical arrows)
    const fwdKey = e.code === 'ArrowRight' || (mobile && e.code === 'ArrowDown');
    const bwdKey = e.code === 'ArrowLeft' || (mobile && e.code === 'ArrowUp');

    if (fwdKey) {
      if (last < 0) return true;
      if (st.focusIndex < last) {
        st.focusIndex++;
        applyFocusClass(root, bonuses, affordable, st.focusIndex);
      }
      return true;
    }
    if (bwdKey) {
      if (last < 0) return true;
      if (st.focusIndex > 0) {
        st.focusIndex--;
        applyFocusClass(root, bonuses, affordable, st.focusIndex);
      }
      return true;
    }

    switch (e.code) {
      case 'Enter':
      case 'Space':
        if (last < 0 || st.focusIndex < 0) return true;
        {
          const bonus = affordable[st.focusIndex];
          openConfirm(host, bonus, root, st);
        }
        return true;
      // Bare =/- also step the bet (the Shift+=/- and Numpad variants are handled by betDir above).
      case 'Equal':
        stepBetBy(1);
        return true;
      case 'Minus':
        stepBetBy(-1);
        return true;
      case 'Escape':
        host.actions.closeOverlay();
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
function openConfirm(host: ShellHost, bonus: BonusOption, overlay: HTMLElement, st: OverlayState): void {
  closeConfirm(overlay, st); // remove any existing confirm
  st.confirmBonus = bonus;
  overlay.appendChild(buildConfirm(host, bonus, overlay, st));
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
function buildBetBar(host: ShellHost, onChange: () => void): HTMLElement {
  const bar = document.createElement('div'); bar.className = 'ge-bb-betbar';
  const pill = document.createElement('div'); pill.className = 'ge-bb-betpill';
  const val = document.createElement('div'); val.className = 'ge-bb-betval';
  const down = stepButton('bb-bet-down', 'minus');
  const up = stepButton('bb-bet-up', 'plus');
  // Mirror the control bar: disable a stepper at the end of the bet range, and lock both
  // while busy — so changing the stake behaves identically here and on the bottom bar.
  const paint = () => {
    val.innerHTML = `<span>${host.t('Bet')}</span><b>${host.formatCurrency(host.state.bet)}</b>`;
    const i = host.state.availableBets.indexOf(host.state.bet);
    down.disabled = host.state.busy || i <= 0;
    up.disabled = host.state.busy || i >= host.state.availableBets.length - 1;
  };
  const step = (dir: 1 | -1) => () => {
    const prev = host.state.bet;
    host.actions.stepBet(dir);
    if (host.state.bet !== prev) { paint(); onChange(); }
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
function buildCard(host: ShellHost, bonus: BonusOption, overlay: HTMLElement, st: OverlayState): HTMLElement {
  const accent = effectiveAccent(bonus);
  const card = document.createElement('div');
  card.className = 'ge-bonus-card'; card.dataset.ge = `bonus-card-${bonus.id}`;
  card.style.setProperty('--card-acc', accent);
  card.style.setProperty('--card-ink', contrastText(accent));

  const enabled = isAffordable(host, bonus);
  // Stack the confirm on top of the overlay grid (cancel returns to the grid). Re-checks
  // affordability at click time, so it's a safe no-op when the option can't be bought.
  const select = (): void => {
    if (!isAffordable(host, bonus)) return;
    openConfirm(host, bonus, overlay, st);
  };

  // Game-supplied card UI: the shell keeps the wrapper (grid sizing + accent vars) and runs the
  // buy flow when the game calls ctx.select(); the game owns everything inside.
  if (bonus.custom) {
    card.classList.add('ge-bonus-card--custom');
    const price = bonus.priceMultiplier * host.state.bet;
    card.appendChild(bonus.custom({
      bonus, bet: host.state.bet, price,
      priceText: host.formatCurrency(price),
      disabled: !enabled, accent, select,
    }) as Node);
    return card;
  }

  card.appendChild(cardBody(host, bonus));
  const cta = document.createElement('button');
  cta.className = 'ge-bonus-cta'; cta.dataset.ge = `bonus-cta-${bonus.id}`;
  cta.textContent = host.t(actionLabel(bonus));
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
function cardBody(host: ShellHost, bonus: BonusOption): HTMLElement {
  const price = bonus.priceMultiplier * host.state.bet;
  const wrap = document.createElement('div'); wrap.className = 'ge-bonus-body';
  wrap.innerHTML =
    `<div class="ge-bonus-title">${bonus.title}</div>` +
    `<div class="ge-bonus-thumb">${thumb(bonus)}</div>` +
    `<div class="ge-bonus-desc">${bonus.description}</div>` +
    `<div class="ge-bonus-spacer"></div>` +
    (bonus.volatility ? `<div class="ge-bonus-vol">${volatility(bonus.volatility)}</div>` : '') +
    `<div class="ge-bonus-price">${host.formatCurrency(price)}</div>`;
  return wrap;
}

/** Confirmation modal — the shared card chrome (accent title heading, no ✕) with a bonus
 *  preview body and a full-bleed Cancel + action footer. */
function buildConfirm(host: ShellHost, bonus: BonusOption, overlay: HTMLElement, st: OverlayState): HTMLElement {
  const accent = effectiveAccent(bonus);
  const ui = createCardModal({ ge: 'bonus-confirm', title: bonus.title, accent, onClose: () => { closeConfirm(overlay, st); } });

  const price = bonus.priceMultiplier * host.state.bet;
  const preview = document.createElement('div'); preview.className = 'ge-confirm-preview';
  preview.innerHTML =
    `<div class="ge-bonus-thumb">${thumb(bonus)}</div>` +
    `<div class="ge-bonus-desc">${bonus.description}</div>` +
    (bonus.volatility ? `<div class="ge-bonus-vol">${volatility(bonus.volatility)}</div>` : '') +
    `<div class="ge-bonus-price">${host.formatCurrency(price)}</div>`;
  ui.body.appendChild(preview);

  const actions = document.createElement('div'); actions.className = 'ge-modal-actions';
  const cancel = document.createElement('button');
  cancel.className = 'ge-modal-btn ge-modal-btn--ghost'; cancel.dataset.ge = 'bonus-confirm-cancel';
  cancel.textContent = host.t('Cancel');
  cancel.addEventListener('click', () => closeConfirm(overlay, st));
  const buy = document.createElement('button');
  buy.className = 'ge-modal-btn ge-modal-btn--accent'; buy.dataset.ge = 'bonus-confirm-buy';
  buy.textContent = host.t(actionLabel(bonus));
  buy.style.color = contrastText(accent); // bg comes from --card-acc on the card
  buy.addEventListener('click', () => {
    // Re-check at click time: the confirm modal stays open across state changes, so a spin
    // starting (busy), buy-bonus being disabled, or the balance dropping must block the purchase.
    if (!isAffordable(host, bonus)) return;
    if (bonus.type === 'feature') host.actions.activateFeature(bonus);
    else host.actions.selectBuyBonus(bonus.id);
    host.actions.closeOverlay();
  });
  actions.append(cancel, buy);
  ui.card.appendChild(actions);

  return ui.root;
}

function thumb(bonus: BonusOption): string {
  if (bonus.thumbnail) return `<img src="${bonus.thumbnail}" alt="${bonus.title}">`;
  return `<span class="ge-bonus-thumb-ph">${icon('gift')}</span>`;
}

/** Volatility as five turbo bolts; the first `level` lit (white fill + accent ring), the rest
 *  inactive (white fill + black ring, dimmed) — same outline treatment as the turbo button. */
function volatility(level: number): string {
  const n = Math.max(0, Math.min(5, level));
  const bolt = icon('turbo1');
  return `<span class="ge-bonus-vol-on">${bolt.repeat(n)}</span>` +
    `<span class="ge-bonus-vol-off">${bolt.repeat(5 - n)}</span>`;
}

function actionLabel(bonus: BonusOption): string {
  return bonus.type === 'feature' ? 'Activate' : 'Buy';
}

function isAffordable(host: ShellHost, bonus: BonusOption): boolean {
  if (host.state.busy || !host.state.buyBonusEnabled) return false;
  return bonus.priceMultiplier * host.state.bet <= host.state.balance;
}
