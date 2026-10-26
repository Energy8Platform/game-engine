import type { BonusOption } from './types';

/** Collapse buy-bonus options that share a `groupedBy` key into one slot. A slot with more than one
 *  member is rendered by the pixi shell as a single card with arrows (the DOM shell ignores the key
 *  and keeps a card per option).
 *
 *  A group takes the position of its FIRST member, so the strip order stays predictable however the
 *  members are scattered through the array. Options with a game-supplied `custom` renderer never
 *  join a group — the shell has no layout for their interior and could not place arrows over it. */
export function groupBonusSlots(bonuses: readonly BonusOption[]): BonusOption[][] {
  const slots: BonusOption[][] = [];
  const byKey = new Map<string, BonusOption[]>();
  for (const bonus of bonuses) {
    const key = bonus.groupedBy;
    if (!key || bonus.custom) {
      slots.push([bonus]);
      continue;
    }
    const open = byKey.get(key);
    if (open) {
      open.push(bonus);
      continue;
    }
    const slot = [bonus];
    byKey.set(key, slot);
    slots.push(slot);
  }
  return slots;
}
