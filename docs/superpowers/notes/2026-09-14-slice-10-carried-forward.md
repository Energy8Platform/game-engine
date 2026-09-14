# Slice 10 — debts A, B, D: what was left behind

Slice: `docs/superpowers/plans/2026-09-14-debts-a-b-d.md`, spec
`2026-09-14-debts-a-b-d-design.md`. Commits `b55c102..cfae105` on
`feat/slot-webide-cordis` (fourteen). Paid: the host's diagnostics have
speakers and `[]` is a retract; the client's `report()` returns one; the
editor's checks live in the one list; a dead `e8-server` says `○ exited`
and a save revives it; `Cmd+S` never opens the browser's dialog; a
withdrawn document closes; no project → no false «connecting…»; rows take
Enter/Space; preview server has an error boundary; no runtime URL without
a game; a nonce per project for client halves; `dist` freshness; 60 s
Playwright budget; three dots on the sash; a tighter colour guard; every
UI string English; the engine tree formatted.

## Debts

1. **`diagnosticsEqual` ignores `at`.** Two check diagnostics with the same
   text at different positions collapse into one client row; markers
   still show both. Add `at` to the equality when a producer emits such
   pairs.
2. **`/plugin-runtime/:id` on the preview server is orphaned.** With a
   game running the loader gets `/@fs/<realpath>`; without one it gets
   `null`; nothing the host hands out points at `/plugin-runtime/<id>`
   any more. Delete the route (and `resolveRuntimeUrl`'s middle branch)
   after one grep for external readers. Spec §2 A6a named the wrong URL.
3. **`isFresh` roots omit `engine/core/contracts/src` and
   `engine/game/diagnostics/src`**, both bundled into the shell; an edit
   there serves a stale `dist` to the host-served e2e until something
   under the listed roots changes. Add the two roots, or hash the vite
   manifest instead of mtimes.
4. **A non-`f:` closable document that a plugin marks dirty** would be
   named by `key.slice(2)` in the switch warning. No plugin does that; the
   comment in `workspace.ts` says so. Guard the prefix when one does.
5. **`status-items.test.tsx` has one more producer-less case** (a game
   frame carrying `restarting`) left as is; the shipped precedence
   (`restarting` > `exited`) has no wire producer today.
6. **The origin allowlist and `IDE_ORIGINS`** are documented in the CLI
   usage only; a host README does not exist (spec §2 A6d half void).
7. **Carried from earlier slices, untouched:** group C (hard link through
   `lstat`, writes into `node_modules`, base64 upload, whole tree without
   a ceiling, no test on the lstat→write window); components receive the
   root ctx; three `/ide` sockets per tab; `at` has no column from the
   parser; the acceptance suite drives Monaco's classic input only.

## Method

- **A rename is a test-suite event.** `getByRole('button', { name: 'Demo' })`
  matched six elements the moment the Explorer's rows contained the word
  `demo` in English — a substring match that Cyrillic had hidden. Role
  queries by name get `exact: true` unless the accessible name is known
  to carry a suffix (a closable tab's is `Demo close Demo`).
- **A speaker's group must die with the process it spoke to.** The spin
  route reporting the session's own failure under `spin` doubled the row
  and, after the fix, left a stale `exited` that made the status bar lie
  over a live engine. The rule that closed it: identity filter on the
  session's own diagnostic, and `('spin', [])` on every restart.
- **Two frames from one synchronous block need a count, not a content
  poll.** A poll on the last frame's text is satisfied by the first of the
  two; the counts after it are then off by one on a slow tick.
- **The literal flag is not always the guard.** `stopping` was specified;
  `disposed || handle !== spawned` already covered every deliberate stop,
  and the reviewer traced all three paths before accepting the omission.
  A reviewer who cannot enumerate the paths should ask for the flag.
- **A paused implementer leaves a diff; the controller can land it.** The
  dictionary was interrupted mid-task; zero Cyrillic and three green
  suites were enough to commit it as a checkpoint and resume with the
  Playwright run, the formatter and the review — no restart, no lost work.
