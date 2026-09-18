# Media Node Types Implementation Plan (slice 20)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four animated node types — `spine`, `spritesheet`, `video`, `gif` — as two plugin packages, plus an asset contract on every node type (`accept`, `assetProps`, `asset` schema meta) so the IDE's drop mapping, the Properties file picker and the host's file checks work for any type a plugin reports.

**Architecture:** `NodeType` gains `accept?`/`assetProps?` (travel in `NodeTypeInfo` through `node-types`); `@energy8engine/node-media` (row `media1`) and `@energy8engine/node-spine` (row `spine1`) register their types into `ctx.nodeTypes` the way `reels` does; the host's `checkScenes` checks files by `assetProps`; the IDE derives `assetNodeTypes` from the reported types (sibling rule for spine vs spritesheet `.json`) and renders `asset`-meta string fields as file selects.

**Tech Stack:** pixi.js 8.20.1 (`Spritesheet`, `AnimatedSprite`, `VideoSource`, `pixi.js/gif`), `@esotericsoftware/spine-pixi-v8` 4.2.x (already in `node_modules`), cordis 4, schemastery, React 18, vitest, Playwright. Spiked 2026-09-18: `AnimatedSprite` works headless with `requestAnimationFrame` stubbed; spine and gif modules import headlessly.

**Spec:** `docs/superpowers/specs/2026-09-18-media-nodes-design.md`

## Global Constraints

- Node types and props EXACTLY per spec §3 (`spine`: `skeleton` req, `atlas`, `animation`, `loop=true`, `skin`, `speed=1`; `spritesheet`: `sheet` req, `animation`, `fps=12`, `loop=true`, `playing=true`; `video`: `src`, `loop=true`, `muted=true`, `autoplay=true`; `gif`: `src`, `loop=true`, `speed=1`).
- `accept` per type: spine `{ extensions: ['skel','json'], prop: 'skeleton', sibling: 'atlas' }`; spritesheet `{ ['json'], 'sheet' }`; video `{ ['mp4','webm'], 'src' }`; gif `{ ['gif'], 'src' }`; image `{ ['png','jpg','jpeg','webp'], 'src' }`. `assetProps`: spine `['skeleton','atlas']`, others `[<prop>]`.
- Schema meta `asset: string[]` on the path props (`.extra('asset', [...])`); declared on `Schemastery.Meta` in `@energy8engine/scenes` (next to nothing — `pick` is declared in `@energy8engine/flow`; declare `asset` in scenes' `node-types.ts`).
- A `mount` with no loaded asset returns an empty `Container`; `update(view, props)` fills it in after `refresh()`.
- Host: the generic `assetProps` check replaces the `image.src` special case; spine's empty `atlas` resolves to `<stem>.atlas` before the check; messages `<type>.<prop> "<path>" is not in the project` / `<type> has no <prop>`.
- IDE: `assetNodeTypes` registrations DERIVED from `node-types` (the hard-coded `image` registration is removed); `pick(path, tree)` prefers a registration whose `sibling` exists beside the path, else one without `sibling`; `Pickers.asset(exts)`; `moveNode` (flow) and the canvas `edit` round positions to integers.
- Bundle: `media1` and `spine1` after `scenes1`; template/example gain `assets/coin.json` + `assets/coin.png` (4-frame 32×32 spritesheet, script-generated, byte-identical) and a `coin` node after `logo`; `package.json` gains both packages; `template.test.ts` pins.
- `main.ts` untouched. Never stage `packages/*`, `dist`, `concept.png`; the lockfile is gitignored. No `git checkout`/`git stash` on files you did not create. Never kill a process you did not start. Playwright runs alone. Branch stays `feat/slot-webide-cordis`.
- Commit trailer: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Commands from the REPO ROOT: `npm test -w @energy8engine/<pkg>`; e2e: `cd engine/apps/web && npx playwright test tests/e2e/media.spec.ts`.

---

## File map

| Path | Responsibility |
|---|---|
| `engine/core/contracts/src/protocol.ts` | `NodeTypeInfo.accept?`, `assetProps?` |
| `engine/game/scenes/src/node-types.ts`, `src/builtin.ts` | `NodeType.accept/assetProps`; `Schemastery.Meta.asset`; `image` gets both + `.extra('asset', …)` |
| `engine/game/ide-bridge/src/index.ts` | forwards `accept`/`assetProps` in `node-types` |
| `engine/game/node-media/{package.json,tsconfig.json,vitest.config.ts,src/{spritesheet,video,gif,runtime,schema,index}.ts}` | `media1` |
| `engine/game/node-spine/{same shape, src/{spine,runtime,schema,index}.ts}` | `spine1` |
| `engine/bundles/e8-base/e8.bundle.yml` | two rows |
| `engine/ide/host/src/plugins/scenes.ts` | generic asset check |
| `engine/ide/client/src/plugins/asset-node-types.ts`, `src/plugins/scenes.tsx`, `src/shell/SceneDocument.tsx`, `src/schema-form/fields.tsx`, `src/shell/PropertiesSidebar.tsx`, `src/shell/FlowProperties.tsx`, `src/shell/flow-graph.ts` | derived registrations, tree-aware pick, asset picker, rounding |
| `engine/templates/slot-basic/{assets/coin.json,assets/coin.png,scenes/base_game.scene.yml,package.json}` + `engine/examples/first-slot/{same}`; `engine/ide/host/tests/template.test.ts` | fixture |
| `engine/apps/web/tests/e2e/media.spec.ts` | proof |

---

### Task 1: The asset contract on a node type

**Files:**
- Modify: `engine/core/contracts/src/protocol.ts` (`NodeTypeInfo`), `engine/game/scenes/src/node-types.ts` (`NodeType`, the `Meta` augmentation), `engine/game/scenes/src/builtin.ts` (`image`), `engine/game/ide-bridge/src/index.ts` (the `node-types` payload: `{ type, schema, accept: t.accept, assetProps: t.assetProps }` — omit `undefined` keys or leave them; both fine on JSON)
- Test: `engine/core/contracts/tests/protocol-scenes.test.ts` (extend), `engine/game/scenes/tests/node-types.test.ts` (extend: `image.accept`, `image.assetProps`, `src` meta has `asset`), `engine/game/ide-bridge/tests/index.test.ts` (extend the `node-types` case: a type with `accept` is forwarded with it)

**Produces:**

```ts
// contracts
export interface NodeTypeAccept { extensions: string[]; prop: string; sibling?: string }
export interface NodeTypeInfo { type: string; schema: unknown; accept?: NodeTypeAccept; assetProps?: string[] }
// scenes/node-types.ts
export interface NodeType<P> { …; accept?: NodeTypeAccept; assetProps?: string[] }
declare global { namespace Schemastery { interface Meta<T> { asset?: string[] } } }   // same shape as flow's `pick` augmentation — read engine/game/flow/src/kinds.ts for it
```

`image`: `accept: { extensions: ['png','jpg','jpeg','webp'], prop: 'src' }`, `assetProps: ['src']`, `src: Schema.string().required().extra('asset', ['png','jpg','jpeg','webp'])`.

- [ ] **Step 1: Failing tests; Step 2: implement; Step 3:** `npm test -w @energy8engine/contracts -w @energy8engine/scenes -w @energy8engine/ide-bridge` green + typecheck. Commit `git commit -m "Let a node type say which files it takes and which props hold paths"`.

---

### Task 2: `@energy8engine/node-media` — spritesheet, video, gif

**Files:**
- Create: package files (copy `engine/game/scenes/`'s; name `@energy8engine/node-media`; exports `.`, `./runtime`, `./schema`; `e8.runtime.entry ./src/runtime.ts`, `schema ./src/schema.ts`; NOT hot; deps `@energy8engine/scenes`, `@energy8engine/contracts`, `cordis`, `pixi.js`, `schemastery`)
- Create: `src/spritesheet.ts`, `src/video.ts`, `src/gif.ts`, `src/runtime.ts` (`name = 'node-media'`, `inject = ['nodeTypes']`, `apply`: `ctx.effect(() => ctx.nodeTypes.register(spritesheet), …)` ×3 — read `engine/game/reels/src/runtime.ts:83-99` for the `ctx.inject(['nodeTypes'], …)` + effect shape; here `inject` is static so register directly with `ctx.effect`), `src/schema.ts` (`Schema.object({})`), `src/index.ts`
- Modify: `engine/bundles/e8-base/e8.bundle.yml` (`media1` after `scenes1`)
- Test: `tests/spritesheet.test.ts`, `tests/video.test.ts`, `tests/gif.test.ts`, `tests/runtime.test.ts`

**Produces:** `export const spritesheet: NodeType<SpritesheetProps>`, `video`, `gif`; the row.

Implementation notes:
- Each `mount(props, ctx)` reads `ctx.reflect.get('assetLoader', false)` (the scenes row provides it; `AssetLoader.get(path)` → whatever `Assets.get` returns) — the same lenient read `image` uses. `Assets.get(sheet)` after `Assets.load('/assets/coin.json')` is a `Spritesheet`.
- `spritesheet.mount`: `const sheet = loader?.get(props.sheet) as Spritesheet | undefined; if (!sheet) return new Container();` frames = `sheet.animations[animation ?? firstKey]` ?? `Object.keys(sheet.textures).sort().map(k => sheet.textures[k])`; `const s = new AnimatedSprite(frames); s.animationSpeed = fps / 60; s.loop = loop; if (playing) s.play(); return s;`. `update(view, props, ctx)`: if `view` is not an `AnimatedSprite` (the empty fallback) → nothing (the runtime remounts on the next replace; document); else set `textures` when the animation changed, `animationSpeed`, `loop`, play/stop. `assets: (p) => p.sheet ? [p.sheet] : []`.
- `video.mount`: `const tex = loader?.get(props.src) as Texture | undefined; if (!tex) return new Container(); const src = tex.source as VideoSource; src.loop = loop; src.muted = muted; if (autoplay) void src.resource.play?.()` — read pixi 8's `VideoSource` API (`node_modules/pixi.js/lib/rendering/renderers/shared/texture/sources/VideoSource.d.ts`: `loop`, `muted`, `autoPlay` are constructor options; at runtime set `source.resource.loop/muted` on the `<video>` element and call `play()`/`pause()`). `update`: apply loop/muted; autoplay → play/pause. `assets` → `[src]`.
- `gif.mount`: `import 'pixi.js/gif'`; `const source = loader?.get(props.src) as GifSource | undefined; if (!source) return new Container(); return new GifSprite({ source, loop, animationSpeed: speed, autoPlay: true })`. `update`: `loop`, `animationSpeed`. `assets` → `[src]`.
- All three: `accept`/`assetProps` per Global Constraints; `.extra('asset', …)` on the path prop.
- Tests (headless; stub `globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(0), 16) as any` and `cancelAnimationFrame` at the top so `AnimatedSprite.play()` can add to the ticker): spritesheet — build a `Spritesheet` from `Texture.WHITE` with two frames and `animations: { spin: ['a','b'] }`, `await sheet.parse()`, a fake loader returning it; `mount` → `AnimatedSprite` with 2 textures, `animationSpeed` 12/60, playing; `mount` with `animation: 'nope'` → falls back to all frames sorted; no sheet → empty `Container`; `update` changes fps/loop/stop; `assets`/`accept` shapes. video — a fake texture `{ source: { resource: { play: vi.fn(), pause: vi.fn() }, loop: false, muted: false } }`; `mount` sets loop/muted and calls `play`; `update` with `autoplay: false` pauses. gif — a fake `GifSource`-shaped object is hard; instead assert `mount` with no source → empty `Container`, and with a real `GifSource` built from a 1-frame decoded gif? `GifSource` has a constructor taking `{ frames, duration, ... }` — read `node_modules/pixi.js/lib/gif/GifSource.d.ts`; build one with a single `Texture.WHITE` frame → `GifSprite` mounts; `update` sets `loop`/`animationSpeed`. runtime — `ctx.plugin(runtime)` with a provided `nodeTypes` registers the three; dispose removes them.

- [ ] **Step 1: Failing tests; Step 2: implement; Step 3:** `npm install && npm test -w @energy8engine/node-media` green + typecheck. Commit `git commit -m "Animated pictures as scene nodes: spritesheet, video, gif"`.

---

### Task 3: `@energy8engine/node-spine`

**Files:**
- Create: package files (as Task 2; name `@energy8engine/node-spine`; deps + `@esotericsoftware/spine-pixi-v8` `~4.2.0` — pin what `node_modules` holds: `4.2.120`), `src/spine.ts`, `src/runtime.ts` (`name = 'node-spine'`, `inject = ['nodeTypes']`), `src/schema.ts`, `src/index.ts`
- Modify: `engine/bundles/e8-base/e8.bundle.yml` (`spine1` after `media1`)
- Test: `tests/spine.test.ts`, `tests/runtime.test.ts`; fixture `tests/fixtures/minimal.json` (a Spine 4.2 skeleton JSON: `skeleton { spine: "4.2.11", hash, width 1, height 1 }`, `bones: [{ name: "root" }]`, `slots: [{ name: "s", bone: "root", attachment: "a" }]`, `skins: [{ name: "default", attachments: { s: { a: { type: "region", width: 1, height: 1 } } } }]`, `animations: { idle: { bones: { root: { rotate: [{ angle: 0 }, { time: 1, angle: 90 }] } } }, wave: { … } }`), `tests/fixtures/minimal.atlas` (an atlas text naming `minimal.png`, one region `a` 1×1), `tests/fixtures/minimal.png` (1×1)

**Produces:** `export const spine: NodeType<SpineProps>`; the row.

Implementation: `mount(props, ctx)`: `import { Spine } from '@esotericsoftware/spine-pixi-v8'`; the loader path: `Assets.load` of `/${skeleton}` and `/${atlas}` (done by `scenes.show` through `assets()`) makes `Assets.get(skeleton)` a `SkeletonData`? — spine-pixi-v8's loaders register `.skel`/`.json` → `SkeletonJson/Binary` data and `.atlas` → `TextureAtlas`; `Spine.from({ skeleton: <alias>, atlas: <alias> })` looks them up in `Assets.cache` by the alias the loader was given. Since our loader keys are `/${path}`, call `Spine.from({ skeleton: '/' + skeleton, atlas: '/' + atlas })` inside a try/catch → on throw return an empty `Container` (asset not loaded yet); then `skin` → `skeleton.setSkinByName(skin)` + `setSlotsToSetupPose()`; `animation` → `state.setAnimation(0, animation || first, loop)`; `state.timeScale = speed`. `update`: skin/animation/loop/speed in place. `assets: (p) => [p.skeleton, p.atlas || p.skeleton.replace(/\.(skel|json)$/, '.atlas')]`. `accept`/`assetProps` per constraints.

- [ ] **Step 1: Spike inside the test** — can `Spine.from` build headlessly from the fixture through `Assets.load` (pixi `Assets` needs a fetch — use `Assets.add({ alias, src: 'file://…' })`? `Assets.load` in node has no fetch of `file:`). Alternative that avoids `Assets` entirely in tests: build `SkeletonData` directly — `new SkeletonJson(new AtlasAttachmentLoader(new TextureAtlas(atlasText)))` with `atlas.pages[0].setTexture(SpineTexture.from(Texture.WHITE.source))`, then `new Spine(skeletonData)`. Structure `mount` so the `SkeletonData` resolution is a small injectable step: `resolveSkeleton(loader, props)` → `SkeletonData | undefined` (production: from `Assets.cache` via `Spine.from`'s internal lookup — simplest: production uses `Spine.from({ skeleton, atlas })`; tests exercise `mountFromData(data, props)`); assert: the view is a `Spine`, `state.tracks[0].animation.name === 'idle'`, `update` switches to `wave` and `timeScale`. If `new Spine(data)` throws headlessly (needs a renderer), record the exact error in the report, keep `mountFromData` covered as far as it goes (`SkeletonData` parse + the props mapping as pure functions) and mark the mount itself e2e-only.
- [ ] **Step 2: Implement; Step 3:** `npm test -w @energy8engine/node-spine` green + typecheck. Commit `git commit -m "Spine skeletons as scene nodes"`.

---

### Task 4: Host — files checked by `assetProps`

**Files:**
- Modify: `engine/ide/host/src/plugins/scenes.ts` (`checkScenes`: replace the `node.type === 'image'` block with the generic rule; kinds come in as `NodeTypeInfo[]` already), `engine/ide/host/tests/scenes.test.ts` (replace the image cases; add: `spritesheet.sheet` missing → error naming `spritesheet.sheet`; `spine` with empty `atlas` → checks `<stem>.atlas`; a type without `assetProps` → nothing checked; empty string → `<type> has no <prop>`)
- Fixture: `engine/ide/host/tests/fixtures/project-scenes/` gains `assets/coin.json` (any small JSON) so a positive case exists

Rule: for each node, `const info = nodeTypes.find(t => t.type === node.type)`; for each `prop` of `info?.assetProps ?? []`: `let v = node.props?.[prop]`; if `node.type === 'spine' && prop === 'atlas' && !v` → `v = skeleton.replace(/\.(skel|json)$/, '.atlas')` (only when `skeleton` is a string) — generalise as: when `info.accept?.sibling && prop === <the sibling prop>`… keep it explicit for spine's `atlas`: `v = (node.props.skeleton as string).replace(/\.(skel|json)$/, '.atlas')` with a comment; `typeof v !== 'string' || v === ''` → error `<type> has no <prop>` (skip when the schema does not require it? no — `assetProps` are all required by meaning); `!hasFile(v)` → error `<type>.<prop> "<v>" is not in the project`.

- [ ] **Step 1: Failing tests; Step 2: implement; Step 3:** `npm test -w @energy8engine/ide-host` green + typecheck. Commit `git commit -m "Check every node's asset files, not just an image's"`.

---

### Task 5: IDE — derived drop mapping, the asset picker, rounding

**Files:**
- Modify: `engine/ide/client/src/plugins/asset-node-types.ts` (remove the built-in `image`; `pick(path, tree?)` with the sibling rule; `register` unchanged), `engine/ide/client/src/plugins/scenes.tsx` (on every `nodeTypes()` change: dispose the previous derived registrations, register one per type with `accept` — ids `derived:<type>`; keep an explicit project registration winning: derived ones register FIRST? `pick` scans from the end; register derived ones then any manual — order of `register` calls: derived on each `node-types` frame; a project plugin registering later wins), `engine/ide/client/src/shell/SceneDocument.tsx` (drop handler passes `await ctx.files.tree()` entries to `pick`), `engine/ide/client/src/schema-form/fields.tsx` (`Pickers` type → `Record<string, (arg?: unknown) => string[]>`; a string field with `meta.asset` → `<select>` from `pickers.asset(meta.asset)`, same shape as the `pick` select), `engine/ide/client/src/shell/PropertiesSidebar.tsx` + `FlowProperties.tsx` (supply `asset: (exts) => tree entries whose extension ∈ exts`, tree from `ctx.files.tree()` fetched once per mount and on `files/written` frames — simplest: fetch on mount and re-fetch when the picker is opened? keep: fetch on mount, refetch on `ctx.scenes` docs change), `engine/ide/client/src/shell/flow-graph.ts` (`moveNode` rounds), `engine/ide/client/src/shell/SceneDocument.tsx` (the canvas `edit` already rounds via `roundProps` — verify; `dropAsset` rounds `x,y` — slice-18 debt)
- Test: `tests/asset-node-types.test.ts` (pick with a tree: `a.json` + `a.atlas` → spine; `b.json` alone → spritesheet; `c.mp4` → video; last-wins on re-report), `tests/scenes-service.test.tsx` (a `node-types` frame with `accept` yields registrations; a second frame replaces them), `tests/schema-form.test.tsx` (asset meta → select from the picker), `tests/flow-graph.test.ts` (rounding), `tests/scene-document.test.tsx` (drop `assets/coin.json` → a `spritesheet` node with `sheet`)

- [ ] **Step 1: Failing tests; Step 2: implement; Step 3:** `npm test -w @energy8engine/ide-client` green + typecheck; `npm run build -w @energy8engine/ide-web` (no pixi in dist). Commit `git commit -m "Drop any asset a node type takes; pick files by extension on the right"`.

---

### Task 6: Template and example — the coin

**Files:**
- Create: `engine/templates/slot-basic/assets/coin.json`, `assets/coin.png` (+ the same under `first-slot`) via a scratchpad script: a 128×32 PNG with four 32×32 discs (`#f59e0b` with a `#fff` highlight moving left→right), `coin.json` = `{ frames: { coin0: { frame: {x:0,y:0,w:32,h:32} }, …coin3 }, animations: { spin: ['coin0','coin1','coin2','coin3'] }, meta: { image: 'coin.png', size: {w:128,h:32}, scale: '1' } }`
- Modify: `scenes/base_game.scene.yml` (both): `{ id: coin, type: spritesheet, props: { sheet: assets/coin.json, x: 40, y: 40, fps: 8, anchor: 0.5 } }` after `logo`; `package.json` (both): `@energy8engine/node-media`, `@energy8engine/node-spine`; `engine/ide/host/tests/template.test.ts` (identity loop `+ 'assets/coin.json', 'assets/coin.png'`); READMEs one sentence.
- Boot check: ports free → `e8`, open `first-slot`, `GET :5681/api/scenes` shows the node and no diagnostics; Chromium: `__e8.scenesVisible()` `['base_game']`, `__e8.nodeVisible('base_game','coin')` true; stop what you started.

- [ ] **Step 1–3; commit** `git commit -m "A spinning coin in the example, as a spritesheet node"`.

---

### Task 7: End to end

**Files:**
- Create: `engine/apps/web/tests/e2e/media.spec.ts`
- Modify: `engine/game/scene-edit/src/index.ts` (`__e8edit.frameOf(node): number | null` — `AnimatedSprite.currentFrame` of the node's view, `null` otherwise) + its unit test

Cases: open `base_game`'s canvas → `snapshot().bounds.coin` exists and `frameOf('coin')` changes within 500 ms; drop `assets/coin.json` from the Explorer onto the canvas (the slice-18 in-frame `DragEvent` idiom) → `spritesheet-1` with `sheet: assets/coin.json` in the file; Properties for `coin` shows a `fps` field and the `sheet` select; the Preview shows `coin` visible on `base_game` (`__e8.nodeVisible`).

- [ ] **Step 1: Write; Step 2:** run `media.spec.ts` + `canvas.spec.ts` + `scenes.spec.ts` alone; **Step 3:** whole suite (unit: contracts, scenes, node-media, node-spine, ide-bridge, ide-host, ide-client, ide-web; then the full Playwright run alone); **Step 4:** commit `git commit -m "Prove the media nodes in a browser"`.
