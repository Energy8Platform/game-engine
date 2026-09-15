/**
 * `e8 check` — "what is wrong with this `.spin`", as data. The parser's
 * own severities travel untouched: unlike the host's `schema` plugin,
 * which demotes a parse loss to a `warning` because a half-read schema
 * must not stop a running game, this is the reading a person asked for
 * outright, and a dropped declaration is exactly what they want to hear.
 */
import { readFile } from 'node:fs/promises';
import { diagnostic, type Diagnostic, type SpinSchema } from '@energy8engine/contracts';
import { parseSpinSchema } from '@energy8engine/spin-parser';

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
  const { schema, diagnostics } = parseSpinSchema(source);
  return schema ? { file: input.file, diagnostics, schema } : { file: input.file, diagnostics };
}
