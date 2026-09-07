import type { ShellState } from './types';
import { bonusBuyLocked } from './state';

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

// Bet key detection: bet-up needs Shift for arrow/equal, NumpadAdd is bare; same logic for down.
// Exported so overlays with their own bet stepper (Buy bonus) honour the SAME keys as the bar.
export function betDir(e: KeyboardEvent): 1 | -1 | null {
  if (e.code === 'ArrowUp'   && e.shiftKey) return 1;
  if (e.code === 'Equal'     && e.shiftKey) return 1;
  if (e.code === 'NumpadAdd')               return 1;
  if (e.code === 'ArrowDown' && e.shiftKey) return -1;
  if (e.code === 'Minus'     && e.shiftKey) return -1;
  if (e.code === 'NumpadSubtract')          return -1;
  return null;
}

export class KeyboardController {
  private host: KeyboardHost;
  private doc: Document;
  private spaceHeld = false;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  // Bet hold-repeat state
  private betHeldCode: string | null = null;
  private betTimer: ReturnType<typeof setTimeout> | null = null;

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

  private isBetAllowed(): boolean {
    const h = this.host;
    const s = h.state;
    return (
      h.hotkeysEnabled &&
      !h.hasOpenLayer() &&
      s.mode === 'base' &&
      !s.busy
    );
  }

  private clearBetTimer(): void {
    if (this.betTimer !== null) {
      clearTimeout(this.betTimer);
      this.betTimer = null;
    }
  }

  private startBetRepeat(dir: 1 | -1, elapsed: number): void {
    // elapsed is ms already spent holding; use it to accelerate toward 45ms floor.
    // Start at 90ms, decrease ~1ms per 10ms held after the first repeat, floor at 45ms.
    const interval = Math.max(45, 90 - Math.floor(elapsed / 10));
    this.betTimer = setTimeout(() => {
      this.betTimer = null;
      if (this.betHeldCode !== null && this.isBetAllowed()) {
        this.host.stepBet(dir);
        this.startBetRepeat(dir, elapsed + interval);
      }
    }, interval);
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

    // Bet step keys (Shift+arrows, Shift+=/-, NumpadAdd/Subtract) — non-repeat only
    if (!e.repeat) {
      const dir = betDir(e);
      if (dir !== null && this.isBetAllowed()) {
        this.betHeldCode = e.code;
        this.host.stepBet(dir);
        // First repeat after 350ms initial delay
        this.clearBetTimer();
        const capturedDir = dir;
        this.betTimer = setTimeout(() => {
          this.betTimer = null;
          if (this.betHeldCode !== null && this.isBetAllowed()) {
            this.host.stepBet(capturedDir);
            this.startBetRepeat(capturedDir, 350);
          }
        }, 350);
        return;
      }
    }

    // Non-Space keys: give the open layer first refusal. If it consumes the key, done; Escape closes
    // it. Anything the layer does NOT consume falls through to the chrome hotkeys below — so the
    // Settings/Info pages still honour Shift+I (Game info), Shift+M (sound), Shift+S, etc.
    if (this.host.hasOpenLayer()) {
      const consumed = this.host.routeToLayer(e);
      if (consumed) return;
      if (e.code === 'Escape') { this.host.closeLayer(); return; }
      // not consumed → fall through to the Shift+letter chrome hotkeys
    }

    // Shift+letter bar hotkeys — fire when no layer is open, OR when an open layer left the key
    // unconsumed (see fall-through above); gated on hotkeys being enabled.
    if (!e.repeat && e.shiftKey && this.host.hotkeysEnabled) {
      const h = this.host;
      const s = h.state;
      switch (e.code) {
        case 'KeyA':
          if (h.autoplayEnabled && !s.replay) { h.toggleAutoplay(); return; }
          break;
        case 'KeyT':
          if (h.turboLevels > 0 && !s.replay) { h.cycleTurbo(); return; }
          break;
        case 'KeyB':
          // `bonusBuyLocked` is the same predicate the bar's coin uses. Without it this hotkey
          // reached past a disabled coin and opened the overlay mid-round.
          if (h.buyBonusEnabled && s.mode === 'base' && !s.replay && !bonusBuyLocked(s)) {
            h.openBuyBonus();
            return;
          }
          break;
        case 'KeyI':
          h.openInfo(); return;
        case 'KeyS':
          h.openMenu(); return;
        case 'KeyM':
          h.toggleMute(); return;
      }
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'Space') {
      this.spaceHeld = false;
      this.clearHoldTimer();
    }
    // Stop bet repeat on key release
    if (e.code === this.betHeldCode) {
      this.betHeldCode = null;
      this.clearBetTimer();
    }
  };

  private onBlur = (): void => {
    // Window blur — stop bet repeat AND hold-to-spin (same as releasing both keys)
    this.betHeldCode = null;
    this.clearBetTimer();
    this.spaceHeld = false;
    this.clearHoldTimer();
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
    // Use window if available for blur events
    if (typeof window !== 'undefined') {
      window.addEventListener('blur', this.onBlur);
    }
  }

  detach(): void {
    this.doc.removeEventListener('keydown', this.onKeyDown);
    this.doc.removeEventListener('keyup', this.onKeyUp);
    if (typeof window !== 'undefined') {
      window.removeEventListener('blur', this.onBlur);
    }
    this.spaceHeld = false;
    this.clearHoldTimer();
    this.betHeldCode = null;
    this.clearBetTimer();
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
