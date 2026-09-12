import { useEffect } from 'react';
import type { Context } from 'cordis';
import {
  CompositionScreen,
  DiagnosticsPanel,
  DirtyStatus,
  Explorer,
  PreviewWall,
  ProjectStatus,
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
 */
function DiagnosticsDocument({ ctx }: { ctx: Context }) {
  const { diagnostics: project } = useGameComposition(ctx);
  const { groups: game, dropped } = useGameDiagnostics(ctx);
  const editor = useEditorDiagnostics(ctx);
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
 * activity bar shows them: Explorer, composition, preview. The two shipped
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
      title: 'Проводник',
      icon: 'files',
      order: 0,
      opens: 'sidebar',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  useEffect(() => {
    return ctx.slots.register(
      { name: 'shell.sidebar', key: 'explorer', title: 'Проводник' },
      Explorer,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  useEffect(() => {
    return ctx.slots.register({
      name: 'shell.activity',
      key: 'composition',
      title: 'Состав',
      icon: 'layers',
      order: 1,
      opens: 'document',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  useEffect(() => {
    return ctx.slots.register(
      { name: 'shell.document', key: 'composition', title: 'Состав', closable: false },
      CompositionDocument,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  useEffect(() => {
    return ctx.slots.register({
      name: 'shell.activity',
      key: 'preview',
      title: 'Превью',
      icon: 'eye',
      order: 2,
      opens: 'document',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  useEffect(() => {
    return ctx.slots.register(
      { name: 'shell.document', key: 'preview', title: 'Превью', closable: false },
      PreviewWall,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  useEffect(() => {
    return ctx.slots.register(
      { name: 'shell.panel', key: 'diagnostics', title: 'Диагностика' },
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
    // and a bare sidebar would be an unexplained empty pane, so the
    // composition opens — the way the old layout showed its first screen —
    // with the Explorer beside it. A deep link — resolved, or still
    // pending on a plugin's client half — and a sidebar already chosen are
    // left alone.
    // `replace`: the default is not a place the person navigated to, so it
    // overwrites the empty address instead of pushing past it — Back from
    // the first document a person opens must not land on a pane with
    // nothing in it.
    if (ctx.shell.active() === undefined && ctx.shell.pending() === undefined) {
      ctx.shell.openContributed('composition', { replace: true });
    }
    if (ctx.shell.sidebar() === undefined) ctx.shell.showSidebar('explorer');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  return <Shell ctx={ctx} />;
}
