// examples/reel-lab/src/main.ts
//
// Reel Lab — a standalone visual playground for the configurable reel system. Tweak every knob in
// the side panel, trigger any feature, swap presets, and copy the resulting config into a game.

import { Application } from 'pixi.js';
import {
  createReelSystem,
  resolveReelConfig,
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
let varied = false; // per-strip cell-size + variable column-gap demo toggle

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
  // Pull the resolved geometry from the grid — handles rectangular / per-strip / variable-gap layouts.
  const geom = system.grid.geometry;
  const gridW = geom.gridW;
  const gridH = geom.gridH;
  const cols = workingConfig.grid.cols;
  const w = app.renderer.width / app.renderer.resolution;
  const h = app.renderer.height / app.renderer.resolution;
  // auto-fit: scale the whole grid down so tall boards (7 rows / Megaways) never clip under the bar
  const pad = 28;
  const fit = Math.min(1, (w - pad * 2) / gridW, (h - pad * 2) / gridH);
  system.view.scale.set(fit);
  const drawW = gridW * fit;
  const drawH = gridH * fit;
  // the view origin is cell(0,0)'s centre; leftX/topY are the grid's top-left corner relative to it
  system.view.position.set(
    Math.round((w - drawW) / 2 - geom.leftX * fit),
    Math.round((h - drawH) / 2 - geom.topY * fit),
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
      if (path === 'grid.cols') {
        delete workingConfig.grid.rowsPerReel;
        if (varied) regenStrips(); // resize the per-strip arrays to the new column count
      }
      applyConfig(path.startsWith('grid.'));
      renderFeatureBar();
    },
  });
}

// ── per-strip cell sizes + alternating column gaps (rectangular / per-strip demo) ──
const varyBtn = $('#btn-vary') as HTMLButtonElement;
function regenStrips(): void {
  const cols = workingConfig.grid.cols;
  const base = workingConfig.grid.cellSize;
  // alternate widths and heights per strip so every reel differs; even/odd + every-3rd pattern
  workingConfig.grid.cellSizePerReel = Array.from({ length: cols }, (_, c) => ({
    width: Math.round(base * (c % 2 === 0 ? 1 : 0.7)),
    height: Math.round(base * (c % 3 === 0 ? 1.25 : 1)),
  }));
  // per-boundary column gaps: tight, then wide, then tight…
  workingConfig.grid.colGap = Array.from({ length: Math.max(0, cols - 1) }, (_, i) =>
    i % 2 === 0 ? 4 : 22,
  );
}
function setVaried(on: boolean): void {
  varied = on;
  if (on) regenStrips();
  else {
    delete workingConfig.grid.cellSizePerReel;
    delete workingConfig.grid.colGap;
  }
  varyBtn.classList.toggle('active', varied);
  applyConfig(true);
  log(on ? 'Per-strip: varied widths/heights + alternating column gaps' : 'Per-strip: uniform');
}
varyBtn.addEventListener('click', () => setVaried(!varied));

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
  varied = false; // presets are uniform-cell; reset the per-strip toggle
  varyBtn.classList.remove('active');
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
