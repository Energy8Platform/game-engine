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

/**
 * The CSS colour names pixi's `Color` takes — it parses with
 * `@pixi/colord` plus that library's names plugin, and this is that
 * plugin's own table (W3C's frozen list) with `transparent`.
 */
const NAMES = `
  aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue
  blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk
  crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki
  darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen
  darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue
  dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite
  gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki
  lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan
  lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen
  lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen
  magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen
  mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream
  mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid
  palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum
  powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown
  seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen
  steelblue tan teal thistle tomato transparent turquoise violet wheat white whitesmoke
  yellow yellowgreen
`
  .trim()
  .split(/\s+/)
  .join('|');

/**
 * What the runtime reads as a colour, and so what a colour prop is allowed
 * to hold: empty (none / unset), `#` + 3, 4, 6 or 8 hex digits, an
 * `rgb()`/`rgba()`/`hsl()`/`hsla()` function form, or a CSS name — exactly
 * the set pixi's `Color` parses without throwing, pinned against `Color`
 * itself in `tests/node-types.test.ts`.
 *
 * Validating HERE, at schema time, is what makes a bad colour atomic: the
 * schema pass runs before anything is applied, so a typo can no longer
 * leave half a patch on the view — and the IDE host, which runs this very
 * schema without a game, refuses it statically.
 *
 * A `pattern` rather than a transform on purpose. `meta.pattern` survives
 * the JSON round-trip the host (`new Schema(what the game reported)`) and
 * the client (`JSON.parse(JSON.stringify(COMMON))`) both do, where a
 * transform's callback would not; and it leaves `type: 'string'`, so the
 * Properties form still draws a text field instead of "unsupported".
 */
export const COLOUR = new RegExp(
  `^(?:|#(?:[\\da-f]{3,4}|[\\da-f]{6}|[\\da-f]{8})|(?:rgb|hsl)a?\\([^()]*\\)|${NAMES})$`,
  'i',
);

/**
 * A prop bound to the data of the cell a symbol landed in —
 * `'$cell.multiplier'`. No schema ever validates one (the flow's `$path`
 * strings are not validated either): the symbols runtime resolves it on
 * `bind`, and until then the prop stands at its type's empty, below. Here
 * rather than in `symbols` so the host's static check (`checkNode`) and
 * that runtime agree on the one rule.
 */
const CELL = '$cell.';
export const isCellBinding = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith(CELL);

/** The cell field a binding reads: `'$cell.multiplier'` → `'multiplier'`. */
export const cellField = (binding: string): string => binding.slice(CELL.length);

/** What an unresolved binding stands in as, so neither a schema nor a type's `update` sees the raw string. */
export const emptyProp = (type?: string): string | number | boolean =>
  type === 'number' ? 0 : type === 'boolean' ? false : '';

export const COMMON = Schema.object({
  x: Schema.number().default(0).description('x, design px'),
  y: Schema.number().default(0).description('y, design px'),
  scale: Schema.number().default(1),
  width: Schema.number().description('width, design px'),
  height: Schema.number().description('height, design px'),
  rotation: Schema.number().default(0).description('radians'),
  alpha: Schema.number().default(1),
  visible: Schema.boolean().default(true),
  tint: Schema.string().pattern(COLOUR).description('#rrggbb, where the view has a tint'),
  anchor: Schema.number().default(0).description('applies to views that have one'),
  anchorX: Schema.number().description('overrides anchor on x'),
  anchorY: Schema.number().description('overrides anchor on y'),
  mask: Schema.boolean().default(false).description('masks the parent with this node'),
});
