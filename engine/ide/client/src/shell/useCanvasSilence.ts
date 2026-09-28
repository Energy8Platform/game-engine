import { useEffect, useRef } from 'react';
import type { CanvasRpc } from './canvas-rpc';

/** The Reels/Symbols status line's text when a canvas never answers `ready`. */
export const CANVAS_SILENT = 'the canvas did not answer — see the diagnostics panel';

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
): void {
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
