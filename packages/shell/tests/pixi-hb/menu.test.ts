import '../pixi/setup-canvas';
import { describe, it, expect } from 'vitest';
import { openMenu, hbRows, muteIcon, toggleMute } from '@/ui/pixi-hb/components/Menu';
import { resolveMenu } from '@/core/menu';
import { makeContext } from '../pixi/_host';

function findByLabel(n: any, label: string): any {
  if (n.label === label) return n;
  for (const c of n.children ?? []) {
    const hit = findByLabel(c, label);
    if (hit) return hit;
  }
  return null;
}
function labels(n: any, out: string[] = []): string[] {
  if (typeof n.label === 'string' && n.label.startsWith('menu-')) out.push(n.label);
  for (const c of n.children ?? []) labels(c, out);
  return out;
}

describe('hb menu', () => {
  it('drops the sound preset and separators, keeps everything else in order', () => {
    const host = makeContext();
    expect(hbRows(resolveMenu(host)).map((r) => (r.kind === 'separator' ? 'sep' : r.id))).toEqual(['music', 'sfx', 'gameInfo']);
    const layer = openMenu(host);
    expect(labels(layer)).toEqual(['menu-row-music', 'menu-mute-music', 'menu-row-sfx', 'menu-mute-sfx', 'menu-row-gameInfo']);
  });

  it('the mute plaque zeroes the level and a second tap restores it', () => {
    const host = makeContext();
    host.setMenuValue('music', 0.6);
    const layer = openMenu(host);
    const mute = findByLabel(layer, 'menu-mute-music');
    mute.emit('pointertap');
    expect(host.getMenuValue('music')).toBe(0);
    expect(mute.iconName).toBe('musicOff');
    mute.emit('pointertap');
    expect(host.getMenuValue('music')).toBeCloseTo(0.6);
    expect(mute.iconName).toBe('musicOn');
  });

  it('muteIcon / toggleMute are pure', () => {
    expect(muteIcon('music', 0)).toBe('musicOff');
    expect(muteIcon('sfx', 0.2)).toBe('soundOn');
    expect(toggleMute('x', 0.4)).toBe(0);
    expect(toggleMute('x', 0)).toBe(0.4);
    expect(toggleMute('never-set', 0, 5)).toBe(5);
  });
});
