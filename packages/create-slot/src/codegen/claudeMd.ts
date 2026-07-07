import type { Answers } from '../answers';

/** Generate CLAUDE.md for a scaffolded game — guidance for Claude Code (and humans) on how the
 *  project is wired, what to edit, and what the framework already handles. */
export function genClaudeMd(a: Answers): string {
  const cascade = a.cascades === true;
  return `# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository — a slot game built on the
Energy8 \`@energy8platform/game-engine\` framework, targeting Stake Engine.

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
  \`api.formatAmount\`, and live \`api.bet\` / \`api.mode\` / \`api.turbo\`.
- \`onSpinStart()\` — the player pressed spin (before the network result); start anticipation.
- \`onSpin(result, ctx)\` — draw ONE segment (a spin, or one free spin). All pacing lives here.
- \`onEnterMode(trigger, ctx)\` / \`onExitMode(last, ctx)\` — a mode/bonus begins / ends (switch bgm here).
- \`onSpinEnd(result, ctx)\` — the round fully drained; controls unlocked, settle to idle.

Optional reactions: \`onBetChanged\`, \`onTurboChanged\`, \`onAutoplayChanged\`, \`onSkip\` (double-tap
skip — collapse the animation to its final state; \`ctx.signal\` is aborted), \`onPause\`/\`onResume\`
(tab focus). \`ctx\` = \`{ bet, action, mode, formatAmount(v), turbo, signal }\`. The scene NEVER calls
play/ack/roundId, never touches the balance/win readouts (the host does, post-onSpin), and never runs
the FS loop — a bonus is one round the host drains segment-by-segment.

The reels are the configurable **ReelSystem** (see \`src/slot/reelConfig.ts\`); \`onSpin\` feeds results to it (${cascade ? '\`system.cascade(result.steps)\`' : '\`system.spin(result.targetGrid)\`'}). In the dev harness (\`npm run stake\`) the **"Reels" sidebar** tunes \`reelConfig\` live via \`mountReelDevBridge\` — click **Copy config** and paste back into \`reelConfig.ts\` to persist (live edits are ephemeral).${cascade ? ' This is a CASCADE game — the running win multiplier is driven by \`reelConfig.cascade.multiplier\`.' : ''}

## Commands

\`\`\`bash
npm run dev            # local dev via Energy8 DevBridge (e8-server runs script.spin)
npm run stake          # the Stake dev harness — iframe wrapper + dev-RGS backed by curated books
npm run build:stake    # the Stake frontend build → dist-stake/ (base './', no DevBridge)
npm run math:pool      # Stage A — honest large simulation (the pool); see math.config.ts
npm run math:curate    # Stage B — compress the pool into the publishable stake-math/ bundle
\`\`\`

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
open-redirect \`rgs_url\` guard, spacebar handling, pause on tab-blur (ticker + music), and
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
