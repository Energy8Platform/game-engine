import { EventEmitter } from '../EventEmitter';
import type {
  AutoplayOptions,
  FreeSpinsState,
  ShellConfig,
  ShellEvents,
  ShellMode,
  ShellState,
} from './types';
import { createInitialState } from './state';
import { buildThemeVars } from './theme';
import { SHELL_CSS, SHELL_ROOT_ID } from './shell.css';
import { renderBottomBar } from './components/BottomBar';
import { openSettingsModal } from './components/Settings';
import { openGameInfoModal } from './components/GameInfo';
import { openBuyBonusOverlay } from './components/BuyBonus';
import { prefersReducedMotion } from './motion';

const REMOVE_FADE_MS = 300;

export class GameShell extends EventEmitter<ShellEvents> {
  readonly config: ShellConfig;
  state: ShellState;
  private root: HTMLElement;
  private styleEl: HTMLStyleElement;
  private barHost = document.createElement('div');
  private modalHost = document.createElement('div');
  private destroyed = false;
  layout: 'wide' | 'narrow' = 'wide';
  private ro: ResizeObserver | null = null;
  private prevBalance = 0;
  private prevWin = 0;

  constructor(config: ShellConfig) {
    super();
    this.config = config;
    this.state = createInitialState(config);

    this.styleEl = document.createElement('style');
    this.styleEl.textContent = SHELL_CSS;

    this.root = document.createElement('div');
    this.root.id = SHELL_ROOT_ID;
    this.root.setAttribute('style', buildThemeVars(config.theme));

    config.mount.append(this.styleEl, this.root);
    this.barHost.className = 'ge-shell-barhost';
    this.root.appendChild(this.barHost);
    this.modalHost.className = 'ge-shell-modalhost';
    this.root.appendChild(this.modalHost);
    this.prevBalance = this.state.balance;
    this.prevWin = this.state.win;
    this.observeLayout();
    this.render();
  }

  render(): void {
    if (this.destroyed) return;
    this.root.classList.toggle('ge-narrow', this.layout === 'narrow');
    this.barHost.innerHTML = '';
    this.barHost.appendChild(renderBottomBar(this));
    this.animateMoney();
  }

  setLayout(layout: 'wide' | 'narrow'): void {
    if (layout === this.layout) return;
    this.layout = layout;
    this.root.classList.toggle('ge-narrow', layout === 'narrow');
    this.render();
  }

  private observeLayout(): void {
    const RO = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (typeof RO !== 'function') return; // jsdom: stays 'wide'
    this.ro = new RO((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      this.setLayout(w > 0 && w < 720 ? 'narrow' : 'wide');
    });
    this.ro.observe(this.root);
  }

  /** Post-render hook: tracks previous money values (count-up wired in a later task). */
  private animateMoney(): void {
    void prefersReducedMotion; // imported now; count-up animation wired later
    this.prevBalance = this.state.balance;
    this.prevWin = this.state.win;
  }

  setBalance(n: number): void { this.state.balance = n; this.render(); }
  setWin(n: number): void { this.state.win = n; this.render(); }
  setBet(n: number): void { this.state.bet = n; this.render(); }
  setMode(mode: ShellMode): void { this.state.mode = mode; this.render(); }
  setBusy(busy: boolean): void { this.state.busy = busy; this.render(); }
  setAutoplay(a: AutoplayOptions): void { this.state.autoplay = a; this.render(); }
  setTurbo(level: number): void { this.state.turbo = level; this.render(); }
  setBuyBonusEnabled(enabled: boolean): void { this.state.buyBonusEnabled = enabled; this.render(); }
  setFreeSpins(fs: FreeSpinsState): void { this.state.freeSpins = fs; this.render(); }

  private showModal(el: HTMLElement): void {
    this.modalHost.innerHTML = '';
    this.modalHost.appendChild(el);
  }

  openMenu(): void { this.emit('menuOpen'); this.openSettings(); }
  openSettings(): void { this.emit('settingsOpen'); this.showModal(openSettingsModal(this)); }
  openInfo(): void { this.emit('infoOpen'); this.showModal(openGameInfoModal(this)); }
  openBuyBonus(): void {
    const overlay = openBuyBonusOverlay(this);
    if (overlay) this.showModal(overlay);
  }

  destroy(): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    this.destroyed = true;
    this.ro?.disconnect();
    this.ro = null;
    this.removeAllListeners();
    this.root.classList.add('ge-shell-hidden');
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        this.root.remove();
        this.styleEl.remove();
        resolve();
      }, REMOVE_FADE_MS);
    });
  }
}
