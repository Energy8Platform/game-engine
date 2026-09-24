/**
 * The form the IDE draws for the `motion1` row — `e8.runtime.schema` in
 * this package's manifest. Imported by the IDE HOST (a node process), so
 * this module imports `schemastery` and nothing else: `./runtime` pulls in
 * `@energy8engine/reel-core` (and, through it, pixi.js), and would not load
 * there. That is why every field of `@energy8engine/reel-core`'s
 * `MotionConfig` is listed by hand and every default below is a literal —
 * `tests/runtime.test.ts` checks them against `DEFAULT_REEL_CONFIG.motion`,
 * so they cannot drift.
 *
 * `style` doubles as both a `MotionConfig` field and the row's own pick of
 * WHICH registered motion style (built-in or a plugin's own) to activate —
 * see `./runtime`.
 */
import Schema from 'schemastery';

const Settle = Schema.object({
  amp: Schema.number().default(7).description('Overshoot amplitude in px applied to the reel before it springs back.'),
  ms: Schema.number().default(240).description('Settle duration.'),
  easing: Schema.union([
    'linear',
    'easeInQuad',
    'easeOutQuad',
    'easeInOutQuad',
    'easeInCubic',
    'easeOutCubic',
    'easeInOutCubic',
    'easeInBack',
    'easeOutBack',
    'easeInOutBack',
    'easeOutBounce',
    'easeInBounce',
    'easeOutElastic',
    'easeInSine',
    'easeOutSine',
    'easeInOutSine',
  ])
    .default('easeOutBack')
    .description('Settle easing.'),
}).description('Overshoot-then-spring-back on landing.');

const Squash = Schema.object({
  enabled: Schema.boolean().default(false).description('Squash & stretch on landing impact.'),
  scaleX: Schema.number().default(1.18).description('Wider scale on impact.'),
  scaleY: Schema.number().default(0.82).description('Shorter scale on impact.'),
  ms: Schema.number().default(90).description('Squash duration.'),
}).description('Squash & stretch on landing impact (Stone-Rush / magnus style).');

const Blur = Schema.object({
  enabled: Schema.boolean().default(false).description('Motion blur while spinning.'),
  alpha: Schema.number().default(0.85).description('Alpha applied to in-motion symbols (hot-ross uses 0.82).'),
  strength: Schema.number().default(8).description('Runtime BlurFilter strength factor (PixiJS slots demo uses ~8), 0 disables the filter.'),
  streaks: Schema.boolean().default(false).description('Draw vertical motion streaks behind moving symbols.'),
}).description('Motion blur while the reels are spinning.');

export const Config = Schema.object({
  style: Schema.string()
    .default('swap')
    .description('a registered motion style — built-in: swap, strip, cascade-drop'),
  spinUp: Schema.number().default(500).description('Base spin-up duration (ms) before the first reel can stop.'),
  hold: Schema.number().default(200).description('Extra hold (ms) at full speed before deceleration.'),
  stopStagger: Schema.number().default(120).description('Delay (ms) between consecutive reel stops in sequential mode.'),
  stopMode: Schema.union(['sequential', 'sync', 'random']).default('sequential').description('How reels stop relative to each other.'),
  stopOrder: Schema.union(['ltr', 'rtl']).default('ltr').description('Left-to-right or right-to-left stop order.'),
  settle: Settle,
  squash: Squash,
  blur: Blur,
  turboFactor: Schema.number().default(0.5).description('Multiply all durations in turbo mode (0.5 = twice as fast).'),
  intensity: Schema.union(['full', 'reduced', 'minimal']).default('full').description('Global animation-intensity scale (accessibility): full=1, reduced=0.7, minimal=0.4.'),
  slamStop: Schema.boolean().default(true).description('Allow slam/quick-stop (snaps reels to target without changing outcome).'),
  symbolsPerReel: Schema.natural().default(6).description('Symbols visible on a reel tape while spinning (swap/strip).'),
  cellStagger: Schema.number().default(24).description('cascade-drop: ms between consecutive cells of ONE reel (top→bottom).'),
  reelStaggerFactor: Schema.number().default(0.4).description('cascade-drop: multiplier on `stopStagger` for the per-reel offset.'),
  dropFallFactor: Schema.number().default(0.6).description('cascade-drop: fall duration as a fraction of `spinUp`.'),
  dropOrder: Schema.union(['top-down', 'bottom-up']).default('top-down').description('cascade-drop: which cell of a reel lands first.'),
  dropSequence: Schema.union(['parallel', 'chained', 'chained-when-anticipated'])
    .default('parallel')
    .description('cascade-drop: how reels are spaced — parallel, chained, or chained only once anticipated.'),
});
