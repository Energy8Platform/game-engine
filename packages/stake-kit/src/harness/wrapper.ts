/**
 * Stake harness wrapper page (Component 3).
 *
 * `renderWrapperHtml(cfg)` returns a full standalone HTML document — vanilla
 * DOM, no framework — that frames the inner game in an `<iframe>` at a chosen
 * Stake screen preset and drives launch/relaunch via a bottom control bar.
 *
 * The inline `<script>` mirrors a minimal `buildLaunchUrl` + the screen presets
 * from ./bar.ts. bar.ts stays the unit-tested source of truth; the wrapper
 * duplicates the tiny helpers to avoid module-resolution friction in the served
 * HTML (no extra served-ESM dependency). Keep the two in sync.
 */

import { SCREEN_PRESETS } from './bar';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface WrapperMode {
  name: string;
  cost: number;
}

export interface WrapperConfig {
  /** Game identifier (model.spec.id). */
  gameId: string;
  /** Math version string. Always '1' for the harness. */
  version: string;
  /** Curated modes from index.json (name + cost), or [] when no books. */
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

  const screenOptions = SCREEN_PRESETS.map(
    (p) => `<option value="${esc(p.name)}">${esc(p.name)} (${p.w}×${p.h})</option>`,
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

  const modeOptions = cfg.modes
    .map((m) => `<option value="${esc(m.name)}">${esc(m.name)}</option>`)
    .join('');

  const betOptions = cfg.betLevelsMajor
    .map((b) => `<option value="${b}">${b}</option>`)
    .join('');

  const disabledAttr = hasBooks ? '' : 'disabled';
  const replayTitle = hasBooks
    ? ''
    : 'title="No curated books — run `npm run dev` for the Lua flow"';

  // The inline driver mirrors bar.ts's buildLaunchUrl + SCREEN_PRESETS.
  const driver = `
const CFG = JSON.parse(document.getElementById('harness-config').textContent);
const SCREEN_PRESETS = ${JSON.stringify(SCREEN_PRESETS)};

function screenPreset(name) {
  return SCREEN_PRESETS.find((p) => p.name === name);
}

// Mirrors ./bar.ts buildLaunchUrl — keep in sync.
function buildLaunchUrl(opts) {
  const { rgsUrl, currency, social, lang = 'en', device = 'desktop', replay } = opts;
  if (replay) {
    const p = new URLSearchParams({
      replay: 'true',
      game: replay.game,
      version: replay.version,
      mode: replay.mode,
      event: String(replay.event),
      amount: String(replay.amount),
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

const iframe = document.getElementById('game');
const screenSel = document.getElementById('screen');
const currencySel = document.getElementById('currency');
const balanceSel = document.getElementById('balance');
const socialChk = document.getElementById('social');
const modeSel = document.getElementById('mode');
const roundInput = document.getElementById('round');
const randomBtn = document.getElementById('random');
const betSel = document.getElementById('bet');
const replayBtn = document.getElementById('replay');
const closeBtn = document.getElementById('close');

function applyScreen() {
  const p = screenPreset(screenSel.value) || SCREEN_PRESETS[0];
  iframe.style.width = p.w + 'px';
  iframe.style.height = p.h + 'px';
}

function launchNormal() {
  iframe.src = buildLaunchUrl({
    rgsUrl: CFG.rgsUrl,
    currency: currencySel.value,
    social: socialChk.checked,
  });
}

function launchReplay() {
  const event = Number(roundInput.value);
  iframe.src = buildLaunchUrl({
    rgsUrl: CFG.rgsUrl,
    currency: currencySel.value,
    social: socialChk.checked,
    replay: {
      game: CFG.gameId,
      version: CFG.version,
      mode: modeSel.value,
      event: Number.isFinite(event) ? event : 0,
      amount: Number(betSel.value) * 1_000_000,
    },
  });
}

screenSel.addEventListener('change', applyScreen);
currencySel.addEventListener('change', async () => {
  await fetch('/__rgs/__dev/currency?code=' + currencySel.value);
  launchNormal();
});
socialChk.addEventListener('change', launchNormal);
if (balanceSel) {
  balanceSel.addEventListener('change', async () => {
    const major = Number(balanceSel.value);
    await fetch('/__rgs/__dev/balance?major=' + major);
    launchNormal();
  });
}
if (replayBtn) replayBtn.addEventListener('click', launchReplay);
if (closeBtn) closeBtn.addEventListener('click', launchNormal);
if (randomBtn) {
  randomBtn.addEventListener('click', () => {
    // A simple random book id placeholder — the dev-RGS resolves real ids.
    // Without a books listing endpoint we just nudge the numeric input.
    roundInput.value = String(Math.floor(Math.random() * 1000) + 1);
  });
}

// Initial: Desktop / first currency / social off → normal launch.
applyScreen();
launchNormal();
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
    background: #0d0f12;
    color: #e6e8eb;
    font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    display: flex;
    flex-direction: column;
  }
  #stage {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: auto;
    padding: 24px;
  }
  #game {
    flex: 0 0 auto;
    border: 1px solid #2a2e35;
    border-radius: 8px;
    background: #000;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  }
  #bar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    padding: 10px 16px;
    background: #15181d;
    border-top: 1px solid #2a2e35;
    font-size: 13px;
  }
  #bar label { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
  #bar select, #bar input[type=number] {
    background: #1f242b;
    color: #e6e8eb;
    border: 1px solid #353b44;
    border-radius: 5px;
    padding: 4px 7px;
    font-size: 13px;
  }
  #bar input[type=number] { width: 72px; }
  .sep { width: 1px; align-self: stretch; background: #2a2e35; margin: 0 4px; }
  #replay-group { display: inline-flex; align-items: center; gap: 8px; }
  #replay-group[data-disabled="true"] { opacity: 0.45; }
  button {
    background: #2563eb;
    color: #fff;
    border: 0;
    border-radius: 5px;
    padding: 5px 10px;
    font-size: 13px;
    cursor: pointer;
  }
  button.ghost { background: #2a2e35; }
  button:disabled { cursor: not-allowed; opacity: 0.5; }
</style>
</head>
<body>
  <script type="application/json" id="harness-config">${cfgJson}</script>
  <div id="stage">
    <iframe id="game" title="game"></iframe>
  </div>
  <div id="bar">
    <label>Screen
      <select id="screen">${screenOptions}</select>
    </label>
    <label>Currency
      <select id="currency">${currencyOptions}</select>
    </label>
    <label>Balance
      <select id="balance">${balanceOptions}</select>
    </label>
    <label>Social
      <input type="checkbox" id="social" />
    </label>
    <div class="sep"></div>
    <div id="replay-group" data-disabled="${!hasBooks}" ${replayTitle}>
      <span>Replay:</span>
      <label>Mode
        <select id="mode" ${disabledAttr}>${modeOptions}</select>
      </label>
      <label>Round
        <input type="number" id="round" min="0" value="0" ${disabledAttr} />
      </label>
      <button class="ghost" id="random" ${disabledAttr}>🎲</button>
      <label>Bet
        <select id="bet" ${disabledAttr}>${betOptions}</select>
      </label>
      <button id="replay" ${disabledAttr}>▶ Replay</button>
      <button class="ghost" id="close" ${disabledAttr}>✕ Close</button>
    </div>
  </div>
  <script type="module">${driver}</script>
</body>
</html>`;
}
