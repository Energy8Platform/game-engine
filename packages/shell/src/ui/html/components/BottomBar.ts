import type { ShellHost } from '@/core/renderer';
import { effectiveAccent, contrastText } from '@/core/colors';
import { icon, type IconName } from '../icons';

/** A floating labelled money readout (balance/win/bet). */
function readout(ge: string, label: string, value: string): HTMLElement {
  const el = document.createElement('div');
  el.dataset.ge = ge;
  el.className = `ge-rd ge-${ge}`;
  // The value lives in its own inline-block span (.ge-rd-val) so it can be measured & shrunk to fit
  // (see GameShell.fitBet) independently of the label, and so the count-up animates just the number.
  const lbl = document.createElement('span'); lbl.className = 'ge-lbl'; lbl.textContent = label;
  const val = document.createElement('span'); val.className = 'ge-rd-val'; val.textContent = value;
  el.append(lbl, val);
  return el;
}

// Turbo is ONE bolt glyph (turbo1) whose state is shown by colour, not by swapping glyphs:
//   off (0) → muted bolt · L1 → white bolt + 2px accent outline · L2 → accent-filled bolt + outline.
// The level class (ge-turbo-0/1/2) drives the styling in shell.css; ≥2 caps at the L2 look.
function turboBtn(host: ShellHost, level: number): HTMLButtonElement {
  const b = iconBtn('turbo', 'turbo1', () => host.actions.cycleTurbo(), level > 0);
  b.classList.add(`ge-turbo-${Math.min(2, level)}`);
  return b;
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

export function renderBottomBar(host: ShellHost): HTMLElement {
  const { state, config } = host;
  const fmt = (n: number) => host.formatCurrency(n);
  const fmtWin = (n: number) => host.formatCurrency(n, true); // win / total-win: variable decimals
  const mobile = host.layout === 'mobile';
  const bar = document.createElement('div');
  bar.className = 'ge-shell-bottom';
  bar.dataset.geMode = state.mode;

  // menu icon button (always)
  const menu = iconBtn('menu', 'menu', () => host.actions.openMenu());

  // All three modes share the base plaque layout. FS/replay hide the controls that don't apply
  // and add Free Spins + Total Win blocks on the left; the per-spin WIN uses the base pill.
  const isBase = state.mode === 'base';
  const isFS = state.mode === 'freeSpins';
  // FS always shows the spins counter + accumulated Total Win (even €0); a replay shows them
  // only when it's a free-spins replay (freeSpins.total > 0).
  const showFsBlocks = isFS || (state.mode === 'replay' && state.freeSpins.total > 0);

  // Replay is a read-only historical round — there's no real balance to show, so hide it. Keyed on
  // the sticky `replay` flag (not `mode`) so it stays hidden through a replay's free-spins phase.
  const balance = state.replay
    ? null
    : readout('balance', host.t('Balance'), fmt(state.balance));
  // With a feature active (e.g. Ante) the BET readout shows the effective stake, tinted with
  // the feature accent; the base state.bet is unchanged and returns once the feature is off.
  const feature = state.activeFeature;
  const betShown = feature ? state.bet * feature.priceMultiplier : state.bet;
  const betValue = readout('bet-value', host.t('Bet'), fmt(betShown));
  if (feature) {
    const accent = effectiveAccent(feature);
    betValue.classList.add('ge-bet-feature');
    betValue.style.color = accent;
    // tint the "BET" label too (its .ge-lbl colour is set in CSS, so override inline)
    const lbl = betValue.querySelector('.ge-lbl') as HTMLElement | null;
    if (lbl) lbl.style.color = accent;
  }
  const turbo = config.features.turbo > 0 ? turboBtn(host, state.turbo) : null;

  // interactive controls — base mode only
  let betDown: HTMLElement | null = null, betUp: HTMLElement | null = null;
  let spin: HTMLElement | null = null, auto: HTMLElement | null = null, buy: HTMLElement | null = null;
  if (isBase) {
    betDown = iconBtn('bet-down', 'minus', () => host.actions.stepBet(-1));
    betUp = iconBtn('bet-up', 'plus', () => host.actions.stepBet(1));
    betValue.classList.add('ge-betbtn');                       // tap the stake → bet picker
    betValue.addEventListener('click', () => { if (!betLocked(host)) host.actions.openBetPicker(); });
    spin = spinButton(host);
    auto = config.features.autoplay ? autoButton(host) : null;
    buy = (config.features.buyBonus !== false || config.onBonusBuy) ? buyBtn(host) : null;
  }

  const winEl = state.win > 0 ? readout('win', host.t('Win'), fmtWin(state.win)) : null;
  // FS/replay left blocks: spins counter + accumulated Total Win (shown even at €0).
  // current = number → "current / total"; current = null/undefined → just the (game-driven) total.
  const fs = state.freeSpins;
  const fsText = fs.current == null ? `${fs.total}` : `${fs.current} / ${fs.total}`;
  // In FS the spins counter takes the SPIN slot as a rectangular hero plaque (same white/black-ring
  // style as the SPIN disc); Total Win stays an inline readout.
  const fsHero = showFsBlocks ? fsHeroPlaque(host, fsText) : null;
  const fsTotalWin = showFsBlocks ? readout('fs-totalwin', host.t('Total win'), fmtWin(fs.totalWin)) : null;
  // The hero in the centre/spin position: SPIN in base, the FS counter in free spins, nothing else.
  const hero = isBase ? spin : fsHero;

  if (mobile) {
    // Two levels:
    //   1) controls bar — [menu · auto · SPIN-or-FS · Total Win · turbo · buy]
    //   2) a small info pill below — [balance · − bet + · win]
    bar.appendChild(plaque('ge-m-controls', compact([menu, auto, hero, fsTotalWin, turbo, buy])));
    const betGroup = plaque('ge-m-betgroup', compact([betDown, betValue, betUp]));
    // WIN always occupies its slot (shows €0 between wins) so the pill never reflows on win↔0.
    const mWin = readout('win', host.t('Win'), fmtWin(state.win));
    bar.appendChild(plaque('ge-m-info', compact([balance, betGroup, mWin])));
  } else {
    // DESKTOP: BUY BONUS floats OUTSIDE, to the left of one continuous dark bar panel.
    // LEFT (all the info): [menu] · [balance] · [Total Win] · [WIN]
    // (Total Win only in FS / a fs replay; WIN only when there's a win this spin)
    const left = zone('ge-zone-left', ...compact([menu, balance, fsTotalWin, winEl]));

    // RIGHT (the controls): [bet (+ step)] · |divider| · [auto · SPIN-or-FS · turbo]
    const betKids: HTMLElement[] = [betValue];
    if (betUp && betDown) {
      const step = document.createElement('div'); step.className = 'ge-betstep'; step.append(betUp, betDown);
      betKids.push(step);
    }
    const betGroup = plaque('ge-betgroup', betKids);
    const divider = document.createElement('div'); divider.className = 'ge-pl-divider';
    const spinWrap = document.createElement('div'); spinWrap.className = 'ge-spinwrap';
    spinWrap.append(...compact([auto, hero, turbo]));
    const right = zone('ge-zone-right', betGroup, divider, spinWrap);

    // One continuous dark panel: info group hard-left, controls hard-right (space-between).
    // BUY BONUS sits to its left, outside the panel.
    const panel = plaque('ge-bar-panel', [left, right]);
    bar.append(...compact([buy, panel]));
  }

  applyBusy(host, bar);
  return bar;
}

/** Free-spins hero plaque — takes the SPIN slot in FS: same white disc/black-ring language as SPIN,
 *  but a rounded RECTANGLE showing the spins counter ("3 / 10"). */
function fsHeroPlaque(host: ShellHost, text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'ge-fs-hero'; el.dataset.ge = 'fs-counter';
  const lbl = document.createElement('span'); lbl.className = 'ge-fs-lbl'; lbl.textContent = host.t('Free spins');
  const num = document.createElement('span'); num.className = 'ge-fs-num'; num.textContent = text;
  el.append(lbl, num);
  return el;
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

function buyBtn(host: ShellHost): HTMLButtonElement {
  const buy = document.createElement('button');
  buy.className = 'ge-shell-buybonus'; buy.dataset.ge = 'buybonus';
  const feature = host.state.activeFeature;
  if (feature) {
    // A feature is active → this button turns into DISABLE (tinted with the feature accent).
    const accent = effectiveAccent(feature);
    buy.classList.add('ge-disable');
    buy.innerHTML = `<span>${host.t('DISABLE')}</span>`;
    buy.style.background = accent; buy.style.color = contrastText(accent);
    buy.addEventListener('click', () => { if (!buy.disabled) host.actions.deactivateFeature(); });
  } else {
    // Ticket icon (no text); keep the label for screen readers.
    buy.setAttribute('aria-label', host.t('BUY BONUS'));
    buy.innerHTML = `<span class="ge-bb-tk">${icon('ticket')}</span>`;
    buy.addEventListener('click', () => { if (!buy.disabled) host.actions.openBuyBonus(); });
  }
  return buy;
}

function betLocked(host: ShellHost): boolean {
  return host.state.busy || host.state.autoplay.active;
}

/** SPIN disc — rotates while busy; becomes a STOP + countdown while autoplay runs. */
function spinButton(host: ShellHost): HTMLButtonElement {
  const { state } = host;
  const sp = document.createElement('button');
  sp.className = 'ge-shell-spin'; sp.dataset.ge = 'spin';
  if (state.autoplay.active) {
    sp.classList.add('ge-stop');
    const rem = state.autoplay.remaining;
    const label = Number.isFinite(rem) ? String(rem) : '∞';
    sp.innerHTML = `<span class="ge-spin-stop">${icon('stop')}</span><span class="ge-spin-count">${label}</span>`;
    sp.addEventListener('click', () => { if (!sp.disabled) host.actions.stopAutoplay(); });
  } else {
    sp.innerHTML = icon('spin');
    if (state.busy) sp.classList.add('ge-spinning');
    sp.addEventListener('click', () => { if (!sp.disabled) host.actions.spin(); });
  }
  return sp;
}

/** Autoplay icon button — opens the count picker; glows accent while running. */
function autoButton(host: ShellHost): HTMLButtonElement {
  const active = host.state.autoplay.active;
  const b = iconBtn('autoplay', 'autoplay', () => onAutoplay(host), active);
  if (active) b.classList.add('ge-glow');
  return b;
}

function onAutoplay(host: ShellHost): void {
  if (host.state.autoplay.active) host.actions.stopAutoplay();
  else host.actions.openAutoplayPicker();
}

function applyBusy(host: ShellHost, bar: HTMLElement): void {
  const { busy } = host.state;
  const auto = host.state.autoplay.active;
  const lockBet = busy || auto;
  const disable = (ge: string, off: boolean) => {
    const el = bar.querySelector(`[data-ge="${ge}"]`) as HTMLButtonElement | null;
    if (el) el.disabled = off;
  };
  // also disable the stepper that's already at the end of the bet range
  const i = host.state.availableBets.indexOf(host.state.bet);
  disable('bet-up', lockBet || i >= host.state.availableBets.length - 1);
  disable('bet-down', lockBet || i <= 0);
  disable('spin', busy && !auto);     // keep the STOP disc clickable through autoplay
  disable('autoplay', busy && !auto); // keep autoplay (stop) clickable through autoplay
  const betVal = bar.querySelector('[data-ge="bet-value"]') as HTMLElement | null;
  if (betVal) betVal.classList.toggle('ge-disabled', lockBet);
  const buy = bar.querySelector('[data-ge="buybonus"]') as HTMLButtonElement | null;
  // disabled for the whole autoplay run (not just per-spin busy) so it doesn't flicker/pulse
  if (buy) buy.disabled = busy || auto || !host.state.buyBonusEnabled;
}
