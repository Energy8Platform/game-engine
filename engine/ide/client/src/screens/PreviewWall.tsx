import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Context } from 'cordis';
import { diagnostic, type CompositionRow } from '@energy8engine/contracts';
import { useWorkspace } from '../plugins/workspace';
import { LANGS } from './langs';
import { SCREEN_PRESETS, screenPreset } from './screenPresets';

/**
 * The preview half of the composition screen, split out of
 * `CompositionScreen.tsx` (Task 3) so it could grow into its own screen:
 * §5 of the design spec asks for a WALL — device presets, orientations,
 * languages open at once — not the single zoomed frame `Preview` (below)
 * draws. Task 3 only relocated that one frame, unchanged; `PreviewWall`,
 * further down, is the wall itself.
 *
 * `SCREEN_PRESETS`/`screenPreset`/`LANGS` are read from `./screenPresets`/
 * `./langs` — PINNED COPIES of the same-named exports in
 * `@energy8platform/harness`, not that package itself. This app tried
 * depending on the package directly first (fix round 1's own history);
 * that broke the running app in a real browser and broke `vite build`,
 * because the package's only public entry welds that data to a Node-only
 * dev plugin at its module boundary, and `packages/*` is read-only so that
 * boundary cannot be fixed from here. See `screenPresets.ts`'s own doc for
 * the full account, and `tests/screen-presets-sync.test.ts` for the thing
 * that makes a copy an acceptable answer: it imports the real package
 * (safe there — vitest runs on real Node) and fails if this copy drifts
 * from it on any field `PreviewWall` actually reads.
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

/** Config fingerprint of every `hot: false` row — see `Preview`'s doc comment for what this drives. */
function coldSignature(rows: CompositionRow[]): string {
  return JSON.stringify(rows.filter((row) => !row.hot).map((row) => [row.id, row.config]));
}

export interface PreviewProps {
  ctx: Context;
}

/**
 * The running game, in an iframe pointed where the host says it is served
 * (`previewUrl` — see `Unavailable`).
 *
 * A snapshot whose only changes are to `hot: true` rows never touches this
 * component's own state at all: a plugin that declares `hot: true` (today,
 * `@energy8engine/ide-bridge`) pushes its own update straight into the
 * already-running game over the SAME `/ide` websocket this screen itself
 * uses — `rpc.ts` broadcasts to every connected socket, not just the IDE's
 * own tab — with no reload anywhere. A change to any `hot: false` row's
 * config, though, is one the host could only apply by tearing that plugin
 * down and re-applying it (see `composition.ts`'s `update()`); nothing
 * guarantees the ALREADY-RUNNING game picked that up on its own, so the
 * honest thing to do is reload the iframe rather than silently hope it
 * did. `key={reloadNonce}` forces React to unmount and remount a genuinely
 * new `<iframe>` element — a real navigation — not merely reassign `src`
 * on the same node. A different `previewUrl` (another project opened) is
 * part of that key for the same reason.
 */
export function Preview({ ctx }: PreviewProps) {
  const snapshot = useSyncExternalStore(ctx.connection.subscribe, () => ctx.connection.snapshot);
  const previewUrl = useWorkspace(ctx)?.previewUrl ?? null;
  const signatureRef = useRef<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    if (!snapshot) return;
    const next = coldSignature(snapshot.rows);
    if (signatureRef.current === null) {
      signatureRef.current = next; // first snapshot — establishes the baseline, not a change to react to
      return;
    }
    if (next !== signatureRef.current) {
      signatureRef.current = next;
      setReloadNonce((n) => n + 1);
    }
  }, [snapshot]);

  if (previewUrl === null) return <Unavailable />;
  return (
    <iframe
      key={`${reloadNonce}:${previewUrl}`}
      className="e8-preview"
      title="превью игры"
      src={previewUrl}
    />
  );
}

/**
 * The wall's own default selection — a FEW presets, not all seven. Every
 * tile below is a whole game: it boots Pixi and opens its own `/ide`
 * websocket (the same channel `Preview`, above, uses — see its own doc).
 * Showing all seven the moment a human opens this screen would mean seven
 * Pixi apps and seven sockets before anyone asked for any of them; three —
 * spanning desktop, laptop and a small popout — is enough to prove this is
 * a WALL rather than one frame with a zoom, and the rest are one checkbox
 * away. Sliced from `SCREEN_PRESETS` itself, in its own "bar order", rather
 * than named again here — so a reordering of that list is reflected
 * automatically instead of silently drifting from this default.
 */
const DEFAULT_PRESET_NAMES: readonly string[] = SCREEN_PRESETS.slice(0, 3).map(
  (preset) => preset.name,
);

const DEFAULT_LANG = 'en';

/** An `id` attribute may not contain whitespace; a preset's name can (`"Mobile S"`). */
function presetInputId(name: string): string {
  return `preview-preset-${name.replace(/\s+/g, '-')}`;
}

/**
 * One tile's address: the SAME origin `Preview` resolves (the host's
 * `previewUrl`), carrying this ONE tile's own game identity and the wall's
 * current language.
 *
 * The `game` param is what `ide-bridge` reads back from its own page's
 * address (`IdeBridgeConfig.game`'s own doc: "the address this game was
 * OPENED AT already carries it") and stamps onto every diagnostics frame it
 * sends (Task 4's `GameDiagnosticsMessage.game`) — without it, every tile
 * would open the identical address and the host could not tell one tile's
 * report from another's, the exact defect Tasks 4 and 5 closed. A preset's
 * own NAME is already unique across `SCREEN_PRESETS`, so it doubles as a
 * legible identity for free — `DiagnosticsPanel` renders it verbatim as
 * `game "Mobile S"`, which tells a human more than an opaque `tile-3` would.
 */
function tileUrl(base: string, name: string, lang: string): string {
  const url = new URL(base);
  url.searchParams.set('game', name);
  url.searchParams.set('lang', lang);
  return url.toString();
}

export interface PreviewWallProps {
  ctx: Context;
  /**
   * Preset names to show. Omitted, the wall picks its own small default —
   * every tile is a whole game booting Pixi and opening a socket, so the
   * default is a few, not all seven. Present, it is what the tests pass to
   * pin a case, including a name the harness does not know.
   *
   * Read only once, to seed the wall's own selection state: nothing here
   * hands a caller a way to change it after mount — the checkboxes below
   * own that from here on — and the running IDE never passes it at all
   * (`App.tsx` registers this screen with `ctx` alone). A prop that only
   * ever seeds a `useState` and is never varied by a later render is the
   * honest shape for what this one, in practice, is: a test seam for
   * pinning a case, not a live control a caller keeps driving.
   */
  chosen?: readonly string[];
}

/**
 * §5 of the design spec's wall: device presets, orientations and languages
 * open at once, so a human can see how a game reads across all three
 * without opening seven browser tabs by hand. Three axes, three pieces of
 * state — which presets are chosen, whether they are rotated, and which
 * language every tile addresses itself in — feeding one small pure
 * function (`tileUrl`) that turns a preset's name into one tile's address.
 *
 * **Failures are data.** A chosen name `screenPreset` does not resolve is
 * not this screen's to throw over: `ctx.connection.report` says so, on the
 * SAME list `DiagnosticsPanel` already renders, and the render below simply
 * does not draw a tile for it — a diagnostic and a skipped tile, never a
 * crashed screen.
 */
export function PreviewWall({ ctx, chosen }: PreviewWallProps) {
  const [selected, setSelected] = useState<string[]>(() =>
    chosen !== undefined ? [...chosen] : [...DEFAULT_PRESET_NAMES],
  );
  const [rotated, setRotated] = useState(false);
  const [lang, setLang] = useState(DEFAULT_LANG);
  const previewUrl = useWorkspace(ctx)?.previewUrl ?? null;

  useEffect(() => {
    // `ctx.connection.report` collapses a byte-identical repeat on its own
    // (see `connection.ts`'s own dedupe), so re-running this whenever
    // `selected` changes costs nothing beyond the first report of each
    // still-unknown name.
    for (const name of selected) {
      if (screenPreset(name)) continue;
      ctx.connection.report(
        diagnostic(
          'warning',
          name,
          'preview',
          `the wall was asked to show preset "${name}", which SCREEN_PRESETS does not define`,
          'check the preset name against SCREEN_PRESETS, or add it there',
        ),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, selected]);

  function toggle(name: string) {
    setSelected((prev) =>
      prev.includes(name) ? prev.filter((existing) => existing !== name) : [...prev, name],
    );
  }

  return (
    <main className="e8-preview-wall">
      <h1>Превью</h1>

      <div className="e8-preview-wall-controls">
        <fieldset className="e8-preview-wall-presets">
          <legend>screens</legend>
          {SCREEN_PRESETS.map((preset) => (
            <span key={preset.name} className="e8-preview-wall-preset-toggle">
              <input
                id={presetInputId(preset.name)}
                type="checkbox"
                checked={selected.includes(preset.name)}
                onChange={() => toggle(preset.name)}
              />
              <label htmlFor={presetInputId(preset.name)}>{preset.name}</label>
            </span>
          ))}
        </fieldset>

        <button type="button" onClick={() => setRotated((value) => !value)}>
          Rotate
        </button>

        <span className="e8-preview-wall-lang">
          <label htmlFor="preview-wall-lang">language</label>
          <select
            id="preview-wall-lang"
            value={lang}
            onChange={(event) => setLang(event.target.value)}
          >
            {LANGS.map((entry) => (
              <option key={entry.code} value={entry.code}>
                {entry.label}
              </option>
            ))}
          </select>
        </span>
      </div>

      {previewUrl === null ? (
        <Unavailable />
      ) : (
        <div className="e8-preview-wall-tiles">
          {selected.map((name) => {
            const preset = screenPreset(name);
            // Reported above; drawing nothing here is the other half of
            // "a diagnostic and a skipped tile, not a crashed screen".
            if (!preset) return null;
            const width = rotated ? preset.h : preset.w;
            const height = rotated ? preset.w : preset.h;
            return (
              <iframe
                key={name}
                data-testid={`tile-${name}`}
                title={`preview: ${name}`}
                className="e8-preview-tile"
                width={width}
                height={height}
                src={tileUrl(previewUrl, name, lang)}
              />
            );
          })}
        </div>
      )}
    </main>
  );
}
