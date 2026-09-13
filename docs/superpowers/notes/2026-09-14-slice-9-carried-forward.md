# Slice 9 — one process, N projects: what was left behind

Slice: `docs/superpowers/plans/2026-09-13-one-process-n-projects.md`, spec
`2026-09-13-one-process-n-projects-design.md`. Commits `dd42ea4..814964e`
on `feat/slot-webide-cordis` (thirteen). One `e8` process: the host
serves the built IDE at `/`, lists the projects of its folder, opens one
at a time as a disposable cordis scope, runs the game on its own preview
server, and switches on a click — with unsaved files closed loudly, never
silently. `e8 dev` in a project folder still means what it meant.

## Debts

1. **A client half with the same row id in two projects is served from the
   browser's module cache.** `modules` keys client halves by `row.id`; the
   intermediate `active: null` frame makes the empty snapshot deterministic
   so the old half is released, but `import('/plugin-client/<id>')` returns
   the cached module when the id comes back. Same package → harmless;
   different code under the same id → a stale IDE plugin until reload.
   Fix: a per-scope nonce in `clientUrl` (`composition.ts`, `resolveClientUrl`).
2. **`runtimeUrl` is handed out with no preview.** Under a project whose
   `game/spec.json` is unusable or whose preview port is busy,
   `/api/composition` still says `/plugin-runtime/<id>`; nothing on the IDE
   side reads it, the game never loads. Make it `null` when
   `devGamePreview.url` is `null` — the loader already treats `null` as
   "nothing to load".
3. **The preview server has no `URIError → 400` boundary.** The root's
   `ctx.server.use` catches a malformed percent-escape during route matching;
   the preview server answers plugin-server's own bare status. One `use` on
   `preview`, the same body.
4. **`li[role=button]` rows in Проекты and Проводник have no keyboard
   activation** (Enter/Space). Parity, not a regression; one `onKeyDown` in
   each, or a shared row component.
5. **Spec §8's empty document group («откройте проект»)** is not drawn: on
   a fresh load with no active project the composition document opens and
   shows «подключение…»; the sidebar Проекты is the cue. The confirm row's
   text does not count the dirty documents.
6. **The origin allowlist is fixed to loopback spellings and 5680.** The
   CLI binds `127.0.0.1` and has no `--host`, so this is enough today;
   `IDE_ORIGINS` (comma-separated) exists and is documented nowhere but the
   host's own doc comment.
7. **`e8 dev` in a project whose scope failed to boot** prints "the project
   did not start — see the diagnostics below"; no fixture can make a
   project-shaped failure reject `bootProjectScope`, so the branch is
   untested.
8. **`globalSetup` rebuilds `dist` on every Playwright run** (~3 s), also
   for a single `-g` test.
9. **Three `/ide` sockets per tab** (`connection`, `game-diagnostics`,
   `workspace`) each receive every broadcast. The established pattern; a
   shared socket is a refactor, not a bug.
10. **Carried from earlier slices:** the 30 s Playwright budget flakes under
    load (two pre-existing specs; none seen in the last three full runs);
    `SessionStatus` never returns to ○; `Cmd/Ctrl+S` on a non-editor tab;
    withdrawn `shell.document` leaves an unclosable tab; upload root-only;
    components get the root ctx. `ProjectStatus` showing a plugin id — paid.

## Method

- **A spike before the plan, not a spike as Task 1.** `ctx.isolate('server')`,
  `plugin-include` with an absolute `file://`, and "loader entries survive
  a scope's dispose" were measured in forty lines of script before a word
  of the plan was written; the plan's Global Constraints carried the facts
  and no implementer rediscovered them. The one lifecycle fact the spike
  did not cover — cordis awaits a disposer's RETURNED promise, not a
  `void`ed one — was caught by the Task 1 reviewer with a 20 ms fake.
- **Unit tests that bypass the production wiring pass for the wrong
  reason.** `project-scope.test.ts` called `bootProjectScope` directly and
  never saw rpc's reset wipe the diagnostics the scope had just reported;
  the whole-slice reviewer found it by running the real `createIdeHost`
  with a real socket. A service that is only ever exercised through its
  factory is not exercised.
- **A test that asserts the test-only behaviour.** `workspace.spec.ts`
  asserted `previewUrl` CHANGED on a switch — true with `previewPort: 0`,
  false in production with 5681 fixed, where the iframes never remounted.
  Fixtures that pick a free port must have one test that does not.
- **"Invariant" in a doc comment is a claim.** `dev-game.ts` said the
  separate origin was "a working invariant now"; nothing checked `Origin`,
  and a `text/plain` POST from any page could switch projects. The
  reviewer measured it with `curl`; the fix is an allowlist and a doc that
  says only what is enforced.
- **The intermediate frame pays three debts at once.** Emitting
  `active: null` between `close` and `open` gave rpc a clean moment to
  reset, the client a moment to close `f:` tabs before the next project's
  routes exist, and the preview a reason to unmount — one line in
  `doOpen`, three findings closed.
- **The branch was on `main` when the slice started.** GitHub Desktop had
  switched it; the tree came back on its own. `git branch --show-current`
  before and after every long run is now a habit, not a note.
