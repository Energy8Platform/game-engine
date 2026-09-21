/**
 * `run()` with collectors in place of `process`: the two promises the
 * binary makes that no real command path can stage — a throw inside a
 * command still yields the one JSON document (every failure the commands
 * know is already a diagnostic, so the throw is injected), and `--help`
 * is text, exit 0, on any command. The real binary is exercised in
 * engine/ide/host/tests/cli-smoke.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { build, check, shot, spin } from '@energy8engine/ide-host/compute';
import { run, USAGE, type Io } from '../src/run';

/** Collectors; stdout flushes on a later tick, the way a pipe does, and says when it has. */
function io(): Io & { out: string; err: string; flushed: boolean } {
  const collectors = {
    out: '',
    err: '',
    flushed: false,
    stdout: {
      write(chunk: string, callback?: (error?: Error | null) => void) {
        collectors.out += chunk;
        setTimeout(() => {
          collectors.flushed = true;
          callback?.();
        }, 5);
        return true;
      },
    },
    stderr: {
      write(chunk: string) {
        collectors.err += chunk;
        return true;
      },
    },
    cwd: () => '/nowhere',
    env: {},
  };
  return collectors;
}

describe('run', () => {
  it('a command that throws is still one JSON document: a compute error naming the command, exit 1', async () => {
    const o = io();
    const code = await run(['spin', '--n', '3'], o, {
      build,
      check,
      shot,
      async spin() {
        throw new Error('boom');
      },
    });
    expect(code).toBe(1);
    expect(o.err).toBe('');
    expect(JSON.parse(o.out)).toEqual({
      diagnostics: [{ severity: 'error', plugin: 'compute', where: 'e8 spin', message: 'boom' }],
    });
    expect(o.out.endsWith('}\n')).toBe(true);
    // Resolved only once stdout said the document is out: `process.exit`
    // follows this return, and a bare write to a macOS pipe would lose it.
    expect(o.flushed).toBe(true);
  });

  it('a non-Error throw is stringified the same way', async () => {
    const o = io();
    expect(await run(['check'], o, { build, spin, shot, check: () => Promise.reject('no') })).toBe(1);
    expect(JSON.parse(o.out).diagnostics).toEqual([
      { severity: 'error', plugin: 'compute', where: 'e8 check', message: 'no' },
    ]);
  });

  it('`--help` on any command is the usage on stdout, exit 0, and documents the output', async () => {
    for (const argv of [['--help'], ['-h'], ['check', '--help'], ['shot', '--out', 'x', '-h']]) {
      const o = io();
      expect(await run(argv, o), argv.join(' ')).toBe(0);
      expect(o.out, argv.join(' ')).toBe(USAGE + '\n');
      expect(o.err).toBe('');
    }
    expect(USAGE.split('\n')[0]).toContain('help is text');
    expect(USAGE).toContain('output:');
    for (const field of [
      'incompleteRounds',
      'or answered no next action',
      'loadMs',
      'rtp',
      'npx playwright install chromium',
    ]) {
      expect(USAGE).toContain(field);
    }
  });

  it('a flag the command does not take is refused before the command runs', async () => {
    const o = io();
    let ran = false;
    const code = await run(['check', '--bogus'], o, {
      build,
      spin,
      shot,
      async check() {
        ran = true;
        return { file: '', diagnostics: [] };
      },
    });
    expect(code).toBe(1);
    expect(ran).toBe(false);
    expect(JSON.parse(o.out).diagnostics).toMatchObject([{ where: '--bogus' }]);
    // `--quiet` is accepted by every one-shot command, a no-op where there is no stderr.
    const quiet = io();
    expect(
      await run(['check', '--quiet'], quiet, {
        build,
        spin,
        shot,
        check: async () => ({ file: '', diagnostics: [] }),
      }),
    ).toBe(0);
  });

  it('`e8 build` is a one-shot command: a bad flag is refused, `--target platform` reaches build()', async () => {
    const refused = io();
    let ran = false;
    const fake = async (input: { cwd: string; target?: string; base?: string; out?: string }) => {
      ran = true;
      return { out: input.out ?? 'dist', files: [], diagnostics: [], input };
    };
    expect(await run(['build', '--bogus'], refused, { check, spin, shot, build: fake })).toBe(1);
    expect(ran).toBe(false);
    expect(JSON.parse(refused.out).diagnostics).toMatchObject([{ where: '--bogus' }]);

    const o = io();
    expect(await run(['build', '--target', 'platform'], o, { check, spin, shot, build: fake })).toBe(
      0,
    );
    expect(ran).toBe(true);
    expect(JSON.parse(o.out).input).toEqual({ cwd: '/nowhere', target: 'platform' });
    expect(USAGE).toContain('e8 build [--target <name>] [--base <path>] [--out <dir>]');
  });

  it('an unknown command is the usage on stderr, exit 1', async () => {
    const o = io();
    expect(await run(['bogus'], o)).toBe(1);
    expect(o.out).toBe('');
    expect(o.err).toBe(USAGE + '\n');
  });
});
