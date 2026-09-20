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
const game = await createGame({
  mount: document.getElementById('mount')!,
  without: ['ui.shell'],
  provide: { safeArea: { top: 0, right: 0, bottom: safeBottom, left: 0 } },
});
// Test hook, the pair of `main.ts`'s `__e8.shell()`: `game-shell.spec.ts`
// asserts the game page HAS a shell and this page has NONE.
(window as unknown as { __e8editor: unknown }).__e8editor = {
  hasShell: () => !!game.ctx.reflect.get('shell', false),
};
const parentOrigin = document.referrer ? new URL(document.referrer).origin : '*';
await game.ctx.plugin(sceneEdit, {
  scene: params.get('scene') ?? '',
  // `undefined` (the key left out) means scene mode; `has` vs `get` matters
  // here because `?symbol=` (no chip picked yet) must still enter symbol
  // mode with `''`, not fall through to scene mode with `scene: ''`.
  symbol: params.has('symbol') ? params.get('symbol')! : undefined,
  parentOrigin,
});
