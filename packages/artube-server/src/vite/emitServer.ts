/**
 * The build-time half of the Artube integration: emit a deployable backend.
 *
 * The seam this closes: an Artube game ships as two deployables, but the
 * game's *math* (`src/game/script.spin`) lives in the client repo while the
 * backend image is the thing that has to run it. Until now nothing carried it
 * across — a studio hand-assembled a server repo from `Dockerfile.template`
 * and copied the `.spin` in by hand, which is exactly the kind of manual step
 * that ships yesterday's math to production without anyone noticing.
 *
 * The Vite plugin already knows the `.spin` path (it hands it to the dev
 * backend on every `npm run dev:artube`), so it is the one place that cannot
 * get it wrong. On `BUILD_TARGET=artube vite build` it now writes a
 * self-contained directory a studio can `docker build` as-is:
 *
 *     dist-artube-server/
 *       Dockerfile      ← copied verbatim from this package's Dockerfile.template
 *       index.js        ← generated entry point, plain JS: no build step in the image
 *       package.json    ← declares @energy8platform/artube-server, nothing else
 *       game.spin       ← byte-for-byte copy of the game's own math
 *       README.md       ← what to do with the directory
 *
 * Two decisions worth stating, because both remove a documented trap:
 *
 * 1. **Plain JS, not TypeScript.** The old template built the studio's
 *    `server/index.ts` inside the image, which made `CMD ["node",
 *    "dist/index.js"]` depend on the studio's `rootDir`/`outDir` — a mismatch
 *    that nests the output at `dist/server/index.js` and is discovered only
 *    when the container refuses to start in the cluster. A generated entry
 *    that is already runnable deletes the whole class: the image has no
 *    TypeScript toolchain, no build stage, and one fewer thing to agree on.
 * 2. **The Dockerfile is copied, not generated.** `Dockerfile.template` is
 *    the single source of truth for the deployment contract (port 80, the
 *    engine-binary build-time check, the health probes), so the file a studio
 *    reads in this package and the file the plugin emits can never drift.
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, join } from 'node:path';

/**
 * Where the game's math lands inside the artifact — and inside the image.
 * Fixed rather than derived from the source filename so `Dockerfile.template`
 * can stay a static file (`COPY game.spin ./game.spin`,
 * `ENV SPIN_PATH=/app/game.spin`). It is also what `loadConfigFromEnv`
 * already defaults `SPIN_PATH` to, so the entry point works even if the
 * `ENV` line is ever dropped.
 *
 * A directory of `.spin` files is copied here as a directory: both the
 * server's own loader and Docker's `COPY` treat the two cases the same, so
 * one name covers both.
 */
export const ARTIFACT_SPIN_NAME = 'game.spin';

/** Default output directory, sibling of the frontend's `dist-artube`. */
export const DEFAULT_SERVER_OUT_DIR = 'dist-artube-server';

/**
 * Resolve a file that lives at this package's root, from either layout:
 * `dist/src/vite/emitServer.js` (published/built) or `src/vite/emitServer.ts`
 * (running from source inside the monorepo, e.g. under vitest). Same
 * two-candidate shape as `resolveCliEntry` — and for the same reason: the
 * package is ESM-only and its `exports` map publishes neither `./package.json`
 * nor `./Dockerfile.template`, so `require.resolve` cannot be used here.
 */
export function resolvePackageFile(name: string): string {
  const candidates = [`../../../${name}`, `../../${name}`].map((rel) =>
    fileURLToPath(new URL(rel, import.meta.url)),
  );
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  throw new Error(
    `[artube] cannot find ${name} inside @energy8platform/artube-server. Looked at:\n  ${candidates.join('\n  ')}`,
  );
}

/**
 * The version range the emitted `package.json` pins.
 *
 * Read from the installed copy of this very package rather than written down
 * anywhere: a hardcoded range would silently keep pinning 0.1.x after the
 * package moves on, and the artifact would install a backend that does not
 * match the plugin that produced it. `^` because the artifact is generated
 * fresh on every build — a studio that wants a hard pin can commit the
 * lockfile `npm install` produces, or pass `serverSpec`.
 */
export function resolveServerSpec(explicit?: string): string {
  if (explicit) return explicit;
  const pkg = JSON.parse(readFileSync(resolvePackageFile('package.json'), 'utf8')) as {
    version?: string;
  };
  if (!pkg.version) throw new Error('[artube] artube-server package.json has no version');
  return `^${pkg.version}`;
}

/** npm package names are lowercase and a short alphabet; game ids may not be. */
export function sanitizePackageName(raw: string): string {
  const name = raw
    .toLowerCase()
    .replace(/^@[^/]+\//, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '');
  return name || 'artube-game';
}

/** The game's own package name, when the build root has one to borrow. */
export function readGameName(root: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name?: string };
    if (pkg.name) return sanitizePackageName(pkg.name);
  } catch {
    // No package.json, or an unreadable one — the default name is fine.
  }
  return 'artube-game';
}

/**
 * The generated entry point. This is the file `Dockerfile.template`'s
 * `CMD ["node", "index.js"]` runs, and it is deliberately the *shortest*
 * program that satisfies the deployment contract: read the platform's
 * environment, listen, and shut down cleanly on the signals Kubernetes sends.
 *
 * Everything configurable is an environment variable read at runtime
 * (`loadConfigFromEnv`), never baked in here: the same image has to be
 * promoted across the platform's environments with different `GameId` /
 * `GamesApiUrl` / `GamesApiKey`, so an artifact that hardcoded them would be
 * an artifact you cannot promote.
 */
export function renderEntry(): string {
  return `// GENERATED by @energy8platform/artube-server/vite on \`BUILD_TARGET=artube vite build\`.
// Do not edit here — edit the game and rebuild. See README.md next to this file.
//
// Plain JavaScript on purpose: the image runs this file directly, so it needs
// no TypeScript toolchain and no build step, and there is no \`rootDir\`/\`outDir\`
// mismatch that can put the entry somewhere \`CMD\` is not looking.
import { createArtubeServer, loadConfigFromEnv } from '@energy8platform/artube-server';

// Reads GameId / GamesApiUrl / GamesApiKey / SPIN_PATH / PORT / DEMO_BALANCE and
// throws naming the missing variable — a broken deploy fails at startup, not on
// the first player's spin.
const config = loadConfigFromEnv();
const server = createArtubeServer(config);
await server.listen();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
`;
}

export interface PackageJsonOptions {
  /** Name for the emitted package — the game's own name, suffixed. */
  gameName: string;
  /** npm spec for `@energy8platform/artube-server`. */
  serverSpec: string;
}

/**
 * The emitted `package.json`. One dependency, because that is genuinely all
 * the image needs: `@energy8platform/artube-server` brings its own runtime
 * deps, and — the part that matters — brings `@energy8platform/platform-core`,
 * whose `postinstall` downloads the `e8-server` engine binary the backend
 * spawns. No `devDependencies` at all: nothing here is compiled.
 */
export function renderPackageJson(opts: PackageJsonOptions): string {
  return (
    JSON.stringify(
      {
        name: `${opts.gameName}-artube-server`,
        version: '0.0.0',
        private: true,
        type: 'module',
        engines: { node: '>=20' },
        scripts: { start: 'node index.js' },
        dependencies: { '@energy8platform/artube-server': opts.serverSpec },
      },
      null,
      2,
    ) + '\n'
  );
}

export interface ReadmeOptions {
  gameName: string;
  serverSpec: string;
  /** Absolute path of the game's own `.spin`, for the provenance line. */
  spinSource: string;
  outDirName: string;
}

/** What a studio finds when it opens the directory. */
export function renderReadme(opts: ReadmeOptions): string {
  return `# ${opts.gameName} — Artube game backend

GENERATED by \`@energy8platform/artube-server/vite\` on \`npm run build:artube\`.
Do not edit anything in here: the next build overwrites the whole directory.
The game's math is copied from \`${opts.spinSource}\` — rebuild the game to
change it.

\`\`\`
${opts.outDirName}/
  Dockerfile     the deployment contract: port 80, /livez + /healthz, and a
                 build-time check that the e8-server engine binary really got
                 installed (see below)
  index.js       the entry point — plain JS, so the image has no build step
  package.json   one dependency: @energy8platform/artube-server@${opts.serverSpec}
  ${ARTIFACT_SPIN_NAME}      the game's math, byte-for-byte
\`\`\`

## Deploy it

\`\`\`bash
docker build --build-arg GIT_HASH=$(git rev-parse HEAD) -t my-game-server .
docker run -p 8080:80 \\
  -e GameId=<publicGameId> \\
  -e GamesApiUrl=wss://<gamesapi>/v1/ws \\
  -e GamesApiKey=<key> \\
  my-game-server
\`\`\`

Or commit the directory's contents into the \`server\` repo the platform builds
for you — the Dockerfile is at the root, which is what the platform's pipeline
expects.

\`GameId\`, \`GamesApiUrl\` and \`GamesApiKey\` are runtime environment variables,
never baked into the image: the same image is promoted across environments.
\`PORT\` defaults to 80 (the platform's ingress talks to that port) and
\`SPIN_PATH\` defaults to \`/app/${ARTIFACT_SPIN_NAME}\`.

## The engine binary

The backend spawns \`e8-server\`, the native math engine, as a child process.
It arrives with \`@energy8platform/platform-core\`'s \`postinstall\`, which
downloads it from GitHub Releases — **so the image build needs network access
to GitHub Releases.** That postinstall never fails an install, so the
Dockerfile checks for the binary right after \`npm install\` and **fails the
image build** with \`no usable e8-server binary found\` rather than letting the
container ship and die on the first player's spin.

For an air-gapped build, bake your own binary in and point \`E8_SERVER_BINARY\`
at it — as an \`ENV\` (visible to both the check and the running container),
before the \`npm install\` line:

\`\`\`dockerfile
COPY vendor/e8-server /usr/local/bin/e8-server
ENV E8_SERVER_BINARY=/usr/local/bin/e8-server
\`\`\`

## Lockfile

There is no \`package-lock.json\` here — it cannot be generated offline. Run
\`npm install\` once in a copy of this directory and commit the lockfile into
your server repo; the Dockerfile's \`COPY package.json package-lock.json* ./\`
already picks it up.
`;
}

export interface EmitOptions {
  /** Vite root — the game repo. */
  root: string;
  /** Absolute path of the game's `.spin` file or directory. */
  spinPath: string;
  /** Output directory name (relative to `root`) or absolute path. */
  outDir: string;
  /** Override the `@energy8platform/artube-server` npm spec. */
  serverSpec?: string;
}

export interface EmitResult {
  outDir: string;
  files: string[];
  serverSpec: string;
  spinSource: string;
}

/**
 * Write the artifact. The directory is wiped first: it is generated output,
 * and a stale `game.spin` surviving a rename is precisely the failure this
 * whole feature exists to prevent.
 */
export function emitServerArtifact(opts: EmitOptions): EmitResult {
  const outDir = opts.outDir;
  if (!existsSync(opts.spinPath)) {
    throw new Error(
      `[artube] spin math not found: ${opts.spinPath}\n` +
        "  The backend artifact cannot be built without the game's math. Pass " +
        'artubePlugin({ spinPath: "…" }) with the right path.',
    );
  }

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const gameName = readGameName(opts.root);
  const serverSpec = resolveServerSpec(opts.serverSpec);
  const spinTarget = join(outDir, ARTIFACT_SPIN_NAME);

  // Copied, not transformed: the artifact's math must be the game's math, and
  // "byte-for-byte" is a property you can check with a hash.
  if (statSync(opts.spinPath).isDirectory()) {
    cpSync(opts.spinPath, spinTarget, { recursive: true });
  } else {
    copyFileSync(opts.spinPath, spinTarget);
  }

  copyFileSync(resolvePackageFile('Dockerfile.template'), join(outDir, 'Dockerfile'));
  writeFileSync(join(outDir, 'index.js'), renderEntry());
  writeFileSync(join(outDir, 'package.json'), renderPackageJson({ gameName, serverSpec }));
  writeFileSync(
    join(outDir, 'README.md'),
    renderReadme({ gameName, serverSpec, spinSource: opts.spinPath, outDirName: basename(outDir) }),
  );

  return {
    outDir,
    files: ['Dockerfile', 'index.js', 'package.json', ARTIFACT_SPIN_NAME, 'README.md'],
    serverSpec,
    spinSource: opts.spinPath,
  };
}
