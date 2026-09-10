import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Context } from 'cordis';
import { diagnostic, type Diagnostic, type FileEntry } from '@energy8engine/contracts';
import { AssetsScreen, createIdeClient, type FilesService } from '../src/index';

/**
 * Falling tests for Task 5: the project tree, and what one entry contains.
 * Task 6 (upload/delete) adds to the same `harness()` rather than growing
 * a second variant — see the extras below, all of them derived from
 * intercepting the fake `fetchFn`'s PUT/DELETE calls, since there is no
 * fake `files` service to poke directly: the screen runs against the real
 * one `createIdeClient` provides. `harness()` goes through the real
 * `createIdeClient`, matching `composition-screen.test.tsx`/
 * `preview.test.tsx`'s own precedent for a SCREEN test — not
 * `files.test.ts`'s single-service `apply()` harness, which only proves
 * the service in isolation, not that a screen mounted against the real
 * client draws it.
 */

/** These tests only care about `.message` — severity/plugin/where are fixed filler. */
function d(message: string): Diagnostic {
  return diagnostic('error', 'files', 'test', message);
}

type TreeSpec = string | (Partial<FileEntry> & { path: string });

/** A bare name with no extension reads as a directory; anything else is a file — the same convention every path in this suite already follows. */
function entryFor(item: TreeSpec): FileEntry {
  if (typeof item !== 'string') return { path: item.path, kind: item.kind ?? 'file', size: item.size };
  const base = item.split('/').pop() ?? item;
  return /\.[^./]+$/.test(base) ? { path: item, kind: 'file', size: 0 } : { path: item, kind: 'dir' };
}

type TreeResult = { entries: FileEntry[] } | { diagnostics: Diagnostic[] };

function tree(items: TreeSpec[]): { entries: FileEntry[] } {
  return { entries: items.map(entryFor) };
}

/**
 * `bytes('x')` — what a `File(['x'], …)` upload decodes to on the other
 * end. Plain numbers, not a `Uint8Array`: jsdom's test realm and Node's
 * own construct distinct `Uint8Array` classes, and `toEqual` on two
 * same-valued instances from different realms fails despite an identical
 * printed diff — the classic "no visual difference" assertion failure.
 * Comparing plain arrays sidesteps that entirely.
 */
function bytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

function decodeBase64(value: string): number[] {
  const binary = atob(value);
  return Array.from(binary, (c) => c.charCodeAt(0));
}

/**
 * What the harness hands back beyond the plain `Context` every earlier
 * screen test already returned: the PUT/DELETE calls the fake `fetchFn`
 * actually received, and a way to change what the next `GET /api/files`
 * answers — the harness's own stand-in for "the host's tree changed",
 * since nothing in this suite runs a real host to change it for real.
 * Attached onto `ctx.files` itself (the real service `files.ts` provides)
 * rather than a second object, because `written`/`removed`/`nextTree` are
 * observations ABOUT that one real service's traffic, not a competing
 * implementation of it.
 */
type TestFiles = FilesService & {
  written: [string, number[]][];
  removed: string[];
  nextTree(result: TreeResult): void;
};

/**
 * `createIdeClient` always composes `gameComposition` too, which fetches
 * `/api/composition` unprompted at boot (see `App.test.tsx`'s own harness,
 * which answers it for the same reason) — every fake `fetchFn` below has to
 * answer that alongside `/api/files` or the promise it kicks off rejects
 * into an unrelated diagnostic this suite isn't testing.
 */
async function harness(
  result: TreeResult,
  contents: Record<string, string> = {},
  hostAnswers: { writeDiagnostics?: Diagnostic[]; removeDiagnostics?: Diagnostic[] } = {},
): Promise<Context & { files: TestFiles }> {
  let entries = 'entries' in result ? result.entries : [];
  let treeDiagnostics = 'diagnostics' in result ? result.diagnostics : [];
  const writeDiagnostics = hostAnswers.writeDiagnostics ?? [];
  const removeDiagnostics = hostAnswers.removeDiagnostics ?? [];
  const written: [string, number[]][] = [];
  const removed: string[] = [];

  const fetchFn = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String((input as { toString(): string }).toString());
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

  return ctx as Context & { files: TestFiles };
}

describe('AssetsScreen', () => {
  it('draws the project tree, directories before their files', async () => {
    render(<AssetsScreen ctx={await harness(tree(['game', 'game/spec.json', 'index.html']))} />);
    const entries = await screen.findAllByTestId(/^entry-/);
    expect(entries).toHaveLength(3);
    // A length check alone passes for any ordering — pin the sequence too,
    // matching the host's own traversal order (`readTree`'s own doc): the
    // directory before the files nested under it.
    expect(entries.map((el) => el.getAttribute('data-testid'))).toEqual([
      'entry-game',
      'entry-game/spec.json',
      'entry-index.html',
    ]);
  });

  it('an empty project says it is empty instead of drawing nothing', async () => {
    render(<AssetsScreen ctx={await harness(tree([]))} />);
    expect(await screen.findByTestId('assets-empty')).toBeTruthy();
  });

  it('a tree that could not be read shows the host’s own words', async () => {
    const ctx = await harness({ diagnostics: [d('the project directory is gone')] });
    render(<AssetsScreen ctx={ctx} />);
    expect(await screen.findByText(/the project directory is gone/)).toBeTruthy();
  });

  it('clicking an image entry shows it, without reading its bytes', async () => {
    // This is exactly what `urlFor` is for: the browser fetches and decodes the image itself.
    const ctx = await harness(tree(['art/logo.png']));
    render(<AssetsScreen ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('entry-art/logo.png'));
    expect(screen.getByRole('img').getAttribute('src')).toBe('/api/files/art/logo.png');
  });

  it('clicking a text entry shows its text', async () => {
    const ctx = await harness(tree(['game/spec.json']), { 'game/spec.json': '{"id":"first-slot"}' });
    render(<AssetsScreen ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('entry-game/spec.json'));
    expect(await screen.findByText(/first-slot/)).toBeTruthy();
  });

  it('a file too big to show says so instead of hanging', async () => {
    // ponytail: a threshold, not streaming. Streaming is the upgrade once
    // this editor starts shipping video.
    const ctx = await harness(tree([{ path: 'big.bin', kind: 'file', size: 50_000_000 }]));
    render(<AssetsScreen ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('entry-big.bin'));
    expect(await screen.findByTestId('too-big')).toBeTruthy();
  });

  it('a small binary file that is not an image says so instead of rendering mush', async () => {
    // Not text (a NUL byte in it) and not a recognized image extension —
    // decoding it as text would just fill the pane with replacement
    // characters and explain nothing.
    const ctx = await harness(tree(['data.bin']), { 'data.bin': '\x00\x01\x02binary stuff' });
    render(<AssetsScreen ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('entry-data.bin'));
    expect(await screen.findByTestId('binary')).toBeTruthy();
  });

  it('the screen survives a file that vanishes between listing and reading', async () => {
    // The tree is a snapshot; the file can be deleted between the click and the read.
    const ctx = await harness(tree(['gone.txt']), {}); // reads — but it is already gone
    render(<AssetsScreen ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('entry-gone.txt'));
    expect(await screen.findByText(/gone\.txt/)).toBeTruthy();
    expect(screen.getByTestId('entry-gone.txt')).toBeTruthy(); // the screen stayed whole
  });

  it('the vanished-file message is the host’s diagnostic, not just the entry’s own name', async () => {
    // `findByText(/gone\.txt/)` above is satisfied by the entry's own label
    // alone — every entry shows its path as text, vanished or not — so a
    // regression that drops the read failure entirely would still pass
    // that assertion. This isolates the actual diagnostic wording, which
    // only exists once the failed read is handled.
    const ctx = await harness(tree(['gone.txt']), {});
    render(<AssetsScreen ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('entry-gone.txt'));
    expect(await screen.findByText(/was not found/)).toBeTruthy();
  });

  it('uploading a file puts it where the tree says it went', async () => {
    const ctx = await harness(tree([]));
    render(<AssetsScreen ctx={ctx} />);
    await userEvent.upload(
      screen.getByTestId('upload'),
      new File(['x'], 'logo.png', { type: 'image/png' }),
    );
    await waitFor(() => expect(ctx.files.written).toEqual([['logo.png', bytes('x')]]));
  });

  it('a file the browser itself fails to read off disk says so, instead of doing nothing', async () => {
    // Every other failure path on this screen surfaces something — the
    // tree fetch, a read, a write, a remove. `FileReader` failing before
    // the host ever sees the request is the one path that previously had
    // no `onerror` at all: a picked file the browser can't actually read
    // (yanked media, a permissions error) just vanished, silently.
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
      render(<AssetsScreen ctx={ctx} />);
      await userEvent.upload(screen.getByTestId('upload'), new File(['x'], 'logo.png'));
      expect(await screen.findByText(/disk yanked/)).toBeTruthy();
      expect(ctx.files.written).toEqual([]); // never reached the host at all
    } finally {
      globalThis.FileReader = RealFileReader;
    }
  });

  it('the tree refreshes after an upload, without a page reload', async () => {
    // Otherwise the upload is invisible until someone reloads, and a
    // person uploads it a second time.
    const ctx = await harness(tree([]));
    render(<AssetsScreen ctx={ctx} />);
    ctx.files.nextTree(tree(['logo.png']));
    await userEvent.upload(screen.getByTestId('upload'), new File(['x'], 'logo.png'));
    expect(await screen.findByTestId('entry-logo.png')).toBeTruthy();
  });

  it('an upload the host refuses shows the host’s words and leaves the tree alone', async () => {
    const ctx = await harness(tree(['keep.png']), {}, { writeDiagnostics: [d('outside the project')] });
    render(<AssetsScreen ctx={ctx} />);
    await screen.findByTestId('entry-keep.png');
    // What a refetch WOULD show if the refusal were ignored — without
    // this, the fake tree never changes, so an unconditional refetch
    // returns the exact same answer and "the tree alone" claim goes
    // untested. `logo.png` here would land the assertions below flipped:
    // present instead of absent, present because it changed.
    ctx.files.nextTree(tree(['keep.png', 'logo.png']));
    await userEvent.upload(screen.getByTestId('upload'), new File(['x'], 'logo.png'));
    expect(await screen.findByText(/outside the project/)).toBeTruthy();
    expect(screen.queryByTestId('entry-logo.png')).toBeNull();
  });

  it('deleting asks first, and does nothing when the answer is no', async () => {
    // Delete is irreversible — the one place on this screen where a
    // confirmation earns its cost.
    const ctx = await harness(tree(['logo.png']));
    render(<AssetsScreen ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('delete-logo.png'));
    await userEvent.click(screen.getByTestId('confirm-no'));
    expect(ctx.files.removed).toEqual([]);
    expect(screen.getByTestId('entry-logo.png')).toBeTruthy();
  });

  it('deleting removes the entry from the tree', async () => {
    const ctx = await harness(tree(['logo.png']));
    render(<AssetsScreen ctx={ctx} />);
    ctx.files.nextTree(tree([]));
    await userEvent.click(await screen.findByTestId('delete-logo.png'));
    await userEvent.click(screen.getByTestId('confirm-yes'));
    expect(ctx.files.removed).toEqual(['logo.png']);
    await waitFor(() => expect(screen.queryByTestId('entry-logo.png')).toBeNull());
  });

  it('a delete the host refuses leaves the entry where it was', async () => {
    const ctx = await harness(tree(['game']), {}, { removeDiagnostics: [d('game is a directory')] });
    render(<AssetsScreen ctx={ctx} />);
    await screen.findByTestId('entry-game');
    // What a refetch WOULD show if the refusal were ignored — a tree
    // with `game` already gone. Without this the fake tree never
    // changes, so "leaves the entry where it was" can't tell a gated
    // refresh from an unconditional one that happens to fetch the same
    // static answer back.
    ctx.files.nextTree(tree([]));
    await userEvent.click(await screen.findByTestId('delete-game'));
    await userEvent.click(screen.getByTestId('confirm-yes'));
    expect(await screen.findByText(/is a directory/)).toBeTruthy();
    expect(screen.getByTestId('entry-game')).toBeTruthy();
  });
});
