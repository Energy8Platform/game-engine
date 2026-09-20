/**
 * `e8 check` — "what is wrong with this `.spin`", as data. One rule: the
 * CLI gives the SAME verdict as the IDE's panel. It calls the host's
 * `checkSource` (`plugins/schema.ts`, the function `/api/check` answers
 * with) and adds no severity policy of its own — a parse loss is a
 * `warning` and an action naming an undeclared stage an `error`, in both
 * places, for the reasons that module's doc argues once.
 */
import { readFile } from 'node:fs/promises';
import { diagnostic, type Diagnostic, type SpinSchema } from '@energy8engine/contracts';
import { checkSource } from '../plugins/schema';
import { assemble } from '../plugins/spec';

export interface CheckInput {
  /**
   * Absolute or cwd-relative path to a `.spin`. Omitted, the project's own
   * math is checked: `game/script.spin`, or — when `game/spec.json` is a
   * `GameSpec` — the `.e8/game/script.spin` the host assembles from it,
   * which is the only form of that game the compiler would accept. See
   * `plugins/spec.ts`.
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
  // exactly as given, and never writes anything.
  const file = input.file ?? (await assemble(input.cwd ?? process.cwd())).spinFile;
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
  return { file, ...checkSource(source, file) };
}
