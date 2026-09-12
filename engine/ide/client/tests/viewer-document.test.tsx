import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Context } from 'cordis';
import { diagnostic, type Diagnostic, type FileEntry } from '@energy8engine/contracts';
import { ViewerDocument, createIdeClient } from '../src/index';

/**
 * One file, looked at: what `AssetsScreen` showed once an entry was
 * clicked, with the tree itself gone to the Explorer. Every test below is
 * one of the old `assets-screen.test.tsx`'s preview tests (deleted with
 * `AssetsScreen` in Task 6), against the document instead of the
 * screen; the tree/upload/delete tests went to `explorer.test.tsx` in
 * Task 4.
 *
 * `harnessWithCalls()` goes through the real `createIdeClient` with a fake
 * `fetchFn`, same precedent `explorer.test.tsx` set; `calls` is what lets
 * the image test say "without reading its bytes" rather than assume it.
 */
function d(message: string): Diagnostic {
  return diagnostic('error', 'files', 'test', message);
}

function file(path: string, size = 0): FileEntry {
  return { path, kind: 'file', size };
}

async function harnessWithCalls(
  contents: Record<string, string> = {},
): Promise<{ ctx: Context; calls: string[] }> {
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
      return new Response(JSON.stringify({ entries: [], diagnostics: [] }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    const path = decodeURIComponent(url.slice('/api/files/'.length));
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
  return { ctx, calls };
}

async function harness(contents: Record<string, string> = {}): Promise<Context> {
  const { ctx } = await harnessWithCalls(contents);
  return ctx;
}

describe('ViewerDocument — ported from AssetsScreen', () => {
  it('an image is shown through urlFor, without reading its bytes', async () => {
    // This is exactly what `urlFor` is for: the browser fetches and
    // decodes the image itself. `calls` proves no GET for the bytes was
    // made on top of that.
    const { ctx, calls } = await harnessWithCalls();
    render(<ViewerDocument ctx={ctx} path="art/logo.png" entry={file('art/logo.png')} />);
    expect(screen.getByRole('img').getAttribute('src')).toBe('/api/files/art/logo.png');
    expect(calls.filter((u) => u.startsWith('/api/files/'))).toEqual([]);
  });

  it('a text file that is not the editor’s is shown as text', async () => {
    const ctx = await harness({ 'notes.txt': 'first-slot notes' });
    render(<ViewerDocument ctx={ctx} path="notes.txt" entry={file('notes.txt')} />);
    expect(await screen.findByText(/first-slot notes/)).toBeTruthy();
  });

  it('a file too big to show says so instead of hanging', async () => {
    // ponytail: a threshold, not streaming. Streaming is the upgrade once
    // this editor starts shipping video.
    const { ctx, calls } = await harnessWithCalls();
    render(<ViewerDocument ctx={ctx} path="big.bin" entry={file('big.bin', 50_000_000)} />);
    expect(await screen.findByTestId('too-big')).toBeTruthy();
    expect(calls.filter((u) => u.startsWith('/api/files/'))).toEqual([]); // never fetched
  });

  it('a small binary file that is not an image says so instead of rendering mush', async () => {
    const ctx = await harness({ 'data.bin': '\x00\x01\x02binary stuff' });
    render(<ViewerDocument ctx={ctx} path="data.bin" entry={file('data.bin')} />);
    expect(await screen.findByTestId('binary')).toBeTruthy();
  });

  it('a file that vanished between listing and opening says so, in the host’s own words', async () => {
    // The tree is a snapshot; the file the entry named can be gone by the
    // time the read resolves. The host's diagnostic, unchanged, and into
    // the one list too.
    const ctx = await harness({}); // reads — but it is already gone
    render(<ViewerDocument ctx={ctx} path="gone.txt" entry={file('gone.txt')} />);
    expect(await screen.findByText(/was not found/)).toBeTruthy();
    expect(ctx.connection.diagnostics.some((diag) => /was not found/.test(diag.message))).toBe(
      true,
    );
  });
});
