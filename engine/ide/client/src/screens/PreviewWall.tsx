import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Context } from 'cordis';
import { diagnostic, type CompositionRow } from '@energy8engine/contracts';
import { LANGS, SCREEN_PRESETS, screenPreset } from '@energy8platform/harness';

/**
 * The preview half of the composition screen, split out of
 * `CompositionScreen.tsx` (Task 3) so it could grow into its own screen:
 * §5 of the design spec asks for a WALL — device presets, orientations,
 * languages open at once — not the single zoomed frame `Preview` (below)
 * draws. Task 3 only relocated that one frame, unchanged; `PreviewWall`,
 * further down, is the wall itself.
 *
 * `SCREEN_PRESETS`/`screenPreset`/`LANGS` come from
 * `@energy8platform/harness` — the SAME seven presets and sixteen
 * languages the dev harness already frames a game at, not a second list
 * hand-copied here to drift from the first. `packages/*` is legacy and
 * read-only, but depending on it is already established elsewhere in this
 * engine (`engine/game/runtime` on `@energy8platform/game-engine`); a
 * second source of truth for the sizes behaviour is checked at would be
 * worse than the dependency.
 */

/**
 * The origin `dev-game`'s catch-all route serves the running game from —
 * the SAME ide-host `e8 dev` boots (see its module doc: "one server, two
 * consumers"). `apps/web/vite.config.ts`'s own dev-server proxy already
 * targets this exact host:port for `/api`, `/plugin-client` and `/ide` —
 * but deliberately NOT for `/` itself (that's this SPA's own root), so the
 * preview iframe has to address the ide-host directly instead of going
 * through that proxy. The host:port pair is hardcoded in three other
 * places already for the same reason (that vite config's own `HOST`
 * constant, `IdeHostOptions`'s default port, every e2e fixture that boots
 * a host) — this is the fourth spelling of the same Slice 0 convention,
 * not a new one.
 */
export function computePreviewUrl(): string {
  return `${location.protocol}//${location.hostname}:5679`;
}

/** Config fingerprint of every `hot: false` row — see `Preview`'s doc comment for what this drives. */
function coldSignature(rows: CompositionRow[]): string {
  return JSON.stringify(rows.filter((row) => !row.hot).map((row) => [row.id, row.config]));
}

export interface PreviewProps {
  ctx: Context;
  /** Defaults to `computePreviewUrl()` — overridable so a test never depends on `location`. */
  url?: string;
}

/**
 * The running game, in an iframe pointed at the SAME server `dev-game`
 * serves it from — never a second one (see `computePreviewUrl`).
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
 * on the same node.
 */
export function Preview({ ctx, url }: PreviewProps) {
  const snapshot = useSyncExternalStore(ctx.connection.subscribe, () => ctx.connection.snapshot);
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

  return (
    <iframe
      key={reloadNonce}
      className="e8-preview"
      title="превью игры"
      src={url ?? computePreviewUrl()}
      style={{ width: '100%', height: 420, border: '1px solid #333' }}
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
 * One tile's address: the SAME origin `Preview` resolves (`dev-game`'s
 * catch-all route, on the fixed host:port — see `computePreviewUrl`'s own
 * doc), carrying this ONE tile's own game identity and the wall's current
 * language.
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
function tileUrl(name: string, lang: string): string {
  const url = new URL(computePreviewUrl());
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
          `the wall was asked to show preset "${name}", which @energy8platform/harness does not define`,
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
              src={tileUrl(name, lang)}
            />
          );
        })}
      </div>
    </main>
  );
}
