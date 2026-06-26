# Shell Keyboard Controls & Localization — Design

**Date:** 2026-06-26
**Status:** Approved (brainstorming) → ready for implementation plan
**Scope:** Applies to **both** game shells — the Pixi shell (`packages/pixi-shell/`) and the
renderer-agnostic DOM shell (`packages/platform-core/src/shell/`) — plus the Stake dev harness
(`packages/stake-kit/`) and the project scaffold (`packages/create-slot/`).

> Spec is written in English to match the codebase (CLAUDE.md, code comments, identifiers). The
> design dialogue happened in Russian; ask if a Russian copy is wanted.

---

## 1. Overview & goals

Four user-facing improvements, shipped as one coherent change set across both shells:

1. **Hold-to-spin** — holding `Space` keeps spinning continuously, gated so it never floods the
   server (each spin waits for the previous to finish).
2. **Hold-to-step bet** — holding the bet keys repeats the step with acceleration, instead of one
   press per click.
3. **Full hotkey scheme** — a documented set of keyboard shortcuts for every primary action, plus
   keyboard navigation **inside** every overlay/modal (pickers, Buy Bonus, Game Info scroll).
4. **Localization** — translate all built-in shell chrome into **16 languages**, and provide a
   mechanism for games to localize their own copy. The scaffold generates the i18n skeleton.

### Design invariants

- The two shells share **contracts** (`types.ts`, `state.ts`, `i18n.ts`, `pickers.ts`) by
  **duplication**, not cross-package imports (`pixi-shell` depends only on `pixi.js`). New shared
  logic follows the same pattern: duplicated modules kept in sync, guarded by a parity test.
- Behaviour parity between shells: every keyboard behaviour and every translated string behaves
  identically in Pixi and DOM.
- Backwards compatibility: existing `features.spacebar` keeps working; existing `t('English')`
  call sites keep working unchanged.

---

## 2. Part A — Keyboard controls

### A1. Shared `KeyboardController` (duplicated module)

New module `keyboard.ts`, duplicated in `packages/pixi-shell/src/` and
`packages/platform-core/src/shell/` (same duplication pattern as `state.ts`/`i18n.ts`/`pickers.ts`,
guarded by a byte-parity test).

It owns one `keydown` + one `keyup` listener on `document` (replacing the current inline
`handleKeyDown`/`onKeyDown`), all repeat timers, and the `spaceHeld` flag. It is driven through a
small host adapter the shell already exposes:

- read: `state` (mode/busy/autoplay/availableBets/bet), `config.features`, current top layer
- act: `emit(event)`, `stepBet`, `render`, layer accessors (`topLayer`, `closeLayer`),
  action openers (`openAutoplayPicker`/`stopAutoplay`, `openBuyBonus`, `openInfo`,
  `openMenu`/`openSettings`), `cycleTurbo`, mute toggle.

In Pixi it is wired through `ShellHost` (`context.ts`); in DOM through the `GameShell` instance.

**Global guards** (apply to every binding):
- Ignored when an editable element is focused (`INPUT`/`TEXTAREA`/`SELECT`/`contentEditable`).
- Master switch `features.hotkeys !== false` (default on). `features.spacebar === false` still
  independently disables `Space`.
- In `replay` mode all *play* actions (spin, bet, autoplay, buy, turbo) are inert; navigation keys
  (Esc, scroll, in-modal arrows) still work.
- When a layer (overlay/modal) is open, keys route to that layer first (see A5); only keys the
  layer does not consume fall through, and on the bar only `Esc`-class handling applies.

### A2. Hold-to-spin (`Space`)

- **Keydown, `!e.repeat`:** if allowed (base mode, `!busy`, `!autoplay.active`, no open layer,
  `features.spacebar !== false`) → `emit('spin')`, set `spaceHeld = true`, record `lastSpinAt`.
- **Re-fire on completion:** the game signals spin completion by calling `setBusy(false)`. The
  controller hooks that transition: if `spaceHeld` and still allowed → schedule the next
  `emit('spin')`, enforcing a **floor of 120 ms** since `lastSpinAt` (guarantees no flooding even
  for instant games that never set `busy`).
- **Keyup (`Space`):** `spaceHeld = false`.
- **Net behaviour:** tap = one spin (unchanged from today); hold = continuous spins, each waiting
  for the previous to finish. Disabled while autoplay is active or any layer is open. The current
  `e.repeat` no-op is replaced by this intentional hold behaviour.

### A3. Hold-to-step bet

- **Keys:** bet up = `ArrowUp` **with Shift**, `Equal` (`=`/`+`) with Shift, `NumpadAdd`; bet down
  = `ArrowDown` with Shift, `Minus` (`-`) with Shift, `NumpadSubtract`. (Modifier rule per A4.)
- **Press:** one `stepBet(dir)` immediately → `emit('betChange', next)` when it changes.
- **Hold:** repeat timer — initial delay **350 ms**, then every **90 ms**, accelerating to a
  **45 ms** floor after ~1 s held. Stops at min/max (no wrap).
- **Guards:** ignored while `busy` or a layer is open. Cleared on keyup / window blur.

### A4. Hotkey scheme (modifier rule)

Only `Space` and `Esc` are bare. **Every other bar action requires `Shift`.** Inside an open
modal, navigation keys are bare (a focused context — see A5).

| Keys | Action | Conditions |
|---|---|---|
| `Space` (hold) | Spin / continuous spin | base, idle |
| `Shift`+`↑` / `Shift`+`=` (hold) | Bet up | base, idle |
| `Shift`+`↓` / `Shift`+`-` (hold) | Bet down | base, idle |
| `Shift`+`A` | Autoplay: open picker / stop | base, autoplay feature on |
| `Shift`+`T` | Cycle turbo | `features.turbo > 0` |
| `Shift`+`B` | Buy Bonus | buyBonus enabled, base |
| `Shift`+`I` | Game Info (toggle) | always |
| `Shift`+`S` | Menu / Settings (toggle) | always |
| `Shift`+`M` | Mute toggle → `emit('settingChange', { key: 'muted', value: 'toggle' })` | always |
| `Esc` | Close top overlay/modal | a layer is open |

`NumpadAdd`/`NumpadSubtract` are accepted without Shift (dedicated keys, unambiguous).

### A5. In-modal keyboard navigation — `ShellLayer.onKey`

Add an optional hook to the layer contract (`ShellLayer` in Pixi `context.ts`; the equivalent
modal abstraction in DOM):

```ts
onKey?(e: KeyboardEvent): boolean; // return true if the layer consumed the key
```

The `KeyboardController` routes every keydown to the **top** layer's `onKey` first. If it returns
`true`, the key is consumed (and `preventDefault`'d). If not, `Esc` closes the layer as a fallback.
The controller provides hold-repeat for navigation keys (arrows, PageUp/PageDown) so layers get
repeat ticks while a key is held.

Because keys always go to the **top layer only**, the same bare arrows mean different things per
context — no conflicts:

- **Bet / Autoplay pickers** (`pickers.ts`): `←/→/↑/↓` (and `+/-`) move the highlighted chip
  (reusing the existing `selected` + `setSelected` visual); `Enter`/`Space` confirms (apply bet /
  start autoplay); `Esc` cancels. Add a focus/highlight index to `buildSheet` and implement
  `onKey` on the returned modal. Full keyboard path for autoplay: `Shift+A` → `←/→` → `Enter`.
- **Buy Bonus** (`BuyBonus.ts`) — one layer, two internal phases via `this.confirm`:
  - *Browse:* `←/→` (mobile `↑/↓`) move a keyboard highlight across bonus cards (reuse the
    `BonusCard` hover outline as the focus ring); `+/-` step the bet footer; `Enter` selects the
    highlighted card → `openConfirm`.
  - *Confirm:* `Enter` = Buy/Activate; `Esc` = back to browse (`removeConfirm`); second `Esc` =
    close. Full path: `Shift+B` → `←/→` → `Enter` → `Enter`.
- **Game Info & any `Overlay`-based screen** (`primitives/overlay.ts`, `ScrollBox`): scroll the
  body — `↑/↓` line (~60 px, hold-repeat), `PageUp/PageDown` page (~90% viewport), `Space` /
  `Shift+Space` page down/up, `Home/End` jump. Add `ScrollBox.scrollBy(dy, animated?)` if not
  already present (reuse the same offset + clamp the wheel/drag use). Mouse wheel and drag are
  unchanged.

DOM realization: the DOM shell tracks open modals in `modalHost`; each modal registers an `onKey`
handler, and `GameShell.handleKeyDown` routes to the top modal's handler — same logical contract,
DOM-native rendering.

### A6. Hotkeys legend — Game Info section `'hotkeys'`

The user wants a **separate block**, not annotations on the existing "Controls" rows. Add a new
built-in Game Info section type `'hotkeys'`, rendered by a new `sectionHotkeys` in both shells'
`GameInfo.ts` (alongside `modes`/`controls`/`paytable`/`wins`/`custom`).

- **Layout:** its own block, two columns — left: keycap-style chips; right: localized action name.
- **Auto-injection:** when `features.hotkeys !== false`, `buildBody` injects the section by default
  (ordered right after `controls`). A game may instead place it explicitly by adding
  `{ type: 'hotkeys' }` to its `gameInfo.sections` (then no auto-inject).
- **Feature-aware:** Turbo / Buy / Autoplay rows appear only when the matching feature is enabled.
- **Localized:** all action labels go through `t()` (Part B).
- The existing `controls` section ("what the buttons do") is left intact.

### A7. Config surface

- `ShellFeatures.hotkeys?: boolean` — master toggle, default `true`. Added to the shared
  `types.ts` in both shells.
- `features.spacebar?` retained as the Space-specific gate (back-compat).
- A configurable key map (`HotkeyMap`) is **out of scope** (YAGNI); the scheme is fixed for now.

---

## 3. Part B — Localization

### B1. Resolver (english-as-key) + `locales.ts`

Keep the contract that `t()` takes the **English source string**; only its implementation changes.
No call-site churn for strings already wrapped in `t()`.

- New data file `locales.ts`, **duplicated** in both shells (parity test enforces byte-identity).
  Shape — outer key = language, inner key = English source string:

  ```ts
  export type Lang =
    | 'de' | 'en' | 'es' | 'fi' | 'fr' | 'hi' | 'id' | 'ja'
    | 'ko' | 'pl' | 'pt' | 'ru' | 'tr' | 'vi' | 'zh' | 'da';

  // `en` omitted: the fallback returns the English source verbatim.
  export const LOCALES: Partial<Record<Lang, Record<string, string>>> = {
    ru: { Settings: 'Настройки', Spin: 'Спин', /* … */ },
    de: { /* … */ },
    // … 13 more
  };
  ```

- Extend `i18n.ts` (both shells) with:
  - `normalizeLang(code: string): Lang` — `pt-BR` → `pt`, case-insensitive, unknown → `en`.
  - `createI18n(opts: { language: string; isSocial?: boolean; messages?: Partial<Record<Lang, Record<string,string>>> }): { t(src: string): string }`
  - `t(src)` algorithm:
    1. `lang = normalizeLang(language)`
    2. if `lang === 'en'` → `isSocial ? socialize(src) : src`
    3. else → `messages?.[lang]?.[src] ?? LOCALES[lang]?.[src] ?? src`
       (game-supplied `messages` override/extend the built-ins; missing key falls back to the
       English source — partial translations degrade gracefully)
  - `socialize` is unchanged and stays **English-only** (see B5).

- `host.t` (`context.ts:43`) and `GameShell.t` (`GameShell.ts:173`) delegate to a resolver built
  from `config.language` / `config.isSocial`. Add `setLanguage(lang: string)` to both shells
  (rebuild resolver, `render()`, and re-open the active overlay so its strings refresh — mirrors
  the existing `setSocial`).

### B2. Language set, normalization & fonts

- **16 languages:** de, en, es, fi, fr, hi, id, ja, ko, pl, pt, ru, tr, vi, zh, da. **Arabic (`ar`)
  and all RTL work are out of scope** for this change.
- **Source of the active language:** `config.language` (already threaded from SDK
  `initData.config.language`, and from the harness `lang` query param in `stake-kit`). Unknown
  codes fall back to `en` via `normalizeLang`.
- **Fonts / scripts (known caveat):** the bundled Inter covers Latin + Cyrillic, so the 12
  Latin/Cyrillic languages render fully in both shells. For `ja`/`ko`/`zh` (CJK) and `hi`
  (Devanagari): the DOM shell uses native browser font fallback (fine); the Pixi shell relies on
  the canvas system-font fallback for those glyphs (Inter lacks them). Full CJK/Devanagari font
  files are **not bundled** (multi-MB). This is an accepted, documented limitation — text renders
  via the player's system fonts on those scripts.

### B3. Shell-chrome migration

Most chrome already flows through `t()`. Wrap the few strings that currently bypass it so they
localize, in both shells:

- Pixi `GameInfo.ts:198-209` — control `name`/`desc` literals (currently passed straight into
  `CtlRow`); the DOM `GameInfo.ts` control descriptions likewise.
- Stray attributes/labels (e.g. the `aria-label: 'Sound'` in DOM `Settings.ts`).

Every chrome string used as a `t()` argument is added to `locales.ts` for all 15 non-en languages,
including the new "Hotkeys" block labels from A6.

### B4. Game-authored content mechanism

Game copy (gameInfo sections, `bonus.title`/`description`, `mode.title`, symbol names, custom HTML)
is rendered by the shell **directly** and is owned by the game, not the shell catalog. Wire it up
at the game-engine host layer:

- The `t` already passed into `gameInfo: (t) => GameInfoContent` (`game-engine` host,
  `shellConfig.ts:348`) becomes the **same resolver**, but over a **merged catalog** =
  shell built-ins + the game's `messages`.
- Add `i18n?: Partial<Record<Lang, Record<string, string>>>` to the `createSlotGame` config (and a
  matching optional field surfaced from the game project). The host:
  1. builds the resolver from `initData` language + merged `i18n`;
  2. resolves `gameInfo(t)`;
  3. resolves **spec-driven** strings — action `title`/`description`, mode titles, symbol
     names — through the same `t()` **before** constructing the shell config, so the shell renders
     them translated even though it draws them directly.
- `game.spec.ts` stays the **English source of truth**; translations live only in the `i18n` map
  (English string = key). `socialize` still applies for `en` social mode.

### B5. `socialize` × translations

`socialize()` stays **English-only** and applies only when the resolved language is `en` and
`isSocial` is set. For other languages the provided translation is used as-is; social-compliant
wording for non-English must be authored into the translations themselves. Documented limitation;
no per-language social variants in this change.

### B6. Runtime switching & harness

- `setLanguage(lang)` on both shells enables live switching (used by the harness and available to
  games).
- **Harness language selector:** add a language dropdown (16 entries) to the Stake harness control
  bar UI in `stake-kit` (the bar UI component; `harness/bar.ts` stays pure helpers). Switching
  rebuilds the launch URL `lang` param / calls `setLanguage`, so a developer can spot-check every
  locale.

### B7. Scaffold (`create-slot`)

- Generate `src/i18n.ts` in the new project: an `i18n` map with `en` populated from the spec
  (action titles/descriptions, gameInfo copy) and the other 15 languages stubbed (empty objects
  with a TODO comment / `en` fallback).
- Generated `main.ts` passes `i18n` into `createSlotGame`; generated `gameInfo` wraps its copy in
  `t(...)`.
- Generated `CLAUDE.md` documents "how to add/curate a language".

---

## 4. Data flow (localization)

```
initData.config.language ─┐
config.isSocial ──────────┤
game i18n map ────────────┤→ createI18n({language, isSocial, messages}) → t(src)
LOCALES (shell built-ins) ┘                                                  │
                                                                             ├─ shell chrome: host.t('Settings') → 'Настройки'
                                                                             ├─ gameInfo(t): t('How to Play')
                                                                             └─ host pre-resolves spec title/desc/symbol names → shell renders translated
```

## 5. Testing

- **KeyboardController:** hold-to-spin re-fires only after `setBusy(false)` and respects the 120 ms
  floor; hold-bet repeat fires with delay→interval→accel and clamps at min/max; Shift gating; guards
  (editable focus, replay, layer open, `features.hotkeys`/`spacebar`). Both shells.
- **`onKey` routing:** keys go to the top layer; picker arrow-nav + Enter/Esc; Buy Bonus two-phase;
  Overlay scroll. Both shells.
- **i18n resolver:** fallback chain (`pt-BR`→`pt`→`en`), missing key → English source, `socialize`
  only for `en`, game `messages` override built-ins.
- **Parity test:** the two `locales.ts` (and the two `keyboard.ts`) are byte-identical.
- **Smoke:** a shell renders a non-en language (e.g. `ru`) without throwing; the Hotkeys section
  appears when `features.hotkeys !== false` and hides feature rows that are off.

## 6. Out of scope

- Arabic (`ar`) and all RTL layout/mirroring.
- Bundling CJK/Devanagari fonts (system fallback only).
- User-configurable key map (`HotkeyMap`).
- Per-language *social* vocabulary variants (socialize stays English-only).

## 7. Affected files (map)

- **Both shells** (`packages/pixi-shell/src/`, `packages/platform-core/src/shell/`):
  - new `keyboard.ts` (duplicated) — controller
  - new `locales.ts` (duplicated) — translation data
  - `i18n.ts` — add `Lang`, `normalizeLang`, `createI18n` (keep `socialize`)
  - `types.ts` — `ShellFeatures.hotkeys?`, Game Info `'hotkeys'` section type, `ShellLayer.onKey?`
  - `context.ts` (Pixi) / `GameShell.ts` (DOM) — `t` delegates to resolver, `setLanguage`,
    remove inline keydown in favour of the controller
  - `components/pickers.ts` — highlight index + `onKey`
  - `components/BuyBonus.ts` — keyboard highlight + two-phase `onKey`
  - `components/GameInfo.ts` — wrap stray strings, `sectionHotkeys`, auto-inject
  - `primitives/overlay.ts` + `primitives/scroll.ts` (Pixi) / DOM equiv — `onKey` scroll,
    `scrollBy`
- **game-engine host:** `src/host/shellConfig.ts` — merged-catalog resolver, resolve spec strings;
  `createSlotGame` config gains `i18n`.
- **stake-kit:** harness bar UI — language dropdown.
- **create-slot:** new `template`/codegen for `src/i18n.ts`, `main.ts` wiring, `CLAUDE.md` docs.

## 8. Implementation phases (for the plan)

1. **i18n core** — `Lang`/`normalizeLang`/`createI18n` + `locales.ts` (en + key list first), `t`
   delegation, `setLanguage`, parity test. (No visible change yet; en behaves as today.)
2. **Chrome translations** — populate 15 languages; wrap stray strings; smoke a non-en render.
3. **KeyboardController** — extract controller, hold-to-spin, hold-bet, Shift scheme, config
   toggle; both shells; tests.
4. **`onKey` navigation** — layer hook + routing; pickers, Buy Bonus, Overlay scroll; tests.
5. **Hotkeys legend** — `'hotkeys'` section + auto-inject, localized.
6. **Game content i18n** — host merged catalog, spec-string resolution, `createSlotGame.i18n`.
7. **Harness** — language dropdown.
8. **Scaffold** — generate `src/i18n.ts` + wiring + docs.
