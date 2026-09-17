/**
 * The scene canvas — the page the IDE embeds in a scene tab. Same
 * composition as `main.ts` (the project's rows, from `/api/composition`),
 * no spin loop and no page UI: `@energy8engine/scene-edit` draws the gizmo
 * and talks to the IDE over `postMessage`. The IDE is the only writer of
 * scene files; this page only reports what the pointer did.
 */
import { Container, Graphics, Text } from 'pixi.js';
import type { SymbolResolver, SymbolView } from '@energy8platform/game-engine/slot';
import { createGame } from '@energy8engine/game-runtime';
import * as sceneEdit from '@energy8engine/scene-edit';

// The same placeholder art `main.ts` draws — the board must look the same here.
const CELL = 96;
const COLORS = [0xef4444, 0xf59e0b, 0xeab308, 0x22c55e, 0x38bdf8, 0xa78bfa];
const resolve: SymbolResolver = (symbolId: string): SymbolView => {
  const view = new Container() as SymbolView;
  const n = Number(symbolId);
  const color = COLORS[(((n - 1) % COLORS.length) + COLORS.length) % COLORS.length];
  const box = new Graphics().rect(4, 4, CELL - 8, CELL - 8).fill(color);
  view.addChild(box);
  const label = new Text({
    text: symbolId,
    style: { fill: 0x10121a, fontSize: 36, fontWeight: 'bold' },
  });
  label.anchor.set(0.5);
  label.position.set(CELL / 2, CELL / 2);
  view.addChild(label);
  return view;
};

const game = await createGame({ mount: document.getElementById('mount')!, provide: { assets: { resolve } } });
const params = new URLSearchParams(location.search);
const parentOrigin = document.referrer ? new URL(document.referrer).origin : '*';
await game.ctx.plugin(sceneEdit, { scene: params.get('scene') ?? '', parentOrigin });
