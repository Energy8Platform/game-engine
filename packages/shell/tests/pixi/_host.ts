// Shared test host for the migrated Pixi suite. Builds a full PixiComponentContext whose `actions`
// faithfully mirror ShellController.buildActions (emit the matching event + apply state) so the
// component tests assert the SAME observable effects they did against the legacy PixiGameShell host
// (which owned those methods directly). Nothing is weakened — the wiring is moved, not removed.
import type { Ticker } from 'pixi.js';
import type { PixiComponentContext, ShellLayer, LayerHandle } from '@/ui/pixi/context';
import type { ShellActions } from '@/core/renderer';
import { resolveTheme } from '@/core/theme';
import { createInitialState, stepBet, nextTurbo } from '@/core/state';
import type { ShellState } from '@/core/types';

const stubTicker = { add() {}, remove() {} } as unknown as Ticker;

export function defaultConfig(over: Record<string, unknown> = {}): any {
  return {
    app: {} as never,
    theme: {},
    language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [0.5, 1, 2, 5],
    defaultBet: 1,
    currentBet: null,
    balance: 100,
    win: 0,
    mode: 'base',
    gameInfo: {},
    features: { turbo: 0, autoplay: false, buyBonus: false },
    ...over,
  };
}

export interface HostOverrides extends Partial<PixiComponentContext> {
  config?: any;
  emit?: PixiComponentContext['emit'];
  closeLayer?: PixiComponentContext['closeLayer'];
}

/** Build a faithful PixiComponentContext. The `actions` object replicates the controller's logic so
 *  components that call `host.actions.*` produce the same emits / state changes the tests assert. */
export function makeContext(over: HostOverrides = {}): PixiComponentContext {
  const config = over.config ?? defaultConfig();
  const state: ShellState = (over.state as ShellState) ?? createInitialState(config);
  const tokens = over.tokens ?? resolveTheme({});
  const noop = () => {};
  const emit = (over.emit ?? (noop as never)) as PixiComponentContext['emit'];
  const closeLayer = over.closeLayer ?? noop;

  const actions: ShellActions = {
    spin: () => emit('spin'),
    stepBet: (dir) => {
      const next = stepBet(state, dir);
      if (next === state.bet) return;
      state.bet = next;
      emit('betChange', next);
    },
    setBet: (n) => {
      if (n !== state.bet) {
        state.bet = n;
        emit('betChange', n);
      }
    },
    cycleTurbo: () => {
      const next = nextTurbo(state.turbo, config.features.turbo);
      state.turbo = next;
      emit('turboChange', next);
    },
    toggleAutoplay: noop,
    startAutoplay: (remaining) => {
      state.autoplay = { active: true, remaining };
      emit('autoplayStart', { active: true, remaining });
    },
    stopAutoplay: () => {
      state.autoplay = { active: false, remaining: 0 };
      emit('autoplayStop');
    },
    openMenu: noop,
    openSettings: noop,
    openInfo: noop,
    openBuyBonus: noop,
    openBetPicker: noop,
    openAutoplayPicker: noop,
    selectBuyBonus: (id) => emit('buyBonusSelect', { id }),
    activateFeature: (b) => {
      state.activeFeature = b;
      emit('featureActivate', { id: b.id });
    },
    deactivateFeature: noop,
    setSound: noop,
    closeOverlay: () => closeLayer(),
    ...(over.actions ?? {}),
  };

  const ctx: PixiComponentContext = {
    state,
    config,
    tokens,
    layout: over.layout ?? 'wide',
    soundOn: over.soundOn ?? true,
    ticker: over.ticker ?? stubTicker,
    canvas: over.canvas,
    screenW: over.screenW ?? 1200,
    screenH: over.screenH ?? 675,
    t: over.t ?? ((s: string) => s),
    formatCurrency: over.formatCurrency ?? ((n: number, win?: boolean) => `€${n.toFixed(2)}`),
    fmt: over.fmt ?? ((n: number) => `€${n.toFixed(2)}`),
    fmtWin: over.fmtWin ?? ((n: number) => `€${n.toFixed(2)}`),
    emit,
    notifyResize: over.notifyResize ?? noop,
    setSound: over.setSound ?? noop,
    getVolume: over.getVolume ?? ((key) => state.volumes[key]),
    setVolume: over.setVolume ?? ((key, v) => { state.volumes[key] = Math.max(0, Math.min(1, v)); emit('settingChange', { key, value: state.volumes[key] }); }),
    menu: over.menu ?? [{ id: 'sound' }, { id: 'music' }, { id: 'sfx' }, { type: 'separator' }, { id: 'gameInfo' }],
    getMenuValue: over.getMenuValue ?? ((id: string) =>
      id === 'sound' ? true : id === 'music' || id === 'sfx' ? state.volumes[id] : state.menu[id]),
    setMenuValue: over.setMenuValue ?? ((id: string, v: boolean | number) => {
      if (id === 'music' || id === 'sfx') state.volumes[id] = Math.max(0, Math.min(1, Number(v)));
      else state.menu[id] = v;
      emit('settingChange', { key: id, value: v });
    }),
    setMenuRefresh: over.setMenuRefresh ?? noop,
    actions,
    render: over.render ?? noop,
    pushLayer: over.pushLayer ?? ((node: ShellLayer): LayerHandle => ({ root: node, close: noop })),
    closeLayer,
    fitModals: over.fitModals ?? noop,
  };
  return ctx;
}
