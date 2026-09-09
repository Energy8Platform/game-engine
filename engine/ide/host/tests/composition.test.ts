import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Schema from 'schemastery';
import { createIdeHost, type IdeHost } from '../src/index';

const WORKSPACE = join(__dirname, 'fixtures', 'composition');

let host: IdeHost;
beforeEach(async () => {
  (globalThis as any).__probeApplied = [];
  host = await createIdeHost({ cwd: WORKSPACE, port: 0 });
});
afterEach(async () => {
  await host.stop();
});

describe('composition.snapshot', () => {
  it('lists the entry with its config and live fiber state', async () => {
    const snapshot = await host.ctx.composition.snapshot();
    const row = snapshot.rows.find((r) => r.name === 'probe-plugin');
    expect(row).toBeDefined();
    expect(row!.config).toEqual({ speed: 12 });
    expect(row!.disabled).toBe(false);
    expect(row!.state).toBe(2); // FiberState.ACTIVE
  });

  it('carries the plugin schema as JSON the browser can rebuild', async () => {
    const snapshot = await host.ctx.composition.snapshot();
    const row = snapshot.rows.find((r) => r.name === 'probe-plugin')!;
    // `row.schema` itself must be plain JSON — not a live schemastery
    // instance — since Snapshot exists to cross a socket; a class instance
    // in transit degrades silently (its own toJSON() fires again on the
    // next JSON.stringify, which is not what a naive reader expects).
    expect(typeof row.schema).toBe('object');
    const rebuilt = new Schema(row.schema as any);
    expect(rebuilt.type).toBe('object');
    expect(rebuilt.dict!.speed.meta.min).toBe(1);
  });

  it('keeps the schema readable after crossing the wire — JSON round trip, then rebuild', async () => {
    const snapshot = await host.ctx.composition.snapshot();
    const row = snapshot.rows.find((r) => r.name === 'probe-plugin')!;

    // Simulate the actual socket boundary: serialise the whole snapshot the
    // way the host would send it, and parse it back the way the browser
    // would receive it, before ever touching `.dict`.
    const wired = JSON.parse(JSON.stringify(snapshot));
    const wiredRow = wired.rows.find((r: any) => r.name === 'probe-plugin');
    const rebuilt = new Schema(wiredRow.schema);

    expect(rebuilt.dict!.speed.meta.min).toBe(1);
    expect(rebuilt.dict!.speed.meta.description).toBe('reel speed');
  });

  it('carries the manifest facts the IDE acts on', async () => {
    const snapshot = await host.ctx.composition.snapshot();
    const row = snapshot.rows.find((r) => r.name === 'probe-plugin')!;
    expect(row.hot).toBe(true);
    expect(row.clientUrl).toBe(`/plugin-client/${row.id}`);
  });

  it('says nothing about entries that have no schema, instead of inventing one', async () => {
    const snapshot = await host.ctx.composition.snapshot();
    const include = snapshot.rows.find((r) => r.name === '@cordisjs/plugin-include')!;
    expect(include.clientUrl).toBeNull();
  });

  // Fix round (task 7, "a screen is a plugin"): `client-only` (fixtures/
  // composition/plugins/client-only) has an `e8.client` and no `main`/`"."`
  // export — the exact shape `engine/examples/first-slot/plugins/screen
  // -demo` has, and the shape `schemaOf`'s own `import(name)` was never
  // going to resolve. Before the fix, this row still composed and served
  // its client half fine (`clientUrl` below already proves that half
  // worked) but ALSO produced a spurious `editor error … schema: failed to
  // import "client-only"` diagnostic — which is what turned
  // `diagnostics.spec.ts`'s "one id in both namespaces renders as two rows,
  // not one" red the moment `screendemo1` became a permanent `e8.yml` row:
  // that test counts rows in the diagnostics panel, and a third, unrelated
  // row is not the two it was written to expect. `schemaOf`'s own
  // `NOTHING_IMPORTABLE_CODES` check is what closes it — see that catch
  // block's own doc for why the fix is not "skip when there's no
  // `e8.runtime`" or "skip when `readPackageJson` finds no main", both of
  // which were tried first and both of which broke something else
  // (`probe-plugin`/`ide-bridge`'s already-working schema forms, and this
  // suite's own `broken.test.ts`, respectively).
  it('a client-only row with no importable main produces no schema diagnostic', async () => {
    const snapshot = await host.ctx.composition.snapshot();
    const row = snapshot.rows.find((r) => r.name === 'client-only');
    expect(row).toBeDefined();
    // The client half itself is unaffected — this row still resolves and
    // still serves, so the fix is scoped to the schema probe alone.
    expect(row!.clientUrl).toBe(`/plugin-client/${row!.id}`);
    expect(row!.schema).toBeNull();
    const schemaDiagnostics = snapshot.diagnostics.filter(
      (d) => d.plugin === row!.id && d.where === 'schema',
    );
    expect(schemaDiagnostics).toEqual([]);
  });

  // Fix round 2 (task 7, "a screen is a plugin"): the round-1 fix above
  // silenced every `MODULE_NOT_FOUND`-family failure, and that was one
  // case too wide. `missing-entry-local` (fixtures/composition/plugins/
  // missing-entry-local) declares `main: "./index.js"` — a genuine
  // promise, unlike `client-only`'s package.json above — and no
  // `index.js` sits next to it. `ctx.loader.import` cannot even locate a
  // `plugins/`-only directory to get as far as checking `main` against,
  // so it throws the identical `Cannot find package "missing-entry-local"`
  // `ERR_MODULE_NOT_FOUND` `client-only` throws — same code, same message
  // shape — even though this row's manifest is broken and `client-only`'s
  // is not. Before this round's fix, both produced `diagnostics: []`:
  // not a `package` diagnostic (`readPackageJson` found the manifest
  // fine), not a `schema` one (swallowed), and not an `apply` one either
  // (`@cordisjs/plugin-loader`'s own `Entry._init()` catches the same
  // failure and only logs it to its own logger — a gap upstream of this
  // module, not fixed here). A typo'd `e8.runtime.entry`, or a dependency
  // whose build silently failed to produce its output, would have looked
  // exactly like a healthy client-only plugin: `schema: null`, `state:
  // null`, zero diagnostics. §8 of the design spec requires the opposite.
  it('a row whose declared main does not exist produces exactly one schema diagnostic (project-local)', async () => {
    const snapshot = await host.ctx.composition.snapshot();
    const row = snapshot.rows.find((r) => r.name === 'missing-entry-local');
    expect(row).toBeDefined();
    expect(row!.schema).toBeNull();
    const schemaDiagnostics = snapshot.diagnostics.filter(
      (d) => d.plugin === row!.id && d.where === 'schema',
    );
    expect(schemaDiagnostics).toHaveLength(1);
    expect(schemaDiagnostics[0].message).toContain('missing-entry-local');
  });

  // The hoisted twin of the test above — `missing-entry-hoisted` (a real
  // `node_modules` entry via `file:./tests/fixtures/missing-entry-hoisted`
  // in this workspace's own package.json, the same device
  // `import-broken-plugin`/`probe-plugin` use) — proves the fix on the
  // OTHER resolution path, where `ctx.loader.import`'s failure names the
  // specific missing file (`Cannot find module '<path>/index.js'`) rather
  // than the package itself. Both shapes are `ERR_MODULE_NOT_FOUND`; this
  // test is what confirms the fix catches both, not just the one round-2
  // was written against.
  it('a row whose declared main does not exist produces exactly one schema diagnostic (hoisted)', async () => {
    const snapshot = await host.ctx.composition.snapshot();
    const row = snapshot.rows.find((r) => r.name === 'missing-entry-hoisted');
    expect(row).toBeDefined();
    expect(row!.schema).toBeNull();
    const schemaDiagnostics = snapshot.diagnostics.filter(
      (d) => d.plugin === row!.id && d.where === 'schema',
    );
    expect(schemaDiagnostics).toHaveLength(1);
    expect(schemaDiagnostics[0].message).toContain('missing-entry-hoisted');
  });

  // Fix round 3 (task 7, "a screen is a plugin"): the combination none of
  // the fixtures above cover — a CLIENT-ONLY manifest (nothing importable
  // declared, on purpose, same as `client-only` above) resolved through
  // the HOISTED path (a real `node_modules` entry, same as
  // `missing-entry-hoisted` above) instead of the project-local one.
  // `client-only-hoisted` (`file:./tests/fixtures/client-only-hoisted` in
  // this workspace's own package.json) writes its manifest the modern,
  // well-formed way — an `exports` map with no `"."` key — and Node
  // resolves that through a DIFFERENT thrown code than a `plugins/`-only
  // package with the same shape: `ERR_PACKAGE_PATH_NOT_EXPORTED`, not
  // `ERR_MODULE_NOT_FOUND`, because a hoisted package IS locatable and
  // Node gets as far as reading its `exports` before finding no match.
  // `NOTHING_IMPORTABLE_CODES` not recognizing that third code was
  // round 1's exact bug, alive again on the one path nothing exercised —
  // this test is what closes it, and what would have caught it two
  // rounds ago had it existed then.
  it('a hoisted client-only row with an exports map and no "." key produces no schema diagnostic', async () => {
    const snapshot = await host.ctx.composition.snapshot();
    const row = snapshot.rows.find((r) => r.name === 'client-only-hoisted');
    expect(row).toBeDefined();
    expect(row!.schema).toBeNull();
    const schemaDiagnostics = snapshot.diagnostics.filter(
      (d) => d.plugin === row!.id && d.where === 'schema',
    );
    expect(schemaDiagnostics).toEqual([]);
  });

  // Fix round 4 (task 7, "a screen is a plugin"): `hasImportableMain`
  // required `exp['.']` to be a bare STRING, which missed the CONDITIONAL
  // form — `"exports": { ".": { "import": "./index.js" } }` — the shape a
  // package reaches for the moment it wants separate ESM/CommonJS targets,
  // and at least as common as the plain-string form the other fixtures
  // above use. `conditional-exports-missing` writes its `"."` exactly that
  // way, with `./index.js` missing: Node resolves the `"."` key fine,
  // matches the `"import"` condition, and only then discovers the file
  // itself is not there — throwing the same `ERR_MODULE_NOT_FOUND`
  // `missing-entry-hoisted` (round 2) does. Before this round,
  // `hasImportableMain` saw an OBJECT at `exp['.']` and read it as
  // "nothing declared", silencing a genuine broken-entry fault the same
  // way round 1's original bug did — on a manifest shape this function
  // itself had simply never been taught to look inside. `hasStringTarget`
  // is what closes it: a real fault stays reported the moment ANY
  // condition anywhere under `"."` — nested arbitrarily deep — names an
  // actual file.
  it('a row whose conditional export target is missing produces exactly one schema diagnostic', async () => {
    const snapshot = await host.ctx.composition.snapshot();
    const row = snapshot.rows.find((r) => r.name === 'conditional-exports-missing');
    expect(row).toBeDefined();
    expect(row!.schema).toBeNull();
    const schemaDiagnostics = snapshot.diagnostics.filter(
      (d) => d.plugin === row!.id && d.where === 'schema',
    );
    expect(schemaDiagnostics).toHaveLength(1);
    expect(schemaDiagnostics[0].message).toContain('conditional-exports-missing');
  });
});
