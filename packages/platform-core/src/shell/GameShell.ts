import { EventEmitter } from '../EventEmitter';
import type { ShellConfig, ShellEvents, ShellState } from './types';
import { createInitialState } from './state';
import { buildThemeVars } from './theme';
import { SHELL_CSS, SHELL_ROOT_ID } from './shell.css';

const REMOVE_FADE_MS = 300;

export class GameShell extends EventEmitter<ShellEvents> {
  readonly config: ShellConfig;
  state: ShellState;
  private root: HTMLElement;
  private styleEl: HTMLStyleElement;
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
    this.render();
  }

  /** Re-render the shell from current state. Filled in by later tasks. */
  render(): void {
    // BottomBar / modal rendering attached in Task 7+.
  }

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
