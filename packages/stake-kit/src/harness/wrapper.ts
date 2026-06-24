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
    gap: 10px;
    flex-wrap: wrap;
    padding: 12px 18px;
    background: linear-gradient(180deg, #1b1f26 0%, #14171c 100%);
    border-top: 1px solid #2f343d;
    box-shadow: 0 -8px 24px rgba(0,0,0,0.35);
    font-size: 12px;
    -webkit-font-smoothing: antialiased;
  }
  #brand {
    display: inline-flex; align-items: center; gap: 7px;
    font-weight: 700; letter-spacing: 0.04em; color: #f0f2f5; margin-right: 4px;
  }
  #brand .dot { width: 8px; height: 8px; border-radius: 50%; background: #34d399; box-shadow: 0 0 8px #34d39988; }
  #brand small { font-weight: 500; color: #6b7280; letter-spacing: 0; }
  /* Each control is a self-contained pill: caption above its input. */
  #bar label {
    display: inline-flex; flex-direction: column; gap: 3px; white-space: nowrap;
    font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: #8a92a0;
  }
  #bar label.inline { flex-direction: row; align-items: center; gap: 7px; text-transform: none; letter-spacing: 0; font-size: 12px; color: #cdd2da; }
  #bar select, #bar input[type=number] {
    background: #232830;
    color: #e9ecf1;
    border: 1px solid #3a414c;
    border-radius: 7px;
    padding: 6px 9px;
    font-size: 12px;
    font-weight: 600;
    transition: border-color 0.12s, background 0.12s;
  }
  #bar select:hover, #bar input[type=number]:hover { border-color: #4b5563; }
  #bar select:focus, #bar input[type=number]:focus { outline: none; border-color: #3b82f6; background: #262c35; }
  #bar input[type=number] { width: 76px; }
  /* Switch-style social toggle. */
  #social { width: 16px; height: 16px; accent-color: #34d399; cursor: pointer; }
  .sep { width: 1px; align-self: stretch; background: #2f343d; margin: 0 6px; }
  #replay-group {
    display: inline-flex; align-items: center; gap: 9px;
    padding: 6px 12px; border: 1px solid #2f343d; border-radius: 10px; background: rgba(255,255,255,0.02);
  }
  #replay-group > span { font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #6b7280; }
  #replay-group[data-disabled="true"] { opacity: 0.4; }
  button {
    background: linear-gradient(180deg, #3b82f6 0%, #2563eb 100%);
    color: #fff;
    border: 0;
    border-radius: 7px;
    padding: 7px 13px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: filter 0.12s, transform 0.06s;
  }
  button:hover { filter: brightness(1.08); }
  button:active { transform: translateY(1px); }
  button.ghost { background: #2b313a; }
  button.ghost:hover { background: #333a45; }
  button:disabled { cursor: not-allowed; opacity: 0.45; filter: none; }
</style>
</head>
<body>
  <script type="application/json" id="harness-config">${cfgJson}</script>
  <div id="stage">
    <iframe id="game" title="game"></iframe>
  </div>
  <div id="bar">
    <span id="brand"><span class="dot"></span>Stake Harness <small>${esc(cfg.gameId)}</small></span>
    <div class="sep"></div>
    <label>Screen
      <select id="screen">${screenOptions}</select>
    </label>
    <label>Currency
      <select id="currency">${currencyOptions}</select>
    </label>
    <label>Balance
      <select id="balance">${balanceOptions}</select>
    </label>
    <label class="inline">
      <input type="checkbox" id="social" />Social
    </label>
    <div class="sep"></div>
    <div id="replay-group" data-disabled="${!hasBooks}" ${replayTitle}>
      <span>Replay</span>
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
