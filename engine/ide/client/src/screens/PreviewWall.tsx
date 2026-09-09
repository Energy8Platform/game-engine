import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Context } from 'cordis';
import type { CompositionRow } from '@energy8engine/contracts';

/**
 * The preview half of the composition screen, split out of
 * `CompositionScreen.tsx` (Task 3) so it can grow into its own screen:
 * §5 of the design spec asks for a WALL — device presets, orientations,
 * languages open at once — not the single zoomed frame this file holds
 * today. This task only relocates that one frame, unchanged; the wall
 * itself, and the `PreviewWall` component this file is named for, are
 * Task 6's.
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
