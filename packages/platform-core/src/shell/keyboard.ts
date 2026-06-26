import type { ShellState } from './types';

export interface KeyboardHost {
  readonly state: ShellState;
  readonly hotkeysEnabled: boolean;   // features.hotkeys !== false
  readonly spacebarEnabled: boolean;  // features.spacebar !== false
  readonly turboLevels: number;       // features.turbo
  readonly autoplayEnabled: boolean;  // features.autoplay != null
  readonly buyBonusEnabled: boolean;  // features.buyBonus !== false
  hasOpenLayer(): boolean;
  routeToLayer(e: KeyboardEvent): boolean; // give the key to the top layer's onKey; true if consumed
  spin(): void;
  stepBet(dir: 1 | -1): void;
  toggleAutoplay(): void;
  cycleTurbo(): void;
  openBuyBonus(): void;
  openInfo(): void;
  openMenu(): void;
  toggleMute(): void;
  closeLayer(): void;
}

export class KeyboardController {
  private host: KeyboardHost;
  private doc: Document;
  private spaceHeld = false;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(host: KeyboardHost, doc?: Document) {
    this.host = host;
    this.doc = doc ?? (typeof document !== 'undefined' ? document : (null as unknown as Document));
  }

  private isSpinAllowed(): boolean {
    const h = this.host;
    const s = h.state;
    return (
      h.spacebarEnabled &&
      h.hotkeysEnabled &&
      !h.hasOpenLayer() &&
      s.mode === 'base' &&
      !s.autoplay.active
    );
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    // Editable element guard — never intercept keyboard input
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;

    // For Space: claim preventDefault early (before layer/mode/busy bail) so the browser's
    // native "Space activates focused button" can't re-fire a shell control and flicker a modal.
    if (e.code === 'Space' && !e.repeat) {
      if (!this.host.spacebarEnabled || !this.host.hotkeysEnabled) return;
      e.preventDefault();
      if (this.host.hasOpenLayer()) {
        this.host.routeToLayer(e);
        return;
      }
      const s = this.host.state;
      if (s.mode !== 'base' || s.busy || s.autoplay.active) return;
      this.spaceHeld = true;
      this.host.spin();
      return;
    }

    // Non-Space keys: route to open layer first, then bar shortcuts (Tasks 6-7)
    if (this.host.hasOpenLayer()) {
      const consumed = this.host.routeToLayer(e);
      if (!consumed && e.code === 'Escape') this.host.closeLayer();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'Space') {
      this.spaceHeld = false;
      this.clearHoldTimer();
    }
  };

  private clearHoldTimer(): void {
    if (this.holdTimer !== null) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }

  attach(): void {
    this.doc.addEventListener('keydown', this.onKeyDown);
    this.doc.addEventListener('keyup', this.onKeyUp);
  }

  detach(): void {
    this.doc.removeEventListener('keydown', this.onKeyDown);
    this.doc.removeEventListener('keyup', this.onKeyUp);
    this.spaceHeld = false;
    this.clearHoldTimer();
  }

  notifyBusyChanged(busy: boolean): void {
    if (busy) return;
    if (!this.spaceHeld) return;
    if (!this.isSpinAllowed()) return;
    // Schedule the next spin after the 120 ms floor (gap between completion and next spin).
    this.clearHoldTimer();
    this.holdTimer = setTimeout(() => {
      this.holdTimer = null;
      if (this.spaceHeld && this.isSpinAllowed()) {
        this.host.spin();
      }
    }, 120);
  }
}
