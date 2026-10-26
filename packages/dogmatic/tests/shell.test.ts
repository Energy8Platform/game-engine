import './setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect, afterEach } from 'vitest';
import { Container, type Application } from 'pixi.js';
import { createDogmaticShell, removeDogmaticShell, type Shell } from '../src/shell';
import { SBuyBonusPage } from '../src/shell/vendor/ui/pixi-s/components/BuyBonus';
import { SPage } from '../src/shell/vendor/ui/pixi-s/primitives/page';
import { SPicker } from '../src/shell/vendor/ui/pixi-s/components/pickers';
import { SCardModal } from '../src/shell/vendor/ui/pixi-s/primitives/card';

function fakeApp(w: number, h: number): Application {
  return {
    screen: { width: w, height: h },
    ticker: { add() {}, remove() {} },
    stage: new Container(),
    canvas: undefined,
    renderer: { on() {}, off() {}, render() {} },
  } as unknown as Application;
}

describe('createDogmaticShell', () => {
  let shell: Shell | undefined;
  afterEach(async () => {
    await removeDogmaticShell();
    shell = undefined;
  });

  it('mounts on the published controller, drops the spacebar menu row and opens every overlay (all S overlays)', async () => {
    const app = fakeApp(1280, 720);
    shell = createDogmaticShell({
      app,
      language: 'en',
      currency: { symbol: '$', position: 'left' },
      availableBets: [0.5, 1, 2],
      defaultBet: 1,
      currentBet: null,
      balance: 1000,
      win: 0,
      mode: 'base',
      gameInfo: { sections: [{ type: 'controls' }] },
      features: { turbo: 2, autoplay: {}, buyBonus: [{ id: 'fs', title: 'BONUS', description: 'x', priceMultiplier: 100 }] },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(shell.menu.some((m) => 'id' in m && m.id === 'spacebar')).toBe(false);
    expect(shell.safeArea.left + shell.safeArea.right + shell.safeArea.bottom).toBeGreaterThan(0);
    const layers = () => (app.stage.children[0] as Container).children[1].children;
    // every overlay is the provider's S-skin version
    const kinds: Array<[() => void, Function]> = [
      [() => shell!.openBuyBonus(), SBuyBonusPage],
      [() => shell!.openInfo(), SPage],
      [() => shell!.openBetPicker(), SPicker],
      [() => shell!.openAutoplayPicker(), SPicker],
      [() => shell!.openModal({ availableClose: true, title: 'Hi', body: 'There' }), SCardModal],
      [() => shell!.openReplay({ bonusId: 'fs', bet: 1, payoutMultiplier: 2, onReplay: () => {} }), SCardModal],
    ];
    for (const [open, cls] of kinds) {
      open();
      expect(layers().some((l) => l instanceof cls), cls.name).toBe(true);
      shell.closeModal();
    }
    for (const open of [
      () => shell!.openMenu(),
      () => shell!.openInfo(),
      () => shell!.openBetPicker(),
      () => shell!.openAutoplayPicker(),
      () => shell!.openModal({ availableClose: true, title: 'Hi', body: 'There' }),
    ]) {
      open();
      expect(layers().length).toBeGreaterThan(0);
      shell.closeModal();
    }
  });
});
