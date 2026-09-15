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

export interface CheckInput {
  /** Absolute or cwd-relative path to a `.spin`. */
  file: string;
}

export interface CheckResult {
  file: string;
  diagnostics: Diagnostic[];
  schema?: SpinSchema;
}

export async function check(input: CheckInput): Promise<CheckResult> {
  let source: string;
  try {
    source = await readFile(input.file, 'utf8');
  } catch (error) {
    return {
      file: input.file,
      diagnostics: [
        diagnostic(
          'error',
          'compute',
          input.file,
          `cannot read ${input.file}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      ],
    };
  }
  return { file: input.file, ...checkSource(source, input.file) };
}
