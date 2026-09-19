/**
 * The scene canvas — the page the IDE embeds in a scene tab. Same
 * composition as `main.ts` (the project's rows, from `/api/composition`),
 * no spin loop and no page UI: `@energy8engine/scene-edit` draws the gizmo
 * and talks to the IDE over `postMessage`. The IDE is the only writer of
 * scene files; this page only reports what the pointer did.
 */
import { createGame } from '@energy8engine/game-runtime';
import * as sceneEdit from '@energy8engine/scene-edit';

const game = await createGame({ mount: document.getElementById('mount')! });
const params = new URLSearchParams(location.search);
const parentOrigin = document.referrer ? new URL(document.referrer).origin : '*';
await game.ctx.plugin(sceneEdit, {
  scene: params.get('scene') ?? '',
  symbol: params.get('symbol') ?? '',
  parentOrigin,
});
