export type ButtonDesign = 'current' | 'compact' | 'soft';
let selected: ButtonDesign = 'current';
export function setButtonDesign(design: ButtonDesign): void { selected = design; }
export function getButtonDesign(): ButtonDesign { return selected; }

export interface ButtonMetrics {
  spin: [number, number]; bonus: [number, number]; menu: [number, number];
  spinGlyph: number; bonusGlyph: number; railWidth: number; gap: number;
}

export function buttonMetrics(slot: [number, number], mobile: boolean): ButtonMetrics {
  if (selected === 'current') return { spin: slot, bonus: slot, menu: mobile ? [52, 38] : [slot[0], 32],
    spinGlyph: mobile ? 56 : 80,
    bonusGlyph: mobile ? 66 : 94, railWidth: mobile ? 29 : 48, gap: mobile ? 4 : 6 };
  if (selected === 'compact') return {
    spin: mobile ? [slot[0], slot[1]] : [116, 104],
    bonus: mobile ? [slot[0], 80] : [136, 82], menu: [44, mobile ? 44 : 32],
    spinGlyph: mobile ? 52 : 60, bonusGlyph: mobile ? 54 : 52, railWidth: 44, gap: mobile ? 6 : 8,
  };
  return { spin: mobile ? [slot[0], slot[1]] : [112, 112],
    bonus: mobile ? [slot[0], 86] : [148, 86], menu: [44, mobile ? 44 : 32],
    spinGlyph: mobile ? 54 : 62, bonusGlyph: mobile ? 60 : 58, railWidth: mobile ? 44 : 48, gap: mobile ? 6 : 8 };
}

/** Only interactive control faces change. Information panels keep their existing geometry. */
export function buttonPoints(w: number, h: number, role: 'spin'|'bonus'|'menu'|'rail'): number[] | undefined {
  if (selected === 'current') return undefined;
  if (selected === 'compact') {
    const cut = Math.min(role === 'menu' || role === 'rail' ? 7 : 11, w * .15, h * .2);
    return [0, 0, w-cut, 0, w, cut, w, h, cut, h, 0, h-cut];
  }
  const r = Math.min(role === 'spin' ? 24 : role === 'bonus' ? 18 : 12, w/2, h/2);
  const points: number[] = [];
  const corners = [[w-r,r,-90],[w-r,h-r,0],[r,h-r,90],[r,r,180]];
  for (const [cx,cy,start] of corners) for (let i=0;i<=8;i++) {
    const a=(start+i*90/8)*Math.PI/180;
    points.push(cx+Math.cos(a)*r,cy+Math.sin(a)*r);
  }
  return points;
}
