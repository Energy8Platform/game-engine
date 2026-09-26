import { useState } from 'react';
import type { Context } from 'cordis';
import { DEV_CURRENCIES } from '@energy8engine/contracts';
import { useGameComposition } from '../plugins/game-composition';
import { useWorkspace } from '../plugins/workspace';
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
 */
export function Preview({ ctx }: PreviewProps) {
  const { reloads } = useGameComposition(ctx);
  const [state, setState] = useState<PreviewState>(readPreviewState);
  const [draft, setDraft] = useState(state.balance);
  const [invalid, setInvalid] = useState(false);

  function update(patch: Partial<PreviewState>) {
    setState((prev) => {
      const next = { ...prev, ...patch };
      writePreviewState(next);
      return next;
    });
  }

  function commitBalance() {
    if (!validBalance(draft)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    update({ balance: draft });
  }

  const preset = screenPreset(state.preset) ?? screenPreset(DEFAULT_PREVIEW_STATE.preset)!;
  const w = state.rotated ? preset.h : preset.w;
  const h = state.rotated ? preset.w : preset.h;

  return (
    <main className="e8-preview-doc">
      <div className="e8-preview-toolbar">
        <select
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

        <select
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

        <select
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

        <input
          data-testid="preview-balance"
          inputMode="decimal"
          placeholder="1000"
          value={draft}
          aria-invalid={invalid || undefined}
          onChange={(event) => {
            setDraft(event.target.value);
            setInvalid(false);
          }}
          onBlur={commitBalance}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitBalance();
          }}
        />

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
                key={`${reloads}:${active}:${src}`}
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
