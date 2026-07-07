# ${title}

Generated with `npm create @energy8platform/slot`. Built on @energy8platform game-spec / host / stake-kit / slot.

## Develop
- `npm install`
- `npm run dev` — runs the game in a browser (Vite + DevBridge; math served by e8-server with `.spin` hot reload)
- Edit `src/game.spec.ts` (symbols/paytable/bet levels/actions) and `src/game/script.spin` (math).
- Swap placeholder art in `public/assets/` (see NAMING.md) and wire it in `src/slot/symbols.ts`.

## Verify
- `npm run typecheck`
- `npm run smoke` — proves spec → export artifacts

See the `slot-game-creator` skill for the full mechanics → math → art → UI workflow.
