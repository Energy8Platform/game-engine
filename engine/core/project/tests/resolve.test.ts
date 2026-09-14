import { describe, expect, it } from 'vitest';
import { resolveComposition } from '../src/index';

const base = {
  name: 'e8-base',
  rows: [
    { id: 'boot1', name: '@energy8engine/boot' },
    { id: 'reels1', name: '@energy8engine/reels', config: { speed: 1 } },
  ],
};

describe('resolveComposition', () => {
  it('stacks bundles in profile order', () => {
    const extra = { name: 'e8-extra', rows: [{ id: 'x1', name: '@e/x' }] };
    const { composition } = resolveComposition({
      profile: { bundles: ['e8-base', 'e8-extra'] },
      bundles: new Map([
        ['e8-base', base],
        ['e8-extra', extra],
      ]),
      patches: [],
    });
    expect(composition.rows.map((r) => r.id)).toEqual(['boot1', 'reels1', 'x1']);
  });

  it('records which bundle placed each row', () => {
    const { composition } = resolveComposition({
      profile: { bundles: ['e8-base'] },
      bundles: new Map([['e8-base', base]]),
      patches: [],
    });
    expect(composition.rows[0].from).toBe('bundle:e8-base');
  });

  it('a patch REPLACES a row config wholesale, it does not merge', () => {
    const { composition } = resolveComposition({
      profile: { bundles: ['e8-base'] },
      bundles: new Map([['e8-base', base]]),
      patches: [{ layer: 'patch', rows: [{ id: 'reels1', config: { grid: 5 } }] }],
    });
    const reels = composition.rows.find((r) => r.id === 'reels1')!;
    expect(reels.config).toEqual({ grid: 5 }); // NOT { speed: 1, grid: 5 }
    expect(reels.from).toBe('patch');
  });

  it('a patch can insert a row the bundles never placed', () => {
    const { composition } = resolveComposition({
      profile: { bundles: ['e8-base'] },
      bundles: new Map([['e8-base', base]]),
      patches: [{ layer: 'patch', rows: [{ id: 'new1', name: '@e/new', config: {} }] }],
    });
    expect(composition.rows.at(-1)).toMatchObject({ id: 'new1', from: 'patch' });
  });

  it('a patch can remove a row a bundle placed', () => {
    const { composition } = resolveComposition({
      profile: { bundles: ['e8-base'] },
      bundles: new Map([['e8-base', base]]),
      patches: [{ layer: 'patch', rows: [{ id: 'reels1', remove: true }] }],
    });
    expect(composition.rows.map((r) => r.id)).toEqual(['boot1']);
  });

  it('later patch layers win over earlier ones', () => {
    const { composition } = resolveComposition({
      profile: { bundles: ['e8-base'] },
      bundles: new Map([['e8-base', base]]),
      patches: [
        { layer: 'patch', rows: [{ id: 'reels1', config: { a: 1 } }] },
        { layer: 'cli', rows: [{ id: 'reels1', config: { a: 2 } }] },
      ],
    });
    expect(composition.rows.find((r) => r.id === 'reels1')!.config).toEqual({ a: 2 });
    expect(composition.rows.find((r) => r.id === 'reels1')!.from).toBe('cli');
  });

  it('a missing bundle is a diagnostic, not a throw', () => {
    const { composition, diagnostics } = resolveComposition({
      profile: { bundles: ['e8-base', 'nope'] },
      bundles: new Map([['e8-base', base]]),
      patches: [],
    });
    expect(composition.rows.map((r) => r.id)).toEqual(['boot1', 'reels1']);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('nope');
  });

  it('patching a row that does not exist and gives no name is a diagnostic', () => {
    const { diagnostics } = resolveComposition({
      profile: { bundles: ['e8-base'] },
      bundles: new Map([['e8-base', base]]),
      patches: [{ layer: 'patch', rows: [{ id: 'ghost', config: {} }] }],
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('ghost');
  });

  it('two bundles placing the same id is a diagnostic; the later one wins', () => {
    const clash = { name: 'e8-clash', rows: [{ id: 'reels1', name: '@e/other' }] };
    const { composition, diagnostics } = resolveComposition({
      profile: { bundles: ['e8-base', 'e8-clash'] },
      bundles: new Map([
        ['e8-base', base],
        ['e8-clash', clash],
      ]),
      patches: [],
    });
    expect(composition.rows.find((r) => r.id === 'reels1')!.name).toBe('@e/other');
    expect(diagnostics.some((d) => d.message.includes('reels1'))).toBe(true);
  });

  it('names BOTH bundles when two place the same id, and `from` follows the winner', () => {
    const clash = { name: 'e8-clash', rows: [{ id: 'reels1', name: '@e/other' }] };
    const { composition, diagnostics } = resolveComposition({
      profile: { bundles: ['e8-base', 'e8-clash'] },
      bundles: new Map([
        ['e8-base', base],
        ['e8-clash', clash],
      ]),
      patches: [],
    });
    const reels = composition.rows.find((r) => r.id === 'reels1')!;
    expect(reels.name).toBe('@e/other');
    expect(reels.from).toBe('bundle:e8-clash'); // the winner, not the first placer
    const message = diagnostics.find((d) => d.plugin === 'reels1')!.message;
    expect(message).toContain('e8-base'); // the loser is named too
    expect(message).toContain('e8-clash');
  });

  it('a row removed by one layer and re-added by a later one reports the re-adding layer', () => {
    const { composition, diagnostics } = resolveComposition({
      profile: { bundles: ['e8-base'] },
      bundles: new Map([['e8-base', base]]),
      patches: [
        { layer: 'patch', rows: [{ id: 'reels1', remove: true }] },
        { layer: 'cli', rows: [{ id: 'reels1', name: '@e/back', config: { a: 1 } }] },
      ],
    });
    const reels = composition.rows.find((r) => r.id === 'reels1')!;
    expect(reels).toMatchObject({ name: '@e/back', from: 'cli' });
    expect(diagnostics).toEqual([]);
  });

  it('addressing a row an earlier layer removed says so, instead of blaming a typo', () => {
    const { diagnostics } = resolveComposition({
      profile: { bundles: ['e8-base'] },
      bundles: new Map([['e8-base', base]]),
      patches: [
        { layer: 'patch', rows: [{ id: 'reels1', remove: true }] },
        { layer: 'cli', rows: [{ id: 'reels1', config: { a: 1 } }] },
      ],
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('"patch" removed');
    expect(diagnostics[0].message).not.toContain('no bundle placed');
  });
});
