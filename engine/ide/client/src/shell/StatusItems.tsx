import { useEffect, useState } from 'react';
import type { Context } from 'cordis';
import { useShell } from '../plugins/shell';
import { useGameDiagnostics } from '../plugins/diagnostics';
import { useWorkspace } from '../plugins/workspace';

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
 * Left: the active project's own name — `Project.name`, off the workspace
 * the host tells this client about (spec §8). Before the first answer
 * `loading…`; no project open, `no project`; an active id the list does
 * not carry (a host mid-change) falls back to the id itself.
 *
 * This used to show the first composition row's `id` — a PLUGIN's id, the
 * closest thing `/api/composition` carried to a name before the host had
 * a workspace at all.
 */
export function ProjectStatus({ ctx }: { ctx: Context }) {
  const workspace = useWorkspace(ctx);
  const label =
    workspace === null
      ? 'loading…'
      : workspace.active === null
        ? 'no project'
        : (workspace.projects.find((p) => p.id === workspace.active)?.name ?? workspace.active);
  return <span className="e8-status-item">{label}</span>;
}

/**
 * Mirrors `session-dev`'s own `RESTARTING` constant
 * (`engine/game/session-dev/src/index.ts`, value `'restarting'`) as a bare
 * string rather than importing that package: `session-dev` runs the math
 * engine host-side and has no business in a browser bundle for the sake of
 * one string this client only ever compares, never re-derives.
 */
const RESTARTING_CODE = 'restarting';
/** `session-dev`'s `EXITED` (`'exited'`) — the same arrangement as above. */
const EXITED_CODE = 'exited';

/**
 * Right: whether the game's own process is up.
 *
 * Fed by `ctx.gameDiagnostics` — the live `/ide` stream, not a boot-time
 * read — because `pid` on the host side is a getter for exactly this
 * reason (Slice 6): a status item that read it once would keep showing a
 * dead process as alive across a restart. A `restarting`-coded row in ANY
 * group reads as a restart still in flight — `session-dev` tags the
 * answer a spin gets mid-restart with it, but today no frame carries it:
 * `dev-game.ts`'s `/api/spin` route filters that wait out of what it
 * reports (a wait is not a failure), and its restart report lands only
 * once the restart has settled. The branch stays for a speaker that
 * says it; its precedence over `exited` has no producer to test against
 * (see status-items.test.tsx). An `exited`-coded row is the host saying
 * the process died (`session/exited`, relayed by `dev-game.ts`) — the dot
 * hollows and says why, until the next save's clean restart takes the row
 * back. `groups === null` (nothing has spoken yet) reads as "not
 * connected" rather than either — those are different facts and the dot
 * says so.
 */
export function SessionStatus({ ctx }: { ctx: Context }) {
  const { groups } = useGameDiagnostics(ctx);
  const has = (code: string) =>
    (groups ?? []).some((group) =>
      group.diagnostics.some((entry) => entry.diagnostic.code === code),
    );
  // A restart in flight outranks the death it is about to cure.
  const label = has(RESTARTING_CODE)
    ? 'e8-server restarting'
    : has(EXITED_CODE)
      ? 'e8-server ○ exited'
      : groups === null
        ? 'e8-server ○'
        : 'e8-server ●';
  return <span className="e8-status-item">{label}</span>;
}

/** Right: how many open documents have unsaved edits. */
export function DirtyStatus({ ctx }: { ctx: Context }) {
  const { documents } = useShell(ctx);
  const dirty = documents.filter((doc) => doc.dirty).length;
  return <span className="e8-status-item">{dirty} unsaved</span>;
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
