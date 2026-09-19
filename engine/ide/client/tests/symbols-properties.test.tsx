import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SymbolsDoc } from '@energy8engine/contracts';
import { accept, boot, harness, KNOWN, renderSide, TWO } from './symbols-harness';

/**
 * The symbol inspector, rendered through the plugin's own `shell.sideRight`
 * registration (key `symbols`). Every edit is asserted as the `{ doc }`
 * PUT body that went out.
 */
async function booted(routes: Parameters<typeof harness>[0] = {}, doc: SymbolsDoc = TWO) {
  const h = await harness(
    {
      'GET /api/symbols': boot({ doc, known: KNOWN, diagnostics: [] }),
      'PUT /api/symbols': accept,
      ...routes,
    },
    { scenes: [{ id: 'base_game', nodes: [{ id: 'logo', type: 'image', props: {} }] }] },
  );
  await waitFor(() => expect(h.ctx.symbols.doc()).toEqual(doc));
  const docs = () => h.puts().map((b) => (b as { doc: SymbolsDoc }).doc);
  return { ...h, docs };
}

describe('SymbolsProperties', () => {
  it('name (blur commits, unchanged is no write) and fit', async () => {
    const { ctx, docs } = await booted();
    act(() => ctx.symbols.select({ id: '2', state: 'static' }));
    renderSide(ctx);
    expect(screen.getByTestId('side-right-symbols')).toBeTruthy();
    const name = screen.getByTestId('prop-symbol-name') as HTMLInputElement;
    expect(name.value).toBe('lemon');
    fireEvent.blur(name);
    expect(docs()).toHaveLength(0);
    fireEvent.change(name, { target: { value: ' lime ' } });
    fireEvent.blur(name);
    await waitFor(() => expect(docs()).toHaveLength(1));
    expect(docs()[0].symbols[1]).toEqual({ ...TWO.symbols[1], name: 'lime' });

    const fit = screen.getByTestId('prop-symbol-fit') as HTMLSelectElement;
    expect(fit.value).toBe('none');
    fireEvent.change(fit, { target: { value: 'contain' } });
    await waitFor(() => expect(docs()).toHaveLength(2));
    expect(docs()[1].symbols[1]).toEqual({ ...TWO.symbols[1], name: 'lime', fit: 'contain' });
    expect(docs()[1].symbols[0]).toEqual(TWO.symbols[0]);
  });

  it("the state's type select (accept-ing types, image first) and its form: an asset field is a file select; a change PUTs the merged props", async () => {
    const { ctx, docs } = await booted();
    act(() => ctx.symbols.select({ id: '1', state: 'win' }));
    renderSide(ctx);
    const type = screen.getByTestId('prop-state-type') as HTMLSelectElement;
    expect([...type.options].map((o) => o.value)).toEqual(['image', 'spritesheet']);
    expect(type.value).toBe('spritesheet');
    const sheet = screen.getByLabelText('sheet file') as HTMLSelectElement;
    expect(sheet.tagName).toBe('SELECT');
    await waitFor(() =>
      expect([...sheet.options].map((o) => o.value)).toEqual(['', 'assets/coin.json']),
    );
    expect((screen.getByLabelText('loop') as HTMLInputElement).checked).toBe(false);
    // The common props ride along: the wrapper applies them.
    const x = screen.getByLabelText('x, design px') as HTMLInputElement;
    fireEvent.change(x, { target: { value: '4' } });
    fireEvent.blur(x);
    await waitFor(() => expect(docs()).toHaveLength(1));
    expect(docs()[0].symbols[0].win).toEqual({
      type: 'spritesheet',
      props: { sheet: 'assets/coin.json', loop: false, x: 4 },
    });
    expect(screen.queryByTestId('prop-state-create')).toBeNull();
  });

  it('a type change keeps the props the new schema also has and drops the rest', async () => {
    const doc: SymbolsDoc = {
      version: 1,
      symbols: [
        {
          ...TWO.symbols[0],
          win: { type: 'spritesheet', props: { sheet: 'assets/coin.json', loop: false, x: 4 } },
        },
      ],
    };
    const { ctx, docs } = await booted({}, doc);
    act(() => ctx.symbols.select({ id: '1', state: 'win' }));
    renderSide(ctx);
    fireEvent.change(screen.getByTestId('prop-state-type'), { target: { value: 'image' } });
    await waitFor(() => expect(docs()).toHaveLength(1));
    expect(docs()[0].symbols[0].win).toEqual({ type: 'image', props: { x: 4 } });
    await waitFor(() =>
      expect((screen.getByTestId('prop-state-type') as HTMLSelectElement).value).toBe('image'),
    );
    expect(screen.getByLabelText('image file')).toBeTruthy();
  });

  it('a state the def has not got is a Create button that PUTs an empty image', async () => {
    const { ctx, docs } = await booted();
    act(() => ctx.symbols.select({ id: '1', state: 'idle' }));
    renderSide(ctx);
    expect(screen.queryByTestId('prop-state-type')).toBeNull();
    expect(document.querySelector('.e8-schema-form')).toBeNull();
    fireEvent.click(screen.getByTestId('prop-state-create'));
    await waitFor(() => expect(docs()).toHaveLength(1));
    expect(docs()[0].symbols[0].idle).toEqual({ type: 'image', props: { src: '' } });
    await waitFor(() => expect(screen.getByTestId('prop-state-type')).toBeTruthy());
    expect(screen.queryByTestId('prop-state-create')).toBeNull();
  });

  it("the host's refusal shows as prop-error; a type the game did not report stays offered", async () => {
    const refusal = { severity: 'error', plugin: 'symbols', where: 'symbols/2', message: 'no' };
    const doc: SymbolsDoc = {
      ...TWO,
      symbols: [TWO.symbols[0], { ...TWO.symbols[1], static: { type: 'mystery', props: {} } }],
    };
    const { ctx } = await booted(
      { 'PUT /api/symbols': () => ({ status: 400, body: { diagnostics: [refusal] } }) },
      doc,
    );
    act(() => ctx.symbols.select({ id: '2', state: 'static' }));
    renderSide(ctx);
    const type = screen.getByTestId('prop-state-type') as HTMLSelectElement;
    expect([...type.options].map((o) => o.value)).toEqual(['image', 'spritesheet', 'mystery']);
    expect(type.value).toBe('mystery');
    fireEvent.change(screen.getByTestId('prop-symbol-fit'), { target: { value: 'contain' } });
    expect(await screen.findByTestId('prop-error')).toHaveTextContent('no');
  });

  it('a selected symbol no longer in the document renders the root and nothing else', async () => {
    const { ctx } = await booted();
    act(() => ctx.symbols.select({ id: 'gone', state: 'static' }));
    renderSide(ctx);
    expect(screen.getByTestId('side-right-symbols')).toBeTruthy();
    expect(screen.queryByTestId('prop-symbol-name')).toBeNull();
  });
});
