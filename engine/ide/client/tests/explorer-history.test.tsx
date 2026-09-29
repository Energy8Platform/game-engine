import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Context } from 'cordis';
import { afterEach, describe, expect, it } from 'vitest';
import { Explorer } from '../src/index';
import type { HistoryResult } from '../src/plugins/history';
import {
  REMOVE_OVER_CAP_MESSAGE,
  REMOVE_UNDO_CAP_BYTES,
  REMOVE_UNREADABLE_MESSAGE,
} from '../src/shell/explorerSteps';
import { runHistoryKey } from '../src/shell/historyKeys';
import { bytes, harness, harnessWithCalls, tree } from './explorer-harness';

/**
 * The Explorer's verbs (create/mkdir/move/remove/upload) recorded under
 * the `files` history key (design doc §4) — `ctx.history.undo`/`redo`
 * called directly here, the same `['files']` the key router
 * (`historyKeys.ts`) already sends Mod+Z/Mod+Shift+Z/Mod+Y to while focus
 * is inside the Explorer sidebar; that routing has its own tests
 * (`history-keys.test.tsx`).
 */

/**
 * `ctx.history.undo`/`redo` wrapped in `act`: a step's own write (once
 * accepted) fires the Explorer's tree refetch without awaiting it — a
 * `.then` still in flight when the bare call above would have returned.
 * The async `act` callback keeps flushing microtasks until that settles
 * too, same as `history-keys.test.tsx`'s own `HistoryStatus` tests do
 * around a `redo` made while a component is already mounted.
 */
async function undoFiles(ctx: Context): Promise<HistoryResult> {
  let result!: HistoryResult;
  await act(async () => {
    result = await ctx.history.undo(['files']);
  });
  return result;
}

async function redoFiles(ctx: Context): Promise<HistoryResult> {
  let result!: HistoryResult;
  await act(async () => {
    result = await ctx.history.redo(['files']);
  });
  return result;
}

const CHANGED_UNDO = "changed elsewhere since — can't undo";
const CHANGED_REDO = "changed elsewhere since — can't redo";

/** Removes `path` through its row's × and "yes"; the tree the host answers afterwards is `after`. */
async function removeRow(ctx: Context & { files: { nextTree(t: unknown): void } }, path: string, after = tree([])) {
  await userEvent.click(await screen.findByTestId(`explorer-delete-${path}`));
  await screen.findByTestId('confirm-yes');
  ctx.files.nextTree(after);
  await userEvent.click(screen.getByTestId('confirm-yes'));
}

/** Renames `from` to `to` through its row's menu and the inline input; the tree the host answers afterwards is `after`. */
async function rename(ctx: Context & { files: { nextTree(t: unknown): void } }, from: string, to: string, after: ReturnType<typeof tree>) {
  fireEvent.contextMenu(await screen.findByTestId(`explorer-${from}`));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
  ctx.files.nextTree(after);
  await userEvent.clear(screen.getByTestId('explorer-input'));
  await userEvent.type(screen.getByTestId('explorer-input'), `${to}{Enter}`);
}

describe('Explorer — undo/redo', () => {
  it('create: undo removes it while still empty, redo creates it again', async () => {
    const ctx = await harness(tree([]), { 'a.txt': '' });
    render(<Explorer ctx={ctx} />);
    await screen.findByTestId('explorer-empty');
    await userEvent.click(screen.getByTestId('explorer-new-file'));
    await userEvent.type(screen.getByTestId('explorer-input'), 'a.txt{Enter}');
    await waitFor(() => expect(ctx.files.created).toEqual([['a.txt', 'file']]));

    const undo = await undoFiles(ctx);
    expect(undo).toEqual({ kind: 'undo', ok: true, label: 'create a.txt' });
    expect(ctx.files.removed).toEqual(['a.txt']);
    // The tree refetch the undo's own write triggers shows the file gone again.
    await screen.findByTestId('explorer-empty');

    const redo = await redoFiles(ctx);
    expect(redo).toEqual({ kind: 'redo', ok: true, label: 'create a.txt' });
    expect(ctx.files.created).toEqual([
      ['a.txt', 'file'],
      ['a.txt', 'file'],
    ]);
  });

  it('create: undo refuses once the file has content', async () => {
    const ctx = await harness(tree([]), { 'b.txt': 'hello' });
    render(<Explorer ctx={ctx} />);
    await screen.findByTestId('explorer-empty');
    await userEvent.click(screen.getByTestId('explorer-new-file'));
    await userEvent.type(screen.getByTestId('explorer-input'), 'b.txt{Enter}');
    await waitFor(() => expect(ctx.files.created).toEqual([['b.txt', 'file']]));

    const undo = await undoFiles(ctx);
    expect(undo).toEqual({ kind: 'undo', ok: false, reason: "changed elsewhere since — can't undo" });
    expect(ctx.files.removed).toEqual([]);
  });

  it('an undo is not itself recorded as a new step (writes go through history.replay)', async () => {
    const ctx = await harness(tree([]), { 'a.txt': '' });
    render(<Explorer ctx={ctx} />);
    await screen.findByTestId('explorer-empty');
    await userEvent.click(screen.getByTestId('explorer-new-file'));
    await userEvent.type(screen.getByTestId('explorer-input'), 'a.txt{Enter}');
    await waitFor(() => expect(ctx.files.created).toEqual([['a.txt', 'file']]));

    await undoFiles(ctx);
    expect(ctx.files.removed).toEqual(['a.txt']);
    // If the undo's own `remove` had been recorded as a fresh step, this
    // second undo would find it on the stack instead of answering "nothing
    // to undo".
    expect(await undoFiles(ctx)).toEqual({
      kind: 'undo',
      ok: false,
      reason: 'nothing to undo',
    });
  });

  it('new folder: undo removes it while still empty, redo creates it again', async () => {
    const ctx = await harness(tree([]));
    render(<Explorer ctx={ctx} />);
    await screen.findByTestId('explorer-empty');
    await userEvent.click(screen.getByTestId('explorer-new-folder'));
    await userEvent.type(screen.getByTestId('explorer-input'), 'assets{Enter}');
    await waitFor(() => expect(ctx.files.created).toEqual([['assets', 'dir']]));

    const undo = await undoFiles(ctx);
    expect(undo).toEqual({ kind: 'undo', ok: true, label: 'new folder assets' });
    expect(ctx.files.removed).toEqual(['assets']);
    await screen.findByTestId('explorer-empty');

    const redo = await redoFiles(ctx);
    expect(redo).toEqual({ kind: 'redo', ok: true, label: 'new folder assets' });
    expect(ctx.files.created).toEqual([
      ['assets', 'dir'],
      ['assets', 'dir'],
    ]);
  });

  it('new folder: undo refuses once something has been placed inside it', async () => {
    const ctx = await harness(tree([]));
    render(<Explorer ctx={ctx} />);
    await userEvent.click(screen.getByTestId('explorer-new-folder'));
    await userEvent.type(screen.getByTestId('explorer-input'), 'assets{Enter}');
    await waitFor(() => expect(ctx.files.created).toEqual([['assets', 'dir']]));
    ctx.files.nextTree(tree(['assets', 'assets/logo.png']));

    const undo = await undoFiles(ctx);
    expect(undo).toEqual({ kind: 'undo', ok: false, reason: "changed elsewhere since — can't undo" });
    expect(ctx.files.removed).toEqual([]);
  });

  it('move: undo moves it back, redo moves it again', async () => {
    const ctx = await harness(tree(['a.txt']));
    render(<Explorer ctx={ctx} />);
    fireEvent.contextMenu(await screen.findByTestId('explorer-a.txt'));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    ctx.files.nextTree(tree(['b.txt']));
    await userEvent.clear(screen.getByTestId('explorer-input'));
    await userEvent.type(screen.getByTestId('explorer-input'), 'b.txt{Enter}');
    await waitFor(() => expect(ctx.files.moved).toEqual([['a.txt', 'b.txt']]));

    const undo = await undoFiles(ctx);
    expect(undo).toEqual({ kind: 'undo', ok: true, label: 'move a.txt → b.txt' });
    expect(ctx.files.moved).toEqual([
      ['a.txt', 'b.txt'],
      ['b.txt', 'a.txt'],
    ]);

    ctx.files.nextTree(tree(['a.txt']));
    const redo = await redoFiles(ctx);
    expect(redo).toEqual({ kind: 'redo', ok: true, label: 'move a.txt → b.txt' });
    expect(ctx.files.moved).toEqual([
      ['a.txt', 'b.txt'],
      ['b.txt', 'a.txt'],
      ['a.txt', 'b.txt'],
    ]);
  });

  it('move: undo refuses when the old path is taken', async () => {
    const ctx = await harness(tree(['a.txt']));
    render(<Explorer ctx={ctx} />);
    fireEvent.contextMenu(await screen.findByTestId('explorer-a.txt'));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    ctx.files.nextTree(tree(['b.txt']));
    await userEvent.clear(screen.getByTestId('explorer-input'));
    await userEvent.type(screen.getByTestId('explorer-input'), 'b.txt{Enter}');
    await waitFor(() => expect(ctx.files.moved).toEqual([['a.txt', 'b.txt']]));

    // Something else took the old name before the undo.
    ctx.files.nextTree(tree(['b.txt', 'a.txt']));
    const undo = await undoFiles(ctx);
    expect(undo).toEqual({ kind: 'undo', ok: false, reason: "changed elsewhere since — can't undo" });
    expect(ctx.files.moved).toEqual([['a.txt', 'b.txt']]);
  });

  it('remove (file): undo restores the bytes, redo removes it again', async () => {
    const bin = new Uint8Array([0, 0xff, 7]);
    const ctx = await harness(tree(['data.bin']), { 'data.bin': bin });
    render(<Explorer ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('explorer-delete-data.bin'));
    await screen.findByTestId('confirm-yes');
    ctx.files.nextTree(tree([]));
    await userEvent.click(screen.getByTestId('confirm-yes'));
    await waitFor(() => expect(ctx.files.removed).toEqual(['data.bin']));

    const undo = await undoFiles(ctx);
    expect(undo).toEqual({ kind: 'undo', ok: true, label: 'remove data.bin' });
    // 0xff survives the round trip — base64, not a lossy text encoding.
    expect(ctx.files.written).toEqual([['data.bin', [0, 255, 7]]]);

    const redo = await redoFiles(ctx);
    expect(redo).toEqual({ kind: 'redo', ok: true, label: 'remove data.bin' });
    expect(ctx.files.removed).toEqual(['data.bin', 'data.bin']);
  });

  it('remove (folder): undo recreates the folders and every file, redo removes it again', async () => {
    const ctx = await harness(tree(['game', 'game/spec.json', 'game/sub', 'game/sub/x.bin']), {
      'game/spec.json': '{}',
      'game/sub/x.bin': new Uint8Array([1, 2, 3]),
    });
    render(<Explorer ctx={ctx} />);
    fireEvent.contextMenu(await screen.findByTestId('explorer-game'));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await screen.findByTestId('confirm-yes');
    ctx.files.nextTree(tree([]));
    await userEvent.click(screen.getByTestId('confirm-yes'));
    await waitFor(() => expect(ctx.files.removed).toEqual(['game']));

    // What the host's tree says once undo's `mkdir`s start landing — the
    // refresh undo triggers as it finishes reads this back, and redo
    // compares its files and sizes with what was removed.
    const restored = tree([
      'game',
      { path: 'game/spec.json', size: 2 },
      'game/sub',
      { path: 'game/sub/x.bin', size: 3 },
    ]);
    const mkdir = ctx.files.mkdir.bind(ctx.files);
    ctx.files.mkdir = (path: string) => {
      ctx.files.nextTree(restored);
      return mkdir(path);
    };
    const undo = await undoFiles(ctx);
    expect(undo).toEqual({ kind: 'undo', ok: true, label: 'remove game' });
    expect(ctx.files.created).toEqual([
      ['game', 'dir'],
      ['game/sub', 'dir'],
    ]);
    expect(ctx.files.written).toEqual([
      ['game/spec.json', bytes('{}')],
      ['game/sub/x.bin', [1, 2, 3]],
    ]);
    // The tree is refetched once undo has finished writing everything back.
    await screen.findByTestId('explorer-game');

    const redo = await redoFiles(ctx);
    expect(redo).toEqual({ kind: 'redo', ok: true, label: 'remove game' });
    expect(ctx.files.removed).toEqual(['game', 'game']);
  });

  it('remove over 20 MB: the confirm says so, and the remove records no step', async () => {
    const big = new Uint8Array(REMOVE_UNDO_CAP_BYTES + 1);
    const ctx = await harness(tree(['huge.bin']), { 'huge.bin': big });
    render(<Explorer ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('explorer-delete-huge.bin'));
    await screen.findByText(`delete "huge.bin"? ${REMOVE_OVER_CAP_MESSAGE}`);

    ctx.files.nextTree(tree([]));
    await userEvent.click(screen.getByTestId('confirm-yes'));
    await waitFor(() => expect(ctx.files.removed).toEqual(['huge.bin']));

    const undo = await undoFiles(ctx);
    expect(undo).toEqual({ kind: 'undo', ok: false, reason: 'nothing to undo' });
  }, 20000);

  it('remove: a file that cannot be read makes the whole remove not undoable', async () => {
    const ctx = await harness(tree(['game', 'game/ok.txt', 'game/bad.bin']), {
      'game/ok.txt': 'hi',
      // 'game/bad.bin' deliberately has no fixture here — `read()` 404s.
    });
    render(<Explorer ctx={ctx} />);
    fireEvent.contextMenu(await screen.findByTestId('explorer-game'));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await screen.findByText(`delete folder "game" and 2 entries? ${REMOVE_UNREADABLE_MESSAGE}`);

    ctx.files.nextTree(tree([]));
    await userEvent.click(screen.getByTestId('confirm-yes'));
    await waitFor(() => expect(ctx.files.removed).toEqual(['game']));

    const undo = await undoFiles(ctx);
    expect(undo).toEqual({ kind: 'undo', ok: false, reason: 'nothing to undo' });
  });

  it('remove: "yes" clicked while the read is still pending waits for it before removing, then records a step', async () => {
    const ctx = await harness(tree(['big.bin']), { 'big.bin': new Uint8Array([1, 2, 3]) });
    // Gates every `read()` behind a promise this test releases by hand —
    // `askDelete`'s own snapshot read (and, since `confirm` awaits that
    // SAME read rather than starting a second one, "yes") both hang on it
    // until `release()` is called below.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const realRead = ctx.files.read.bind(ctx.files);
    ctx.files.read = (path: string) => gate.then(() => realRead(path));

    render(<Explorer ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('explorer-delete-big.bin'));
    await screen.findByTestId('confirm-yes');
    ctx.files.nextTree(tree([]));
    await userEvent.click(screen.getByTestId('confirm-yes'));

    // The read this remove's undo data depends on has not settled — the
    // remove itself must not have happened yet either.
    expect(ctx.files.removed).toEqual([]);

    release();
    await waitFor(() => expect(ctx.files.removed).toEqual(['big.bin']));

    const undo = await undoFiles(ctx);
    expect(undo).toEqual({ kind: 'undo', ok: true, label: 'remove big.bin' });
    expect(ctx.files.written).toEqual([['big.bin', [1, 2, 3]]]);
  });

  it('upload over an existing file: undo restores the previous bytes, redo writes the upload again', async () => {
    const ctx = await harness(tree(['logo.png']), { 'logo.png': 'old' });
    render(<Explorer ctx={ctx} />);
    await screen.findByTestId('explorer-logo.png');
    await userEvent.upload(screen.getByTestId('explorer-upload'), new File(['new'], 'logo.png'));
    await screen.findByText(/replace/);
    await userEvent.click(screen.getByTestId('confirm-yes'));
    await waitFor(() => expect(ctx.files.written).toEqual([['logo.png', bytes('new')]]));

    const undo = await undoFiles(ctx);
    expect(undo).toEqual({ kind: 'undo', ok: true, label: 'upload logo.png' });
    expect(ctx.files.written).toEqual([
      ['logo.png', bytes('new')],
      ['logo.png', bytes('old')],
    ]);

    const redo = await redoFiles(ctx);
    expect(redo).toEqual({ kind: 'redo', ok: true, label: 'upload logo.png' });
    expect(ctx.files.written).toEqual([
      ['logo.png', bytes('new')],
      ['logo.png', bytes('old')],
      ['logo.png', bytes('new')],
    ]);
  });

  it('upload of a new file: undo removes it', async () => {
    const ctx = await harness(tree([]));
    render(<Explorer ctx={ctx} />);
    await screen.findByTestId('explorer-empty');
    await userEvent.upload(screen.getByTestId('explorer-upload'), new File(['x'], 'new.png'));
    await waitFor(() => expect(ctx.files.written).toEqual([['new.png', bytes('x')]]));

    const undo = await undoFiles(ctx);
    expect(undo).toEqual({ kind: 'undo', ok: true, label: 'upload new.png' });
    expect(ctx.files.removed).toEqual(['new.png']);
  });
});

describe('Explorer — undo/redo refuses what changed elsewhere', () => {
  it('remove: undo refuses when the path is back on disk — nothing is written', async () => {
    const ctx = await harness(tree(['a.txt']), { 'a.txt': 'one' });
    render(<Explorer ctx={ctx} />);
    await removeRow(ctx, 'a.txt');
    await waitFor(() => expect(ctx.files.removed).toEqual(['a.txt']));

    // Something else put a file at that path since.
    ctx.files.nextTree(tree(['a.txt']));
    expect(await undoFiles(ctx)).toEqual({ kind: 'undo', ok: false, reason: CHANGED_UNDO });
    expect(ctx.files.written).toEqual([]);
    expect(ctx.files.created).toEqual([]);
  });

  it('remove (file): redo refuses when the file was written since the undo — nothing is removed', async () => {
    const contents: Record<string, string | Uint8Array> = { 'a.txt': 'one' };
    const ctx = await harness(tree(['a.txt']), contents);
    render(<Explorer ctx={ctx} />);
    await removeRow(ctx, 'a.txt');
    await waitFor(() => expect(ctx.files.removed).toEqual(['a.txt']));
    expect(await undoFiles(ctx)).toMatchObject({ ok: true });

    contents['a.txt'] = 'two'; // a save from Monaco
    expect(await redoFiles(ctx)).toEqual({ kind: 'redo', ok: false, reason: CHANGED_REDO });
    expect(ctx.files.removed).toEqual(['a.txt']);
  });

  it('remove (folder): redo refuses when a file under it changed size since the undo — nothing is removed', async () => {
    const ctx = await harness(tree(['game', 'game/spec.json']), { 'game/spec.json': '{}' });
    render(<Explorer ctx={ctx} />);
    fireEvent.contextMenu(await screen.findByTestId('explorer-game'));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await screen.findByTestId('confirm-yes');
    ctx.files.nextTree(tree([]));
    await userEvent.click(screen.getByTestId('confirm-yes'));
    await waitFor(() => expect(ctx.files.removed).toEqual(['game']));
    expect(await undoFiles(ctx)).toMatchObject({ ok: true });

    ctx.files.nextTree(tree(['game', { path: 'game/spec.json', size: 9 }]));
    expect(await redoFiles(ctx)).toEqual({ kind: 'redo', ok: false, reason: CHANGED_REDO });
    expect(ctx.files.removed).toEqual(['game']);
  });

  it('upload: undo refuses when the file was written since the upload — nothing is written', async () => {
    const contents: Record<string, string | Uint8Array> = { 'logo.png': 'old' };
    const ctx = await harness(tree(['logo.png']), contents);
    render(<Explorer ctx={ctx} />);
    await screen.findByTestId('explorer-logo.png');
    await userEvent.upload(screen.getByTestId('explorer-upload'), new File(['new'], 'logo.png'));
    await userEvent.click(await screen.findByTestId('confirm-yes'));
    await waitFor(() => expect(ctx.files.written).toEqual([['logo.png', bytes('new')]]));

    contents['logo.png'] = 'edited';
    expect(await undoFiles(ctx)).toEqual({ kind: 'undo', ok: false, reason: CHANGED_UNDO });
    expect(ctx.files.written).toEqual([['logo.png', bytes('new')]]);
  });

  it('upload: redo refuses when the file was written since the undo — nothing is written', async () => {
    const contents: Record<string, string | Uint8Array> = { 'logo.png': 'old' };
    const ctx = await harness(tree(['logo.png']), contents);
    render(<Explorer ctx={ctx} />);
    await screen.findByTestId('explorer-logo.png');
    await userEvent.upload(screen.getByTestId('explorer-upload'), new File(['new'], 'logo.png'));
    await userEvent.click(await screen.findByTestId('confirm-yes'));
    await waitFor(() => expect(ctx.files.written).toEqual([['logo.png', bytes('new')]]));
    expect(await undoFiles(ctx)).toMatchObject({ ok: true });

    contents['logo.png'] = 'edited';
    expect(await redoFiles(ctx)).toEqual({ kind: 'redo', ok: false, reason: CHANGED_REDO });
    expect(ctx.files.written).toEqual([
      ['logo.png', bytes('new')],
      ['logo.png', bytes('old')],
    ]);
  });

  it('upload of a new file: redo refuses when a file is there again — nothing is written', async () => {
    const contents: Record<string, string | Uint8Array> = {};
    const ctx = await harness(tree([]), contents);
    render(<Explorer ctx={ctx} />);
    await screen.findByTestId('explorer-empty');
    await userEvent.upload(screen.getByTestId('explorer-upload'), new File(['x'], 'new.png'));
    await waitFor(() => expect(ctx.files.written).toEqual([['new.png', bytes('x')]]));
    expect(await undoFiles(ctx)).toMatchObject({ ok: true });

    contents['new.png'] = 'someone else';
    expect(await redoFiles(ctx)).toEqual({ kind: 'redo', ok: false, reason: CHANGED_REDO });
    expect(ctx.files.written).toEqual([['new.png', bytes('x')]]);
  });

  it('upload over a file whose bytes could not be read first: no step, so no undo that would remove it', async () => {
    // 'logo.png' is listed but has no fixture — the read before the overwrite 404s.
    const ctx = await harness(tree(['logo.png']));
    render(<Explorer ctx={ctx} />);
    await screen.findByTestId('explorer-logo.png');
    await userEvent.upload(screen.getByTestId('explorer-upload'), new File(['new'], 'logo.png'));
    await userEvent.click(await screen.findByTestId('confirm-yes'));
    await waitFor(() => expect(ctx.files.written).toEqual([['logo.png', bytes('new')]]));

    expect(await undoFiles(ctx)).toEqual({ kind: 'undo', ok: false, reason: 'nothing to undo' });
    expect(ctx.files.removed).toEqual([]);
  });
});

describe('Explorer — a move undone or redone', () => {
  it('refuses while a tab under the path has unsaved changes — nothing moves', async () => {
    const ctx = await harness(tree(['a.txt']));
    render(<Explorer ctx={ctx} />);
    await rename(ctx, 'a.txt', 'b.txt', tree(['b.txt']));
    await waitFor(() => expect(ctx.files.moved).toEqual([['a.txt', 'b.txt']]));
    ctx.shell.open({ key: 'f:b.txt', title: 'b.txt', component: () => null, closable: true });
    ctx.shell.markDirty('f:b.txt', true);

    expect(await undoFiles(ctx)).toEqual({
      kind: 'undo',
      ok: false,
      reason: 'a tab under b.txt has unsaved changes',
    });
    expect(ctx.files.moved).toEqual([['a.txt', 'b.txt']]);
  });

  it('takes the open tabs along, back and forward', async () => {
    const ctx = await harness(tree(['game', 'game/a.txt']));
    render(<Explorer ctx={ctx} />);
    ctx.shell.open({ key: 'f:game/a.txt', title: 'a.txt', component: () => null, closable: true });
    await rename(ctx, 'game', 'src', tree(['src', 'src/a.txt']));
    await waitFor(() => expect(ctx.shell.documents().map((d) => d.key)).toEqual(['f:src/a.txt']));

    ctx.files.nextTree(tree(['src', 'src/a.txt']));
    expect(await undoFiles(ctx)).toMatchObject({ ok: true });
    expect(ctx.shell.documents().map((d) => d.key)).toEqual(['f:game/a.txt']);

    ctx.files.nextTree(tree(['game', 'game/a.txt']));
    expect(await redoFiles(ctx)).toMatchObject({ ok: true });
    expect(ctx.shell.documents().map((d) => d.key)).toEqual(['f:src/a.txt']);
  });
});

describe('Explorer — memory', () => {
  it("a remove the tree already says is over 20 MB is not undoable, and nothing is read to find out", async () => {
    const { ctx, calls } = await harnessWithCalls(
      tree([{ path: 'huge.bin', size: REMOVE_UNDO_CAP_BYTES + 1 }]),
    );
    render(<Explorer ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('explorer-delete-huge.bin'));
    await screen.findByText(`delete "huge.bin"? ${REMOVE_OVER_CAP_MESSAGE}`);
    expect(calls).not.toContain('/api/files/huge.bin');

    ctx.files.nextTree(tree([]));
    await userEvent.click(screen.getByTestId('confirm-yes'));
    await waitFor(() => expect(ctx.files.removed).toEqual(['huge.bin']));
    expect(await undoFiles(ctx)).toEqual({ kind: 'undo', ok: false, reason: 'nothing to undo' });
  });
});

describe('Explorer — focus stays in the Explorer after a verb', () => {
  // The app's own route for a key: the Shell's window listener.
  let off: (() => void) | undefined;
  afterEach(() => off?.());
  function routeKeys(ctx: Context) {
    const listener = (event: KeyboardEvent) => void runHistoryKey(ctx, event);
    window.addEventListener('keydown', listener);
    off = () => window.removeEventListener('keydown', listener);
  }
  const inExplorer = () =>
    document.activeElement?.closest('[data-testid="sidebar-explorer"]') !== null &&
    document.activeElement !== document.body;

  it('after "yes" on a delete, Mod+Z right away undoes it', async () => {
    const ctx = await harness(tree(['a.txt']), { 'a.txt': 'one' });
    routeKeys(ctx);
    render(
      <div data-testid="sidebar-explorer">
        <Explorer ctx={ctx} />
      </div>,
    );
    await removeRow(ctx, 'a.txt');
    await waitFor(() => expect(ctx.files.removed).toEqual(['a.txt']));
    expect(inExplorer()).toBe(true);

    fireEvent.keyDown(document.activeElement!, { key: 'z', code: 'KeyZ', metaKey: true });
    await waitFor(() => expect(ctx.files.written).toEqual([['a.txt', bytes('one')]]));
  });

  it('after an inline rename is committed', async () => {
    const ctx = await harness(tree(['a.txt']));
    render(
      <div data-testid="sidebar-explorer">
        <Explorer ctx={ctx} />
      </div>,
    );
    await rename(ctx, 'a.txt', 'b.txt', tree(['b.txt']));
    await waitFor(() => expect(ctx.files.moved).toEqual([['a.txt', 'b.txt']]));
    expect(inExplorer()).toBe(true);
  });

  it('after a row is dropped', async () => {
    const ctx = await harness(tree(['a.txt', 'assets']));
    render(
      <div data-testid="sidebar-explorer">
        <Explorer ctx={ctx} />
      </div>,
    );
    const data: Record<string, string> = { 'text/x-e8-path': 'a.txt' };
    const dataTransfer = {
      types: Object.keys(data),
      files: [],
      getData: (t: string) => data[t] ?? '',
      setData: () => {},
      dropEffect: 'move',
      effectAllowed: 'move',
    };
    ctx.files.nextTree(tree(['assets', 'assets/a.txt']));
    fireEvent.drop(await screen.findByTestId('explorer-assets'), { dataTransfer });
    await waitFor(() => expect(ctx.files.moved).toEqual([['a.txt', 'assets/a.txt']]));
    expect(inExplorer()).toBe(true);
  });
});
