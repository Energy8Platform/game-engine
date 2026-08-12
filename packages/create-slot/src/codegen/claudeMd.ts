import type { Answers } from '../answers';

/** Generate CLAUDE.md for a scaffolded game — guidance for Claude Code (and humans) on how the
 *  project is wired, what to edit, and what the framework already handles. */
export function genClaudeMd(a: Answers): string {
  const cascade = a.cascades === true;
  const artubeCommands = a.artube
    ? `npm run dev:artube    # ONE command: frontend + the game's backend, /api proxied — see below
npm run build:artube   # BOTH Artube deployables: dist-artube/ (frontend) + dist-artube-server/
npm run bundle:artube  # build:artube + a zip of dist-artube/ for manual upload
`
    : '';
  const artubeSection = a.artube
    ? `
## Artube

\`createSlotGame({ artube: { load: () => import('@energy8platform/artube-bridge') } })\` in
\`src/main.ts\` is the whole game-side wiring: the host detects
the launch (\`?sessionId=…\`), REFUSES a launch that claims a session but carries a blank one —
without that refusal it falls through to whatever else answers: an offline dev bridge locally
(free spins) or, in a deployed build, nothing at all (a hang) — lazy-loads
\`@energy8platform/artube-bridge\`, and drives the same play loop as everywhere else. There is no
per-game adapter on Artube — the game's BACKEND owns the round shape.

Artube ships as two deployables — a frontend and a backend — and this repo now BUILDS BOTH
(see "Deployment"), while **development is one command.** \`npm run dev:artube\` runs
\`artubePlugin\` from
\`@energy8platform/artube-server/vite\` (see \`vite.config.ts\`), which starts the backend as a child
of the dev server, on a free port it picks itself, waits until it actually serves, and proxies
\`/api\` (HTTP + WS) to it — so dev has the same single-origin shape as production. The backend is
killed when the dev server closes.

Defaults: the public sandbox (\`GameId=game1\`, no API key) and \`./src/game/script.spin\`. Override
with \`artubePlugin({ gameId, gamesApiUrl, apiKey, spinPath, port })\`, or with the platform's own
env vars (\`GameId\`, \`GamesApiUrl\`, \`GamesApiKey\`). To point at a backend you run yourself (an IDE
debug session):

\`\`\`bash
ARTUBE_BACKEND=http://localhost:8080 npm run dev:artube   # proxies there, starts nothing
\`\`\`

If the backend cannot start, \`vite\` aborts with the reason and the backend's last output — a bad
\`.spin\`, a missing \`e8-server\` binary and an unreachable GamesAPI all name themselves there.
\`artube-server\` is a **devDependency** and is imported dynamically inside the Artube branch of
\`vite.config.ts\`, so an Energy8/Stake-only build never resolves it.

\`dev:artube\` also runs WITHOUT the DevBridge, so during development the math comes from the backend
exactly as it will in production — a plain \`npm run dev\` would answer spins locally instead.

**Deployment: \`npm run build:artube\` produces BOTH deployables.**

- \`dist-artube/\` — the frontend. Its own folder (like \`dist-stake/\`), so no target can silently
  ship another target's bytes. **Artube's CI pipeline deploys the repo's \`dist\` folder**, so a game
  built this way needs its pipeline pointed at \`dist-artube\` — change the job's artifact path, or
  copy the folder in CI. That is the accepted trade for keeping the targets visibly separate.
- \`dist-artube-server/\` — the backend, emitted by the same \`artubePlugin\` (its \`apply: 'build'\`
  half). It contains this game's \`.spin\` copied byte-for-byte, a plain-JS \`index.js\`, a
  \`package.json\` pinning \`@energy8platform/artube-server\`, and a \`Dockerfile\`. \`docker build\` it
  as-is, or commit its contents into the server repo. The plugin does this because it already knows
  the spin path — the alternative was a human copying the math between repos, which is how a
  frontend ends up live against last week's backend math. Read \`dist-artube-server/README.md\`.
  It is generated output: wiped and rewritten on every build, so never edit it.

**Loading screen: Artube's first, then this game's.** \`artubePartnerLoader()\` (the Artube branch of
\`vite.config.ts\`) injects Artube's two-phase branded loader into \`index.html\`, so it is painted
before the game bundle is even fetched. \`src/main.ts\` calls \`createArtubeLoader()\` — null on every
other target, where the markup is absent — and passes the controller as \`loading.externalOverlay\`.

That overlay covers ONLY the gap the game cannot paint: bundle download, Pixi init, the SDK
handshake. The engine reports boot milestones into Artube's bar (which is also what makes their
loader crossfade from the dark partner phase to the green branded one — that transition fires on
the first progress above zero), waits until Artube's screen has had its minimum time
(\`loading.externalOverlayMinDisplayTime\`, default 1500 ms — the raw gap is often only a few
hundred, which shows a partner's brand to nobody and cuts their 500 ms crossfade in half), then
mounts its own loading screen, waits for its FIRST FRAME to be painted, and only then dismisses
Artube's. From that frame on, loading is identical to every other target: this game's brand, bar,
tap-to-start and \`minDisplayTime\` (which is measured from the hand-over, so a game setting both
gets the sum). Set loading options OUTSIDE the Artube branch — they apply on all targets, Artube
included, and options set inside it apply only there.

The dismissal also happens on every failure path, so a boot that throws cannot leave Artube's
screen stranded over a dead game.

\`loading.externalOverlay\` is typed structurally (\`{ showLoader, updateProgress, hideLoader }\`) so
no engine package names an Artube type — the same discipline as \`artube: { load }\`: the engine
describes the shape, THIS game supplies the instance.

**Nothing is installed from Artube.** Their loader is vendored into \`@energy8platform/artube-bridge\`
(browser controller, at \`/loader\`) and \`@energy8platform/artube-server\` (the Vite plugin). No
private registry, no \`.npmrc\`, no token — a plain \`npm install\` is enough. When Artube ships a new
loader version, the vendored copies are updated in the game-engine monorepo, not here.

The \`BUILD_TARGET=artube\` flag does NOT harden the frontend bundle — the DevBridge is injected by a
dev-server-only Vite plugin, so no production build has ever carried one. What protects a real
launch is the host's gate: a launch claiming a session with a blank \`sessionId\` makes the game
refuse to start.
`
    : '';
  return `# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository — a slot game built on the
Energy8 \`@energy8platform/game-engine\` framework, targeting Stake Engine${a.artube ? ' and Artube' : ''}.

## What this project is

\`${a.id}\` — a PixiJS slot game. The framework (\`@energy8platform/*\`) owns the boot sequence, the
Stake RGS bridge, the shell (control bar / modals / Game Info), the play loop, and the math
pipeline. This repo contains only the GAME: its spec, math logic, rendering, and assets.

## Single source of truth: \`src/game.spec.ts\`

\`defineGame(spec)\` derives everything from one file: the \`GameDefinition\`, the .spin prelude, the \`modeMap\`
(action → Stake mode), the math modes, the paytable, AND the shell's buy-bonus cards + Game Info
per-mode table. **Edit modes/symbols/bet levels/RTP/maxWin there — never duplicate them elsewhere.**
Each \`actions[key]\` carries \`role\` (base/feature/buy/free), \`cost\`, \`rtp\`, \`maxWin\`, \`title\`,
\`description\`, \`feature\`. \`rtp\`/\`maxWin\` are the DECLARED (displayed) values; the math pipeline's
TARGETS live in \`math.config.ts\` and may legitimately differ while tuning.

## The scene contract (\`src/scenes/GameScene.ts\`)

The host owns the entire play loop (play → onSpin → ack → drain). The scene only RENDERS + reacts.
The core lifecycle hooks are REQUIRED (empty bodies are fine where there's nothing to do):
- \`onCreate(api)\` — injected ONCE before the first round. Capabilities live on \`api\`: \`api.audio\`
  (play sfx, switch bgm), \`api.overlay.show({ build, autoCloseMs?, closeOn?, dim? })\` (a host layer
  ABOVE the bar — use it for big-win), \`api.shell.safeArea\` (bottom-bar inset; read it in onResize),
  \`api.shell.reportWin(winSoFar, { durationMs? })\` (grow the bar's WIN readout DURING a segment —
  for cascade/tumble games that pay step by step; the value is the segment's running total, and it's
  only honoured inside \`onSpin\`), \`api.formatAmount\`, and live \`api.bet\` / \`api.mode\` / \`api.turbo\`.
- \`onSpinStart()\` — the player pressed spin (before the network result); start anticipation.
- \`onSpin(result, ctx)\` — draw ONE segment (a spin, or one free spin). All pacing lives here.
- \`onEnterMode(trigger, ctx)\` / \`onExitMode(last, ctx)\` — a mode/bonus begins / ends (switch bgm here).
- \`onSpinEnd(result, ctx)\` — the round fully drained; controls unlocked, settle to idle.

Optional reactions: \`onBetChanged\`, \`onTurboChanged\`, \`onAutoplayChanged\`, \`onSkip\` (double-tap
skip — collapse the animation to its final state; \`ctx.signal\` is aborted), \`onPause\`/\`onResume\`
(tab focus). \`ctx\` = \`{ bet, action, mode, formatAmount(v), turbo, signal }\`. The scene NEVER calls
play/ack/roundId, never touches the balance readout, and never runs the FS loop — a bonus is one round
the host drains segment-by-segment. The WIN readout is the host's too (cleared at spin start, set
post-onSpin); the ONE exception is \`api.shell.reportWin\` for a step-by-step cascade climb, which the
host reconciles to the segment's real win afterwards.

The reels are the configurable **ReelSystem** (see \`src/slot/reelConfig.ts\`); \`onSpin\` feeds results to it (${cascade ? '\`system.cascade(result.steps)\`' : '\`system.spin(result.targetGrid)\`'}). In the dev harness (\`npm run stake\`) the **"Reels" sidebar** tunes \`reelConfig\` live via \`mountReelDevBridge\` — click **Copy config** and paste back into \`reelConfig.ts\` to persist (live edits are ephemeral).${cascade ? ' This is a CASCADE game — the running win multiplier is driven by \`reelConfig.cascade.multiplier\`, and each settled step should call \`api.shell.reportWin(winSoFar, { durationMs })\` so the bar\'s WIN climbs with the cascade instead of jumping once at the end.' : ''}

## Commands

\`\`\`bash
npm run dev            # local dev via Energy8 DevBridge (e8-server runs script.spin)
npm run stake          # the Stake dev harness — iframe wrapper + dev-RGS backed by curated books
npm run build:stake    # the Stake frontend build → dist-stake/ (base './', no DevBridge)
npm run math:pool      # Stage A — honest large simulation (the pool); see math.config.ts
npm run math:curate    # Stage B — compress the pool into the publishable stake-math/ bundle
${artubeCommands}\`\`\`
${artubeSection}

## Math pipeline

\`math.config.ts\` declares per-mode sim + curate tuning (iterations, CV, hit-rate, nRowsOut,
tolerances). The pipeline (\`e8-math\`) runs the native Go simulator, builds a pool, then curates a
~Stake-canonical book bundle (\`stake-math/\`: \`books_<MODE>.jsonl.zst\` + \`lookUpTable_<MODE>_0.csv\`
+ \`index.json\`). Book events are canonical \`{ type, spin }\`. The harness replays from these books.

## What the framework already handles — do NOT reimplement

Segment-drain of bonuses, \`roundId\` forwarding, free-spins counter (with retriggers), resume of an
unfinished round, win/balance HUD timing, social-mode vocabulary, the legal disclaimer, currency
formatting, jurisdiction → feature restrictions, the insufficient-funds guard, the play-error modal
+ reconnect overlay, autoplay, the bet ladder + default bet from \`/wallet/authenticate\`, the
open-redirect \`rgs_url\` guard${a.artube ? ' (and the Artube blank-`sessionId` guard)' : ''}, spacebar handling, pause on tab-blur (ticker + music), and
double-tap-to-skip (opt out with \`createSlotGame({ skipGesture: false })\`). Write player-facing
copy normally — it is socialized automatically in social mode.

## Conventions

- Keep \`game.spec.ts\` the source of truth; regenerate / reason from it.
- The math TARGETS (math.config.ts) and the DECLARED rtp/maxWin (game.spec) are separate — keep the
  declared values honest against the published math before submitting.
- Tests: \`npm test\` (vitest). Typecheck: \`npx tsc --noEmit\`.

## Localization — how to add a language

Player-facing copy is localised via \`src/i18n.ts\`. The file uses the **english-as-key** convention:
the English string is the key, so missing translations fall back to English automatically.

To add or complete a language:
1. Open \`src/i18n.ts\` and find the target language stub (e.g. \`'de': {}\`).
2. Copy the key set from \`en\` into it and provide translations.
3. Test via the harness language selector (⚙ → Language) — strings should switch immediately.
4. Add new player-facing copy to \`en\` first, then propagate to other languages.

The map is passed to \`createSlotGame({ shell: { i18n } })\` in \`src/main.ts\`. Shell-level copy (win messages,
HUD labels, disclaimer) is handled by the framework and is NOT in \`src/i18n.ts\`.
`;
}
