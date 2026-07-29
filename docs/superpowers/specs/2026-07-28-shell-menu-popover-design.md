# Shell menu: tooltip popover + configurable items

**Date:** 2026-07-28
**Package:** `@energy8platform/shell` (both renderers), with follow-on touches in `@energy8platform/game-engine` and the examples.

## Problem

The burger button on the control bar calls `openMenu()`, which emits `menuOpen` and immediately opens
the **full-screen Settings overlay** — a frosted, game-covering layer holding a sound toggle, three
volume sliders and a "Game info" row. Two problems:

1. **Weight.** A full-screen modal for four rows. It hides the game to change the music volume.
2. **Fixed content.** The rows are hard-coded twice — once in
   `src/ui/html/components/Settings.ts`, once in `src/ui/pixi/components/Settings.ts`. A game cannot
   add an entry, remove one, or reorder them, and the two copies have already drifted (the DOM
   Game-info row is a `<button>`, the Pixi one is a hover-styled glass row).

## Goals

- The burger opens a **compact popover placed against the bar** ("tooltip menu"), not a full-screen
  overlay. Same behaviour in wide and mobile layouts, in both renderers.
- The popover **replaces** the Settings overlay — sliders and all live inside it. The Settings
  overlay is deleted.
- Menu content is **declared as a list**, like `gameInfo.sections`: a built-in `id` selects a preset,
  otherwise `type` says how to render a custom row.
- Item values live in **shell state**, seeded from the declared list, readable and writable at
  runtime, with an open popover updating live.
- Three volume sliders become **two**: `music` and `sfx`. `master` is removed.

## Non-goals

- No custom icon assets. `icon` is a name from the shell's built-in glyph set (both renderers
  resolve the same 24×24 fragments). Game-supplied SVG is deferred.
- No submenus / nested popovers. A `button` item runs a callback; a game that wants a deeper UI
  opens its own overlay from the callback.
- No change to the bar layout, the other overlays (game info, buy bonus, pickers, modals), or the
  keyboard model beyond the menu entry itself.

## Approach

**The menu model lives in `core`; renderers only draw rows.**

`core/menu.ts` owns the item types and `resolveMenu(host)`, which expands presets into normalized
render descriptors — kind, translated label, icon, `get()`, `set(v)`, `onSelect()`. Both renderers
consume the same array and never re-implement what `sound` or `gameInfo` mean. Preset semantics are
written once, DOM/Pixi parity comes nearly for free, and the model is testable in `tests/core` with
no DOM and no Pixi.

Rejected: keeping only types in core and the preset semantics in each renderer (that is exactly the
duplication that let the two `Settings.ts` copies drift); and a standalone menu module with its own
store (a second source of truth next to `soundOn` / `state.volumes`).

## Public API

### Types (`core/menu.ts`)

```ts
/** Built-in presets: the id alone is enough — the shell knows the label, icon and behaviour. */
export type MenuPresetId = 'sound' | 'music' | 'sfx' | 'gameInfo';

interface MenuItemBase {
  id: string;
  /** Overrides the preset/default label. Run through the shell translator. */
  label?: string;
  /** A glyph from the shell's built-in icon set. */
  icon?: IconName;
  disabled?: boolean;
}

export type MenuItem =
  // preset — selected by id, no `type`
  | ({ id: MenuPresetId } & Omit<MenuItemBase, 'id'>)
  // custom — selected by `type`
  | ({ type: 'toggle'; value?: boolean; onChange?(v: boolean): void } & MenuItemBase)
  | ({ type: 'range'; min?: number; max?: number; step?: number; value?: number;
       /** Right-hand readout. Defaults to percent for a 0..1 range, else the raw number. */
       format?(v: number): string; onChange?(v: number): void } & MenuItemBase)
  | ({ type: 'button'; chevron?: boolean; onSelect?(): void } & MenuItemBase)
  | { type: 'separator' };
```

`range` defaults: `min = 0`, `max = 1`, `step = (max - min) / 20`. For an omitted range that is
`0 / 1 / 0.05` — exactly today's volume slider, so a custom 0..1 slider needs no numbers at all —
and a declared `min: 1, max: 5` gets `0.2` rather than a nonsensical `0.05`.

### Icon names

`icon` needs a name type both renderers accept, and core cannot import from `ui/`. Today each
renderer's generated `icons.ts` declares its own `IconName = keyof typeof SVGS`, which — because
`SVGS` is typed `Record<string, string>` — is just `string`; an unknown name silently renders an
empty glyph in the DOM and **throws** in Pixi (`SVGS[name].split` on `undefined`).

`scripts/gen-icons-from-svg.mjs` gains one more output, `src/core/icon-names.ts`:

```ts
export const ICON_NAMES = ['spin', 'turbo1', … ] as const;
export type IconName = (typeof ICON_NAMES)[number];
```

Both renderer `icons.ts` files re-export `IconName` from it instead of deriving their own, so the
union is real everywhere and core can both type and validate `MenuItem.icon`. `resolveMenu` drops an
icon that is not in `ICON_NAMES` (row still renders, without a glyph) rather than letting it reach
Pixi.

### Config

```ts
interface ShellConfig {
  …
  /** Bar-menu items, in order. Omit for the default list. */
  menu?: MenuItem[];
}
```

Default when `menu` is omitted — today's Settings content minus `master`:

```ts
const DEFAULT_MENU: MenuItem[] = [
  { id: 'sound' }, { id: 'music' }, { id: 'sfx' },
  { type: 'separator' },
  { id: 'gameInfo' },
];
```

Example with custom entries:

```ts
createGameShell({
  …,
  menu: [
    { id: 'sound' },
    { id: 'music' },
    { id: 'sfx' },
    { type: 'separator' },
    { id: 'gameInfo' },
    { id: 'lefty', type: 'toggle', label: 'Left-hand mode',
      value: false, onChange: (v) => layout.mirror(v) },
    { id: 'speed', type: 'range', label: 'Reel speed', min: 1, max: 5, step: 1,
      value: 2, format: (v) => `×${v}`, onChange: (v) => reels.setSpeed(v) },
    { id: 'paytable', type: 'button', label: 'Paytable', icon: 'ticket',
      chevron: true, onSelect: () => openPaytable() },
  ],
});
```

### Runtime methods on `ShellController`

| method | behaviour |
| --- | --- |
| `setMenu(items: MenuItem[])` | Replaces the list; an open popover rebuilds. Values of ids already in state are **kept**; new ids are seeded from their `value`. |
| `getMenuValue(id): boolean \| number \| undefined` | One accessor for presets and custom items alike. `undefined` for unknown ids and for `button` / `separator`. |
| `setMenuValue(id, v)` | Clamps a range to `[min, max]`, stores, calls the item's `onChange`, emits `settingChange`, and live-updates an open popover. |
| `openMenu()` | Opens the popover; **called again while the menu is open, it closes it** (the burger toggles). |
| `closeModal()` | Unchanged — closes whatever layer is open, menu included. |

`setSound` / `getVolume` / `setVolume` stay as thin aliases over the same state; games already call
them. `settingChange { key, value }` is emitted for every item, preset and custom, with `key` = the
item id — so [`createSlotGame`'s handler](../../../packages/game-engine/src/host/createSlotGame.ts)
keeps working, and a game handles its own custom ids in the same switch.

## Core model

### `resolveMenu(host): MenuRow[]`

```ts
export type MenuRow =
  | { kind: 'separator' }
  | { kind: 'toggle'; id: string; label: string; icon?: IconName; disabled: boolean;
      get(): boolean; set(v: boolean): void }
  | { kind: 'range'; id: string; label: string; icon?: IconName; disabled: boolean;
      min: number; max: number; step: number;
      get(): number; set(v: number): void; format(v: number): string }
  | { kind: 'button'; id: string; label: string; icon?: IconName; disabled: boolean;
      chevron: boolean; select(): void };
```

Labels come out already translated (`host.t`). Preset expansion:

| id | kind | label | icon | get / set | notes |
| --- | --- | --- | --- | --- | --- |
| `sound` | toggle | `Sound` | `soundOn` / `soundOff` (swaps with value) | `host.soundOn` / `host.setSound` | The icon reflects the value, as the Settings toggle does today |
| `music` | range 0..1 | `Music` | — | `host.getVolume('music')` / `setVolume` | percent readout |
| `sfx` | range 0..1 | `SFX` | — | `host.getVolume('sfx')` / `setVolume` | percent readout |
| `gameInfo` | button | `Game info` | `info` | — | `select()` → `host.actions.openInfo()`, `chevron: true` |

All four labels already exist in `core/locales.ts`. Custom rows take their label from `item.label`
(run through `host.t`, so a game i18n entry is honoured) and fall back to the id.

An item whose `id` is not a preset and which has no `type` is dropped from the resolved list and
reported once via `console.warn` — a typo in a preset id should be visible, not silent.

### State

```ts
interface ShellState {
  …
  volumes: { music: number; sfx: number };   // `master` removed
  /** Values of CUSTOM menu items, keyed by id. Seeded from the declared list at init and by
   *  setMenu() for ids it has not seen before. Preset values are NOT duplicated here. */
  menu: Record<string, boolean | number>;
}
```

`getMenuValue` / `setMenuValue` route by id so callers see one flat map:

- `sound` → `controller.soundOn` (via `setSound`, which keeps the `Shift+M` hotkey in sync)
- `music` / `sfx` → `state.volumes` (via `setVolume`, which clamps to 0..1)
- anything else → `state.menu`

The routing exists so the presets keep exactly one home. Duplicating volumes into `state.menu` would
give two values that can disagree; the accessor hides the difference from callers.

### Live updates

The two ad-hoc refreshers — `host.setSoundRefresh(fn)` and `host.setVolumeRefresh(fn)` — collapse
into one:

```ts
/** An open menu popover registers a row updater here (null clears it on close). */
setMenuRefresh(fn: ((id: string, value: boolean | number) => void) | null): void;
```

`setSound`, `setVolume` and `setMenuValue` all call it. `ShellRenderer.refreshSoundIcon?` is removed
— it is a documented no-op in both renderers today.

## Renderer contract

- `OverlayRequest` gains `{ kind: 'menu' }`. `{ kind: 'settings' }` is removed.
- **The plate and pointer are a renderer concern**: the DOM renderer reads the bar plaque's
  (`.ge-bar-panel` wide / `.ge-m-controls` mobile) and the burger's `getBoundingClientRect()`; the
  Pixi renderer asks its `BottomBar` for the same two rects (`menuPlate()` / `menuAnchor()`), plus its
  own fit-scale (`fitScale()`). Core stays geometry-free — `placePopover(plate, surface, size,
  pointer)` is pure math over whatever rects the renderer hands it.
- The controller tracks the open layer's kind (`private overlayKind: OverlayRequest['kind'] | null`)
  so `openMenu()` can toggle instead of re-opening.
- **Light dismiss.** The popover is not a frosted modal: no backdrop blur, no dim, no scene snapshot.
  A transparent full-surface layer sits under it and closes it on `pointerdown`; `Escape` closes it
  through the existing keyboard path (`hasOpenLayer()` → `onKey` returns false → `closeLayer`).
  While it is open, bar hotkeys stay suppressed exactly as they are for other layers.
- **No plate or pointer → centre.** If the bar is hidden (`setVisible(false)`) or neither the plaque
  nor the burger can be found, the popover centres itself on the surface rather than throwing.

### Geometry (identical in both renderers)

- Width: content-driven, clamped to `[220px, min(320px, surfaceWidth − 16)]`.
- Placement: driven by the bar's **plate** — the whole plaque (`.ge-bar-panel` wide / `.ge-m-controls`
  mobile), not the burger alone — so the card sits flush with the WHOLE bar rather than with whichever
  control opened it. The card's left edge is flush with the plate's left edge, then clamped to
  `[8, surfaceWidth − width − 8]`. If the space above is smaller than the popover's minimum height, it
  flips below the plate and the arrow flips with it. On mobile the plate's top edge is additionally
  extended upward to the popped-out SPIN/FS hero's true top (the hero is taller than its row and
  centred, so it overflows the row's own top edge) — otherwise the card's bottom clips the top of the
  hero's arc. A degenerate (fully zero-sized) plate falls back to the pointer, identically in both
  renderers.
- Arrow: 10px triangle centred on the **pointer**'s centre-x — the burger, which can sit anywhere
  inside the plate — clamped to stay ≥14px from either rounded corner. Falls back to the plate's own
  centre when no distinct pointer is given.
- Scale: the card carries the SAME scale factor the bar currently applies to itself
  (`HtmlRenderer.getBarScale()` / `BottomBar.fitScale()`), so its typography/padding/row-heights
  shrink in lockstep with the bar chrome on a small popout, instead of ignoring the viewport.
- Height: capped at the available space on the chosen side; the row list scrolls inside.
- Re-anchors (plate, pointer and scale, all re-resolved) on resize, and at the end of every
  `renderBar()` pass — not resize alone. `renderBar()` runs on ~20 state changes besides a resize
  (bet/win/turbo/mode/…), any of which can change the bar's own fit and leave an open card at a stale
  scale/position if only the resize hook repositioned it.

### DOM (`ui/html`)

- New `components/Menu.ts` builds the rows; new `createPopover()` in `primitives.ts` owns the shell
  (card, arrow, dismiss layer, positioning).
- Rows reuse the existing row language: `.ge-ov-row` for toggle/button rows, `.ge-ov-row.ge-col` +
  `.ge-slider` for ranges, `.ge-snd` for the sound icon button. New CSS is limited to the popover
  container (`.ge-popover`, `.ge-popover-arrow`, `.ge-popover-dismiss`) plus tighter row padding
  inside it.
- The popover mounts in the existing `modalHost`, so `closeOverlay()` (which clears that host) tears
  it down unchanged. It is not a `.ge-sheet`, so the SHEET fit-scale pass (`fitModals`/`fitSheet`)
  never touches it — instead the card carries the bar's own scale factor (`getBarScale()`), applied as
  a single `transform: scale()` alongside its measured position, so it shrinks in lockstep with the
  bar chrome rather than ignoring the viewport.

### Pixi (`ui/pixi`)

- New `primitives/popover.ts`: a rounded card + arrow drawn with `Graphics`, a `FlexBox` column of
  rows inside, and a transparent full-screen hit rect for dismissal. Implements `ShellLayer`
  (`resize`, `onKey`, `onRemove`).
- New `components/Menu.ts` builds rows from `MenuRow[]`, reusing `Slider`, `IconButton` and the
  glass-row visuals lifted out of the deleted `components/Settings.ts`.
- `PixiRenderer.pushLayer(node, opts?: { backdrop?: boolean })` — the menu passes `backdrop: false`
  so no `RenderTexture` snapshot / blur is taken. Every other layer keeps today's behaviour.
- `BottomBar` exposes three lazily-resolved accessors, each re-read on every reposition rather than
  captured once (`renderBar()` destroys and rebuilds the whole bar on every resize and ~20 other state
  changes): `menuAnchor(): { x: number; y: number; w: number; h: number } | null` — the burger's
  global rect, the arrow's POINTER; `menuPlate()` — the same shape for the plaque's (wide panel /
  mobile controls row) global rect, which drives PLACEMENT; and `fitScale(): number` — the same
  `inner.scale.x` the bar renders itself with, which the popover card matches. All three return a
  neutral fallback (`null` / `null` / `1`) once the bar is destroyed, rather than throwing.

## Migration

| change | handling |
| --- | --- |
| `VolumeKey` loses `'master'` | `VolumeKey = 'music' \| 'sfx'`; `ShellConfig.volumes` narrows with it. Only the shell's own tests referenced `master`. |
| `case 'master'` in `createSlotGame` | Removed — dead once the shell stops emitting it. `AudioManager.setMasterVolume` stays (games may call it directly). |
| `openSettings()` | Kept as a `@deprecated` alias for `openMenu()`. |
| `settingsOpen` event | Kept in `ShellEvents` and still emitted by `openSettings()`, marked deprecated. `openMenu()` emits only `menuOpen`. Both demos listen to it. |
| `{ kind: 'settings' }`, `components/Settings.ts` ×2 | Deleted. |
| `setSoundRefresh` / `setVolumeRefresh` / `refreshSoundIcon` | Replaced by `setMenuRefresh`. |
| `IconName` in both `icons.ts` | Re-exported from the new generated `core/icon-names.ts`; regenerate with `node scripts/gen-icons-from-svg.mjs`. |
| `examples/shell-demo`, `examples/pixi-shell-demo` | `?open=settings` maps to the menu; add a couple of custom items so the demo exercises `range` / `toggle` / `button`. |
| package version | Minor bump on `@energy8platform/shell` (0.x, so the narrowed `VolumeKey` and dropped Settings overlay ride a minor). |

## Testing

New and reworked suites, all runnable via `npm test --workspace @energy8platform/shell`:

- `tests/core/menu.test.ts` — preset expansion (labels, icons, get/set wiring); custom item
  defaults (`range` 0..1/0.05, `step` from the declared span, percent vs `format`); unknown-id drop
  + warn; unknown icon dropped; `setMenu` keeps known values and seeds new ones;
  `getMenuValue`/`setMenuValue` routing for `sound` / `music` / custom; range clamping;
  `settingChange` payloads.
- `tests/html/icons.test.ts` — extended: every name in `ICON_NAMES` resolves in both renderers
  (the guard that makes `MenuItem.icon` safe).
- `tests/core/controller.test.ts` — `openMenu()` toggles (second call closes); `openSettings()`
  still opens the menu and emits `settingsOpen`.
- `tests/html/menu.test.ts` — rewritten: popover rows in declared order, custom kinds render, placed
  above the bar's plate and clamped inside the root with the arrow on the burger, click-outside and
  `Escape` close, the `gameInfo` row opens the info overlay, live update from `setMenuValue` while
  open.
- `tests/html/shell-volume.test.ts` — retargeted to the two sliders inside the popover.
- `tests/pixi/menu.test.ts` — popover opens as a layer with **no backdrop node**, rows match the
  model, `menuPlate()`/`fitScale()` position and scale it, `menuAnchor()` aims the arrow, dismiss layer
  closes it.
- `tests/pixi/parity.test.ts` — extended with a menu-model parity assertion: both renderers render
  one row per resolved `MenuRow`, in the same order.

Manual check, per the repo's screenshot workflow (puppeteer Chromium, `vite --force` after a
rebuild): `examples/shell-demo` and `examples/pixi-shell-demo` in both wide and portrait, popover
open, one custom row of each kind.
