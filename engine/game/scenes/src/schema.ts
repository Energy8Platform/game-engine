/**
 * The form the IDE draws for the `scenes1` row — `e8.runtime.schema` in
 * this package's manifest. Imported by the IDE HOST (a node process), so
 * this module imports `schemastery` and nothing else — `./runtime` pulls
 * in `pixi.js`. The row is `hot: true`: documents, node types and
 * transitions re-apply in place. The design resolution alone stays
 * `applies: 'restart'` (the shape the IDE's schema-form reads as
 * `needsRestart`): the game reloads to pick a new size up.
 */
import Schema from 'schemastery';

const restart = { applies: 'restart' };

export const Config = Schema.object({
  design: Schema.object({
    width: Schema.natural().description('design width, px').extra('extra', restart),
    height: Schema.natural().description('design height, px').extra('extra', restart),
  }).description('design resolution'),
  mode: Schema.union(['contain', 'cover']).default('contain').description('how the design fits the viewport'),
  transition: Schema.string().default('cut').description('default transition id for show()'),
  transitionMs: Schema.natural().default(300).description('transition length, ms'),
});
