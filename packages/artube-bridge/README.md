# @energy8platform/artube-bridge

Drop-in host-side wrapper that lets a game written against
[`@energy8platform/game-sdk`](../game-sdk) run on the
[Artube](https://docs.artube-888.live) platform without modification.

## Why

Artube's Games API only talks to a **backend** — the browser has no direct
access to it. So unlike a pure-frontend bridge, this package is one half of a
pair: `@energy8platform/artube-server` runs the game's backend (WS
protocol, round math, Games API calls), and `ArtubeBridge` is the thin
frontend piece that connects the game's `CasinoGameSDK` to that backend over
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
| Transport | HTTPS REST to Stake's RGS | same-origin WebSocket to the game's own backend (`/api/ws`) |
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
  artube: {},          // ← the whole opt-in; no per-game adapter exists on Artube
});
```

With `artube` present the host classifies the launch URL
(`classifyArtubeLaunch`), **refuses to run** on a malformed one (see the
security gate below), dynamically imports this package only on a real Artube
launch, constructs `ArtubeBridge`, awaits `ready()`, and puts the SDK into
in-process (`devMode`) mode so the game talks to the bridge over
`MemoryChannel`. `ArtubeIntegration` also takes an optional `demoBalance`
(starting virtual balance for demo sessions) and `apiBase` (local-dev
override only — production is same-origin, see below).

Pair it with the **Artube build target** (`BUILD_TARGET=artube`, i.e.
`npm run dev:artube` / `npm run build:artube` in a scaffolded game): that
target never bootstraps the offline DevBridge, which is the structural half
of the security gate below. `dev:artube` serves only the frontend — the game's
backend runs as a second process
(`artube-server --spin ./game.spin --sandbox --port 8080`), and the dev
server proxies `/api` to it so the bridge's same-origin assumption holds in
dev too.

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
Stake's — `apiBase` comes from `url.origin`, so no `rgs_url`-style
open-redirect is possible — but the fall-through is identical.

What URL classification alone cannot catch: a `sessionId` removed
*entirely* is indistinguishable from a dev launch. That half is structural —
the Artube target never bootstraps the offline DevBridge (the Vite plugin
that injects it is off for `BUILD_TARGET=artube`, in dev as well as in a
build), so no local math exists to answer a play.

## `new ArtubeBridge(options)`

| Option | Type | Default | Description |
|---|---|---|---|
| `devMode` | `boolean` | `true` | Run in-process via `MemoryChannel`. |
| `url` | `string \| URL \| Location` | `window.location.href` | Source for the `sessionId`/`lang`/`device` query params. |
| `apiBase` | `string` | the launch URL's origin | Origin of the game's backend. Only override this for local dev against a backend on a different port — production must be same-origin (see below). |
| `gameId` | `string` | `'artube-game'` | Surfaced on `PLAY_RESULT.gameId`. |
| `demoBalance` | `number` | the backend's starting demo balance | Starting virtual balance for demo sessions — see below. |
| `debug` | `boolean` | `false` | Verbose logging. |

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
  `BALANCE_UPDATE`).

That is deliberate — the wallet, not the connection-scoped backend
stand-in, is what survives a mid-session WS reconnect, so it is the only
balance worth trusting for the lifetime of the page.

The demo wallet is purely a UX convenience — it is never sent to the
backend or persisted anywhere. A page refresh loses it, same as any other
purely client-side state.

## Deployment requirement: same-origin backend

`ArtubeBridge` connects over `${apiBase}/api/ws?sessionId=…`, and by default
derives `apiBase` from the launch URL's own origin. This is not
configuration convenience — it is required: Artube serves the game's
frontend and its backend under **the same domain**, splitting them only by
path (`/api/**` → backend, everything else → the static frontend). There is
no CORS story here because there is no cross-origin request; deploying the
backend anywhere else breaks the bridge's default `apiBase` and requires
overriding it, which is not a supported production configuration.

See [`@energy8platform/artube-server`](../artube-server)'s README for the
backend side of this contract (`Dockerfile.template`, `/api` prefix,
`/livez`/`/healthz` outside of it).
