# @energy8platform/artube-bridge

Drop-in host-side wrapper that lets a game written against
[`@energy8platform/game-sdk`](../game-sdk) run on the
[Artube](https://docs.artube-888.live) platform without modification.

## Why

Artube's Games API only talks to a **backend** — the browser has no direct
access to it. So unlike a pure-frontend bridge, this package is one half of a
pair: `@energy8platform/artube-server` runs the game's backend (WS
protocol, round math, Games API calls), and `ArtubeBridge` is the thin
frontend piece that connects the game's `CasinoGameSDK` to that backend over a
same-origin WebSocket. The game code is unaware of the split — it always
talks only to `CasinoGameSDK`, same as on Energy8 or Stake.

## How this differs from `stake-bridge`

[`@energy8platform/stake-bridge`](../stake-bridge) does the RGS calls itself,
in the browser, and needs a per-game `BookAdapter` to slice Stake's
pre-generated "book" into segments. Artube inverts both of those:

| | `stake-bridge` | `artube-bridge` |
|---|---|---|
| Who calls the platform API | the browser (`StakeBridge` itself) | **only the game's backend** — the browser has no access |
| Round math / segment splitting | per-game `BookAdapter` in the frontend | the backend (`artube-server`); the bridge just forwards |
| Transport | HTTPS REST to Stake's RGS | same-origin WebSocket to the game's own backend (`/api/<slug>/api/ws`) |
| Per-game artifact | `BookAdapter` (required) | **none** |

Because the backend already knows the round shape, `artube-bridge` has no
adapter concept at all — it is purely a protocol translator between
`CasinoGameSDK`'s messages and the backend's WS wire format.

## What the bridge owns vs. what the backend owns

| `ArtubeBridge` (this package) | `artube-server` (the game's backend) |
|---|---|
| URL parsing (`sessionId`/`lang`/`device` query params) | Games API session (`SessionInfo`, reconnect, resume) |
| Translating `PLAY_REQUEST`/`PLAY_RESULT`/`PLAY_RESULT_ACK`/`GET_STATE`/`GET_BALANCE` ↔ the backend's `play`/`result`/`ack`/`init`/`balance` WS messages | Splitting a round into segments and deciding simple vs. multi-segment (`PlayRound` vs. `OpenRound`/`UpdateRoundState`/`CloseRound`) |
| Converting a bet **amount** the game sends to the `betIndex` the backend expects (`betIndexOf`, nearest match against `config.betLevels`) | All money math — the bridge never computes a win or balance itself |
| Delivering an unfinished round back to the game on reconnect (`INIT.session` + `GET_STATE`) | Persisting round state in Games API's `round_state` (the backend itself is stateless) |
| The demo wallet (see below) when `init.demo` is set | Detecting demo sessions (`currency === null`) and reporting `demo: true` |

## Installation

```bash
npm install @energy8platform/game-sdk @energy8platform/artube-bridge
```

## Quick start: a game on `@energy8platform/game-engine`

Games scaffolded with `npm create @energy8platform/slot` do **not** hand-roll
a host-selection branch: `createSlotGame` owns host selection, and Artube is
one option on it — the same shape as `stake: { adapter }`:

```ts
// src/main.ts
createSlotGame({
  model,
  normalize,
  scenes: [ … ],
  // …
  // The whole opt-in; no per-game adapter exists on Artube.
  artube: { load: () => import('@energy8platform/artube-bridge') },
});
```

The game supplies the `load` thunk rather than the host importing this
package itself: a bare `import('@energy8platform/artube-bridge')` inside
game-engine's always-shipped `/host` entry is resolved statically by every
bundler, so it would have to resolve in games that never installed this
package (esbuild/webpack fail the build; Vite silently substitutes an empty
module for an uninstalled optional peer, which is worse). With the loader the
specifier only appears in the bundle of a game that took the dependency. The
launch classifier ships in the same module as the bridge, so this is one
load, not two.

Given `artube`, the host calls `load()`, classifies the launch URL
(`classifyArtubeLaunch`), **refuses to run** on a malformed one (see the
security gate below), constructs `ArtubeBridge` only on a real Artube launch,
awaits `ready()`, and puts the SDK into in-process (`devMode`) mode so the
game talks to the bridge over `MemoryChannel`. `ArtubeIntegration` also takes
an optional `demoBalance` (starting virtual balance for demo sessions) and
`apiBase` (local-dev override only — in production it is derived from the
page's own address, see below).

Pair it with the **Artube build target** (`BUILD_TARGET=artube`, i.e.
`npm run dev:artube` / `npm run build:artube` in a scaffolded game). Its real
value is in DEV: `dev:artube` runs without the DevBridge and proxies `/api`
to the backend, so development uses the same backend-owned math and the same
same-origin shape as production. It does not change the production artifact —
the DevBridge bootstrapper comes from a `apply: 'serve'` Vite plugin, so no
build has ever carried one.

The one thing dev and production do **not** share is the mount point. The dev
server serves the game at `/`, so the backend route is a bare `/api`;
production serves the game at `/<slug>/` and mounts its backend on a separate
route at `/api/<slug>/`. The bridge derives that from the page it is running
on rather than hard-coding either (see below), which is what lets one build
cover both.

`dev:artube` is **one command**: the `artubePlugin` from
`@energy8platform/artube-server/vite` starts the game's backend as a child of
the dev server, on a free port it picks itself, and configures the `/api`
proxy from it. Nothing has to be started alongside it. To develop against a
backend you run yourself, set `ARTUBE_BACKEND=http://localhost:8080` — the
plugin then only proxies.

`build:artube` produces **both** deployables. The frontend goes to
`dist-artube/` (mirroring `build:stake` → `dist-stake/`, so the two targets
never share a folder); the same plugin's build half writes
`dist-artube-server/` — the backend, with the game's `.spin` copied in
byte-for-byte, a plain-JS entry point, a `package.json` and a `Dockerfile` —
so the math the frontend was built against and the math the backend runs come
from one place. Note that Artube's CI pipeline deploys the repo's `dist`
folder, so a game using `dist-artube` needs its pipeline pointed at that
folder. See [`@energy8platform/artube-server`](../artube-server)'s README.

## Quick start: a game without `game-engine`

A game that talks to `@energy8platform/game-sdk` directly picks its host in
its own entry point. Classify first, refuse on `'blocked'`, and only then
load the bridge:

```ts
// src/main.ts
import { CasinoGameSDK } from '@energy8platform/game-sdk';
import { classifyArtubeLaunch } from '@energy8platform/artube-bridge/detect';
import { runGame } from './game';

const launch = classifyArtubeLaunch(location.href); // 'artube' | 'blocked' | 'offline'
if (launch === 'blocked') {
  // The URL claims a session but carries no id — do NOT fall back to an offline bridge.
  throw new Error('Invalid game session. Relaunch the game from the lobby.');
}

const isArtube = launch === 'artube'; // ?sessionId=…
if (isArtube) {
  const bridge = new (await import('@energy8platform/artube-bridge')).ArtubeBridge({
    devMode: true,
    gameId: 'sweet-bonanza',
  });
  await bridge.ready();
}

const sdk = new CasinoGameSDK({ devMode: isArtube });
await sdk.ready();
runGame(sdk);
```

`classifyArtubeLaunch` / `isArtubeLaunch` live in their own leaf module
(`/detect`, no import of `ArtubeBridge` itself) specifically so a bundler can
chunk it separately — Energy8-only builds never pull in the bridge's
WebSocket client.

`ArtubeBridge` runs **in-process** with the game, exactly like `StakeBridge`:
no extra iframe, communication happens over the same in-memory channel
`CasinoGameSDK` already uses for `devMode`.

## Security gate: a launch that claims a session must carry one

`classifyArtubeLaunch(url)` returns:

| kind | when | what the host must do |
|---|---|---|
| `'artube'` | `sessionId` present and non-blank | load the bridge |
| `'blocked'` | `sessionId` present but empty / whitespace (`?sessionId=`) | **refuse to run** |
| `'offline'` | no `sessionId` at all | genuine dev / non-Artube launch |

`'blocked'` exists for the same reason as `classifyStakeLaunch`'s: a launch
whose session marker was stripped fails the "is this Artube?" check and
would otherwise **silently fall through to the offline/dev bridge, letting
the player spin for free**. Artube's own attack surface is smaller than
Stake's — `apiBase` comes from the launch page's own *path*, not from any
query parameter, so no `rgs_url`-style open-redirect is possible — but the
fall-through is identical.

What URL classification alone cannot catch: a `sessionId` removed
*entirely* is indistinguishable from a dev launch. In a production build
there is nothing to fall through to regardless — the DevBridge bootstrapper
is injected by a dev-server-only Vite plugin, so no build carries one. Under
a plain `npm run dev` a DevBridge *is* already running by the time the game
boots (the bootstrapper wraps the entry module), and there the protection is
precisely that the game refuses to start, not that no bridge exists.

## `new ArtubeBridge(options)`

| Option | Type | Default | Description |
|---|---|---|---|
| `devMode` | `boolean` | `true` | Run in-process via `MemoryChannel`. |
| `url` | `string \| URL \| Location` | `window.location.href` | Source for the `sessionId`/`lang`/`device` query params. |
| `apiBase` | `string` | the launch page's own path, re-rooted under `/api` (just the origin at the root) | Base address of the game's backend; the bridge appends `/api/ws`. Overrides the derivation completely — use it for local dev against a backend on a different port, or to state the address outright if a deployment ever mounts things differently (see below). |
| `gameId` | `string` | `'artube-game'` | Surfaced on `PLAY_RESULT.gameId`. |
| `demoBalance` | `number` | the backend's starting demo balance | Starting virtual balance for demo sessions — see below. |
| `debug` | `boolean` | `false` | Verbose logging. |

## Balance pushes: which ones reach the game

The platform pushes a `BalanceChangedEvent` (`{session_id, balance, reason}`)
whenever the player's balance moves. It carries no sequence, no timestamp and
no round id, so nothing in it says whether its number is fresher or staler
than the one the bridge already applied — but its `reason` says whether the
bridge *needs* it at all.

| `reason` | Forwarded as `BALANCE_UPDATE`? | Why |
|---|---|---|
| `round_bet`, `round_win` | no | The round response already reported this money, authoritatively and in step with the game's animation. |
| `bonus`, `correction` | yes | Out-of-band money; no round response carries it. This is what the event exists for. |
| anything else | yes, plus one `console.warn` per distinct reason | An unshown balance change is worse than one shown at an awkward moment. A warning (deduped, so a renamed `round_win` can't flood the console) says the wire has drifted from the docs. |

Suppressing the round-caused reasons loses nothing, because every balance
movement inside a round comes back through `PLAY_RESULT.balanceAfter`:
`PlayRound` returns the balance after bet *and* win for a simple round;
`OpenRound` returns it after the bet is debited and `CloseRound` after the win
is credited for a multi-segment one; the mid-round `UpdateRoundState` returns
no balance precisely because it moves no money. (A platform-driven autoclose
settles a round without any round response — but that fires when the player's
connection is already gone, and a returning player is met by a fresh `init`,
which sets `init.balance` and pushes a `BALANCE_UPDATE` of its own.)

A suppressed event does **not** update the bridge's internal balance either,
so `GET_BALANCE` keeps answering the round's number. Applying it "internally
only" would re-import the same race through the back door: the platform
announces the bet and the win as two separate events, and a late `round_bet`
would write the pre-win balance over the settled one.

While a demo session's `DemoWallet` is active, every push is ignored outright
regardless of reason — see below.

## Demo mode

Artube's Games API has no concept of a demo session that supports round
RPCs: a session is demo when `currency === null`, and any `PlayRound`/
`OpenRound`/etc. call against one is rejected with `OperationNotAllowed`.
`artube-server` works around this with a small in-memory stand-in scoped to
one WebSocket connection — but that state resets on every reconnect, and
holding it there at all only exists to keep the backend's own round-shape
bookkeeping self-consistent within a connection. It is not a balance the
game should trust across a page's whole demo session.

`ArtubeBridge` instead keeps the balance the player actually sees itself,
client-side, in a `DemoWallet` (`src/demo.ts`):

- On `INIT`, if `init.demo` is `true`, the bridge creates a `DemoWallet`
  seeded from `options.demoBalance` if given, otherwise from `init.balance`
  (the backend's own `DEMO_BALANCE`-configured starting amount, 1000 by
  default — see `artube-server`'s README).
- On each `PLAY_REQUEST` that starts a new round, the wallet is debited the
  bet **once**, at the round's first segment — not per segment.
- On the round's **final** segment (`creditPending: false`), the wallet is
  credited the win once. A multi-segment round (free spins, gamble, …)
  streams several `PLAY_RESULT`s with `creditPending: true` in between;
  those do not touch the wallet.
- Amounts are held in minor units (`Math.round(amount * 100)`) internally so
  repeated small bets and credits don't accumulate floating-point error.

This coexists with the bridge's normal balance path
(`if (result.balanceAfter !== null) this.balance = result.balanceAfter`)
without the two fighting: whenever `demoWallet` is set, it is the single
source of truth for every balance the game is shown — unconditionally, at
every point that number reaches the game, not only the common one:

- `INIT.balance` on the game's very first `INIT` (not the server's
  `init.balance`, which may differ from `options.demoBalance`);
- `PLAY_RESULT.balanceAfter` on every settled round (not the wire's
  `result.balanceAfter`, which — despite the wire never sending a real
  balance for a non-demo round in progress — *is* a real, non-null number
  for a settled demo round, just not one the wallet agrees with);
- the `BALANCE_UPDATE` a reconnect's fresh `init` triggers (not that init's
  `init.balance`, which is the backend's per-connection stand-in reset back
  to its starting value);
- a `balanceChanged` event pushed unprompted by the backend over the wire
  (ignored outright while `demoWallet` is set, rather than forwarded as a
  `BALANCE_UPDATE`) — *whatever* its `reason`, including the `bonus` and
  `correction` a live session would forward.

That is deliberate — the wallet, not the connection-scoped backend
stand-in, is what survives a mid-session WS reconnect, so it is the only
balance worth trusting for the lifetime of the page.

The demo wallet is purely a UX convenience — it is never sent to the
backend or persisted anywhere. A page refresh loses it, same as any other
purely client-side state.

## Deployment requirement: the backend sits on the same host as the page

`ArtubeBridge` connects over `${apiBase}/api/ws?sessionId=…`, and by default
derives `apiBase` from **the launch page's own path, re-rooted under `/api`**.
This is not configuration convenience; it is required. Artube serves the
game's frontend and its backend from one host, splitting them by path, so
there is no CORS story because there is no cross-origin request. Deploying
the backend anywhere else breaks the default `apiBase` and is not a supported
production configuration.

**Same host, different paths.** The frontend is a CDN bucket mounted at
`/<slug>/`; the backend of the same game is a *separate* proxy route at
`/api/<slug>/**`, with the service's own `/api/ws` still on the end. The
doubled `api` is real — the outer one is the platform's backend mount point,
the inner one is ours:

```
page     https://dev.artube-888.live/artube-o7df8qem5k/?sessionId=…&gameId=…
apiBase  https://dev.artube-888.live/api/artube-o7df8qem5k
socket   wss://dev.artube-888.live/api/artube-o7df8qem5k/api/ws?sessionId=…
```

At the root there is nothing to re-root, so `apiBase` is just the origin —
which is what makes one build cover both the deployed shape and local dev
(where Vite serves the game at `/` and proxies `/api` to the backend), as
well as a root-mounted production deployment if one ever appears.

The prefix comes from the **path**, not from `?gameId=`, even though the
launch URL carries the identifier twice. The path is where the CDN actually
served the code from — you cannot change it in the address bar and still have
the same page. `gameId` is written by whoever composed the link and is freely
editable by the player without touching the loaded code; deriving the socket
address from it would let a player aim the bridge at another game's backend
with a query-string edit.

What the derivation handles:

| launch URL | `apiBase` |
|---|---|
| `https://h/artube-x/?sessionId=…` | `https://h/api/artube-x` |
| `https://h/artube-x/index.html?sessionId=…` | `https://h/api/artube-x` |
| `https://h/artube-x?sessionId=…` (no trailing slash) | `https://h/api/artube-x` |
| `https://h/games/artube-x/?sessionId=…` | `https://h/api/games/artube-x` |
| `https://h/artube-x/?sessionId=…&lang=ru#a` (query, fragment) | `https://h/api/artube-x` |
| `http://localhost:5173/?sessionId=…` (dev, root-mounted) | `http://localhost:5173` |

A final path segment counts as a *file* (and is dropped) only when it
contains a dot, which is what keeps the no-trailing-slash case from
collapsing to the root. The derivation reads `location`, never
`document.baseURI`: a `<base href>` retargets relative links inside the
document (that is how assets get moved to a CDN) but the backend is mounted
relative to the address the page itself was opened at. The build emits no
`<base>` anyway — it ships `base: './'`, i.e. relative asset URLs.

> Getting this wrong is cheap and **silent**: on that host any path shaped
> `/<anything>/api/*` answers the WebSocket upgrade with `101` and then says
> nothing forever, so a misaimed socket hangs the game on the loading screen
> instead of failing loudly. Two releases got it wrong before this one —
> `0.1.0` used the page origin (a clean `404`), `0.1.1` used the page
> directory (the silent `101`). Both passed every local test, because at the
> dev root all three rules agree.

See [`@energy8platform/artube-server`](../artube-server)'s README for the
backend side of this contract (`Dockerfile.template`, `/api` prefix,
`/livez`/`/healthz` outside of it) — and note that `npm run build:artube`
emits that backend for you, in `dist-artube-server/`. The server matches its
`/api/**` routes by path *suffix*, so it answers whether the platform's
reverse proxy strips the whole prefix, none of it, or just the outer `/api`.
