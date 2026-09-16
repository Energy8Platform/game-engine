import { describe, expect, it } from 'vitest';
import { parseManifest } from '../src/index';

describe('parseManifest', () => {
  it('returns null for a package with no e8 field, without complaining', () => {
    expect(parseManifest({ name: 'lodash' }, 'lodash')).toEqual({
      manifest: null,
      diagnostics: [],
    });
  });

  it('reads the client half and the hot flag', () => {
    const { manifest, diagnostics } = parseManifest(
      { e8: { client: { entry: './client.js', inject: ['ui-composition'] }, hot: true } },
      'probe-plugin',
    );
    expect(diagnostics).toEqual([]);
    expect(manifest).toEqual({
      client: { entry: './client.js', inject: ['ui-composition'] },
      hot: true,
    });
  });

  it('defaults hot to false and inject to empty', () => {
    const { manifest } = parseManifest({ e8: { client: { entry: './c.js' } } }, 'p');
    expect(manifest).toEqual({ client: { entry: './c.js', inject: [] }, hot: false });
  });

  it('warns and drops the client half when entry is missing', () => {
    const { manifest, diagnostics } = parseManifest({ e8: { client: {} } }, 'p');
    expect(manifest).toEqual({ hot: false });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe('warning');
    expect(diagnostics[0].where).toBe('e8.client.entry');
  });

  it('warns when e8 is not an object', () => {
    const { manifest, diagnostics } = parseManifest({ e8: 'yes' }, 'p');
    expect(manifest).toBeNull();
    expect(diagnostics[0].where).toBe('e8');
  });

  it('reads the runtime half', () => {
    const { manifest, diagnostics } = parseManifest(
      { e8: { runtime: { entry: './runtime.js' }, hot: true } },
      'probe-plugin',
    );
    expect(diagnostics).toEqual([]);
    expect(manifest).toEqual({ runtime: { entry: './runtime.js' }, hot: true });
  });

  it('ignores an inject list on the runtime half — a runtime half has no such thing', () => {
    // The field was parsed, typed and declared in six package.json files
    // while being read by nothing: a runtime half is applied by
    // `composeFromProject` calling `apply()` directly, never through
    // `ctx.plugin()`, so cordis's dependency gating never sees it. Rows
    // are ordered by the composition. See `E8RuntimeHalf`'s doc comment.
    const { manifest } = parseManifest(
      { e8: { runtime: { entry: './r.js', inject: ['renderer'] } } },
      'p',
    );
    expect(manifest).toEqual({ runtime: { entry: './r.js' }, hot: false });
  });

  it('warns and drops the runtime half when entry is missing', () => {
    const { manifest, diagnostics } = parseManifest({ e8: { runtime: {} } }, 'p');
    expect(manifest).toEqual({ hot: false });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe('warning');
    expect(diagnostics[0].where).toBe('e8.runtime.entry');
  });

  it('leaves runtime undefined and diagnostic-free when the field is absent', () => {
    const { manifest, diagnostics } = parseManifest({ e8: { client: { entry: './c.js' } } }, 'p');
    expect(manifest?.runtime).toBeUndefined();
    expect(diagnostics).toEqual([]);
  });

  it('reads a requires list off the runtime half', () => {
    const { manifest } = parseManifest(
      { e8: { runtime: { entry: './r.ts', requires: ['board'] } } },
      'row1',
    );
    expect(manifest!.runtime!.requires).toEqual(['board']);
  });

  it('reads a schema module path off the runtime half', () => {
    const { manifest, diagnostics } = parseManifest(
      { e8: { runtime: { entry: './r.ts', schema: './src/schema.ts' } } },
      'row1',
    );
    expect(diagnostics).toEqual([]);
    expect(manifest!.runtime!.schema).toBe('./src/schema.ts');
  });

  it('a runtime half with no schema is legal and means none', () => {
    const { manifest } = parseManifest({ e8: { runtime: { entry: './r.ts' } } }, 'row1');
    expect(manifest!.runtime!.schema).toBeUndefined();
  });

  it('a schema that is not a string is a diagnostic naming the row, and the entry still parses', () => {
    const { manifest, diagnostics } = parseManifest(
      { e8: { runtime: { entry: './r.ts', schema: 7 } } },
      'row1',
    );
    expect(manifest!.runtime!.entry).toBe('./r.ts');
    expect(manifest!.runtime!.schema).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].plugin).toBe('row1');
    expect(diagnostics[0].where).toBe('e8.runtime.schema');
  });

  it('a runtime half with no requires is legal and means none', () => {
    const { manifest, diagnostics } = parseManifest(
      { e8: { runtime: { entry: './r.ts' } } },
      'row1',
    );
    expect(manifest!.runtime!.requires).toBeUndefined();
    expect(diagnostics).toEqual([]);
  });

  it('a requires that is not an array at all is a diagnostic naming the row', () => {
    const { diagnostics } = parseManifest(
      { e8: { runtime: { entry: './r.ts', requires: 'board' } } },
      'row1',
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].plugin).toBe('row1');
    expect(diagnostics[0].where).toBe('e8.runtime.requires');
  });

  // The three tests below are the array case, split one per branch. They
  // used to be one test named for all of them, exercising the non-array
  // case only — so `["board", 7]` silently weakened to `["board"]` and
  // `[7]` silently became "requires nothing", both under a name that
  // promised otherwise.
  it('a non-string element of requires is a diagnostic naming the row and the field', () => {
    const { diagnostics } = parseManifest(
      { e8: { runtime: { entry: './r.ts', requires: ['board', 7] } } },
      'row1',
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].plugin).toBe('row1');
    expect(diagnostics[0].where).toBe('e8.runtime.requires');
  });

  it('the valid names in a mixed requires still parse — half a manifest beats none', () => {
    const { manifest } = parseManifest(
      { e8: { runtime: { entry: './r.ts', requires: ['board', 7] } } },
      'row1',
    );
    expect(manifest!.runtime!.requires).toEqual(['board']);
  });

  it('a requires with no string in it at all still says so', () => {
    const { manifest, diagnostics } = parseManifest(
      { e8: { runtime: { entry: './r.ts', requires: [7] } } },
      'row1',
    );
    expect(manifest!.runtime!.requires).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].where).toBe('e8.runtime.requires');
  });

  it('the entry still parses when requires is malformed — half a manifest beats none', () => {
    const { manifest } = parseManifest(
      { e8: { runtime: { entry: './r.ts', requires: 7 } } },
      'row1',
    );
    expect(manifest!.runtime!.entry).toBe('./r.ts');
  });
});
