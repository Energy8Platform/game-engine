# Slice 8 — the shell floats: what was left behind

Slice: `docs/superpowers/plans/2026-09-13-the-shell-floats.md`, spec
`2026-09-13-modern-ui-design.md`. Commits `2fbd33b..fab245b` on
`feat/slot-webide-cordis` (six). The IDE shell now copies VS Code 1.137.0
Modern UI, default density: floating cards with 4px gaps and 8px corners,
a pill tab strip with no underline, a `::before` activity indicator, a
status bar on the window ground, Monaco painted on the editor card's
colour. `DESIGN.md` names the version and the source files it was measured
from.

## Debts

1. **Playwright suite flakes at the 30s budget under load.** Two full runs
   of 70: each had exactly one pre-existing test time out (`declared.spec.ts:160`
   once, `diagnostics.spec.ts:133` once), a different one each time, each
   green when run alone; Task 4's implementer saw the same shape once. The
   machine was also running an unrelated `vite --force` from another repo.
   Nothing in this slice touched those tests. `runtime.spec.ts` already uses
   a 60s budget; the lever is `test.setTimeout(60_000)` at the top of the
   two specs, or a config-level `timeout: 60_000`. Decide before the next
   slice that adds e2e tests — a suite that needs two runs to be green is
   not a gate.
2. **Colour guard strips only rules whose selector STARTS with `[data-theme`.**
   `tests/styles.test.ts`'s regex `\[data-theme[^{]*{[^}]*}` would exempt a
   future `[data-theme='light'] .e8-x { color: #fff }` from the literal-colour
   check. Nothing today. Tighten to `^\[data-theme='light'\]\s*{` if a second
   theme-scoped rule ever appears.
3. **Sash grip is one 2px dot** (VS Code draws three via `box-shadow`, which
   the shadow guard forbids). Near-invisible in both screenshots. If wanted:
   `background: radial-gradient(circle, currentColor 1px, transparent 1px)
   0 0 / 2px 5px repeat-y` on a 2×12 `::after` keeps the guard and draws
   three.
4. **Activity–sidebar seam is one `--e8-border` line** where VS Code's is
   transparent (spec §5 decision). Revisit only if it reads wrong beside a
   real VS Code window.
5. **Panel title row is 28px** (`--e8-header-h`), not the 32px view-title
   row, because `.e8-panel-header` overlays the entry's own 28px section
   header on the same line. Coherent; documented in `DESIGN.md` §2.
6. **`Cmd/Ctrl+S` on a non-editor tab, `SessionStatus` never returning to ○,
   `ProjectStatus` showing the plugin id, withdrawn `shell.document` leaving
   an unclosable tab, upload root-only, components getting the root ctx** —
   carried from Slice 7 unchanged; the project-management slice owns the
   `ProjectStatus` one.

## Method

- **A brief that contains the names it forbids.** Task 1's guard test had to
  spell `--e8-bg-1` and `--e8-radius` in a comment and a regex; the plan's
  "exist nowhere under `engine/`" constraint read literally would forbid the
  guard that enforces it. Ruling 1: the constraint's grep excludes the guard.
  Write the constraint that way the first time.
- **`background-clip: content-box` does not round the content box.** The
  plan's activity indicator was wrong before any implementer touched it; the
  pre-flight scan caught it (Ruling 0) and the `::before` layer with
  `isolation: isolate` / `z-index: -1` is the smallest correct answer. A CSS
  claim in a plan is a claim; the scan is where it is checked.
- **An interrupted implementer leaves a diff and no report.** The fresh
  implementer was told to read the diff against the brief rule by rule and
  keep what matched; it kept all of it and found two real fixes in it (the
  `button:hover` specificity override; the collapsed column `calc(+gap)`).
  Cheaper than a restart, and the review still had a full diff to judge.
- **A test that lets its mutation survive is not finished.** Task 3's brief
  test for "once per name" passed with `set.add(name)` deleted — nothing
  called `ensureTheme` twice. The implementer mounted a second `<Monaco>`
  and the mutation died. The mutation table is the test's test.
- **The branch was switched under a running suite.** GitHub Desktop moved
  the checkout to `main` mid-run; the run reported "1 did not run" and a
  shadow test failing on a file that no longer existed. `git reflog` said
  what happened; the note was committed from a temporary `git worktree`
  rather than by touching the other session's tree. Before a long run:
  `git branch --show-current` — and again after.
