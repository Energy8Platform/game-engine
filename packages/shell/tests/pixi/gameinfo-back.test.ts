import './setup-canvas'; // must be first
import { describe, it, expect, vi } from 'vitest';
import type { Container } from 'pixi.js';
import { openGameInfo } from '@/ui/pixi/components/GameInfo';
import { makeContext, defaultConfig } from './_host';

// Regression: the Pixi Back button used to call actions.openSettings() — the deprecated alias —
// so ordinary back-navigation emitted the deprecated `settingsOpen` event on every trip through
// Game info. It must go through the current openMenu() path instead (see the DOM equivalent in
// tests/html/gameinfo.test.ts, "Back emits menuOpen, not the deprecated settingsOpen").
describe('GameInfo — Pixi shell, Back navigation', () => {
  it('Back closes the layer and calls openMenu(), not the deprecated openSettings()', () => {
    const openMenu = vi.fn();
    const openSettings = vi.fn();
    const closeLayer = vi.fn();
    const config = defaultConfig({ gameInfo: { sections: [{ type: 'controls' }] } });
    const host = makeContext({
      config,
      screenW: 800,
      screenH: 600,
      closeLayer,
      actions: { openMenu, openSettings },
    });

    const overlay = openGameInfo(host);
    // Overlay.buildHeader() adds [title, back-or-spacer, close] to its private `header` — the back
    // button is the returned Container's own `navButton`, which wires `onTap` to a `pointertap`
    // listener on itself (see primitives/widgets.ts's attachPress). Reaching into the private field
    // is the established pattern this suite already uses (see e.g. tests/pixi/layout.test.ts's
    // `.inner` reads) when a component has no public API for the thing under test.
    const header = (overlay as unknown as { header: Container }).header;
    const back = header.children[1];
    back.emit('pointertap');

    expect(closeLayer).toHaveBeenCalledOnce();
    expect(openMenu).toHaveBeenCalledOnce();
    expect(openSettings).not.toHaveBeenCalled();
  });
});
