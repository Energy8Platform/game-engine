import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Explorer } from '../src/index';
import { bytes, d, harness, tree } from './explorer-harness';

/**
 * jsdom has no DataTransfer; a plain object with the members the Explorer
 * reads is what `fireEvent` attaches. `types` is live, as a browser's is:
 * what `dragStart` set is what `dragOver` sees.
 */
function transfer(init: { path?: string; files?: File[] }) {
  const data: Record<string, string> = init.path ? { 'text/x-e8-path': init.path } : {};
  return {
    dataTransfer: {
      get types() {
        return Object.keys(data).concat(init.files?.length ? ['Files'] : []);
      },
      files: init.files ?? [],
      getData: (t: string) => data[t] ?? '',
      setData: (t: string, v: string) => {
        data[t] = v;
      },
      dropEffect: 'move',
      effectAllowed: 'move',
    },
  };
}

describe('Explorer — drag and drop', () => {
  it('dropping a file row on a directory moves it there', async () => {
    const ctx = await harness(tree(['game/spec.json', 'assets']));
    render(<Explorer ctx={ctx} />);
    const row = await screen.findByTestId('explorer-game/spec.json');
    expect(row.getAttribute('draggable')).toBe('true');
    const t = transfer({});
    fireEvent.dragStart(row, t);
    expect(t.dataTransfer.getData('text/x-e8-path')).toBe('game/spec.json');
    const dir = screen.getByTestId('explorer-assets');
    fireEvent.dragOver(dir, t);
    expect(dir.classList.contains('e8-drop-target')).toBe(true);
    ctx.files.nextTree(tree(['assets/spec.json']));
    fireEvent.drop(dir, t);
    await waitFor(() => expect(ctx.files.moved).toEqual([['game/spec.json', 'assets/spec.json']]));
    expect(dir.classList.contains('e8-drop-target')).toBe(false);
  });

  it('dropping on the root moves to the root; a directory dropped into itself does nothing', async () => {
    const ctx = await harness(tree(['game/spec.json', 'game/sub/x.txt']));
    render(<Explorer ctx={ctx} />);
    await screen.findByTestId('explorer-game/spec.json');
    fireEvent.drop(screen.getByTestId('explorer-root'), transfer({ path: 'game/spec.json' }));
    await waitFor(() => expect(ctx.files.moved).toEqual([['game/spec.json', 'spec.json']]));
    fireEvent.drop(screen.getByTestId('explorer-game/sub'), transfer({ path: 'game' }));
    fireEvent.drop(screen.getByTestId('explorer-game'), transfer({ path: 'game' }));
    expect(ctx.files.moved).toHaveLength(1);
  });

  it('dropping on a file row targets that file’s directory', async () => {
    const ctx = await harness(tree(['game/spec.json', 'notes.txt']));
    render(<Explorer ctx={ctx} />);
    fireEvent.drop(
      await screen.findByTestId('explorer-game/spec.json'),
      transfer({ path: 'notes.txt' }),
    );
    await waitFor(() => expect(ctx.files.moved).toEqual([['notes.txt', 'game/notes.txt']]));
  });

  it('a file from the OS dropped on a directory is uploaded into it', async () => {
    const ctx = await harness(tree(['assets']));
    render(<Explorer ctx={ctx} />);
    const file = new File([new Uint8Array(bytes('png?'))], 'logo.png');
    fireEvent.drop(await screen.findByTestId('explorer-assets'), transfer({ files: [file] }));
    await waitFor(() => expect(ctx.files.written).toEqual([['assets/logo.png', bytes('png?')]]));
  });

  it('an OS drop onto a name already there asks first', async () => {
    const ctx = await harness(tree(['assets/logo.png']));
    render(<Explorer ctx={ctx} />);
    const file = new File([new Uint8Array(bytes('new'))], 'logo.png');
    fireEvent.drop(await screen.findByTestId('explorer-assets'), transfer({ files: [file] }));
    expect(await screen.findByText(/replace "assets\/logo.png"\?/)).toBeVisible();
    expect(ctx.files.written).toEqual([]);
  });

  it('a refused move shows the host’s words and moves nothing in the tree', async () => {
    const ctx = await harness(
      tree(['a.txt', 'dir']),
      {},
      { moveDiagnostics: [{ ...d('"dir/a.txt" is already there'), code: 'exists' }] },
    );
    render(<Explorer ctx={ctx} />);
    fireEvent.drop(await screen.findByTestId('explorer-dir'), transfer({ path: 'a.txt' }));
    expect(await screen.findByText('"dir/a.txt" is already there')).toBeVisible();
    expect(screen.getByTestId('explorer-a.txt')).toBeVisible();
  });
});
