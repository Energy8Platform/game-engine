import './setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
// @vitest-environment jsdom
/**
 * Grouped buy-bonus options (`groupedBy`) in the Pixi shell: several options share ONE card slot
 * and are flipped through with the card's arrows. The four same-priced Ante characters are the
 * motivating case — the whole card (title, art, description, volatility, price) swaps together.
 */
import { describe, it, expect, vi } from 'vitest';
import { Container } from 'pixi.js';
import type { PixiComponentContext, ShellLayer } from '@/ui/pixi/context';
import type { BonusOption } from '@/core/types';
import { openBuyBonus } from '@/ui/pixi/components/BuyBonus';
import { makeContext, defaultConfig, type HostOverrides } from './_host';

const ANTE = (id: string, over: Partial<BonusOption> = {}): BonusOption => ({
  id,
  type: 'feature',
  groupedBy: 'ante',
  title: id.toUpperCase(),
  description: `${id} ability`,
  priceMultiplier: 10,
  volatility: 3,
  ...over,
});

const GROUPED: BonusOption[] = [
  ANTE('warrior'),
  ANTE('mage'),
  ANTE('archer'),
  { id: 'buy', type: 'bonus', title: 'Buy Free Spins', description: '10 spins', priceMultiplier: 50, volatility: 4 },
];

function makeHost(over: HostOverrides = {}, bonuses: BonusOption[] = GROUPED): PixiComponentContext {
  return makeContext({
    config: defaultConfig({
      availableBets: [1, 2, 5],
      defaultBet: 1,
      balance: 1000,
      features: { turbo: 0, autoplay: {}, buyBonus: bonuses },
    }),
    ...over,
  });
}

const key = (code: string): KeyboardEvent =>
  new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true });

/** The member cards of a group carry `bb-card:<id>` labels; exactly one is visible at a time. */
function shownMember(layer: ShellLayer, ids: string[]): string | undefined {
  const node = layer as unknown as Container;
  return ids.find((id) => node.getChildByLabel(`bb-card:${id}`, true)?.visible);
}

/** Tap a labelled node the way the shell's own pointer handlers are invoked. */
function tap(layer: ShellLayer, label: string): void {
  const node = (layer as unknown as Container).getChildByLabel(label, true);
  if (!node) throw new Error(`no node labelled ${label}`);
  node.emit('pointertap', { stopPropagation() {} } as never);
}

const ANTE_IDS = ['warrior', 'mage', 'archer'];

describe('BuyBonus grouped options (Pixi shell)', () => {
  it('renders one card per slot — three Ante variants collapse into a single card', () => {
    const layer = openBuyBonus(makeHost())!;
    // Every member is built (so the slot can size to the tallest), but only one shows.
    const visible = ANTE_IDS.filter((id) => (layer as unknown as Container).getChildByLabel(`bb-card:${id}`, true)?.visible);
    expect(visible).toEqual(['warrior']);
    expect((layer as unknown as Container).getChildByLabel('bb-card:buy', true)?.visible).toBe(true);
  });

  it('the next arrow flips to the following member, and wraps around at the end', () => {
    const layer = openBuyBonus(makeHost())!;
    tap(layer, 'bb-nav-next:ante');
    expect(shownMember(layer, ANTE_IDS)).toBe('mage');
    tap(layer, 'bb-nav-next:ante');
    expect(shownMember(layer, ANTE_IDS)).toBe('archer');
    tap(layer, 'bb-nav-next:ante');
    expect(shownMember(layer, ANTE_IDS)).toBe('warrior');
  });

  it('the previous arrow wraps backwards from the first member', () => {
    const layer = openBuyBonus(makeHost())!;
    tap(layer, 'bb-nav-prev:ante');
    expect(shownMember(layer, ANTE_IDS)).toBe('archer');
  });

  it('an ungrouped card gets no arrows', () => {
    const layer = openBuyBonus(makeHost())!;
    expect((layer as unknown as Container).getChildByLabel('bb-nav-next:ante', true)).toBeTruthy();
    expect((layer as unknown as Container).getChildByLabel('bb-nav-next:buy', true)).toBeNull();
  });

  it('activates the id of the member on show, not the first one', () => {
    const activateFeature = vi.fn();
    const layer = openBuyBonus(makeHost({ actions: { activateFeature } as never }))!;
    tap(layer, 'bb-nav-next:ante'); // → mage
    tap(layer, 'bb-cta:mage'); // opens confirm for the shown member
    tap(layer, 'bb-confirm-ok');
    expect(activateFeature).toHaveBeenCalledTimes(1);
    expect(activateFeature.mock.calls[0][0].id).toBe('mage');
  });

  it('keeps the flipped member when the bet changes and the cards are rebuilt', () => {
    const layer = openBuyBonus(makeHost())!;
    tap(layer, 'bb-nav-next:ante'); // → mage
    layer.onKey!(key('Equal')); // bet up → buildCards()
    expect(shownMember(layer, ANTE_IDS)).toBe('mage');
  });

  it('keyboard focus walks every member — the card flips to the focused one', () => {
    const layer = openBuyBonus(makeHost())!;
    const onKey = layer.onKey!.bind(layer);
    onKey(key('ArrowRight')); // warrior → mage
    expect(shownMember(layer, ANTE_IDS)).toBe('mage');
    onKey(key('ArrowRight')); // → archer
    expect(shownMember(layer, ANTE_IDS)).toBe('archer');
    onKey(key('ArrowRight')); // → the ungrouped card; the group keeps its last member
    expect(shownMember(layer, ANTE_IDS)).toBe('archer');
  });

  it('Enter on a focused group member confirms and buys that member', () => {
    const emit = vi.fn();
    const activateFeature = vi.fn();
    const layer = openBuyBonus(makeHost({ emit: emit as never, actions: { activateFeature } as never }))!;
    const onKey = layer.onKey!.bind(layer);
    onKey(key('ArrowRight')); // → mage
    onKey(key('Enter')); // confirm
    onKey(key('Enter')); // activate
    expect(activateFeature.mock.calls[0][0].id).toBe('mage');
  });
});
