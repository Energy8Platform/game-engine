import { Container, Graphics, Text } from 'pixi.js';
import { resolveMenu, type MenuRow } from '@/core/menu';
import type { Rect } from '@/core/popover';
import type { PixiComponentContext, ShellLayer } from '../context';
import { Popover } from '../primitives/popover';
import { FlexBox } from '../primitives/flex';
import { Slider, Spacer, Toggle } from '../primitives/controls';
import { makeText } from '../text';
import { makeIcon } from '../pixi-icon';
import { attachHover } from '../primitives/widgets';

/** The bar menu as a Pixi popover. Same rows, same order as the DOM — both come from resolveMenu.
 *
 *  `getAnchor` (the burger — the arrow's POINTER), `getPlate` (the bar's plaque — drives placement)
 *  and `getScale` (the bar's own fit-scale) are all FUNCTIONS, resolved lazily on every reposition —
 *  never a captured `BottomBar` instance. `PixiRenderer.renderBar()` destroys and rebuilds the
 *  BottomBar on every resize AND on ~20 other state changes, in the SAME resize handler that then
 *  repositions this popover. A captured instance would already be destroyed by the time `resize()`
 *  next runs, so `menuAnchor()`/`menuPlate()` on it would return `null` and the card would silently
 *  recentre with its arrow hidden — the exact bug the DOM renderer shipped and fixed the same way
 *  (see `html/Menu.ts`'s plate/pointer callbacks). Passing getters means every call reads whichever
 *  bar is CURRENT. `getPlate`/`getScale` are optional so every pre-existing caller (which only ever
 *  passed `getAnchor`) keeps behaving exactly as it did before the plate/pointer/scale split. */
export function openMenu(
  host: PixiComponentContext,
  getAnchor?: () => Rect | null,
  getPlate?: () => Rect | null,
  getScale?: () => number,
): ShellLayer {
  const updaters: Record<string, (v: boolean | number) => void> = {};
  const layer = new Popover(host, {
    tag: 'menu',
    plate: () => getPlate?.() ?? null,
    pointer: () => getAnchor?.() ?? null,
    scale: () => getScale?.() ?? 1,
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
    // Disabled: neutralise the write-through at the source (a no-op onChange) rather than relying
    // solely on eventMode — Toggle wires its own pointertap listener unconditionally in its
    // constructor, so a stray direct emit must still be harmless, not just unreachable by real hits.
    const toggle = new Toggle(
      row.get(),
      row.disabled ? () => {} : (v) => row.set(v),
      host.tokens.accent,
      host.tokens.plaqueLine,
    );
    box.add(toggle);
    updaters[row.id] = (v) => {
      const on = v === true;
      toggle.setValue(on);
      const next = row.icon(on);
      if (iconNode && next) iconNode.setIcon(next);
    };
    if (row.disabled) {
      box.alpha = 0.5;
      toggle.eventMode = 'none'; // dimmed + inert — mirrors the button branch's disabled treatment
    }
    return box;
  }
  const box = rowBox(host, `menu-row-${row.id}`, true);
  const head = new FlexBox({ direction: 'row', align: 'center' });
  const value = makeText(row.format(row.get()), { size: 12, weight: '700', color: host.tokens.plaqueLabel });
  head.add(label(row.label));
  head.add(new Spacer(), { grow: 1 });
  head.add(value);
  // Slider works in 0..1; map to the row's declared bounds, snapping to the MIN-anchored lattice
  // (min + k·step). Snapping to a bare multiple of step instead (Math.round(raw/step)*step) drifts
  // off `min` whenever min isn't itself a multiple of step — the common case, since the default step
  // is (max-min)/20: e.g. min:1,max:10 gives step 0.45, and the bare-multiple formula would emit 0.9
  // at the far left, BELOW the declared min. Clamp guards any float overshoot past either end.
  const toUnit = (v: number): number => (row.max === row.min ? 0 : (v - row.min) / (row.max - row.min));
  const fromUnit = (u: number): number => {
    const raw = row.min + u * (row.max - row.min);
    const snapped = row.min + Math.round((raw - row.min) / row.step) * row.step;
    return Math.max(row.min, Math.min(row.max, snapped));
  };
  // Disabled: same reasoning as the toggle branch above — a no-op onInput, not just eventMode.
  const slider = new Slider(host, toUnit(row.get()), row.disabled ? () => {} : (u) => {
    const v = fromUnit(u);
    value.text = row.format(v);
    head.layout(); // the readout's text just changed width (e.g. "5%" → "100%") — reposition it
    row.set(v);
  });
  updaters[row.id] = (v) => {
    const n = Number(v);
    value.text = row.format(n);
    head.layout();
    slider.setValue(toUnit(n));
  };
  box.add(head);
  box.add(slider);
  if (row.disabled) {
    box.alpha = 0.5;
    slider.eventMode = 'none';
  }
  return box;
}
