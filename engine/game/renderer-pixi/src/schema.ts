/**
 * The form the IDE draws for the `renderer1` row — `e8.runtime.schema` in
 * this package's manifest. Imported by the IDE HOST (a node process), so
 * this module imports `schemastery` and nothing else — `./runtime` pulls
 * in `pixi.js`. Every field is `applies: 'restart'` (the shape the IDE's
 * schema-form reads as `needsRestart`): a canvas is not resized in place,
 * and the row is `hot: false` to match.
 */
import Schema from 'schemastery';

const restart = { applies: 'restart' };

export const Config = Schema.object({
  width: Schema.natural()
    .description('canvas width, px — leave width and height empty to fill the mount')
    .extra('extra', restart),
  height: Schema.natural()
    .description('canvas height, px — leave width and height empty to fill the mount')
    .extra('extra', restart),
  background: Schema.string().description('canvas background colour').extra('extra', restart),
});
