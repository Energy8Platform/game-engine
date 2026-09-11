import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Context } from 'cordis';
import { diagnostic, type Diagnostic, type FileEntry } from '@energy8engine/contracts';
import {
  CodeScreen,
  Layout,
  createIdeClient,
  type CheckService,
  type FilesService,
} from '../src/index';

/**
 * `harness()` below is `assets-screen.test.tsx`'s own harness, reused
 * rather than reinvented — the brief for this task named calls
 * (`ctx.check.calls`, a `harness(tree, contents, hostAnswers)` third
 * argument shaped for writes only) that assumed a fake service that does
 * not exist in this codebase. There is no fake `files` or `check` service
 * to poke directly: `CodeScreen` runs against the real ones
 * `createIdeClient` provides, same as `AssetsScreen`. Writes are observed
 * through the PUT requests the fake `fetchFn` receives (`written`, same
 * name and shape as the assets harness); checks are observed the same way,
 * through the POST requests (`calls`, attached to the real `ctx.check`
 * object exactly as `written` is attached to the real `ctx.files`).
 *
 * Monaco does not import under jsdom (`monaco.test.tsx`'s own doc explains
 * why) — this file mocks `../src/editor/monacoSlice` with the same
 * recording fake `monaco.test.tsx` uses, so a screen test here sees an
 * editor instead of the "could not start" explanation pane.
 */
const fake = vi.hoisted(() => {
  type Marker = { startLineNumber: number; message: string };
  type Editor = {
    el: HTMLElement;
    model: { value: string; markers: Marker[]; getValue(): string };
    disposed: boolean;
    listeners: Array<() => void>;
    getValue(): string;
    setValue(v: string): void;
    getModel(): Editor['model'];
    onDidChangeModelContent(cb: () => void): { dispose(): void };
    dispose(): void;
    /** What a keystroke does: the content moves underneath and listeners hear about it, with no `setValue` involved. */
    type(v: string): void;
  };
  const editors: Editor[] = [];
  return {
    editors,
    MarkerSeverity: { Hint: 1, Info: 2, Warning: 4, Error: 8 },
    editor: {
      create(el: HTMLElement, options: Record<string, unknown>): Editor {
        const model = {
          value: String(options.value ?? ''),
          markers: [] as Marker[],
          getValue: () => model.value,
        };
        const editor: Editor = {
          el,
          model,
          disposed: false,
          listeners: [],
          getValue: () => model.value,
          setValue: (v) => editor.type(v),
          getModel: () => model,
          onDidChangeModelContent(cb) {
            editor.listeners.push(cb);
            return { dispose() {} };
          },
          dispose() {
            editor.disposed = true;
          },
          type(v) {
            model.value = v;
            el.textContent = v;
            editor.listeners.forEach((cb) => cb());
          },
        };
        el.textContent = model.value;
        editors.push(editor);
        return editor;
      },
      setModelMarkers(model: Editor['model'], _owner: string, markers: Marker[]) {
        model.markers = markers;
      },
    },
  };
});

vi.mock('../src/editor/monacoSlice', () => fake);
vi.mock('monaco-editor/editor/editor.worker.js?worker', () => ({ default: class {} }));

/** The (only ever one, in this suite) live editor for a given host element. */
function editorOn(el: HTMLElement) {
  const editor = fake.editors.find((e) => e.el === el && !e.disposed);
  if (!editor) throw new Error('no live editor on that element');
  return editor;
}

/** A keystroke, wrapped: the fake fires its listener synchronously, which triggers a React state update outside any event React itself dispatched. */
function type(el: HTMLElement, next: string) {
  act(() => editorOn(el).type(next));
}

/** These tests only care about `.message` — severity/plugin/where are fixed filler, `at` added where a test needs a marker. */
function d(message: string, at?: Diagnostic['at']): Diagnostic {
  const base = diagnostic('error', 'files', 'test', message);
  return at ? { ...base, at } : base;
}

type TreeSpec = string | (Partial<FileEntry> & { path: string });

function entryFor(item: TreeSpec): FileEntry {
  if (typeof item !== 'string')
    return { path: item.path, kind: item.kind ?? 'file', size: item.size };
  const base = item.split('/').pop() ?? item;
  return /\.[^./]+$/.test(base)
    ? { path: item, kind: 'file', size: 0 }
    : { path: item, kind: 'dir' };
}

function tree(items: TreeSpec[]): { entries: FileEntry[] } {
  return { entries: items.map(entryFor) };
}

function decodeBase64(value: string): number[] {
  const binary = atob(value);
  return Array.from(binary, (c) => c.charCodeAt(0));
}

type TestFiles = FilesService & { written: [string, number[]][] };
type TestCheck = CheckService & { calls: string[] };

interface HostAnswers {
  writeDiagnostics?: Diagnostic[];
  checkDiagnostics?: Diagnostic[];
  /** For the out-of-order test: lets the test control exactly when each POST /api/check answers. */
  checkResponder?: (source: string) => Promise<Diagnostic[]>;
}

async function harness(
  result: { entries: FileEntry[] },
  contents: Record<string, string> = {},
  hostAnswers: HostAnswers = {},
): Promise<Context & { files: TestFiles; check: TestCheck }> {
  const entries = result.entries;
  const written: [string, number[]][] = [];
  const checks: string[] = [];

  const fetchFn = (async (input: unknown, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : String((input as { toString(): string }).toString());
    const method = (init?.method ?? 'GET').toUpperCase();

    if (url === '/api/composition') {
      return new Response(JSON.stringify({ rows: [], diagnostics: [] }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url === '/api/files' && method === 'GET') {
      return new Response(JSON.stringify({ entries, diagnostics: [] }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url === '/api/check' && method === 'POST') {
      const body = JSON.parse((init?.body as string | undefined) ?? '{}') as { source?: string };
      const source = body.source ?? '';
      checks.push(source);
      const diagnostics = hostAnswers.checkResponder
        ? await hostAnswers.checkResponder(source)
        : (hostAnswers.checkDiagnostics ?? []);
      return new Response(JSON.stringify({ diagnostics }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    const path = decodeURIComponent(url.slice('/api/files/'.length));

    if (method === 'PUT') {
      const body = JSON.parse((init?.body as string | undefined) ?? '{}') as { base64?: string };
      written.push([path, decodeBase64(body.base64 ?? '')]);
      return new Response(JSON.stringify({ diagnostics: hostAnswers.writeDiagnostics ?? [] }), {
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
  const testCheck = ctx.check as TestCheck;
  testCheck.calls = checks;

  return ctx as Context & { files: TestFiles; check: TestCheck };
}

// The two cross-tab tests below navigate for real, through `ctx.layout.go`,
// which writes `location.hash` — `layout.test.tsx`'s own harness hits the
// identical leak (a hash one test sets is still there for the next) and
// resets it the same way.
beforeEach(() => {
  location.hash = '';
});

describe('CodeScreen', () => {
  it('lists the files worth editing, and not the whole tree', async () => {
    // `game/script.spin` and `plugins/**`, per the spec. A PNG in the list
    // is a file this screen cannot help with, and `spec.json`/`e8.yml`
    // are written by the IDE, not by hand.
    const ctx = await harness(
      tree([
        'game',
        'game/script.spin',
        'game/spec.json',
        'plugins',
        'plugins/bonus.lua',
        'art/logo.png',
      ]),
    );
    render(<CodeScreen ctx={ctx} />);
    const files = await screen.findAllByTestId(/^file-/);
    expect(files.map((el) => el.getAttribute('data-testid'))).toEqual([
      'file-game/script.spin',
      'file-plugins/bonus.lua',
    ]);
  });

  it('opening a file shows its text', async () => {
    const ctx = await harness(tree(['game/script.spin']), { 'game/script.spin': 'game = Spin' });
    render(<CodeScreen ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('file-game/script.spin'));
    expect(await screen.findByTestId('editor')).toHaveTextContent('game = Spin');
  });

  it('typing checks, and the markers arrive without saving', async () => {
    // A prior version of this test only polled `ctx.check.calls.length` —
    // green even with `diagnostics={[]}` hardcoded on the `<Monaco/>`
    // mount, which is a broken wire, not a working one. This asserts the
    // marker itself lands.
    const ctx = await harness(
      tree(['game/script.spin']),
      { 'game/script.spin': 'game = Spin' },
      { checkDiagnostics: [d('record block has no name', { line: 2 })] },
    );
    render(<CodeScreen ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('file-game/script.spin'));
    const editorEl = await screen.findByTestId('editor');
    // The fake stands in for `monacoSlice`, not for `userEvent.type`'s
    // contentEditable machinery — `monaco.test.tsx` drives it the same
    // way, through its own `type()`, which is what fires the wrapper's
    // `onDidChangeModelContent` listener.
    type(editorEl, 'game = Spin\nrecord {\n}');
    await waitFor(() => expect(ctx.check.calls.length).toBeGreaterThan(0));
    await waitFor(() =>
      expect(editorOn(editorEl).model.markers).toEqual([
        expect.objectContaining({ message: 'record block has no name' }),
      ]),
    );
    expect(ctx.files.written).toEqual([]); // nothing saved
  });

  it('debounces rapid typing into one check call for the last text, not one per keystroke', async () => {
    // Measured live against a real host: one keystroke, one POST — a dozen
    // calls for a single inserted line. The sequence guard (proven
    // separately below) stays regardless — it survives network reordering
    // a debounce cannot prevent — but the wasted calls themselves are
    // pure debounce work.
    const ctx = await harness(tree(['game/script.spin']), { 'game/script.spin': '' });
    render(<CodeScreen ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('file-game/script.spin'));
    const editorEl = await screen.findByTestId('editor');
    type(editorEl, 'a');
    type(editorEl, 'ab');
    type(editorEl, 'abc');
    // The first call is the one opening the file makes (see "a file that
    // is already broken" below); the keystrokes add exactly one more.
    await waitFor(() => expect(ctx.check.calls).toEqual(['', 'abc']));
    // Give the debounce window a second chance to fire, if the three
    // keystrokes had each scheduled their own call instead of collapsing.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(ctx.check.calls).toEqual(['', 'abc']);
  });

  it('saving writes through ctx.files.write, and says when the host refused', async () => {
    const ctx = await harness(
      tree(['game/script.spin']),
      { 'game/script.spin': 'game = Spin' },
      { writeDiagnostics: [d('that is outside the project')] },
    );
    render(<CodeScreen ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('file-game/script.spin'));
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/outside the project/)).toBeTruthy();
  });

  it('a refusal reaches the one list, not only this screen', async () => {
    // Slice 5's finding: the assets screen reported into its own paragraph
    // and nowhere else, so navigating away lost it. Both readers, one report.
    const ctx = await harness(
      tree(['game/script.spin']),
      { 'game/script.spin': 'x' },
      { writeDiagnostics: [d('that is outside the project')] },
    );
    render(<CodeScreen ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('file-game/script.spin'));
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await screen.findByText(/outside the project/);
    expect(ctx.connection.diagnostics.map((x) => x.message)).toContain(
      'that is outside the project',
    );
  });

  it('leaving with unsaved changes asks first', async () => {
    // Losing typed math silently is the one irreversible thing on this
    // screen — the same shape as the assets screen's delete confirmation.
    const ctx = await harness(tree(['game/script.spin', 'plugins/bonus.lua']), {
      'game/script.spin': 'one',
      'plugins/bonus.lua': 'two',
    });
    render(<CodeScreen ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('file-game/script.spin'));
    const editorEl = await screen.findByTestId('editor');
    type(editorEl, 'one, edited');

    await userEvent.click(screen.getByTestId('file-plugins/bonus.lua'));
    // Still on the file that was open, unsaved edit intact — the switch did not happen yet.
    expect(screen.getByTestId('editor')).toHaveTextContent('one, edited');
    expect(await screen.findByTestId('confirm-yes')).toBeTruthy();

    await userEvent.click(screen.getByTestId('confirm-no'));
    expect(screen.getByTestId('editor')).toHaveTextContent('one, edited'); // "no" changed nothing

    await userEvent.click(screen.getByTestId('file-plugins/bonus.lua'));
    await userEvent.click(await screen.findByTestId('confirm-yes'));
    expect(await screen.findByTestId('editor')).toHaveTextContent('two');
  });

  it('leaving via a different tab, with unsaved changes, asks first too', async () => {
    // `go()` used to unmount whatever screen was current unconditionally —
    // there was no interception point until this task's `ctx.layout.guard`.
    // Rendered through the real `<Layout/>`, with a second screen
    // registered, so this exercises an actual tab click rather than the
    // in-screen file switch above.
    const ctx = await harness(tree(['game/script.spin']), { 'game/script.spin': 'one' });
    ctx.layout.screen({ id: 'code', title: 'Код' }, CodeScreen);
    ctx.layout.screen({ id: 'other', title: 'Other' }, () => <div>OTHER SCREEN</div>);
    render(<Layout ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('file-game/script.spin'));
    const editorEl = await screen.findByTestId('editor');
    type(editorEl, 'one, edited');

    await userEvent.click(screen.getByTestId('tab-other'));
    // Still on Code — the click was refused, nothing moved.
    expect(screen.getByTestId('editor')).toHaveTextContent('one, edited');
    expect(await screen.findByTestId('confirm-yes')).toBeTruthy();

    await userEvent.click(screen.getByTestId('confirm-no'));
    expect(screen.queryByText('OTHER SCREEN')).toBeNull(); // "no" left the hash alone

    await userEvent.click(screen.getByTestId('tab-other'));
    await userEvent.click(await screen.findByTestId('confirm-yes'));
    expect(await screen.findByText('OTHER SCREEN')).toBeTruthy();
  });

  it('a clean code screen does not block switching tabs', async () => {
    const ctx = await harness(tree(['game/script.spin']), { 'game/script.spin': 'one' });
    ctx.layout.screen({ id: 'code', title: 'Код' }, CodeScreen);
    ctx.layout.screen({ id: 'other', title: 'Other' }, () => <div>OTHER SCREEN</div>);
    render(<Layout ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('file-game/script.spin'));
    await screen.findByTestId('editor'); // opened, untouched — nothing to lose
    await userEvent.click(screen.getByTestId('tab-other'));
    expect(await screen.findByText('OTHER SCREEN')).toBeTruthy();
  });

  it('a file that vanished between listing and opening says so', async () => {
    // The tree is a snapshot; the assets screen met this on its own listing.
    const ctx = await harness(tree(['game/script.spin']), {}); // read — but it is already gone
    render(<CodeScreen ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('file-game/script.spin'));
    expect(await screen.findByText(/was not found/)).toBeTruthy();
    expect(ctx.connection.diagnostics.some((diag) => /was not found/.test(diag.message))).toBe(
      true,
    );
    // No broken editor was mounted over it.
    expect(screen.queryByTestId('editor')).toBeNull();
  });

  it('a binary file under plugins/ is refused instead of decoded as mush', async () => {
    // `plugins/**` is listed whole — a PNG shipped inside a project plugin
    // is exactly as real as one in the assets tree, and decoding it as
    // text (and offering "save" on the result) would write that mush back.
    const ctx = await harness(tree(['plugins/icon.png']), {
      'plugins/icon.png': '\x00\x01\x02binary stuff',
    });
    render(<CodeScreen ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('file-plugins/icon.png'));
    expect(await screen.findByText(/doesn't look like text/)).toBeTruthy();
    expect(screen.queryByTestId('editor')).toBeNull();
  });

  it('a stale check answer never overwrites markers for text that is no longer current', async () => {
    // Ruling 9: `ctx.check` has no sequence slot of its own, so the screen
    // owns discarding a late answer. Typed 'a', then 'ab'; the answer FOR
    // 'a' is made to land LAST — if the guard were missing, the last
    // answer to arrive would win and the marker would say 'stale', not
    // 'current'. The two messages are deliberately different so a
    // regression produces visibly different content, not a pass that
    // merely looks the same either way.
    let resolveForA: ((diagnostics: Diagnostic[]) => void) | undefined;
    let resolveForAb: ((diagnostics: Diagnostic[]) => void) | undefined;
    const ctx = await harness(
      tree(['game/script.spin']),
      { 'game/script.spin': '' },
      {
        checkResponder: (source) =>
          new Promise((resolve) => {
            if (source === 'a') resolveForA = resolve;
            else if (source === 'ab') resolveForAb = resolve;
            else resolve([]); // the check opening the file makes
          }),
      },
    );
    render(<CodeScreen ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('file-game/script.spin'));
    const editorEl = await screen.findByTestId('editor');

    type(editorEl, 'a');
    await waitFor(() => expect(ctx.check.calls).toEqual(['', 'a']));
    type(editorEl, 'ab');
    await waitFor(() => expect(ctx.check.calls).toEqual(['', 'a', 'ab']));

    // Out of order: the newer text's answer arrives FIRST.
    await act(async () => {
      resolveForAb?.([d('current for ab', { line: 1 })]);
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(editorOn(editorEl).model.markers).toEqual([
        expect.objectContaining({ message: 'current for ab' }),
      ]),
    );
    // The stale answer for 'a' arrives second — must be dropped, not applied.
    await act(async () => {
      resolveForA?.([d('stale for a', { line: 1 })]);
      await Promise.resolve();
      await Promise.resolve(); // let its own .then run, if it were going to
    });
    expect(editorOn(editorEl).model.markers).toEqual([
      expect.objectContaining({ message: 'current for ab' }),
    ]);
  });

  it('a check diagnostic with no `at` is shown beside the editor, since it cannot be a marker', async () => {
    // The `checkActionStages` ERROR (`stage = bonus_game` naming no
    // variant), a deleted `game {}` block, `check.ts`'s own dead-network
    // diagnostic — all real, none with a line. Markers need `at`, so these
    // reached no reader at all: an empty pane with the host having said
    // exactly what is wrong.
    const ctx = await harness(
      tree(['game/script.spin']),
      { 'game/script.spin': 'game = Spin' },
      { checkDiagnostics: [d('no "game { ... }" block found')] },
    );
    render(<CodeScreen ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('file-game/script.spin'));
    const editorEl = await screen.findByTestId('editor');
    type(editorEl, 'gam');
    expect(await screen.findByText('no "game { ... }" block found')).toHaveClass(
      'e8-code-diagnostic',
    );
    expect(editorOn(editorEl).model.markers).toEqual([]);
  });

  it('a check diagnostic WITH `at` is a marker only, not also a paragraph', async () => {
    // The paragraph is for what cannot be drawn; drawing a line-numbered
    // one twice would say the same thing in two places.
    const ctx = await harness(
      tree(['game/script.spin']),
      { 'game/script.spin': 'game = Spin' },
      { checkDiagnostics: [d('record block has no name', { line: 1 })] },
    );
    render(<CodeScreen ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('file-game/script.spin'));
    const editorEl = await screen.findByTestId('editor');
    await waitFor(() => expect(editorOn(editorEl).model.markers).toHaveLength(1));
    expect(screen.queryByText('record block has no name')).toBeNull();
  });

  it('a file that is already broken shows it on open, before any keystroke', async () => {
    // `openFile` cleared the markers and never asked — a broken file
    // opened clean until the first edit.
    const ctx = await harness(
      tree(['game/script.spin']),
      { 'game/script.spin': 'record {\n}' },
      { checkDiagnostics: [d('record block has no name', { line: 1 })] },
    );
    render(<CodeScreen ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('file-game/script.spin'));
    const editorEl = await screen.findByTestId('editor');
    await waitFor(() => expect(ctx.check.calls).toEqual(['record {\n}']));
    await waitFor(() =>
      expect(editorOn(editorEl).model.markers).toEqual([
        expect.objectContaining({ message: 'record block has no name' }),
      ]),
    );
  });

  it('a TypeScript file under plugins/ is never checked as .spin', async () => {
    // Measured: one keystroke in `plugins/reel-step/src/step.ts` drew a
    // "game block has no quoted name" warning on line 6, from `findBlocks`
    // matching `\bgame\b` in TypeScript — a .spin grammar error asserted
    // over code that is not .spin.
    const ctx = await harness(
      tree(['plugins/step.ts']),
      { 'plugins/step.ts': 'const game = 1;' },
      { checkDiagnostics: [d('game block has no quoted name', { line: 1 })] },
    );
    render(<CodeScreen ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('file-plugins/step.ts'));
    const editorEl = await screen.findByTestId('editor');
    type(editorEl, 'const game = 2;');
    await new Promise((resolve) => setTimeout(resolve, 400)); // past the debounce
    expect(ctx.check.calls).toEqual([]);
    expect(editorOn(editorEl).model.markers).toEqual([]);
    expect(screen.queryByText('game block has no quoted name')).toBeNull();
  });

  it("a reload with unsaved changes is held for the browser's own confirm; a clean one is not", async () => {
    // `beforeunload` is the one hook a page has against reload/close.
    // Back/forward through the hash cannot be held the same way — see
    // `LayoutService.guard`'s doc.
    const ctx = await harness(tree(['game/script.spin']), { 'game/script.spin': 'a' });
    render(<CodeScreen ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('file-game/script.spin'));
    const editorEl = await screen.findByTestId('editor');

    const fire = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(fire()).toBe(false);
    type(editorEl, 'ab');
    await waitFor(() => expect(fire()).toBe(true));
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(fire()).toBe(false));
  });
});
