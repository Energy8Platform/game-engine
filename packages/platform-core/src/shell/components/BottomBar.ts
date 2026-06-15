import type { GameShell } from '../GameShell';
import { formatCurrency } from '../format';
import { stepBet, nextTurbo } from '../state';
import { icon, type IconName } from './icons';

/** A floating labelled money readout (balance/win/bet). */
function readout(ge: string, label: string, value: string): HTMLElement {
  const el = document.createElement('div');
  el.dataset.ge = ge;
  el.className = `ge-rd ge-${ge}`;
  el.innerHTML = `<span class="ge-lbl">${label}</span>`;
  el.append(document.createTextNode(value));
  return el;
}

/** A borderless icon button. */
function iconBtn(ge: string, name: IconName, onClick: () => void, active = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = `ge-iconbtn${active ? ' ge-active' : ''}`;
  b.dataset.ge = ge;
  b.innerHTML = icon(name);
  b.addEventListener('click', () => { if (!b.disabled) onClick(); });
  return b;
}

export function renderBottomBar(shell: GameShell): HTMLElement {
  const { state, config } = shell;
  const fmt = (n: number) => formatCurrency(n, config.currency);
  const narrow = shell.layout === 'narrow';
  const bar = document.createElement('div');
  bar.className = 'ge-shell-bottom';
  bar.dataset.geMode = state.mode;

  // menu icon button (always)
  const menu = iconBtn('menu', 'menu', () => shell.openMenu());

  if (state.mode === 'base') {
    const balance = readout('balance', 'Balance', fmt(state.balance));
    const win = readout('win', 'Win', fmt(state.win));
    const betValue = readout('bet-value', 'Bet', fmt(state.bet));

    const betDown = iconBtn('bet-down', narrow ? 'betMinus' : 'betDown', () => onBet(shell, -1));
    const betUp = iconBtn('bet-up', narrow ? 'betPlus' : 'betUp', () => onBet(shell, 1));

    const spin = document.createElement('button');
    spin.className = 'ge-shell-spin'; spin.dataset.ge = 'spin'; spin.innerHTML = icon('spin');
    spin.addEventListener('click', () => { if (!spin.disabled) shell.emit('spin'); });

    const turbo = config.features.turbo > 0
      ? iconBtn('turbo', 'turbo', () => onTurbo(shell), state.turbo > 0) : null;
    const auto = config.features.autoplay
      ? iconBtn('autoplay', 'autoplay', () => onAutoplay(shell), state.autoplay.active) : null;
    const buy = config.features.buyBonus !== false ? buyBtn(shell) : null;

    if (narrow) {
      const info = zone('ge-zone-info', balance, win);
      const buyZone = buy ? zone('ge-zone-buy', buy) : zone('ge-zone-buy');
      const betCol = document.createElement('div');
      betCol.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:5px';
      betCol.append(spin, betValue);
      const controls = zone('ge-zone-controls', ...compact([turbo, betDown, betCol, betUp, auto]));
      bar.append(info, buyZone, controls, zone('ge-zone-menu', menu));
    } else {
      const left = zone('ge-zone-left', menu, balance, win, ...(buy ? [buy] : []));
      const step = document.createElement('div'); step.className = 'ge-betstep'; step.append(betUp, betDown);
      const right = zone('ge-zone-right', ...compact([betValue, step, turbo, auto, spin]));
      bar.append(left, right);
    }
  } else if (state.mode === 'freeSpins') {
    const hero = document.createElement('div');
    hero.className = 'ge-fs-hero'; hero.dataset.ge = 'fs-counter';
    hero.innerHTML = `<b>${state.freeSpins.current} / ${state.freeSpins.total}</b><span>Free spins</span>`;
    const turbo = config.features.turbo > 0 ? iconBtn('turbo', 'turbo', () => onTurbo(shell), state.turbo > 0) : null;
    const center = zone('ge-zone-fs',
      readout('balance', 'Balance', fmt(state.balance)),
      hero,
      readout('fs-totalwin', 'Total win', fmt(state.freeSpins.totalWin)),
      readout('fs-lastwin', 'Last win', fmt(state.freeSpins.lastWin)),
    );
    bar.append(zone('ge-zone-left', menu), center, zone('ge-zone-right', ...compact([readout('bet-value', 'Bet', fmt(state.bet)), turbo])));
  } else { // replay — read-only, NO badge
    const turbo = config.features.turbo > 0 ? iconBtn('turbo', 'turbo', () => onTurbo(shell), state.turbo > 0) : null;
    const center = zone('ge-zone-replay',
      readout('bet-value', 'Bet', fmt(state.bet)),
      readout('win', 'Win', fmt(state.win)),
      ...(state.freeSpins.total > 0 ? [readout('fs-counter', 'Free spins', `${state.freeSpins.current} / ${state.freeSpins.total}`)] : []),
      ...compact([turbo]),
    );
    bar.append(zone('ge-zone-left', menu), center);
  }

  applyBusy(shell, bar);
  return bar;
}

function zone(cls: string, ...children: HTMLElement[]): HTMLElement {
  const z = document.createElement('div');
  z.className = `ge-zone ${cls}`;
  z.append(...children);
  return z;
}
function compact(items: (HTMLElement | null)[]): HTMLElement[] { return items.filter((x): x is HTMLElement => x !== null); }

function buyBtn(shell: GameShell): HTMLButtonElement {
  const buy = document.createElement('button');
  buy.className = 'ge-shell-buybonus'; buy.dataset.ge = 'buybonus';
  buy.innerHTML = `${icon('gift')}<span>BUY BONUS</span>`;
  buy.addEventListener('click', () => { if (!buy.disabled) shell.openBuyBonus(); });
  return buy;
}

function onBet(shell: GameShell, dir: 1 | -1): void {
  if (shell.state.busy) return;
  const next = stepBet(shell.state, dir);
  if (next !== shell.state.bet) { shell.state.bet = next; shell.emit('betChange', next); shell.render(); }
}
function onTurbo(shell: GameShell): void {
  const next = nextTurbo(shell.state.turbo, shell.config.features.turbo);
  shell.state.turbo = next; shell.emit('turboChange', next); shell.render();
}
function onAutoplay(shell: GameShell): void {
  const active = !shell.state.autoplay.active;
  shell.state.autoplay = { active, remaining: active ? shell.state.autoplay.remaining : 0 };
  if (active) shell.emit('autoplayStart', shell.state.autoplay); else shell.emit('autoplayStop');
  shell.render();
}

function applyBusy(shell: GameShell, bar: HTMLElement): void {
  const busy = shell.state.busy;
  for (const ge of ['spin', 'bet-up', 'bet-down', 'autoplay']) {
    const el = bar.querySelector(`[data-ge="${ge}"]`) as HTMLButtonElement | null;
    if (el) el.disabled = busy;
  }
  const buy = bar.querySelector('[data-ge="buybonus"]') as HTMLButtonElement | null;
  if (buy) buy.disabled = busy || !shell.state.buyBonusEnabled;
}
