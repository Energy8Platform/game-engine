import { useState } from 'react';
import type { Context } from 'cordis';
import { DEV_CURRENCIES } from '@energy8engine/contracts';
import { useGameComposition } from '../plugins/game-composition';
import { useWorkspace } from '../plugins/workspace';
import { BALANCE_LEVELS, isBalanceLevel } from './balanceLevels';
import { LANGS } from './langs';
import { SCREEN_PRESETS, screenPreset } from './screenPresets';

/**
 * The user tried the wall (§5's device presets, orientations and languages
 * open at once) and asked for the legacy harness instead: ONE frame, a
 * toolbar to switch resolution/language/currency/social/balance, 1:1 —
 * the stage scrolls rather than the frame shrinking to fit. `PreviewWall`
 * is gone; this is the whole preview screen now.
 *
 * `SCREEN_PRESETS`/`screenPreset` (`./screenPresets`) and `LANGS`
 * (`./langs`) are read from PINNED COPIES of the same-named exports in
 * `@energy8platform/harness`, not that package itself. This app tried
 * depending on the package directly first; that broke the running app in
 * a real browser and broke `vite build`, because the package's only
 * public entry welds that data to a Node-only dev plugin at its module
 * boundary, and `packages/*` is read-only so that boundary cannot be
 * fixed from here. See `screenPresets.ts`'s own doc for the full account,
 * and `tests/screen-presets-sync.test.ts` for the thing that makes a copy
 * an acceptable answer: it imports the real package (safe there — vitest
 * runs on real Node) and fails if this copy drifts from it on any field
 * this screen actually reads.
 */

/**
 * Where the running game is served comes from the HOST now —
 * `WorkspaceState.previewUrl`, `null` when no project is open (or its
 * preview failed to bind). This used to be a `computePreviewUrl()`
 * hardcoding `:5679` — the fourth spelling of the Slice 0 convention —
 * which stopped being true the moment a host could hold several projects
 * and open none. `null` draws this note instead of an iframe.
 */
function Unavailable() {
  return (
    <p className="e8-empty" data-testid="preview-unavailable">
      preview unavailable: no project open
    </p>
  );
}

/**
 * No workspace answer yet is not "no project" (`WorkspaceClientService.state`'s
 * own doc) — so the frame is `loading…`, and only a `null` `previewUrl` from
 * an answered host draws `Unavailable`.
 */
function Frame({
  ctx,
  children,
}: {
  ctx: Context;
  /** `active` is part of every iframe's key — see `Preview`'s own doc. */
  children: (previewUrl: string, active: string | null) => JSX.Element;
}) {
  const state = useWorkspace(ctx);
  if (state === null) {
    return (
      <p className="e8-empty" data-testid="preview-loading">
        loading…
      </p>
    );
  }
  if (state.previewUrl === null) return <Unavailable />;
  return children(state.previewUrl, state.active);
}

export interface PreviewProps {
  ctx: Context;
}

export interface PreviewState {
  preset: string;
  rotated: boolean;
  lang: string;
  currency: string;
  /** A harness balance level (major units) — see `balanceLevels.ts`. */
  balance: number;
  /** Bumped on every balance pick and on `↺`, so each is a fresh wallet (Task 1's `?wallet=<n>` contract). */
  wallet: number;
  social: boolean;
}

export const DEFAULT_PREVIEW_STATE: PreviewState = {
  preset: SCREEN_PRESETS[0].name,
  rotated: false,
  lang: 'en',
  currency: 'USD',
  balance: 10_000,
  wallet: 0,
  social: false,
};

const STORAGE_KEY = 'e8.preview';

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
  url.searchParams.set('balance', String(s.balance));
  url.searchParams.set('wallet', String(s.wallet));
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
  const n = Number(stored.balance);
  return {
    preset: preset && screenPreset(preset) ? preset : d.preset,
    rotated: typeof stored.rotated === 'boolean' ? stored.rotated : d.rotated,
    lang: lang && LANGS.some((l) => l.code === lang) ? lang : d.lang,
    currency: currency && Object.hasOwn(DEV_CURRENCIES, currency) ? currency : d.currency,
    balance: Number.isFinite(n) && isBalanceLevel(n) ? n : d.balance,
    wallet:
      Number.isSafeInteger(stored.wallet) && (stored.wallet as number) >= 0
        ? (stored.wallet as number)
        : d.wallet,
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

/**
 * The running game, in an iframe pointed where the host says it is served
 * (`previewUrl` — see `Unavailable`), addressed with the toolbar's current
 * choice (`previewAddress`).
 *
 * Whether an edit needs this frame reloaded is the HOST's verdict:
 * `GameCompositionMessage.reload`, decided from the edited row's `hot`
 * and the changed keys' `applies: 'restart'` (`runtime-assets.ts`'s
 * `PUT`). `gameComposition.reloads` counts the `true` frames, and that
 * count is part of the iframe's key — so every such frame unmounts and
 * remounts a genuinely new `<iframe>` element, a real navigation, not
 * merely a `src` reassignment on the same node. A `false` frame is one
 * the game applied in place (`ide-bridge` re-applies the row's fiber),
 * and touches nothing here: the session and the balance live on. The
 * frame's address is also part of the key, for the same reason: a
 * toolbar choice that changes what the game is told (currency, balance,
 * …) is as much a new game as a different `previewUrl` is — reassigning
 * `src` on the same node would leave the OLD session running underneath.
 *
 * RESIZE, not relaunch: the preset and `rotated` are deliberately NOT part
 * of the key, only `previewAddress`'s output is (via `src`, and only for
 * `device`, which `previewAddress` sets from the preset's name). Rotate
 * and a preset switch within the same device class (Desktop→Laptop: no
 * name starts with `Mobile`) leave the address untouched, so the iframe
 * keeps its identity and only its `width`/`height` props change — a live
 * resize of the running game, the same thing the legacy harness's
 * `applyScreen` ever did (it only ever set the iframe's own width/height,
 * never re-pointed its `src`). A preset whose name starts with `Mobile`
 * changes `device` in the address, which IS as much a new game as a
 * `previewUrl`/`reload` change — so that one relaunches like any other
 * address change (currency, lang, balance, social).
 *
 * `↻` (`refreshes`) is a relaunch at the SAME address: `previewAddress`
 * already sends `balance`/`currency`/`wallet` on every request, and
 * `session-host` folds them into its `sessionStorage` wallet key
 * (`e8:wallet:<gameId>:<balance>:<currency>:<wallet>`, Task 1) — so an
 * unchanged address means an unchanged key, and the wallet survives the
 * refresh even though the iframe element itself is new. A balance pick or
 * `↺` bumps `wallet`, which DOES change the address (and so the key) —
 * a deliberate fresh wallet, not a refresh.
 */
export function Preview({ ctx }: PreviewProps) {
  const { reloads } = useGameComposition(ctx);
  const [state, setState] = useState<PreviewState>(readPreviewState);
  const [refreshes, setRefreshes] = useState(0);

  function update(patch: Partial<PreviewState>) {
    const next = { ...state, ...patch };
    writePreviewState(next);
    setState(next);
  }

  const preset = screenPreset(state.preset) ?? screenPreset(DEFAULT_PREVIEW_STATE.preset)!;
  const w = state.rotated ? preset.h : preset.w;
  const h = state.rotated ? preset.w : preset.h;

  return (
    <main className="e8-preview-doc">
      <div className="e8-preview-toolbar">
        <label htmlFor="preview-preset">screen</label>
        <select
          id="preview-preset"
          data-testid="preview-preset"
          value={state.preset}
          onChange={(event) => update({ preset: event.target.value })}
        >
          {SCREEN_PRESETS.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name} — {p.w}×{p.h}
            </option>
          ))}
        </select>

        <button type="button" data-testid="preview-rotate" onClick={() => update({ rotated: !state.rotated })}>
          Rotate
        </button>

        <button
          type="button"
          data-testid="preview-refresh"
          aria-label="refresh"
          title="refresh"
          onClick={() => setRefreshes((n) => n + 1)}
        >
          ↻
        </button>

        <label htmlFor="preview-lang">language</label>
        <select
          id="preview-lang"
          data-testid="preview-lang"
          value={state.lang}
          onChange={(event) => update({ lang: event.target.value })}
        >
          {LANGS.map((entry) => (
            <option key={entry.code} value={entry.code}>
              {entry.label}
            </option>
          ))}
        </select>

        <label htmlFor="preview-currency">currency</label>
        <select
          id="preview-currency"
          data-testid="preview-currency"
          value={state.currency}
          onChange={(event) => update({ currency: event.target.value })}
        >
          {Object.keys(DEV_CURRENCIES).map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>

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

        <label>
          <input
            type="checkbox"
            data-testid="preview-social"
            checked={state.social}
            onChange={(event) => update({ social: event.target.checked })}
          />
          social
        </label>
      </div>

      <Frame ctx={ctx}>
        {(previewUrl, active) => {
          const src = previewAddress(previewUrl, state);
          return (
            <div className="e8-preview-stage" data-testid="preview-stage">
              <iframe
                key={`${reloads}:${refreshes}:${active}:${src}`}
                className="e8-preview"
                title="game preview"
                width={w}
                height={h}
                src={src}
              />
            </div>
          );
        }}
      </Frame>
    </main>
  );
}
