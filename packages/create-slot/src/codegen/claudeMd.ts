import type { Answers } from '../answers';

/** Generate CLAUDE.md for a scaffolded game — guidance for Claude Code (and humans) on how the
 *  project is wired, what to edit, and what the framework already handles. */
export function genClaudeMd(a: Answers): string {
  const cascade = a.cascades === true;
  const artubeCommands = a.artube
    ? `npm run dev:artube    # the Artube target: no dev bridge, /api proxied — needs the backend, see below
npm run build:artube   # the Artube frontend build → dist/ (what the client-repo CI deploys)
npm run bundle:artube  # build:artube + a zip of dist/ for manual upload
`
    : '';
  const artubeSection = a.artube
    ? `
## Artube

\`createSlotGame({ artube: { load: () => import('@energy8platform/artube-bridge') } })\` in
\`src/main.ts\` is the whole game-side wiring: the host detects
the launch (\`?sessionId=…\`), REFUSES a launch that claims a session but carries a blank one (that
would otherwise fall through to the offline bridge and pay out for free), lazy-loads
\`@energy8platform/artube-bridge\`, and drives the same play loop as everywhere else. There is no
per-game adapter on Artube — the game's BACKEND owns the round shape.

Artube is a two-repo integration: this repo is the *client*, and the backend
(\`@energy8platform/artube-server\`) lives in its own repo. \`npm run dev:artube\` starts ONLY the
frontend; run the backend in a second terminal —

\`\`\`bash
artube-server --spin ./game.spin --sandbox --port 8080   # GameId must be set in the environment
\`\`\`

— and the dev server proxies \`/api\` (HTTP + WS) to it, so dev has the same single-origin shape as
production (\`ARTUBE_BACKEND\` overrides the target). \`dev:artube\` also runs WITHOUT the DevBridge,
so during development the math comes from the backend exactly as it will in production — a plain
\`npm run dev\` would answer spins locally instead.

**Deployment:** the platform's CI runs \`npm run build\` and deploys the \`dist\` folder, so the Artube
build writes to \`dist\` — not a \`dist-artube\` the pipeline would never look at. Be clear about what
\`build:artube\` does and doesn't buy: the DevBridge is injected by a dev-server-only Vite plugin, so
NO production build carries it and the Artube bundle is byte-for-byte the plain one. The script
exists to name the target (and to clear a previous build's stale hashed assets from \`dist\`);
setting \`BUILD_TARGET=artube\` in CI is optional and changes nothing about today's artifact. What
protects a real launch is the host's gate: a launch claiming a session with a blank \`sessionId\`
makes the game refuse to start.
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
