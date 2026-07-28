import { Container, Graphics, Text } from 'pixi.js';
import { resolveMenu, type MenuRow } from '@/core/menu';
import type { PixiComponentContext, ShellLayer } from '../context';
import { Popover } from '../primitives/popover';
import { FlexBox } from '../primitives/flex';
import { Slider, Spacer, Toggle } from '../primitives/controls';
import { makeText } from '../text';
import { makeIcon } from '../pixi-icon';
import { attachHover } from '../primitives/widgets';
import type { BottomBar } from './BottomBar';

/** The bar menu as a Pixi popover. Same rows, same order as the DOM — both come from resolveMenu. */
export function openMenu(host: PixiComponentContext, bar?: BottomBar): ShellLayer {
  const updaters: Record<string, (v: boolean | number) => void> = {};
  const layer = new Popover(host, {
    tag: 'menu',
    anchor: () => bar?.menuAnchor() ?? null,
    onClose: () => host.closeLayer(),
    build: (width) => {
      const col = new FlexBox({ direction: 'column', align: 'stretch', gap: 6 });
      for (const row of resolveMenu(host)) col.add(buildRow(host, row, width, updaters));
      return col;
    },
  });
  host.setMenuRefresh((id, v) => updaters[id]?.(v));
  return layer;
}

function label(text: string): Text {
  return makeText(text, { size: 13, weight: '600', color: '#ffffff' }) as Text;
}

function rowBox(host: PixiComponentContext, name: string, column = false): FlexBox {
  const box = new FlexBox({
    direction: column ? 'column' : 'row',
    align: column ? 'stretch' : 'center',
    gap: column ? 8 : 10,
    padding: { top: 10, bottom: 10, left: 12, right: 12 },
    minHeight: column ? undefined : 44,
    background: { fill: host.tokens.plaqueGlass, radius: 14 },
  });
  box.label = name;
  return box;
}

function buildRow(
  host: PixiComponentContext,
  row: MenuRow,
  width: number,
  updaters: Record<string, (v: boolean | number) => void>,
): Container {
  if (row.kind === 'separator') {
    const sep = new Container();
    sep.label = 'menu-sep';
    const line = new Graphics().rect(4, 6, width - 8, 1).fill(host.tokens.plaqueLine);
    line.alpha = 0.5;
    sep.addChild(line);
    return sep;
  }
  if (row.kind === 'button') {
    const box = rowBox(host, `menu-row-${row.id}`);
    if (row.icon) box.add(makeIcon(row.icon, 20, '#ffffff'));
    const text = label(row.label);
    box.add(text);
    box.add(new Spacer(), { grow: 1 });
    if (row.chevron) box.add(makeIcon('chevronRight', 16, host.tokens.muted));
    if (!row.disabled) {
      box.setInteractive(true);
      box.on('pointertap', () => {
        host.closeLayer();
        row.select();
      });
      attachHover(
        box,
        () => { box.setBgFill(host.tokens.plaqueGlassHover); text.style.fill = host.tokens.accent; },
        () => { box.setBgFill(host.tokens.plaqueGlass); text.style.fill = '#ffffff'; },
      );
    } else {
      box.alpha = 0.5;
    }
    return box;
  }
  if (row.kind === 'toggle') {
    const box = rowBox(host, `menu-row-${row.id}`);
    const glyph = row.icon(row.get());
    const iconNode = glyph ? makeIcon(glyph, 20, '#ffffff') : null;
    if (iconNode) box.add(iconNode);
    box.add(label(row.label));
    box.add(new Spacer(), { grow: 1 });
    const toggle = new Toggle(row.get(), (v) => row.set(v), host.tokens.accent, host.tokens.plaqueLine);
    box.add(toggle);
    updaters[row.id] = (v) => {
      const on = v === true;
      toggle.setValue(on);
      const next = row.icon(on);
      if (iconNode && next) iconNode.setIcon(next);
    };
    return box;
  }
  const box = rowBox(host, `menu-row-${row.id}`, true);
  const head = new FlexBox({ direction: 'row', align: 'center' });
  const value = makeText(row.format(row.get()), { size: 12, weight: '700', color: host.tokens.plaqueLabel });
  head.add(label(row.label));
  head.add(new Spacer(), { grow: 1 });
  head.add(value);
  // Slider works in 0..1; map to the row's declared bounds.
  const toUnit = (v: number): number => (row.max === row.min ? 0 : (v - row.min) / (row.max - row.min));
  const fromUnit = (u: number): number => {
    const raw = row.min + u * (row.max - row.min);
    return Math.round(raw / row.step) * row.step;
  };
  const slider = new Slider(host, toUnit(row.get()), (u) => {
    const v = fromUnit(u);
    value.text = row.format(v);
    row.set(v);
  });
  updaters[row.id] = (v) => {
    const n = Number(v);
    value.text = row.format(n);
    slider.setValue(toUnit(n));
  };
  box.add(head);
  box.add(slider);
  return box;
}
