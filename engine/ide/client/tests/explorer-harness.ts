import type { Context } from 'cordis';
import { diagnostic, type Diagnostic, type FileEntry } from '@energy8engine/contracts';
import { createIdeClient, type FilesService } from '../src/index';

/**
 * The one Explorer test harness, shared by `explorer.test.tsx` and
 * `explorer-dnd.test.tsx`. `harness()`/`harnessWithCalls()` go through the
 * real `createIdeClient` with a fake `fetchFn`, the same precedent
 * `assets-screen.test.tsx` set; the fake records every write, remove,
 * create and move it answered so a test can check what the view asked for.
 */

export function d(message: string): Diagnostic {
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

export type TreeResult = { entries: FileEntry[] } | { diagnostics: Diagnostic[] };

/**
 * Unlike `assets-screen.test.tsx`'s own flat `tree()`, this one also fills
 * in every ancestor directory a given path implies (`'a/x'` implies a
 * directory `'a'`) — Explorer's own tests need a real hierarchy to fold,
 * where the asset screen's flat list never did. Explicit items win over an
 * implied one at the same path. Sorted by path, which — since a directory's
 * path is always a strict prefix of its own children's — reproduces "a
 * directory before the files nested under it" for free.
 */
export function tree(items: TreeSpec[]): { entries: FileEntry[] } {
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
export function bytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

function decodeBase64(value: string): number[] {
  const binary = atob(value);
  return Array.from(binary, (c) => c.charCodeAt(0));
}

export type TestFiles = FilesService & {
  written: [string, number[]][];
  removed: string[];
  created: [string, 'dir' | 'file'][];
  moved: [string, string][];
  nextTree(result: TreeResult): void;
};

type HostAnswers = {
  writeDiagnostics?: Diagnostic[];
  removeDiagnostics?: Diagnostic[];
  createDiagnostics?: Diagnostic[];
  moveDiagnostics?: Diagnostic[];
};

/**
 * Returns the URLs the fake `fetchFn` actually received alongside `ctx` —
 * `harness()` below is this with `calls` dropped, for the tests that don't
 * care. `createIdeClient` always composes `gameComposition` too, which
 * fetches `/api/composition` unprompted at boot — answered here the same
 * way `assets-screen.test.tsx`'s own harness does.
 */
export async function harnessWithCalls(
  result: TreeResult,
  contents: Record<string, string> = {},
  hostAnswers: HostAnswers = {},
): Promise<{ ctx: Context & { files: TestFiles }; calls: string[] }> {
  let entries = 'entries' in result ? result.entries : [];
  let treeDiagnostics = 'diagnostics' in result ? result.diagnostics : [];
  const writeDiagnostics = hostAnswers.writeDiagnostics ?? [];
  const removeDiagnostics = hostAnswers.removeDiagnostics ?? [];
  const createDiagnostics = hostAnswers.createDiagnostics ?? [];
  const moveDiagnostics = hostAnswers.moveDiagnostics ?? [];
  const written: [string, number[]][] = [];
  const removed: string[] = [];
  const created: [string, 'dir' | 'file'][] = [];
  const moved: [string, string][] = [];
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

    if (method === 'POST') {
      const body = JSON.parse((init?.body as string | undefined) ?? '{}') as {
        kind: 'dir' | 'file';
      };
      created.push([path, body.kind]);
      return new Response(JSON.stringify({ diagnostics: createDiagnostics }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    if (method === 'PATCH') {
      const body = JSON.parse((init?.body as string | undefined) ?? '{}') as { to: string };
      moved.push([path, body.to]);
      return new Response(JSON.stringify({ diagnostics: moveDiagnostics }), {
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
  testFiles.created = created;
  testFiles.moved = moved;
  testFiles.nextTree = (next) => {
    entries = 'entries' in next ? next.entries : [];
    treeDiagnostics = 'diagnostics' in next ? next.diagnostics : [];
  };

  return { ctx: ctx as Context & { files: TestFiles }, calls };
}

export async function harness(
  result: TreeResult,
  contents: Record<string, string> = {},
  hostAnswers: HostAnswers = {},
): Promise<Context & { files: TestFiles }> {
  const { ctx } = await harnessWithCalls(result, contents, hostAnswers);
  return ctx;
}
