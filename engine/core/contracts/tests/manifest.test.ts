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
      { e8: { runtime: { entry: './runtime.js', inject: ['session'] }, hot: true } },
      'probe-plugin',
    );
    expect(diagnostics).toEqual([]);
    expect(manifest).toEqual({
      runtime: { entry: './runtime.js', inject: ['session'] },
      hot: true,
    });
  });

  it('defaults runtime inject to empty', () => {
    const { manifest } = parseManifest({ e8: { runtime: { entry: './r.js' } } }, 'p');
    expect(manifest).toEqual({ runtime: { entry: './r.js', inject: [] }, hot: false });
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
});
