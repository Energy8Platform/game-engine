/**
 * The form the IDE draws for the `stage1` row — `e8.runtime.schema` in
 * this package's manifest. Imported by the IDE HOST (a node process), so
 * this module imports `schemastery` and nothing else — `./runtime` pulls
 * in `pixi.js`. The row is `hot: true`: layers, scenes and transitions
 * re-apply in place (`runtime.ts` tears the old stage down without
 * destroying what other rows mounted into it). The design resolution alone
 * stays `applies: 'restart'` (the shape the IDE's schema-form reads as
 * `needsRestart`): the game reloads to pick a new size up.
 */
import Schema from 'schemastery';

const restart = { applies: 'restart' };

export const Config = Schema.object({
  design: Schema.object({
    width: Schema.natural().description('design width, px').extra('extra', restart),
    height: Schema.natural().description('design height, px').extra('extra', restart),
  }).description('design resolution'),
  layers: Schema.array(
    Schema.object({
      id: Schema.string().required().description('layer id'),
      z: Schema.number().default(0).description('draw order, low first'),
    }),
  )
    .default([{ id: 'reels', z: 0 }])
    .description('layers, children of the stage'),
  scenes: Schema.dict(
    Schema.object({
      layers: Schema.array(Schema.string()).default([]).description('layers visible in this scene'),
      transition: Schema.string().description('transition id; the stage default when empty'),
    }),
  )
    .default({})
    .description('scene id (a spin stage) → what it shows'),
  transition: Schema.string().default('cut').description('default transition id'),
  transitionMs: Schema.natural().default(300).description('transition length, ms'),
});
