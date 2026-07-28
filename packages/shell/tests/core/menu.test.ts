// @vitest-environment node
import { it, expect, vi } from 'vitest';
import { resolveMenu, seedMenuValues, DEFAULT_MENU, type MenuItem, type MenuHost } from '@/core/menu';

function host(items: MenuItem[], over: Partial<MenuHost> = {}): MenuHost & { values: Record<string, boolean | number> } {
  const values: Record<string, boolean | number> = { sound: true, music: 0.5, sfx: 0.5, ...seedMenuValues(items) };
  return {
    values,
    menu: items,
    t: (s) => s,
    getMenuValue: (id) => values[id],
    setMenuValue: (id, v) => { values[id] = v; },
    actions: { openInfo: vi.fn() },
    ...over,
  } as never;
}

it('expands the default list into sound/music/sfx/separator/gameInfo', () => {
  const rows = resolveMenu(host(DEFAULT_MENU));
  expect(rows.map((r) => r.kind)).toEqual(['toggle', 'range', 'range', 'separator', 'button']);
  expect(rows.map((r) => ('id' in r ? r.id : '—'))).toEqual(['sound', 'music', 'sfx', '—', 'gameInfo']);
});

it('gives presets their translated labels and volume bounds', () => {
  const rows = resolveMenu(host(DEFAULT_MENU));
  const music = rows[1];
  expect(music).toMatchObject({ kind: 'range', label: 'Music', min: 0, max: 1, step: 0.05 });
  if (music.kind !== 'range') throw new Error('range expected');
  expect(music.format(0.5)).toBe('50%');
  expect(rows[4]).toMatchObject({ kind: 'button', label: 'Game info', icon: 'info', chevron: true });
});

it("swaps the sound row's glyph with its value", () => {
  const rows = resolveMenu(host(DEFAULT_MENU));
  const sound = rows[0];
  if (sound.kind !== 'toggle') throw new Error('toggle expected');
  expect(sound.icon(true)).toBe('soundOn');
  expect(sound.icon(false)).toBe('soundOff');
});

it('routes a preset row through get/set on the host', () => {
  const h = host(DEFAULT_MENU);
  const rows = resolveMenu(h);
  const sound = rows[0];
  if (sound.kind !== 'toggle') throw new Error('toggle expected');
  expect(sound.get()).toBe(true);
  sound.set(false);
  expect(h.values.sound).toBe(false);
});

it('gameInfo select() opens the info overlay', () => {
  const h = host(DEFAULT_MENU);
  const row = resolveMenu(h)[4];
  if (row.kind !== 'button') throw new Error('button expected');
  row.select();
  expect(h.actions.openInfo).toHaveBeenCalledOnce();
});

it('derives a custom range step from its span and calls onChange', () => {
  const onChange = vi.fn();
  const items: MenuItem[] = [{ id: 'speed', type: 'range', label: 'Speed', min: 1, max: 5, value: 2, onChange }];
  const h = host(items);
  const row = resolveMenu(h)[0];
  if (row.kind !== 'range') throw new Error('range expected');
  expect(row).toMatchObject({ min: 1, max: 5, step: 0.2 });
  expect(row.get()).toBe(2);
  row.set(3);
  expect(h.values.speed).toBe(3);
  expect(onChange).toHaveBeenCalledWith(3);
});

it('uses a custom format when given, percent only for a 0..1 range', () => {
  const items: MenuItem[] = [
    { id: 'speed', type: 'range', label: 'Speed', min: 1, max: 5, value: 2, format: (v) => `×${v}` },
    { id: 'mix', type: 'range', label: 'Mix', value: 0.25 },
  ];
  const rows = resolveMenu(host(items));
  if (rows[0].kind !== 'range' || rows[1].kind !== 'range') throw new Error('ranges expected');
  expect(rows[0].format(2)).toBe('×2');
  expect(rows[1].format(0.25)).toBe('25%');
});

it('renders custom toggle and button rows', () => {
  const onSelect = vi.fn();
  const items: MenuItem[] = [
    { id: 'lefty', type: 'toggle', label: 'Left-hand', value: false },
    { id: 'paytable', type: 'button', label: 'Paytable', icon: 'ticket', onSelect },
  ];
  const rows = resolveMenu(host(items));
  expect(rows[0]).toMatchObject({ kind: 'toggle', id: 'lefty', label: 'Left-hand', disabled: false });
  if (rows[0].kind !== 'toggle') throw new Error('toggle expected');
  expect(rows[0].icon(false)).toBeUndefined();
  if (rows[1].kind !== 'button') throw new Error('button expected');
  expect(rows[1]).toMatchObject({ icon: 'ticket', chevron: false });
  rows[1].select();
  expect(onSelect).toHaveBeenCalledOnce();
});

it('drops an unknown id and an unknown icon, warning once for the id', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const items = [
    { id: 'nope' },
    { id: 'x', type: 'button', label: 'X', icon: 'not-a-glyph' },
  ] as unknown as MenuItem[];
  const rows = resolveMenu(host(items));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ kind: 'button', icon: undefined });
  expect(warn).toHaveBeenCalledTimes(1);
  warn.mockRestore();
});

it('seeds custom values and keeps ones already known', () => {
  const items: MenuItem[] = [
    { id: 'sound' },
    { id: 'lefty', type: 'toggle', value: true, label: 'L' },
    { id: 'speed', type: 'range', min: 1, max: 5, value: 2, label: 'S' },
    { id: 'noval', type: 'range', min: 2, max: 8, label: 'N' },
    { id: 'go', type: 'button', label: 'Go' },
    { type: 'separator' },
  ];
  expect(seedMenuValues(items)).toEqual({ lefty: true, speed: 2, noval: 2 });
  expect(seedMenuValues(items, { speed: 4 })).toEqual({ lefty: true, speed: 4, noval: 2 });
});

it('marks disabled rows', () => {
  const rows = resolveMenu(host([{ id: 'gameInfo', disabled: true }]));
  expect(rows[0].kind === 'button' && rows[0].disabled).toBe(true);
});

// ── Fix round 1: silent-failure edge cases found in review ─────────────────────────────────────

it('drops a custom range row when min > max, warning once', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const items: MenuItem[] = [{ id: 'backwards', type: 'range', label: 'Backwards', min: 5, max: 1, value: 3 }];
  const rows = resolveMenu(host(items));
  expect(rows).toHaveLength(0);
  expect(warn).toHaveBeenCalledTimes(1);
  warn.mockRestore();
});

it('drops a custom range row when min === max, warning once', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const items: MenuItem[] = [{ id: 'flat', type: 'range', label: 'Flat', min: 3, max: 3, value: 3 }];
  const rows = resolveMenu(host(items));
  expect(rows).toHaveLength(0);
  expect(warn).toHaveBeenCalledTimes(1);
  warn.mockRestore();
});

it('reseeds from the item value, not a stale prev, when the runtime type no longer matches: toggle -> range', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const first = seedMenuValues([{ id: 'x', type: 'toggle', value: true, label: 'X' }]);
  expect(first).toEqual({ x: true });
  const second = seedMenuValues([{ id: 'x', type: 'range', min: 0, max: 10, value: 5, label: 'X' }], first);
  expect(second).toEqual({ x: 5 });
  expect(warn).not.toHaveBeenCalled();
  warn.mockRestore();
});

it('reseeds from the item value, not a stale prev, when the runtime type no longer matches: range -> toggle', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const first = seedMenuValues([{ id: 'x', type: 'range', min: 0, max: 10, value: 5, label: 'X' }]);
  expect(first).toEqual({ x: 5 });
  const second = seedMenuValues([{ id: 'x', type: 'toggle', value: true, label: 'X' }], first);
  expect(second).toEqual({ x: true });
  expect(warn).not.toHaveBeenCalled();
  warn.mockRestore();
});

it('drops a custom row with an unrecognized type, warning once', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const items = [{ id: 'z', type: 'toogle', value: true, label: 'Z' }] as unknown as MenuItem[];
  const rows = resolveMenu(host(items));
  expect(rows).toHaveLength(0);
  expect(warn).toHaveBeenCalledTimes(1);
  warn.mockRestore();
});

it('warns when a custom item id collides with a built-in preset id, but still produces the row', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const items: MenuItem[] = [{ id: 'sound', type: 'toggle', label: 'Custom Sound', value: true }];
  const rows = resolveMenu(host(items));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ kind: 'toggle', id: 'sound', label: 'Custom Sound' });
  expect(warn).toHaveBeenCalledTimes(1);
  warn.mockRestore();
});
