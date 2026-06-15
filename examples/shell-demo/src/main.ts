import { createGameShell } from '@energy8platform/platform-core/shell';
import type { GameShell, ShellMode } from '@energy8platform/platform-core/shell';

// ─── Screen presets (game viewport sizes, width × height) ──────────────────
interface ScreenPreset {
  id: string;
  label: string;
  width: number;
  height: number;
}

const SCREENS: ScreenPreset[] = [
  { id: 'desktop', label: 'Desktop', width: 1200, height: 675 },
  { id: 'laptop', label: 'Laptop', width: 1024, height: 576 },
  { id: 'popout-s', label: 'Popout S', width: 400, height: 225 },
  { id: 'popout-l', label: 'Popout L', width: 800, height: 450 },
  { id: 'mobile-l', label: 'Mobile L', width: 452, height: 812 },
  { id: 'mobile-m', label: 'Mobile M', width: 375, height: 667 },
  { id: 'mobile-s', label: 'Mobile S', width: 320, height: 568 },
];

const MODES: { id: ShellMode; label: string }[] = [
  { id: 'base', label: 'Base' },
  { id: 'freeSpins', label: 'Free spins' },
  { id: 'replay', label: 'Replay' },
];

// ─── Local game economy (the game owns all state; shell only displays it) ──
const AVAILABLE_BETS = [0.2, 0.5, 1, 2, 5];
const state = { balance: 1000, win: 0, bet: 1, busy: false };

const gameEl = document.getElementById('game') as HTMLElement;
const labelEl = document.getElementById('device-label') as HTMLElement;
const toolbarEl = document.getElementById('toolbar') as HTMLElement;
const logEl = document.getElementById('log') as HTMLElement;

let currentScreen = SCREENS[0];
let currentMode: ShellMode = 'base';

function log(msg: string): void {
  const line = document.createElement('div');
  line.textContent = `▸ ${msg}`;
  logEl.prepend(line);
  while (logEl.childElementCount > 60) logEl.lastElementChild?.remove();
}

// ─── Create the shell (single source of truth = this demo's `state`) ───────
const shell: GameShell = createGameShell({
  mount: gameEl,
  language: 'en',
  currency: { symbol: '€', position: 'left' },
  availableBets: AVAILABLE_BETS,
  defaultBet: state.bet,
  currentBet: null,
  balance: state.balance,
  win: state.win,
  mode: currentMode,
  gameInfo: {
    rtp: 96.5,
    rules: 'Match symbols left to right on adjacent reels to win.',
    symbols: [
      { name: 'Wild', payouts: '5× = 250' },
      { name: 'Scatter', payouts: '3+ triggers Free Spins' },
      { name: 'Royal A', payouts: '5× = 100' },
    ],
    features: [
      { name: 'Free Spins', description: '3 scatters award 10 free spins with rising multipliers.' },
      { name: 'Buy Bonus', description: 'Buy direct entry into a bonus round for a fixed cost.' },
    ],
  },
  features: {
    turbo: 3,
    autoplay: true,
    buyBonus: [
      { id: 'ante', name: 'Ante Bet', description: '+25% to trigger frequency', priceMultiplier: 1.25, volatility: 2, accentColor: '#38bdf8' },
      { id: 'bonus', name: 'Buy Free Spins', description: '10 free spins, instant', priceMultiplier: 100, volatility: 5, accentColor: '#f59e0b' },
    ],
  },
});

// ─── Wire shell → game ─────────────────────────────────────────────────────
shell.on('spin', () => {
  if (state.busy || currentMode !== 'base') return;
  state.busy = true;
  shell.setBusy(true);
  state.balance -= state.bet;
  shell.setBalance(state.balance);
  shell.setWin(0);
  log(`spin @ €${state.bet.toFixed(2)}`);
  window.setTimeout(() => {
    // toy outcome: ~35% chance of a win between 1× and 20× the bet
    const win = Math.floor(Math.random() * 100) < 35 ? state.bet * (1 + Math.floor(Math.random() * 20)) : 0;
    state.win = win;
    state.balance += win;
    shell.setWin(win);
    shell.setBalance(state.balance);
    state.busy = false;
    shell.setBusy(false);
    log(win > 0 ? `win €${win.toFixed(2)}` : 'no win');
  }, 850);
});

shell.on('betChange', (bet) => { state.bet = bet; log(`bet → €${bet.toFixed(2)}`); });
shell.on('turboChange', (level) => log(`turbo → L${level}`));
shell.on('autoplayStart', (o) => log(`autoplay start (${o.remaining})`));
shell.on('autoplayStop', () => log('autoplay stop'));
shell.on('buyBonusSelect', ({ id }) => log(`buy bonus → ${id}`));
shell.on('menuOpen', () => log('menu opened'));
shell.on('settingsOpen', () => log('settings opened'));
shell.on('infoOpen', () => log('game info opened'));
shell.on('settingChange', ({ key, value }) => log(`setting ${key} = ${value}`));

// ─── Mode switching (drives the 3 bottom-bar variants) ─────────────────────
function applyMode(mode: ShellMode): void {
  currentMode = mode;
  shell.setMode(mode);
  if (mode === 'freeSpins') {
    shell.setFreeSpins({ current: 3, total: 10, totalWin: state.bet * 12, lastWin: state.bet * 4 });
  }
  log(`mode → ${mode}`);
  renderToolbar();
}

// ─── Screen preset switching (resizes the game viewport; shell follows) ────
function applyScreen(screen: ScreenPreset): void {
  currentScreen = screen;
  gameEl.style.width = `${screen.width}px`;
  gameEl.style.height = `${screen.height}px`;
  labelEl.innerHTML = `<b>${screen.label}</b> — ${screen.width} × ${screen.height}`;
  renderToolbar();
}

// ─── Toolbar ───────────────────────────────────────────────────────────────
function chip(label: string, sub: string | null, pressed: boolean, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'chip';
  b.setAttribute('aria-pressed', String(pressed));
  b.innerHTML = sub ? `${label}<small>${sub}</small>` : label;
  b.addEventListener('click', onClick);
  return b;
}

function group(title: string, children: HTMLElement[]): HTMLElement {
  const g = document.createElement('div');
  g.className = 'group';
  const t = document.createElement('span');
  t.textContent = title;
  const row = document.createElement('div');
  row.className = 'row';
  row.append(...children);
  g.append(t, row);
  return g;
}

function renderToolbar(): void {
  toolbarEl.innerHTML = '';

  toolbarEl.appendChild(
    group(
      'Screen',
      SCREENS.map((s) =>
        chip(s.label, `${s.width}×${s.height}`, s.id === currentScreen.id, () => applyScreen(s)),
      ),
    ),
  );

  toolbarEl.appendChild(
    group(
      'Bottom-bar mode',
      MODES.map((m) => chip(m.label, null, m.id === currentMode, () => applyMode(m.id))),
    ),
  );

  toolbarEl.appendChild(
    group('Actions', [
      chip('Add €10 win', null, false, () => {
        state.win += 10;
        state.balance += 10;
        shell.setWin(state.win);
        shell.setBalance(state.balance);
        log('+€10 win (manual)');
      }),
      chip('Toggle busy', null, false, () => {
        state.busy = !state.busy;
        shell.setBusy(state.busy);
        log(`busy = ${state.busy}`);
      }),
      chip('Reset balance', null, false, () => {
        state.balance = 1000;
        state.win = 0;
        shell.setBalance(state.balance);
        shell.setWin(state.win);
        log('balance reset to €1000');
      }),
    ]),
  );
}

// ─── Boot ──────────────────────────────────────────────────────────────────
applyScreen(currentScreen);
renderToolbar();
log('shell mounted');
