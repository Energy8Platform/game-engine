import { cpSync, mkdirSync, writeFileSync, renameSync, readFileSync, readdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Answers } from './answers';
import { validate } from './answers';
import { genGameSpec } from './codegen/gameSpec';
import { genPackageJson, type DepVersions } from './codegen/packageJson';
import { genGameScene } from './codegen/gameScene';
import { genLuaLogic } from './codegen/luaLogic';
import { genStakeAdapter } from './codegen/stakeAdapter';
import { genMainTs } from './codegen/mainTs';
import { genNormalize } from './codegen/normalize';

const TEMPLATE_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '../template');

function substituteTree(dir: string, vars: Record<string, string>): void {
  // NOTE: template is text-only. If binary placeholders are ever added under template/,
  // add a file-extension allowlist here — readFileSync(p,'utf8') would corrupt them.
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { substituteTree(p, vars); continue; }
    let text = readFileSync(p, 'utf8');
    for (const [k, val] of Object.entries(vars)) text = text.split('${' + k + '}').join(val);
    writeFileSync(p, text);
  }
}

export async function generate(a: Answers, targetDir: string, versions: DepVersions): Promise<void> {
  validate(a);
  mkdirSync(targetDir, { recursive: true });
  // 1) copy fixed template
  cpSync(TEMPLATE_DIR, targetDir, { recursive: true });
  // _gitignore → .gitignore
  if (existsSync(join(targetDir, '_gitignore'))) renameSync(join(targetDir, '_gitignore'), join(targetDir, '.gitignore'));
  // 2) substitute ${id}/${title}
  substituteTree(targetDir, { id: a.id, title: a.title });
  // 3) codegen files
  mkdirSync(join(targetDir, 'src/game'), { recursive: true });
  writeFileSync(join(targetDir, 'src/game.spec.ts'), genGameSpec(a));
  writeFileSync(join(targetDir, 'package.json'), genPackageJson(a, versions));
  writeFileSync(join(targetDir, 'src/GameScene.ts'), genGameScene(a));
  writeFileSync(join(targetDir, 'src/main.ts'), genMainTs(a));
  writeFileSync(join(targetDir, 'src/game/script.logic.lua'), genLuaLogic(a));
  writeFileSync(join(targetDir, 'src/game/normalize.ts'), genNormalize(a));
  if (a.stake) {
    mkdirSync(join(targetDir, 'src/stake'), { recursive: true });
    const { adapter, schema } = genStakeAdapter(a);
    writeFileSync(join(targetDir, 'src/stake/adapter.ts'), adapter);
    writeFileSync(join(targetDir, 'src/stake/schema.ts'), schema);
  } else if (existsSync(join(targetDir, 'src/stake'))) {
    rmSync(join(targetDir, 'src/stake'), { recursive: true, force: true });
  }
}
