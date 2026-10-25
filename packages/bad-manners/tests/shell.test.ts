import './setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect, afterEach } from 'vitest';
import { Container, type Application } from 'pixi.js';
import { createBadMannersShell, removeBadMannersShell, loadBmAssets, type Shell } from '../src/shell';
import { Hud } from '../src/shell/Hud';
import { Field } from '../src/shell/components';
import { C, LIME } from '../src/shell/theme';

function fakeApp(w: number, h: number) {
  const listeners: Array<() => void> = [];
  const screen = { width: w, height: h };
  const app = {
    screen,
    ticker: { add() {}, remove() {} },
    stage: new Container(),
    canvas: undefined,
    renderer: {
      on: (_: string, fn: () => void) => listeners.push(fn),
      off() {},
      render() {},
    },
  };
  const resize = (nw: number, nh: number) => {
    screen.width = nw;
    screen.height = nh;
    listeners.forEach((f) => f());
  };
  return { app: app as unknown as Application, resize };
}

async function mount(w = 1280, h = 720, over: Record<string, unknown> = {}) {
  const { app, resize } = fakeApp(w, h);
  const shell = createBadMannersShell({
    app,
    language: 'en',
    currency: { symbol: '$', position: 'left' },
    availableBets: [0.5, 1, 2, 5],
    defaultBet: 1,
    currentBet: null,
    balance: 1000,
    win: 0,
    mode: 'base',
    gameInfo: { sections: [{ type: 'paytable', rows: [{ symbol: { text: 'A' }, wins: [{ count: '5', multiplier: 20 }] }] }] },
    features: {
      turbo: 2,
      autoplay: {},
      buyBonus: [
        { id: 'fs', title: 'Color Rush', description: 'Ten spins', priceMultiplier: 100, volatility: 4 },
        { id: 'ante', type: 'feature', title: 'Chapter Hunt', description: 'Bet mode', priceMultiplier: 2, volatility: 2 },
      ],
    },
    ...over,
  });
  await loadBmAssets();
  await Promise.resolve();
  const hud = () => (app.stage.children[0] as Container).children[0].children[0] as Hud;
  const layer = () => (app.stage.children[0] as Container).children[1].children.at(-1);
  return { shell, app, hud, layer, resize };
}

describe('createBadMannersShell', () => {
  let shell: Shell | undefined;
  afterEach(async () => {
    await removeBadMannersShell();
    shell = undefined;
  });

  it('desktop: menu over the round BUY over BALANCE on the left, autoplay/turbo over SPIN over BET on the right, WIN between', async () => {
    const m = await mount();
    shell = m.shell;
    const hud = m.hud();
    expect(hud).toBeInstanceOf(Hud);
    for (const k of ['menuBtn', 'balance', 'win', 'bet', 'spin', 'buy', 'autoBtn', 'turboBtn'] as const) expect(hud[k], k).toBeTruthy();
    const g = (n: Container) => n.getGlobalPosition();
    expect(g(hud.menuBtn).y).toBeLessThan(g(hud.buy!).y);
    expect(g(hud.buy!).y).toBeLessThan(g(hud.balance!).y);
    expect(g(hud.turboBtn!).y).toBeLessThan(g(hud.spin!).y);
    expect(g(hud.spin!).y).toBeLessThan(g(hud.bet).y);
    expect(g(hud.balance!).x).toBeLessThan(g(hud.win).x);
    expect(g(hud.win).x).toBeLessThan(g(hud.bet).x);
    // the bar sits on the bottom edge
    const bottom = g(hud.bet).y + hud.bet.getBounds().height;
    expect(720 - bottom).toBeLessThan(8);
    // SPIN at the kit's 128 + 25% (design px) — the BUY disc matches it
    expect(hud.spin!.bw).toBe(160);
    expect(hud.buy!.bw).toBe(160);
    const sa = shell.safeArea;
    expect(sa.left).toBeGreaterThan(0);
    expect(sa.right).toBeGreaterThan(0);
    expect(sa.bottom).toBeGreaterThan(0);
  });

  it('turbo shows three looks for levels 0 / 1 / 2', async () => {
    const m = await mount();
    shell = m.shell;
    const looks = [0, 1, 2].map((lvl) => {
      shell!.setTurbo(lvl);
      const b = m.hud().turboBtn! as unknown as { isOn: boolean; lime: boolean };
      return `${b.isOn}|${b.lime}`;
    });
    expect(new Set(looks).size).toBe(3);
  });

  it('the burger turns into the ✕ while the menu is open', async () => {
    const m = await mount();
    shell = m.shell;
    const icon = () => m.hud().menuBtn.iconName;
    expect(icon()).toBe('menu');
    shell.openMenu();
    expect(icon()).toBe('close');
    shell.closeModal();
    expect(icon()).toBe('menu');
  });

  it('an active feature turns the BUY disc into a ✕ that switches it off', async () => {
    const m = await mount();
    shell = m.shell;
    const events: string[] = [];
    shell.on('featureDeactivate', () => events.push('off'));
    shell.activateFeature({ id: 'ante', type: 'feature', title: 'Chapter Hunt', description: '', priceMultiplier: 2 });
    m.hud().buy!.emit('pointertap', undefined as never);
    expect(events).toEqual(['off']);
  });

  it('portrait: BALANCE | BET on the bottom row, SPIN above them, WIN above SPIN', async () => {
    const m = await mount(1280, 720);
    shell = m.shell;
    m.resize(390, 844);
    const hud = m.hud();
    const gy = (n: Container) => n.getGlobalPosition().y;
    expect(Math.abs(gy(hud.balance!) - gy(hud.bet))).toBeLessThan(1);
    expect(gy(hud.spin!)).toBeLessThan(gy(hud.bet));
    expect(gy(hud.win)).toBeLessThan(gy(hud.spin!));
    const right = hud.bet.getGlobalPosition().x + hud.bet.getBounds().width;
    expect(right).toBeLessThanOrEqual(390 + 0.5);
  });

  it('a readout never narrows when its value gets shorter (no width jitter)', async () => {
    const m = await mount();
    shell = m.shell;
    shell.setBalance(123456.78);
    const wide = m.hud().balance!.fw;
    shell.setBalance(1);
    expect(m.hud().balance!.fw).toBe(wide);
  });

  it('opens every overlay without throwing', async () => {
    const m = await mount();
    shell = m.shell;
    const opens: Array<() => void> = [
      () => shell!.openMenu(),
      () => shell!.openInfo(),
      () => shell!.openBuyBonus(),
      () => shell!.openBetPicker(),
      () => shell!.openAutoplayPicker(),
      () => shell!.openReplay({ bonusId: 'fs', bet: 1, payoutMultiplier: 12, onReplay: () => {} }),
      () => shell!.openModal({ availableClose: true, title: 'No funds', body: 'Top up to keep playing.', actions: [{ title: 'OK', color: '#fff' }] }),
    ];
    for (const open of opens) {
      open();
      expect(m.layer()).toBeTruthy();
      shell.closeModal();
    }
  });

  it('free spins swap SPIN for the counter and show TOTAL WIN; the bet loses its stepper', async () => {
    const m = await mount();
    shell = m.shell;
    shell.setMode('freeSpins');
    shell.setFreeSpins({ current: 3, total: 10, totalWin: 25 });
    const hud = m.hud();
    expect(hud.totalWin).toBeInstanceOf(Field);
    expect(hud.buy).toBeUndefined();
    expect(hud.bet.plus).toBeUndefined();
    // TOTAL WIN drops onto BALANCE, the menu right on top of it
    const gy = (n: Container) => n.getGlobalPosition().y;
    const s = hud.totalWin!.getBounds().height / hud.totalWin!.fh;
    expect(gy(hud.balance!) - (gy(hud.totalWin!) + hud.totalWin!.fh * s)).toBeLessThan(20 * s);
    expect(gy(hud.totalWin!) - (gy(hud.menuBtn) + hud.menuBtn.bh * s)).toBeLessThan(4 * s);
  });

  it('takes the accent from theme.accent and switches it live', async () => {
    const m = await mount(1280, 720, { theme: { accent: '#ff3b8b' } });
    shell = m.shell;
    expect(C.lime).toBe(0xff3b8b);
    shell.setTheme({ accent: '#3be0ff' });
    await loadBmAssets(0x3be0ff);
    await Promise.resolve();
    expect(C.lime).toBe(0x3be0ff);
    expect(m.hud()).toBeInstanceOf(Hud);
    shell.setTheme({});
    await loadBmAssets(LIME);
    await Promise.resolve();
    expect(C.lime).toBe(LIME);
  });
});
