// packages/game-engine/src/slot/config/presets.ts
//
// Reel presets distilled from our shipped games (see docs/reels-analysis-and-design.md §2).
// Each is a DeepPartial override on DEFAULT_REEL_CONFIG.

import type { DeepPartial, ReelSystemConfig } from './ReelSystemConfig';

export type PresetId =
  | 'classic'
  | 'kitsune-wrath'
  | 'moon-spice'
  | 'stone-rush'
  | 'hot-ross'
  | 'magnus'
  | 'megaways';

export interface ReelPreset {
  id: PresetId;
  name: string;
  note: string;
  config: DeepPartial<ReelSystemConfig>;
}

export const PRESETS: Record<PresetId, ReelPreset> = {
  classic: {
    id: 'classic',
    name: 'Classic 5×3 lines',
    note: 'Plain spinning reels, sequential stops, settle bounce.',
    config: {
      grid: { cols: 5, rows: 3, evaluation: 'lines', cellSize: 96, gap: 6 },
      motion: {
        style: 'strip',
        spinUp: 600,
        stopStagger: 140,
        blur: { enabled: true, alpha: 0.85, strength: 6, streaks: false },
      },
    },
  },
  'kitsune-wrath': {
    id: 'kitsune-wrath',
    name: 'Kitsune Wrath 7×7 cluster',
    note: 'Tumble grid, sticky wilds, position multipliers, scatter anticipation.',
    config: {
      grid: { cols: 7, rows: 7, evaluation: 'cluster', cellSize: 66, gap: 0 },
      motion: {
        style: 'cascade-drop',
        spinUp: 400,
        squash: { enabled: true, scaleX: 1.12, scaleY: 0.88, ms: 90 },
      },
      cascade: {
        enabled: true,
        gravity: true,
        dimNonWinners: true,
        multiplier: {
          enabled: true,
          start: 1,
          mode: 'mul',
          step: 2,
          cap: 128,
          persistInFreeSpins: false,
        },
      },
      anticipation: { enabled: true, triggerSymbols: ['scatter'], threshold: 4 },
      features: {
        sticky: { enabled: true, durationSpins: 3 },
        multiplier: { enabled: true, scope: 'perSymbol', combine: 'multiplicative', max: 128 },
      },
    },
  },
  'moon-spice': {
    id: 'moon-spice',
    name: 'Moon Spice 5×4 ways',
    note: 'Spin + cascade refill, frame shake on wild/scatter, 1024 ways.',
    config: {
      grid: { cols: 5, rows: 4, evaluation: 'ways', cellSize: 90, gap: 4 },
      motion: {
        style: 'strip',
        spinUp: 1200,
        stopStagger: 120,
        settle: { amp: 6, ms: 220, easing: 'easeOutQuad' },
      },
      cascade: {
        enabled: true,
        gravity: true,
        easings: { highlight: 'easeOutQuad', remove: 'easeInBack', drop: 'easeOutBounce' },
      },
      win: { frameShake: { enabled: true, amp: 2.2, ms: 180, onlyOnSymbols: ['wild', 'scatter'] } },
      features: { multiplier: { enabled: true, scope: 'perSymbol', combine: 'additive' } },
    },
  },
  'stone-rush': {
    id: 'stone-rush',
    name: 'Stone Rush 7×7 tumble',
    note: 'Weighty gravity with squash/stretch, per-step deceleration, multiplier orbs.',
    config: {
      grid: { cols: 7, rows: 7, evaluation: 'cluster', cellSize: 66, gap: 8 },
      motion: {
        style: 'cascade-drop',
        spinUp: 320,
        squash: { enabled: true, scaleX: 1.3, scaleY: 0.7, ms: 110 },
      },
      cascade: {
        enabled: true,
        gravity: true,
        perStepDecel: 0.08,
        perStepDecelCap: 1.5,
        multiplier: {
          enabled: true,
          start: 1,
          mode: 'add',
          step: 1,
          cap: 100,
          persistInFreeSpins: true,
        },
      },
      features: {
        multiplier: { enabled: true, scope: 'global', combine: 'additive', max: 100 },
        expandingWild: { enabled: true, symbol: 'wild', toFullReel: false },
      },
    },
  },
  'hot-ross': {
    id: 'hot-ross',
    name: 'Hot Ross 5×5 lines',
    note: 'Classic strip spin with motion blur, scatter tease, expanding wilds, sticky reels.',
    config: {
      grid: { cols: 5, rows: 5, evaluation: 'lines', cellSize: 88, gap: 4 },
      motion: {
        style: 'strip',
        spinUp: 1650,
        stopStagger: 210,
        blur: { enabled: true, alpha: 0.82, strength: 8, streaks: true },
        settle: { amp: 7, ms: 240, easing: 'easeOutBack' },
      },
      anticipation: {
        enabled: true,
        triggerSymbols: ['scatter'],
        threshold: 2,
        slowdownFactor: 0.28,
        holdMs: 450,
      },
      features: {
        expandingWild: { enabled: true, symbol: 'wild', reels: [1, 2, 3], toFullReel: true },
        sticky: { enabled: true, durationSpins: 0 },
      },
    },
  },
  magnus: {
    id: 'magnus',
    name: 'Magnus 6×6 transmute',
    note: 'Cascade with idle-breathing symbols, scatter anticipation + reel zoom, transform.',
    config: {
      grid: { cols: 6, rows: 6, evaluation: 'cluster', cellSize: 74, gap: 2 },
      motion: {
        style: 'cascade-drop',
        spinUp: 400,
        squash: { enabled: true, scaleX: 1.14, scaleY: 0.86, ms: 110 },
      },
      cascade: {
        enabled: true,
        gravity: true,
        multiplier: {
          enabled: true,
          start: 1,
          mode: 'add',
          step: 1,
          cap: null,
          persistInFreeSpins: true,
        },
      },
      anticipation: {
        enabled: true,
        triggerSymbols: ['scatter'],
        threshold: 2,
        holdMs: 280,
        zoom: { enabled: true, scale: 1.3, ms: 600 },
      },
      features: {
        transform: {
          enabled: true,
          source: 'randomLow',
          target: 'h1',
          allInstances: true,
          upgradeOnly: true,
        },
      },
    },
  },
  megaways: {
    id: 'megaways',
    name: 'Megaways 6× (2–7)',
    note: 'Variable per-reel heights, tumble + climbing multiplier, anticipation.',
    config: {
      grid: {
        cols: 6,
        rows: 4,
        rowsPerReel: [4, 6, 3, 7, 5, 2],
        evaluation: 'megaways',
        cellSize: 74,
        gap: 4,
        minRows: 2,
        maxRows: 7,
      },
      motion: { style: 'strip', spinUp: 900, stopStagger: 130 },
      cascade: {
        enabled: true,
        gravity: true,
        multiplier: {
          enabled: true,
          start: 1,
          mode: 'add',
          step: 1,
          cap: null,
          persistInFreeSpins: true,
        },
      },
      anticipation: { enabled: true, triggerSymbols: ['scatter'], threshold: 3 },
    },
  },
};

export const PRESET_LIST: ReelPreset[] = Object.values(PRESETS);
