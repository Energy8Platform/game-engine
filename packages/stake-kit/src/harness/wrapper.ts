/**
 * Stake harness wrapper page (Component 3 — redesigned, Stake-style).
 *
 * `renderWrapperHtml(cfg)` returns a full standalone HTML document — vanilla
 * DOM, no framework — that frames the inner game in an `<iframe>` at a chosen
 * Stake screen preset and drives launch/relaunch from a **fixed bottom tab bar**
 * whose tabs (Settings · Screen · Replay) open popovers over the game, mirroring
 * Stake's ACP developer harness.
 *
 * Only controls our harness actually backs are built. Stake's Versions / Local
 * Testing / Language / Device Type / Open-in-New-Tab have no backing here and are
 * intentionally omitted; the game id + version are shown as a static brand chip.
 *
 * The inline `<script>` mirrors a minimal `buildLaunchUrl` + the screen presets
 * from ./bar.ts. bar.ts stays the unit-tested source of truth; the wrapper
 * duplicates the tiny helpers to avoid module-resolution friction in the served
 * HTML (no extra served-ESM dependency). Keep the two in sync.
 */

import { SCREEN_PRESETS } from './bar';
import { LANGS } from './langs';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface WrapperMode {
  name: string;
  cost: number;
  /**
   * Number of curated books (LUT rows) for the mode → valid Event IDs are
   * `0 … count-1`. Drives the Replay panel's "Event ID (Range: 0 – N)" hint.
   * 0 when unknown (legacy index) — the panel then shows a plain numeric input.
   */
  count: number;
}

export interface WrapperConfig {
  /** Game identifier (model.spec.id). */
  gameId: string;
  /** Math version string. Always '1' for the harness. */
  version: string;
  /** Curated modes from index.json (name + cost + count), or [] when no books. */
  modes: WrapperMode[];
  /** Bet levels in MAJOR units (e.g. [0.1, 1, 5]). */
  betLevelsMajor: number[];
  /** Available currencies (Object.keys(CURRENCY_META)). */
  currencies: string[];
  /**
   * RGS URL the iframe launches with (host + prefix, no scheme), e.g.
   * 'localhost:5173/__rgs'. RGSClient prepends the protocol.
   */
  rgsUrl: string;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderWrapperHtml(cfg: WrapperConfig): string {
  const hasBooks = cfg.modes.length > 0;
  const cfgJson = JSON.stringify(cfg);

  // Screen presets render as a vertical list of option buttons (each carries the
  // preset name so the "lists every screen preset" contract holds).
  const screenOptions = SCREEN_PRESETS.map(
    (p) =>
      `<button class="screen-opt" data-screen="${esc(p.name)}">${esc(p.name)} <small>${p.w}×${p.h}</small></button>`,
  ).join('');

  const BALANCE_LEVELS: { value: number; label: string }[] = [
    { value: 1, label: '1' },
    { value: 10, label: '10' },
    { value: 100, label: '100' },
    { value: 1_000, label: '1K' },
    { value: 10_000, label: '10K' },
    { value: 100_000, label: '100K' },
    { value: 1_000_000, label: '1M' },
    { value: 10_000_000, label: '10M' },
    { value: 100_000_000, label: '100M' },
    { value: 1_000_000_000, label: '1B' },
    { value: 10_000_000_000, label: '10B' },
  ];
  const DEFAULT_BALANCE = 10_000;

  const balanceOptions = BALANCE_LEVELS.map(
    (b) => `<option value="${b.value}"${b.value === DEFAULT_BALANCE ? ' selected' : ''}>${esc(b.label)}</option>`,
  ).join('');

  const DEFAULT_CURRENCY = 'EUR';
  const currencyOptions = cfg.currencies
    .map(
      (c) =>
        `<option value="${esc(c)}"${c === DEFAULT_CURRENCY ? ' selected' : ''}>${esc(c)}</option>`,
    )
    .join('');

  const DEFAULT_LANG = 'en';
  const langOptions = LANGS.map(
    (l) =>
      `<option value="${esc(l.code)}"${l.code === DEFAULT_LANG ? ' selected' : ''}>${esc(l.label)}</option>`,
  ).join('');

  const modeOptions = cfg.modes
    .map((m, i) => `<option value="${esc(m.name)}"${i === 0 ? ' selected' : ''}>${esc(m.name)}</option>`)
    .join('');

  // Replay Amount seeds to the smallest bet level (major units).
  const defaultAmount = cfg.betLevelsMajor.length ? Math.min(...cfg.betLevelsMajor) : 1;

  const disabledAttr = hasBooks ? '' : 'disabled';
  const replayTitle = hasBooks
    ? ''
    : 'title="No curated books — run `npm run dev` for the Lua flow"';

  // The inline driver mirrors bar.ts's buildLaunchUrl + SCREEN_PRESETS.
  const driver = `
const CFG = JSON.parse(document.getElementById('harness-config').textContent);
const SCREEN_PRESETS = ${JSON.stringify(SCREEN_PRESETS)};
const byId = (id) => document.getElementById(id);

function screenPreset(name) {
  return SCREEN_PRESETS.find((p) => p.name === name);
}

// Mirrors ./bar.ts buildLaunchUrl — keep in sync.
function buildLaunchUrl(opts) {
  const { rgsUrl, currency, social, lang = 'en', device = 'desktop', replay } = opts;
  if (replay) {
    // Thread currency/social/lang into the replay launch too — Stake's replay params accept them
    // and the bridge reads social for socialMode, so a replay must honour the harness toggle.
    const p = new URLSearchParams({
      replay: 'true',
      game: replay.game,
      version: replay.version,
      mode: replay.mode,
      event: String(replay.event),
      amount: String(replay.amount),
      currency,
      social: String(social),
      lang,
      rgs_url: rgsUrl,
    });
    return '?' + p.toString();
  }
  const p = new URLSearchParams({
    rgs_url: rgsUrl,
    sessionID: 'dev',
    currency,
    social: String(social),
    lang,
    device,
  });
  return '?' + p.toString();
}

const iframe = byId('game');
const balanceSel = byId('balance');
const currencySel = byId('currency');
const langSel = byId('lang');
const socialChk = byId('social');
const modeSel = byId('mode');
const roundInput = byId('round');
const amountInput = byId('amount');
const rangeHint = byId('range-hint');
const replayBtn = byId('replay');
const closeBtn = byId('close');

let currentScreen = 'Desktop';
let openPanel = null;

function applyScreen() {
  const p = screenPreset(currentScreen) || SCREEN_PRESETS[0];
  iframe.style.width = p.w + 'px';
  iframe.style.height = p.h + 'px';
}

// ── Tab popovers ────────────────────────────────────────────────────────────
function positionPopover(name) {
  const tab = document.querySelector('.tab[data-panel="' + name + '"]');
  const pop = byId('pop-' + name);
  if (!tab || !pop) return;
  const r = tab.getBoundingClientRect();
  const barH = byId('bar').offsetHeight;
  pop.style.bottom = (barH + 10) + 'px';
  const popW = pop.offsetWidth;
  let left = r.left;
  const maxLeft = window.innerWidth - popW - 12;
  if (left > maxLeft) left = maxLeft;
  if (left < 12) left = 12;
  pop.style.left = left + 'px';
}

function closePanels() {
  openPanel = null;
  document.querySelectorAll('.popover').forEach((p) => (p.hidden = true));
  document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
}

function togglePanel(name) {
  if (openPanel === name) { closePanels(); return; }
  closePanels();
  const pop = byId('pop-' + name);
  if (!pop) return;
  pop.hidden = false; // show before measuring for positioning
  openPanel = name;
  const tab = document.querySelector('.tab[data-panel="' + name + '"]');
  if (tab) tab.classList.add('active');
  positionPopover(name);
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', (e) => {
    e.stopPropagation();
    if (tab.disabled) return;
    togglePanel(tab.dataset.panel);
  });
});

// Outside-click / Esc close the open popover (clicks inside it are ignored).
document.addEventListener('click', (e) => {
  if (!openPanel) return;
  const pop = byId('pop-' + openPanel);
  if (pop && pop.contains(e.target)) return;
  closePanels();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePanels();
});
window.addEventListener('resize', () => {
  if (openPanel) positionPopover(openPanel);
});

// ── Screen ──────────────────────────────────────────────────────────────────
document.querySelectorAll('.screen-opt').forEach((opt) => {
  opt.addEventListener('click', () => {
    currentScreen = opt.dataset.screen;
    applyScreen();
    document.querySelectorAll('.screen-opt').forEach((o) => o.classList.toggle('active', o === opt));
    closePanels();
  });
});

// ── Settings ────────────────────────────────────────────────────────────────
currencySel.addEventListener('change', async () => {
  await fetch('/__rgs/__dev/currency?code=' + currencySel.value);
  launchNormal();
});
if (balanceSel) {
  balanceSel.addEventListener('change', async () => {
    const major = Number(balanceSel.value);
    await fetch('/__rgs/__dev/balance?major=' + major);
    launchNormal();
  });
}
socialChk.addEventListener('change', launchNormal);
if (langSel) langSel.addEventListener('change', launchNormal);

// ── Replay ──────────────────────────────────────────────────────────────────
function updateRange() {
  if (!modeSel || !rangeHint) return;
  const m = (CFG.modes || []).find((x) => x.name === modeSel.value);
  const n = m && m.count ? m.count : 0;
  if (n > 0) {
    rangeHint.textContent = '(Range: 0 – ' + (n - 1) + ')';
    if (roundInput) roundInput.max = String(n - 1);
  } else {
    rangeHint.textContent = '';
    if (roundInput) roundInput.removeAttribute('max');
  }
}
if (modeSel) modeSel.addEventListener('change', updateRange);

function launchNormal() {
  iframe.src = buildLaunchUrl({
    rgsUrl: CFG.rgsUrl,
    currency: currencySel.value,
    social: socialChk.checked,
    lang: langSel ? langSel.value : 'en',
  });
}

function launchReplay() {
  const event = Number(roundInput.value);
  iframe.src = buildLaunchUrl({
    rgsUrl: CFG.rgsUrl,
    currency: currencySel.value,
    social: socialChk.checked,
    lang: langSel ? langSel.value : 'en',
    replay: {
      game: CFG.gameId,
      version: CFG.version,
      mode: modeSel.value,
      event: Number.isFinite(event) ? event : 0,
      amount: Number(amountInput.value) * 1_000_000,
    },
  });
  closePanels();
}

if (replayBtn) replayBtn.addEventListener('click', launchReplay);
if (closeBtn) closeBtn.addEventListener('click', () => { launchNormal(); closePanels(); });

// Initial: Desktop / EUR / social off → normal launch.
applyScreen();
updateRange();
launchNormal();
const defScreen = document.querySelector('.screen-opt[data-screen="Desktop"]');
if (defScreen) defScreen.classList.add('active');
`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Stake Harness — ${esc(cfg.gameId)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    background: #0b0d10;
    color: #e6e8eb;
    font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  /* The stage fills the window minus the fixed bar's height, centering the iframe. */
  #stage {
    position: fixed;
    inset: 0 0 56px 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: auto;
    padding: 24px;
  }
  #game {
    flex: 0 0 auto;
    border: 1px solid #1e232b;
    border-radius: 10px;
    background: #000;
    box-shadow: 0 12px 48px rgba(0,0,0,0.55);
  }
  /* ── bottom tab bar ─────────────────────────────────────────────── */
  #bar {
    position: fixed;
    left: 0; right: 0; bottom: 0;
    height: 56px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 18px;
    background: linear-gradient(180deg, #14171c 0%, #0e1115 100%);
    border-top: 1px solid #232a33;
    box-shadow: 0 -10px 30px rgba(0,0,0,0.4);
    z-index: 50;
    font-size: 13px;
  }
  #brand { font-weight: 700; letter-spacing: 0.02em; color: #eef1f5; margin-right: 6px; white-space: nowrap; }
  #brand small { font-weight: 500; color: #6b7480; letter-spacing: 0; }
  .tabs { display: flex; align-items: center; gap: 2px; }
  .tab {
    background: transparent;
    border: 0;
    color: #99a2af;
    padding: 8px 14px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: color 0.12s, background 0.12s;
  }
  .tab:hover { color: #e6e8eb; background: rgba(255,255,255,0.04); }
  .tab.active { color: #fff; background: rgba(91,141,239,0.16); }
  .tab:disabled { color: #4b525c; cursor: not-allowed; }
  /* ── popovers ───────────────────────────────────────────────────── */
  .popover {
    position: fixed;
    z-index: 60;
    min-width: 248px;
    max-width: 340px;
    background: #13161b;
    border: 1px solid #262b33;
    border-radius: 12px;
    box-shadow: 0 14px 44px rgba(0,0,0,0.6);
    padding: 12px;
  }
  .popover[hidden] { display: none; }
  .cap {
    display: block;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #828b98;
    margin-bottom: 6px;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 9px 6px;
  }
  .row + .row { border-top: 1px solid #1d222a; }
  .row .cap { margin: 0; }
  select, input[type=number] {
    background: #1c2128;
    color: #e9ecf1;
    border: 1px solid #3a414c;
    border-radius: 8px;
    padding: 7px 10px;
    font-size: 13px;
    font-weight: 600;
    font-family: inherit;
    transition: border-color 0.12s, background 0.12s;
  }
  select:hover, input[type=number]:hover { border-color: #4b5563; }
  select:focus, input[type=number]:focus { outline: none; border-color: #3b82f6; background: #20262f; }
  /* switch-style Social Mode toggle */
  .switch { position: relative; display: inline-block; width: 40px; height: 22px; flex: 0 0 auto; }
  .switch input { opacity: 0; width: 0; height: 0; }
  .slider { position: absolute; inset: 0; background: #2b313a; border-radius: 22px; cursor: pointer; transition: background 0.15s; }
  .slider::before {
    content: ''; position: absolute; width: 16px; height: 16px; left: 3px; top: 3px;
    background: #fff; border-radius: 50%; transition: transform 0.15s;
  }
  .switch input:checked + .slider { background: #3b82f6; }
  .switch input:checked + .slider::before { transform: translateX(18px); }
  /* screen preset list */
  .screen-list { display: flex; flex-direction: column; gap: 2px; }
  .screen-opt {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    background: transparent; border: 0; color: #d3d8df;
    padding: 9px 11px; border-radius: 8px;
    font-size: 13px; font-weight: 600; font-family: inherit;
    text-align: left; cursor: pointer;
  }
  .screen-opt small { color: #828b98; font-weight: 500; }
  .screen-opt:hover { background: #1c2128; }
  .screen-opt.active { background: #2f6bff; color: #fff; }
  .screen-opt.active small { color: #d8e2ff; }
  /* replay panel */
  .popover.replay { min-width: 288px; }
  .field { margin-bottom: 12px; }
  .field .cap em { font-style: normal; color: #5f6772; font-weight: 600; text-transform: none; letter-spacing: 0; }
  .field select, .field input { width: 100%; }
  button.primary {
    width: 100%;
    background: linear-gradient(180deg, #3b82f6 0%, #2563eb 100%);
    color: #fff; border: 0; border-radius: 9px; padding: 11px;
    font-size: 14px; font-weight: 700; font-family: inherit; cursor: pointer;
    transition: filter 0.12s, transform 0.06s;
  }
  button.primary:hover { filter: brightness(1.08); }
  button.primary:active { transform: translateY(1px); }
  button.primary:disabled { cursor: not-allowed; opacity: 0.45; filter: none; }
  button.link-danger {
    width: 100%; background: transparent; border: 0; color: #e5616b;
    padding: 10px; margin-top: 4px;
    font-size: 13px; font-weight: 600; font-family: inherit; cursor: pointer;
  }
  button.link-danger:hover { color: #ef7681; }
  button.link-danger:disabled { color: #6b3a3e; cursor: not-allowed; }
</style>
</head>
<body>
  <script type="application/json" id="harness-config">${cfgJson}</script>
  <div id="stage">
    <iframe id="game" title="game"></iframe>
  </div>
  <div id="bar">
    <span id="brand">${esc(cfg.gameId)} <small>· v${esc(cfg.version)}</small></span>
    <div class="tabs">
      <button class="tab" data-panel="settings">Settings</button>
      <button class="tab" data-panel="screen">Screen</button>
      <button class="tab" data-panel="replay" data-disabled="${!hasBooks}" ${disabledAttr} ${replayTitle}>Replay</button>
    </div>
  </div>

  <div class="popover" id="pop-settings" hidden>
    <div class="row"><span class="cap">Balance</span><select id="balance">${balanceOptions}</select></div>
    <div class="row"><span class="cap">Currency</span><select id="currency">${currencyOptions}</select></div>
    <div class="row">
      <span class="cap">Social Mode</span>
      <label class="switch"><input type="checkbox" id="social" /><span class="slider"></span></label>
    </div>
    <div class="row"><span class="cap">Language</span><select id="lang">${langOptions}</select></div>
  </div>

  <div class="popover" id="pop-screen" hidden>
    <div class="screen-list">${screenOptions}</div>
  </div>

  <div class="popover replay" id="pop-replay" hidden>
    <div class="field">
      <span class="cap">Game Mode</span>
      <select id="mode" ${disabledAttr}>${modeOptions}</select>
    </div>
    <div class="field">
      <span class="cap">Event ID <em id="range-hint"></em></span>
      <input type="number" id="round" min="0" value="0" ${disabledAttr} />
    </div>
    <div class="field">
      <span class="cap">Amount</span>
      <input type="number" id="amount" min="0" step="any" value="${defaultAmount}" ${disabledAttr} />
    </div>
    <button class="primary" id="replay" ${disabledAttr}>Play Event</button>
    <button class="link-danger" id="close" ${disabledAttr}>Close Replay</button>
  </div>

  <script type="module">${driver}</script>
</body>
</html>`;
}
