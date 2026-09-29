import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Context } from 'cordis';
import { describe, expect, it } from 'vitest';
import { Explorer } from '../src/index';
import type { HistoryResult } from '../src/plugins/history';
import {
  REMOVE_OVER_CAP_MESSAGE,
  REMOVE_UNDO_CAP_BYTES,
  REMOVE_UNREADABLE_MESSAGE,
} from '../src/shell/explorerSteps';
import { bytes, harness, tree } from './explorer-harness';

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

    // What the host's tree would say once undo's `mkdir`s and `write`s have
    // landed — the refresh undo triggers as it finishes reads this back.
    ctx.files.nextTree(tree(['game', 'game/spec.json', 'game/sub', 'game/sub/x.bin']));
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
