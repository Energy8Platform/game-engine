import './setup-canvas'; // must be first
import { describe, it, expect } from 'vitest';
import type { PixiComponentContext } from '@/ui/pixi/context';
import { openGameInfo } from '@/ui/pixi/components/GameInfo';
import { makeContext, defaultConfig } from './_host';

function makeHost(featureOverrides: Record<string, unknown> = {}, sections?: unknown[]): PixiComponentContext {
  const config = defaultConfig({
    availableBets: [1],
    gameInfo: { sections: sections ?? [{ type: 'controls' }] },
    features: {
      turbo: 0,
      autoplay: {},
      buyBonus: [{ id: 'fs', title: 'Free Spins', description: '10 free spins', priceMultiplier: 100 }],
      ...featureOverrides,
    },
  });
  return makeContext({ config, screenW: 800, screenH: 600 });
}

/** Recursively collect all text labels from a Pixi Container tree. */
function collectLabels(node: any): string[] {
  const out: string[] = [];
  if (node?.text != null) out.push(String(node.text));
  const children: any[] = node?.children ?? [];
  for (const child of children) {
    out.push(...collectLabels(child));
  }
  return out;
}

/** Collect all FlexBox nodes tagged with a given tag from a container tree. */
function findByTag(node: any, tag: string): any[] {
  const out: any[] = [];
  if (node?._tag === tag) out.push(node);
  const children: any[] = node?.children ?? [];
  for (const child of children) {
    out.push(...findByTag(child, tag));
  }
  return out;
}

describe('Hotkeys section — Pixi shell', () => {
  it('auto-injects a hotkeys section when features.hotkeys is not set', () => {
    const host = makeHost({});
    const overlay = openGameInfo(host);
    overlay.resize?.(800, 600);
    const labels = collectLabels(overlay);
    // section title is uppercased by the section() helper
    expect(labels.some((l) => l.toUpperCase() === 'HOTKEYS')).toBe(true);
  });

  it('Hotkeys section contains Spin label', () => {
    const host = makeHost({});
    const overlay = openGameInfo(host);
    overlay.resize?.(800, 600);
    const labels = collectLabels(overlay);
    expect(labels.some((l) => l === 'Spin')).toBe(true);
  });

  it('Hotkeys section contains Raise bet and Lower bet labels', () => {
    const host = makeHost({});
    const overlay = openGameInfo(host);
    overlay.resize?.(800, 600);
    const labels = collectLabels(overlay);
    expect(labels.some((l) => l === 'Raise bet')).toBe(true);
    expect(labels.some((l) => l === 'Lower bet')).toBe(true);
  });

  it('Hotkeys section contains Game info label', () => {
    const host = makeHost({});
    const overlay = openGameInfo(host);
    overlay.resize?.(800, 600);
    const labels = collectLabels(overlay);
    expect(labels.some((l) => l === 'Game info')).toBe(true);
  });

  it('omits Turbo when turbo === 0', () => {
    const host = makeHost({ turbo: 0 });
    const overlay = openGameInfo(host);
    overlay.resize?.(800, 600);
    // Labels before Hotkeys section also include controls section — count distinct occurrences
    // We need Turbo to appear only in controls section (which has turbo: 0 → also excluded)
    // Actually with turbo:0 it shouldn't appear anywhere
    const labels = collectLabels(overlay);
    // The controls section also omits Turbo when turbo:0; hotkeys section should too
    // Count how many times "Turbo" appears — should be 0
    expect(labels.filter((l) => l === 'Turbo')).toHaveLength(0);
  });

  it('includes Turbo when turbo > 0', () => {
    const host = makeHost({ turbo: 2 });
    const overlay = openGameInfo(host);
    overlay.resize?.(800, 600);
    const labels = collectLabels(overlay);
    expect(labels.some((l) => l === 'Turbo')).toBe(true);
  });

  it('omits Autoplay when features.autoplay is null', () => {
    const host = makeHost({ autoplay: null });
    const overlay = openGameInfo(host);
    overlay.resize?.(800, 600);
    const labels = collectLabels(overlay);
    expect(labels.some((l) => l === 'Autoplay')).toBe(false);
  });

  it('includes Autoplay when features.autoplay is set', () => {
    const host = makeHost({ autoplay: {} });
    const overlay = openGameInfo(host);
    overlay.resize?.(800, 600);
    const labels = collectLabels(overlay);
    expect(labels.some((l) => l === 'Autoplay')).toBe(true);
  });

  it('does NOT inject hotkeys when features.hotkeys === false', () => {
    const host = makeHost({ hotkeys: false });
    const overlay = openGameInfo(host);
    overlay.resize?.(800, 600);
    const labels = collectLabels(overlay);
    // Hotkeys section title should not appear
    expect(labels.some((l) => l.toUpperCase() === 'HOTKEYS')).toBe(false);
  });

  it('does not double-inject when game already supplies a hotkeys section', () => {
    const host = makeHost({}, [{ type: 'controls' }, { type: 'hotkeys' }]);
    const overlay = openGameInfo(host);
    overlay.resize?.(800, 600);
    const labels = collectLabels(overlay);
    // section title is uppercased by the section() helper
    const hotkeysCount = labels.filter((l) => l.toUpperCase() === 'HOTKEYS').length;
    expect(hotkeysCount).toBe(1);
  });

  it('renders Space keycap chip for Spin action', () => {
    const host = makeHost({});
    const overlay = openGameInfo(host);
    overlay.resize?.(800, 600);
    const labels = collectLabels(overlay);
    expect(labels.some((l) => l === 'Space')).toBe(true);
  });
});
