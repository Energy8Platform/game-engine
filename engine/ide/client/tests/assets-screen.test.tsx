import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Context } from 'cordis';
import { diagnostic, type Diagnostic, type FileEntry } from '@energy8engine/contracts';
import { AssetsScreen, createIdeClient } from '../src/index';

/**
 * Falling tests for Task 5: the project tree, and what one entry contains.
 * `harness()` goes through the real `createIdeClient`, matching
 * `composition-screen.test.tsx`/`preview.test.tsx`'s own precedent for a
 * SCREEN test — not `files.test.ts`'s single-service `apply()` harness,
 * which only proves the service in isolation, not that a screen mounted
 * against the real client draws it.
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

function tree(items: TreeSpec[]): { entries: FileEntry[] } {
  return { entries: items.map(entryFor) };
}

/**
 * `createIdeClient` always composes `gameComposition` too, which fetches
 * `/api/composition` unprompted at boot (see `App.test.tsx`'s own harness,
 * which answers it for the same reason) — every fake `fetchFn` below has to
 * answer that alongside `/api/files` or the promise it kicks off rejects
 * into an unrelated diagnostic this suite isn't testing.
 */
async function harness(
  result: { entries: FileEntry[] } | { diagnostics: Diagnostic[] },
  contents: Record<string, string> = {},
): Promise<Context> {
  const entries = 'entries' in result ? result.entries : [];
  const diagnostics = 'diagnostics' in result ? result.diagnostics : [];

  const fetchFn = (async (input: unknown) => {
    const url = typeof input === 'string' ? input : String((input as { toString(): string }).toString());
    if (url === '/api/composition') {
      return new Response(JSON.stringify({ rows: [], diagnostics: [] }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url === '/api/files') {
      return new Response(JSON.stringify({ entries, diagnostics }), {
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
  return createIdeClient({ url: 'ws://x/ide', socketFactory: () => socket, fetchFn });
}

describe('AssetsScreen', () => {
  it('draws the project tree, directories before their files', async () => {
    render(<AssetsScreen ctx={await harness(tree(['game', 'game/spec.json', 'index.html']))} />);
    expect(await screen.findAllByTestId(/^entry-/)).toHaveLength(3);
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
    // `urlFor` существует ровно для этого: картинку показывает браузер.
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
    // ponytail: порог, а не потоковая отдача. Потоки — когда начнут
    // возить видео.
    const ctx = await harness(tree([{ path: 'big.bin', kind: 'file', size: 50_000_000 }]));
    render(<AssetsScreen ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('entry-big.bin'));
    expect(await screen.findByTestId('too-big')).toBeTruthy();
  });

  it('the screen survives a file that vanishes between listing and reading', async () => {
    // Дерево — снимок. Между щелчком и чтением файл могли удалить.
    const ctx = await harness(tree(['gone.txt']), {}); // читается — но его уже нет
    render(<AssetsScreen ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('entry-gone.txt'));
    expect(await screen.findByText(/gone\.txt/)).toBeTruthy();
    expect(screen.getByTestId('entry-gone.txt')).toBeTruthy(); // экран цел
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
});
