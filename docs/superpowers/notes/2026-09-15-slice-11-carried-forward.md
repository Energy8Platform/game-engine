# Slice 11 — a project from a template: what was left behind

Slice: `docs/superpowers/plans/2026-09-15-new-project-from-template.md`,
spec `2026-09-15-new-project-from-template-design.md`. Commits
`10185f3..bbbe2cc` on `feat/slot-webide-cordis` (nine). The Projects
sidebar offers «New project»: pick `Basic slot`, type an id, Create — the
host copies `engine/templates/slot-basic` into the workspace, substitutes
the id, opens the project; the game spins in under a second. Unsaved work
is asked about first; only one question is ever on screen.

## Debts

1. **A project outside the monorepo does not run.** What it still lacks:
   `dependencies` `@energy8engine/*: "*"` are unpublished workspace links;
   `@energy8platform/game-engine@^0.41.0` is not satisfied by the
   workspace's own version (a pre-existing wart shared with `first-slot`);
   no `devDependencies` (`vite`, `typescript`, `@types/node`) while the
   tsconfig's `types` needs them for `tsc`; `e8-base` resolves from the
   host's `REPO_BUNDLES_DIR`. Spec §2 named `npm install` out of scope; the
   list above is what that slice pays. The tsconfig is self-contained now.
2. **The created project speaks as `first-slot`.** `src/main.ts` hard-codes
   `plugin: 'first-slot'` in its diagnostics (two places) — the price of
   byte-identity with the reference project. Fix in `first-slot` itself:
   read the name from `game/spec.json`; the template follows for free.
3. **Template tsconfig duplicates `tsconfig.base.json`** with nothing tying
   them; a drift is silent. A test that compares the shared keys would do.
4. **Spec wording superseded by rulings:** `{{id}}` is in two files plus a
   JSON edit of `package.json`'s `name` (the npm workspace glob
   `engine/*/*` forbids a placeholder name); §6's «форма подсвечивает поле»
   is moot — the id gate never submits a bad id.
5. **`first-slot`'s `index.html`** still lists `reel-step` in its mechanic
   select (it ships the plugin, so it is right there); the template's does
   not.

## Method

- **A template is measured against its reference, byte for byte.** The
  test that pins `main.ts`/`script.spin`/`e8.profile.yml` identical to
  `first-slot` is what makes "the template is a copy" a fact rather than a
  hope — and it is also what surfaced debt 2.
- **The npm workspaces glob reaches where you did not look.** A
  `package.json` named `{{id}}` under `engine/templates/<id>` is a
  workspace to npm; the implementer measured `npm install --dry-run` before
  the plan's literal instruction became a broken install.
- **A test that patches the artefact under test is a finding.** The first
  e2e copied the template and rewrote its tsconfig `extends` to make the
  created project boot one level deeper — proof that the shipped template
  did not boot there. The fix went into the template; the copy went away.
- **A refusal is an answer, not state.** Writing a Create refusal into the
  workspace's diagnostics made it render three times (list top, under the
  form, panel) and broadcast to every tab. The route's body and the form's
  local list are where an answer belongs.
- **One `asking`.** Two confirm states that render the same testids can
  both be open; the discriminated union `{ kind: 'row' | 'form' }` is the
  smallest thing that cannot.
