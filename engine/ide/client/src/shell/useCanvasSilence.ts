import { useEffect, useRef } from 'react';
import type { CanvasRpc } from './canvas-rpc';

/** The Reels/Symbols status line's text when a canvas never answers `ready`. */
export const CANVAS_SILENT = 'the canvas did not answer — see the diagnostics panel';

/**
 * A canvas that never answers at all — its page threw before scene-edit
 * booted, or the project's editor page is broken — would leave the
 * document silent. `ms` after `key` changes (a new canvas mounted) with
 * neither a `ready` nor an `error`, `onSilent` runs once. An `error` counts
 * as an answer too: the canvas DID say something, so whatever message the
 * caller's own `error` handler put up is the honest one and must survive
 * past `ms` — only a `ready` (now or on a later remount) calls `onReady`,
 * clearing a stale message.
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
    const offReady = rpc.on('ready', () => {
      answered = true;
      handlers.current.onReady();
    });
    const offError = rpc.on('error', () => {
      answered = true;
    });
    const timer = setTimeout(() => {
      if (!answered) handlers.current.onSilent();
    }, ms);
    return () => {
      offReady();
      offError();
      clearTimeout(timer);
    };
  }, [rpc, key, ms]);
}
