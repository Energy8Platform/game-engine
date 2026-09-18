# Slice 20 — media node types: what was left behind

Slice: `docs/superpowers/plans/2026-09-18-media-nodes.md`, spec
`2026-09-18-media-nodes-design.md`. Commits `14ad54f..98a0fe9` on
`feat/slot-webide-cordis` (eleven) plus this note's. A node type now
carries its asset side as data — `accept { extensions, prop, sibling? }`,
`assetProps`, schema meta `asset: string[]` — through `node-types` to the
host and the IDE. Two plugin packages add four animated types:
`@energy8engine/node-media` (row `media1`: `spritesheet`, `video`, `gif`)
and `@energy8engine/node-spine` (row `spine1`: `spine`); `image` joins the
mechanism. The host checks every node's asset files generically (a
`sibling` prop derives `<stem>.<sibling>`); the IDE derives its drop
registrations from the reported types, renders `asset` fields as file
selects, and writes whole pixels. The example has a spinning `coin`
spritesheet. Sub-project D1 is closed; D2 (symbols as data) and D3
(`tween`/`sound` flow kinds) remain. Full Playwright alone: 119/119.

## Amendments made while running the plan

- **Media types mount a placeholder and fill it in `update`.** The scenes
  runtime never remounts after an asset load — `show` → `load` →
  `refresh()` → `update` for every node with its mount-time props. The
  spec's "empty `Container` fallback" became the real view class on an
  empty source (`AnimatedSprite` on `Texture.EMPTY`, `Sprite`, a wrapper
  `Container` for `gif` and `spine`), because a placeholder that is not the
  final view can never become it.
- **`refresh()` guards every node.** A throwing `update` (a spritesheet
  whose animation names a missing frame, a skeleton that does not parse)
  used to reject `show`, leave every sibling unfilled and report nothing.
  The runtime now catches per entry and reports once per failing node
  under `<scene>/<node>`; the `spine` type dropped its own try/catch and
  `reported` WeakSet. `spritesheet` also filters non-textures out of an
  animation, so a typo'd sheet shows the frames that exist.
- `spine` builds `SkeletonData` itself from the loader's raw skeleton and
  `TextureAtlas` (`Spine.from` needs `Assets` aliases the loader does not
  set); the parsers are registered by the package's import, and `spine1` is
  imported by the bundle loader before `flow1`'s first `show`.
- Derived drop registrations are ranked LAST (`derived:*`), so a project's
  own `assetNodeTypes.register` wins regardless of arrival order; a lone
  `.skel` still picks `spine` (`?? candidates[0]`); with no tree a `.json`
  picks the sibling-less registration (`spritesheet`).
- Host asset checks are gated on the game's `node-types` report, like the
  schema and unknown-type checks already were.
- `gif`/`spine` find their own child by `instanceof`, not `children[0]` —
  a hand-edited YAML child under either lands in the wrapper first.
- Positions round to integers in three places: flow `moveNode`, canvas
  `edit`, and the drop (`DECIMALS.x/y = 1`).

## Debts

1. **Offline projects are blind.** While the game has not reported (no
   preview composing, or the first seconds of boot) the host reports no
   missing-asset diagnostics and the canvas refuses every drop with "no
   node type". The fix is the flow plugin's shape: built-in `NodeTypeInfo`
   on the host before the game speaks, and the same list seeding the
   client's derived registrations.
2. **Host checks existence only.** `meta.asset` extensions travel on the
   wire and are unused: `image.src: assets/coin.json` passes the check and
   fails in the render loop. The picker prevents it; a hand edit does not.
3. **`node-media`**: `instanceof Spritesheet/GifSource` assumes one pixi
   instance; two `video` nodes on the same `src` share one `<video>`
   element (pixi's `Assets` cache); `fps ≤ 0` is accepted (harmless);
   `gif`'s wrapper drops `anchor`.
4. **`node-spine`**: `SkeletonData` is parsed per node, uncached; `anchor`
   does not reach the `Spine` child (the root bone is the origin); the
   thrown parse message names the missing key, not the path — the
   runtime's `where` names the node.
5. **Host**: `has no <prop>` wording for a non-string value; the
   `coin.json` fixture is inert (the positive test uses a stub `hasFile`).
6. **IDE**: the asset picker refetches the tree only on scene-set change
   and once per selection change while the inspector is open;
   `useAssetPicker` does not order responses; the derived `node()` writes
   `anchor: 0.5` for every type, inert for wrappers.
7. **e2e**: the frame-change wait is 1 s at 8 fps — fine, but a CI under
   load may still need `expect.poll` with a longer window.

## Method

- **Placeholder-and-fill moves every type's failure onto one runtime
  loop**; the guard belongs at that fan-out, not in each type. The spine
  node grew its own try/catch and still could not protect the loop from
  `spritesheet`. When a runtime calls plugin code in a loop, the loop
  owns the try/catch.
- **"Carry to the final wave" needs an owning task.** The refresh guard
  was ruled in Task 3 and shipped only because the final reviewer
  reproduced it. Put a ruled fix in the last task's file list, or open a
  task for it.
- **Measure severity with a headless repro before ranking.** The reviewer
  expected a non-texture into `Sprite.texture` to throw; it does not
  (pixi tolerates until render). The missing-frame case does. Two scratch
  scripts settled both; a guess would have ranked them backwards.
- **Byte-identity pins (`template.test.ts`) plus `cmp` at review** make
  "script-generated, byte-identical" checkable; keep them for every
  fixture the example and the template share.
- **A derived registration must lose to an explicit one by rank, not by
  arrival.** The boot race (game report vs project plugin) is invisible
  in tests that register in one order.
