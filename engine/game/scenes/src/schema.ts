/**
 * The form the IDE draws for the `scenes1` row — `e8.runtime.schema` in
 * this package's manifest. Imported by the IDE HOST (a node process), so
 * this module imports `schemastery` and nothing else — `./runtime` pulls
 * in `pixi.js`. The row is `hot: true`: documents, node types and
 * transitions re-apply in place. The design resolutions alone (landscape
 * and portrait) stay `applies: 'restart'` (the shape the IDE's schema-form
 * reads as `needsRestart`): the game reloads to pick a new size up.
 */
import Schema from 'schemastery';

const restart = { applies: 'restart' };

export const Config = Schema.object({
  design: Schema.object({
    width: Schema.natural().description('design width, px').extra('extra', restart),
    height: Schema.natural().description('design height, px').extra('extra', restart),
  }).description('design resolution'),
  portrait: Schema.object({
    width: Schema.natural().description('portrait design width, px').extra('extra', restart),
    height: Schema.natural().description('portrait design height, px').extra('extra', restart),
  }).description('design size in portrait; empty = the landscape design rotated'),
  mode: Schema.union(['contain', 'cover']).default('contain').description('how the design fits the viewport'),
  transition: Schema.string().default('cut').description('default transition id for show()'),
  transitionMs: Schema.natural().default(300).description('transition length, ms'),
  fonts: Schema.array(
    Schema.object({
      family: Schema.string()
        .required()
        .description("font-family name — what a text node's `family` (or a bitmap font's fallback) names"),
      src: Schema.string()
        .required()
        .extra('asset', ['woff2', 'woff', 'ttf', 'otf'])
        .description('font file, project-relative'),
      weight: Schema.string().default('normal').description('CSS font-weight, e.g. "normal", "bold", "700"'),
      style: Schema.string().default('normal').description('CSS font-style, e.g. "normal", "italic"'),
    }),
  )
    .default([])
    .description('web fonts loaded before the first document mounts'),
});
