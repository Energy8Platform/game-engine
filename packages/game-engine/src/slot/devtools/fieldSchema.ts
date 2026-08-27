// packages/game-engine/src/slot/devtools/fieldSchema.ts
//
// Declarative description of the reel-config control panel. Each control binds to a
// dot-path in the ReelSystemConfig. Pure data — no pixi, no DOM — so it bundles into
// the self-contained panel client served by the harness.
//
// NOTE: board shape (grid.cols / grid.rows / rowsPerReel) is intentionally OMITTED.
// The board shape is math-tied (paylines / ways / book geometry) and must not be
// tuned live from the harness. Everything else — cosmetic geometry, motion,
// anticipation, cascade, win presentation and features — is tunable.

export type Control =
  | { kind: 'select'; path: string; label: string; options: string[] }
  | {
      kind: 'range';
      path: string;
      label: string;
      min: number;
      max: number;
      step: number;
      /** When the bound value is unset (undefined / non-scalar), show this path's value instead. */
      fallback?: string;
    }
  | { kind: 'toggle'; path: string; label: string }
  | { kind: 'color'; path: string; label: string };

/** Stable section identifiers — used to toggle whole sections on/off from the plugin. */
export type SectionKey = 'geometry' | 'motion' | 'anticipation' | 'cascade' | 'win' | 'features';

/** All section keys, in panel order. */
export const REEL_SECTION_KEYS: SectionKey[] = [
  'geometry',
  'motion',
  'anticipation',
  'cascade',
  'win',
  'features',
];

export interface Section {
  /** Stable key for enabling/disabling the whole section (optional for ad-hoc schemas). */
  key?: SectionKey;
  title: string;
  controls: Control[];
  collapsed?: boolean;
}

const EASINGS = [
  'linear',
  'easeOutQuad',
  'easeOutCubic',
  'easeOutBack',
  'easeOutBounce',
  'easeInBack',
  'easeOutElastic',
  'easeInOutSine',
  'easeInOutQuad',
];

/** The editable reel-config fields, grouped into collapsible sections. */
export const REEL_FIELD_SCHEMA: Section[] = [
  {
    key: 'geometry',
    title: 'Cell geometry',
    controls: [
      { kind: 'range', path: 'grid.cellSize', label: 'Cell size', min: 40, max: 120, step: 1 },
      { kind: 'range', path: 'grid.gap', label: 'Gap', min: 0, max: 16, step: 1 },
      {
        kind: 'select',
        path: 'grid.evaluation',
        label: 'Evaluation',
        options: ['lines', 'ways', 'anywhere', 'cluster', 'megaways', 'infinity'],
      },
      { kind: 'toggle', path: 'grid.mask', label: 'Mask reels' },
      {
        kind: 'range',
        path: 'grid.cellWidth',
        label: 'Cell width',
        min: 40,
        max: 160,
        step: 1,
        fallback: 'grid.cellSize',
      },
      {
        kind: 'range',
        path: 'grid.cellHeight',
        label: 'Cell height',
        min: 40,
        max: 160,
        step: 1,
        fallback: 'grid.cellSize',
      },
      {
        kind: 'range',
        path: 'grid.colGap',
        label: 'Column gap',
        min: 0,
        max: 40,
        step: 1,
        fallback: 'grid.gap',
      },
      {
        kind: 'range',
        path: 'grid.rowGap',
        label: 'Row gap',
        min: 0,
        max: 40,
        step: 1,
        fallback: 'grid.gap',
      },
    ],
  },
  {
    key: 'motion',
    title: 'Motion',
    controls: [
      { kind: 'select', path: 'motion.style', label: 'Style', options: ['swap', 'strip', 'cascade-drop'] },
      { kind: 'range', path: 'motion.spinUp', label: 'Spin-up (ms)', min: 100, max: 2500, step: 10 },
      { kind: 'range', path: 'motion.hold', label: 'Hold (ms)', min: 0, max: 800, step: 10 },
      { kind: 'range', path: 'motion.stopStagger', label: 'Stop stagger (ms)', min: 0, max: 400, step: 5 },
      { kind: 'select', path: 'motion.stopMode', label: 'Stop mode', options: ['sequential', 'sync', 'random'] },
      { kind: 'select', path: 'motion.stopOrder', label: 'Stop order', options: ['ltr', 'rtl'] },
      { kind: 'range', path: 'motion.settle.amp', label: 'Settle amp (px)', min: 0, max: 24, step: 1 },
      { kind: 'range', path: 'motion.settle.ms', label: 'Settle (ms)', min: 60, max: 500, step: 10 },
      { kind: 'select', path: 'motion.settle.easing', label: 'Settle easing', options: EASINGS },
      { kind: 'toggle', path: 'motion.squash.enabled', label: 'Squash on land' },
      { kind: 'range', path: 'motion.squash.scaleX', label: 'Squash X', min: 1, max: 1.5, step: 0.01 },
      { kind: 'range', path: 'motion.squash.scaleY', label: 'Squash Y', min: 0.5, max: 1, step: 0.01 },
      { kind: 'toggle', path: 'motion.blur.enabled', label: 'Motion blur' },
      { kind: 'range', path: 'motion.blur.alpha', label: 'Blur alpha', min: 0.3, max: 1, step: 0.01 },
      { kind: 'range', path: 'motion.blur.strength', label: 'Blur strength', min: 0, max: 16, step: 1 },
      { kind: 'toggle', path: 'motion.blur.streaks', label: 'Blur streaks' },
      { kind: 'range', path: 'motion.turboFactor', label: 'Turbo factor', min: 0.2, max: 1, step: 0.05 },
      { kind: 'select', path: 'motion.intensity', label: 'Intensity', options: ['full', 'reduced', 'minimal'] },
      { kind: 'toggle', path: 'motion.slamStop', label: 'Slam stop' },
      { kind: 'range', path: 'motion.symbolsPerReel', label: 'Tape length', min: 3, max: 24, step: 1 },
      { kind: 'range', path: 'motion.cellStagger', label: 'Cell stagger (ms)', min: 0, max: 700, step: 5 },
      { kind: 'range', path: 'motion.reelStaggerFactor', label: 'Reel stagger ×', min: 0, max: 3, step: 0.05 },
      { kind: 'range', path: 'motion.dropFallFactor', label: 'Drop fall ×', min: 0.1, max: 3, step: 0.05 },
      { kind: 'select', path: 'motion.dropOrder', label: 'Drop order', options: ['top-down', 'bottom-up'] },
      { kind: 'select', path: 'motion.dropSequence', label: 'Drop sequence', options: ['parallel', 'chained', 'chained-when-anticipated'] },
    ],
  },
  {
    key: 'anticipation',
    title: 'Anticipation',
    controls: [
      { kind: 'toggle', path: 'anticipation.enabled', label: 'Enabled' },
      { kind: 'range', path: 'anticipation.threshold', label: 'Threshold (N−1)', min: 1, max: 6, step: 1 },
      { kind: 'range', path: 'anticipation.slowdownFactor', label: 'Slowdown', min: 0.1, max: 1, step: 0.05 },
      { kind: 'range', path: 'anticipation.holdMs', label: 'Hold (ms)', min: 0, max: 1200, step: 50 },
      { kind: 'range', path: 'anticipation.progressiveSlowdown', label: 'Slowdown ramp ×/reel', min: 0.3, max: 1, step: 0.05 },
      { kind: 'range', path: 'anticipation.progressiveHoldMs', label: 'Hold ramp (ms/reel)', min: 0, max: 600, step: 25 },
      { kind: 'toggle', path: 'anticipation.zoom.enabled', label: 'Reel zoom' },
      { kind: 'range', path: 'anticipation.zoom.scale', label: 'Zoom scale', min: 1, max: 1.6, step: 0.05 },
      { kind: 'range', path: 'anticipation.zoom.ms', label: 'Zoom (ms)', min: 200, max: 1200, step: 50 },
    ],
  },
  {
    key: 'cascade',
    title: 'Cascade / Tumble',
    controls: [
      { kind: 'toggle', path: 'cascade.enabled', label: 'Enabled' },
      { kind: 'toggle', path: 'cascade.gravity', label: 'Gravity (survivors slide)' },
      { kind: 'toggle', path: 'cascade.dimNonWinners', label: 'Dim non-winners' },
      { kind: 'range', path: 'cascade.dimAlpha', label: 'Dim alpha', min: 0.1, max: 1, step: 0.05 },
      { kind: 'range', path: 'cascade.perStepDecel', label: 'Per-step decel', min: 0, max: 0.4, step: 0.01 },
      { kind: 'range', path: 'cascade.perStepDecelCap', label: 'Decel cap', min: 1, max: 3, step: 0.1 },
      { kind: 'range', path: 'cascade.timings.remove', label: 'Remove (ms)', min: 80, max: 600, step: 10 },
      { kind: 'range', path: 'cascade.timings.drop', label: 'Drop (ms)', min: 80, max: 600, step: 10 },
      { kind: 'select', path: 'cascade.easings.drop', label: 'Drop easing', options: EASINGS },
      { kind: 'toggle', path: 'cascade.multiplier.enabled', label: 'Win multiplier' },
      { kind: 'select', path: 'cascade.multiplier.mode', label: 'Multiplier mode', options: ['add', 'mul'] },
      { kind: 'range', path: 'cascade.multiplier.step', label: 'Multiplier step', min: 1, max: 5, step: 1 },
    ],
  },
  {
    key: 'win',
    title: 'Win presentation',
    controls: [
      { kind: 'range', path: 'win.highlightScale', label: 'Highlight scale', min: 1, max: 1.4, step: 0.01 },
      { kind: 'toggle', path: 'win.glow', label: 'Glow' },
      { kind: 'toggle', path: 'win.frameShake.enabled', label: 'Frame shake' },
      { kind: 'range', path: 'win.frameShake.amp', label: 'Shake amp', min: 0, max: 10, step: 0.5 },
    ],
  },
  {
    key: 'features',
    title: 'Features',
    controls: [
      { kind: 'toggle', path: 'features.expandingWild.enabled', label: 'Expanding wild' },
      { kind: 'toggle', path: 'features.expandingWild.toFullReel', label: '· to full reel' },
      { kind: 'toggle', path: 'features.sticky.enabled', label: 'Sticky symbols' },
      { kind: 'range', path: 'features.sticky.durationSpins', label: '· duration spins', min: 0, max: 6, step: 1 },
      { kind: 'toggle', path: 'features.walkingWild.enabled', label: 'Walking wild' },
      { kind: 'select', path: 'features.walkingWild.direction', label: '· direction', options: ['left', 'right'] },
      { kind: 'toggle', path: 'features.randomWild.enabled', label: 'Random wild inject' },
      { kind: 'toggle', path: 'features.randomWild.sticky', label: '· sticky' },
      { kind: 'toggle', path: 'features.mystery.enabled', label: 'Mystery symbols' },
      { kind: 'toggle', path: 'features.transform.enabled', label: 'Transform / upgrade' },
      { kind: 'toggle', path: 'features.transform.upgradeOnly', label: '· upgrade only' },
      { kind: 'toggle', path: 'features.giant.enabled', label: 'Giant symbol' },
      { kind: 'range', path: 'features.giant.width', label: '· width', min: 1, max: 5, step: 1 },
      { kind: 'range', path: 'features.giant.height', label: '· height', min: 1, max: 5, step: 1 },
      { kind: 'toggle', path: 'features.split.enabled', label: 'Split (xSplit)' },
      { kind: 'range', path: 'features.split.factor', label: '· factor', min: 2, max: 4, step: 1 },
      { kind: 'toggle', path: 'features.stacked.enabled', label: 'Stacked symbols' },
      { kind: 'range', path: 'features.stacked.height', label: '· stack height', min: 2, max: 7, step: 1 },
      { kind: 'toggle', path: 'features.nudge.enabled', label: 'Nudge / xNudge' },
      { kind: 'toggle', path: 'features.nudge.toFullReel', label: '· xNudge fill' },
      { kind: 'toggle', path: 'features.multiplier.enabled', label: 'Multiplier symbols' },
      { kind: 'select', path: 'features.multiplier.combine', label: '· combine', options: ['additive', 'multiplicative'] },
      { kind: 'toggle', path: 'features.holdAndSpin.enabled', label: 'Hold & Spin' },
      { kind: 'range', path: 'features.holdAndSpin.respinsAwarded', label: '· respins', min: 1, max: 5, step: 1 },
      { kind: 'toggle', path: 'features.reelModifier.enabled', label: 'Reel modifier' },
    ],
  },
];
