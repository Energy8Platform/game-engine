# Preview and canvases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Preview with refresh and harness-style balances, and Symbols/Reels canvases that work in any project, report what goes wrong, and show a filled board without a Spin.

**Architecture:** The Preview keeps its one iframe; a local refresh counter joins the iframe key, the balance becomes a level `<select>` and a wallet number travels in the game's address, which session-host folds into its `sessionStorage` wallet key. scene-edit resolves its mode from the page's own address whenever the project leaves it out; reels mode fills an empty board with a lab spin skipped to its end. The Reels and Symbols documents surface canvas `error` events and a canvas that never answers.

**Tech Stack:** React 18 + vitest/testing-library (`engine/ide/client`), cordis 4 plugins (`engine/game/*`), Pixi v8, Playwright (`engine/apps/web`).

**Spec:** `docs/superpowers/specs/2026-09-28-preview-and-canvases-design.md`

## Global Constraints

- `packages/*` is not edited (reading is fine). No `@energy8platform/game-engine` under `engine/`. Every change carries a test in its package.
- A project's existing `editor.ts` keeps working unchanged: whatever it passes to scene-edit still wins.
- `engine/examples/first-slot` and `engine/templates/slot-basic` stay byte-identical where they are today (`cmp` their `src/editor.ts`).
- Balance levels, verbatim from the harness (major units, label): 1 `1`, 10 `10`, 100 `100`, 1 000 `1K`, 10 000 `10K`, 100 000 `100K`, 1 000 000 `1M`, 10 000 000 `10M`, 100 000 000 `100M`, 1 000 000 000 `1B`, 10 000 000 000 `10B`. Default 10 000.
- Wallet key: `e8:wallet:<gameId>:<balance>:<currency>:<wallet>`; with no `wallet` in the page address the key is today's `e8:wallet:<gameId>:<balance>:<currency>`.
- Canvas silence: no `ready` within 10 000 ms of the canvas mounting → the status says the canvas did not answer.
- One workspace per test command (`npm test -w <name>` from the repo root); `@energy8engine/ide-host` ALONE. Playwright ALONE from `engine/apps/web`: `E8_E2E_HOST_PORT=5779 npx playwright test <files>`.
- NEVER `git stash`/`checkout`/`restore`/`reset` — baseline via `git show HEAD:<path> > <scratch file>`. Never kill a process you did not start. Never touch `engine/examples/paper-duel`.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Never stage `packages/*`, `engine/apps/web/dist`, `engine/examples/first-slot/concept.png`, `engine/examples/paper-duel`, `docs/superpowers/notes/2026-09-19-paper-duel-port-feasibility.md`.

## Review Focus

1. **Picking a level, then refreshing twice**: the balance left after spins survives both refreshes (the wallet number did not move); a pick of the SAME level through `↺` is a full balance again. Pinned in Task 2 (address) and Task 6 (e2e).
2. **An old `e8.preview` in localStorage** (`balance: '250'`, `''`, `'1000'`, no `wallet`): the toolbar loads without throwing — `'1000'` keeps 1K, anything not a level is 10K, `wallet` 0. Pinned in Task 2.
3. **A project whose `editor.ts` passes `scene: ''` and `symbol` but no `reels`** (paper-duel's shape) opened as `editor.html?reels=`: reels mode, not scene mode. Pinned in Task 3.
4. **A board that fills while the user presses Spin at once**: the fill and a lab action never run together (`busy` serialises them), and a board already showing symbols is never refilled. Pinned in Task 4.
5. **A canvas that errors and then answers `ready` on a later remount**: the old error/silence status does not stick over a working canvas. Pinned in Task 5.

---

### Task 1: session-host — the wallet number is part of the wallet key

**Files:**
- Modify: `engine/game/session-host/src/index.ts` (`walletStore` ~129-148 and its call ~181; module doc ~20-40)
- Test: `engine/game/session-host/tests/session.test.ts` (the `session-host — the wallet survives a reload` describe, ~275)

**Interfaces:**
- Consumes: nothing new.
- Produces: the page's `?wallet=<n>` (read from `config.search ?? location.search`) becomes the key's last segment; `sessionQuery` still forwards only `lang, currency, balance, social, device` (the host is not told `wallet`).

- [ ] **Step 1: Failing tests** in the wallet describe (reuse its `fake` storage, `withGameId`, `boot`, `fakeFetch`, `INIT`; `boot` takes the config — read how the existing `search: '?currency=JPY&balance=7'` test at ~260 passes `search`):
  - `search: '?wallet=3'` → after one play the store holds `e8:wallet:first-slot:${INIT.balance}:${INIT.currency.code}:3` = `'1001'`;
  - a stored `…:3` of `'250'` wins on a load with `?wallet=3`; the same stored value is ignored on a load with `?wallet=4` (the play answers `1001`);
  - no `wallet` in the address → today's key (the existing tests stay green unchanged);
  - `sessionQuery('?wallet=3&balance=7')` is `'?balance=7'`.
- [ ] **Step 2:** `npm test -w @energy8engine/session-host` — the new ones FAIL.
- [ ] **Step 3: Implement.**

```ts
function walletStore(gameId: string | undefined, init: SessionInit, wallet: string | null) {
  try {
    if (!gameId || typeof sessionStorage === 'undefined') return undefined;
    const key = `e8:wallet:${gameId}:${init.balance}:${init.currency.code}${wallet === null ? '' : `:${wallet}`}`;
    // …read/write unchanged
```

and at the call site: `const store = walletStore(gameId, init, new URLSearchParams(search).get('wallet'));`. Add one paragraph to the module doc: the Preview's wallet number (slice 43) — every balance pick or `↺` bumps it, so the same seed can start a fresh wallet; a refresh keeps it, so it keeps the wallet.
- [ ] **Step 4:** `npm test -w @energy8engine/session-host`, `npm run typecheck -w @energy8engine/session-host` — PASS / 0.
- [ ] **Step 5: Commit** — `Session host: the Preview's wallet number picks the wallet, so a pick starts a fresh one and a refresh keeps it`.

---

### Task 2: Preview — refresh, balance levels, a wallet number

**Files:**
- Create: `engine/ide/client/src/screens/balanceLevels.ts`
- Modify: `engine/ide/client/src/screens/Preview.tsx`
- Modify: `engine/ide/client/src/styles.css` only if the new buttons need spacing (reuse the toolbar's existing rules first)
- Test: `engine/ide/client/tests/preview.test.tsx`

**Interfaces:**
- Consumes: Task 1's contract (`?wallet=<n>` in the game address).
- Produces: `PreviewState` = `{ preset: string; rotated: boolean; lang: string; currency: string; balance: number; wallet: number; social: boolean }`; `DEFAULT_PREVIEW_STATE.balance = 10_000`, `.wallet = 0`; `previewAddress(base, s)` always sets `balance=<s.balance>` and `wallet=<s.wallet>`; test ids `preview-refresh` (`aria-label="refresh"`), `preview-balance` (the `<select>`, label `balance`), `preview-balance-reset` (`aria-label="reset balance"`). `validBalance` is removed.

- [ ] **Step 1: Failing tests** in `preview.test.tsx` (read its harness at the top: how it renders `Preview`, fakes the workspace and `gameComposition`, and reads the iframe):
  - `previewAddress`: default state → `balance=10000` and `wallet=0` present; `{ balance: 100, wallet: 3 }` → `balance=100`, `wallet=3`. Replace the test "carries lang and currency always, and nothing else by default" with this shape (lang, currency, balance, wallet always).
  - `readPreviewState` (Review Focus 2): stored `{ balance: '1000' }` → 1000; `{ balance: '250' }` → 10 000; `{ balance: '' }` → 10 000; `{ balance: 100 }` → 100; `{ wallet: 5 }` → 5; `{ wallet: -1 }`, `{ wallet: 1.5 }`, `{ wallet: 'x' }` → 0.
  - The balance `<select>` lists exactly the eleven labels in order, `10K` selected by default; choosing `1K` relaunches (a NEW iframe element) with `balance=1000` and `wallet=1`.
  - `↺` (`preview-balance-reset`) relaunches with the same `balance` and `wallet` + 1.
  - `↻` (`preview-refresh`) remounts the iframe (a new element) and its `src` is byte-identical to before; a second click remounts again.
  - Accessible names: `getByLabelText('balance')` is the select; `getByRole('button', { name: 'refresh' })`, `getByRole('button', { name: 'reset balance' })` exist.
  - Delete the two free-text balance tests ("an invalid balance marks the field invalid…", "a valid balance committed with Enter…"); update "the toolbar choice is remembered across a remount" to pick a level.
- [ ] **Step 2:** `npm test -w @energy8engine/ide-client -- preview` — the new ones FAIL.
- [ ] **Step 3: Implement.**

`balanceLevels.ts`:

```ts
/**
 * The legacy harness's balance levels (`packages/harness/src/plugin.ts`,
 * `BALANCE_LEVELS` — major units), PINNED here: that constant is not
 * exported, and `packages/*` is read-only. Keep it equal by hand.
 */
export const BALANCE_LEVELS: readonly { value: number; label: string }[] = [
  { value: 1, label: '1' },
  { value: 10, label: '10' },
  { value: 100, label: '100' },
  { value: 1_000, label: '1K' },
  { value: 10_000, label: '10K' },
  { value: 100_000, label: '100K' },
  { value: 1_000_000, label: '1M' },
  { value: 10_000_000, label: '10M' },
  { value: 100_000_000, label: '100M' },
  { value: 1_000_000_000, label: '1B' },
  { value: 10_000_000_000, label: '10B' },
];

export const isBalanceLevel = (n: number) => BALANCE_LEVELS.some((l) => l.value === n);
```

`Preview.tsx`:
- `PreviewState.balance: number` (a level), new `wallet: number` (a non-negative integer); defaults `10_000` and `0`.
- `previewAddress`: replace the balance line with `url.searchParams.set('balance', String(s.balance)); url.searchParams.set('wallet', String(s.wallet));`.
- `readPreviewState`: `const n = Number(stored.balance); balance: Number.isFinite(n) && isBalanceLevel(n) ? n : d.balance` (a string `'1000'` or a number `1000` both load); `wallet: Number.isInteger(stored.wallet) && (stored.wallet as number) >= 0 ? stored.wallet : d.wallet`.
- Remove `validBalance`, `draft`, `invalid`, `commitBalance`.
- `const [refreshes, setRefreshes] = useState(0);` — the iframe key becomes `` `${reloads}:${refreshes}:${active}:${src}` ``. Extend the component's doc comment: refresh is a relaunch at the same address, so the wallet (keyed by the address's `balance`/`currency`/`wallet`) survives it.
- Toolbar: after `Rotate`, a `<button type="button" data-testid="preview-refresh" aria-label="refresh" title="refresh" onClick={() => setRefreshes((n) => n + 1)}>↻</button>`. The balance becomes:

```tsx
<label htmlFor="preview-balance">balance</label>
<select
  id="preview-balance"
  data-testid="preview-balance"
  value={String(state.balance)}
  onChange={(event) => update({ balance: Number(event.target.value), wallet: state.wallet + 1 })}
>
  {BALANCE_LEVELS.map((l) => (
    <option key={l.value} value={String(l.value)}>
      {l.label}
    </option>
  ))}
</select>
<button
  type="button"
  data-testid="preview-balance-reset"
  aria-label="reset balance"
  title="reset balance"
  onClick={() => update({ wallet: state.wallet + 1 })}
>
  ↺
</button>
```

- [ ] **Step 4:** `npm test -w @energy8engine/ide-client`, `npm run typecheck -w @energy8engine/ide-client` — PASS / 0.
- [ ] **Step 5: Commit** — `Preview: a refresh button, and balances like the harness — a level list where every pick is a fresh wallet`.

---

### Task 3: scene-edit — the canvas finds its own mode in the page address

**Files:**
- Modify: `engine/game/scene-edit/src/index.ts` (`SceneEditConfig` ~41-68, `apply` ~164-196)
- Modify: `engine/examples/first-slot/src/editor.ts`, `engine/templates/slot-basic/src/editor.ts` (byte-identical)
- Test: `engine/game/scene-edit/tests/plugin.test.ts` (read how it boots the plugin with `post`/`listen` fakes)

**Interfaces:**
- Consumes: nothing new.
- Produces: `SceneEditConfig.scene?`, `.parentOrigin?` become optional; new test seams `search?: string` and `referrer?: string` ("Tests only; the page's own `location.search` / `document.referrer` otherwise"). Exported pure helper:

```ts
/** What the page asks for — the project's config first, the page's own address for whatever it left out (slice 43). */
export function pageMode(
  config: Pick<SceneEditConfig, 'scene' | 'symbol' | 'reels' | 'parentOrigin'>,
  search: string,
  referrer: string,
): { scene: string; symbol: string | undefined; reels: boolean; parentOrigin: string } {
  const p = new URLSearchParams(search);
  return {
    scene: config.scene || (p.get('scene') ?? ''),
    symbol: config.symbol !== undefined ? config.symbol : p.has('symbol') ? p.get('symbol')! : undefined,
    reels: config.reels !== undefined ? config.reels : p.has('reels'),
    parentOrigin: config.parentOrigin ?? (referrer ? new URL(referrer).origin : '*'),
  };
}
```

- [ ] **Step 1: Failing tests** (`plugin.test.ts`, a new `describe('the mode comes from the page address')`):
  - `pageMode({}, '?reels=', '')` → `reels: true`; `pageMode({}, '?symbol=', '')` → `symbol: ''`; `pageMode({}, '?symbol=a', '')` → `'a'`; `pageMode({}, '?scene=s', '')` → `scene: 's'`, `symbol: undefined`, `reels: false`.
  - Review Focus 3: `pageMode({ scene: '', symbol: undefined }, '?reels=', '')` → `reels: true`.
  - A passed value wins: `pageMode({ reels: false }, '?reels=', '')` → `false`; `pageMode({ scene: 'a' }, '?scene=b', '')` → `'a'`; `pageMode({ symbol: 'x' }, '?symbol=y', '')` → `'x'`.
  - `parentOrigin`: `pageMode({}, '', 'http://127.0.0.1:5680/#/doc/reels')` → `'http://127.0.0.1:5680'`; no referrer → `'*'`; a passed `parentOrigin` wins.
  - Through `apply`: booting the plugin with `{ search: '?reels=', post, listen }` (no `reels`, no `scene`) enters reels mode (its snapshot answers `mode: 'reels'` — read how the existing reels-mode tests assert it).
- [ ] **Step 2:** `npm test -w @energy8engine/scene-edit` — FAIL.
- [ ] **Step 3: Implement.** In `apply`, first line after `ctx.provide('sceneEdit', true)`:

```ts
const g = globalThis as { location?: { search?: string }; document?: { referrer?: string } };
const mode = pageMode(config, config.search ?? g.location?.search ?? '', config.referrer ?? g.document?.referrer ?? '');
const { scene } = mode;
```

then use `mode.parentOrigin` in `createWire`, `mode.reels === true` for the reels branch, `mode.symbol !== undefined` / `bootSymbol(mode.symbol)` for symbol mode. Update the `SceneEditConfig` field docs: each mode field left out is read from the page address.

Both `editor.ts` copies: drop the `?scene`/`?symbol`/`?reels` parsing and `parentOrigin`; keep `params` only for `safeBottom`. The plugin call becomes:

```ts
// scene-edit reads `?scene=`/`?symbol=`/`?reels=` and the parent's origin
// from this page itself (slice 43) — a project's editor.ts passes nothing.
await game.ctx.plugin(sceneEdit, {});
```

`cmp engine/examples/first-slot/src/editor.ts engine/templates/slot-basic/src/editor.ts` must print nothing.
- [ ] **Step 4:** `npm test -w @energy8engine/scene-edit`, typecheck `@energy8engine/scene-edit` and `e8-example-first-slot`; `npm test -w @energy8engine/ide-host` ALONE (it pins example ≡ template) — PASS / 0.
- [ ] **Step 5: Commit** — `Scene edit: the canvas reads its mode from its own address, so every project's editor page opens Symbols and Reels`.

---

### Task 4: scene-edit — an empty board is filled at once

**Files:**
- Modify: `engine/game/scene-edit/src/index.ts` (`bootReels` ~459-640: `ReelsBoardLike`, `layout`, lab state)
- Test: `engine/game/scene-edit/tests/plugin.test.ts` (the reels-mode describe — read its fake board and how it ticks `app.ticker`)

**Interfaces:**
- Consumes: Task 3 (`apply` reads `mode`).
- Produces: in reels mode, a board whose every cell (by `shapeOf`) has no symbol gets a `randomBoard` of the known symbols through `spinTo` followed by `skip()` — once per board object; `last` is set to it so `win`/`tumble` work without a Spin. With a known-symbol list that is empty, the mode emits `error` `{ message: 'the board is empty and the project has no symbols to fill it with' }` once per board.

- [ ] **Step 1: Failing tests:**
  - A fake board with `grid.getCell` answering `{ data: { symbol: null } }` for every cell, a `spinTo` spy that resolves only after `skip` is called, and a `skip` spy; a `symbols` service whose `doc()` lists `['a','b']`: after one ticker tick, `spinTo` was called once with a board of `cols × rows` ids from `['a','b']`, `skip` was called, and a following `win` rpc does NOT answer `spin first`.
  - A board whose cells already hold symbols: no `spinTo` (Review Focus 4, first half).
  - A lab `spin` rpc sent while the fill is still awaiting its `spinTo` answers `{ ok: false, reason: 'busy' }` (Review Focus 4, second half).
  - Symbols not known yet (`doc()` → `null`) on the first tick, then known: the fill happens on a later tick, once.
  - A rebuilt board (the service answers a new board object, empty): filled again.
  - `doc()` → `{ symbols: [] }`: no `spinTo`; one `error` event with the message above, not repeated on later ticks.
- [ ] **Step 2:** `npm test -w @energy8engine/scene-edit` — FAIL.
- [ ] **Step 3: Implement.** Add `skip?(opts?: { overlays?: boolean }): void;` to `ReelsBoardLike`. Beside `last`/`busy`:

```ts
/** Boards this mode already looked at for emptiness — a board is filled (or reported) at most once. */
const seen = new WeakSet<ReelsBoardLike>();
const isEmpty = (board: ReelsBoardLike) => {
  const { cols, rows } = shapeOf(board);
  if (!board.grid || cols === 0) return false;
  for (let c = 0; c < cols; c++)
    for (let r = 0; r < (rows[c] ?? 0); r++) if (board.grid.getCell(c, r)?.data.symbol) return false;
  return true;
};
/**
 * An empty board — no `reels1.board`, symbols a flow step would have
 * seeded (the editor page runs no flow) — gets a random board at once:
 * the lab's own spin, skipped to its end, so the canvas shows reels, not
 * frames. Runs from `layout` (every tick) until the board is judged once.
 */
const fillIfEmpty = (board: ReelsBoardLike) => {
  if (busy || seen.has(board)) return;
  const symbols = symbolIds();
  if (symbols === undefined) return; // symbols.yml not read yet: judge on a later tick
  seen.add(board);
  if (!isEmpty(board)) return;
  if (symbols.length === 0) {
    emit('error', { message: 'the board is empty and the project has no symbols to fill it with' });
    return;
  }
  const built = randomBoard(shapeOf(board), symbols, rand);
  busy = true;
  const done = board.spinTo({ kind: 'spinTo', board: built });
  board.skip?.();
  void done
    .then(() => { if (currentBoard() === board) last = { board, grid: built }; })
    .catch(() => {})
    .finally(() => { busy = false; });
};
```

`symbolIds()` answers `undefined` when the doc is `null` too — change it to ``?.doc()?.symbols.map(…)`` returning `undefined` for a `null` doc (it already does via `?.`; verify) so "not known yet" waits. Call `fillIfEmpty(board)` at the end of `layout` when `view` is set (after the fit). Keep `busy`'s declaration above `layout` if the ordering requires it (the functions are called only after `bootReels` has declared everything — check the first `layout()` call site and move it after the lab state if needed).
- [ ] **Step 4:** `npm test -w @energy8engine/scene-edit`, typecheck — PASS / 0.
- [ ] **Step 5: Commit** — `Scene edit: an empty reel board is filled with the project's symbols at once, so the Reels canvas shows reels without a Spin`.

---

### Task 5: The Reels and Symbols documents say what the canvas says

**Files:**
- Create: `engine/ide/client/src/shell/useCanvasSilence.ts`
- Modify: `engine/ide/client/src/shell/ReelsDocument.tsx` (~172-206), `engine/ide/client/src/shell/SymbolsDocument.tsx` (~186-205)
- Test: `engine/ide/client/tests/reels-document.test.tsx`, `engine/ide/client/tests/symbols-document.test.tsx`

**Interfaces:**
- Consumes: `CanvasRpc.on(event, handler): () => void` (`shell/canvas-rpc.ts:51`).
- Produces:

```ts
/**
 * A canvas that never says `ready` — its page threw before scene-edit
 * booted, or the project's editor page is broken — would leave the
 * document silent. `ms` after `key` changes (a new canvas mounted) with no
 * `ready`, `onSilent` runs once; a `ready` (now or on a later remount)
 * calls `onReady` so a stale message clears.
 */
export function useCanvasSilence(
  rpc: CanvasRpc,
  key: string | null,
  onSilent: () => void,
  onReady: () => void,
  ms = 10_000,
): void;
```

Status texts: silence → `the canvas did not answer — see the diagnostics panel`; an `error` event → its `message`.

- [ ] **Step 1: Failing tests** (fake timers; read how each test file fakes the rpc/iframe and the `ready` event):
  - Reels: a canvas `error` `{ message: 'boom' }` shows `boom` in the document's status; no `ready` for 10 s after mount → the silence text; a `ready` before 10 s → no silence text.
  - Review Focus 5: error, then a remount (the key changes) and `ready` → the status is cleared.
  - Symbols: the silence text after 10 s with no `ready`; `ready` clears a previous silence text.
- [ ] **Step 2:** `npm test -w @energy8engine/ide-client -- reels-document symbols-document` — FAIL.
- [ ] **Step 3: Implement.**

```ts
import { useEffect, useRef } from 'react';
import type { CanvasRpc } from './canvas-rpc';

export function useCanvasSilence(rpc: CanvasRpc, key: string | null, onSilent: () => void, onReady: () => void, ms = 10_000): void {
  const handlers = useRef({ onSilent, onReady });
  handlers.current = { onSilent, onReady };
  useEffect(() => {
    if (key === null) return;
    let answered = false;
    const off = rpc.on('ready', () => {
      answered = true;
      handlers.current.onReady();
    });
    const timer = setTimeout(() => {
      if (!answered) handlers.current.onSilent();
    }, ms);
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [rpc, key, ms]);
}
```

Reels: add `rpc.on('error', (payload) => setStatus((payload as { message: string }).message));` next to its `ready` handler, and `useCanvasSilence(rpc, canvasKey, () => setStatus(SILENT), () => setStatus(null))`. Symbols: the same hook with its own `setStatus` and its canvas key (read how it keys its iframe). `SILENT` is one exported constant in `useCanvasSilence.ts`: `export const CANVAS_SILENT = 'the canvas did not answer — see the diagnostics panel';`.
- [ ] **Step 4:** `npm test -w @energy8engine/ide-client`, typecheck — PASS / 0.
- [ ] **Step 5: Commit** — `Reels and Symbols documents: a canvas error or a canvas that never answers is said in the status line`.

---

### Task 6: e2e — the Preview and the Reels canvas on a real project

**Files:**
- Modify: `engine/apps/web/tests/e2e/screens.spec.ts` (the balance test ~197-247)
- Modify: `engine/apps/web/tests/e2e/reels.spec.ts` (a new test)
- Any other e2e that assumed the Preview's balance was the host default 1000 (grep `balance: 1000`, `balance=`, `preview-balance` under `engine/apps/web/tests/e2e`)

**Interfaces:**
- Consumes: Tasks 1–5; `project-fixture.ts` (`projectCopy`, `startDevHost`, `previewFrame`, `gameBooted`); `window.__e8.spin()`, `__e8.session()` on the game page.

- [ ] **Step 1: Write the scenarios.**
  - `screens.spec.ts`, the currency/balance/social test: the control reads `balance: 10000` (the Preview's default); pick `1K` in `preview-balance` (`selectOption({ label: '1K' })`) → relaunched with `balance=1000`; the reload section expects the select to keep `1000`.
  - `screens.spec.ts`, new test **refresh keeps the wallet, ↺ refills it**: open the Preview, spin once in the frame (`__e8.spin()`), read the game's own stored wallet (`frame.evaluate(() => Object.entries(sessionStorage).find(([k]) => k.startsWith('e8:wallet:'))?.[1])`); click `↻` → a new frame element, same `src`, and the stored wallet value is the post-spin one; click `↻` again → same (Review Focus 1); click `↺` → `wallet=` bumped in the `src`, and the game's wallet is back at the full seed (no stored value under the new key until a play, `__e8.session().balance` is the level).
  - `reels.spec.ts`, new test **a project whose editor page passes no reels mode** (paper-duel's shape): in the project copy, before `startDevHost`, overwrite `src/editor.ts` with this string (the pre-slice-43 page minus its `reels` line):

```ts
import { createGame } from '@energy8engine/game-runtime';
import * as sceneEdit from '@energy8engine/scene-edit';

const params = new URLSearchParams(location.search);
const safeBottom = Number(params.get('safeBottom') ?? 0) || 0;
const game = await createGame({
  mount: document.getElementById('mount')!,
  without: ['ui.shell'],
  provide: { safeArea: { top: 0, right: 0, bottom: safeBottom, left: 0 }, editorPage: true },
});
const parentOrigin = document.referrer ? new URL(document.referrer).origin : '*';
await game.ctx.plugin(sceneEdit, {
  scene: params.get('scene') ?? '',
  symbol: params.has('symbol') ? params.get('symbol')! : undefined,
  parentOrigin,
});
```

  Open the Reels document; the canvas's `__e8edit.snapshot()` answers `mode: 'reels'` and its cells are all non-empty WITHOUT pressing Spin (first-slot composes no `reels1.board`, so this is the fill). Read `reels.spec.ts`'s existing test for how it reaches the canvas frame and its `__e8edit` hook.
- [ ] **Step 2:** `cd engine/apps/web && E8_E2E_HOST_PORT=5779 npx playwright test tests/e2e/screens.spec.ts tests/e2e/reels.spec.ts` ALONE — PASS; `npm run typecheck -w @energy8engine/ide-web` — 0.
- [ ] **Step 3: Commit** — `E2E: the Preview's refresh keeps the wallet and ↺ refills it; Reels opens and shows a board on an editor page that names no mode`.

---

## After the tasks

Unit gate (each alone): `session-host`, `scene-edit`, `ide-client`, `game-runtime`, `ide-host` (ALONE); typecheck each and `ide-web`. Rebuild the IDE's dist: `npm run build -w @energy8engine/ide-web` (never staged). Full Playwright ALONE: `cd engine/apps/web && E8_E2E_HOST_PORT=5779 npx playwright test`.
