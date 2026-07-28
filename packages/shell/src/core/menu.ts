import { ICON_NAMES, type IconName } from './icon-names';

/** Built-in presets: the id alone is enough — the shell knows the label, icon and behaviour. */
export type MenuPresetId = 'sound' | 'music' | 'sfx' | 'gameInfo';
const PRESET_IDS: readonly string[] = ['sound', 'music', 'sfx', 'gameInfo'];

export function isPresetId(id: string): id is MenuPresetId {
  return PRESET_IDS.includes(id);
}

interface MenuItemBase {
  id: string;
  /** Overrides the preset/default label. Run through the shell translator. */
  label?: string;
  icon?: IconName;
  disabled?: boolean;
}

export type MenuPresetItem = { id: MenuPresetId } & Omit<MenuItemBase, 'id'>;
export type MenuToggleItem = { type: 'toggle'; value?: boolean; onChange?(v: boolean): void } & MenuItemBase;
export type MenuRangeItem = {
  type: 'range';
  min?: number;
  max?: number;
  step?: number;
  value?: number;
  /** Right-hand readout. Defaults to percent for a 0..1 range, else the raw number. */
  format?(v: number): string;
  onChange?(v: number): void;
} & MenuItemBase;
export type MenuButtonItem = { type: 'button'; chevron?: boolean; onSelect?(): void } & MenuItemBase;
export type MenuSeparatorItem = { type: 'separator' };

export type MenuItem =
  | MenuPresetItem
  | MenuToggleItem
  | MenuRangeItem
  | MenuButtonItem
  | MenuSeparatorItem;

/** The rows shown when `ShellConfig.menu` is omitted — today's Settings content, minus master. */
export const DEFAULT_MENU: MenuItem[] = [
  { id: 'sound' },
  { id: 'music' },
  { id: 'sfx' },
  { type: 'separator' },
  { id: 'gameInfo' },
];

/** What `resolveMenu` reads. `ShellController` satisfies it; tests can supply a small literal. */
export interface MenuHost {
  readonly menu: MenuItem[];
  t(text: string): string;
  getMenuValue(id: string): boolean | number | undefined;
  setMenuValue(id: string, value: boolean | number): void;
  readonly actions: { openInfo(): void };
}

/** A row, ready to draw: no preset knowledge left, no config shapes, just kind + accessors. */
export type MenuRow =
  | { kind: 'separator' }
  | {
      kind: 'toggle';
      id: string;
      label: string;
      disabled: boolean;
      /** Glyph for the current value (the sound preset swaps speaker on/off). */
      icon(value: boolean): IconName | undefined;
      get(): boolean;
      set(value: boolean): void;
    }
  | {
      kind: 'range';
      id: string;
      label: string;
      icon?: IconName;
      disabled: boolean;
      min: number;
      max: number;
      step: number;
      get(): number;
      set(value: number): void;
      format(value: number): string;
    }
  | {
      kind: 'button';
      id: string;
      label: string;
      icon?: IconName;
      disabled: boolean;
      chevron: boolean;
      select(): void;
    };

const isSeparator = (i: MenuItem): i is MenuSeparatorItem =>
  (i as { type?: string }).type === 'separator';

/** Range bounds with defaults: 0..1 like a volume slider, step = a twentieth of the span. */
export function rangeBounds(item: { min?: number; max?: number; step?: number }): {
  min: number;
  max: number;
  step: number;
} {
  const min = item.min ?? 0;
  const max = item.max ?? 1;
  return { min, max, step: item.step ?? (max - min) / 20 };
}

/** Initial values for CUSTOM items (presets keep their own homes). Values already in `prev` win, so
 *  a later `setMenu()` with the same ids does not reset what the player has changed. */
export function seedMenuValues(
  items: MenuItem[],
  prev: Record<string, boolean | number> = {},
): Record<string, boolean | number> {
  const out: Record<string, boolean | number> = {};
  for (const item of items) {
    if (isSeparator(item)) continue;
    const type = (item as { type?: string }).type;
    if (!type || isPresetId(item.id)) continue;
    if (item.id in prev) {
      out[item.id] = prev[item.id];
      continue;
    }
    if (type === 'toggle') out[item.id] = (item as MenuToggleItem).value ?? false;
    else if (type === 'range') {
      const r = item as MenuRangeItem;
      out[item.id] = r.value ?? rangeBounds(r).min;
    }
  }
  return out;
}

const percent = (v: number): string => `${Math.round(v * 100)}%`;

function safeIcon(name: string | undefined): IconName | undefined {
  return name && (ICON_NAMES as readonly string[]).includes(name) ? (name as IconName) : undefined;
}

/** Expand the configured list into render-ready rows. Unknown ids are dropped with one warning —
 *  a typo in a preset id must be visible, not silently invisible. */
export function resolveMenu(host: MenuHost): MenuRow[] {
  const rows: MenuRow[] = [];
  for (const item of host.menu) {
    if (isSeparator(item)) {
      rows.push({ kind: 'separator' });
      continue;
    }
    const type = (item as { type?: string }).type;
    if (!type) {
      const row = preset(host, item as MenuPresetItem);
      if (row) rows.push(row);
      else console.warn(`[shell] unknown menu preset id "${item.id}" — item skipped`);
      continue;
    }
    rows.push(custom(host, item as MenuToggleItem | MenuRangeItem | MenuButtonItem, type));
  }
  return rows;
}

function preset(host: MenuHost, item: MenuPresetItem): MenuRow | null {
  const disabled = item.disabled ?? false;
  const label = host.t(item.label ?? DEFAULT_LABELS[item.id] ?? item.id);
  switch (item.id) {
    case 'sound':
      return {
        kind: 'toggle',
        id: 'sound',
        label,
        disabled,
        icon: (v) => safeIcon(item.icon) ?? (v ? 'soundOn' : 'soundOff'),
        get: () => host.getMenuValue('sound') !== false,
        set: (v) => host.setMenuValue('sound', v),
      };
    case 'music':
    case 'sfx': {
      const id = item.id;
      return {
        kind: 'range',
        id,
        label,
        icon: safeIcon(item.icon),
        disabled,
        min: 0,
        max: 1,
        step: 0.05,
        get: () => Number(host.getMenuValue(id) ?? 1),
        set: (v) => host.setMenuValue(id, v),
        format: percent,
      };
    }
    case 'gameInfo':
      return {
        kind: 'button',
        id: 'gameInfo',
        label,
        icon: safeIcon(item.icon) ?? 'info',
        disabled,
        chevron: true,
        select: () => host.actions.openInfo(),
      };
    default:
      return null;
  }
}

const DEFAULT_LABELS: Record<string, string> = {
  sound: 'Sound',
  music: 'Music',
  sfx: 'SFX',
  gameInfo: 'Game info',
};

function custom(
  host: MenuHost,
  item: MenuToggleItem | MenuRangeItem | MenuButtonItem,
  type: string,
): MenuRow {
  const disabled = item.disabled ?? false;
  const label = host.t(item.label ?? item.id);
  const icon = safeIcon(item.icon);
  if (type === 'toggle') {
    const it = item as MenuToggleItem;
    return {
      kind: 'toggle',
      id: it.id,
      label,
      disabled,
      icon: () => icon,
      get: () => host.getMenuValue(it.id) === true,
      set: (v) => {
        host.setMenuValue(it.id, v);
        it.onChange?.(v);
      },
    };
  }
  if (type === 'range') {
    const it = item as MenuRangeItem;
    const { min, max, step } = rangeBounds(it);
    return {
      kind: 'range',
      id: it.id,
      label,
      icon,
      disabled,
      min,
      max,
      step,
      get: () => Number(host.getMenuValue(it.id) ?? min),
      set: (v) => {
        host.setMenuValue(it.id, v);
        it.onChange?.(v);
      },
      format: it.format ?? (min === 0 && max === 1 ? percent : (v) => String(v)),
    };
  }
  const it = item as MenuButtonItem;
  return {
    kind: 'button',
    id: it.id,
    label,
    icon,
    disabled,
    chevron: it.chevron ?? false,
    select: () => it.onSelect?.(),
  };
}
