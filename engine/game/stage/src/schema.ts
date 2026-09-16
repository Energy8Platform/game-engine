/**
 * The form the IDE draws for the `stage1` row — `e8.runtime.schema` in
 * this package's manifest. Imported by the IDE HOST (a node process), so
 * this module imports `schemastery` and nothing else — `./runtime` pulls
 * in `pixi.js`. The design resolution is `applies: 'restart'` (the shape
 * the IDE's schema-form reads as `needsRestart`): the row is `hot: false`,
 * and the game reloads to pick a new size up.
 */
import Schema from 'schemastery';

const restart = { applies: 'restart' };

export const Config = Schema.object({
  design: Schema.object({
    width: Schema.natural().description('design width, px').extra('extra', restart),
    height: Schema.natural().description('design height, px').extra('extra', restart),
  }).description('design resolution'),
});
