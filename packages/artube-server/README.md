# @energy8platform/artube-server

Game backend that runs an `@energy8platform/game-sdk` slot on the Artube
platform. It speaks the platform's GamesAPI over a persistent WebSocket
(session open/resume, round open/update/close, autoclose of abandoned
rounds), drives the game's math via a local engine subprocess, and exposes a
thin player-facing WS API (`/api/ws`) plus the two health probes the platform
expects (`/livez`, `/healthz`).

This package is a **library + CLI**, not a deployable service on its own. A
game studio's server repo depends on it, writes a few lines of glue
(`server/index.ts`, shown below), and ships that repo's own Docker image —
built from the `Dockerfile.template` this package provides.

## Entry points

- `@energy8platform/artube-server` (`.`) — `createArtubeServer`, `ArtubeServer`,
  `loadConfigFromEnv`, `type ArtubeServerConfig`, `createLogger`, and the wire
  types (`ClientMessage`, `ServerMessage`, `SessionContext`, `PlayRequest`,
  `SegmentDelivery`, `InitPayload`, `InitConfig`, `FrcInfo`). Everything a
  studio's own `server/index.ts` needs.
- `@energy8platform/artube-server/games-api` — `GamesApiClient` and the
  envelope/contract primitives (`buildEnvelope`, `parseEnvelope`,
  `GamesApiError`, `ANNOUNCED_CONTRACTS`, …) for talking to the platform's
  GamesAPI directly, without the HTTP/WS layer.
- `@energy8platform/artube-server/engine` — `startEngine`, `EngineClient`,
  and the engine-subprocess primitives (`spawnEngine`, `resolveEngineBinary`,
  `findFreePort`) for driving the game's math engine directly.

The package also installs a CLI binary, `artube-server` (`bin/artube-server.ts`,
built to `dist/bin/artube-server.js`) — mainly useful for running the service
locally against the public sandbox without writing any glue code; see
"Running against the sandbox" below.

## Usage: `server/index.ts`

A studio's server repo wraps this package in its own tiny entry point. This
is what the `Dockerfile.template`'s `CMD ["node", "dist/index.js"]` expects
to find once that repo builds its own TypeScript:

```ts
// server/index.ts
import { createArtubeServer, loadConfigFromEnv } from '@energy8platform/artube-server';

const config = loadConfigFromEnv();
const server = createArtubeServer(config);
await server.listen();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
```

`loadConfigFromEnv()` reads the environment variables the platform's DevOps
hands over (see the table below) and throws with the missing variable's name
if a required one is absent — fail fast on a broken deploy, not on the first
request.

> **Check your emitted path before trusting `CMD ["node", "dist/index.js"]`.**
> The Dockerfile template's `CMD` assumes your own `tsconfig.json` compiles
> `server/index.ts` straight to `dist/index.js`. If your `rootDir` is the
> repo root (or anything other than the folder `server/index.ts` lives in),
> `tsc` will instead nest the output — e.g. `dist/server/index.js` — and the
> container will fail to start with `Error: Cannot find module
> '/app/dist/index.js'`, discovered only once it's running (or not) in the
> cluster. This exact `rootDir`/`outDir` mismatch is why this package's own
> `package.json` `main`/`exports` briefly pointed at paths that didn't exist —
> after building, always confirm with `ls dist/index.js` (or update the
> `CMD` to match wherever your build actually puts it) before shipping the
> image.

## Environment variables

| Variable         | Required | Meaning                                                                 |
| ---------------- | -------- | ------------------------------------------------------------------------ |
| `GameId`         | yes      | The game's `publicGameId`, set by the platform.                          |
| `GamesApiUrl`    | yes      | Full WSS URL of the platform's GamesAPI, including the `game` query param.|
| `GamesApiKey`    | yes      | Secret used to authenticate with the GamesAPI.                           |
| `SPIN_PATH`      | no       | Path to the game's `.spin` file or a directory containing one. Defaults to `./game.spin`. |
| `PORT`           | no       | HTTP/WS listen port. Defaults to `80` — the platform's deployment contract. |
| `DEMO_BALANCE`   | no       | Starting virtual balance for demo (non-authenticated) sessions. Defaults to `1000`. |
| `E8_SERVER_BINARY` | no     | Explicit path to a local `e8-server` binary. Overrides the `@energy8platform/platform-core` lookup — see "Engine binary" below. |

`GIT_HASH` is not read from the runtime environment — it's a Docker
**build-arg** (see `Dockerfile.template`), baked in at image build time and
surfaced read-only at `GET /api/version`.

## Engine binary

At runtime this package spawns `e8-server`, the native SpinML math engine,
as a child process (`resolveEngineBinary` in `src/engine/spawn.ts`). It is
looked up in this order: an explicit `binPath` → `E8_SERVER_BINARY` → the
copy that `@energy8platform/platform-core` downloads for the current
platform → a bare `e8-server` on `PATH`.

That download is `@energy8platform/platform-core`'s own `postinstall`
script (`scripts/install-e8.mjs`), which fetches the binary for your
platform from this repo's GitHub Releases into platform-core's own `bin/`
directory. `artube-server` depends on `@energy8platform/platform-core`
specifically to get this for free — **the build needs network access to
GitHub Releases** for the `npm ci` step in `Dockerfile.template`'s final
stage to succeed at anything more than a no-op.

Two things make that download silently absent even though `npm ci`
otherwise succeeds:

- A build environment with no network reachability to GitHub Releases —
  `install-e8.mjs` treats a failed download as non-fatal (so Lua-only games
  aren't broken by it) and just logs and moves on.
- `npm ci --ignore-scripts`, which skips `postinstall` entirely.

Either way, the container would previously build cleanly and then die on
its first spin with "no such file or directory" or a bare `e8-server` from
`PATH` that doesn't exist. `Dockerfile.template`'s final stage now runs a
build-time check, right after its own `npm ci --omit=dev`, that resolves
the binary exactly the way `resolveEngineBinary` does at runtime and
confirms it exists and is executable — **if it fires, the image build fails
with `[artube-server] no usable e8-server binary found`**, instead of the
image shipping and the first player's spin failing instead.

For an air-gapped build, or to use a locally-built engine, set
`E8_SERVER_BINARY` — both the runtime lookup and the build-time check honor
it ahead of the platform-core download. **It must be an `ENV`, not an
`ARG`.** Docker only exposes a build-arg to the `RUN` step that declared it
via a matching `ARG` line in that stage — the template declares none, so
`docker build --build-arg E8_SERVER_BINARY=…` alone is a silent no-op and
the build-time check still fails. And even a declared `ARG` doesn't survive
into the running container, so a build could pass the check and then die on
the first spin anyway — the exact failure this package's build-time check
exists to catch, reopened through a less obvious path. `ENV` is visible to
every later step *and* to the running container, which is what both the
check and the runtime `spawnEngine()` need.

Bake in your own binary (e.g. copied from a private build) and point
`E8_SERVER_BINARY` at it in a studio `Dockerfile` layered on this template,
**before** the `Dockerfile.template` lines that run `npm ci --omit=dev` and
the build-time check:

```dockerfile
# Before the `RUN npm ci --omit=dev` / engine-binary-check block from
# Dockerfile.template:
COPY vendor/e8-server /usr/local/bin/e8-server
ENV E8_SERVER_BINARY=/usr/local/bin/e8-server
```

## `@energy8platform/game-sdk` comes along too

`@energy8platform/platform-core` declares `@energy8platform/game-sdk: ^2.9.0`
as a (non-optional) `peerDependency`. Under npm 7+'s default peer
auto-install, adding `artube-server` to a studio's server repo therefore
also installs `game-sdk@^2.9.0` there, even though nothing in this package
imports it.

That's not an accidental surprise — it's the same floor stated twice. The
frontend half of this integration, `@energy8platform/artube-bridge`,
already requires `@energy8platform/game-sdk: ^2.9.0` as a hard `dependency`.
A studio integrating Artube needs `game-sdk` 2.9 on both sides regardless of
what `artube-server` does; this just makes the backend side explicit
instead of leaving it to be discovered when the frontend won't install.

If your project is still pinned to an older `game-sdk` (`^2.7.x` and
`^2.8.x` pins exist elsewhere in this monorepo, e.g. in example projects),
`npm install` will fail with `ERESOLVE` the moment you add `artube-server`
or `artube-bridge`. The fix is to upgrade `game-sdk` to `^2.9.0` — that's
the real requirement, not an artifact of this package. `--legacy-peer-deps`
is an escape hatch to stage the upgrade rather than a long-term fix.

## Deployment contract

- `Dockerfile.template`, copied to the repo root as `Dockerfile`, builds and
  runs the studio's `server/index.ts`. The container **listens on port 80**
  (`EXPOSE 80`) — the platform's Kubernetes ingress expects exactly that.
- Every player/platform-facing HTTP and WS route lives under `/api`
  (`/api/ws`, `/api/version`); `/livez` and `/healthz` sit outside `/api`
  because that's where the platform's Kubernetes liveness/readiness probes
  look for them.
- `GIT_HASH` is passed as `--build-arg GIT_HASH=$(git rev-parse HEAD)` (or
  equivalent CI variable) and shows up at `/api/version`.
- The final stage's `npm ci --omit=dev` must reach GitHub Releases (or have
  `E8_SERVER_BINARY` baked in) to install the `e8-server` engine binary —
  see "Engine binary" above.

## Running against the sandbox

For local development and integration testing without a real platform
session, use the CLI's `--sandbox` flag — it points `GamesApiUrl` at the
public Artube sandbox instead of whatever `GamesApiUrl` is set to:

```bash
artube-server --spin ./game.spin --sandbox
```

`--sandbox` resolves to `wss://gamesapi-sandbox.artube-888.live/v1/ws`, the
same GamesAPI protocol that runs on dev and prod. Other flags:

- `--spin <path>` — path to the `.spin` file/directory (overrides `SPIN_PATH`).
- `--port <n>` — HTTP/WS listen port (overrides `PORT`).

`GameId` must still be set in the environment when using `--sandbox` — it
has to match the `publicGameId` created in the Sandbox UI, and there's no
sane default for it. `GamesApiUrl` and `GamesApiKey`, however, are **not**
required in sandbox mode: `--sandbox` supplies the URL itself (requiring you
to also set `GamesApiUrl` first would be pointless friction), and the
sandbox only checks `GamesApiKey` when the integration under test defines a
non-empty one.

**The sandbox's data is short-lived — about 24 hours.** If a session that
worked yesterday is suddenly dead today, that's expected, not a regression:
recreate it from the Sandbox UI by pressing **"Generate Data"** and then
**"Create Session"** before debugging further.

## Developing the game's frontend against it: `@energy8platform/artube-server/vite`

The Artube dev loop used to be two processes — a Vite dev server for the game
and this service, started by hand in a second terminal. Forgetting the second
one produced a page that opened `ws://localhost:5173/api/ws`, hit a dead
proxy, and reported `ArtubeBackendError: ws error`, which named neither the
address nor the missing process. So this package ships the plugin that removes
the failure mode:

```ts
// vite.config.ts — inside the Artube branch only
const { artubePlugin } = await import('@energy8platform/artube-server/vite');
plugins.push(artubePlugin({ spinPath: './src/game/script.spin' }));
```

`npm run dev:artube` is then one command. The plugin:

- **starts this service as a child of the dev server** (`node dist/bin/artube-server.js`,
  never in-process — it is a separate service with its own logs and its own
  engine subprocess, and its output is echoed straight through);
- **owns the port.** It scans from `8080` upward for a free one and configures
  the `/api` proxy (`ws: true`) from whatever it bound, so two games can run
  `dev:artube` at the same time without colliding — and neither one can
  silently proxy into the other's math;
- **waits until `/livez` answers** before Vite finishes resolving its config,
  so the page is never served against a backend that isn't up yet;
- **kills the child** when the dev server closes (and on `SIGINT`/exit);
- **`apply: 'serve'`** — it can never take part in a production build.

If the backend cannot start, `vite` aborts with a message naming the spin
path, the `GameId`, the GamesAPI URL, and the child's last output — a missing
`e8-server` binary, an unreachable GamesAPI and a `.spin` that won't load all
identify themselves there rather than turning into a browser-side `ws error`.

### Options

| Option | Default | Notes |
| --- | --- | --- |
| `spinPath` | `./src/game/script.spin` | Resolved against the Vite root; where `create-slot` puts it. A missing file is reported before anything is spawned. |
| `gameId` | `GameId` env → `game1` in sandbox mode | The platform's `publicGameId`. **Required** against a real GamesAPI — only the sandbox has a default, and it is the id every public sandbox tenant is created with. |
| `sandbox` | `true` unless a `gamesApiUrl` is given | Passes `--sandbox`, which also relaxes the CLI's `GamesApiUrl`/`GamesApiKey` requirements. |
| `gamesApiUrl` / `apiKey` | `GamesApiUrl` / `GamesApiKey` env | Setting a URL turns `sandbox` off, and then the key is required — that is a real GamesAPI. |
| `port` | `ARTUBE_PORT` env → `8080` | Where the scan *starts*; the plugin takes the first free port from there. |
| `external` | `ARTUBE_BACKEND` env | Escape hatch: proxy at a backend somebody else is running (debugging this service in an IDE) and start nothing. `ARTUBE_BACKEND=http://localhost:8080` on its own is enough. |
| `demoBalance` | `DEMO_BALANCE` env | Starting virtual balance for demo sessions. |

The plugin is Node-side and dev-only: a game declares it as a
**devDependency** and imports it dynamically inside the Artube branch of
`vite.config.ts`, so a game that only ships to Energy8/Stake never has to
resolve it.
