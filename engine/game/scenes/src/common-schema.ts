/**
 * The props every node has, whatever its type — the runtime applies them
 * (`applyCommon`), a type's own `schema` never lists them. Imported by
 * the IDE client through the package's `./common-schema` export, so this
 * module imports `schemastery` and `@energy8engine/contracts` (types and
 * the pure expression resolver a bound prop runs through) and nothing
 * else — no pixi.
 *
 * The ones with no default (`width`, `height`, `tint`, `anchorX`,
 * `anchorY`) are deliberately optional: unset, each leaves what
 * `scale`/`anchor`/the view's own texture already did, rather than
 * overwriting it with a "neutral" value.
 */
import Schema from 'schemastery';
import { resolveValue } from '@energy8engine/contracts';

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

/** One argument of a function form: `1`, `1.5`, `.5` — a number, never a name (`rgb(a,b,c)`). */
const NUM = '\\d*\\.?\\d+';
const PCT = `${NUM}%`;
const ANY = `${NUM}%?`;
/**
 * A function form in either CSS syntax, each whole — pixi's `Color` throws
 * on a mix (`rgb(1,2,3/0.5)`, `rgb(1 , 2 3)`): the legacy comma form with
 * an optional `, alpha`, or the space form with an optional `/ alpha`.
 * `hsl`'s saturation and lightness carry the `%` (`hsl(120, 50, 50)` is
 * refused by `Color` too).
 */
const form = (fn: string, a: string, b: string, c: string) =>
  `${fn}a?\\(\\s*(?:${a}\\s*,\\s*${b}\\s*,\\s*${c}(?:\\s*,\\s*${ANY})?|${a}\\s+${b}\\s+${c}(?:\\s*/\\s*${ANY})?)\\s*\\)`;
const FN = `${form('rgb', ANY, ANY, ANY)}|${form('hsl', NUM, PCT, PCT)}`;

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
  `^(?:|#(?:[\\da-f]{3,4}|[\\da-f]{6}|[\\da-f]{8})|${FN}|${NAMES})$`,
  'i',
);

/**
 * A prop that reads the data of the cell a symbol landed in: a bare field
 * (`'$cell.multiplier'`), an expression over one (`'$cell.layer > 0'`,
 * `'$cell.mv * 2'`) or a template (`'x{$cell.mv}'`,
 * `'{$cell.mv | multiplier}'`). The test is only "the string mentions
 * `$cell`" because the resolver decides the rest — see `cellProps`. The
 * word boundary is what keeps a var that merely STARTS like it
 * (`'$cellular'`) out.
 *
 * Three consequences of taking the whole expression grammar, none of them
 * visible in the examples above:
 *   - A cell FIELD has to be an identifier now, because the path is
 *     PARSED. `'$cell.step-win'` is `$cell.step` minus `win`, not a field
 *     called `step-win` — and `win` is missing, so it resolves to `NaN`.
 *     Name the field `step_win`.
 *   - A string that mentions `$cell` with neither `{…}` nor a leading `$`
 *     (`'Win $cell.mv'`) is still a binding by this test, but the resolver
 *     sees neither a template nor an expression and answers the string AS
 *     WRITTEN: it resolves to itself, silently. Wrap the span:
 *     `'Win {$cell.mv}'`.
 *   - `'$cell'` alone resolves to the cell OBJECT, which a string prop
 *     renders as `[object Object]`. Name a field.
 *
 * No schema ever validates one (the flow's `$path` strings are not
 * validated either): the symbols runtime resolves it on `bind`, and until
 * then the prop stands at its type's empty, below. Here rather than in
 * `symbols` so the host's static check (`checkNode`) and that runtime
 * agree on the one rule.
 */
const CELL = /\$cell\b/;
export const isCellBinding = (value: unknown): value is string =>
  typeof value === 'string' && CELL.test(value);

/**
 * What an unresolved binding stands in as, so neither a schema nor a
 * type's `update` sees the raw string. Takes the prop's schema (its live
 * `Schema` or the host's rehydrated one — both carry `type`, and a union
 * its `list` of literals), or the bare type name where that is all the
 * caller has: a `union` stands at its FIRST literal, the one value every
 * union accepts, where `''` would be refused by `shape.kind`.
 */
export const emptyProp = (
  schema?: string | { type?: string; list?: { value?: unknown }[] },
): string | number | boolean => {
  const type = typeof schema === 'string' ? schema : schema?.type;
  if (type === 'number') return 0;
  if (type === 'boolean') return false;
  // A live `Schema` is callable (`typeof` 'function'), the host's rehydrated one too: anything but the bare name.
  if (type === 'union' && schema && typeof schema !== 'string') {
    const first = schema.list?.[0]?.value;
    if (typeof first === 'string' || typeof first === 'number' || typeof first === 'boolean')
      return first;
  }
  return '';
};

/**
 * The nine points of the safe rect a node can `pin` to. Lives here (not
 * in `node-types`, where `pinPoint` reads it) because the schema below
 * needs the list and this module must stay pixi-free.
 */
export const PINS = [
  'top-left',
  'top',
  'top-right',
  'left',
  'center',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right',
] as const;
export type Pin = (typeof PINS)[number];

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
  // A union of literals, not a transform: it survives the JSON round-trip
  // to the IDE (see `COLOUR` above) and the Properties form draws it as a
  // select.
  pin: Schema.union(['', ...PINS])
    .default('')
    .description("anchors x/y to this point of the safe rect (x/y become offsets); '' = absolute"),
});

/** One prop's schema as `emptyProp` reads it: its `type`, and a union's `list` of literals. */
type PropSchema = { type?: string; list?: { value?: unknown }[] };
const dictOf = (schema: unknown): Record<string, PropSchema | undefined> =>
  (schema as { dict?: Record<string, PropSchema> }).dict ?? {};

/**
 * A bound prop's value: what the expression resolved to, coerced to the
 * prop's schema type — the way a flow's `prop` coerces. A template has
 * already produced a string; a bare field or arithmetic hands over
 * whatever the cell held, so the coercion is what a typed prop relies on.
 */
function boundValue(value: unknown, entry?: PropSchema): unknown {
  const type = entry?.type;
  if (value === undefined || value === null) return emptyProp(entry);
  if (type === 'number') {
    const n = Number(value);
    return Number.isNaN(n) ? 0 : n;
  }
  if (type === 'boolean') return typeof value === 'string' ? value === 'true' : Boolean(value);
  return type === 'string' ? String(value) : value;
}

/**
 * A node's props with every `$cell` binding resolved against one cell's
 * data — the one place a binding turns into a value, shared by
 * `@energy8engine/symbols` (a symbol's own states) and the scenes runtime
 * (a cell scene, and any other mount, where an unresolved binding simply
 * stands at its empty value rather than failing the schema).
 *
 * The value is a full expression (`resolveValue`): a template, a format
 * pipe, a comparison or arithmetic, not just a bare field — so a view
 * string like `'x{$cell.mv}'` belongs to the document rather than to the
 * mechanic that pre-computed it. The vars are `{ cell }` and nothing else,
 * so `| currency` finds no `$session` and falls back to two decimals with
 * no symbol. A malformed expression is one `report` and the prop stands at
 * its empty — the string as written is no value for a typed prop.
 *
 * With NO data (a mount before the first `bind`) nothing is evaluated at
 * all: the prop stands at its empty, and even a malformed expression is
 * silent until there is a cell to resolve it against.
 *
 * The schema never sees a binding: that prop's EMPTY stands in for the
 * validation, which is what makes a binding valid whatever the prop's type
 * (the host's `checkNode` does the same), and the resolved value — never
 * validated, like a flow's `$path` — is put back on top. A prop the type
 * does not declare is read through `COMMON` instead (a `$cell.*` on
 * `alpha` is a number too).
 *
 * `bound` is what a later `bind()` must re-resolve: the keys that carried
 * a binding, in declaration order. A prop that is not bound keeps whatever
 * the document said, so the schema sees the author's own value.
 */
export const cellProps = (
  type: { schema: Schema },
  raw: Record<string, unknown>,
  data?: Record<string, unknown>,
  report?: (message: string) => void,
): { props: Record<string, unknown>; bound: string[] } => {
  const own = dictOf(type.schema);
  const common = dictOf(COMMON);
  const input: Record<string, unknown> = {};
  const resolved: Record<string, unknown> = {};
  const bound: string[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (!isCellBinding(value)) {
      input[key] = value;
      continue;
    }
    // The ENTRY, not its type name: a union's empty is its first literal (`text.align` → 'left').
    const entry = own[key] ?? common[key];
    input[key] = emptyProp(entry);
    resolved[key] = input[key];
    if (data) {
      // `resolveValue` answers the string AS WRITTEN when it cannot parse
      // it, which no typed prop wants: the flag turns that into the empty.
      let bad = false;
      const out = resolveValue(value, { cell: data }, (message) => {
        bad = true;
        report?.(message);
      });
      if (!bad) resolved[key] = boundValue(out, entry);
    }
    bound.push(key);
  }
  return { props: { ...(type.schema(input) as Record<string, unknown>), ...resolved }, bound };
};
