// packages/game-engine/src/slot/devtools/panelClient.ts
//
// The harness "Reels" sidebar panel client. Built as a SELF-CONTAINED browser ESM
// (dist/reel-panel-client.js) and served by the harness at /__harness/panel/reels.js.
// Default-exports the HarnessPanelMount the core client calls.
//
// It seeds its controls from the running game's config (received over the bus), applies
// every edit LIVE (posts a patch → the game's reel bridge calls system.update), and
// offers a "Copy config" button that emits the paste-ready overrides snippet.

import type { HarnessPanelMount } from '@energy8platform/harness/panel';
import type { ReelSystemConfig } from '../config/ReelSystemConfig';
import { buildControlPanel } from './controlPanel';
import { REEL_FIELD_SCHEMA, type SectionKey } from './fieldSchema';
import { emitReelConfigTs } from './configDiff';
import { REEL_APPLY, REEL_READY, REEL_REQUEST, type ReelDevMessage } from './protocol';

/** Config the harness plugin passes via ctx.config, e.g. { sections: { geometry: false } }. */
interface ReelPanelConfig {
  /** Per-section visibility. Missing key = shown. */
  sections?: Partial<Record<SectionKey, boolean>>;
}

const CSS = `
.e8rp-wait { color: #6b7480; font-size: 12px; line-height: 1.6; padding: 8px 2px; }
.e8rp-bar { display: flex; gap: 8px; margin-bottom: 12px; }
.e8rp-bar button {
  flex: 1 1 0; background: #1c2128; color: #cfd5dd; border: 1px solid #3a414c; border-radius: 8px;
  padding: 8px; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
}
.e8rp-bar button:hover { border-color: #4b5563; color: #fff; }
.e8rp-status { font-size: 11px; color: #6b7480; min-height: 14px; margin-bottom: 8px; }
.e8rp-controls .panel-section { border-top: 1px solid #1d222a; }
.e8rp-controls .section-head {
  width: 100%; text-align: left; background: transparent; border: 0; color: #aab2bd;
  font: inherit; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  padding: 10px 2px 6px; cursor: pointer;
}
.e8rp-controls .section-body { display: flex; flex-direction: column; gap: 2px; padding-bottom: 6px; }
.e8rp-controls .control {
  display: flex; align-items: center; gap: 8px; padding: 4px 2px; font-size: 12px; color: #d3d8df;
}
.e8rp-controls .control-label { flex: 1 1 auto; }
.e8rp-controls .control-value { width: 34px; text-align: right; color: #828b98; font-variant-numeric: tabular-nums; }
.e8rp-controls input[type=range] { flex: 0 0 120px; }
.e8rp-controls select { background: #1c2128; color: #e9ecf1; border: 1px solid #3a414c; border-radius: 6px; padding: 3px 6px; font: inherit; font-size: 12px; }
.e8rp-controls .control-toggle { justify-content: space-between; }
`;

function injectCss(): void {
  if (document.getElementById('e8-reel-panel-css')) return;
  const style = document.createElement('style');
  style.id = 'e8-reel-panel-css';
  style.textContent = CSS;
  document.head.appendChild(style);
}

const mount: HarnessPanelMount = (ctx) => {
  injectCss();
  const root = ctx.root;

  // Section visibility from the plugin (reelDevtoolsPlugin({ sections: { geometry: false } })).
  const panelCfg = (ctx.config ?? {}) as ReelPanelConfig;
  const sectionOn = panelCfg.sections ?? {};
  const schema = REEL_FIELD_SCHEMA.filter((s) => s.key == null || sectionOn[s.key] !== false);
  root.innerHTML = '<p class="e8rp-wait">Waiting for the game’s reel bridge…<br/>(the game must call <code>mountReelDevBridge</code>.)</p>';

  let working: ReelSystemConfig | null = null;
  let built = false;

  const status = (msg: string): void => {
    const el = root.querySelector<HTMLElement>('.e8rp-status');
    if (el) el.textContent = msg;
  };
  const copy = (text: string, label: string): void => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => status(`${label} copied`))
      .catch(() => status('Copy failed'));
  };

  const buildUi = (config: ReelSystemConfig): void => {
    working = structuredClone(config);
    root.innerHTML = '';

    const bar = document.createElement('div');
    bar.className = 'e8rp-bar';
    const copyTs = document.createElement('button');
    copyTs.textContent = 'Copy config';
    copyTs.addEventListener('click', () => working && copy(emitReelConfigTs(working), 'TS config'));
    const copyJson = document.createElement('button');
    copyJson.textContent = 'Copy JSON';
    copyJson.addEventListener('click', () => working && copy(JSON.stringify(working, null, 2), 'JSON'));
    bar.append(copyTs, copyJson);

    const statusEl = document.createElement('div');
    statusEl.className = 'e8rp-status';

    const controls = document.createElement('div');
    controls.className = 'e8rp-controls';

    root.append(bar, statusEl, controls);

    buildControlPanel(controls, {
      config: working,
      schema,
      onChange: () => {
        ctx.post({ type: REEL_APPLY, patch: working as ReelSystemConfig } satisfies ReelDevMessage);
      },
    });
    built = true;
  };

  ctx.on((raw) => {
    const msg = raw as ReelDevMessage | undefined;
    if (msg && typeof msg === 'object' && msg.type === REEL_READY) buildUi(msg.config);
  });

  // Ask the game for its config (covers the game-loaded-first case); retry a couple times.
  const request = (): void => ctx.post({ type: REEL_REQUEST } satisfies ReelDevMessage);
  request();
  window.setTimeout(() => !built && request(), 400);
  window.setTimeout(() => !built && request(), 1200);
};

export default mount;
