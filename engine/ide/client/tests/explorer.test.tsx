import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Context } from 'cordis';
import { diagnostic, type Diagnostic, type FileEntry } from '@energy8engine/contracts';
import { Explorer, createIdeClient, type FilesService } from '../src/index';

/**
 * One sidebar view over the project tree, replacing the tree-walking
 * `AssetsScreen` and `CodeScreen` each did on their own. Step 1 below
 * copies the tree/upload/delete tests that pin a property from
 * `assets-screen.test.tsx` (unchanged there — Task 6 still registers
 * `AssetsScreen` and its own tests stay put); Step 2 is what only Explorer
 * does: opening a document, folding, and fetching the tree exactly once.
 *
 * `harness()`/`harnessWithCalls()` go through the real `createIdeClient`
 * with a fake `fetchFn`, the same precedent `assets-screen.test.tsx` set.
 */

function d(message: string): Diagnostic {
  return diagnostic('error', 'files', 'test', message);
}

type TreeSpec = string | (Partial<FileEntry> & { path: string });

/** A bare name with no extension reads as a directory; anything else is a file. */
function entryFor(item: TreeSpec): FileEntry {
  if (typeof item !== 'string')
    return { path: item.path, kind: item.kind ?? 'file', size: item.size };
  const base = item.split('/').pop() ?? item;
  return /\.[^./]+$/.test(base)
    ? { path: item, kind: 'file', size: 0 }
    : { path: item, kind: 'dir' };
}

type TreeResult = { entries: FileEntry[] } | { diagnostics: Diagnostic[] };

/**
 * Unlike `assets-screen.test.tsx`'s own flat `tree()`, this one also fills
 * in every ancestor directory a given path implies (`'a/x'` implies a
 * directory `'a'`) — Explorer's own tests need a real hierarchy to fold,
 * where the asset screen's flat list never did. Explicit items win over an
 * implied one at the same path. Sorted by path, which — since a directory's
 * path is always a strict prefix of its own children's — reproduces "a
 * directory before the files nested under it" for free.
 */
function tree(items: TreeSpec[]): { entries: FileEntry[] } {
  const byPath = new Map<string, FileEntry>();
  for (const item of items) {
    const entry = entryFor(item);
    byPath.set(entry.path, entry);
  }
  for (const entry of [...byPath.values()]) {
    const segments = entry.path.split('/');
    for (let i = 1; i < segments.length; i++) {
      const dirPath = segments.slice(0, i).join('/');
      if (!byPath.has(dirPath)) byPath.set(dirPath, { path: dirPath, kind: 'dir' });
    }
  }
  return { entries: [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path)) };
}

/** `bytes('x')` — what a `File(['x'], …)` upload decodes to. Plain numbers, not `Uint8Array` — see `assets-screen.test.tsx`'s own comment on the cross-realm `toEqual` trap. */
function bytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

function decodeBase64(value: string): number[] {
  const binary = atob(value);
  return Array.from(binary, (c) => c.charCodeAt(0));
}

type TestFiles = FilesService & {
  written: [string, number[]][];
  removed: string[];
  nextTree(result: TreeResult): void;
};

/**
 * Returns the URLs the fake `fetchFn` actually received alongside `ctx` —
 * `harness()` below is this with `calls` dropped, for the tests that don't
 * care. `createIdeClient` always composes `gameComposition` too, which
 * fetches `/api/composition` unprompted at boot — answered here the same
 * way `assets-screen.test.tsx`'s own harness does.
 */
async function harnessWithCalls(
  result: TreeResult,
  contents: Record<string, string> = {},
  hostAnswers: { writeDiagnostics?: Diagnostic[]; removeDiagnostics?: Diagnostic[] } = {},
): Promise<{ ctx: Context & { files: TestFiles }; calls: string[] }> {
  let entries = 'entries' in result ? result.entries : [];
  let treeDiagnostics = 'diagnostics' in result ? result.diagnostics : [];
  const writeDiagnostics = hostAnswers.writeDiagnostics ?? [];
  const removeDiagnostics = hostAnswers.removeDiagnostics ?? [];
  const written: [string, number[]][] = [];
  const removed: string[] = [];
  const calls: string[] = [];

  const fetchFn = (async (input: unknown, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : String((input as { toString(): string }).toString());
    calls.push(url);
    const method = (init?.method ?? 'GET').toUpperCase();

    if (url === '/api/composition') {
      return new Response(JSON.stringify({ rows: [], diagnostics: [] }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url === '/api/files' && method === 'GET') {
      return new Response(JSON.stringify({ entries, diagnostics: treeDiagnostics }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    const path = decodeURIComponent(url.slice('/api/files/'.length));

    if (method === 'PUT') {
      const body = JSON.parse((init?.body as string | undefined) ?? '{}') as { base64?: string };
      written.push([path, decodeBase64(body.base64 ?? '')]);
      return new Response(JSON.stringify({ diagnostics: writeDiagnostics }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    if (method === 'DELETE') {
      removed.push(path);
      return new Response(JSON.stringify({ diagnostics: removeDiagnostics }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    if (Object.prototype.hasOwnProperty.call(contents, path)) {
      return new Response(contents[path]);
    }
    return new Response(JSON.stringify({ diagnostics: [d(`"${path}" was not found: ENOENT`)] }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  const socket = { readyState: 1, addEventListener() {}, send() {}, close() {} };
  const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: () => socket, fetchFn });

  const testFiles = ctx.files as TestFiles;
  testFiles.written = written;
  testFiles.removed = removed;
  testFiles.nextTree = (next) => {
    entries = 'entries' in next ? next.entries : [];
    treeDiagnostics = 'diagnostics' in next ? next.diagnostics : [];
  };

  return { ctx: ctx as Context & { files: TestFiles }, calls };
}

async function harness(
  result: TreeResult,
  contents: Record<string, string> = {},
  hostAnswers: { writeDiagnostics?: Diagnostic[]; removeDiagnostics?: Diagnostic[] } = {},
): Promise<Context & { files: TestFiles }> {
  const { ctx } = await harnessWithCalls(result, contents, hostAnswers);
  return ctx;
}

describe('Explorer — ported from AssetsScreen', () => {
  it('draws the project tree, directories before their files', async () => {
    render(<Explorer ctx={await harness(tree(['game', 'game/spec.json', 'index.html']))} />);
    const entries = await screen.findAllByTestId(/^explorer-(?!upload$|delete-|empty$)/);
    expect(entries.map((el) => el.getAttribute('data-testid'))).toEqual([
      'explorer-game',
      'explorer-game/spec.json',
      'explorer-index.html',
    ]);
  });

  it('an empty project says it is empty instead of drawing nothing', async () => {
    render(<Explorer ctx={await harness(tree([]))} />);
    expect(await screen.findByTestId('explorer-empty')).toBeTruthy();
  });

  it('a tree that could not be read shows the host’s own words', async () => {
    const ctx = await harness({ diagnostics: [d('the project directory is gone')] });
    render(<Explorer ctx={ctx} />);
    expect(await screen.findByText(/the project directory is gone/)).toBeTruthy();
  });

  it('the tree refreshes after an upload, without a page reload', async () => {
    const ctx = await harness(tree([]));
    render(<Explorer ctx={ctx} />);
    ctx.files.nextTree(tree(['logo.png']));
    await userEvent.upload(screen.getByTestId('explorer-upload'), new File(['x'], 'logo.png'));
    expect(await screen.findByTestId('explorer-logo.png')).toBeTruthy();
  });

  it('an upload the host refuses shows the host’s words and leaves the tree alone', async () => {
    const refusal = d('outside the project');
    const ctx = await harness(tree(['keep.png']), {}, { writeDiagnostics: [refusal] });
    render(<Explorer ctx={ctx} />);
    await screen.findByTestId('explorer-keep.png');
    ctx.files.nextTree(tree(['keep.png', 'logo.png']));
    await userEvent.upload(screen.getByTestId('explorer-upload'), new File(['x'], 'logo.png'));
    expect(await screen.findByText(/outside the project/)).toBeTruthy();
    expect(screen.queryByTestId('explorer-logo.png')).toBeNull();
    expect(ctx.connection.diagnostics).toContainEqual(refusal);
  });

  it('deleting asks first, and does nothing when the answer is no', async () => {
    const ctx = await harness(tree(['logo.png']));
    render(<Explorer ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('explorer-delete-logo.png'));
    await userEvent.click(screen.getByTestId('confirm-no'));
    expect(ctx.files.removed).toEqual([]);
    expect(screen.getByTestId('explorer-logo.png')).toBeTruthy();
  });

  it('a file the browser itself fails to read off disk says so, instead of doing nothing', async () => {
    const ctx = await harness(tree([]));
    const RealFileReader = globalThis.FileReader;
    class FailingFileReader {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      result: ArrayBuffer | null = null;
      error = { message: 'disk yanked' };
      readAsArrayBuffer() {
        queueMicrotask(() => this.onerror?.());
      }
    }
    // @ts-expect-error — a minimal test double, not a real FileReader
    globalThis.FileReader = FailingFileReader;
    try {
      render(<Explorer ctx={ctx} />);
      await userEvent.upload(screen.getByTestId('explorer-upload'), new File(['x'], 'logo.png'));
      expect(await screen.findByText(/disk yanked/)).toBeTruthy();
      expect(ctx.files.written).toEqual([]);
      expect(ctx.connection.diagnostics.some((diag) => /disk yanked/.test(diag.message))).toBe(
        true,
      );
    } finally {
      globalThis.FileReader = RealFileReader;
    }
  });
});

describe('Explorer', () => {
  it('clicking a file opens a document with that path as key', async () => {
    const ctx = await harness(tree(['game/script.spin']));
    render(<Explorer ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('explorer-game/script.spin'));
    expect(ctx.shell.active()?.key).toBe('f:game/script.spin');
  });

  it('clicking a directory folds it, and does not open anything', async () => {
    const ctx = await harness(tree(['game', 'game/spec.json']));
    render(<Explorer ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('explorer-game'));
    expect(screen.queryByTestId('explorer-game/spec.json')).toBeNull(); // folded
    expect(ctx.shell.documents()).toEqual([]);
    await userEvent.click(screen.getByTestId('explorer-game'));
    expect(screen.getByTestId('explorer-game/spec.json')).toBeTruthy(); // unfolded
  });

  it('clicking the same file twice activates the one tab', async () => {
    const ctx = await harness(tree(['a.txt', 'b.txt']));
    render(<Explorer ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('explorer-a.txt'));
    await userEvent.click(screen.getByTestId('explorer-b.txt'));
    await userEvent.click(screen.getByTestId('explorer-a.txt'));
    expect(ctx.shell.documents().map((d2) => d2.key)).toEqual(['f:a.txt', 'f:b.txt']);
    expect(ctx.shell.active()?.key).toBe('f:a.txt');
  });

  it('the tree is one tree() call, not one per fold', async () => {
    const { ctx, calls } = await harnessWithCalls(tree(['a/x', 'b/y']));
    render(<Explorer ctx={ctx} />);
    await screen.findByTestId('explorer-a');
    await userEvent.click(screen.getByTestId('explorer-a'));
    await userEvent.click(screen.getByTestId('explorer-b'));
    expect(calls.filter((u) => u.endsWith('/api/files')).length).toBe(1);
  });
});
