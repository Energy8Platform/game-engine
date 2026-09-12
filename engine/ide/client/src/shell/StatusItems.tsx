import { useEffect, useState } from 'react';
import type { Context } from 'cordis';
import { useShell } from '../plugins/shell';
import { useGameDiagnostics } from '../plugins/diagnostics';
import { useGameComposition } from '../plugins/game-composition';

/**
 * The four `shell.status` contributions the design spec names (§7):
 * project name on the left, `e8-server` state / unsaved documents / the
 * theme toggle on the right. Exported and tested here, not registered —
 * `App.tsx` (Task 6) is what puts them on `shell.status` with a `key`,
 * `side` and `order`; this file only has to be correct in isolation.
 *
 * None of the four carries a `data-testid` of its own: `Shell.tsx` wraps
 * each status entry in `status-<key>`, and an item repeating that on its
 * root made `getByTestId` throw "multiple elements" (Ruling 9). A test
 * rendering an item alone reads its container or its role.
 *
 * Every component takes `{ ctx }` alone, the exact shape
 * `StatusMeta['component']` asks for, even `ThemeStatus`, which reads
 * nothing off `ctx` — the four are registered through one slot and drawn
 * by one loop in `Shell.tsx`, so a component that took a different prop
 * shape would be the one entry that loop could not call uniformly.
 */

/**
 * Left: the project's own name.
 *
 * The brief this shipped from assumed `/api/composition` carried the
 * project's name from `game/spec.json`'s `id`. Measured against
 * `runtime-assets.ts`'s own route handler: it answers `{ rows,
 * diagnostics, schema }` — `rows` built from `ctx.project.composition.rows`
 * (each one a *plugin* the game composes, e.g. `boot1`/`reels1`), never
 * from the game's own `spec.json`, which this route never reads at all.
 * There is no project-level name anywhere in that response.
 *
 * What IS there: the first row's own `id`, which is at least AN id this
 * composition carries, even though it names a plugin rather than the
 * project. Good enough for "which project is this" at a glance, and
 * honest about what it actually shows — nothing here claims it is the
 * game's own name.
 */
export function ProjectStatus({ ctx }: { ctx: Context }) {
  const { rows } = useGameComposition(ctx);
  const label = rows === null ? 'loading…' : (rows[0]?.id ?? 'no project');
  return (
    <span className="e8-status-item">
      {label}
    </span>
  );
}

/**
 * Mirrors `session-dev`'s own `RESTARTING` constant
 * (`engine/game/session-dev/src/index.ts`, value `'restarting'`) as a bare
 * string rather than importing that package: `session-dev` runs the math
 * engine host-side and has no business in a browser bundle for the sake of
 * one string this client only ever compares, never re-derives.
 */
const RESTARTING_CODE = 'restarting';

/**
 * Right: whether the game's own process is up.
 *
 * Fed by `ctx.gameDiagnostics` — the live `/ide` stream, not a boot-time
 * read — because `pid` on the host side is a getter for exactly this
 * reason (Slice 6): a status item that read it once would keep showing a
 * dead process as alive across a restart. `dev-game.ts`'s `/api/spin`
 * route tags a spin that landed mid-restart with a `restarting`-coded
 * diagnostic on the `host` source; as long as ANY group still carries one,
 * the restart is still in flight. `groups === null` (nothing has spoken
 * yet) reads as "not connected" rather than "restarting" — those are
 * different facts and the dot says so.
 */
export function SessionStatus({ ctx }: { ctx: Context }) {
  const { groups } = useGameDiagnostics(ctx);
  const restarting = (groups ?? []).some((group) =>
    group.diagnostics.some((entry) => entry.diagnostic.code === RESTARTING_CODE),
  );
  const label = restarting ? 'e8-server restarting' : groups === null ? 'e8-server ○' : 'e8-server ●';
  return (
    <span className="e8-status-item">
      {label}
    </span>
  );
}

/** Right: how many open documents have unsaved edits. */
export function DirtyStatus({ ctx }: { ctx: Context }) {
  const { documents } = useShell(ctx);
  const dirty = documents.filter((doc) => doc.dirty).length;
  return (
    <span className="e8-status-item">
      {dirty} unsaved
    </span>
  );
}

export type ThemeName = 'dark' | 'light';

const THEME_KEY = 'e8.theme';

/**
 * Failures are data (see the global constraints this task ships under): a
 * private window, or storage disabled entirely, throws on both `getItem`
 * and `setItem`. Read failures fall back to dark — the documented default
 * — and write failures are swallowed; either way the toggle still works
 * for the tab that's open, it just will not survive a reload.
 */
function readStoredTheme(): ThemeName {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function writeStoredTheme(theme: ThemeName) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private window / storage disabled — see the function doc above.
  }
}

function applyTheme(theme: ThemeName) {
  document.documentElement.dataset.theme = theme;
}

// Run once, at module load — before ANY component gets a chance to render,
// let alone `ThemeStatus` itself. A React effect runs AFTER the first
// paint, so doing this there would paint dark and then flip, visibly, on
// every load a past visit had chosen light. Evaluated as a side effect of
// importing this module, the same way `index.ts`'s own `import
// './styles.css'` is a side effect of importing IT — and for the same
// "has to happen before first paint" reason.
applyTheme(readStoredTheme());

/** Right: the dark/light toggle. Persists to `localStorage['e8.theme']`. */
export function ThemeStatus({ ctx: _ctx }: { ctx: Context }) {
  const [theme, setTheme] = useState<ThemeName>(readStoredTheme);

  // The module-level call above is what actually prevents the flash — it
  // runs at import time, before this component exists. This effect is a
  // narrower guarantee: whatever THIS component's own state says, the
  // document agrees, on every mount — not load-bearing for a real app
  // (one module evaluation already covers the one `<html>` there is), but
  // it is what keeps a test that resets the document between renders (as
  // opposed to between page loads) honest about what mounting actually
  // shows.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function toggle() {
    const next: ThemeName = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
    writeStoredTheme(next);
  }

  return (
    <button
      type="button"
      className="e8-status-item e8-theme-toggle"
      aria-label="toggle theme"
      onClick={toggle}
    >
      {theme === 'dark' ? '🌙' : '☀️'}
    </button>
  );
}
