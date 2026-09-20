/**
 * A game authored the platform way is a `GameSpec` — `game/spec.json`
 * holds the grid, the bet levels, the max win, the symbol table and the
 * paytable — plus a LOGIC-ONLY `game/script.spin`. The symbol indices and
 * pay rows the logic is written against are not in that file: they are
 * what `defineGame(spec).spinPrelude` generates (`SPEC`, `SYMBOLS`,
 * `N_SYMBOLS`, `SYM`, `PAY_COUNTS`, `PAY_<ID>`, `VAL_<ID>`). Such a
 * `script.spin` therefore does NOT compile on its own — "unknown variable
 * 'SYM'" is e8-server's own compiler error, seen through `e8 spin` or a
 * live session, never `e8 check`'s: that command is parse-only
 * (`checkSource`/`parseSpinSchema` read declarations, not variable
 * references) and always reads the authored file regardless — and the IDE
 * used to hand the authored file to e8-server and the spin parser, so a
 * spec-authored game could not run at all.
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
import { join, resolve } from 'node:path';
import { diagnostic, type Diagnostic } from '@energy8engine/contracts';
import {
  buildSpinScript,
  defineGame,
  type GameSpec,
} from '@energy8platform/platform-core/game-spec';

/** Project-relative, and the `where` of everything this module reports. */
const SPEC_JSON = 'game/spec.json';
const LOGIC_SPIN = 'game/script.spin';
/** Where `prelude ⧺ logic` lands. Project-relative; `files.ts` skips and protects `.e8`. */
const ASSEMBLED_DIR = '.e8/game';

export interface Assembled {
  /** e8-server's `--games-dir` — the folder holding the `.spin` it should load. */
  gamesDir: string;
  /** Absolute path of the `.spin` a reader should read. */
  spinFile: string;
  diagnostics: Diagnostic[];
}

/**
 * Is this `spec.json` a `GameSpec` (assemble it) or the older descriptive
 * metadata (leave it alone)? `type` is the mark: a `GameSpec` declares
 * `type: 'slot'`, and no descriptive `spec.json` in this repo carries a
 * `type` field at all. `symbols` being an array is the one shape check
 * worth keeping — everything downstream iterates it.
 *
 * Deliberately NOT `symbols[0].pay`: the first symbol of a real game is
 * often a wild or a scatter, which pays nothing and carries no `pay` row.
 */
export function isGameSpec(value: unknown): value is GameSpec {
  const spec = value as Partial<GameSpec> | null | undefined;
  return !!spec && spec.type === 'slot' && Array.isArray(spec.symbols);
}

/**
 * Numbers `toSpinPrelude` interpolates straight into the generated text.
 * `validateSpec` lets a MISSING one through — its guards are comparisons
 * (`spec.maxWin <= 0`), and `undefined <= 0` is `false` — and the prelude
 * then emits `max_win: undefined` or `cells: NaN`, turning a mistake in
 * `spec.json` into a compile error about a file nobody wrote. Measured
 * against `derive.ts`'s `toSpinPrelude`: these three are all of them (a
 * missing `pay` entry falls back to `0`, a missing `value` emits nothing,
 * and every other field either throws inside `validateSpec` — caught
 * below — or never reaches the prelude).
 */
const PRELUDE_NUMBERS: Array<[string, (spec: GameSpec) => unknown]> = [
  ['maxWin', (spec) => spec.maxWin],
  ['grid.cols', (spec) => spec.grid?.cols],
  ['grid.rows', (spec) => spec.grid?.rows],
];

/**
 * The two files whose save has to re-run `assemble` before anything else
 * happens (`dev-game.ts`'s restart-on-write): the spec the prelude is
 * generated FROM, and the logic it is prepended TO. Absolute.
 */
export function specSources(root: string): string[] {
  return [resolve(root, SPEC_JSON), resolve(root, LOGIC_SPIN)];
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
  const plain: Assembled = { gamesDir, spinFile: join(root, LOGIC_SPIN), diagnostics: [] };
  const refuse = (where: string, text: string, fix: string): Assembled => ({
    ...plain,
    diagnostics: [diagnostic('error', 'spec', where, text, fix)],
  });

  let spec: unknown;
  try {
    spec = JSON.parse(await readFile(join(root, SPEC_JSON), 'utf8'));
  } catch {
    // No spec.json, or one that is not JSON. Not this module's to report:
    // `readGameConfig` says the same thing with the message it always had.
    return plain;
  }
  if (!isGameSpec(spec)) return plain;

  const missing = PRELUDE_NUMBERS.filter(([, read]) => typeof read(spec) !== 'number').map(
    ([name]) => name,
  );
  if (missing.length) {
    return refuse(
      SPEC_JSON,
      `${SPEC_JSON} is a GameSpec missing a number the generated prelude needs: ${missing.join(', ')}`,
      `give ${missing.join(' and ')} a number in ${SPEC_JSON}`,
    );
  }

  let model: ReturnType<typeof defineGame>;
  try {
    model = defineGame(spec);
  } catch (error) {
    return refuse(
      SPEC_JSON,
      `${SPEC_JSON} is a GameSpec that cannot be used: ${message(error)}`,
      `fix ${SPEC_JSON}; the game keeps the math it last assembled`,
    );
  }

  let logic: string;
  try {
    logic = await readFile(plain.spinFile, 'utf8');
  } catch (error) {
    return refuse(
      LOGIC_SPIN,
      `cannot read ${LOGIC_SPIN}: ${message(error)}`,
      `write the game's math into ${LOGIC_SPIN}; ${SPEC_JSON} generates only the SPEC/SYM/PAY_* prelude above it`,
    );
  }

  const out = join(root, ASSEMBLED_DIR);
  const spinFile = join(out, 'script.spin');
  const next = buildSpinScript(model, logic);
  // Only when it actually differs. Every reader assembles for itself, so
  // the same bytes get produced several times per boot and on every
  // refresh; rewriting them would churn mtimes under anything watching
  // `.e8/` and make a no-op look like an edit.
  if ((await readFile(spinFile, 'utf8').catch(() => null)) !== next) {
    await mkdir(out, { recursive: true });
    await writeFile(spinFile, next, 'utf8');
  }
  return { gamesDir: out, spinFile, diagnostics: [] };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
