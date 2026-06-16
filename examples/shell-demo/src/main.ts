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
  { id: 'popout-s', label: 'Popout S', width: 480, height: 270 },
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
const state = { balance: 10_000_000_000, win: 1_000_000, bet: 1_000_000, busy: false };

const gameEl = document.getElementById('game') as HTMLElement;
const labelEl = document.getElementById('device-label') as HTMLElement;
const toolbarEl = document.getElementById('toolbar') as HTMLElement;
const logEl = document.getElementById('log') as HTMLElement;

let currentScreen = SCREENS[0];
let currentMode: ShellMode = 'base';
let currentTheme: 'dark' | 'light' = 'light';
let isSocial = false;

function log(msg: string): void {
  const line = document.createElement('div');
  line.textContent = `▸ ${msg}`;
  logEl.prepend(line);
  while (logEl.childElementCount > 60) logEl.lastElementChild?.remove();
}

// ─── Create the shell (single source of truth = this demo's `state`) ───────
const shell: GameShell = createGameShell({
  mount: gameEl,
  theme: { scheme: currentTheme, accent: 'red' },
  language: 'en',
  isSocial,
  currency: { symbol: '€', position: 'left' },
  availableBets: AVAILABLE_BETS,
  defaultBet: state.bet,
  currentBet: null,
  balance: state.balance,
  win: state.win,
  mode: currentMode,
  gameInfo: {
    sections: [
      {
        type: 'modes',
        modes: [
          { title: 'Base game', price: '1× bet', rtp: 96.5, maxWin: '5,000×', description: 'Match symbols left to right on adjacent reels.' },
          { title: 'Bonus Buy', price: '100× bet', rtp: 96.8, maxWin: '10,000×', description: 'Buy direct entry into the Free Spins round.' },
        ],
      },
      { type: 'controls' },
      {
        type: 'paytable',
        rows: [
          { symbol: { text: 'Wild' }, wins: [{ count: '5', multiplier: 250 }, { count: '4', multiplier: 100 }, { count: '3', multiplier: 50 }] },
          { symbol: { text: 'Scatter' }, wins: [{ count: '3+', multiplier: 20 }] },
          { symbol: { text: 'Royal A' }, wins: [{ count: '5', multiplier: 100 }, { count: '4–5', multiplier: 40 }, { count: '3', multiplier: 15 }] },
        ],
      },
      {
        type: 'wins',
        kind: 'classic',
        grid: { cols: 5, rows: 3 },
        lines: [
          [1, 1, 1, 1, 1],
          [0, 0, 0, 0, 0],
          [2, 2, 2, 2, 2],
          [0, 1, 2, 1, 0],
          [2, 1, 0, 1, 2],
        ],
      },
      {
        type: 'wins',
        kind: 'cluster',
        grid: { cols: 6, rows: 5 },
        minCount: 5,
        description: 'Win when 5 or more matching symbols connect horizontally or vertically.',
      },
      {
        type: 'wins',
        kind: 'anywhere',
        grid: { cols: 6, rows: 5 },
        minCount: 5,
        description: 'Win when 5 or more matching symbols connect horizontally or vertically.',
      },
      {
        type: 'wins',
        kind: 'ways',
        grid: { cols: 5, rows: 4 },
        description: '1024 ways — pays for matching symbols on adjacent reels, left to right.',
      },
      { type: 'custom', title: 'Rules', html: '<p>Match symbols left to right on adjacent reels starting from the leftmost reel. All wins are multiplied by the bet.</p>' },
    ],
  },
  features: {
    turbo: 3,
    autoplay: {},
    buyBonus: [
      { id: 'ante', type: 'feature', title: 'Ante Bet', description: '+25% to trigger frequency', priceMultiplier: 1.25, volatility: 2 },
      { id: 'boost', type: 'feature', title: 'Reel Boost', description: 'Boosted reels for the next 5 spins', priceMultiplier: 5, volatility: 3 },
      { id: 'fs', type: 'bonus', title: 'Buy Free Spins', description: '10 free spins, instant', priceMultiplier: 100, volatility: 5 },
      { id: 'superfs', type: 'bonus', title: 'Super Free Spins', description: '15 free spins with a guaranteed wild', priceMultiplier: 250, volatility: 4 },
      { id: 'hunt', type: 'bonus', title: 'Bonus Hunt', description: 'Improved odds of triggering a feature', priceMultiplier: 500, volatility: 3 },
      { id: 'max', type: 'bonus', title: 'Max Bonus', description: 'Guaranteed top feature entry', priceMultiplier: 15000, volatility: 5 },
    ],
  },
});

// ─── Wire shell → game ─────────────────────────────────────────────────────
const auto = { active: false, remaining: 0 };

function runSpin(): void {
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
    // autoplay: decrement and queue the next spin until the count runs out
    if (auto.active) {
      if (Number.isFinite(auto.remaining)) auto.remaining -= 1;
      if (!Number.isFinite(auto.remaining) || auto.remaining > 0) {
        shell.setAutoplay({ active: true, remaining: auto.remaining });
        window.setTimeout(runSpin, 350);
      } else {
        auto.active = false;
        shell.setAutoplay({ active: false, remaining: 0 });
        log('autoplay done');
      }
    }
  }, 850);
}

shell.on('spin', runSpin);

shell.on('betChange', (bet) => { state.bet = bet; log(`bet → €${bet.toFixed(2)}`); });
shell.on('turboChange', (level) => log(`turbo → L${level}`));
shell.on('autoplayStart', (o) => { auto.active = true; auto.remaining = o.remaining; log(`autoplay start (${o.remaining})`); runSpin(); });
shell.on('autoplayStop', () => { auto.active = false; log('autoplay stop'); });
shell.on('buyBonusSelect', ({ id }) => log(`buy bonus → ${id}`));
shell.on('featureActivate', ({ id }) => log(`feature on → ${id}`));
shell.on('featureDeactivate', ({ id }) => log(`feature off → ${id}`));
shell.on('menuOpen', () => log('menu opened'));
shell.on('settingsOpen', () => log('settings opened'));
shell.on('infoOpen', () => log('game info opened'));
shell.on('settingChange', ({ key, value }) => log(`setting ${key} = ${value}`));

// ─── Mode switching (drives the 3 bottom-bar variants) ─────────────────────
function applyMode(mode: ShellMode): void {
  currentMode = mode;
  shell.setMode(mode);
  if (mode === 'freeSpins') {
    shell.setFreeSpins({ current: 3, total: 10, totalWin: state.bet * 12 });
  }
  log(`mode → ${mode}`);
  renderToolbar();
}

// ─── Theme switching (dark / light scheme) ─────────────────────────────────
function applyTheme(t: 'dark' | 'light'): void {
  currentTheme = t;
  shell.setTheme({ scheme: t });
  gameEl.classList.toggle('light', t === 'light');
  log(`theme → ${t}`);
  renderToolbar();
}

// ─── Language (English / social-casino vocabulary) ─────────────────────────
function applySocial(social: boolean): void {
  isSocial = social;
  shell.setSocial(social);
  log(`social = ${social} (reopen overlays to refresh them)`);
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
    group(
      'Theme',
      (['dark', 'light'] as const).map((t) =>
        chip(t === 'dark' ? 'Dark' : 'Light', null, t === currentTheme, () => applyTheme(t))),
    ),
  );

  toolbarEl.appendChild(
    group('Language', [
      chip('English', null, !isSocial, () => applySocial(false)),
      chip('Social', null, isSocial, () => applySocial(true)),
    ]),
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
      chip('Replay modal', null, false, () => {
        shell.openReplay({
          bonusId: 'fs',
          bet: state.bet,
          payoutMultiplier: 87.5,
          onReplay: () => log('▶ replay started (onReplay)'),
        });
      }),
    ]),
  );
}

// ─── Boot ──────────────────────────────────────────────────────────────────
applyScreen(currentScreen);
gameEl.classList.toggle('light', currentTheme === 'light');
renderToolbar();
log('shell mounted');

// ─── Debug/QA params: ?screen=<id>&kiosk=1&open=settings|info|buybonus ──────
const params = new URLSearchParams(location.search);
const screenParam = params.get('screen');
if (screenParam) { const s = SCREENS.find((x) => x.id === screenParam); if (s) applyScreen(s); }
if (params.get('kiosk')) {
  document.querySelector('header')?.remove();
  document.querySelector('.toolbar')?.remove();
  document.querySelector('.log')?.remove();
  const stage = document.querySelector('.stage') as HTMLElement | null;
  if (stage) stage.style.padding = '0';
  labelEl.style.display = 'none';
  gameEl.style.width = '100vw'; gameEl.style.height = '100vh'; gameEl.style.borderRadius = '0';
}
const open = params.get('open');
if (open === 'settings') shell.openSettings();
else if (open === 'info') shell.openInfo();
else if (open === 'buybonus') shell.openBuyBonus();
