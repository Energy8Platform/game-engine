/**
 * The props every node has, whatever its type — the runtime applies them
 * (`applyCommon`), a type's own `schema` never lists them. Imported by
 * the IDE client through the package's `./common-schema` export, so this
 * module imports `schemastery` and nothing else — no pixi.
 */
import Schema from 'schemastery';

export const COMMON = Schema.object({
  x: Schema.number().default(0).description('x, design px'),
  y: Schema.number().default(0).description('y, design px'),
  scale: Schema.number().default(1),
  rotation: Schema.number().default(0).description('radians'),
  alpha: Schema.number().default(1),
  visible: Schema.boolean().default(true),
  anchor: Schema.number().default(0).description('applies to views that have one'),
});
