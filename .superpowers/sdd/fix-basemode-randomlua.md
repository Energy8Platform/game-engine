# fix-basemode-randomlua — report

## Issues fixed

### Issue 4 — base spin mode `SPIN` → `BASE`

`packages/platform-core/src/game-spec/derive.ts` `toModeMap` and `toMathModes` both previously used `action.mode ?? key.toUpperCase()`, so `spin` (role `base`) produced mode `SPIN`. Fixed to `action.mode ?? (role === 'base' ? 'BASE' : key.toUpperCase())` in both functions.

Updated tests/examples that assumed `SPIN`:
- `packages/platform-core/tests/game-spec/derive.test.ts` — expects `{ spin: 'BASE', … }`
- `packages/platform-core/tests/game-spec/defineGame.test.ts` — `modeMap` / `mathModes` expectations
- `packages/platform-core/tests/feature-role.test.ts` — mode assertions
- `packages/stake-math-tools/test/e2e.test.ts` — `cfg.modes.SPIN` → `BASE`, file paths `books_SPIN` → `books_BASE`, `lookUpTable_SPIN` → `lookUpTable_BASE`
- `examples/spec-slot/math.config.ts` — comment and `modes.SPIN` → `modes.BASE` (was already `BASE` in working tree)
- `examples/spec-slot/stake/adapter.test.ts` — mode field

### Issue 3 — `luaLogic.ts` always returns `win = 0`

`packages/create-slot/src/codegen/luaLogic.ts` replaced the `local win = 0 -- TODO` stub with a random payout distribution using `engine.random`: ~25% small (0.2–1.0×), ~2% medium (5–30×), ~0.2% large (50–500×).

`examples/spec-slot/script.logic.lua` already had a non-zero win path (`if roll == 1 then win = PAYTABLE["A"][3] end`) — no change needed.

## Rebuild required

`packages/platform-core` dist was rebuilt before stake-math-tools tests, since those tests resolve `@energy8platform/platform-core` via the built dist.

## Test results

- `packages/platform-core`: 41 files / 297 tests — all passed
- `packages/stake-math-tools`: 13 files / 86 tests — all passed (e2e with real binary included)
- `packages/create-slot`: 14 files / 55 tests — all passed
- `examples/spec-slot`: `tsc --noEmit` — clean

## Concerns

None. The `e2e.test.ts` failure during investigation was a dist cache issue (stale `game-spec.esm.js` before rebuild); once rebuilt it passed with the binary present on this machine. CI without the binary will skip the e2e test via `describe.skipIf(!hasBinary)`.
