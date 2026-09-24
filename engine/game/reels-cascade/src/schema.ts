/**
 * The form the IDE draws for the `cascade1` row — `e8.runtime.schema` in this package's
 * manifest. Imported by the IDE HOST (a node process), so this module imports `schemastery` and
 * nothing else: `./runtime` pulls in `@energy8engine/reel-core` (and, through it, pixi.js), and
 * would not load there. That is why every field of `@energy8engine/reel-core`'s `CascadeConfig`
 * is listed by hand and every default below is a literal — `tests/runtime.test.ts` checks them
 * against `DEFAULT_REEL_CONFIG.cascade`, so they cannot drift.
 *
 * Every field but `enabled`. The row's presence IS the cascade switch (spec §3.3): a
 * composition with `cascade1` tumbles and plays `reelStep`, one without it does not, and
 * `./runtime` always hands the controllers `enabled: true`. A checkbox that could say `false`
 * while the row stood there would be a second switch saying the opposite of the first.
 */
import Schema from 'schemastery';

const easing = (fallback: string, what: string) =>
  Schema.string()
    .default(fallback)
    .description(`Easing name for the ${what} phase (see reel-core's easing map).`);

export const Config = Schema.object({
  gravity: Schema.boolean()
    .default(true)
    .description('Animate surviving symbols sliding down into the gaps (true tumble).'),
  timings: Schema.object({
    reveal: Schema.number().default(300).description('Reveal phase (ms).'),
    highlight: Schema.number().default(400).description('Winning-cell highlight (ms).'),
    remove: Schema.number().default(250).description('Winning-cell removal (ms).'),
    drop: Schema.number().default(220).description('Survivors dropping into the gaps (ms).'),
    refill: Schema.number()
      .default(220)
      .description('Fresh symbols dropping in from the top (ms).'),
    wait: Schema.number().default(150).description('Pause after a step settles (ms).'),
  }).description('Per-phase durations of one cascade / reelStep round.'),
  easings: Schema.object({
    highlight: easing('easeOutQuad', 'highlight'),
    remove: easing('easeInBack', 'remove'),
    drop: easing('easeOutBounce', 'drop'),
  }).description('Per-phase easings.'),
  perStepDecel: Schema.number()
    .default(0.08)
    .description(
      'reelStep only: slow each successive round to build tension, factor = 1 + round * this ' +
        '(capped). No effect on tumble, which the board plays one step per call.',
    ),
  perStepDecelCap: Schema.number()
    .default(1.5)
    .description('reelStep only: cap on the per-round slowdown factor (no effect on tumble).'),
  dimNonWinners: Schema.boolean()
    .default(false)
    .description('Dim non-winning symbols during the highlight phase.'),
  dimAlpha: Schema.number().default(0.35).description('Alpha of the dimmed non-winners.'),
  multiplier: Schema.object({
    enabled: Schema.boolean()
      .default(false)
      .description('Show a running win multiplier that climbs per step.'),
    start: Schema.number().default(1).description('Multiplier at the first step.'),
    mode: Schema.union([Schema.const('add'), Schema.const('mul')])
      .default('add')
      .description("'add' → +step each step; 'mul' → ×step each step."),
    step: Schema.number().default(1).description('Amount added or multiplied per step.'),
    cap: Schema.union([Schema.number(), Schema.const(null)])
      .default(null)
      .description('Highest the multiplier goes; empty = no cap.'),
    persistInFreeSpins: Schema.boolean()
      .default(false)
      .description('Keep climbing across free spins instead of resetting per spin.'),
  }).description(
    'Running win multiplier (Pragmatic Tumble / Avalanche). No effect yet: the controllers ' +
      'count it, but nothing in the engine draws or reads it.',
  ),
});
