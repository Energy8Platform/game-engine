import type { GameShell } from '../GameShell';
import { formatCurrency } from '../format';
import { stepBet, nextTurbo } from '../state';
import { effectiveAccent, contrastText } from '../colors';
import { icon, type IconName } from './icons';
import { twoLine } from './primitives';

/** A floating labelled money readout (balance/win/bet). */
function readout(ge: string, label: string, value: string): HTMLElement {
  const el = document.createElement('div');
  el.dataset.ge = ge;
  el.className = `ge-rd ge-${ge}`;
  el.innerHTML = `<span class="ge-lbl">${label}</span>`;
  el.append(document.createTextNode(value));
  return el;
}

// Resting icon is turbo1 (1 line, grey via .ge-iconbtn); engaging turbo adds the
// .ge-active class which paints it white. Higher levels add more speed lines.
// level: 0 → turbo1 (grey), 1 → turbo1 (white), 2 → turbo2, 3 → turbo3.
function turboIcon(level: number): IconName {
  return (['turbo1', 'turbo1', 'turbo2', 'turbo3'] as const)[Math.max(0, Math.min(3, level))];
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
  const mobile = shell.layout === 'mobile';
  const bar = document.createElement('div');
  bar.className = 'ge-shell-bottom';
  bar.dataset.geMode = state.mode;

  // menu icon button (always)
  const menu = iconBtn('menu', 'menu', () => shell.openMenu());

  // All three modes share the base plaque layout. FS/replay hide the controls that don't apply
  // and add Free Spins + Total Win blocks on the left; the per-spin WIN uses the base pill.
  const isBase = state.mode === 'base';
  const isFS = state.mode === 'freeSpins';
  // FS always shows the spins counter + accumulated Total Win (even €0); a replay shows them
  // only when it's a free-spins replay (freeSpins.total > 0).
  const showFsBlocks = isFS || (state.mode === 'replay' && state.freeSpins.total > 0);

  const balance = readout('balance', shell.t('Balance'), fmt(state.balance));
  // With a feature active (e.g. Ante) the BET readout shows the effective stake, tinted with
  // the feature accent; the base state.bet is unchanged and returns once the feature is off.
  const feature = state.activeFeature;
  const betShown = feature ? state.bet * feature.priceMultiplier : state.bet;
  const betValue = readout('bet-value', shell.t('Bet'), fmt(betShown));
  if (feature) {
    const accent = effectiveAccent(feature);
    betValue.classList.add('ge-bet-feature');
    betValue.style.color = accent;
    // tint the "BET" label too (its .ge-lbl colour is set in CSS, so override inline)
    const lbl = betValue.querySelector('.ge-lbl') as HTMLElement | null;
    if (lbl) lbl.style.color = accent;
  }
  const turbo = config.features.turbo > 0
    ? iconBtn('turbo', turboIcon(state.turbo), () => onTurbo(shell), state.turbo > 0) : null;

  // interactive controls — base mode only
  let betDown: HTMLElement | null = null, betUp: HTMLElement | null = null;
  let spin: HTMLElement | null = null, auto: HTMLElement | null = null, buy: HTMLElement | null = null;
  if (isBase) {
    betDown = iconBtn('bet-down', 'minus', () => onBet(shell, -1));
    betUp = iconBtn('bet-up', 'plus', () => onBet(shell, 1));
    betValue.classList.add('ge-betbtn');                       // tap the stake → bet picker
    betValue.addEventListener('click', () => { if (!betLocked(shell)) shell.openBetPicker(); });
    spin = spinButton(shell);
    auto = config.features.autoplay ? autoButton(shell) : null;
    buy = (config.features.buyBonus !== false || config.onBonusBuy) ? buyBtn(shell) : null;
  }

  const winEl = state.win > 0 ? readout('win', shell.t('Win'), fmt(state.win)) : null;
  // FS/replay left blocks: spins counter + accumulated Total Win (shown even at €0).
  const fsCounter = showFsBlocks ? readout('fs-counter', shell.t('Free spins'), `${state.freeSpins.current} / ${state.freeSpins.total}`) : null;
  const fsTotalWin = showFsBlocks ? readout('fs-totalwin', shell.t('Total win'), fmt(state.freeSpins.totalWin)) : null;

  if (mobile) {
    // rows: [balance · win] · [menu · auto · spin · FS counter · Total Win · turbo · buy] · [− bet +]
    // FS counter + Total Win live in the controls row (alongside menu/turbo), not the top readouts.
    bar.appendChild(plaque('ge-m-top ge-pl ge-pl-glass', compact([balance, winEl])));
    const center = isBase ? spin : null;
    bar.appendChild(plaque('ge-m-controls ge-pl-dark', compact([menu, auto, center, fsCounter, fsTotalWin, turbo, buy])));
    bar.appendChild(plaque('ge-m-bet ge-pl ge-pl-dark', compact([betDown, betValue, betUp])));
  } else {
    // LEFT: [menu] ⊐ BUY BONUS coin ⊏ [balance] · [Free Spins] · [Total Win]
    // (the last two only render in FS / a free-spins replay)
    const menuPlaque = plaque('ge-pl ge-pl-dark ge-pl-menu', [menu]);
    const balPlaque = plaque('ge-pl ge-pl-glass ge-pl-bal', [balance]);
    const fsPlaque = fsCounter ? plaque('ge-pl ge-pl-glass ge-pl-fs', [fsCounter]) : null;
    const totalWinPlaque = fsTotalWin ? plaque('ge-pl ge-pl-glass ge-pl-totalwin', [fsTotalWin]) : null;
    const left = zone('ge-zone-left ge-zone-plaques', ...compact([menuPlaque, buy, balPlaque, fsPlaque, totalWinPlaque]));

    // RIGHT: [bet (+ step)] · |divider| · [auto · SPIN · turbo]
    const betKids: HTMLElement[] = [betValue];
    if (betUp && betDown) {
      const step = document.createElement('div'); step.className = 'ge-betstep'; step.append(betUp, betDown);
      betKids.push(step);
    }
    const betPlaque = plaque('ge-pl ge-pl-dark ge-pl-bet', betKids);
    const divider = document.createElement('div'); divider.className = 'ge-pl-divider';
    const spinWrap = document.createElement('div'); spinWrap.className = 'ge-spinwrap ge-pl-dark';
    spinWrap.append(...compact([auto, spin, turbo]));
    const right = zone('ge-zone-right ge-zone-plaques', betPlaque, divider, spinWrap);

    // MIDDLE: per-spin WIN pill in every mode — lifts above the bar on overflow.
    let middle: HTMLElement | null = null;
    if (winEl) { winEl.classList.add('ge-winpill'); middle = winEl; }
    bar.append(...compact([left, middle, right]));
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
/** A rounded background panel ("plaque") grouping a set of controls. */
function plaque(cls: string, children: HTMLElement[]): HTMLElement {
  const d = document.createElement('div');
  d.className = cls;
  d.append(...children);
  return d;
}
function compact(items: (HTMLElement | null)[]): HTMLElement[] { return items.filter((x): x is HTMLElement => x !== null); }

function buyBtn(shell: GameShell): HTMLButtonElement {
  const buy = document.createElement('button');
  buy.className = 'ge-shell-buybonus'; buy.dataset.ge = 'buybonus';
  const feature = shell.state.activeFeature;
  if (feature) {
    // A feature is active → this button turns into DISABLE (tinted with the feature accent).
    const accent = effectiveAccent(feature);
    buy.classList.add('ge-disable');
    buy.innerHTML = `<span>${shell.t('DISABLE')}</span>`;
    buy.style.background = accent; buy.style.color = contrastText(accent);
    buy.addEventListener('click', () => { if (!buy.disabled) shell.deactivateFeature(); });
  } else {
    buy.innerHTML = `<span>${twoLine(shell.t('BUY BONUS'))}</span>`;
    buy.addEventListener('click', () => { if (!buy.disabled) shell.openBuyBonus(); });
  }
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
function betLocked(shell: GameShell): boolean {
  return shell.state.busy || shell.state.autoplay.active;
}

/** SPIN disc — rotates while busy; becomes a STOP + countdown while autoplay runs. */
function spinButton(shell: GameShell): HTMLButtonElement {
  const { state } = shell;
  const sp = document.createElement('button');
  sp.className = 'ge-shell-spin'; sp.dataset.ge = 'spin';
  if (state.autoplay.active) {
    sp.classList.add('ge-stop');
    const rem = state.autoplay.remaining;
    const label = Number.isFinite(rem) ? String(rem) : '∞';
    sp.innerHTML = `<span class="ge-spin-stop">${icon('stop')}</span><span class="ge-spin-count">${label}</span>`;
    sp.addEventListener('click', () => { if (!sp.disabled) stopAutoplay(shell); });
  } else {
    sp.innerHTML = icon('spin');
    if (state.busy) sp.classList.add('ge-spinning');
    sp.addEventListener('click', () => { if (!sp.disabled) shell.emit('spin'); });
  }
  return sp;
}

/** Autoplay icon button — opens the count picker; glows accent while running. */
function autoButton(shell: GameShell): HTMLButtonElement {
  const active = shell.state.autoplay.active;
  const b = iconBtn('autoplay', 'autoplay', () => onAutoplay(shell), active);
  if (active) b.classList.add('ge-glow');
  return b;
}

function onAutoplay(shell: GameShell): void {
  if (shell.state.autoplay.active) stopAutoplay(shell);
  else shell.openAutoplayPicker();
}
function stopAutoplay(shell: GameShell): void {
  shell.state.autoplay = { active: false, remaining: 0 };
  shell.emit('autoplayStop');
  shell.render();
}

function applyBusy(shell: GameShell, bar: HTMLElement): void {
  const { busy } = shell.state;
  const auto = shell.state.autoplay.active;
  const lockBet = busy || auto;
  const disable = (ge: string, off: boolean) => {
    const el = bar.querySelector(`[data-ge="${ge}"]`) as HTMLButtonElement | null;
    if (el) el.disabled = off;
  };
  // also disable the stepper that's already at the end of the bet range
  const i = shell.state.availableBets.indexOf(shell.state.bet);
  disable('bet-up', lockBet || i >= shell.state.availableBets.length - 1);
  disable('bet-down', lockBet || i <= 0);
  disable('spin', busy && !auto);     // keep the STOP disc clickable through autoplay
  disable('autoplay', busy && !auto); // keep autoplay (stop) clickable through autoplay
  const betVal = bar.querySelector('[data-ge="bet-value"]') as HTMLElement | null;
  if (betVal) betVal.classList.toggle('ge-disabled', lockBet);
  const buy = bar.querySelector('[data-ge="buybonus"]') as HTMLButtonElement | null;
  // disabled for the whole autoplay run (not just per-spin busy) so it doesn't flicker/pulse
  if (buy) buy.disabled = busy || auto || !shell.state.buyBonusEnabled;
}
