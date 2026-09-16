import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Explorer, Shell } from '../src/index';
import { bytes, d, harness, harnessWithCalls, tree } from './explorer-harness';

/**
 * One sidebar view over the project tree, replacing the tree-walking
 * `AssetsScreen` and `CodeScreen` each did on their own. Step 1 below
 * copies the tree/upload/delete tests that pin a property from the old
 * `assets-screen.test.tsx` (deleted with `AssetsScreen` in Task 6); Step 2
 * is what only Explorer does: opening a document, folding, and fetching
 * the tree exactly once. The harness lives in `explorer-harness.ts`.
 */

describe('Explorer — ported from AssetsScreen', () => {
  it('draws the project tree, directories before their files', async () => {
    render(<Explorer ctx={await harness(tree(['game', 'game/spec.json', 'index.html']))} />);
    const entries = await screen.findAllByTestId(
      /^explorer-(?!upload$|delete-|empty$|new-|input$|root$)/,
    );
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
    // And it went where the tree says: the bytes, under the file's own name.
    expect(ctx.files.written).toEqual([['logo.png', bytes('x')]]);
  });

  // --- Ported from `assets-screen.test.tsx` with that file's deletion
  // (Task 6): each is a property of upload/delete that Explorer carried over
  // whole and nothing else pinned.

  it('a delete the host refuses leaves the entry where it was', async () => {
    const ctx = await harness(
      tree(['logo.png']),
      {},
      { removeDiagnostics: [d('"logo.png" was not found: ENOENT')] },
    );
    render(<Explorer ctx={ctx} />);
    await screen.findByTestId('explorer-logo.png');
    // What a refetch WOULD show if the refusal were ignored — a tree with
    // `logo.png` already gone. Without this the fake tree never changes,
    // so "leaves the entry where it was" can't tell a gated refresh from
    // an unconditional one that happens to fetch the same answer back.
    ctx.files.nextTree(tree([]));
    await userEvent.click(await screen.findByTestId('explorer-delete-logo.png'));
    await userEvent.click(screen.getByTestId('confirm-yes'));
    expect(await screen.findByText(/was not found/)).toBeTruthy();
    expect(screen.getByTestId('explorer-logo.png')).toBeTruthy();
  });

  it('a directory has a delete button too', async () => {
    // The host removes directories now (Task 1), so the row offers it.
    const ctx = await harness(tree(['game', 'game/spec.json']));
    render(<Explorer ctx={ctx} />);
    await screen.findByTestId('explorer-game');
    expect(screen.getByTestId('explorer-delete-game')).toBeTruthy();
    expect(screen.getByTestId('explorer-delete-game/spec.json')).toBeTruthy();
  });

  it('an upload onto a name already there asks before replacing it', async () => {
    // The host replaces a file whole, without a word. Someone who drags
    // in `logo.png` twice did not ask to lose the first.
    const ctx = await harness(tree(['logo.png']));
    render(<Explorer ctx={ctx} />);
    await screen.findByTestId('explorer-logo.png');
    await userEvent.upload(
      screen.getByTestId('explorer-upload') as HTMLInputElement,
      new File(['second'], 'logo.png'),
    );
    expect(await screen.findByText(/replace/)).toBeTruthy();
    expect(ctx.files.written).toEqual([]);
    await userEvent.click(screen.getByTestId('confirm-no'));
    expect(ctx.files.written).toEqual([]);
  });

  it('an upload onto a name nothing claims yet does not ask', async () => {
    const ctx = await harness(tree(['logo.png']));
    render(<Explorer ctx={ctx} />);
    await screen.findByTestId('explorer-logo.png');
    await userEvent.upload(
      screen.getByTestId('explorer-upload') as HTMLInputElement,
      new File(['x'], 'other.png'),
    );
    await waitFor(() => expect(ctx.files.written).toEqual([['other.png', bytes('x')]]));
    expect(screen.queryByText(/replace/)).toBeNull();
  });

  it('a delete refusal reaches the one list, not only this view', async () => {
    // §8 wants ONE diagnostics list, outliving whichever view you are in.
    const refusal = d('"logo.png" resolves outside the project');
    const ctx = await harness(tree(['logo.png']), {}, { removeDiagnostics: [refusal] });
    render(<Explorer ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('explorer-delete-logo.png'));
    await userEvent.click(screen.getByTestId('confirm-yes'));
    await screen.findByText(/outside the project/);
    expect(ctx.connection.diagnostics).toContainEqual(refusal);
  });

  it('a tree that could not be read reaches the one list too', async () => {
    const refusal = d('cannot list ".": EACCES');
    const ctx = await harness({ diagnostics: [refusal] });
    render(<Explorer ctx={ctx} />);
    await screen.findByText(/EACCES/);
    expect(ctx.connection.diagnostics).toContainEqual(refusal);
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

  it('saying yes to the replace question writes the file the second time', async () => {
    // Covers `confirm()`'s overwrite branch (`Explorer.tsx`'s
    // `if (asked.kind === 'overwrite') { upload(...); return; }`) — the one
    // path from `AssetsScreen` this suite hadn't ported yet, whose only
    // coverage used to live in `assets-screen.test.tsx` alone.
    const ctx = await harness(tree(['logo.png']));
    render(<Explorer ctx={ctx} />);
    await screen.findByTestId('explorer-logo.png');
    await userEvent.upload(
      screen.getByTestId('explorer-upload') as HTMLInputElement,
      new File(['second'], 'logo.png'),
    );
    await userEvent.click(await screen.findByTestId('confirm-yes'));
    await waitFor(() => expect(ctx.files.written).toEqual([['logo.png', bytes('second')]]));
  });

  it('deleting removes the entry from the tree', async () => {
    // Covers `confirm()`'s delete-completion branch (`Explorer.tsx`'s
    // `ctx.files.remove(asked.path).then(...)`) — "deleting asks first, and
    // does nothing when the answer is no" above only ever exercises `cancel()`;
    // nothing before this proved "yes" actually calls `remove` and refreshes.
    const ctx = await harness(tree(['logo.png']));
    render(<Explorer ctx={ctx} />);
    ctx.files.nextTree(tree([]));
    await userEvent.click(await screen.findByTestId('explorer-delete-logo.png'));
    await userEvent.click(screen.getByTestId('confirm-yes'));
    expect(ctx.files.removed).toEqual(['logo.png']);
    await waitFor(() => expect(screen.queryByTestId('explorer-logo.png')).toBeNull());
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
    // Two files, not one: a fixture with a single file lets a key
    // hardcoded to that one literal pass this test undetected — see
    // task-4-report.md's disclosure. Asserting both keys, and that they
    // differ, is what actually forces the key to be DERIVED from the
    // clicked path rather than merely equal to it by fixture coincidence.
    const ctx = await harness(tree(['a.txt', 'b.txt']));
    render(<Explorer ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('explorer-a.txt'));
    const firstKey = ctx.shell.active()?.key;
    await userEvent.click(screen.getByTestId('explorer-b.txt'));
    const secondKey = ctx.shell.active()?.key;
    expect(firstKey).toBe('f:a.txt');
    expect(secondKey).toBe('f:b.txt');
    expect(firstKey).not.toBe(secondKey);
  });

  it('clicking a directory folds it, and does not open anything', async () => {
    // A sibling FILE, clicked after the directory round-trip: "does not
    // open anything" is only a directory-specific claim if opening still
    // works for something else right here — otherwise the same assertion
    // passes just as well with `openPath` globally broken (see
    // task-4-report.md's disclosure, reproduced by the reviewer).
    const ctx = await harness(tree(['game', 'game/spec.json', 'sibling.txt']));
    render(<Explorer ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('explorer-game'));
    expect(screen.queryByTestId('explorer-game/spec.json')).toBeNull(); // folded
    expect(ctx.shell.documents()).toEqual([]);
    await userEvent.click(screen.getByTestId('explorer-game'));
    expect(screen.getByTestId('explorer-game/spec.json')).toBeTruthy(); // unfolded
    await userEvent.click(screen.getByTestId('explorer-sibling.txt'));
    expect(ctx.shell.active()?.key).toBe('f:sibling.txt'); // opening still works for a file
  });

  it('Enter on a directory folds it, and Enter on a file opens it', async () => {
    // A5: same rows, from the keyboard.
    const ctx = await harness(tree(['game', 'game/spec.json', 'sibling.txt']));
    render(<Explorer ctx={ctx} />);
    (await screen.findByTestId('explorer-game')).focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.queryByTestId('explorer-game/spec.json')).toBeNull(); // folded
    expect(ctx.shell.documents()).toEqual([]);
    screen.getByTestId('explorer-sibling.txt').focus();
    await userEvent.keyboard('{Enter}');
    expect(ctx.shell.active()?.key).toBe('f:sibling.txt');
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

  it('a .spin opens in the editor and a .png in the viewer', async () => {
    // Through the real `<Shell/>`, so what is asserted is what the tab
    // body actually shows, not which component `openPath` meant to pick.
    // Monaco itself cannot start under jsdom; its host element (or the
    // pane saying it could not start) carries the `editor` testid either
    // way, and an image needs no Monaco at all.
    const ctx = await harness(tree(['game/script.spin', 'art/logo.png']), {
      'game/script.spin': 'game = Spin',
    });
    render(
      <>
        <Explorer ctx={ctx} />
        <Shell ctx={ctx} />
      </>,
    );
    // Every open document stays mounted and the inactive one is hidden
    // (Ruling 13), so "the editor is gone" became "the editor is not
    // visible" — it is still in the DOM, holding whatever was typed.
    await userEvent.click(await screen.findByTestId('explorer-game/script.spin'));
    const body = screen.getByTestId('doc-body');
    const editor = await within(body).findByTestId('editor');
    expect(editor).toBeVisible();
    expect(within(body).queryByRole('img')).toBeNull();
    await userEvent.click(screen.getByTestId('explorer-art/logo.png'));
    expect(within(body).getByRole('img').getAttribute('src')).toBe('/api/files/art/logo.png');
    expect(within(body).getByRole('img')).toBeVisible();
    expect(editor).not.toBeVisible();
  });

  it('an .mp3 opens in an audio player and an .mp4 in a video player', async () => {
    const ctx = await harness(tree(['sfx/win.mp3', 'clips/intro.mp4']));
    const { container } = render(
      <>
        <Explorer ctx={ctx} />
        <Shell ctx={ctx} />
      </>,
    );
    await userEvent.click(await screen.findByTestId('explorer-sfx/win.mp3'));
    expect(container.querySelector('audio')?.getAttribute('src')).toBe('/api/files/sfx/win.mp3');
    await userEvent.click(screen.getByTestId('explorer-clips/intro.mp4'));
    expect(container.querySelector('video')?.getAttribute('src')).toBe(
      '/api/files/clips/intro.mp4',
    );
  });

  it('.lua, .txt, .tsx and .yaml open in the editor too', async () => {
    // The spec's table left these out; the Lua math script was hand-edited
    // a slice earlier, and a viewer over it would have been a step back.
    const paths = ['game/script.lua', 'notes.txt', 'plugins/x/src/ui.tsx', 'e8.yaml'];
    const ctx = await harness(tree(paths), Object.fromEntries(paths.map((path) => [path, 'text'])));
    render(
      <>
        <Explorer ctx={ctx} />
        <Shell ctx={ctx} />
      </>,
    );
    for (const path of paths) {
      await userEvent.click(await screen.findByTestId(`explorer-${path}`));
      const pane = screen.getByTestId(`doc-pane-f:${path}`);
      expect(await within(pane).findByTestId('editor')).toBeTruthy();
    }
  });

  it('the tree is one tree() call, not one per fold', async () => {
    const { ctx, calls } = await harnessWithCalls(tree(['a/x', 'b/y']));
    render(<Explorer ctx={ctx} />);
    await screen.findByTestId('explorer-a');
    await userEvent.click(screen.getByTestId('explorer-a'));
    // A no-op fold would pass the call-count assertion below just as well
    // as a working one — see task-4-report.md's disclosure. This line
    // fails a broken fold right here, instead of letting the neighbour
    // "clicking a directory folds it" test be the only one that notices.
    expect(screen.queryByTestId('explorer-a/x')).toBeNull();
    await userEvent.click(screen.getByTestId('explorer-b'));
    expect(calls.filter((u) => u.endsWith('/api/files')).length).toBe(1);
  });
});

describe('Explorer — verbs', () => {
  it('new folder at the root: the header button, an inline input, Enter → mkdir, tree refreshed', async () => {
    const ctx = await harness(tree(['e8.yml']));
    render(<Explorer ctx={ctx} />);
    await screen.findByTestId('explorer-e8.yml');
    await userEvent.click(screen.getByTestId('explorer-new-folder'));
    const input = screen.getByTestId('explorer-input');
    ctx.files.nextTree(tree(['e8.yml', 'assets']));
    await userEvent.type(input, 'assets{Enter}');
    await waitFor(() => expect(ctx.files.created).toEqual([['assets', 'dir']]));
    await screen.findByTestId('explorer-assets');
    expect(screen.queryByTestId('explorer-input')).toBeNull();
  });

  it('new file inside the selected directory', async () => {
    const ctx = await harness(tree(['game/spec.json']));
    render(<Explorer ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('explorer-game'));
    await userEvent.click(screen.getByTestId('explorer-new-file'));
    await userEvent.type(screen.getByTestId('explorer-input'), 'notes.txt{Enter}');
    await waitFor(() => expect(ctx.files.created).toEqual([['game/notes.txt', 'file']]));
  });

  it('a selected file means its directory', async () => {
    const ctx = await harness(tree(['game/spec.json']), { 'game/spec.json': '{}' });
    render(<Explorer ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('explorer-game/spec.json'));
    await userEvent.click(screen.getByTestId('explorer-new-folder'));
    await userEvent.type(screen.getByTestId('explorer-input'), 'sub{Enter}');
    await waitFor(() => expect(ctx.files.created).toEqual([['game/sub', 'dir']]));
  });

  it('Escape cancels; an empty name, a slash, and dots are refused before any request', async () => {
    const ctx = await harness(tree(['e8.yml']));
    render(<Explorer ctx={ctx} />);
    await screen.findByTestId('explorer-e8.yml');
    await userEvent.click(screen.getByTestId('explorer-new-file'));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByTestId('explorer-input')).toBeNull();
    for (const bad of ['a/b', '..', '.']) {
      await userEvent.click(screen.getByTestId('explorer-new-file'));
      await userEvent.type(screen.getByTestId('explorer-input'), `${bad}{Enter}`);
      expect(screen.getByText(/is not a valid name/)).toBeVisible();
    }
    await userEvent.click(screen.getByTestId('explorer-new-file'));
    await userEvent.keyboard('{Enter}');
    expect(ctx.files.created).toEqual([]);
  });

  it('right-click opens a menu whose items fit the row', async () => {
    const ctx = await harness(tree(['game/spec.json']));
    render(<Explorer ctx={ctx} />);
    fireEvent.contextMenu(await screen.findByTestId('explorer-game'));
    const menu = screen.getByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((b) => b.textContent),
    ).toEqual(['New file', 'New folder', 'Upload here', 'Rename', 'Delete']);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.contextMenu(screen.getByTestId('explorer-game/spec.json'));
    expect(
      within(screen.getByRole('menu'))
        .getAllByRole('menuitem')
        .map((b) => b.textContent),
    ).toEqual(['Rename', 'Delete']);
  });

  it('rename: the menu, an inline input with the old name, Enter → move, the open tab follows', async () => {
    const ctx = await harness(tree(['game/spec.json']), { 'game/spec.json': '{}' });
    render(
      <>
        <Explorer ctx={ctx} />
        <Shell ctx={ctx} />
      </>,
    );
    await userEvent.click(await screen.findByTestId('explorer-game/spec.json'));
    expect(ctx.shell.documents().map((doc) => doc.key)).toContain('f:game/spec.json');
    fireEvent.contextMenu(screen.getByTestId('explorer-game/spec.json'));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const input = screen.getByTestId('explorer-input') as HTMLInputElement;
    expect(input.value).toBe('spec.json');
    ctx.files.nextTree(tree(['game/spec2.json']));
    await userEvent.clear(input);
    await userEvent.type(input, 'spec2.json{Enter}');
    await waitFor(() => expect(ctx.files.moved).toEqual([['game/spec.json', 'game/spec2.json']]));
    await waitFor(() =>
      expect(ctx.shell.documents().map((doc) => doc.key)).toEqual(['f:game/spec2.json']),
    );
  });

  it('moving a directory reopens every document under it at the new path', async () => {
    const ctx = await harness(tree(['game/spec.json', 'game/sub/x.txt']), {
      'game/spec.json': '{}',
      'game/sub/x.txt': 'x',
    });
    render(<Explorer ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('explorer-game/spec.json'));
    await userEvent.click(screen.getByTestId('explorer-game/sub/x.txt'));
    fireEvent.contextMenu(screen.getByTestId('explorer-game'));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    ctx.files.nextTree(tree(['play/spec.json', 'play/sub/x.txt']));
    await userEvent.clear(screen.getByTestId('explorer-input'));
    await userEvent.type(screen.getByTestId('explorer-input'), 'play{Enter}');
    await waitFor(() => expect(ctx.files.moved).toEqual([['game', 'play']]));
    await waitFor(() =>
      expect(ctx.shell.documents().map((doc) => doc.key)).toEqual([
        'f:play/spec.json',
        'f:play/sub/x.txt',
      ]),
    );
  });

  it('deleting a folder asks with the count of what is inside, then removes', async () => {
    const ctx = await harness(tree(['game/spec.json', 'game/script.spin', 'game/sub/x.txt']));
    render(<Explorer ctx={ctx} />);
    fireEvent.contextMenu(await screen.findByTestId('explorer-game'));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(screen.getByText('delete folder "game" and 4 entries?')).toBeVisible();
    ctx.files.nextTree(tree([]));
    await userEvent.click(screen.getByTestId('confirm-yes'));
    await waitFor(() => expect(ctx.files.removed).toEqual(['game']));
  });

  it('a refused verb shows the host’s words and leaves the tree alone', async () => {
    const ctx = await harness(
      tree(['e8.yml']),
      {},
      { createDiagnostics: [d('"x" is already there')] },
    );
    render(<Explorer ctx={ctx} />);
    await screen.findByTestId('explorer-e8.yml');
    ctx.files.nextTree(tree(['e8.yml', 'x']));
    await userEvent.click(screen.getByTestId('explorer-new-folder'));
    await userEvent.type(screen.getByTestId('explorer-input'), 'x{Enter}');
    expect(await screen.findByText('"x" is already there')).toBeVisible();
    expect(screen.queryByTestId('explorer-x')).toBeNull();
  });

  it('Upload here writes into that directory', async () => {
    const ctx = await harness(tree(['game/spec.json']));
    render(<Explorer ctx={ctx} />);
    fireEvent.contextMenu(await screen.findByTestId('explorer-game'));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Upload here' }));
    const file = new File([new Uint8Array(bytes('hi'))], 'notes.txt');
    await userEvent.upload(screen.getByTestId('explorer-upload'), file);
    await waitFor(() => expect(ctx.files.written).toEqual([['game/notes.txt', bytes('hi')]]));
  });

  it('new file in an empty project still shows the input', async () => {
    const ctx = await harness(tree([]));
    render(<Explorer ctx={ctx} />);
    await screen.findByTestId('explorer-empty');
    await userEvent.click(screen.getByTestId('explorer-new-file'));
    ctx.files.nextTree(tree(['e8.yml']));
    await userEvent.type(screen.getByTestId('explorer-input'), 'e8.yml{Enter}');
    await waitFor(() => expect(ctx.files.created).toEqual([['e8.yml', 'file']]));
    await screen.findByTestId('explorer-e8.yml');
  });

  it('new file under a folded directory unfolds it', async () => {
    const ctx = await harness(tree(['game/spec.json']));
    render(<Explorer ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('explorer-game'));
    expect(screen.queryByTestId('explorer-game/spec.json')).toBeNull();
    fireEvent.contextMenu(screen.getByTestId('explorer-game'));
    await userEvent.click(screen.getByRole('menuitem', { name: 'New file' }));
    expect(screen.getByTestId('explorer-game/spec.json')).toBeTruthy();
    expect(screen.getByTestId('explorer-input')).toBeTruthy();
  });

  it('a cancelled "Upload here" does not redirect the next header upload', async () => {
    const ctx = await harness(tree(['game/spec.json']));
    render(<Explorer ctx={ctx} />);
    fireEvent.contextMenu(await screen.findByTestId('explorer-game'));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Upload here' }));
    // The picker was dismissed: no change event. Then the header control.
    await userEvent.click(screen.getByTitle('upload file'));
    await userEvent.upload(screen.getByTestId('explorer-upload'), new File(['x'], 'notes.txt'));
    await waitFor(() => expect(ctx.files.written).toEqual([['notes.txt', bytes('x')]]));
  });

  it('switching the create target starts a fresh input', async () => {
    const ctx = await harness(tree(['game/spec.json', 'art/logo.png']));
    render(<Explorer ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('explorer-game'));
    await userEvent.click(screen.getByTestId('explorer-new-file'));
    await userEvent.type(screen.getByTestId('explorer-input'), 'abc');
    fireEvent.contextMenu(screen.getByTestId('explorer-art'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'New file' })); // no blur
    expect((screen.getByTestId('explorer-input') as HTMLInputElement).value).toBe('');
  });

  it('deleting the selected entry clears the selection', async () => {
    const ctx = await harness(tree(['game/spec.json']), { 'game/spec.json': '{}' });
    render(<Explorer ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('explorer-game/spec.json'));
    ctx.files.nextTree(tree(['game']));
    await userEvent.click(screen.getByTestId('explorer-delete-game/spec.json'));
    await userEvent.click(screen.getByTestId('confirm-yes'));
    await waitFor(() => expect(screen.queryByTestId('explorer-game/spec.json')).toBeNull());
    await userEvent.click(screen.getByTestId('explorer-new-file'));
    await userEvent.type(screen.getByTestId('explorer-input'), 'x{Enter}');
    await waitFor(() => expect(ctx.files.created).toEqual([['x', 'file']]));
  });

  it('a mousedown outside the menu closes it', async () => {
    const ctx = await harness(tree(['game/spec.json']));
    render(<Explorer ctx={ctx} />);
    fireEvent.contextMenu(await screen.findByTestId('explorer-game'));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('a click selects the row', async () => {
    const ctx = await harness(tree(['game/spec.json']));
    render(<Explorer ctx={ctx} />);
    const row = await screen.findByTestId('explorer-game');
    expect(row.classList.contains('e8-explorer-selected')).toBe(false);
    await userEvent.click(row);
    expect(row.classList.contains('e8-explorer-selected')).toBe(true);
  });
});
