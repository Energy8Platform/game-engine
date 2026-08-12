/**
 * Регрессия на пропавшую зависимость: `resolveEngineBinary`
 * (`src/engine/spawn.ts`) находит `e8-server` через
 * `require.resolve('@energy8platform/platform-core')` — по одной строке,
 * без единого `import` этого пакета откуда-либо в `src/`. Ничего не мешает
 * кому-то счесть его "неиспользуемым" и убрать из `dependencies`: внутри
 * монорепы всё продолжит работать за счёт workspace-хойстинга, тесты
 * останутся зелёными, и баг всплывёт только у стороннего продакшн-образа,
 * который спавнит голый `e8-server` из PATH и падает на первом спине. Этот
 * тест — не про поведение `resolveEngineBinary` (см. `engine.test.ts` /
 * `tests/bin.test.ts`), а про то, что зависимость вообще объявлена.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');

describe('package.json', () => {
  it('depends on @energy8platform/platform-core, the source of the e8-server binary for consumers outside the monorepo', () => {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies).toHaveProperty('@energy8platform/platform-core');
  });
});
