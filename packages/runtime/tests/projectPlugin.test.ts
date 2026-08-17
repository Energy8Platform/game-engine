import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { projectPlugin } from '@/vite/projectPlugin';

function fixture(project: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'e8-project-'));
  writeFileSync(join(dir, 'project.json'), JSON.stringify(project, null, 2));
  mkdirSync(join(dir, 'plugins', 'my-plugin'), { recursive: true });
  writeFileSync(join(dir, 'plugins', 'my-plugin', 'plugin.ts'), 'export default {};');
  return dir;
}

describe('projectPlugin', () => {
  it('claims the virtual id and nothing else', () => {
    const p = projectPlugin({ root: fixture({ plugins: {} }) });
    expect(p.resolveId('virtual:e8-project')).toBe('\0virtual:e8-project');
    expect(p.resolveId('./something-else')).toBeNull();
  });

  it('emits a static import for each listed plugin', async () => {
    const root = fixture({
      plugins: {
        '@e8/host': { version: '*' },
        '@e8/session-dev': { version: '*' },
        './plugins/my-plugin/plugin.ts': { version: '*' },
      },
    });
    const code = await projectPlugin({ root }).load('\0virtual:e8-project');
    expect(code).toContain('import m0 from "@e8/host"');
    expect(code).toContain('import m2 from "./plugins/my-plugin/plugin.ts"');
    expect(code).toContain('export const manifests = [m0, m1, m2]');
    expect(code).toContain('export const project =');
  });

  it('embeds the project verbatim so the runtime reads what the author wrote', async () => {
    const root = fixture({ plugins: { '@e8/host': { version: '^0.1.0', settings: { debug: true } } } });
    const code = await projectPlugin({ root }).load('\0virtual:e8-project');
    expect(code).toContain('"debug": true');
    expect(code).toContain('"version": "^0.1.0"');
  });

  it('returns null for any other id', async () => {
    const p = projectPlugin({ root: fixture({ plugins: {} }) });
    expect(await p.load('\0virtual:something')).toBeNull();
  });

  it('reports a missing project.json as a build error, not a crash', async () => {
    const p = projectPlugin({ root: join(tmpdir(), 'definitely-not-here-e8') });
    await expect(p.load('\0virtual:e8-project')).rejects.toThrow(/project\.json/);
  });

  it('reports malformed JSON with the file named', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'e8-bad-'));
    writeFileSync(join(dir, 'project.json'), '{ not json');
    await expect(projectPlugin({ root: dir }).load('\0virtual:e8-project')).rejects.toThrow(/project\.json/);
  });

  it('resolves relative specifiers against the project root', () => {
    const root = fixture({ plugins: {} });
    const p = projectPlugin({ root });
    const resolved = p.resolveId('./plugins/my-plugin/plugin.ts', '\0virtual:e8-project');
    expect(resolved).toBe(resolve(root, './plugins/my-plugin/plugin.ts'));
  });

  it('does not resolve relative specifiers for unrelated importers', () => {
    const root = fixture({ plugins: {} });
    const p = projectPlugin({ root });
    const resolved = p.resolveId('./something', '/some/other/file.ts');
    expect(resolved).toBeNull();
  });

  it('validates that the project is a plain object', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'e8-null-'));
    writeFileSync(join(dir, 'project.json'), 'null');
    await expect(projectPlugin({ root: dir }).load('\0virtual:e8-project')).rejects.toThrow(/must be a JSON object/);
  });

  it('validates that plugins is a plain object if present', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'e8-bad-plugins-'));
    writeFileSync(join(dir, 'project.json'), JSON.stringify({ plugins: 'not an object' }));
    await expect(projectPlugin({ root: dir }).load('\0virtual:e8-project')).rejects.toThrow(/"plugins".*must be an object/);
  });

  it('escapes specifiers in generated imports', async () => {
    const root = fixture({
      plugins: {
        "./dummy.mjs'; globalThis.__injected__ = true; //": { version: '*' },
      },
    });
    const code = await projectPlugin({ root }).load('\0virtual:e8-project');
    // The specifier is JSON.stringify'd, so it becomes a quoted string that is safe to import.
    expect(code).toContain('import m0 from "./dummy.mjs\'; globalThis.__injected__ = true; //"');
    // The syntax is quoted; it cannot execute as code.
    const lines = code!.split('\n');
    const importLine = lines.find(l => l.startsWith('import m0'));
    expect(importLine).toMatch(/^import m0 from ".*";$/);
  });

  it('emits a module that references all plugins and exports project and manifests', async () => {
    const root = fixture({
      plugins: {
        './host.mjs': { version: '*', settings: { debug: true } },
        './plugins/my-plugin/plugin.ts': { version: '*' },
      },
    });
    const p = projectPlugin({ root });
    const code = await p.load('\0virtual:e8-project');

    // Verify the structure of the emitted code.
    // Relative specifiers are kept as-is; Vite's resolveId hook handles the resolution.
    expect(code).toContain('import m0 from "./host.mjs"');
    expect(code).toContain('import m1 from "./plugins/my-plugin/plugin.ts"');
    expect(code).toContain('export const manifests = [m0, m1]');
    expect(code).toContain('"debug": true');
    expect(code).toContain('export const project =');

    // Verify each line starts with expected tokens (no unclosed quotes, unescaped injection).
    const lines = code!.split('\n');
    expect(lines.some(l => l.startsWith('import m0'))).toBe(true);
    expect(lines.some(l => l.startsWith('import m1'))).toBe(true);
    expect(lines.some(l => l.startsWith('export const manifests'))).toBe(true);
    expect(lines.some(l => l.startsWith('export const project'))).toBe(true);
  });

  it('emits a module that actually loads, with manifests in the project key order', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'e8-emit-'));
    // Three real, resolvable plugin files. Bare specifiers cannot be resolved from a temp dir,
    // so use relative ones — which is also the shape a project's own plugin takes.
    mkdirSync(join(dir, 'plugins'), { recursive: true });
    writeFileSync(join(dir, 'plugins', 'a.mjs'), 'export default { id: "plugin-a" };');
    writeFileSync(join(dir, 'plugins', 'b.mjs'), 'export default { id: "plugin-b" };');
    writeFileSync(join(dir, 'plugins', 'c.mjs'), 'export default { id: "plugin-c" };');
    writeFileSync(
      join(dir, 'project.json'),
      JSON.stringify({
        plugins: {
          './plugins/b.mjs': { version: '*' },
          './plugins/a.mjs': { version: '*' },
          './plugins/c.mjs': { version: '*' },
        },
      }),
    );

    const code = await projectPlugin({ root: dir }).load('\0virtual:e8-project');
    // The emitted module uses relative specifiers, so write it where they resolve.
    const modPath = join(dir, 'emitted.mjs');
    writeFileSync(modPath, code!);

    const mod = await import(pathToFileURL(modPath).href) as { manifests: Array<{ id: string }>; project: { plugins: Record<string, unknown> } };
    expect(mod.manifests.map((m) => m.id)).toEqual(['plugin-b', 'plugin-a', 'plugin-c']);
    expect(Object.keys(mod.project.plugins)).toEqual(['./plugins/b.mjs', './plugins/a.mjs', './plugins/c.mjs']);
  });
});
