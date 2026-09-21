/**
 * `e8 check` — "what is wrong with this `.spin`", as data. One rule: the
 * CLI gives the SAME verdict as the IDE's panel. It calls the host's
 * `checkSource` (`plugins/schema.ts`, the function `/api/check` answers
 * with) and adds no severity policy of its own — a parse loss is a
 * `warning` and an action naming an undeclared stage an `error`, in both
 * places, for the reasons that module's doc argues once.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { diagnostic, type Diagnostic, type SpinSchema } from '@energy8engine/contracts';
import { checkSource } from '../plugins/schema';
import { assemble } from '../plugins/spec';

export interface CheckInput {
  /**
   * Absolute or cwd-relative path to a `.spin`. Omitted, the project's own
   * `game/script.spin` is checked — always the AUTHORED file, GameSpec
   * project or not: `checkSource`'s parser only reads declarations and
   * skips every `const` (all the prelude holds), so it already yields the
   * full schema straight from the author's file, at the author's own line
   * numbers — never the `.e8/game/script.spin` assembly (shifted lines,
   * a filename the explorer skips). See `plugins/spec.ts`.
   */
  file?: string;
  /** Project directory the default `file` is resolved against. Default `process.cwd()`. */
  cwd?: string;
}

export interface CheckResult {
  file: string;
  diagnostics: Diagnostic[];
  schema?: SpinSchema;
}

export async function check(input: CheckInput): Promise<CheckResult> {
  // `assemble` only runs for the default file: an explicit path is checked
  // exactly as given, and never writes anything. Its own diagnostics ARE
  // the verdict — a `game/spec.json` that could not produce a prelude is
  // what is wrong with this project, and the authored logic, which still
  // parses on its own, would otherwise put a `schema` beside that error
  // that reads as "the game is fine". Its `spinFile` is NOT what gets read
  // below either: the default `file` is always the authored
  // `game/script.spin`, GameSpec or not (see `CheckInput.file`'s doc).
  const cwd = input.cwd ?? process.cwd();
  const assembled = input.file === undefined ? await assemble(cwd) : null;
  const file = input.file ?? join(cwd, 'game', 'script.spin');
  const fromSpec = assembled?.diagnostics ?? [];
  if (fromSpec.length) return { file, diagnostics: fromSpec };
  let source: string;
  try {
    source = await readFile(file, 'utf8');
  } catch (error) {
    return {
      file,
      diagnostics: [
        diagnostic(
          'error',
          'compute',
          file,
          `cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      ],
    };
  }
  const checked = checkSource(source, file);
  return { file, ...checked };
}
