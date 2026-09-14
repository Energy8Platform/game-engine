import { Container, Text } from 'pixi.js';
import { resolveMenu, type MenuRow } from '@/core/menu';
import type { Rect } from '@/core/popover';
import type { PixiComponentContext, ShellLayer } from '../../pixi/context';
import { Popover } from '../primitives/popover';
import { FlexBox } from '../../pixi/primitives/flex';
import { Slider, Spacer, Toggle } from '../primitives/controls';
import { makeText } from '../text';
import { makeIcon } from '../pixi-icon';
import { isHbIcon, type HbIconName } from '../icons';
import { attachHover, IconButton } from '../primitives/widgets';
import { HB } from '../theme';

/** The bar menu as a Pixi popover in the HB pattern: ONE bordered plaque, rows without plaques or
 *  separators. The `sound` preset (a master mute) is dropped — each volume row carries its own mute
 *  icon instead (see `muteIcon`). `getAnchor`/`getPlate`/`getScale` are lazy getters for the reason
 *  ui/pixi/components/Menu.ts explains: the bar is rebuilt under the open popover. */
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
      const col = new FlexBox({ direction: 'column', align: 'stretch', gap: 4 });
      for (const row of hbRows(resolveMenu(host))) col.add(buildRow(host, row, width, updaters));
      return col;
    },
  });
  host.setMenuRefresh((id, v) => updaters[id]?.(v));
  return layer;
}

/** The HB menu shows no separators and no master `sound` row. */
export function hbRows(rows: MenuRow[]): MenuRow[] {
  return rows.filter((r) => r.kind !== 'separator' && !(r.kind === 'toggle' && r.id === 'sound'));
}

/** The last non-zero level a muted volume row had, so un-muting restores it (1 when unknown). */
const lastLevel = new Map<string, number>();

/** Which glyph a volume row's mute icon shows for a value: music gets the note, anything else the
 *  speaker; 0 = the crossed variant. */
export function muteIcon(id: string, value: number): HbIconName {
  const music = id === 'music';
  return value <= 0 ? (music ? 'musicOff' : 'soundOff') : music ? 'musicOn' : 'soundOn';
}

/** Tap the mute icon: a non-zero level is remembered and set to 0; 0 restores the remembered level. */
export function toggleMute(id: string, current: number, max = 1): number {
  if (current > 0) {
    lastLevel.set(id, current);
    return 0;
  }
  return lastLevel.get(id) ?? max;
}

function label(text: string): Text {
  return makeText(text, { size: 13, weight: '600', color: HB.fg }) as Text;
}

function rowBox(name: string, column = false): FlexBox {
  const box = new FlexBox({
    direction: column ? 'column' : 'row',
    align: column ? 'stretch' : 'center',
    gap: column ? 8 : 10,
    padding: { top: 6, bottom: 6, left: 6, right: 6 },
    minHeight: column ? undefined : 44,
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
  if (row.kind === 'separator') return new Container(); // filtered out by hbRows; keep the union total
  if (row.kind === 'button') {
    const box = rowBox(`menu-row-${row.id}`);
    if (isHbIcon(row.icon)) box.add(makeIcon(row.icon, 20, { ink: HB.fg, fill: HB.panel }));
    const text = label(row.label);
    box.add(text);
    box.add(new Spacer(), { grow: 1 });
    if (row.chevron) box.add(makeIcon('chevronRight', 14, { ink: HB.muted, fill: HB.panel }));
    if (!row.disabled) {
      box.setInteractive(true);
      box.on('pointertap', () => {
        host.closeLayer();
        row.select();
      });
      attachHover(box, () => { text.style.fill = HB.orange; }, () => { text.style.fill = HB.fg; });
    } else {
      box.alpha = 0.5;
    }
    return box;
  }
  if (row.kind === 'toggle') {
    const box = rowBox(`menu-row-${row.id}`);
    const glyph = row.icon(row.get());
    const iconNode = isHbIcon(glyph) ? makeIcon(glyph, 20, { ink: HB.fg, fill: HB.panel }) : null;
    if (iconNode) box.add(iconNode);
    box.add(label(row.label));
    box.add(new Spacer(), { grow: 1 });
    const toggle = new Toggle(row.get(), row.disabled ? () => {} : (v) => row.set(v));
    box.add(toggle);
    updaters[row.id] = (v) => {
      const on = v === true;
      toggle.setValue(on);
      const next = row.icon(on);
      if (iconNode && isHbIcon(next)) iconNode.setIcon(next);
    };
    if (row.disabled) {
      box.alpha = 0.5;
      toggle.eventMode = 'none';
    }
    return box;
  }
  // range: [mute plaque] [ label / slider ] — the slider sits under the label, beside the plaque;
  // no percentage readout (the slider's fill says it).
  const box = rowBox(`menu-row-${row.id}`);
  const toUnit = (v: number): number => (row.max === row.min ? 0 : (v - row.min) / (row.max - row.min));
  const fromUnit = (u: number): number => {
    const raw = row.min + u * (row.max - row.min);
    const snapped = row.min + Math.round((raw - row.min) / row.step) * row.step;
    return Math.max(row.min, Math.min(row.max, snapped));
  };
  // the volume presets get a mute plaque; a custom range keeps its own (optional) plain icon
  const isVolume = row.id === 'music' || row.id === 'sfx';
  const mute = isVolume
    ? new IconButton(muteIcon(row.id, row.get()), {
        // as tall as the label + slider stack beside it, so both sit inside the plaque's height
        size: 44,
        glyph: 26,
        onTap: () => {
          if (row.disabled) return;
          const next = toggleMute(row.id, row.get(), row.max);
          row.set(next);
          updaters[row.id]?.(next);
        },
      })
    : null;
  if (mute) {
    mute.label = `menu-mute-${row.id}`;
    box.add(mute);
  } else if (isHbIcon(row.icon)) {
    box.add(makeIcon(row.icon, 20, { ink: HB.fg, fill: HB.panel }));
  }
  const stack = new FlexBox({ direction: 'column', align: 'stretch', gap: 2 });
  stack.add(label(row.label));
  const slider = new Slider(host, toUnit(row.get()), row.disabled ? () => {} : (u) => {
    const v = fromUnit(u);
    mute?.setIcon(muteIcon(row.id, v));
    row.set(v);
  });
  stack.add(slider);
  box.add(stack, { grow: 1 });
  updaters[row.id] = (v) => {
    const n = Number(v);
    mute?.setIcon(muteIcon(row.id, n));
    slider.setValue(toUnit(n));
  };
  if (row.disabled) {
    box.alpha = 0.5;
    slider.eventMode = 'none';
    if (mute) mute.disabled = true;
  }
  return box;
}
