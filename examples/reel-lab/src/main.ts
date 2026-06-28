// examples/reel-lab/src/main.ts
//
// Reel Lab — a standalone visual playground for the configurable reel system. Tweak every knob in
// the side panel, trigger any feature, swap presets, and copy the resulting config into a game.

import { Application } from 'pixi.js';
import {
  createReelSystem,
  resolveReelConfig,
  effectiveRowsPerReel,
  waysCount,
  PRESET_LIST,
  PRESETS,
  type ReelSystem,
  type ReelSystemConfig,
  type DeepPartial,
} from '@energy8platform/game-engine/slot';
import { createResolver } from './symbols';
import { randomBoard, scatterBoard, buildCascadeSteps, rowsFor } from './board';
import { buildControlPanel } from './controls';
import { CUSTOM_FEATURES } from './customFeatures';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const logEl = $('#log') as HTMLPreElement;
const log = (msg: string) => {
  logEl.textContent = `› ${msg}\n${logEl.textContent}`.slice(0, 4000);
};

let workingConfig: ReelSystemConfig = resolveReelConfig(PRESETS['hot-ross'].config);
let turbo = false;
let freeSpins = false;
let busy = false;

// ── Pixi app ────────────────────────────────────────────────────────────────
const app = new Application();
await app.init({
  background: 0x0b1020,
  antialias: true,
  resizeTo: $('#stage'),
  autoDensity: true,
  resolution: Math.min(2, window.devicePixelRatio || 1),
});
$('#stage').appendChild(app.canvas);

const resolve = createResolver();
let system: ReelSystem = createReelSystem({
  resolve,
  config: workingConfig,
  log,
  features: CUSTOM_FEATURES,
});
app.stage.addChild(system.view);

function freshBoard(): void {
  system.setBoard(randomBoard(workingConfig));
}
freshBoard();

function layout(): void {
  const cell = workingConfig.grid.cellSize;
  const gap = workingConfig.grid.gap;
  const cols = workingConfig.grid.cols;
  const rows = Math.max(...effectiveRowsPerReel(workingConfig.grid));
  const gridW = cols * (cell + gap) - gap;
  const gridH = rows * (cell + gap) - gap;
  const w = app.renderer.width / app.renderer.resolution;
  const h = app.renderer.height / app.renderer.resolution;
  // auto-fit: scale the whole grid down so tall boards (7 rows / Megaways) never clip under the bar
  const pad = 28;
  const fit = Math.min(1, (w - pad * 2) / gridW, (h - pad * 2) / gridH);
  system.view.scale.set(fit);
  const drawW = gridW * fit;
  const drawH = gridH * fit;
  system.view.position.set(
    Math.round((w - drawW) / 2 + (cell * fit) / 2),
    Math.round((h - drawH) / 2 + (cell * fit) / 2),
  );
  const ev = workingConfig.grid.evaluation;
  const shape = `${cols}×${rowsFor(workingConfig).join('/')}`;
  // "ways" is only meaningful for ways/megaways; otherwise show the evaluation model
  const metric =
    ev === 'ways' || ev === 'megaways'
      ? `${waysCount(workingConfig.grid).toLocaleString()} ways`
      : ev;
  $('#ways').textContent = `${shape}  ·  ${metric}`;
}
layout();
window.addEventListener('resize', () => requestAnimationFrame(layout));

// ── rebuild the system when config changes ──────────────────────────────────
function applyConfig(rebuildBoard: boolean): void {
  const next = structuredClone(workingConfig);
  const prevShape = system.grid.rowsPerReel.join();
  system.skip();
  system.setConfig(next);
  const shapeChanged = system.grid.rowsPerReel.join() !== prevShape || rebuildBoard;
  if (shapeChanged) freshBoard();
  layout();
}

function bindPanel(): void {
  buildControlPanel($('#panel'), {
    config: workingConfig,
    onChange: (path) => {
      // changing column count invalidates a fixed Megaways rowsPerReel — drop it so they can't desync
      if (path === 'grid.cols') delete workingConfig.grid.rowsPerReel;
      applyConfig(path.startsWith('grid.'));
      renderFeatureBar();
    },
  });
}

// ── presets ─────────────────────────────────────────────────────────────────
const presetSel = $('#preset') as HTMLSelectElement;
for (const p of PRESET_LIST) {
  const o = document.createElement('option');
  o.value = p.id;
  o.textContent = p.name;
  presetSel.appendChild(o);
}
presetSel.value = 'hot-ross';
presetSel.addEventListener('change', () => {
  const preset = PRESETS[presetSel.value as keyof typeof PRESETS];
  workingConfig = resolveReelConfig(preset.config);
  rebuildEverything();
  log(`Preset: ${preset.name} — ${preset.note}`);
});

function rebuildEverything(): void {
  busy = false;
  system.skip();
  system.destroy();
  system = createReelSystem({ resolve, config: workingConfig, log, features: CUSTOM_FEATURES });
  app.stage.addChild(system.view);
  freshBoard();
  layout();
  bindPanel();
  renderFeatureBar();
}

// ── actions ─────────────────────────────────────────────────────────────────
async function guarded(fn: () => Promise<void>): Promise<void> {
  if (busy) {
    system.skip();
    return;
  }
  busy = true;
  try {
    await fn();
  } finally {
    busy = false;
  }
}

$('#btn-spin').addEventListener('click', () =>
  guarded(async () => {
    const target = randomBoard(workingConfig);
    await system.spin(target, { turbo });
  }),
);

$('#btn-scatter').addEventListener('click', () =>
  guarded(async () => {
    const target = scatterBoard(workingConfig, Math.max(workingConfig.anticipation.threshold, 3));
    if (!workingConfig.anticipation.enabled) log('Tip: enable Anticipation to see the slow-down');
    await system.spin(target, { turbo });
  }),
);

$('#btn-cascade').addEventListener('click', () =>
  guarded(async () => {
    if (!workingConfig.cascade.enabled) {
      log('Tip: enable Cascade/Tumble first');
      return;
    }
    const steps = buildCascadeSteps(workingConfig, system.board);
    if (!steps.length) {
      log('No clusters of ≥4 on this board — generating a denser one');
      system.setBoard(randomBoard(workingConfig, ['h1', 'h1', 'h2', 'h2', 'h3', 'l1']));
      return;
    }
    log(`Tumble: ${steps.length} cascade step(s)`);
    await system.cascade(steps, { turbo, freeSpins });
  }),
);

$('#btn-board').addEventListener('click', () => {
  freshBoard();
  layout();
});
$('#btn-mega').addEventListener('click', () => {
  const min = workingConfig.grid.minRows ?? 2,
    max = workingConfig.grid.maxRows ?? 7;
  const rows = Array.from(
    { length: workingConfig.grid.cols },
    () => min + Math.floor(Math.random() * (max - min + 1)),
  );
  workingConfig.grid.rowsPerReel = rows;
  applyConfig(true);
  log(
    `Megaways heights: [${rows.join(', ')}] = ${waysCount(workingConfig.grid).toLocaleString()} ways`,
  );
});
($('#chk-turbo') as HTMLInputElement).addEventListener(
  'change',
  (e) => (turbo = (e.target as HTMLInputElement).checked),
);
($('#chk-fs') as HTMLInputElement).addEventListener(
  'change',
  (e) => (freeSpins = (e.target as HTMLInputElement).checked),
);

// ── feature trigger buttons ──────────────────────────────────────────────────
const featurebar = $('#featurebar');
function renderFeatureBar(): void {
  featurebar.innerHTML = '';
  // system.features() = the 13 built-ins + any registered custom features (★)
  for (const f of system.features()) {
    const btn = document.createElement('button');
    btn.textContent = f.label;
    const sync = () => btn.classList.toggle('off', !f.enabled(workingConfig));
    sync();
    btn.addEventListener('click', () =>
      guarded(async () => {
        if (!f.enabled(workingConfig)) {
          log(`${f.label} is disabled — toggle it in Features`);
          return;
        }
        await system.runFeature(f.key, { freeSpins });
      }),
    );
    featurebar.appendChild(btn);
  }
}
bindPanel();
renderFeatureBar();

// ── copy config ───────────────────────────────────────────────────────────────
function configDiff(base: any, obj: any): any {
  const out: any = {};
  for (const k of Object.keys(obj)) {
    const a = base?.[k],
      b = obj[k];
    if (Array.isArray(b)) {
      if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = b;
    } else if (b && typeof b === 'object') {
      const d = configDiff(a ?? {}, b);
      if (Object.keys(d).length) out[k] = d;
    } else if (a !== b) out[k] = b;
  }
  return out;
}
function copy(text: string, label: string): void {
  navigator.clipboard
    ?.writeText(text)
    .then(() => toast(`${label} copied`))
    .catch(() => toast('Copy failed'));
}
$('#btn-copy-json').addEventListener('click', () =>
  copy(JSON.stringify(workingConfig, null, 2), 'Full JSON config'),
);
$('#btn-copy-ts').addEventListener('click', () => {
  const diff = configDiff(resolveReelConfig(), workingConfig);
  const ts = `import { resolveReelConfig } from '@energy8platform/game-engine/slot';\n\n// Only the overrides vs DEFAULT_REEL_CONFIG.\nexport const reelConfig = resolveReelConfig(${JSON.stringify(diff, null, 2)} as const);\n`;
  copy(ts, 'TS config (diff)');
});

function toast(msg: string): void {
  let el = document.querySelector('.toast') as HTMLElement | null;
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el!.classList.remove('show'), 1200);
}

log('Ready. Spin, tweak knobs, trigger features, then Copy TS.');
