/**
 * The form the IDE draws for the `anticipation1` row — `e8.runtime.schema`
 * in this package's manifest. Imported by the IDE HOST (a node process),
 * so this module imports `schemastery` and nothing else: `./runtime` pulls
 * in `@energy8engine/reel-core` (and, through it, pixi.js), and would not
 * load there. That is why every field of `@energy8engine/reel-core`'s
 * `AnticipationConfig` is listed by hand and every default below is a
 * literal — `tests/runtime.test.ts` checks them against
 * `DEFAULT_REEL_CONFIG.anticipation`, so they cannot drift.
 *
 * `decide` — a game-supplied function overriding the built-in
 * trigger-symbol counting — is left out on purpose, the same way `reels`'
 * own schema leaves out `resolve`: a function has no schema-drawable form
 * and its default is `null` (off) anyway. It still rides the row's config
 * from code (a bundle/patch row cannot carry a function, so it has to
 * arrive some other way); this schema just never offers it as a field.
 */
import Schema from 'schemastery';

export const Config = Schema.object({
  enabled: Schema.boolean().default(false).description('Turn anticipation on.'),
  triggerSymbols: Schema.array(Schema.string())
    .default(['scatter'])
    .description('Symbols that count toward the anticipation threshold (scatter/bonus).'),
  threshold: Schema.natural()
    .default(2)
    .description('Number of trigger symbols already landed that arms anticipation (N−1, usually 2).'),
  reels: Schema.union([Schema.const('trailing'), Schema.array(Schema.natural())])
    .default('trailing')
    .description('Which reels get the slow treatment: the still-spinning trailing reels, or explicit indices.'),
  slowdownFactor: Schema.number()
    .default(0.3)
    .description("Multiply the trailing reel's spin speed (lower = slower / longer)."),
  holdMs: Schema.number()
    .default(400)
    .description('Extra hold (ms) before the final anticipation reel lands (300–500 typical).'),
  progressiveSlowdown: Schema.number()
    .default(1)
    .description(
      'Ramp the slowdown across successive anticipated reels: reel #i gets slowdownFactor * this ** i. 1 = flat; < 1 = each reel slower than the last.',
    ),
  progressiveHoldMs: Schema.number()
    .default(0)
    .description('Extra hold (ms) added per successive anticipated reel: reel #i gets holdMs + i * this.'),
  progressiveCellStagger: Schema.number()
    .default(1)
    .description(
      'cascade-drop: how the gap between successive cells grows inside an anticipated reel. 1 keeps cells evenly spaced.',
    ),
  zoom: Schema.object({
    enabled: Schema.boolean().default(false).description('Zoom the grid in while anticipating.'),
    scale: Schema.number().default(1.15).description('Zoom scale (magnum-opus uses 1.3×).'),
    ms: Schema.number().default(600).description('Zoom duration.'),
  }).description('Optional grid zoom while anticipating.'),
});
