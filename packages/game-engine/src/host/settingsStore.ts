import type { Shell } from '@energy8platform/shell/pixi';

/**
 * Per-game persistence of the player's shell preferences — turbo level and every menu value
 * (sound, music, sfx, and any custom row) — in `localStorage`.
 *
 * Opt-in via `createSlotGame({ persistSettings })`. A game that doesn't ask for it behaves exactly
 * as before: nothing is read, nothing is written, no storage is touched.
 *
 * Scoped per game, because these are per-game preferences: a player who mutes one slot has not
 * asked to mute the next one. The key is `e8:<gameId>:settings`.
 */
export interface PersistSettingsOptions {
  /** Key namespace. Defaults to the game id, so two games never share a preference set. */
  key?: string;
  /** Backing store. Defaults to `window.localStorage`; pass one in tests, or `null` to disable. */
  storage?: Storage | null;
}

/** What we keep. `menu` covers presets and custom rows alike — `setMenuValue` routes both. */
export interface StoredSettings {
  turbo?: number;
  menu?: Record<string, boolean | number>;
}

export function settingsKey(gameId: string): string {
  return `e8:${gameId}:settings`;
}

/**
 * `localStorage` is not reliably there and not reliably usable: Safari's private mode, a browser
 * configured to block storage, and a full quota can all make even a READ throw. A saved turbo level
 * is never worth failing a game boot over, so every access degrades to "no persistence".
 */
function resolveStorage(explicit?: Storage | null): Storage | null {
  if (explicit !== undefined) return explicit;
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** A menu value is a boolean or a finite number — nothing else may reach the shell. */
function isMenuValue(v: unknown): v is boolean | number {
  return typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
}

/**
 * Read and VALIDATE. Whatever is in `localStorage` is player-writable — anyone can open devtools
 * and put a string, an object, or `turbo: 99` in there. It is parsed as untrusted input: a bad
 * field is dropped, not coerced, and a bad blob yields nothing at all.
 */
export function readSettings(storage: Storage | null, key: string): StoredSettings {
  if (!storage) return {};
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return {};
  }
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const src = parsed as Record<string, unknown>;
  const out: StoredSettings = {};
  if (typeof src.turbo === 'number' && Number.isInteger(src.turbo) && src.turbo >= 0) {
    out.turbo = src.turbo;
  }
  if (src.menu && typeof src.menu === 'object' && !Array.isArray(src.menu)) {
    const menu: Record<string, boolean | number> = {};
    for (const [id, value] of Object.entries(src.menu as Record<string, unknown>)) {
      if (isMenuValue(value)) menu[id] = value;
    }
    if (Object.keys(menu).length) out.menu = menu;
  }
  return out;
}

function writeSettings(storage: Storage | null, key: string, value: StoredSettings): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota, private mode, or storage disabled mid-session. The player keeps playing; only the
    // memory of their preference is lost, and that is not worth an error in their face.
  }
}

/**
 * Restore the stored preferences onto a freshly created shell, then keep them in step.
 *
 * Returns an unsubscribe function.
 *
 * Two things are deliberate here:
 *
 *  - **`maxTurbo` clamps the restored level.** `features.turbo` is the CEILING the shell offers
 *    (`applyJurisdiction` lowers it where super-turbo or turbo is forbidden), while `state.turbo`
 *    is what the player currently has. Restoring a saved 3 into a jurisdiction capped at 1 would
 *    hand back exactly what the restriction took away, so the stored value is clamped, never
 *    trusted.
 *  - **Subscription happens AFTER restoring.** `setMenuValue` emits `settingChange`, so subscribing
 *    first would have the restore write back what it just read. (`setTurbo` is quiet — only the
 *    bar tap emits `turboChange` — which is why restoring the level can't echo. Do not "fix" that
 *    asymmetry without moving this subscription.)
 */
export function attachSettingsStore(
  shell: Shell,
  opts: { key: string; storage?: Storage | null; maxTurbo?: number },
): () => void {
  const storage = resolveStorage(opts.storage);
  const key = settingsKey(opts.key);
  const stored = readSettings(storage, key);

  if (stored.turbo !== undefined) {
    shell.setTurbo(Math.min(stored.turbo, opts.maxTurbo ?? stored.turbo));
  }
  for (const [id, value] of Object.entries(stored.menu ?? {})) {
    // `setMenuValue` routes presets to their own homes (sound → setSound, music/sfx → setVolume)
    // and clamps custom ranges, so one loop covers every row and the shell owns the bounds.
    shell.setMenuValue(id, value);
  }

  const live: StoredSettings = { ...stored };
  const flush = (): void => writeSettings(storage, key, live);

  const onTurbo = (level: number): void => {
    live.turbo = level;
    flush();
  };
  const onSetting = ({ key: id, value }: { key: string; value: unknown }): void => {
    if (!isMenuValue(value)) return;
    live.menu = { ...live.menu, [id]: value };
    flush();
  };
  shell.on('turboChange', onTurbo);
  shell.on('settingChange', onSetting);

  return () => {
    shell.off('turboChange', onTurbo);
    shell.off('settingChange', onSetting);
  };
}
