/**
 * A game authored the platform way is a `GameSpec` — `game/spec.json`
 * holds the grid, the bet levels, the max win, the symbol table and the
 * paytable — plus a LOGIC-ONLY `game/script.spin`. The symbol indices and
 * pay rows the logic is written against are not in that file: they are
 * what `defineGame(spec).spinPrelude` generates (`SPEC`, `SYMBOLS`,
 * `N_SYMBOLS`, `SYM`, `PAY_COUNTS`, `PAY_<ID>`, `VAL_<ID>`). Such a
 * `script.spin` therefore does NOT compile on its own — "unknown variable
 * 'SYM'" is the whole of what `e8 check` has to say about it — and the IDE
 * used to hand exactly that file to e8-server, the spin parser and
 * `e8 check`, so a spec-authored game could not run at all.
 *
 * `assemble()` closes that: it writes `prelude ⧺ logic` to
 * `.e8/game/script.spin` and hands back the games dir e8-server should be
 * pointed at and the `.spin` every reader should read. `.e8/` is the
 * host's own scratch — `files.ts` refuses to write there (`PROTECTED_DIRS`)
 * and every project gitignores it — so nothing loops and nothing lands in
 * the author's tree.
 *
 * A `spec.json` that is NOT a `GameSpec` (the descriptive metadata
 * `first-slot` and `slot-basic` ship: numeric symbol ids, `weight`, no
 * `type`) is left completely alone — the project's own `game/` stays the
 * games dir, byte for byte what it always was.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { diagnostic, type Diagnostic } from '@energy8engine/contracts';
import {
  buildSpinScript,
  defineGame,
  type GameSpec,
  type SymbolSpec,
} from '@energy8platform/platform-core/game-spec';

/** Project-relative, and the `where` of everything this module reports. */
const SPEC_JSON = 'game/spec.json';
const LOGIC_SPIN = 'game/script.spin';
/** Where `prelude ⧺ logic` lands. Project-relative; `files.ts` protects `.e8`. */
export const ASSEMBLED_SPIN = '.e8/game/script.spin';

export interface Assembled {
  /** e8-server's `--games-dir` — the folder holding the `.spin` it should load. */
  gamesDir: string;
  /** Absolute path of the `.spin` a reader should read. */
  spinFile: string;
  /**
   * Generated lines sitting above the author's line 1 in `spinFile` — `0`
   * unless this is a `GameSpec` project. Subtract it from a diagnostic's
   * line to name the line the author can actually edit.
   */
  preludeLines: number;
  diagnostics: Diagnostic[];
}

/**
 * Is this `spec.json` a `GameSpec` (assemble it) or the older descriptive
 * metadata (leave it alone)? The three marks are the ones the two shapes
 * disagree on: a `GameSpec` declares `type: 'slot'`, and its `symbols` are
 * `SymbolSpec`s — string ids carrying a `pay` row — where the descriptive
 * shape's are `{ id: number, name, weight }`.
 */
export function isGameSpec(value: unknown): value is GameSpec {
  const spec = value as Partial<GameSpec> | null | undefined;
  return (
    !!spec &&
    spec.type === 'slot' &&
    Array.isArray(spec.symbols) &&
    (spec.symbols as SymbolSpec[])[0]?.pay !== undefined
  );
}

/**
 * The two files whose save has to re-run `assemble` before anything else
 * happens (`dev-game.ts`'s restart-on-write): the spec the prelude is
 * generated FROM, and the logic it is prepended TO. Absolute.
 */
export function specSources(root: string): string[] {
  return [join(root, SPEC_JSON), join(root, LOGIC_SPIN)];
}

/**
 * `prelude ⧺ logic` → `.e8/game/script.spin`, for a project whose
 * `game/spec.json` is a `GameSpec`.
 *
 * Every failure is a `Diagnostic` and leaves the answer exactly where a
 * project with no spec at all would have it (`root/game`) — never a throw,
 * and never a half-assembled file: `defineGame` (which runs `validateSpec`
 * itself, so there is no separate call) and the logic read both happen
 * before anything is written.
 *
 * Only `script.spin` is copied into `.e8/game`. e8-server's `--games-dir`
 * loads `.spin` files and nothing else, and no reader anywhere looks for
 * `<gamesDir>/spec.json` (`compute/spin.ts` reads the author's
 * `game/spec.json` by path), so a second copy of the spec beside the
 * assembly would be a file with no reader.
 */
export async function assemble(root: string): Promise<Assembled> {
  const gamesDir = join(root, 'game');
  const plain: Assembled = {
    gamesDir,
    spinFile: join(root, LOGIC_SPIN),
    preludeLines: 0,
    diagnostics: [],
  };

  let spec: unknown;
  try {
    spec = JSON.parse(await readFile(join(root, SPEC_JSON), 'utf8'));
  } catch {
    // No spec.json, or one that is not JSON. Not this module's to report:
    // `readGameConfig` says the same thing with the message it always had.
    return plain;
  }
  if (!isGameSpec(spec)) return plain;

  let model: ReturnType<typeof defineGame>;
  try {
    model = defineGame(spec);
  } catch (error) {
    return {
      ...plain,
      diagnostics: [
        diagnostic(
          'error',
          'spec',
          SPEC_JSON,
          `${SPEC_JSON} is a GameSpec that cannot be used: ${message(error)}`,
          `fix ${SPEC_JSON}; the game keeps the math it last assembled`,
        ),
      ],
    };
  }

  let logic: string;
  try {
    logic = await readFile(plain.spinFile, 'utf8');
  } catch (error) {
    return {
      ...plain,
      diagnostics: [
        diagnostic(
          'error',
          'spec',
          LOGIC_SPIN,
          `cannot read ${LOGIC_SPIN}: ${message(error)}`,
          `write the game's math into ${LOGIC_SPIN}; ${SPEC_JSON} generates only the SPEC/SYM/PAY_* prelude above it`,
        ),
      ],
    };
  }

  const out = join(root, '.e8', 'game');
  await mkdir(out, { recursive: true });
  const spinFile = join(out, 'script.spin');
  await writeFile(spinFile, buildSpinScript(model, logic), 'utf8');
  return {
    gamesDir: out,
    spinFile,
    // `buildSpinScript` is `spinPrelude + '\n' + logic` and `spinPrelude`
    // ends in a newline, so the author's line 1 is line
    // `split('\n').length + 1` of the assembly — i.e. exactly this many
    // generated lines above it.
    preludeLines: model.spinPrelude.split('\n').length,
    diagnostics: [],
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
