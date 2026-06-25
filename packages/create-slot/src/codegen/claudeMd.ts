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

\`defineGame(spec)\` derives everything from one file: the Lua \`GameDefinition\`, the \`modeMap\`
(action → Stake mode), the math modes, the paytable, AND the shell's buy-bonus cards + Game Info
per-mode table. **Edit modes/symbols/bet levels/RTP/maxWin there — never duplicate them elsewhere.**
Each \`actions[key]\` carries \`role\` (base/feature/buy/free), \`cost\`, \`rtp\`, \`maxWin\`, \`title\`,
\`description\`, \`feature\`. \`rtp\`/\`maxWin\` are the DECLARED (displayed) values; the math pipeline's
TARGETS live in \`math.config.ts\` and may legitimately differ while tuning.

## The scene contract (\`src/scenes/GameScene.ts\`)

The host owns the entire play loop (play → onSpin → ack → drain). The scene only RENDERS:
- \`onSpin(result, ctx)\` — draw ONE segment (a spin, or one free spin). All pacing lives here.
- \`onEnterMode(trigger, ctx)\` / \`onExitMode(last, ctx)\` — optional bonus intro / summary.

\`ctx\` = \`{ bet, action, mode, formatAmount(v), turbo }\`. The scene NEVER calls play/ack/roundId,
never touches the balance/win readouts (the host does, post-onSpin), and never runs the FS loop —
a bonus is one round the host drains segment-by-segment.${cascade ? '\n\nThis game uses a CASCADE mechanic: `onSpin` runs `result.steps` through the CascadeController and reflects `result.multiplier`.' : ''}

## Commands

\`\`\`bash
npm run dev            # local dev via Energy8 DevBridge (config + Lua)
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
open-redirect \`rgs_url\` guard, and spacebar handling. Write player-facing copy normally — it is
socialized automatically in social mode.

## Conventions

- Keep \`game.spec.ts\` the source of truth; regenerate / reason from it.
- The math TARGETS (math.config.ts) and the DECLARED rtp/maxWin (game.spec) are separate — keep the
  declared values honest against the published math before submitting.
- Tests: \`npm test\` (vitest). Typecheck: \`npx tsc --noEmit\`.
`;
}
