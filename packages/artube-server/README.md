# @energy8platform/artube-server

Game backend that runs an `@energy8platform/game-sdk` slot on the Artube
platform. It speaks the platform's GamesAPI over a persistent WebSocket
(session open/resume, round open/update/close, autoclose of abandoned
rounds), drives the game's math via a local engine subprocess, and exposes a
thin player-facing WS API (`/api/ws`) plus the two health probes the platform
expects (`/livez`, `/healthz`).

This package is a **library + CLI**, not a deployable service on its own — but
you should not have to assemble one by hand either. The Vite plugin this
package ships (`@energy8platform/artube-server/vite`) **emits the deployable
backend** as part of the game's own `npm run build:artube`: a
`dist-artube-server/` directory with the game's `.spin`, a generated entry
point, a `package.json` and a `Dockerfile`, ready to `docker build` or to
commit into the studio's `server` repo. See "Building the backend" below.

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

## Building the backend: `npm run build:artube`

The game's math (`src/game/script.spin`) lives in the *client* repo; the
backend image is what has to run it. Nothing used to carry it across, so a
studio copied it by hand — the kind of step that ships yesterday's math to
production without anyone noticing. The Vite plugin already knows that path
(it hands it to the dev backend on every `npm run dev:artube`), so the build
half now writes the whole deployable:

```
dist-artube-server/
  Dockerfile      ← this package's Dockerfile.template, copied verbatim
  index.js        ← generated entry point, plain JS
  package.json    ← one dependency: @energy8platform/artube-server
  game.spin       ← the game's math, byte-for-byte
  README.md       ← what to do with the directory
```

```bash
cd dist-artube-server
docker build --build-arg GIT_HASH=$(git rev-parse HEAD) -t my-game-server .
docker run -p 8080:80 -e GameId=… -e GamesApiUrl=wss://… -e GamesApiKey=… my-game-server
```

`GameId` / `GamesApiUrl` / `GamesApiKey` are **runtime** environment, never
baked in: the same image is promoted across the platform's environments. The
artifact is therefore configuration-free — `vite build` needs only the `.spin`
path, and never fails for a `GameId` a build has no business knowing.

The directory is wiped and rewritten on every build, so nothing you edit in
there survives; edit the game and rebuild. `artubePlugin({ emitServer: false })`
turns it off, `{ serverOutDir }` moves it, `{ serverSpec }` changes the npm
spec the emitted `package.json` pins (see "Versioning" below).

### The emitted entry point is JavaScript, and that is the point

The old template compiled a studio's `server/index.ts` inside the image, which
made `CMD ["node", "dist/index.js"]` depend on that repo's `rootDir`/`outDir`:
get it wrong and `tsc` nests the output at `dist/server/index.js`, the
container fails to start with `Cannot find module '/app/dist/index.js'`, and
you find out in the cluster. A generated entry that is *already runnable*
deletes the class: the image is a single stage with no TypeScript toolchain
and no build step, and there is nothing left for the two paths to disagree
about. `Dockerfile.template` is that single-stage file, and the plugin copies
it verbatim rather than generating its own, so the template a studio reads
here and the Dockerfile a studio actually builds cannot drift.

### Versioning

The emitted `package.json` pins `@energy8platform/artube-server` to
`^<version>` read from the installed copy of this package at emit time — not
a literal written into the plugin, which would keep pinning `0.1.x` long after
the package moved on and install a backend that does not match the plugin that
produced it.

**Today that pin does not resolve: this package is not published yet.** A
`docker build` of the emitted artifact will fail at `npm install` with `E404`
until it ships. Until then, use `serverSpec` with something that does resolve:

```ts
// after `npm pack --workspace @energy8platform/artube-server`
artubePlugin({ serverSpec: 'file:./energy8platform-artube-server-0.1.0.tgz' })
// …and COPY the tarball into the image next to package.json.
```

a git ref (`github:energy8platform/game-engine#…`) works too, as does a private
registry. **At publish time nothing in the plugin changes** — the default pin
already names the published version, and `serverSpec` becomes unnecessary.

## Usage: a hand-written entry point

The emitted `index.js` is eight lines, and this is what they are. Write them
yourself if you are assembling a server repo by hand instead of using the
plugin's artifact:

```ts
// index.ts — or just index.js, and skip the compile
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

> If you do compile it, `Dockerfile.template`'s `CMD ["node", "index.js"]` no
> longer matches — point it at whatever your build actually emits, and check
> with `ls` before shipping. (This is the `rootDir`/`outDir` mismatch the
> template used to have to warn about at length; it only exists on the
> hand-rolled path now, because the plugin's artifact has no compile step.)

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
GitHub Releases** for the `npm install` step in `Dockerfile.template` to
succeed at anything more than a no-op.

Two things make that download silently absent even though `npm ci`
otherwise succeeds:

- A build environment with no network reachability to GitHub Releases —
  `install-e8.mjs` treats a failed download as non-fatal (so Lua-only games
  aren't broken by it) and just logs and moves on.
- `--ignore-scripts`, which skips `postinstall` entirely.

Either way, the container would previously build cleanly and then die on
its first spin with "no such file or directory" or a bare `e8-server` from
`PATH` that doesn't exist. `Dockerfile.template` now runs a
build-time check, right after `npm install --omit=dev`, that resolves
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
**before** the `Dockerfile.template` lines that run `npm install --omit=dev`
and the build-time check:

```dockerfile
# Before the `RUN npm install --omit=dev` / engine-binary-check block from
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

- `Dockerfile.template` — emitted as `dist-artube-server/Dockerfile` by the
  build plugin, or copied to a server repo's root as `Dockerfile` by hand. A
  single stage: no TypeScript build, `CMD ["node", "index.js"]`. The container
  **listens on port 80** (`EXPOSE 80`) — the platform's Kubernetes ingress
  expects exactly that.
- There is no `package-lock.json` in the emitted artifact (it cannot be
  generated offline), so the Dockerfile uses `npm install --omit=dev` and
  `COPY package.json package-lock.json* ./`. Run `npm install` once, commit
  the lockfile into your server repo, and the same Dockerfile starts honouring
  it.
- Every player/platform-facing HTTP and WS route lives under `/api`
  (`/api/ws`, `/api/version`); `/livez` and `/healthz` sit outside `/api`
  because that's where the platform's Kubernetes liveness/readiness probes
  look for them. Kubernetes calls the probes straight into the pod with no
  prefix, and every route — probes included — is also accepted under the
  platform's per-game path prefix (`…/api/<slug>/livez`), so reaching for one
  through the proxy during an incident answers instead of 404ing. Through the
  proxy you get *a* pod of the service, not a specific one: under HPA the
  service has several, and `/healthz` there says nothing about the pod your
  player is on.
- `GIT_HASH` is passed as `--build-arg GIT_HASH=$(git rev-parse HEAD)` (or
  equivalent CI variable) and shows up at `/api/version`.
- `npm install --omit=dev` must reach GitHub Releases (or have
  `E8_SERVER_BINARY` baked in) to install the `e8-server` engine binary —
  see "Engine binary" above.

## The connection to Games API

One pod holds **one** WebSocket to Games API, multiplexing every session on
it. The server never tears that socket down on its own — the doc forbids it —
and reconnects on any loss.

`GoAway` ends *that connection*, not the client. The platform sends it to
recycle an idle connection (`IdleTimeout`), before maintenance, during an
update, under overload — and always with a `retry_after_ms` saying when to
come back. On receiving it the server stops issuing new RPCs (calls fail fast
with `InternalServerError` rather than queueing behind a socket that is about
to close), lets in-flight ones finish, waits for the platform to close the
socket, and then reconnects after the delay the platform asked for. There is
no reason the server treats as terminal: the doc lists none, and a message
that carries "come back in N ms" cannot mean "never come back". What bounds
it instead is the delay itself — never under `minReconnectDelayMs` (1s), never
over 30 minutes (the largest value the doc itself uses), and doubling while
`GoAway` after `GoAway` arrives on connections that do not survive a minute.

**Reconnecting has no attempt limit.** The delay is what is bounded, not the
right to try: exponential from `baseReconnectDelayMs` (1s), capped at **60
seconds** — the shortest pause the doc itself nominates (`Server overload`), so
one attempt per minute per pod is a rate the platform declares acceptable at
its worst moment. A blip is recovered in seconds; a 30-minute maintenance
window costs ~30 attempts instead of outliving the retry budget, and the pod
notices the platform returning within a minute. Half a nominal delay of jitter
keeps a whole deployment's replicas — which all lose the connection in the same
millisecond — from retrying in lockstep. A connection that does not survive a
minute does not reset the backoff, so a platform that accepts and immediately
drops us gets exponentially less traffic rather than one attempt per second.
`maxReconnectAttempts` still exists as an explicit opt-in bound (tests,
embedders); passing a finite value now ends in a loud, visible stop
(`reconnectAbandoned`, client stopped) rather than a silent one.

While there is no connection, every attempt is logged
(`no connection to games api, retrying`, with `attempt`, `delay_ms`, `down_ms`)
— the backoff is what rate-limits those lines: about six in the first minute of
an outage, one a minute after that, and `games api connection restored` with
the total downtime when it comes back. `/healthz` answers 503 throughout, and
its body carries `retrying` and `attempts` so an operator can tell a pod that
is still trying from one that is wedged.

A reconnect is a full re-handshake: Hello/Welcome again, `op_seq` from 1, and
every session uninitialised platform-side. The server re-runs `SessionInfo`
for its live sessions itself, as the doc prescribes, so a player mid-round
needs to do nothing — no reload, no re-launch — for their next spin to work.
`/healthz` reports 503 for as long as there is no connection, which is honest:
readiness is exactly what the pod has lost. Existing player sockets survive
it; new ones route elsewhere until the connection is back.

The `Welcome` that closes the handshake is read, not just counted: if the
platform names a `use.max_schema` other than the 1 we announce, the pod logs
`games api negotiated a different protocol schema`. Nothing is renegotiated —
the envelope is schema 1 by construction — but a `Hello` that was rejected or
arrived late is otherwise indistinguishable from one that was accepted, since
the platform answers neither.

### One session, one connection

A session may only have one live player socket. Within a pod the registry
enforces it directly: a second connection for the same `sessionId` supersedes
the first, which gets a `session_closed` frame and a clean close. Across pods
the platform's `NewConnectionEvent` is the only channel that exists, and the
server now acts on it — an announced connection id that is not the one this
socket was issued closes this socket the same way. The guard is deliberate:
that comparison only means anything if the platform echoes the
`player_connection_id` we send, so a connection is closed only after the
platform has echoed one of ours on that session. Until then the event is
logged with both ids and nothing is torn down; a platform that minted its own
ids would otherwise close every player's socket the moment it connected.

### `SessionInfoResponse` is checked against the doc

Every response is run through `checkSessionInfo` before anything reads it.
Two fields are treated as fatal — `game_settings` and a usable `allowed_bets`
— because without the bet ladder there is no price for a spin and nothing to
serve; the connection fails with `InvalidSessionInfo` naming the field.
Everything else is a logged deviation (`SessionInfoResponse расходится с докой
платформы`, with the field, what was wrong and what we did instead) and the
session plays on: a missing `rtp_settings` is a rules-screen toggle and used
to kill a live money session with a `TypeError`. This exists because the wire
has repeatedly disagreed with its own spec (`currency` absent where declared
mandatory, two contradictory `Error` shapes); the point is to name the
deviation where it enters rather than several frames later.

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

## The Vite plugin: `@energy8platform/artube-server/vite`

`artubePlugin({ spinPath })` is one call site and two plugin objects — a
`apply: 'serve'` dev half and a `apply: 'build'` half — because each then
keeps an unconditional `apply`, so "neither can run in the other's mode" is a
property you read off the object rather than a branch inside a hook. Vite
flattens plugin arrays, so a game's `vite.config.ts` is unchanged.

### The build half: `apply: 'build'`

Emits `dist-artube-server/` — see "Building the backend" above. It runs on
`closeBundle`, throws (failing `vite build`) if the `.spin` is missing, and
touches nothing else about the bundle.

A game that never targets Artube never pays for any of it: `vite.config.ts`
imports this package **dynamically, inside the Artube branch**, so an
Energy8/Stake-only build does not resolve it at all.

### The dev half: `apply: 'serve'`

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
- **`apply: 'serve'`** — this half can never take part in a production build.

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
| `serverOutDir` | `dist-artube-server` | Build half: where the deployable backend is written, relative to the Vite root. |
| `serverSpec` | `^<this package's version>` | Build half: the npm spec the emitted `package.json` pins. A private registry, a git ref or `file:…tgz` all work — see "Versioning". |
| `emitServer` | `true` | Build half: set `false` to build only the frontend. |

### `build:artube` writes `dist-artube`, not `dist`

The frontend half of the Artube build emits `dist-artube/`, mirroring
`build:stake` → `dist-stake/`, so the two targets never share a folder and
neither can silently ship the other's bytes.

**Consequence, and it is a real one:** Artube's own CI pipeline deploys the
repo's `dist` folder (`artube-docs-ru/game-development/hosting.md`,
`devops.md`). A game using `dist-artube` must have its pipeline pointed at
that folder — change the job's artifact path, or add a copy step. That is the
accepted trade for keeping the targets visibly separate.

The plugin is Node-side and dev-only: a game declares it as a
**devDependency** and imports it dynamically inside the Artube branch of
`vite.config.ts`, so a game that only ships to Energy8/Stake never has to
resolve it.
