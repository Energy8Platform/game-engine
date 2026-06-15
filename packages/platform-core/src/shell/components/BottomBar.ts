import type { GameShell } from '../GameShell';
import { formatCurrency } from '../format';
import { stepBet, nextTurbo } from '../state';
import { createButton } from './primitives';

function valueEl(tag: string, ge: string, text: string): HTMLElement {
  const el = document.createElement(tag);
  el.dataset.ge = ge;
  el.className = `ge-shell-${ge}`;
  el.textContent = text;
  return el;
}

/** Builds (or rebuilds) the bottom bar DOM for the current shell state. */
export function renderBottomBar(shell: GameShell): HTMLElement {
  const { state, config } = shell;
  const fmt = (n: number) => formatCurrency(n, config.currency);
  const bar = document.createElement('div');
  bar.className = 'ge-shell-bottom';
  bar.dataset.geMode = state.mode;

  if (state.mode === 'base') {
    bar.appendChild(valueEl('div', 'balance', fmt(state.balance)));

    const betDown = createButton({ label: '−', onClick: () => onBet(shell, -1) });
    betDown.dataset.ge = 'bet-down';
    const betValue = valueEl('span', 'bet-value', fmt(state.bet));
    const betUp = createButton({ label: '+', onClick: () => onBet(shell, 1) });
    betUp.dataset.ge = 'bet-up';
    bar.append(betDown, betValue, betUp);

    const spin = createButton({ label: 'SPIN', className: 'ge-shell-spin', onClick: () => shell.emit('spin') });
    spin.dataset.ge = 'spin';
    bar.appendChild(spin);

    if (config.features.autoplay) {
      const auto = createButton({ label: 'AUTO', onClick: () => onAutoplay(shell) });
      auto.dataset.ge = 'autoplay';
      bar.appendChild(auto);
    }
    if (config.features.turbo > 0) {
      const turbo = createButton({ label: turboLabel(state.turbo), onClick: () => onTurbo(shell) });
      turbo.dataset.ge = 'turbo';
      bar.appendChild(turbo);
    }
    if (config.features.buyBonus !== false) {
      const buy = createButton({ label: 'BUY BONUS', className: 'ge-shell-buybonus', onClick: () => shell.openBuyBonus() });
      buy.dataset.ge = 'buybonus';
      bar.appendChild(buy);
    }

    bar.appendChild(valueEl('div', 'win', fmt(state.win)));
  }

  if (state.mode === 'freeSpins') {
    bar.appendChild(valueEl('div', 'balance', fmt(state.balance)));
    bar.appendChild(valueEl('div', 'bet-value', fmt(state.bet))); // read-only
    const counter = valueEl('div', 'fs-counter', `${state.freeSpins.current} / ${state.freeSpins.total}`);
    bar.appendChild(counter);
    bar.appendChild(valueEl('div', 'fs-totalwin', fmt(state.freeSpins.totalWin)));
    bar.appendChild(valueEl('div', 'fs-lastwin', fmt(state.freeSpins.lastWin)));
    if (config.features.turbo > 0) {
      const turbo = createButton({ label: turboLabel(state.turbo), onClick: () => onTurbo(shell) });
      turbo.dataset.ge = 'turbo';
      bar.appendChild(turbo);
    }
  }

  if (state.mode === 'replay') {
    bar.appendChild(valueEl('div', 'replay-badge', 'REPLAY'));
    bar.appendChild(valueEl('div', 'bet-value', fmt(state.bet))); // read-only
    bar.appendChild(valueEl('div', 'win', fmt(state.win)));
    if (state.freeSpins.total > 0) {
      bar.appendChild(valueEl('div', 'fs-counter', `${state.freeSpins.current} / ${state.freeSpins.total}`));
    }
    if (config.features.turbo > 0) {
      const turbo = createButton({ label: turboLabel(state.turbo), onClick: () => onTurbo(shell) });
      turbo.dataset.ge = 'turbo';
      bar.appendChild(turbo);
    }
  }

  // menu is always present
  const menu = createButton({ label: '☰', onClick: () => shell.openMenu() });
  menu.dataset.ge = 'menu';
  bar.appendChild(menu);

  applyBusy(shell, bar);
  return bar;
}

function turboLabel(level: number): string {
  return level === 0 ? 'TURBO' : `TURBO ×${level}`;
}

function onBet(shell: GameShell, dir: 1 | -1): void {
  if (shell.state.busy) return;
  const next = stepBet(shell.state, dir);
  if (next !== shell.state.bet) {
    shell.state.bet = next;
    shell.emit('betChange', next);
    shell.render();
  }
}

function onTurbo(shell: GameShell): void {
  const next = nextTurbo(shell.state.turbo, shell.config.features.turbo);
  shell.state.turbo = next;
  shell.emit('turboChange', next);
  shell.render();
}

function onAutoplay(shell: GameShell): void {
  const active = !shell.state.autoplay.active;
  shell.state.autoplay = { active, remaining: active ? shell.state.autoplay.remaining : 0 };
  if (active) shell.emit('autoplayStart', shell.state.autoplay);
  else shell.emit('autoplayStop');
  shell.render();
}

/** Disable money controls while busy; keep menu usable. */
function applyBusy(shell: GameShell, bar: HTMLElement): void {
  const busy = shell.state.busy;
  for (const ge of ['spin', 'bet-up', 'bet-down', 'autoplay']) {
    const el = bar.querySelector(`[data-ge="${ge}"]`) as HTMLButtonElement | null;
    if (el) el.disabled = busy;
  }
  const buy = bar.querySelector('[data-ge="buybonus"]') as HTMLButtonElement | null;
  if (buy) buy.disabled = busy || !shell.state.buyBonusEnabled;
}
