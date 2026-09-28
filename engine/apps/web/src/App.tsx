import { useEffect } from 'react';
import type { Context } from 'cordis';
import {
  CompositionScreen,
  DiagnosticsPanel,
  DirtyStatus,
  Explorer,
  GameStatus,
  Preview,
  ProjectStatus,
  Projects,
  SessionStatus,
  Shell,
  ThemeStatus,
  openPath,
  useEditorDiagnostics,
  useGameComposition,
  useGameDiagnostics,
} from '@energy8engine/ide-client';

/**
 * A document is mounted as `<component ctx={ctx} />` — `ctx` alone — so
 * the GAME's resolved composition rows, which `App` used to read once for
 * itself and hand down, are fetched right here instead, one level lower.
 */
function CompositionDocument({ ctx }: { ctx: Context }) {
  const { rows } = useGameComposition(ctx);
  return <CompositionScreen ctx={ctx} rows={rows ?? undefined} />;
}

/**
 * The one diagnostics list (spec §8): the project's own, the game's own
 * and the editor's, read reactively — a wrapper that read them once at
 * registration would go stale the moment any of the three updates. This
 * was `Layout.tsx`'s `DiagnosticsPanelEntry`; as a `shell.panel` entry it
 * sits under whichever document is active rather than pinned to one.
 *
 * Task 4 moved the panel's own heading and count out to the tab strip
 * (`Shell.tsx`'s `.e8-panel-tab`): the count is `ctx.shell.setPanelBadge`,
 * pushed here rather than read by the strip itself, because only this
 * component sees the three live sources — the strip only ever sees a
 * plugin's chosen key and whatever it last pushed. Errors and warnings
 * count; `info` does not — the same severities a person would call
 * "something to fix" versus "worth knowing".
 */
function DiagnosticsDocument({ ctx }: { ctx: Context }) {
  const { diagnostics: project } = useGameComposition(ctx);
  const { groups: game, dropped } = useGameDiagnostics(ctx);
  const editor = useEditorDiagnostics(ctx);
  const count = [
    ...project,
    ...(game ?? []).flatMap((group) => group.diagnostics.map((entry) => entry.diagnostic)),
    ...editor,
  ].filter((d) => d.severity === 'error' || d.severity === 'warning').length;
  useEffect(() => ctx.shell.setPanelBadge('diagnostics', count), [ctx, count]);
  return (
    <DiagnosticsPanel project={project} game={game} droppedFromGame={dropped} editor={editor} />
  );
}

/**
 * The app shell. Registers what the engine ships into the shell's slots and
 * draws `<Shell/>` — it does not render a document itself, and does not
 * know how many are registered; a plugin's own document is one more
 * `ctx.slots.register` away, made by whichever plugin owns it.
 *
 * Every registration is an effect with a disposer, in the order the
 * activity bar shows them — Explorer, composition, preview — plus the
 * projects list, which `order: -1` draws first. The two shipped
 * documents are contributed (`shell.document`, not closable) and reached
 * from the activity bar (`opens: 'document'`); Explorer opens a sidebar.
 *
 * `ctx.shell.ready()` is the LAST effect, on purpose: effects run in
 * declaration order, and a deep link like `#/doc/preview` must not be
 * checked before `preview` is registered — the false "not registered"
 * diagnostic slice 6 recorded as debt. `ready()` is idempotent, so a
 * re-run of this effect (a new `ctx`) is harmless.
 */
export function App({ ctx }: { ctx: Context }) {
  useEffect(() => {
    return ctx.slots.register({
      name: 'shell.activity',
      key: 'explorer',
      title: 'Explorer',
      icon: 'files',
      order: 0,
      opens: 'sidebar',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  useEffect(() => {
    return ctx.slots.register(
      { name: 'shell.sidebar', key: 'explorer', title: 'Explorer' },
      Explorer,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  // Registered after the Explorer, drawn before it: `order: -1` is what
  // puts projects first on the bar (spec §8), not registration order.
  useEffect(() => {
    return ctx.slots.register({
      name: 'shell.activity',
      key: 'workspace',
      title: 'Projects',
      icon: 'workspace',
      order: -1,
      opens: 'sidebar',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  useEffect(() => {
    return ctx.slots.register(
      { name: 'shell.sidebar', key: 'workspace', title: 'Projects' },
      Projects,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  useEffect(() => {
    return ctx.slots.register({
      name: 'shell.activity',
      key: 'composition',
      title: 'Composition',
      icon: 'puzzle',
      order: 1,
      opens: 'document',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  useEffect(() => {
    return ctx.slots.register(
      { name: 'shell.document', key: 'composition', title: 'Composition', closable: false },
      CompositionDocument,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  useEffect(() => {
    return ctx.slots.register({
      name: 'shell.activity',
      key: 'preview',
      title: 'Preview',
      icon: 'eye',
      order: 2,
      opens: 'document',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  useEffect(() => {
    return ctx.slots.register(
      { name: 'shell.document', key: 'preview', title: 'Preview', closable: false },
      Preview,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  useEffect(() => {
    return ctx.slots.register(
      { name: 'shell.panel', key: 'diagnostics', title: 'Diagnostics', order: 0 },
      DiagnosticsDocument,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  useEffect(() => {
    const off = [
      ctx.slots.register(
        { name: 'shell.status', key: 'project', side: 'left', order: 0 },
        ProjectStatus,
      ),
      ctx.slots.register(
        { name: 'shell.status', key: 'dirty', side: 'left', order: 1 },
        DirtyStatus,
      ),
      ctx.slots.register(
        { name: 'shell.status', key: 'session', side: 'right', order: 0 },
        SessionStatus,
      ),
      ctx.slots.register(
        { name: 'shell.status', key: 'theme', side: 'right', order: 1 },
        ThemeStatus,
      ),
      // `order: -1`: ahead of `session`/`theme` on the right — the game's
      // own state outranks the dev server's and the theme toggle (task 5).
      ctx.slots.register(
        { name: 'shell.status', key: 'game', side: 'right', order: -1 },
        GameStatus,
      ),
    ];
    return () => off.forEach((dispose) => dispose());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  // The Explorer's chooser of document kinds, handed to the shell so a
  // plugin's sidebar view can open a file with `ctx.shell.openPath(path)`
  // and no import, and so `#/doc/f:<path>` resolves on a cold load. Before
  // `ready()`, which is what first reads the address.
  useEffect(() => {
    return ctx.shell.registerPathOpener((path) => openPath(ctx, path));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  useEffect(() => {
    ctx.shell.ready();
    // A fresh load names no document. Five regions around an empty editor
    // and a bare sidebar would be an unexplained empty pane, so once a
    // project is open the composition opens — the way the old layout
    // showed its first screen — with the Explorer beside it. With no
    // project open there is nothing for a composition to show, so nothing
    // opens and the empty group points at Projects (A4); the moment a
    // project becomes active — on the first state, or a later frame after
    // a click on Projects — it opens then, once per null → id transition.
    // A switch between two projects, a deep link — resolved, or still
    // pending on a plugin's client half — and a sidebar already chosen are
    // left alone.
    // The Preview is a separate rule, not part of that default: whenever a
    // project is open it is mounted in the BACKGROUND (Task 8b). Nobody
    // opens that tab by default, but its game has to be running anyway —
    // the IDE's own `ide-bridge` depends on it for the node-type registry,
    // the Flow palette's node kinds and edges, transitions, and the status
    // bar's `game`/`session` dots, none of which speak while the Preview
    // has never been mounted. It must not ride on the composition default:
    // that default writes `#/doc/composition`, so every F5 is a deep link
    // and would skip it — no game after a reload (the final review's C1).
    // `background` on a key already open is a no-op, so every frame may
    // ask again without adding a second tab or moving the address.
    // All three depend on a fact the workspace may not hold yet (its boot
    // GET, or the host's first frame): the sidebar decides on the first
    // state; the composition and Preview rules listen to every frame.
    // `replace`: the default is not a place the person navigated to, so it
    // overwrites the empty address instead of pushing past it — Back from
    // the first document a person opens must not land on a pane with
    // nothing in it.
    let sidebarDecided = false;
    let previousActive: string | null = null;
    const decide = () => {
      const state = ctx.workspace.state();
      if (state === null) return;
      // The default is an activity view picked over a tab, laid only where
      // the left would otherwise be empty: a deep link to a tab with its
      // own sidebar keeps that sidebar; a reload onto the composition (a
      // deep link too, since the default writes the address) gets the
      // Explorer back.
      if (!sidebarDecided) {
        sidebarDecided = true;
        if (ctx.shell.sidebar() === undefined) {
          ctx.shell.showSidebar(state.active === null ? 'workspace' : 'explorer');
        }
      }
      if (
        previousActive === null &&
        state.active !== null &&
        ctx.shell.active() === undefined &&
        ctx.shell.pending() === undefined
      ) {
        ctx.shell.openContributed('composition', { replace: true });
      }
      if (state.active !== null) ctx.shell.openContributed('preview', { background: true });
      previousActive = state.active;
    };
    decide();
    return ctx.workspace.subscribe(decide);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  return <Shell ctx={ctx} />;
}
