import { cpSync, mkdirSync, writeFileSync, renameSync, readFileSync, readdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Answers } from './answers';
import { validate } from './answers';
import { genGameSpec } from './codegen/gameSpec';
import { genClaudeMd } from './codegen/claudeMd';
import { genPackageJson, type DepVersions } from './codegen/packageJson';
import { genGameScene } from './codegen/gameScene';
import { genReelConfig } from './codegen/reelConfig';
import { genSpinLogic } from './codegen/spinLogic';
import { genStakeAdapter } from './codegen/stakeAdapter';
import { genMainTs } from './codegen/mainTs';
import { genIntroScene } from './codegen/introScene';
import { genNormalize } from './codegen/normalize';
import { genSchema } from './codegen/schema';
import { genMathConfig } from './codegen/mathConfig';
import { genI18nTs } from './codegen/i18nTs';

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

/** The README's Artube block (empty for a non-Artube game) — see `${artube}` in template/README.md. */
function artubeReadme(a: Answers): string {
  if (!a.artube) return '';
  return `## Artube
- \`npm run dev:artube\` — ONE command. No dev bridge, so spins come from the backend exactly as in
  production. The dev server starts the game's backend (\`@energy8platform/artube-server\`) itself,
  on a free port it picks, and proxies \`/api\` to it — there is nothing else to start.
  Against the public sandbox by default; \`ARTUBE_BACKEND=http://localhost:8080\` proxies at a
  backend you run yourself instead.
- \`npm run build:artube\` — BOTH Artube deployables:
  - \`dist-artube/\` — the frontend (its own folder, like \`dist-stake/\`). **Artube's CI pipeline
    deploys the repo's \`dist\` folder**, so point the pipeline at \`dist-artube\` — change the job's
    artifact path, or copy the folder in CI.
  - \`dist-artube-server/\` — the deployable backend, emitted by the same plugin: this game's
    \`.spin\` byte-for-byte, a plain-JS entry point, a \`package.json\` and a \`Dockerfile\`.
    \`docker build\` it as-is, or commit it into the server repo. See its README. Generated output —
    wiped and rewritten every build.
- Enabled in \`src/main.ts\` via
  \`createSlotGame({ artube: { load: () => import('@energy8platform/artube-bridge') } })\`; the host
  classifies the launch, refuses a malformed one, and loads the bridge itself.
- **Loading screen** — an Artube build opens on ARTUBE's branded two-phase loader.
  \`artubePartnerLoader()\` (vite.config.ts) injects it into \`index.html\`, so it is painted before
  the game bundle is even fetched, and \`src/main.ts\` hands the engine its controller as
  \`loading.externalOverlay\`. It covers exactly the gap nothing of this game can paint — bundle
  download, Pixi init, the SDK handshake — and the engine dismisses it the moment ITS OWN loading
  screen has painted its first frame. From there the player gets this game's loading screen, bar
  and tap-to-start, exactly as on every other target. In order: Artube's dark partner screen →
  Artube's green branded screen with the bar filling as the game boots → this game's loading
  screen → the game.

### Nothing to install from Artube

There is no registry to configure, no \`.npmrc\` and no token: Artube's loader is vendored into
\`@energy8platform/artube-bridge\` (the browser controller) and \`@energy8platform/artube-server\`
(the Vite plugin that injects the markup). A plain \`npm install\` resolves everything.

`;
}

export async function generate(a: Answers, targetDir: string, versions: DepVersions): Promise<void> {
  validate(a);
  mkdirSync(targetDir, { recursive: true });
  // 1) copy fixed template
  cpSync(TEMPLATE_DIR, targetDir, { recursive: true });
  // _gitignore → .gitignore
  if (existsSync(join(targetDir, '_gitignore'))) renameSync(join(targetDir, '_gitignore'), join(targetDir, '.gitignore'));
  // 2) substitute ${id}/${title}/${artube}
  substituteTree(targetDir, { id: a.id, title: a.title, artube: artubeReadme(a) });
  // 3) codegen files
  mkdirSync(join(targetDir, 'src/game'), { recursive: true });
  mkdirSync(join(targetDir, 'src/scenes'), { recursive: true });
  writeFileSync(join(targetDir, 'src/game.spec.ts'), genGameSpec(a));
  writeFileSync(join(targetDir, 'CLAUDE.md'), genClaudeMd(a));
  writeFileSync(join(targetDir, 'package.json'), genPackageJson(a, versions));
  writeFileSync(join(targetDir, 'math.config.ts'), genMathConfig(a));
  writeFileSync(join(targetDir, 'src/scenes/GameScene.ts'), genGameScene(a));
  writeFileSync(join(targetDir, 'src/slot/reelConfig.ts'), genReelConfig(a));
  writeFileSync(join(targetDir, 'src/i18n.ts'), genI18nTs(a));
  writeFileSync(join(targetDir, 'src/main.ts'), genMainTs(a));
  writeFileSync(join(targetDir, 'src/scenes/IntroScene.ts'), genIntroScene(a));
  writeFileSync(join(targetDir, 'src/game/script.spin'), genSpinLogic(a));
  writeFileSync(join(targetDir, 'src/game/normalize.ts'), genNormalize(a));
  writeFileSync(join(targetDir, 'src/game/schema.ts'), genSchema(a));
  if (a.stake) {
    mkdirSync(join(targetDir, 'src/stake'), { recursive: true });
    const { adapter } = genStakeAdapter(a);
    writeFileSync(join(targetDir, 'src/stake/adapter.ts'), adapter);
  } else if (existsSync(join(targetDir, 'src/stake'))) {
    rmSync(join(targetDir, 'src/stake'), { recursive: true, force: true });
  }
}
