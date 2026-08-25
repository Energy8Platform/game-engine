/**
 * `groupedBy` collapses several bonus options into one carousel slot (pixi shell). The grouping
 * itself is pure — the renderers only lay out whatever slots come back.
 */
import { describe, it, expect } from 'vitest';
import type { BonusOption } from '@/core/types';
import { groupBonusSlots } from '@/core/bonusGroups';

const opt = (id: string, over: Partial<BonusOption> = {}): BonusOption => ({
  id,
  title: id,
  description: `${id} desc`,
  priceMultiplier: 10,
  ...over,
});

describe('groupBonusSlots', () => {
  it('gives every ungrouped option its own slot, in order', () => {
    const slots = groupBonusSlots([opt('a'), opt('b')]);
    expect(slots.map((s) => s.map((b) => b.id))).toEqual([['a'], ['b']]);
  });

  it('collapses options sharing a key into one slot', () => {
    const slots = groupBonusSlots([
      opt('warrior', { groupedBy: 'ante' }),
      opt('mage', { groupedBy: 'ante' }),
      opt('archer', { groupedBy: 'ante' }),
    ]);
    expect(slots.map((s) => s.map((b) => b.id))).toEqual([['warrior', 'mage', 'archer']]);
  });

  it('keeps the slot at the position of the group\'s first member, even when members are apart', () => {
    const slots = groupBonusSlots([
      opt('warrior', { groupedBy: 'ante' }),
      opt('buy'),
      opt('mage', { groupedBy: 'ante' }),
    ]);
    expect(slots.map((s) => s.map((b) => b.id))).toEqual([['warrior', 'mage'], ['buy']]);
  });

  it('keeps separate keys in separate slots', () => {
    const slots = groupBonusSlots([
      opt('w', { groupedBy: 'ante' }),
      opt('s10', { groupedBy: 'spins' }),
      opt('m', { groupedBy: 'ante' }),
      opt('s20', { groupedBy: 'spins' }),
    ]);
    expect(slots.map((s) => s.map((b) => b.id))).toEqual([['w', 'm'], ['s10', 's20']]);
  });

  it('never groups a custom-rendered option — the shell cannot draw arrows over a game-owned card', () => {
    const slots = groupBonusSlots([
      opt('warrior', { groupedBy: 'ante' }),
      opt('custom', { groupedBy: 'ante', custom: () => ({}) }),
      opt('mage', { groupedBy: 'ante' }),
    ]);
    expect(slots.map((s) => s.map((b) => b.id))).toEqual([['warrior', 'mage'], ['custom']]);
  });

  it('does not mutate the input array', () => {
    const input = [opt('w', { groupedBy: 'ante' }), opt('m', { groupedBy: 'ante' })];
    groupBonusSlots(input);
    expect(input.map((b) => b.id)).toEqual(['w', 'm']);
  });
});
