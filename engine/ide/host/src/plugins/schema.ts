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
 * The other half of that line, and the reason the two halves belong in one
 * doc: `game-runtime`'s pre-flight `checkAgainstSchema` reports at
 * `error`, so a finding there DOES stop a game. It used to be unable to
 * tell a schema that parsed cleanly from one that half-parsed, which meant
 * a parse loss landing on the very field a bound mechanic requires stopped
 * the game on a claim that was false — "the math's schema does not declare
 * it" about a field the math declares. That is closed: the partiality now
 * travels with the schema, as `SpinSchema.gaps` (see `SchemaGap` in
 * `@energy8engine/contracts`), the parser fills it in wherever it drops
 * something, and the pre-flight stays quiet about anything it covers. This
 * file changes nothing about that and needs to change nothing: `gaps`
 * rides along inside the schema value served over `/api/composition`.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Context } from 'cordis';
import {
  type Diagnostic,
  type DiagnosticsResponse,
  diagnostic,
  type SpinSchema,
} from '@energy8engine/contracts';
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

  // `/api/check` needs `ctx.server`, which the host registers AFTER this
  // plugin (see index.ts) — reactive `ctx.inject`, not a static top-level
  // `inject`, on purpose: a static `inject = ['server']` would defer this
  // whole `apply()`, including `ctx.provide('spinSchema', ...)` above, and
  // every consumer that reads `ctx.spinSchema` synchronously right after
  // `createIdeHost()` resolves (this file's own tests, `runtime-assets.ts`)
  // would see it arrive one tick too late. Same shape `runtime-assets.ts`
  // already uses for its own optional `devGameRoot` reaction.
  ctx.inject(['server'], (scope: Context) => {
    /**
     * "What is wrong with this text" — for `.spin` text that lives only in
     * a browser editor buffer, never written to `game/script.spin`.
     * `parseSpinSchema` is pure (see its own doc comment), so this route
     * needs no temp file and touches nothing on disk.
     *
     * Deliberately calls `checkSource` directly
     * rather than `service.reload()`: `spinSchema` is what the composition
     * screen reads, and a keystroke in an unsaved editor must never rewrite
     * what the rest of the IDE believes about the file that IS saved.
     */
    scope.server.post('/api/check', async (req, res) => {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        // Absent or unparseable body — a diagnostic below, never a throw.
        // Same shape as `PUT /api/files/*`'s body parsing in files.ts.
        body = undefined;
      }

      const source = (body as Partial<{ source: string }> | undefined)?.source;
      if (typeof source !== 'string') {
        res.status = 400;
        const refusal: DiagnosticsResponse = {
          diagnostics: [
            diagnostic(
              'error',
              'schema',
              '/api/check',
              'POST /api/check needs a JSON body shaped {"source": string}',
            ),
          ],
        };
        res.json(refusal);
        return;
      }

      const response: DiagnosticsResponse = { diagnostics: checkSource(source).diagnostics };
      res.json(response);
    });
  });
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

  const { schema, diagnostics } = checkSource(content);
  return { schema: schema ?? null, diagnostics };
}

/**
 * THE verdict on a `.spin` text — what `/api/check` answers, what this
 * plugin holds after `reload()`, and what `e8 check` prints
 * (`../compute/check.ts`). One function so the three can never disagree
 * about the same source: every parser diagnostic degrades to a `warning`
 * and `checkActionStages` adds its own `error`s, exactly as the module doc
 * argues. `where` names the file in the stage diagnostics; the parser's own
 * carry `line N` and are left alone.
 */
export function checkSource(
  source: string,
  where = SPIN_FILENAME,
): { schema?: SpinSchema; diagnostics: Diagnostic[] } {
  const parsed = parseSpinSchema(source);
  const diagnostics = toDiagnostics(parsed, where);
  return parsed.schema ? { schema: parsed.schema, diagnostics } : { diagnostics };
}

/**
 * `parseSpinSchema`'s raw output, turned into what a consumer should show:
 * every parser diagnostic degrades to a `warning` (a `.spin` this parser
 * could not read is a fact about THIS PARSER, not the game — see the
 * module doc), plus `checkActionStages`'s own `error`-severity judgement
 * about a schema that WAS read cleanly.
 *
 * Reached only through `checkSource`, which `readSpinSchema` (a file on
 * disk), `/api/check` (a string an editor is still typing) and `e8 check`
 * all route through, so none can report the same input two different
 * ways — see the module doc's "Severity, and why it is not decoration".
 */
function toDiagnostics(
  parsed: { schema: SpinSchema | null; diagnostics: Diagnostic[] },
  where: string,
): Diagnostic[] {
  if (parsed.schema === null) {
    // The parser's own diagnostic already names what was missing — see
    // `parseSpinSchema`'s doc. Nothing to add but the severity.
    return parsed.diagnostics.map(asWarning);
  }
  return [...parsed.diagnostics.map(asWarning), ...checkActionStages(parsed.schema, where)];
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
function checkActionStages(schema: SpinSchema, where: string): Diagnostic[] {
  const stageNames = Object.keys(schema.stages);
  const diagnostics: Diagnostic[] = [];
  for (const action of schema.actions) {
    if (stageNames.includes(action.stage)) continue;
    diagnostics.push(
      diagnostic(
        'error',
        'schema',
        where,
        `action "${action.name}" names stage "${action.stage}", which "${where}" does not declare — it declares: ${
          stageNames.length > 0 ? stageNames.join(', ') : '(none)'
        }`,
        `fix the stage name on action "${action.name}", or add "${action.stage}" to the SpinData enum`,
      ),
    );
  }
  return diagnostics;
}
