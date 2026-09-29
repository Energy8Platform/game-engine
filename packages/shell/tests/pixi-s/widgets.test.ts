import '../pixi/setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect, vi } from 'vitest';
import type { Ticker } from 'pixi.js';
import { SButton, SReadout, SBet, SSpin, SFsCounter, type SSpinOpts } from '@/ui/pixi-s/widgets';
import { SKEW, DOT_STEP } from '@/ui/pixi-s/slab';
import { sIcon } from '@/ui/pixi-s/icons';
import { S, DISABLED_ALPHA } from '@/ui/pixi-s/theme';

const tap = (n: { emit(event: string, ...args: unknown[]): unknown }) => n.emit('pointertap', {});

function fakeTicker(): { fns: Set<unknown>; ticker: Ticker } {
  const fns = new Set<unknown>();
  return { fns, ticker: { add: (f: unknown) => fns.add(f), remove: (f: unknown) => fns.delete(f) } as unknown as Ticker };
}

function spin(over: Partial<SSpinOpts> = {}): { s: SSpin; calls: string[] } {
  const calls: string[] = [];
  const s = new SSpin({
    w: 260,
    h: 136,
    glyph: 84,
    ticker: fakeTicker().ticker,
    autoplay: 'off',
    remaining: 0,
    onSpin: () => calls.push('spin'),
    onStop: () => calls.push('stop'),
    onResume: () => calls.push('resume'),
    ...over,
  });
  return { s, calls };
}

describe('S widgets', () => {
  it('SButton taps unless disabled; disabled dims and stops hit-testing', () => {
    const onTap = vi.fn();
    const b = new SButton({ w: 64, h: 44, face: 'plate', corners: SKEW.menu, glyph: sIcon('play', 20, S.fg), glyphSize: 20, onTap });
    tap(b);
    expect(onTap).toHaveBeenCalledTimes(1);
    b.disabled = true;
    tap(b);
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(b.alpha).toBe(DISABLED_ALPHA);
    expect(b.eventMode).toBe('none');
    expect(b.measureSize()).toEqual({ w: 64, h: 44 });
  });

  it('SButton centres its glyph in the part not tucked under a neighbour', () => {
    const g = sIcon('bolt', 20, S.fg);
    new SButton({ w: 52, h: 40, face: 'plate', corners: SKEW.tab, glyph: g, glyphSize: 20, insetRight: 12, onTap: () => {} });
    expect(g.x).toBe(10);
    expect(g.y).toBe(10);
  });

  it('SReadout keeps its design width for short values and grows for long ones', () => {
    const short = new SReadout({ label: 'Win', value: '€0.00', w: 280, h: 54, labelSize: 15, valueSize: 26 });
    expect(short.measureSize()).toEqual({ w: 280, h: 54 });
    const long = new SReadout({ label: 'Balance', value: '€10,000,000,000.00', w: 280, h: 54, labelSize: 15, valueSize: 26 });
    expect(long.measureSize().w).toBeGreaterThan(280);
    expect(long.valueText.x + long.valueText.width).toBeLessThanOrEqual(long.measureSize().w);
    expect(long.labelText.text).toBe('BALANCE');
  });

  it('SReadout with grow off keeps its design width and scales the text down to fit inside', () => {
    const r = new SReadout({ label: 'Total win', value: '€10,000,000,000.00', w: 268, h: 56, labelSize: 15, valueSize: 23, grow: false });
    expect(r.measureSize()).toEqual({ w: 268, h: 56 });
    expect(r.labelText.x).toBeGreaterThan(0);
    expect(r.valueText.x + r.valueText.width).toBeLessThanOrEqual(268 - SKEW.readout[0][0]);
    expect(r.valueText.scale.x).toBeLessThan(1);
    expect(r.labelText.scale.x).toBeCloseTo(r.valueText.scale.x, 5); // one factor for both
  });

  it('grown slabs round their width up to the dot step (bounded dot-context cache)', () => {
    const r = new SReadout({ label: 'Balance', value: '€10,000,000,000.00', w: 172, h: 44, labelSize: 11, valueSize: 17 });
    expect(r.measureSize().w).toBeGreaterThan(172);
    expect(r.measureSize().w % DOT_STEP).toBe(0);
    const b = new SBet({ label: 'Legendary Warrior Ante', value: '€1,000.00', w: 186, h: 40, labelSize: 11, valueSize: 17, stepper: false, onStep: () => {} });
    expect(b.measureSize().w).toBeGreaterThan(186);
    expect(b.measureSize().w % DOT_STEP).toBe(0);
  });

  it('SBet: the label is yellow; with grow off it keeps its width and scales the text to fit', () => {
    const b = new SBet({ label: 'Legendary Warrior Ante', value: '€1,000.00', w: 232, h: 38, labelSize: 14, valueSize: 19, stepper: false, onStep: () => {}, grow: false });
    expect(b.labelText.style.fill).toBe(S.yellow);
    expect(b.measureSize()).toEqual({ w: 232, h: 38 });
    expect(b.labelText.x).toBeGreaterThan(0);
    expect(b.valueText.x + b.valueText.width).toBeLessThanOrEqual(232);
    expect(Math.abs(b.labelText.x - (232 - (b.valueText.x + b.valueText.width)))).toBeLessThan(0.5); // centred
  });

  it('SBet: ± step (unless disabled), the value opens the picker, no stepper when asked', () => {
    const steps: number[] = [];
    const onValue = vi.fn();
    const bet = new SBet({ label: 'Bet', value: '€1.00', w: 290, h: 46, labelSize: 14, valueSize: 24, stepper: true, onStep: (d) => steps.push(d), onValue });
    tap(bet.up!);
    tap(bet.down!);
    tap(bet.valueHit);
    expect(steps).toEqual([1, -1]);
    expect(onValue).toHaveBeenCalledTimes(1);
    bet.up!.disabled = true;
    tap(bet.up!);
    expect(steps).toEqual([1, -1]);
    expect(bet.up!.x + 46).toBe(bet.measureSize().w); // + sits at the right end, − at the left
    expect(bet.down!.x).toBe(0);
    const bare = new SBet({ label: 'Bet', value: '€1.00', w: 290, h: 46, labelSize: 14, valueSize: 24, stepper: false, onStep: () => {} });
    expect(bare.up).toBeUndefined();
    expect(bare.down).toBeUndefined();
  });

  it('SSpin: spin / stop / resume by autoplay state; the count shows, ∞ for an endless run', () => {
    const a = spin();
    tap(a.s);
    expect(a.s.mode).toBe('spin');
    expect(a.calls).toEqual(['spin']);
    const r = spin({ autoplay: 'running', remaining: 5 });
    tap(r.s);
    expect(r.s.mode).toBe('stop');
    expect(r.s.count).toBe('5');
    expect(r.calls).toEqual(['stop']);
    const p = spin({ autoplay: 'paused', remaining: 4 });
    tap(p.s);
    expect(p.s.mode).toBe('resume');
    expect(p.s.count).toBe('4');
    expect(p.calls).toEqual(['resume']);
    expect(spin({ autoplay: 'running', remaining: Infinity }).s.count).toBe('∞');
  });

  it('SSpin hit-tests its leaning outline, not its box', () => {
    const { s } = spin();
    expect(s.hitArea!.contains(2, 5)).toBe(false); // the empty top-left lean corner
    expect(s.hitArea!.contains(130, 68)).toBe(true);
  });

  it('SSpin: disabled ignores taps; busy rotates the glyph on the ticker until destroyed', () => {
    const { fns, ticker } = fakeTicker();
    const { s, calls } = spin({ ticker });
    s.disabled = true;
    tap(s);
    expect(calls).toEqual([]);
    expect(s.disabled).toBe(true);
    s.setBusy(true);
    s.setBusy(true);
    expect(fns.size).toBe(1);
    s.destroy({ children: true });
    expect(fns.size).toBe(0);
  });

  it('SFsCounter shows the label and the counter, centred', () => {
    const fs = new SFsCounter({ w: 260, h: 136, label: 'Free spins', value: '3 / 10', labelSize: 15, valueSize: 34 });
    expect(fs.valueText.text).toBe('3 / 10');
    expect(fs.valueText.x).toBeCloseTo((260 - fs.valueText.width) / 2, 5);
    expect(fs.measureSize()).toEqual({ w: 260, h: 136 });
  });

  it('SFsCounter scales a long label and value down to fit inside the leaning slab, centred', () => {
    const fs = new SFsCounter({ w: 150, h: 90, label: 'БЕСПЛАТНЫЕ ВРАЩЕНИЯ', value: '€1,234,567.89', labelSize: 11, valueSize: 22 });
    const inner = 150 - 2 * SKEW.spin[0][0]; // the lean eats SKEW.spin[0][0] at each end
    for (const t of [fs.labelText, fs.valueText]) {
      expect(t.width).toBeLessThanOrEqual(inner);
      expect(t.x).toBeCloseTo((150 - t.width) / 2, 5);
    }
  });
});
