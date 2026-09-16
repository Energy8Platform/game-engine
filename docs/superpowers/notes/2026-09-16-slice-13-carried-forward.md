# Slice 13 — game rows editable, hot fork: what was left behind

Slice: `docs/superpowers/plans/2026-09-16-game-rows-editable-hot-fork.md`,
spec `2026-09-16-game-rows-editable-hot-fork-design.md`. Commits
`a1b3f76..58fcbcb` on `feat/slot-webide-cordis` (thirteen). The game's
rows (`renderer1`, `stage1`, `reels1`, `mechanics1`) now have forms in the
Composition screen, built from schemas the runtime halves export; an edit
lands in `e8.patch.yml` atomically, the host decides hot or cold from the
manifest's `hot` and the schema's `applies: 'restart'`, and tells both the
IDE and the game in one frame. Every runtime row is a cordis fiber; a hot
row re-applies in place — the reel grid changes under a running game with
its spin log intact; a cold row reloads the preview. Parent spec §10 p.2
is closed for "поменять настройки" of a reel row.

## Debts

1. **§10 p.2's other verbs are not reachable from the IDE.** "Выключить
   reel-фичу" — reel features are functions, not config, and game rows
   have no disable toggle (the patch's `remove: true` is not exposed);
   "подменить shell" — no shell row exists in `e8-base`; "переключить
   провайдера сессии" — the session is `createGame({ session })` code in
   `main.ts`, not a row. Each is its own slice.
2. **`restartKeys` reads the schema's top level only.** A hot row with a
   nested `applies: 'restart'` field would be re-applied instead of
   reloaded; today every nested restart field sits on a cold row.
3. **A fourth `/ide` socket per tab (`game-composition`), none of the four
   reconnects.** The old `coldSignature` path had the same single-socket
   dependency; now the frame is the only reload signal. A reconnect story
   belongs to `connection.ts` and every sibling at once.
4. **`reel-step` drives `board.grid` before any guarded `BoardApi` call.**
   A hot reels re-apply mid-spin under `base_game: reel-step` animates a
   torn-down grid before the refusal lands; the outcome is still the
   diagnostic and "presentation failed". Guard `grid` reads the same way,
   or make the controller ask the board first.
5. **`play.execute` now surfaces step-kind collisions as a presentation
   failure** on every spin (`main.ts` reads its return since this slice).
   A collision is a real composition error; if it reads as noise, report
   it once at boot instead.
6. **Schemastery resolvers that adapt input** (`dict` key transforms,
   `transform`, `bitset`) would mutate the PUT body before it is written.
   No row schema uses them; the host's pre-write validation relies on that.
7. **`reels`' schema types only `config.grid`.** `motion`, `anticipation`,
   `tumble` and the rest pass through unseen — no form, no validation.
8. **Node caches a `schema.ts` import per URL** — editing a runtime half's
   schema needs a host restart.
9. **Spec §4 said "строка остаётся на старом конфиге" after a failed hot
   re-apply.** cordis unloads before reloading, so the row is effect-less
   until the next good update; the `GameRowsService` doc has it right.
10. **Carried:** `ide-bridge`'s `composedStages` is recomputed on
    re-provide now, but a snapshot arriving in the dispose→provide gap is
    only replayed, not diffed; hot reels update mid-spin (item 4).

## Method

- **A hot row's consumers are part of the row.** `reels1` was declared hot
  before anyone traced who held its `board`: `main.ts` captured it at boot,
  and `mechanics1` — hot too — had two more captures (`main.ts`,
  `ide-bridge`). Each was found by a reviewer, not by the plan. "Hot" is a
  claim about every reader, not about the plugin.
- **The plain call was never a fiber.** The plan assumed `fiber.update`
  existed to call; the loader applied rows with `module.apply(ctx, cfg)`.
  The spike-first task found it, and per-row `ctx.plugin` turned out to
  need no production read fixed — every spike failure was a test fake
  writing `ctx.foo = …`.
- **cordis facts measured this slice:** a sibling `ctx.inject` callback
  re-fires when the service is re-provided (and fires once at boot,
  asynchronously); `fiber.update` while a re-apply is in flight drops one
  of the two — the caller must chain; a module's static `inject` on a
  sibling-provided service resolves; an unmet `inject` leaves the fiber
  PENDING and `await fiber` returns.
- **A form that commits per keystroke reloads a cold preview per keystroke.**
  `commit: 'blur'` for game rows; and a draft must survive a frame from
  another tab while focused, in every field type — the dict field needed
  its own round, then a fourth for the no-op refocus.
- **A refusal is not state** (again): a `PUT` refusal written into the
  workspace's diagnostics rendered three times in slice 11; here the
  malformed-patch refusal stayed a return value from the start.
- **Test doubles that use root-only privileges hide the real rule.** Six
  fakes wrote `ctx.foo = …` and passed on the root context; under a plugin
  scope the same line throws. Fakes provide the way production provides.
