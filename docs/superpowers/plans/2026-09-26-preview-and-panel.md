# Preview and Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Preview document is one harness-like frame with a toolbar (screen, rotate, language, currency, balance, social) whose values reach the game's session; the composition shows no game; the game page draws no DOM dev overlay; the game's status sits in the IDE status bar; the bottom panel is plugin-contributed tabs with badges.

**Architecture:** Contracts first (currencies, `SessionInit.social`, `game-status`), then the session path (`session-host` forwards the page query to the dev host's `/api/session`), then the status path (`ide-bridge` → host relay → client), then the client (panel tabs, status item, Preview), then the game page and `e8 shot` move to the `window.__e8` hooks, and last the e2e suite follows.

**Tech Stack:** TypeScript, React 18, cordis 4, vitest + jsdom, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-26-preview-and-panel-design.md`

## Global Constraints

- `packages/*` is not edited.
- No `@energy8platform/game-engine` string under `engine/` (slice 37's guard in `engine/ide/host/tests/no-legacy-engine.test.ts`).
- Every change carries a test in its package.
- `engine/examples/first-slot/src/main.ts` and `engine/templates/slot-basic/src/main.ts` stay byte-identical (`engine/ide/host/tests/template.test.ts` pins it); the two `index.html` files differ only in `<title>` once this plan is done.
- One workspace per test command (`npm test -w <name>`); `@energy8engine/ide-host` tests run ALONE. Playwright runs ALONE: `cd engine/apps/web && E8_E2E_HOST_PORT=5779 npx playwright test <files>`.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Never stage `packages/*`, `engine/apps/web/dist`, `engine/examples/first-slot/concept.png`, `engine/examples/paper-duel`, `docs/superpowers/notes/2026-09-19-paper-duel-port-feasibility.md`. Never `git stash`/`checkout`/`restore`. Never kill a process you did not start.
- Workspace names: `@energy8engine/contracts`, `@energy8engine/session-host`, `@energy8engine/shell-pixi`, `@energy8engine/ide-bridge`, `@energy8engine/ide-host`, `@energy8engine/ide-client`, `@energy8engine/ide-web`.

## Amendments to the spec (rulings made while planning)

1. **No `game=preview` in the address** (spec §3 said it). A NAMED game loses its retained diagnostics the moment its socket closes (`game-gone`, `rpc.ts`) and every row is labelled `game "preview"`; the wall needed identities, one frame does not. The one frame is the anonymous game, as the composition's `Preview` was.
2. **`e8 shot` moves to the hooks** (spec §5 missed it): `engine/ide/host/src/compute/shot.ts` waits for `#status` and clicks `#spin`; both are gone. Readiness becomes "`window.__e8` is defined", the spin becomes `__e8.spin()`'s port. Task 7.
3. **No editor-page guard in `ide-bridge`'s status** — `editor.html` never composes `ide-bridge` (`main.ts` applies it by a dynamic import; `editor.ts` does not), so the scene/symbol canvases cannot report a status.

## Review Focus

1. **A stale `localStorage['e8.preview']`** (a preset renamed, a currency no longer listed, junk JSON) must not blank the Preview — it falls back field by field. Pinned in Task 6.
2. **Every query value is a string from a stranger**: `balance=abc`, `balance=-5`, `currency=constructor`, `social=true` must not reach `SessionInit` or throw. Pinned in Task 2 (`Object.hasOwn` on the currency table).
3. **A panel entry that is hidden still sets its badge**: Diagnostics' badge updates while the panel is collapsed or another tab is active. Pinned in Task 4.
4. **A reloading preview** (toolbar change, `reload: true`) closes the old game socket: the status must go `offline` then come back, never stick on the dead game's `spinning`. Pinned in Task 3 (host) and Task 9 (e2e).
5. **A spec that read the game in the composition's iframe** now has to open the Preview document first; a hidden pane's rAF may be throttled, so the helper makes the Preview the active tab before reading. Pinned in Tasks 8–9's helper.

---

### Task 1: contracts — currencies, `social`, `game-status`

**Files:**
- Create: `engine/core/contracts/src/dev-currencies.ts`
- Modify: `engine/core/contracts/src/session.ts` (`SessionInit.social`)
- Modify: `engine/core/contracts/src/protocol.ts` (`GameStatusMessage`, both unions)
- Modify: `engine/core/contracts/src/index.ts` (export `./dev-currencies`)
- Test: `engine/core/contracts/tests/dev-currencies.test.ts`, `engine/core/contracts/tests/protocol.test.ts` (append)

**Interfaces:**
- Produces: `DEV_CURRENCIES: Readonly<Record<string, SessionInit['currency']>>`; `SessionInit.social?: boolean`; `type GameStatusState = 'loading' | 'ready' | 'spinning' | 'failed' | 'offline'`; `interface GameStatusMessage { type: 'game-status'; state: GameStatusState; message?: string }`, in `ServerMessage` and `ClientMessage`.

- [ ] **Step 1: Failing test** — `tests/dev-currencies.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEV_CURRENCIES } from '../src';

describe('DEV_CURRENCIES', () => {
  it('lists the eight dev currencies, each keyed by its own code', () => {
    expect(Object.keys(DEV_CURRENCIES)).toEqual(['USD', 'EUR', 'GBP', 'JPY', 'BRL', 'INR', 'TRY', 'PLN']);
    for (const [code, c] of Object.entries(DEV_CURRENCIES)) expect(c.code).toBe(code);
  });
  it('JPY has no decimals and PLN writes its symbol on the right', () => {
    expect(DEV_CURRENCIES.JPY).toEqual({ code: 'JPY', symbol: '¥', decimals: 0, position: 'left' });
    expect(DEV_CURRENCIES.PLN).toEqual({ code: 'PLN', symbol: 'zł', decimals: 2, position: 'right' });
  });
  it('is frozen', () => {
    expect(Object.isFrozen(DEV_CURRENCIES)).toBe(true);
  });
});
```

Append to `tests/protocol.test.ts` a type-level check in the file's own style (read it first) that `{ type: 'game-status', state: 'spinning' }` is assignable to both `ClientMessage` and `ServerMessage`, and `{ type: 'game-status', state: 'offline' }` to `ServerMessage`.

- [ ] **Step 2:** `npm test -w @energy8engine/contracts` — FAIL (no export).
- [ ] **Step 3: Implement.** `src/dev-currencies.ts`:

```ts
/**
 * The currencies the IDE's Preview toolbar offers and the dev host's
 * `GET /api/session` accepts (slice 39) — pure data, browser-safe, read by
 * both. A real platform answers its own currency; this table is only what
 * a developer can pick while playing the dev wallet.
 */
import type { SessionInit } from './session';

export const DEV_CURRENCIES: Readonly<Record<string, SessionInit['currency']>> = Object.freeze({
  USD: { code: 'USD', symbol: '$', decimals: 2, position: 'left' },
  EUR: { code: 'EUR', symbol: '€', decimals: 2, position: 'left' },
  GBP: { code: 'GBP', symbol: '£', decimals: 2, position: 'left' },
  JPY: { code: 'JPY', symbol: '¥', decimals: 0, position: 'left' },
  BRL: { code: 'BRL', symbol: 'R$', decimals: 2, position: 'left' },
  INR: { code: 'INR', symbol: '₹', decimals: 2, position: 'left' },
  TRY: { code: 'TRY', symbol: '₺', decimals: 2, position: 'left' },
  PLN: { code: 'PLN', symbol: 'zł', decimals: 2, position: 'right' },
});
```

In `session.ts`, after `device?`:

```ts
  /** Social-casino wording in the shell (`isSocial`). Absent when the provider has no opinion. */
  social?: boolean;
```

In `protocol.ts`, beside `GameTransitionsMessage`:

```ts
/** What a running game is doing, as the IDE's status bar shows it (slice 39). */
export type GameStatusState = 'loading' | 'ready' | 'spinning' | 'failed' | 'offline';

/**
 * Up from the game's `ide-bridge` (never `offline` — that one is the
 * host's: the game socket that last reported closed, or the project
 * changed), relayed down to every `/ide` socket, and the last one greets a
 * socket connecting later.
 */
export interface GameStatusMessage {
  type: 'game-status';
  state: GameStatusState;
  /** Why, for `failed` (`spin failed`, `presentation failed`) and `ready` with no flow row. */
  message?: string;
}
```

Add `| GameStatusMessage` to `ServerMessage` and `ClientMessage`. Export `./dev-currencies` from `src/index.ts`.
- [ ] **Step 4:** `npm test -w @energy8engine/contracts` and `npm run typecheck -w @energy8engine/contracts` — PASS / 0.
- [ ] **Step 5: Commit** — `Contracts: dev currencies, a session's social flag, the game-status frame`.

---

### Task 2: the session takes the toolbar's parameters

**Files:**
- Modify: `engine/game/session-host/src/index.ts`
- Modify: `engine/game/shell-pixi/src/config.ts`
- Modify: `engine/ide/host/src/plugins/dev-game.ts` (`GET /api/session`)
- Test: `engine/game/session-host/tests/session.test.ts`, `engine/game/shell-pixi/tests/config.test.ts`, `engine/ide/host/tests/dev-game.test.ts`

**Interfaces:**
- Consumes: Task 1's `DEV_CURRENCIES`, `SessionInit.social`.
- Produces: `sessionQuery(search: string): string` (session-host, exported); `SessionHostConfig.search?: string`; `sessionOverrides(params: URLSearchParams): Partial<SessionInit>` (exported from `dev-game.ts`); wallet key `e8:wallet:<gameId>:<balance>:<currency code>`.

- [ ] **Step 1: Failing tests.**

`session.test.ts` (read the file's own `fakeFetch`/`boot` helpers first and reuse them):

```ts
import { sessionQuery } from '../src';

describe('session-host — the page query reaches /api/session', () => {
  it('forwards only lang, currency, balance, social, device, in that order', () => {
    expect(sessionQuery('?game=x&device=mobile&balance=50&lang=de&currency=EUR&social=1&junk=1'))
      .toBe('?lang=de&currency=EUR&balance=50&social=1&device=mobile');
  });
  it('is empty when the page has none of them', () => {
    expect(sessionQuery('')).toBe('');
    expect(sessionQuery('?game=preview')).toBe('');
  });
  it('fetches /api/session with the forwarded query', async () => {
    const urls: string[] = [];
    // wrap the file's fakeFetch so the requested URL is recorded, then:
    await ctx.plugin(sessionHost, { fetchFn: recording(urls), search: '?currency=JPY&balance=7' });
    expect(urls[0]).toBe('/api/session?currency=JPY&balance=7');
  });
});
```

Change the existing wallet test's expected key from `'e8:wallet:first-slot'` to `` `e8:wallet:first-slot:${seed.balance}:${seed.currency.code}` `` (the seed the fake answered), and add: two boots whose `/api/session` answers differ in `balance` (1000 then 50) with the same `sessionStorage` fake — the second starts at 50, not at the first's stored wallet.

`config.test.ts`:

```ts
it('maps session.social to the shell isSocial', () => {
  expect(toShellConfig(config, { ...init, social: true }).isSocial).toBe(true);
  expect(toShellConfig(config, init).isSocial).toBeUndefined();
});
```

`dev-game.test.ts` (beside the existing `/api/session` cases, same `bare()`/`preview()` helpers):

```ts
it('/api/session applies the preview toolbar: balance, currency, lang, social, device', async () => {
  // plugin config as in the betLevels case
  const body = await (await fetch(`${preview(ctx!)}/api/session?balance=250&currency=EUR&lang=de&social=1&device=mobile`)).json();
  expect(body).toMatchObject({
    balance: 250,
    currency: { code: 'EUR', symbol: '€', decimals: 2, position: 'left' },
    language: 'de',
    social: true,
    device: 'mobile',
  });
});
it('/api/session ignores an invalid value field by field', async () => {
  const body = await (await fetch(`${preview(ctx!)}/api/session?balance=-5&currency=constructor&social=true&device=tablet`)).json();
  expect(body.balance).toBe(1000);
  expect(body.currency.code).toBe('USD');
  expect(body).not.toHaveProperty('social');
  expect(body).not.toHaveProperty('device');
  expect(body).not.toHaveProperty('language');
});
```

Plus a pure `sessionOverrides` table test: `balance=abc` → no key, `balance=` → no key, `balance=0` → `0`, `balance=12.5` → `12.5`, `currency=toString` → no key.
- [ ] **Step 2:** run the three suites (`ide-host` ALONE) — FAIL.
- [ ] **Step 3: Implement.**

`session-host/src/index.ts`:

```ts
export interface SessionHostConfig {
  fetchFn?: typeof fetch;
  /** Tests only; the page's own `location.search` otherwise. */
  search?: string;
}

/** The Preview toolbar's parameters (slice 39), in this order — the only part of the page's address the dev host is told. */
const FORWARDED = ['lang', 'currency', 'balance', 'social', 'device'] as const;

/** `?lang=…&currency=…` from a page's `location.search`, or `''` when it carries none of them. */
export function sessionQuery(search: string): string {
  const from = new URLSearchParams(search);
  const to = new URLSearchParams();
  for (const key of FORWARDED) {
    const value = from.get(key);
    if (value !== null) to.set(key, value);
  }
  const query = to.toString();
  return query ? `?${query}` : '';
}
```

`apply`: `const search = config.search ?? (globalThis as { location?: { search?: string } }).location?.search ?? '';` and `fetchFn(`/api/session${sessionQuery(search)}`)`. `walletStore(gameId, init)` keys on `` `e8:wallet:${gameId}:${init.balance}:${init.currency.code}` ``; its doc says why (a new seed from the toolbar starts a fresh wallet; the same toolbar keeps the old one). Update the module doc's `e8:wallet:<gameId>` mentions.

`shell-pixi/src/config.ts`: `isSocial: init.social ?? undefined,` beside `language`; one line in the module doc.

`dev-game.ts`:

```ts
/**
 * The Preview toolbar's parameters (slice 39) over the dev wallet's
 * defaults — each one a string from the page's address, so each is checked
 * on its own and an invalid one is dropped, never the request.
 */
export function sessionOverrides(params: URLSearchParams): Partial<SessionInit> {
  const out: Partial<SessionInit> = {};
  const balance = params.get('balance');
  if (balance !== null && balance.trim() !== '') {
    const n = Number(balance);
    if (Number.isFinite(n) && n >= 0) out.balance = n;
  }
  const currency = params.get('currency');
  if (currency !== null && Object.hasOwn(DEV_CURRENCIES, currency)) out.currency = DEV_CURRENCIES[currency];
  const lang = params.get('lang');
  if (lang) out.language = lang;
  if (params.get('social') === '1') out.social = true;
  if (params.get('device') === 'mobile') out.device = 'mobile';
  return out;
}
```

In the route: `const params = new URL(req._req.url ?? '', 'http://host').searchParams;` (the same `req._req.url` the `/@fs` guard below reads), then spread `...sessionOverrides(params)` after `currency` and before `betLevels` in `res.json`. Update the route's doc ("`balance`/`currency` are fixed" is no longer true).
- [ ] **Step 4:** `session-host`, `shell-pixi` tests + typecheck; `ide-host` ALONE + typecheck — PASS / 0.
- [ ] **Step 5: Commit** — `Session: the preview's language, currency, balance, social and device reach the dev wallet`.

---

### Task 3: the game's status, reported and relayed

**Files:**
- Modify: `engine/game/ide-bridge/src/index.ts`
- Modify: `engine/ide/host/src/plugins/rpc.ts`, `engine/ide/host/src/plugins/dev-game.ts` (`accept` list, line ~329)
- Test: `engine/game/ide-bridge/tests/status.test.ts` (new), `engine/ide/host/tests/rpc.test.ts`

**Interfaces:**
- Consumes: Task 1's `GameStatusMessage`.
- Produces: `game-status` frames on the `/ide` sockets as the spec §6 lists; the host's `IdeRpcService` gains nothing public (the status lives inside `apply`).

- [ ] **Step 1: Failing tests.** `ide-bridge/tests/status.test.ts` — build a fake flow with `ready` (a controllable promise), `busy()`, `doc()` returning `{ nodes: [{ id: 's', kind: 'spin' }, { id: 'p', kind: 'present' }] }`, `onTrace(fn)` capturing `fn`; reuse the openable-socket shape of `index.test.ts`'s `forwards flow-trace` block (copy the helper into this file). Cases, each reading the `game-status` frames sent (after `socket.open()`):
  - on open: `[{ state: 'loading' }]`; after `ready` resolves: `loading`, `ready`;
  - trace `{ node: 's', out: null }` → `spinning`; `{ node: 'p', out: 'next' }` → `ready`;
  - `{ node: 's', out: 'failed' }` → `{ state: 'failed', message: 'spin failed' }`; `{ node: 'p', out: 'failed' }` → `{ state: 'failed', message: 'presentation failed' }`; a later `{ node: 's', out: null }` → `spinning`;
  - a trace for a node of another kind, or one not in the doc, sends nothing;
  - the same state twice sends one frame;
  - no `flow` provided: `{ state: 'ready', message: 'no flow row' }`;
  - frames produced before `open` are not lost: the socket opens after `ready` resolved → the first frame sent is `ready`;
  - a re-provided `flow` (dispose the fake's provider, provide a second fake) is the one watched: its trace moves the status, the first one's does not.

  `rpc.test.ts` — read how the file tests `game-transitions` (a game socket and an editor socket on the harness it builds) and add:
  - a `game-status` from the game socket is relayed to the editor socket, not echoed to the game;
  - a socket connecting later is greeted with the last one;
  - the game socket closing sends `{ type: 'game-status', state: 'offline' }` to the others, and a later client is not greeted with a status;
  - a frame with `state: 'offline'`, an unknown state, or a non-string `message` is ignored;
  - a project switch sends `offline` when a status was held.
- [ ] **Step 2:** `npm test -w @energy8engine/ide-bridge`; `ide-host` ALONE — FAIL.
- [ ] **Step 3: Implement.**

`ide-bridge/src/index.ts`, beside the trace forwarding (same `socket`, same `currentFlow`, re-armed in the same `ctx.inject(['flow'], …)` block):

```ts
  // The game's status for the IDE's status bar (slice 39) — what the
  // project page's own `#status` used to say, derived here from the flow:
  // `spin` entered → spinning; `present` left by `next` → ready; either
  // left by `failed` → failed. Sent only on a change; the last one goes out
  // when the socket opens, since boot happens before it does.
  type Status = { state: GameStatusState; message?: string };
  let status: Status | null = null;
  const sendStatus = (next: Status) => {
    if (status && status.state === next.state && status.message === next.message) return;
    status = next;
    if (socket.readyState !== WEBSOCKET_OPEN) return;
    try {
      const message: ClientMessage = { type: 'game-status', ...next };
      socket.send(JSON.stringify(message));
    } catch {
      // as `flushTrace`
    }
  };
  socket.addEventListener('open', () => {
    if (!status) return;
    try {
      socket.send(JSON.stringify({ type: 'game-status', ...status } satisfies ClientMessage));
    } catch {
      // as `flushTrace`
    }
  });

  type StatusFlow = {
    ready?: Promise<void>;
    doc?(): { nodes: { id: string; kind: string }[] } | null;
    onTrace(fn: (e: FlowTraceEntry) => void): () => void;
  };
  let unwatchStatus: (() => void) | undefined;
  const watchStatus = () => {
    unwatchStatus?.();
    const flow = currentFlow() as StatusFlow | undefined;
    if (!flow) {
      sendStatus({ state: 'ready', message: 'no flow row' });
      unwatchStatus = undefined;
      return;
    }
    let alive = true;
    void flow.ready?.then(() => {
      if (alive && (status === null || status.state === 'loading')) sendStatus({ state: 'ready' });
    });
    const off = flow.onTrace((e) => {
      const kind = flow.doc?.()?.nodes.find((n) => n.id === e.node)?.kind;
      if (kind === 'spin' && e.out === null) sendStatus({ state: 'spinning' });
      else if (kind === 'spin' && e.out === 'failed') sendStatus({ state: 'failed', message: 'spin failed' });
      else if (kind === 'present' && e.out === 'next') sendStatus({ state: 'ready' });
      else if (kind === 'present' && e.out === 'failed') sendStatus({ state: 'failed', message: 'presentation failed' });
    });
    unwatchStatus = () => {
      alive = false;
      off();
    };
  };
  sendStatus({ state: 'loading' });
  watchStatus();
```

Call `watchStatus()` next to `subscribeTrace()` in the existing `ctx.inject(['flow'], …)` re-arm, and dispose it in an effect (`'ide-bridge-game-status'`). Import `GameStatusState` from contracts.

`rpc.ts`:
- add `'game-status'` to the accepted `type` list in the message handler;
- hold `let lastStatus: { frame: GameStatusMessage; owner: WebSocket } | null = null;`
- on `game-status`: accept only `state` in `['loading', 'ready', 'spinning', 'failed']` and `message` absent or a string; store `{ frame: { type: 'game-status', state, ...(message !== undefined ? { message } : {}) }, owner: socket }`; relay to every OTHER client;
- greeting: send `lastStatus.frame` when held (next to the mirrors' `greet`);
- `close`: when `lastStatus?.owner === socket`, clear it and send `{ type: 'game-status', state: 'offline' }` to the remaining clients;
- project switch (the `lastActive !== null && state.active !== lastActive` block): when held, clear it and push the `offline` frame into `gone`.
- doc comments in the file's own voice (what is retained and why: a late IDE tab should see what the game is doing).

`dev-game.ts`: add `'game-status'` to the preview server's `accept` list.
- [ ] **Step 4:** `ide-bridge` tests + typecheck; `ide-host` ALONE + typecheck — PASS / 0.
- [ ] **Step 5: Commit** — `Bridge: the game reports its status; the host relays it, greets with it, says offline when it goes`.

---

### Task 4: the bottom panel is tabs

**Files:**
- Modify: `engine/ide/client/src/plugins/shell.tsx` (`PanelMeta.order`, `panel`, `showPanel`, `setPanelBadge`, `panelBadge`, `useShell`)
- Modify: `engine/ide/client/src/shell/Shell.tsx` (tab strip; entries always mounted)
- Modify: `engine/ide/client/src/screens/DiagnosticsPanel.tsx` (drop its `<h2>` header and count)
- Modify: `engine/ide/client/src/styles.css` (panel header/tabs)
- Modify: `engine/apps/web/src/App.tsx` (Diagnostics `order: 0`, its badge)
- Test: `engine/ide/client/tests/shell.test.tsx`, `engine/ide/client/tests/diagnostics-panel.test.tsx`, `engine/apps/web/tests/App.test.tsx`

**Interfaces:**
- Produces: `ShellService.panel(): string | undefined`, `showPanel(key: string): void`, `setPanelBadge(key: string, value: number | string | undefined): void`, `panelBadge(key: string): number | string | undefined`; `useShell(ctx)` gains `panel: string | undefined`; test ids `panel-tab-<key>` (a `role="tab"` button, `aria-selected`), `panel-badge-<key>`, `panel-<key>` (the entry, `hidden` when not shown), `panel-toggle` (unchanged).

- [ ] **Step 1: Failing tests** in `shell.test.tsx` (read its existing panel tests and harness first; replace the ones that assert entries unmount when collapsed):
  - two `shell.panel` entries registered `b` (`order: 1`) then `a` (`order: 0`): tabs render `a`, `b`; `a` is selected; `panel-b` is hidden, `panel-a` visible;
  - clicking `panel-tab-b` selects it; `localStorage['e8.panel-tab']` is `'b'`; a fresh shell over the same storage starts on `b`; a stored key no entry has falls back to the first tab; a throwing `localStorage` (stub `getItem`/`setItem` to throw) still renders;
  - collapsed: both entries stay in the DOM, hidden; a component inside an entry that counts its own renders keeps its state across collapse/expand (no remount);
  - `ctx.shell.showPanel('b')` while collapsed expands the panel and selects `b`;
  - `setPanelBadge('a', 3)` shows `panel-badge-a` with `3`; `0` and `undefined` remove it; a badge set while the panel is collapsed shows once expanded.

  `diagnostics-panel.test.tsx`: the panel renders no heading and no count badge of its own (update the tests that read them). `App.test.tsx`: the diagnostics badge equals errors + warnings across the three lists (info not counted) — drive it with the file's own fakes; read the file first.
- [ ] **Step 2:** `npm test -w @energy8engine/ide-client`, `npm test -w @energy8engine/ide-web` — FAIL.
- [ ] **Step 3: Implement.**

`shell.tsx`: `export interface PanelMeta { key: string; title: string; order?: number }`. Move `byOrder` from `Shell.tsx` into this module (exported) and import it back in `Shell.tsx`. State: `let panelKey = readStored('e8.panel-tab')` (try/catch; `undefined` on failure); `const badges = new Map<string, number | string>()`.

```ts
    panel() {
      const entries = byOrder(ctx.slots.list<SlotMeta & PanelMeta>(SLOT_NAMES.panel));
      return entries.some((e) => e.key === panelKey) ? panelKey : entries[0]?.key;
    },
    showPanel(key) {
      panelKey = key;
      panelCollapsed = false;
      writeStored('e8.panel-tab', key);
      notify();
    },
    setPanelBadge(key, value) {
      const next = value === 0 ? undefined : value;
      if (badges.get(key) === next) return;
      if (next === undefined) badges.delete(key);
      else badges.set(key, next);
      notify();
    },
    panelBadge(key) {
      return badges.get(key);
    },
```

Doc each on the interface (why imperative: a project plugin's plain-JS client half can call it without React; why `0` is no badge). `useShell` reads `panel: ctx.shell.panel()`. Since `panel()` reads slots, `useShell`'s subscription must also re-read on `ctx.slots.subscribe` — `Shell.tsx` already bumps on slots; confirm the tab strip re-renders when an entry registers.

`Shell.tsx` panel block:

```tsx
      <div className="e8-panel" data-testid="panel" data-collapsed={panelCollapsed ? '' : undefined}>
        <div className="e8-resize e8-resize-y" data-testid="resize-panel" {...panelSize.handlers} />
        <div className="e8-panel-header" role="tablist">
          {panelEntries.map((entry) => {
            const badge = ctx.shell.panelBadge(entry.key);
            return (
              <button
                key={entry.key}
                type="button"
                role="tab"
                className="e8-panel-tab"
                aria-selected={entry.key === panel}
                data-testid={`panel-tab-${entry.key}`}
                onClick={() => ctx.shell.showPanel(entry.key)}
              >
                {entry.title}
                {badge === undefined ? null : (
                  <span className="e8-badge" data-testid={`panel-badge-${entry.key}`}>{badge}</span>
                )}
              </button>
            );
          })}
          <button type="button" data-testid="panel-toggle" aria-pressed={panelCollapsed} onClick={() => ctx.shell.togglePanel()}>
            {panelCollapsed ? '▸' : '▾'}
          </button>
        </div>
        {panelEntries.map((entry) => (
          <div
            key={entry.key}
            className="e8-panel-entry"
            role="tabpanel"
            data-testid={`panel-${entry.key}`}
            hidden={panelCollapsed || entry.key !== panel}
          >
            <entry.component ctx={ctx} />
          </div>
        ))}
      </div>
```

`panelEntries` is `byOrder(...)`. Keep each entry inside the existing per-entry error boundary if the shell wraps panel entries in one (check; documents use `DocumentBoundary`).

`styles.css`: `.e8-panel-header` becomes an in-flow row (drop `position: absolute`, `pointer-events: none`); `.e8-panel-tab` — a label-sized button, muted colour, `aria-selected="true"` in `--e8-fg` with a 1px bottom border in `--e8-accent` (use existing tokens only — the token guard in `tests/styles.test.ts` fails on a literal); `.e8-panel-header [data-testid='panel-toggle']` keeps `margin-left: auto`; the height rule `.e8-panel:has(.e8-panel-entry)` becomes `.e8-panel:not([data-collapsed])`; remove the `.e8-panel-title` rule (nothing renders it).

`DiagnosticsPanel.tsx`: remove `.e8-diagnostics-panel-header` (the `<h2>` and the count); its CSS too.

`App.tsx`: register Diagnostics with `order: 0`; in `DiagnosticsDocument`:

```tsx
  const count = [
    ...project,
    ...(game ?? []).flatMap((group) => group.diagnostics.map((entry) => entry.diagnostic)),
    ...editor,
  ].filter((d) => d.severity === 'error' || d.severity === 'warning').length;
  useEffect(() => ctx.shell.setPanelBadge('diagnostics', count), [ctx, count]);
```
- [ ] **Step 4:** `ide-client`, `ide-web` tests + typecheck — PASS / 0. Run `npx playwright test tests/e2e/shell.spec.ts tests/e2e/modern-ui.spec.ts` ALONE; fix assertions that relied on entries unmounting when collapsed or on the diagnostics header (use `toBeHidden()`, `panel-tab-diagnostics`).
- [ ] **Step 5: Commit** — `Shell: the bottom panel is tabs a plugin contributes, with a badge and showPanel`.

---

### Task 5: the game's status in the status bar

**Files:**
- Modify: `engine/ide/client/src/plugins/game-composition.tsx` (`status`)
- Modify: `engine/ide/client/src/shell/StatusItems.tsx` (`GameStatus`)
- Modify: `engine/ide/client/src/index.ts` (export `GameStatus`)
- Modify: `engine/apps/web/src/App.tsx` (register it)
- Modify: `engine/ide/client/src/styles.css` (a `button.e8-status-item` looks like the span)
- Test: `engine/ide/client/tests/game-composition.test.ts`, `engine/ide/client/tests/status-items.test.tsx`, `engine/apps/web/tests/App.test.tsx`

**Interfaces:**
- Consumes: Task 1's `GameStatusMessage`; Task 3's frames; Task 4's `ctx.shell.showPanel`.
- Produces: `GameCompositionState.status: GameStatusMessage | null`; `GameStatus({ ctx })`; status test id `status-game` (the slot key `game`).

- [ ] **Step 1: Failing tests.** `game-composition.test.ts` (the file's fake socket): a `game-status` frame sets `status`; a malformed one (`state: 'bogus'`, non-string `message`) is ignored; `offline` is accepted (the host sends it). `status-items.test.tsx`: `null` → `○ no game`; `loading` → `… loading`; `ready` → `● ready`; `spinning` → `◌ spinning…`; `failed` with `message: 'spin failed'` → `✕ spin failed`, rendered as a button whose click calls `ctx.shell.showPanel('diagnostics')` (spy); `offline` → `○ no game`; every state sets `data-state`. `App.test.tsx`: the status bar's right side starts with `status-game`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement.** In `game-composition.tsx`, `status: null` on the service, an `isStatusFrame` guard (state one of the five, `message` absent or string), and in the socket listener before the composition-frame check:

```ts
    if (isStatusFrame(parsed)) {
      service.status = parsed;
      notify();
      return;
    }
```

`useGameComposition` reads `status` too. `StatusItems.tsx`:

```tsx
/**
 * Right, first: what the running game is doing — the `game-status` frames
 * its `ide-bridge` sends (slice 39), which replaced the project page's own
 * `#status`. `failed` is a button: the reason is in Diagnostics.
 */
export function GameStatus({ ctx }: { ctx: Context }) {
  const { status } = useGameComposition(ctx);
  const state = status?.state ?? 'offline';
  const label =
    state === 'ready' ? '● ready'
      : state === 'spinning' ? '◌ spinning…'
        : state === 'loading' ? '… loading'
          : state === 'failed' ? `✕ ${status?.message ?? 'failed'}`
            : '○ no game';
  if (state === 'failed') {
    return (
      <button type="button" className="e8-status-item" data-state={state} onClick={() => ctx.shell.showPanel('diagnostics')}>
        {label}
      </button>
    );
  }
  return <span className="e8-status-item" data-state={state}>{label}</span>;
}
```

`App.tsx`: `ctx.slots.register({ name: 'shell.status', key: 'game', side: 'right', order: -1 }, GameStatus)` in the status effect.
- [ ] **Step 4:** `ide-client`, `ide-web` tests + typecheck — PASS / 0.
- [ ] **Step 5: Commit** — `Client: the game's status in the status bar; a failure opens Diagnostics`.

---

### Task 6: one Preview frame with a toolbar; the composition without a game

**Files:**
- Create: `engine/ide/client/src/screens/Preview.tsx` (replaces `PreviewWall.tsx`)
- Delete: `engine/ide/client/src/screens/PreviewWall.tsx`
- Modify: `engine/ide/client/src/screens/CompositionScreen.tsx` (no `<Preview>`)
- Modify: `engine/ide/client/src/index.ts` (`Preview`, `previewAddress`, `type PreviewState`; drop `PreviewWall`, `PreviewWallProps`)
- Modify: `engine/apps/web/src/App.tsx` (`preview` document → `Preview`)
- Modify: `engine/ide/client/src/styles.css` (stage, toolbar; drop `.e8-preview-wall-*`)
- Test: `engine/ide/client/tests/preview.test.tsx` (rewrite the `PreviewWall` half, keep the `Preview` reload cases), `engine/ide/client/tests/composition-screen.test.tsx`

**Interfaces:**
- Consumes: Task 1's `DEV_CURRENCIES`; `SCREEN_PRESETS`/`screenPreset` (`./screenPresets`), `LANGS` (`./langs`); `useWorkspace`, `useGameComposition`.
- Produces: `interface PreviewState { preset: string; rotated: boolean; lang: string; currency: string; balance: string; social: boolean }`; `DEFAULT_PREVIEW_STATE`; `previewAddress(base: string, s: PreviewState): string`; `readPreviewState(): PreviewState`; `Preview({ ctx })`; test ids `preview-preset` (select), `preview-rotate`, `preview-lang`, `preview-currency`, `preview-balance` (input), `preview-social` (checkbox), `preview-stage`; the iframe keeps `title="game preview"`.

- [ ] **Step 1: Failing tests** in `preview.test.tsx`:

```ts
describe('previewAddress', () => {
  const base = 'http://127.0.0.1:5679/';
  it('carries lang and currency always, and nothing else by default', () => {
    expect(previewAddress(base, DEFAULT_PREVIEW_STATE)).toBe('http://127.0.0.1:5679/?lang=en&currency=USD');
  });
  it('adds balance when set, social=1 when on, device=mobile for a Mobile preset', () => {
    const url = new URL(previewAddress(base, { ...DEFAULT_PREVIEW_STATE, preset: 'Mobile S', balance: '50', social: true }));
    expect(url.searchParams.get('balance')).toBe('50');
    expect(url.searchParams.get('social')).toBe('1');
    expect(url.searchParams.get('device')).toBe('mobile');
    expect(url.searchParams.has('game')).toBe(false);
  });
  it('keeps what the base address already carries', () => {
    expect(new URL(previewAddress('http://h/?x=1', DEFAULT_PREVIEW_STATE)).searchParams.get('x')).toBe('1');
  });
});
```

`readPreviewState`: nothing stored → defaults; junk JSON → defaults; `{ preset: 'Gone', currency: 'XXX', lang: 'zz', balance: 'abc', rotated: 'yes' }` → each field falls back to its default; a throwing `localStorage` → defaults.

Component (`Preview`, with the file's existing workspace/game-composition fakes): one iframe `title="game preview"` whose `width`/`height` are Desktop's 1200/675; Rotate → 675/1200; choosing `Mobile S` → 320/568 and `device=mobile` in `src`; changing currency to EUR → a NEW iframe element (compare element identity, as the reload tests do) with `currency=EUR`; typing `abc` into balance and blurring → `aria-invalid="true"`, `src` unchanged; typing `250` + Enter → `balance=250`; social toggles `social=1`; the choice is written to `localStorage['e8.preview']` and a remount starts from it. Keep the existing `Preview` cases (loading, unavailable, reload on `reload: true`, not on `false`, remount on project change) — adjust only their render call and expected `src` (now `previewAddress(previewUrl, DEFAULT_PREVIEW_STATE)`).

`composition-screen.test.tsx`: `CompositionScreen` with a `ctx` renders no `iframe`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** `Preview.tsx` — move `Frame`, `Unavailable` and the loading note from `PreviewWall.tsx` unchanged; carry over the module doc's account of the pinned `SCREEN_PRESETS`/`LANGS` copies. Then:

```tsx
export interface PreviewState {
  preset: string;
  rotated: boolean;
  lang: string;
  currency: string;
  /** Currency units as typed; `''` is the host's default. */
  balance: string;
  social: boolean;
}

export const DEFAULT_PREVIEW_STATE: PreviewState = {
  preset: SCREEN_PRESETS[0].name,
  rotated: false,
  lang: 'en',
  currency: 'USD',
  balance: '',
  social: false,
};

const STORAGE_KEY = 'e8.preview';

/** A balance the toolbar may send: empty, or a finite number ≥ 0. */
export const validBalance = (value: string) =>
  value.trim() === '' || (Number.isFinite(Number(value)) && Number(value) >= 0);

/**
 * The game's address for one toolbar state — the harness's launch URL
 * (`buildLaunchUrl`), for the dev host. `session-host` forwards the five
 * session fields to `/api/session`. No `game` identity: the one frame is
 * the anonymous game (plan amendment 1).
 */
export function previewAddress(base: string, s: PreviewState): string {
  const url = new URL(base);
  url.searchParams.set('lang', s.lang);
  url.searchParams.set('currency', s.currency);
  if (s.balance.trim() !== '') url.searchParams.set('balance', String(Number(s.balance)));
  if (s.social) url.searchParams.set('social', '1');
  if (s.preset.startsWith('Mobile')) url.searchParams.set('device', 'mobile');
  return url.toString();
}

/** The remembered toolbar, field by field: anything stale or foreign falls back to its default. */
export function readPreviewState(): PreviewState {
  let stored: Partial<Record<keyof PreviewState, unknown>> = {};
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) stored = parsed as typeof stored;
  } catch {
    // storage denied or junk: the defaults stand
  }
  const d = DEFAULT_PREVIEW_STATE;
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const preset = str(stored.preset);
  const lang = str(stored.lang);
  const currency = str(stored.currency);
  const balance = str(stored.balance);
  return {
    preset: preset && screenPreset(preset) ? preset : d.preset,
    rotated: typeof stored.rotated === 'boolean' ? stored.rotated : d.rotated,
    lang: lang && LANGS.some((l) => l.code === lang) ? lang : d.lang,
    currency: currency && Object.hasOwn(DEV_CURRENCIES, currency) ? currency : d.currency,
    balance: balance !== undefined && validBalance(balance) ? balance : d.balance,
    social: typeof stored.social === 'boolean' ? stored.social : d.social,
  };
}

function writePreviewState(s: PreviewState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // a viewer convenience; nothing to do without storage
  }
}
```

The component: `const [state, setState] = useState(readPreviewState)`; `update(patch)` merges, writes, sets; a `draft` for balance committed on blur and on Enter only when `validBalance(draft)` (else `aria-invalid="true"` and nothing sent). Toolbar in a `div.e8-preview-toolbar`: preset `<select>` (options `name — w×h`), `Rotate` button, language `<select>` from `LANGS`, currency `<select>` from `Object.keys(DEV_CURRENCIES)`, balance `<input inputMode="decimal" placeholder="1000">`, social checkbox with a `<label>`. Below, `<Frame>` renders:

```tsx
<div className="e8-preview-stage" data-testid="preview-stage">
  <iframe key={`${reloads}:${active}:${src}`} className="e8-preview" title="game preview" width={w} height={h} src={src} />
</div>
```

with `src = previewAddress(previewUrl, state)` and `w`/`h` from the preset (swapped when rotated). The component root is `main.e8-preview-doc` with `<h1>Preview</h1>` removed (the tab names it). Doc comment: the harness is the model; 1:1 at the preset's size, the stage scrolls (the user chose it over fitting).

CSS: `.e8-preview-doc { display: flex; flex-direction: column; height: 100%; min-height: 0 }`, `.e8-preview-toolbar` a wrapping row with the existing control gap, `.e8-preview-stage { flex: 1; min-height: 0; overflow: auto; display: flex }`, `.e8-preview { flex: none; margin: auto; border / radius / background as today }` (margin-auto centres inside a scroll box without clipping the top/left edge), drop `.e8-preview { width: 100%; height: 420px }` and all `.e8-preview-wall-*` and `.e8-preview-tile` rules. The doc pane's own padding: if `.e8-doc-pane` pads, add `.e8-doc-pane:has(> .e8-preview-doc) { padding: 0; overflow: hidden }` beside the canvas rule.

`CompositionScreen.tsx`: remove the `<Preview ctx={ctx} />` line and its import; the doc comment that says the composition renders the preview goes.

`App.tsx`: import `Preview` and register it for `preview`; drop `PreviewWall`.
- [ ] **Step 4:** `ide-client`, `ide-web` tests + typecheck — PASS / 0.
- [ ] **Step 5: Commit** — `Client: the Preview is one frame with a harness toolbar; the composition shows no game`.

---

### Task 7: the game page without a dev overlay; `e8 shot` on the hooks

**Files:**
- Modify: `engine/examples/first-slot/index.html`, `engine/templates/slot-basic/index.html`
- Modify: `engine/examples/first-slot/src/main.ts`, `engine/templates/slot-basic/src/main.ts` (byte-identical)
- Modify: `engine/examples/first-slot/README.md`, `engine/templates/slot-basic/README.md` (the toolbar/`#status`/`#log` mentions)
- Modify: `engine/ide/host/src/compute/shot.ts`, `engine/apps/cli/src/run.ts` (help text, line ~75), `engine/core/contracts/src/diagnostic.ts` (comment, line ~81)
- Test: `engine/ide/host/tests/compute-shot.test.ts`, `engine/ide/host/tests/template.test.ts` (unchanged — must stay green)

**Interfaces:**
- Produces: `window.__e8.skip(): void` (emits `ui.skip` on the current event bus); `__e8.spin()` unchanged; `e8 shot`'s `PageLike` gains `evaluate<T>(fn: () => T | Promise<T>): Promise<T>` and loses the `#status`/`#spin` reads.

- [ ] **Step 1:** In both `index.html`: delete `#controls` (and its comment), `#log`, and their CSS (`#controls`, `#controls[hidden]`, `#log`, `#log:empty`, `button`). Keep `#mount`'s rule and its comment reworded (the canvas fills the window; nothing floats over it). The only remaining difference between the two files is `<title>`.
- [ ] **Step 2:** In `first-slot/src/main.ts`: remove `controlsEl`, `logEl`, `statusEl`, `spinBtn`, `turboCheckbox`, `mechanicSelect` and the built-page hiding block; the `#status` writes after boot; `renderDiagnostics` and its subscription; `if (bound) mechanicSelect.value = bound` and the `const bound` it needed (unless still read elsewhere — `grep` it); the `mechanicSelect` change listener; the `spinBtn`/`turboCheckbox` listeners; the `onTrace` effect that wrote `#status` (`first-slot:status`); the `no flow row` status line. Keep `pressSpin` (now only `__e8.spin()` calls it) and every `__e8` hook. Add beside `spin`:

```ts
  /** What the removed button's second click did: hurry the run already going (`ui.skip`, caught by `play-loop`). A no-op with no event bus. */
  skip(): void {
    currentEvents()?.emit('ui.skip');
  },
```

Reword every comment that names the removed elements (the `__e8` doc's "Nothing on this page's own UI calls `window.__e8`" stays true; the boot-failure block keeps drawing into `#mount`). Unused imports (`DiagnosticsService` if only `renderDiagnostics` used it — check) go. Copy the file to `templates/slot-basic/src/main.ts` (`cp`), then `cmp` the two.
- [ ] **Step 3:** READMEs: replace the toolbar/`#status`/`#log` paragraphs with one sentence each — the game page draws only the game; Spin and turbo are the shell's; status and diagnostics are in the IDE (status bar, Diagnostics tab); tests drive the page through `window.__e8`.
- [ ] **Step 4: `e8 shot`.** Failing test first in `compute-shot.test.ts` (read its `fake()` — it stubs `querySelector`/`waitForFunction` around `#status`): the fake page now answers `evaluate` and `waitForFunction`; cases:
  - readiness resolves when the page's `__e8` is defined (the fake's `waitForFunction` is handed a function; run it against a fake `window` with and without `__e8`);
  - `spin: true` calls `__e8.spin()` through `evaluate`; `{ out: 'next' }` → no diagnostic; `{ out: 'failed' }` → one `warning` from `compute` at `__e8.spin` with message `the spin left by "failed"`; a rejection → `warning` `spin failed: <message>`;
  - no `addStyleTag` call any more (the fake records calls).
  Then `shot.ts`: readiness `page.waitForFunction(() => (window as { __e8?: unknown }).__e8 !== undefined, …)` (keep the `PageLike` signature's `arg` shape — pass `''`); the spin:

```ts
    if (input.spin) {
      try {
        const settled = page.evaluate(
          () => (window as unknown as { __e8: { spin(): Promise<{ out: string }> } }).__e8.spin(),
        );
        const result = await within(settled, budgetMs);
        if (!result) {
          diagnostics.push(diagnostic('warning', 'compute', '__e8.spin', `the spin did not settle within ${budgetMs}ms`));
        } else if (result.out !== 'next') {
          diagnostics.push(diagnostic('warning', 'compute', '__e8.spin', `the spin left by "${result.out}"`));
        }
      } catch (error) {
        diagnostics.push(diagnostic('warning', 'compute', '__e8.spin', `spin failed: ${error instanceof Error ? error.message : String(error)}`));
      }
    }
```

(`within` today returns a boolean — read it; if so, make the spin branch race `settled` against the budget itself and keep `within` for readiness.) Delete `HIDE_DEV_CHROME` and the `addStyleTag` call and `PageLike.addStyleTag`/`locator` if nothing else uses them. The module doc and `ShotInput.spin`'s doc name `window.__e8`, not `#status`. `run.ts` help: `'         window.__e8 installed, null when that missed --budget'`. `diagnostic.ts` comment: `__e8.spin()` instead of `#spin`/`#status`.
- [ ] **Step 5:** `ide-host` ALONE + typecheck; `npm run typecheck` in `engine/examples/first-slot` (its package's own script, `-w` by its package name) — PASS / 0. Run `npx playwright test tests/e2e/headless.spec.ts` ALONE (it drives `e8 shot`) — PASS; if it asserted the old texts, move it to the new diagnostics.
- [ ] **Step 6: Commit** — `Game page: no dev toolbar or log over the game; e8 shot waits for and spins through window.__e8`.

---

### Task 8: e2e — helpers, and the first half of the specs

**Files:**
- Modify: `engine/apps/web/tests/e2e/project-fixture.ts` (helpers)
- Modify: `assets`, `build`, `canvas`, `composition`, `contract`, `debts`, `declared`, `diagnostics`, `features`, `flow`, `fx`, `game-shell`, `hot-fork`, `media`, `modern-ui` (`.spec.ts`, under `engine/apps/web/tests/e2e/`)

**Interfaces:**
- Consumes: Tasks 4–7.
- Produces (in `project-fixture.ts`, for Task 9 too):

```ts
import type { Frame, Page } from '@playwright/test';

type GameTarget = Page | Frame;
type E8 = {
  diagnostics: { severity: string }[];
  liveDiagnostics(): { severity: string; plugin: string; where: string; message: string; fix?: string }[];
  spin(opts?: { turbo?: boolean }): Promise<{ out: string }>;
  skip(): void;
};

/** The game booted: `main.ts` installs `window.__e8` exactly where `#status` used to be written. */
export async function gameBooted(target: GameTarget, timeout = 20_000): Promise<void> {
  await target.waitForFunction(() => (window as { __e8?: unknown }).__e8 !== undefined, undefined, { timeout });
}

/** What `#status` said at boot, from the same list it was computed from (`__e8.diagnostics`). */
export async function bootStatus(target: GameTarget): Promise<string> {
  return target.evaluate(() => {
    const list = (window as unknown as { __e8: E8 }).__e8.diagnostics;
    if (list.length === 0) return 'ready';
    return list.some((d) => d.severity === 'error')
      ? 'composition has errors — see log'
      : 'composition has warnings — see log';
  });
}

/** The game's own diagnostics, one line each, exactly as `#log` printed them. */
export async function gameLog(target: GameTarget): Promise<string> {
  return target.evaluate(() =>
    (window as unknown as { __e8: E8 }).__e8
      .liveDiagnostics()
      .map((d) => `[${d.severity}] ${d.plugin} (${d.where}): ${d.message}${d.fix ? ` — ${d.fix}` : ''}`)
      .join('\n'),
  );
}

/** A spin, and what `#status` said after it: `done`, or one of its two failure texts. */
export async function spinOnce(target: GameTarget, opts?: { turbo?: boolean }): Promise<string> {
  const { out } = await target.evaluate(
    (o) => (window as unknown as { __e8: E8 }).__e8.spin(o),
    opts ?? {},
  );
  return out === 'next' ? 'done' : out === 'failed' ? 'spin failed' : `left by ${out}`;
}

/** The Preview document, opened and active (a hidden pane's frame may not paint), and its game frame. */
export async function previewFrame(page: Page): Promise<Frame> {
  await page.getByTestId('activity-preview').click();
  const handle = await page.locator('iframe[title="game preview"]').elementHandle({ timeout: 20_000 });
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error('no game preview frame');
  return frame;
}
```

(The `spinOnce` port → text mapping: read how `main.ts`'s `__e8.spin()` reports a failed `present` vs a failed `spin` — both ports are named `failed` — and if the two must be told apart, return `'presentation failed — see log'` / `'spin failed — the host reported it to the IDE'` by checking which node left `failed` from `__e8.spin()`'s result; extend the hook's return with `node` if it has no way to say. Keep the assertion wording the specs already have.)

- [ ] **Step 1:** Add the helpers; `npm run typecheck -w @energy8engine/ide-web` — 0.
- [ ] **Step 2: Migrate each listed spec** by these rules, keeping every assertion's meaning:

| was | becomes |
|---|---|
| `expect(x.locator('#status')).not.toHaveText('')` / poll non-empty | `await gameBooted(x)` |
| `#status` `toHaveText('ready')` | `await gameBooted(x); expect(await bootStatus(x)).toBe('ready')` |
| `#status` `'composition has errors/warnings — see log'` | `await gameBooted(x); expect(await bootStatus(x)).toBe(<same text>)` |
| `#spin` click, then `#status` `done` / `spin failed` | `expect(await spinOnce(x)).toBe('done')` / `toContain('spin failed')` |
| `#spin` second click while busy (skip) | `x.evaluate(() => __e8.spin())` not awaited, then `x.evaluate(() => __e8.skip())` |
| `#log` text / `toContainText` | `expect.poll(() => gameLog(x)).toContain(…)` |
| `page.frameLocator('iframe[title="game preview"]')` on `#/doc/composition` | `const frame = await previewFrame(page)` after the composition edits; re-call it after anything that reloads the game |
| a `frameLocator(...).locator(...)` read of the game | the same read on `frame` (`frame.locator(...)`) |

`x` is the `Page` (a spec on `host.gameUrl`) or the `Frame`. A spec whose whole point was the composition's preview iframe (composition.spec's screenshot trick, hot-fork's marker identity) keeps its point on the Preview document's iframe: edit on the Composition tab, switch with `previewFrame(page)`, assert there. Comments that explain the old elements are reworded, not left stale.
- [ ] **Step 3:** Run the migrated specs ALONE, a few files per command (`E8_E2E_HOST_PORT=5779 npx playwright test tests/e2e/<a>.spec.ts tests/e2e/<b>.spec.ts`). All PASS. A failure is investigated — a timing change here is a real change (the frame now lives in another tab), not a flake to retry past.
- [ ] **Step 4: Commit** — `E2E: the game is driven through window.__e8 and read on the Preview document (first half)`.

---

### Task 9: e2e — the second half, the Preview's own spec, the panel and status

**Files:**
- Modify: `new-project`, `prelude`, `reel-step`, `responsive`, `runtime`, `scenes`, `schema`, `screen-demo`, `session`, `shell`, `symbols`, `tempo`, `text`, `workspace` (`.spec.ts`)
- Rewrite: `engine/apps/web/tests/e2e/screens.spec.ts`
- Create: `engine/apps/web/tests/e2e/panel.spec.ts`

**Interfaces:**
- Consumes: Task 8's helpers; Tasks 2–6's test ids.

- [ ] **Step 1:** Migrate the listed specs by Task 8's table.
- [ ] **Step 2: `screens.spec.ts`**, rewritten for one frame (keep its fixture/host setup): the Preview shows one `iframe[title="game preview"]` at 1200×675; `preview-preset` → `Mobile S` gives 320×568 and the game's `__e8`-visible session reports `device: 'mobile'` (read `session.init` through a hook the page has, or the shell's own device — check what `main.ts` exposes; add `__e8.session()` returning `ctx.session.init` if nothing does, in both `main.ts` copies); `preview-currency` → `EUR` and `preview-balance` → `250` reach the game (`__e8.session()` answers `currency.code === 'EUR'`, `balance === 250`); `preview-social` on → `social: true`; the choice survives a page reload (localStorage); Rotate swaps the frame.
- [ ] **Step 3: `panel.spec.ts`**: the Diagnostics tab is first and selected; a project with a known warning (use `projectCopy`'s option that yields exactly one project diagnostic — read `ProjectCopyOptions`) shows `panel-badge-diagnostics` = `1`; collapsing keeps `panel-diagnostics` in the DOM, hidden; the status bar's `status-game` reads `● ready` once the Preview's game booted, `◌ spinning…`/back to `● ready` around `spinOnce(frame)`; a fixture flow whose `spin` fails (reuse the failing-host setup `runtime.spec`/`diagnostics.spec` already use for `spin failed`) → `✕ spin failed`, and a click on it selects the Diagnostics tab; closing the project (or switching) → `○ no game`.
- [ ] **Step 4:** Run the migrated specs, `screens.spec.ts` and `panel.spec.ts` ALONE — PASS.
- [ ] **Step 5: Commit** — `E2E: the second half on window.__e8, the Preview toolbar reaching the game, the panel tabs and the status item`.

---

## After the tasks

Unit gate (each alone): `contracts`, `session-host`, `shell-pixi`, `ide-bridge`, `ide-client`, `ide-web`, `game-runtime`, `flow`, `play-loop`, `ide-host` (ALONE); typecheck in each. Then the full Playwright run ALONE: `cd engine/apps/web && E8_E2E_HOST_PORT=5779 npx playwright test`.
