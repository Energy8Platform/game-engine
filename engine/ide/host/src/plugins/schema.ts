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
          'error',
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
    // `parseSpinSchema`'s doc. Nothing to add.
    return { schema: null, diagnostics: parsed.diagnostics };
  }

  return {
    schema: parsed.schema,
    diagnostics: [...parsed.diagnostics, ...checkActionStages(parsed.schema)],
  };
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
