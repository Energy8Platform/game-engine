/**
 * The form the IDE draws for the `features1` row — `e8.runtime.schema` in this package's
 * manifest. Imported by the IDE HOST (a node process), so this module imports `schemastery` and
 * nothing else: `./runtime` and the nine handlers pull in `@energy8engine/reel-core` (and,
 * through it, pixi.js), and would not load there.
 *
 * Every default below is a literal, unlike `cascade1`/`motion1`/`anticipation1`'s schemas, which
 * mirror a `DEFAULT_REEL_CONFIG.<section>` reel-core already owns — there is no such section for
 * these nine kinds (they are new to this package, not part of the core reel-system config).
 * `./runtime` reads this module's own `Config({})` as its default, so there is exactly one place
 * that states them; `tests/schema.test.ts` is the guard against a leaf silently losing a
 * `.default()`.
 *
 * One section per kind, each with its OWN `enabled` — unlike `cascade1`, whose config carries no
 * `enabled` because the row's presence IS the switch (spec §3.3, one mechanic). `features1`
 * composes all nine kinds together, and a game that wants `walkWild` but no `giant` turns the
 * latter off without dropping the row (`./runtime` filters a disabled section's handler out of
 * what it registers).
 */
import Schema from 'schemastery';

/** `EasingName` (reel-core's easing map) as a plain string list — `schema.ts` cannot import the type. */
const EASING_NAMES = [
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
];

const enabled = (kind: string) =>
  Schema.boolean().default(true).description(`Turn the "${kind}" step on.`);

const easing = (fallback: string, what: string) =>
  Schema.string()
    .default(fallback)
    .description(
      `Easing name for ${what} — one of ${EASING_NAMES.join(', ')} (reel-core's easing map).`,
    );

export const Config = Schema.object({
  expandWild: Schema.object({
    enabled: enabled('expandWild'),
    ms: Schema.number().default(280).description("One row's morph, top to bottom."),
    holdMs: Schema.number()
      .default(500)
      .description('How long the rings stay once the last row has turned.'),
    ringColor: Schema.number()
      .default(0xffd700)
      .description('The glow ring color on each turned row.'),
  }).description(
    'The reel (or given rows) turns into a symbol, row by row, with a glow ring on each.',
  ),

  walkWild: Schema.object({
    enabled: enabled('walkWild'),
    morphMs: Schema.number()
      .default(240)
      .description("The symbol's morph in at the path's first cell."),
    stepMs: Schema.number().default(260).description('One step, cell to cell.'),
    easing: easing('easeInOutQuad', "the wild's step"),
    ringColor: Schema.number()
      .default(0xff66cc)
      .description('The glow ring on the cell the wild is entering.'),
  }).description('A wild walks cell to cell along a path, emptying every cell it leaves.'),

  dropWilds: Schema.object({
    enabled: enabled('dropWilds'),
    ms: Schema.number().default(280).description("One cell's drop."),
    staggerMs: Schema.number()
      .default(60)
      .description('Between one cell starting to drop and the next one starting.'),
  }).description('A symbol drops into each named cell from above, staggered cell to cell.'),

  reveal: Schema.object({
    enabled: enabled('reveal'),
    ms: Schema.number().default(280).description('The morph, every cell together.'),
  }).description('Every named cell morphs to a symbol at once (mystery symbols).'),

  transform: Schema.object({
    enabled: enabled('transform'),
    ms: Schema.number().default(280).description('The morph.'),
    pulseScale: Schema.number().default(1.15).description("The pulse's peak scale."),
    pulseMs: Schema.number().default(220).description('The pulse, up and back.'),
  }).description('Each named cell morphs to a symbol, then pulses.'),

  multipliers: Schema.object({
    enabled: enabled('multipliers'),
    pulseMs: Schema.number().default(240).description("Each cell's pulse, up and back."),
    labelMs: Schema.number().default(500).description("Each cell's ×value label."),
    totalMs: Schema.number().default(900).description("The combined total's label, when shown."),
    labelColor: Schema.number().default(0xffd24a).description("Each cell's label color."),
    totalColor: Schema.number().default(0xffe24a).description("The total's label color."),
  }).description(
    'Each named cell takes its multiplier badge and pulses, then floats a ×value label; an ' +
      'optional combined total floats at the grid centre.',
  ),

  sticky: Schema.object({
    enabled: enabled('sticky'),
    ringColor: Schema.number()
      .default(0xec4899)
      .description('The persistent ring color on a sticky cell.'),
  }).description(
    'A persistent ring on or off each named cell, on the row overlay layer — the symbol itself ' +
      'is left untouched.',
  ),

  giant: Schema.object({
    enabled: enabled('giant'),
    ms: Schema.number().default(420).description('The scale-in.'),
    easing: easing('easeOutBack', "the giant's scale-in"),
  }).description(
    'One oversized symbol spans a rectangle of cells, on the row overlay layer until the next ' +
      'spin starts.',
  ),

  nudge: Schema.object({
    enabled: enabled('nudge'),
    ms: Schema.number().default(240).description('The slide.'),
    easing: easing('easeOutBack', 'the slide'),
  }).description('A reel slides by whole rows, then lands on the settled column.'),
});
