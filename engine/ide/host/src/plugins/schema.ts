/**
 * Reads the project's `game/script.spin` and exposes the `SpinSchema` it
 * declares — what the math promises about its own shape, read once at
 * boot rather than inferred from the data of a spin that already ran.
 *
 * Same shape and same rule as `./project.ts`'s `ProjectService`: a live
 * getter pair plus `reload()`, and nothing here ever throws. A missing or
 * unparseable `.spin` is the most likely first-run mistake there is (no
 * math written yet, or a typo mid-edit) — it becomes a `Diagnostic`, not a
 * crash, so the host still starts and the browser can show why the
 * composition screen has no schema instead of going blank.
 *
 * `@energy8engine/spin-parser`'s `parseSpinSchema` does the actual
 * reading; this file adds exactly one judgement the parser's own
 * `isSpinSchema` deliberately refuses to make (see that type's doc
 * comment in `@energy8engine/contracts`): whether an action names a stage
 * the schema's `stages` map does not declare. That is a question about
 * MEANING, not shape, and belongs on the consumer side — the parser
 * itself only checks that a `SpinSchema` value is well-formed.
 *
 * That check only ever fires under the tagged-enum dialect
 * (`enum SpinData tag stage { … }`), where the set of stages is genuinely
 * closed and an author can mistype `stage = free_spins` against an enum
 * that never declared it. Under the flat `data = <Record>` dialect
 * `parseSpinSchema` derives a `stages` entry for every distinct
 * `action.stage` it sees (see `SpinSchema.stages`'s own doc comment) — so
 * every action's stage is, by construction, always a key of `stages`
 * there, and this check can never have anything to report.
 *
 * **Severity, and why it is not decoration.** Any `error` diagnostic in
 * the composition makes `createGame` paint the failure screen over the
 * game's mount (`game/runtime/src/index.ts`) — so the severity chosen
 * here decides whether an unreadable `.spin` STOPS a game or merely
 * annotates it. The line this file draws:
 *
 *  - **Reading and parsing** the file (`readSpinSchema`'s two failure
 *    paths, plus every per-declaration diagnostic `parseSpinSchema`
 *    itself produces) is a `warning`. A `.spin` this parser could not
 *    read is a fact about THIS PARSER, not about the game: SpinML's real
 *    compiler lives elsewhere, the math runs through that one, and a
 *    project with no `game/script.spin` at all composed and played
 *    perfectly well before a schema existed to read. A descriptive
 *    re-implementation must not be able to veto a game it only describes.
 *    This is also what makes the parser's own "half a schema plus a
 *    diagnostic beats nothing" design worth anything downstream: half a
 *    schema that still blanks the screen is not better than nothing.
 *  - **`checkActionStages`** stays an `error`. It is not a claim about
 *    our reading; it is a contradiction inside a file we DID read — an
 *    action naming a stage the same file's own enum never declared.
 *
 * The residual, stated because it is not fixed here: the pre-flight in
 * `game-runtime`'s `checkAgainstSchema` also reports at `error`, and it
 * cannot tell a schema that parsed CLEANLY from one that half-parsed. A
 * parse loss that lands on the very field a bound mechanic requires
 * therefore still stops the game, on a claim ("the math's schema does not
 * declare it") that is false — the math declares it, we just could not
 * read it. Closing that needs the partiality to travel on the wire, which
 * is a change to `SpinSchema` itself; see final-fix-report.md.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Context } from 'cordis';
import { type Diagnostic, diagnostic, type SpinSchema } from '@energy8engine/contracts';
import { parseSpinSchema } from '@energy8engine/spin-parser';

declare module 'cordis' {
  interface Context {
    spinSchema: SpinSchemaService;
  }
}

export interface SpinSchemaService {
  readonly schema: SpinSchema | null;
  readonly diagnostics: Diagnostic[];
  /** Re-reads and re-parses `game/script.spin`. Never throws. */
  reload(): Promise<void>;
}

export interface SpinSchemaConfig {
  /** Project directory; `game/script.spin` lives here. */
  cwd: string;
}

const SPIN_FILENAME = 'game/script.spin';

export const name = 'schema';

export async function apply(ctx: Context, config: SpinSchemaConfig): Promise<void> {
  let schema: SpinSchema | null = null;
  let diagnostics: Diagnostic[] = [];

  async function load(): Promise<void> {
    const result = await readSpinSchema(config.cwd);
    schema = result.schema;
    diagnostics = result.diagnostics;
  }

  const service: SpinSchemaService = {
    get schema() {
      return schema;
    },
    get diagnostics() {
      return diagnostics;
    },
    reload: load,
  };

  await load();
  ctx.provide('spinSchema', service);
}

async function readSpinSchema(
  cwd: string,
): Promise<{ schema: SpinSchema | null; diagnostics: Diagnostic[] }> {
  const filename = join(cwd, SPIN_FILENAME);
  let content: string;
  try {
    content = await readFile(filename, 'utf8');
  } catch (error) {
    return {
      schema: null,
      diagnostics: [
        diagnostic(
          'warning',
          'schema',
          SPIN_FILENAME,
          `cannot read ${SPIN_FILENAME}: ${error instanceof Error ? error.message : String(error)}`,
          `create ${filename} with the game's math declarations (game/action/record/enum)`,
        ),
      ],
    };
  }

  const parsed = parseSpinSchema(content);
  if (parsed.schema === null) {
    // The parser's own diagnostic already names what was missing — see
    // `parseSpinSchema`'s doc. Nothing to add but the severity.
    return { schema: null, diagnostics: parsed.diagnostics.map(asWarning) };
  }

  return {
    schema: parsed.schema,
    // Every parser diagnostic degrades; only this file's own judgement
    // about a schema it DID read stops the game. See the module doc.
    diagnostics: [...parsed.diagnostics.map(asWarning), ...checkActionStages(parsed.schema)],
  };
}

/**
 * Re-stamps a `spin-parser` diagnostic as a `warning`.
 *
 * The severity is decided HERE, not in the parser, because it is a policy
 * about what an unreadable `.spin` means to a running game — and the
 * parser is a pure function that knows nothing about games, failure
 * screens, or who else might one day read a `.spin` for reasons where a
 * dropped record IS fatal. `parseSpinSchema` states the fact ("this
 * declaration was dropped, here is which one"); this consumer decides what
 * it costs. Everything else about the diagnostic — its `plugin`
 * (`spin-parser`, so the message still names who noticed), `where`,
 * message and fix — travels untouched.
 */
function asWarning(d: Diagnostic): Diagnostic {
  return { ...d, severity: 'warning' };
}

/** See this module's doc comment for the full reasoning. */
function checkActionStages(schema: SpinSchema): Diagnostic[] {
  const stageNames = Object.keys(schema.stages);
  const diagnostics: Diagnostic[] = [];
  for (const action of schema.actions) {
    if (stageNames.includes(action.stage)) continue;
    diagnostics.push(
      diagnostic(
        'error',
        'schema',
        SPIN_FILENAME,
        `action "${action.name}" names stage "${action.stage}", which "${SPIN_FILENAME}" does not declare — it declares: ${
          stageNames.length > 0 ? stageNames.join(', ') : '(none)'
        }`,
        `fix the stage name on action "${action.name}", or add "${action.stage}" to the SpinData enum`,
      ),
    );
  }
  return diagnostics;
}
