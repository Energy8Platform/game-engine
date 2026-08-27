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

  it('секция, заданную самой игрой, тоже прячем, когда клавиш нет', () => {
    // Мастер-выключатель обязан гасить ВСЮ клавиатурную поверхность: раскладка клавиш,
    // которых у игрока нет, — обещание, которое игра не выполнит.
    const host = makeHost({ hotkeys: false }, [{ type: 'controls' }, { type: 'hotkeys' }]);
    const overlay = openGameInfo(host);
    overlay.resize?.(800, 600);
    expect(collectLabels(overlay).some((l) => l.toUpperCase() === 'HOTKEYS')).toBe(false);
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

// ── narrow-width fit (mobile) ────────────────────────────────────────────────
// The wide "Raise bet"/"Lower bet" rows (Shift/↑/Shift/=) must not push their label off the plaque
// on a narrow screen: the chip combos stack and the label wraps within the leftover width.
describe('Hotkeys section — narrow-width fit (Pixi)', () => {
  /** Overlay inner content width for a screen width, mirroring Overlay.layoutBody + section pad. */
  function innerFor(screenW: number): number {
    const sidePad = Math.max(16, Math.min(24, 4 * (screenW / 100)));
    const bodyW = Math.min(800, screenW - sidePad * 2);
    return bodyW - 18 * 2; // SECTION_PAD
  }

  function findTextNode(node: any, text: string): any {
    if (node?.text === text) return node;
    for (const child of node?.children ?? []) {
      const hit = findTextNode(child, text);
      if (hit) return hit;
    }
    return null;
  }

  /** The row + its chips/label parts for a hotkey action, at a given screen size. */
  function hotkeyRow(screenW: number, screenH: number, action: string) {
    const host = makeContext({
      config: defaultConfig({
        availableBets: [1],
        gameInfo: { sections: [{ type: 'hotkeys' }] }, // hotkeys only → the label is unique
        features: { turbo: 0, autoplay: {}, buyBonus: false },
      }),
      screenW,
      screenH,
    });
    const overlay = openGameInfo(host);
    overlay.resize?.(screenW, screenH);
    const label = findTextNode(overlay, action);
    const row = label?.parent;
    const chips = row?.children.find((c: any) => c !== label);
    return { inner: innerFor(screenW), label, row, chips };
  }

  it('constrains the wide row to the plaque and fits chips + label within it', () => {
    const { inner, label, row, chips } = hotkeyRow(300, 700, 'Raise bet');
    expect(label).toBeTruthy();
    // The row is width-bounded (the old row was content-sized and overflowed the plaque).
    expect(row.getLocalBounds().width).toBeLessThanOrEqual(inner + 2);
    // Chips + gap + label all fit inside the inner width → nothing clips past the edge.
    const cw = chips.getLocalBounds().width;
    const lw = label.getLocalBounds().width;
    expect(cw + 14 + lw).toBeLessThanOrEqual(inner + 2);
  });

  it('stacks the chip combos onto two lines when the row is narrow', () => {
    const narrow = hotkeyRow(300, 700, 'Raise bet');
    const wide = hotkeyRow(900, 700, 'Raise bet');
    // Narrow: the two Shift-combos wrap → the chips block is taller than the single-line wide layout.
    expect(narrow.chips.getLocalBounds().height).toBeGreaterThan(wide.chips.getLocalBounds().height * 1.5);
  });

  it('keeps a single-key row (Space → Spin) on one line at any width', () => {
    const narrow = hotkeyRow(300, 700, 'Spin');
    const wide = hotkeyRow(900, 700, 'Spin');
    // One keycap → same height narrow vs wide (never needs to wrap).
    expect(narrow.chips.getLocalBounds().height).toBeCloseTo(wide.chips.getLocalBounds().height, 0);
  });
});
