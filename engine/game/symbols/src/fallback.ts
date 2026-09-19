/**
 * The stand-in art for a symbol id `symbols.yml` does not name (or a
 * project with no `symbols.yml` at all): the coloured square with the id
 * as text `first-slot`'s `main.ts` used to draw, moved here so the example
 * keeps working with no art. Drawn from `-w/2, -h/2` — the legacy
 * `SymbolCell` centres a view on the cell.
 */
import { Container, Graphics, Text } from 'pixi.js';

const COLORS = [0xef4444, 0xf59e0b, 0xeab308, 0x22c55e, 0x38bdf8, 0xa78bfa];

export function fallbackBox(id: string, size: { width: number; height: number }): Container {
  const view = new Container();
  view.label = 'fallback';
  const n = Number(id);
  const color = COLORS[(((n - 1) % COLORS.length) + COLORS.length) % COLORS.length];
  const { width: w, height: h } = size;
  view.addChild(new Graphics().rect(4 - w / 2, 4 - h / 2, w - 8, h - 8).fill(color));
  const label = new Text({
    text: id,
    style: { fill: 0x10121a, fontSize: Math.round(Math.min(w, h) * 0.375), fontWeight: 'bold' },
  });
  label.anchor.set(0.5);
  view.addChild(label);
  return view;
}
