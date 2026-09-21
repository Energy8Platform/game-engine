# Symbol scenes, named states, count-up — design (slice 30)

Date: 2026-09-21. Branch: `feat/slot-webide-cordis` at `b0099e07` (slice 29).
Source: round 2 of the paper-duel port
(`docs/superpowers/notes/2026-09-19-paper-duel-port-feasibility.md`), requests
N1, N4, N5. Decided with the user: a composite symbol state is a **scene**
(not children on a node); named states live in a `states` map and a
`playState` board step plays them; count-up is its own flow kind `count`.

## 0. Rules

- `packages/*` is not edited. The legacy `SymbolCell` reaches the view
  through the `SymbolView` contract (`playWin`, `resize`, `showStatic`);
  everything new hangs off the view object the way `bind` already does.
- Every new prop keeps the flow's rule: string props refuse unquoted YAML
  scalars; `''` is "untouched".
- Every fix carries a unit test; the browser proof is §6.

## 1. N1 — a symbol state may be a scene

### 1.1 The document

A state's node may be `{ type: scene, props: { scene: <id> } }` — the
built-in `scene` node type, already registered. The referenced document is
a **cell scene**: its nodes may bind `$cell.<field>` on any non-asset prop
(`text.text: '$cell.mv'`, `image.visible: '$cell.champion'`,
`shape.alpha: '$cell.damage'`), exactly as a `symbols.yml` state does today.
`scene.scene` gains `.extra('pick', 'scene')` so the IDE draws a dropdown.

### 1.2 Mounting and binding (`@energy8engine/scenes`)

`ScenesService` gains:

```ts
mountCell(id: string, data?: Record<string, unknown>): CellMount | null;

interface CellMount {
  view: Container;
  /** Re-resolves every `$cell` prop of the copy against `data` (update + applyCommon). */
  bind(data: Record<string, unknown>): void;
  /** Every node's `once` (strip/spritesheet/spine/…) awaited together; at once when none. */
  once(): Promise<void>;
  destroy(): void;
}
```

- `mountCell` mounts the document as its own subtree (like `mountDoc`),
  keeps the copy's entries itself (it is not part of any top-level `Mount`),
  and resolves `$cell` props of every node — roots and children — against
  `data`; `null` when the document is missing.
- The cell resolution moves from `@energy8engine/symbols`' `resolveProps`
  into scenes as `cellProps(type, raw, data?)` → `{ raw, bound }` (a
  bound prop with no data stands at `emptyProp`); `mountNode` applies it to
  EVERY mount (a `$cell` prop in an ordinary scene mounts at its empty value
  instead of throwing — the host check, not the runtime, refuses it there),
  and an `Entry` remembers its `bound` keys so `bind` touches only those.
- `mountDoc` (the `scene` node type's path) is unchanged in signature and
  gains the same lenient resolution for free.

### 1.3 The symbol handle (`@energy8engine/symbols`)

- A state whose node is `scene` mounts through `scenes.mountCell(props.scene,
  cell)` instead of `nodeTypes.get('scene').mount`; `bind(data)` forwards to
  `CellMount.bind`; the state's `once` is `CellMount.once()`; `fit` measures
  the copy's bounds as it does any child. No `scenes` service → the state
  fails to mount with the usual `symbols/<id>/<state>` diagnostic.
- Asset preload: for a `scene` state the symbols runtime adds
  `scenes.assetsOf(props.scene)` to its load set.
- `resolveProps` is deleted from symbols; it imports `cellProps`.

### 1.4 The host

- `symbols.ts` check: a `scene` state must name a document the scenes plugin
  knows — else `error` `unknown scene "<id>"` at `symbols/<id>/<state>`.
- `scenes.ts` check: `cellBindings` is true for every scene id some
  `symbols.yml` state references (a cell scene); the message for the others
  stays `only a symbols.yml state reads a cell` → reworded `only a cell
  scene (one a symbols.yml state names) reads a cell`. An asset prop bound
  to `$cell` stays refused everywhere. The scenes check re-runs when
  `symbols.yml` changes (the symbols plugin asks `scenesHost` to re-check
  after a write, and vice versa on boot order).

### 1.5 The IDE

- The symbols panel's state chip for a `scene` state shows the scene id; the
  properties panel edits `scene` as a dropdown of the document's scene ids.
- The scene editor opens a cell scene like any other; `$cell` values show
  empty (the runtime's lenient mount); no new editor UI.

## 2. N4 — named states and `playState`

### 2.1 The document

```yaml
- id: ROCK
  static: { type: image, props: { src: assets/rock.webp } }
  states:
    death: { type: strip, props: { src: assets/rock-death.webp, cols: 7, rows: 1, fps: 18 } }
    celebrate: { type: scene, props: { scene: rock_celebrate } }
```

`SymbolDef.states?: Record<string, SymbolNode>`; `SymbolState` becomes
`string`; a helper `stateNode(def, name)` answers `def[name]` for
`static`/`idle`/`win` and `def.states?.[name]` otherwise. Names are
identifiers (`/^[A-Za-z_][\w-]*$/`) and may not be one of the three
built-ins — the host refuses either.

### 2.2 The handle

`playState(name): Promise<void>` generalises `playWin`: mount the state over
the resting one, await its `once` (600 ms when the type has none), unmount,
show the resting state again; a state already playing is replaced (the
earlier promise resolves). `playWin()` is `playState('win')`. Exposed on the
view as `view.playState`. A symbol with no such state resolves at once —
one `info` diagnostic per `(symbol, state)` per session (`symbols/<id>`:
`no state "<name>"`), not an error: a mechanic names `death` for every
loser and not every symbol dies.

### 2.3 The step

```ts
export interface PlayStateStep {
  kind: 'playState';
  cells: Cell[];
  state: string;
  /** default true: the plan waits for every cell's state to finish; false: start them and go on */
  wait?: boolean;
}
```

A **known board step**: `KnownPresentationStep`, `KNOWN_STEP_KINDS`,
`BoardApi.playState(step, opts?)`, `isPresentationStep` (`cells` an array
of cells, `state` a non-empty string, `wait` a boolean when present). The
reels board runs `cell.view.playState?.(state)` for each cell (a cell past
a short reel, an empty cell or a view without `playState` is skipped),
`Promise.all` when `wait !== false`; `skip()` collapses the pending ones
through `showStatic`. `revealWins` is unchanged.

### 2.4 The IDE

The symbols document's chip row shows the three built-ins, then every
named state, then a `+` chip that asks for a name (refused names are the
host's message); a named state is removed from the properties panel
("Remove state"). Drop onto a named chip works as onto `win`. Preview per
state already takes a name.

## 3. N5 — `count`

A flow-fx kind:

```yaml
- { id: tally, kind: count, props: { target: base_game/win, from: '0', to: '$result.winAmount', ms: 800, easing: easeOutQuad, format: currency, wait: true } }
```

- `target` — `<scene>/<node>`, must be a node with a `text` prop (else
  `count: <target> has no text prop`, `next`).
- `from`/`to` — literal, `$expr` or template (`resolveValue`); `from` default
  `'0'`; a non-number → the node's `is not a number` diagnostic, `next`.
- `format` — `''` (plain `String(n)`), `currency`, `int`, `fixed:N`,
  `multiplier` — the pipe formats, through `formatValue(name, value, arg,
  vars)` exported from `@energy8engine/flow` (the `expr.ts` `format`
  refactored out; `currency` reads `$session.currency` from `vars`).
- Each tick writes `scenes.setProps(ref, { text })`; the final value is
  written last, exactly. `wait: false` leaves at once. `ui.skip` jumps to
  the end; `stop()` (signal) kills the tween and writes nothing more.
- Tempo: no turbo halving (the flow author picks `ms`).

## 4. Contracts summary

- `protocol.ts`: `SymbolNode` unchanged; `SymbolDef.states?`; `SymbolState
  = string` with the three literals documented.
- `presentation.ts`: `PlayStateStep`; `KNOWN_STEP_KINDS` = six.
- scenes: `mountCell`, `CellMount`, `cellProps` exported from
  `common-schema`/`node-types` (pixi-free half in `common-schema`).

## 5. Not here

- Children on a `SymbolNode` (A of the N1 choice).
- Per-cell overlays drawn by the reels board (the cell scene IS the overlay).
- A `revealWins { state }` variant (`playState` covers it).
- Turbo/skip inside a cell scene's media (`once` runs at its own pace).
- Count-up for the shell's WIN readout (the shell counts on its own).

## 6. Tests

- contracts: `PlayStateStep` in `isPresentationStep`; `KNOWN_STEP_KINDS`
  has six.
- scenes: `cellProps` (bound keys, `emptyProp` without data, typed values);
  `mountCell` binds roots and children, `bind` re-resolves only bound
  props, `once` awaits media nodes, `destroy` tears down; an ordinary mount
  with a `$cell` prop mounts at the empty value.
- symbols: a `scene` state mounts through `mountCell`, `bind` reaches it,
  its assets join the preload; `playState` for a named state (mount, once,
  back to rest), replacing a playing one, unknown state → resolved + one
  `info`; `playWin` still works; `states` parsed.
- reels: `playState` step → `view.playState` per cell, `wait: false`
  returns early, skipped cells, `skip()` collapses.
- flow-fx: `count` ticks through a fake tween, formats, final value exact,
  `wait: false`, `ui.skip` → end, abort → silence, non-text target refused.
- ide-host: symbols check (`scene` state → unknown scene; bad state names);
  scenes check accepts `$cell` in a cell scene, refuses it elsewhere with
  the new wording; re-check on the other document's change.
- ide-client: `symbols-doc` helpers (`addState`, `removeState`,
  `setState` on a named state); the chip row renders named states and `+`.
- e2e (`engine/apps/web/tests/e2e`): a project copy with a cell scene
  (`orb.scene.yml`: image + `text.text: '$cell.mv'`) as a symbol's `static`,
  a mechanic-free proof through the board: after a spin the cell's copy
  shows the bound value (a `BoardCell` with `mv` from a scripted result or
  the `probe-plugin` mechanic — the plan decides); a named state played
  through a plan step from the probe mechanic; `count` on the example's
  win text (the example's `show_win` becomes `count { to: '$result.winAmount',
  format: currency }` — `text.spec` case 1's final assertion holds).
