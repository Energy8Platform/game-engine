/**
 * The props every node has, whatever its type — the runtime applies them
 * (`applyCommon`), a type's own `schema` never lists them. Imported by
 * the IDE client through the package's `./common-schema` export, so this
 * module imports `schemastery` and nothing else — no pixi.
 *
 * The ones with no default (`width`, `height`, `tint`, `anchorX`,
 * `anchorY`) are deliberately optional: unset, each leaves what
 * `scale`/`anchor`/the view's own texture already did, rather than
 * overwriting it with a "neutral" value.
 */
import Schema from 'schemastery';

export const COMMON = Schema.object({
  x: Schema.number().default(0).description('x, design px'),
  y: Schema.number().default(0).description('y, design px'),
  scale: Schema.number().default(1),
  width: Schema.number().description('width, design px'),
  height: Schema.number().description('height, design px'),
  rotation: Schema.number().default(0).description('radians'),
  alpha: Schema.number().default(1),
  visible: Schema.boolean().default(true),
  tint: Schema.string().description('#rrggbb, where the view has a tint'),
  anchor: Schema.number().default(0).description('applies to views that have one'),
  anchorX: Schema.number().description('overrides anchor on x'),
  anchorY: Schema.number().description('overrides anchor on y'),
  mask: Schema.boolean().default(false).description('masks the parent with this node'),
});
