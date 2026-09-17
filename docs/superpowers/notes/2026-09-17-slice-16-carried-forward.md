# Slice 16 — scenes and layers: what was left behind

Slice: `docs/superpowers/plans/2026-09-17-scenes-and-layers.md`, spec
`2026-09-17-scenes-and-layers-design.md`. Commits `476153e..f0c1044` on
`feat/slot-webide-cordis` (nineteen) plus this note's. The stage has
layers ordered by `z`; a scene, named after a spin stage, says which layers
it shows and with which transition; the page enters `result.stage` before
presenting; `cut` and `fade` are built in and a registry takes more; the
reels mount into a layer; `stage1` is hot, so a layer or scene edit
re-applies the row under the running game and `design` alone reloads it.
The host cross-checks scenes against the script's stages, pushes a scene
into the preview, and mirrors the game's transition ids live. The form
learned arrays and dicts of objects; the Scenes screen edits the same row
through the same `PUT`. User story 4 of the 2026-09-16 list is closed.

## Debts

1. **After a hot `stage1` re-apply every layer is visible until the next
   spin or "Show in preview".** The new stage's `current()` is `null`;
   nothing re-enters the last scene. `ide-bridge` could remember
   `stage.current()` and re-enter it when `stage` is re-provided.
2. **The transitions and stages lists go stale across a project switch**
   until the new game reports; a project with no stage row keeps the old
   list. A `game-transitions: []` in the host's clear block would fix it.
3. **Two anonymous games share one diagnostics bucket** — the IDE's
   embedded preview and a standalone game page both report with no game
   id; the later frame replaces the earlier. `diagnostics.spec.ts`
   passes on a ~600 ms margin. Needs a per-socket identity for anonymous
   games (wire + panel).
4. **A patch edited through the files route does not recheck scenes**
   (nor reload `project`); only a row `PUT` and a `.spin` write/removal do.
5. **A transition mid-flight at re-apply** keeps ticking on detached
   containers for `transitionMs`; bounded, no throw.
6. **Concurrent `enter` calls are not queued** — the play loop is
   sequential; "Show in preview" during a spin's transition races it.
7. **`checkScenes` reads the raw patch**: a malformed `layers`/`scenes`
   value reads as empty with no diagnostic (the row schema refuses it on
   `PUT`; a hand-edited patch is silent). Its duplicate-id copy prints `""`
   for a layer with no id.
8. **`SchemaForm` arrays are index-keyed**; an external removal ahead of a
   focused row shifts the draft to the neighbour (same ceiling as
   `DictField`); renaming a dict key onto an existing key overwrites it;
   `defaults()` yields `''` for a primitive with no default.
9. **`hasScenes` rebuilds every row's schema per render**; `useMemo` on
   `rows` when compositions grow.
10. **`@energy8engine/ide-web` typecheck reports six `TS7016`s** for the
    Monaco grammar modules — the ambient `monaco-modules.d.ts` lives in
    `ide-client/src` and `ide-web`'s tsconfig does not see it. Pre-existing
    since slice 14; `ide-client`'s own typecheck is clean.
11. **The `stage` hint copy hard-codes `stage1`**; a fork renaming the row
    gets a wrong hint.
12. **No test for a reels-only re-apply changing `layer`**; the inject
    callback is re-registered by the fresh apply, so the path is the
    first-mount path.

## Method

- **A browser test is the integration test.** Three product gaps reached
  the e2e with every unit suite green: the Scenes screen read the raw patch
  (no schema defaults, so no layers and a scene written empty); scene
  diagnostics travelled a different list than the screen filtered; the
  `scenes` plugin injected two services and read a third — the unit test
  rendered on the root context, which cordis never guards. The fix for the
  last: render the document through the plugin's OWN context in the test,
  the way the shell does.
- **A default is a fact the checker must know.** `checkScenes` compared
  scene layers against the patch's `layers` and called the schema's
  default layer undeclared. Reading raw config next to a schema is a lie
  waiting for a hand-written patch.
- **"Arriving" is not "shown".** `fade` faded every layer of the target
  scene, including the one already on screen; the transition's contract
  said `to` is what arrives. The blink was ledgered as minor by the task
  review and made merge-blocking by the final one, reproduced with a
  script rather than argued.
- **A warning for every project is noise, not a refusal.** "Stage
  `base_game` has no scene" fired on every spin of every project that had
  never heard of scenes; the rule became "only when at least one scene is
  declared", applied at the host and in the runtime alike.
- **A hot row's `destroy` is a contract with strangers.** The stage
  detached layer children but destroyed root-mounted ones — where the
  reels lived. "Never destroy what you did not create" is now the rule,
  tested for both mount points.
- **Boot-only mirrors lie on the default path.** The transitions list came
  from the boot `GET`; the game boots after it, so the list was empty
  exactly when a user opens the IDE — and the e2e had pre-visited the game
  to hide it. The relay was the fix; the pre-visit was removed so the test
  proves the path a user takes.
