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
import { openMenuModal } from './components/Menu';
import { openSettingsModal } from './components/Settings';

const REMOVE_FADE_MS = 300;

export class GameShell extends EventEmitter<ShellEvents> {
  readonly config: ShellConfig;
  state: ShellState;
  private root: HTMLElement;
  private styleEl: HTMLStyleElement;
  private barHost = document.createElement('div');
  private modalHost = document.createElement('div');
  private destroyed = false;

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
    this.render();
  }

  render(): void {
    if (this.destroyed) return;
    this.barHost.innerHTML = '';
    this.barHost.appendChild(renderBottomBar(this));
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

  openMenu(): void { this.emit('menuOpen'); this.showModal(openMenuModal(this)); }
  openSettings(): void { this.emit('settingsOpen'); this.showModal(openSettingsModal(this)); }
  openInfo(): void { this.emit('infoOpen'); /* GameInfo modal in Task 10 */ }
  openBuyBonus(): void { /* overlay in Task 11 */ }

  destroy(): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    this.destroyed = true;
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
