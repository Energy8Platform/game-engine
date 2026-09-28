/**
 * The scene canvas — the page the IDE embeds in a scene tab. Same
 * composition as `main.ts` (the project's rows, from `/api/composition`),
 * no spin loop and no page UI: `@energy8engine/scene-edit` draws the gizmo
 * and talks to the IDE over `postMessage`. The IDE is the only writer of
 * scene files; this page only reports what the pointer did.
 */
import { createGame } from '@energy8engine/game-runtime';
import * as sceneEdit from '@energy8engine/scene-edit';

const params = new URLSearchParams(location.search);
// The band the shell's bar would take, as the IDE's viewport preset says
// (`?safeBottom=<px>`): the scenes fit into the screen minus it, as under a real shell.
const safeBottom = Number(params.get('safeBottom') ?? 0) || 0;
// The editor page composes the WHOLE bundle, `shell1` included — and the
// shell would draw its bar over the very canvas being edited. Not here.
// `editorPage` tells `flow1` to run no document either: a flow under the
// scene being edited would show `base_game` over it.
const game = await createGame({
  mount: document.getElementById('mount')!,
  without: ['ui.shell'],
  provide: { safeArea: { top: 0, right: 0, bottom: safeBottom, left: 0 }, editorPage: true },
});
// Test hook, the pair of `main.ts`'s `__e8.shell()`: `game-shell.spec.ts`
// asserts the game page HAS a shell and this page has NONE.
(window as unknown as { __e8editor: unknown }).__e8editor = {
  hasShell: () => !!game.ctx.reflect.get('shell', false),
};
// scene-edit reads `?scene=`/`?symbol=`/`?reels=` and the parent's origin
// from this page itself (slice 43) — a project's editor.ts passes nothing.
await game.ctx.plugin(sceneEdit, {});
