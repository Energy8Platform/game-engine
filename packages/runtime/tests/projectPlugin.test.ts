import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    expect(code).toContain("import m0 from '@e8/host'");
    expect(code).toContain("import m2 from './plugins/my-plugin/plugin.ts'");
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
});
