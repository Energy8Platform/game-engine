import { EventEmitter } from '../EventEmitter';
import type {
  AutoplayOptions,
  BonusOption,
  FreeSpinsState,
  ModalOptions,
  ReplayModalOptions,
  ShellConfig,
  ShellEvents,
  ShellMode,
  ShellState,
  ThemeConfig,
} from './types';
import { createInitialState } from './state';
import { buildThemeVars } from './theme';
import { SHELL_CSS, SHELL_ROOT_ID } from './shell.css';
import { renderBottomBar } from './components/BottomBar';
import { openSettingsModal } from './components/Settings';
import { openGameInfoModal } from './components/GameInfo';
import { openBuyBonusOverlay } from './components/BuyBonus';
import { openBetModal, openAutoplayModal } from './components/pickers';
import { buildModal } from './components/Modal';
import { buildReplayModal } from './components/ReplayModal';
import { countUp } from './motion';
import { formatCurrency } from './format';
import { socialize } from './i18n';

const REMOVE_FADE_MS = 300;

export class GameShell extends EventEmitter<ShellEvents> {
  readonly config: ShellConfig;
  state: ShellState;
  private root: HTMLElement;
  private styleEl: HTMLStyleElement;
  private barHost = document.createElement('div');
  private modalHost = document.createElement('div');
  private destroyed = false;
  layout: 'wide' | 'mobile' = 'wide';
  private ro: ResizeObserver | null = null;
  private prevBalance = 0;
  private prevWin = 0;
  private moneyAnims: Array<() => void> = [];
  private keysBound = false;

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
    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', this.handleKeyDown);
      // Stake serves the game in an iframe; on first paint focus is on the HOST page, so a `document`
      // keydown never fires and Space scrolls the parent. Pull window focus into the iframe on the
      // first pointer interaction so the spacebar shortcut works. Harmless on full-page Energy8.
      document.addEventListener('pointerdown', this.pullFocus, true);
      this.keysBound = true;
    }
    this.render();
    // re-fit once the bundled webfont swaps in (text metrics change → row width changes)
    if (typeof document !== 'undefined' && document.fonts) {
      document.fonts.ready.then(() => { if (!this.destroyed) this.applyFitScale(); });
    }
  }

  render(): void {
    if (this.destroyed) return;
    this.cancelMoneyAnims(); // stop in-flight count-ups before their nodes are torn down below
    this.root.classList.toggle('ge-mobile', this.layout === 'mobile');
    this.barHost.innerHTML = '';
    this.barHost.appendChild(renderBottomBar(this));
    this.animateMoney();
    this.applyFitScale();
  }

  private cancelMoneyAnims(): void {
    for (const cancel of this.moneyAnims) cancel();
    this.moneyAnims = [];
  }

  /** Keep the WIN pill inline between the groups; float it above when it won't fit. */
  /**
   * Landscape bar fills the width when it fits. When it overflows, the WIN pill is
   * lifted above the bar (unscaled, so it stays readable) and the remaining row is
   * centred and scaled down to fit — keeping the controls as large as possible.
   */
  private applyFitScale(): void {
    if (this.destroyed) return;
    const host = this.barHost;
    const bar = host.querySelector('.ge-shell-bottom') as HTMLElement | null;
    if (!bar) return;
    // reset to baseline (idempotent — the pill may have been lifted on a prior pass)
    const pill = host.querySelector('.ge-winpill') as HTMLElement | null;
    if (pill && pill.parentElement === host) {                // put a lifted pill back inline
      const right = bar.querySelector('.ge-zone-right');
      if (right) bar.insertBefore(pill, right); else bar.appendChild(pill);
      pill.classList.remove('ge-up');
    }
    host.classList.remove('ge-fit');
    host.style.transform = '';
    host.style.transformOrigin = '';
    // clear any per-zone height-scale from a prior pass
    for (const el of host.querySelectorAll('.ge-zone, .ge-winpill')) {
      (el as HTMLElement).style.transform = '';
      (el as HTMLElement).style.transformOrigin = '';
    }
    if (this.layout === 'mobile') {
      // Shrink the whole stack to fit narrow phones (mobile-s, or big balance/win/total-win
      // numbers in a row). The rows use space-between, so on overflow their content is
      // left-anchored and spills off the RIGHT edge — scale from the bottom-left corner so
      // `avail/need` fits it exactly. (The old centre-origin + 0.7 floor left large numbers
      // running past the screen edge; the 0.4 floor only guards a degenerate near-zero bar.)
      let need = 0;
      for (const row of Array.from(bar.children) as HTMLElement[]) need = Math.max(need, row.scrollWidth);
      const avail = bar.clientWidth;
      if (need > avail + 1 && avail > 0) {
        host.style.transformOrigin = 'bottom left';
        host.style.transform = `scale(${Math.max(0.4, avail / need).toFixed(4)})`;
      }
      return;
    }
    // Lift the WIN pill onto its own line above the bar if it would otherwise widen the control row
    // past the frame (a wide WIN amount would push the right zone off-screen). The bar row is then
    // just [left]…[right].
    if (pill && bar.scrollWidth > bar.clientWidth + 1) { host.insertBefore(pill, bar); pill.classList.add('ge-up'); }
    // If the control row STILL overflows the frame width, the content genuinely doesn't fit — a
    // visual (transform) scale wouldn't help (the layout still overflows, shoving the right zone off
    // screen). Shrink-to-CONTENT (`.ge-fit` → width:max-content) and scale the whole stack, centred.
    // Base's wide row (menu+buy+balance + bet+spin+turbo) hits this; its content fills the width so
    // it still reads as a full bar. Narrow rows (replay / free-spins) fit and fall through to the
    // per-zone screen-scale below.
    if (bar.scrollWidth > bar.clientWidth + 1) {
      host.classList.add('ge-fit');
      const cw = host.offsetWidth;
      const sb = cw > 0 ? Math.min(1, (this.root.clientWidth - 12) / cw) : 1;
      if (sb < 0.999) host.style.transform = `translateX(-50%) scale(${sb.toFixed(4)})`;
      else host.classList.remove('ge-fit');
      return;
    }
    // Scale the bar by the SCREEN SIZE — the SAME factor in every mode (base / replay / free-spins).
    // The factor is the frame WIDTH vs the bar's design width, NOT the current mode's content width,
    // so replay's narrow row shrinks by the same amount as base's wide row instead of staying
    // full-size on a popout. Applied per-zone (each toward its outer-bottom corner) so the bar keeps
    // its full-width space-between layout — menu hard-left, controls hard-right — never a centred
    // cluster. (Mobile, above, keeps its own stacked fit.)
    const s = Math.max(GameShell.BAR_MIN_SCALE, Math.min(1, this.root.clientWidth / GameShell.BAR_REF_WIDTH));
    const t = s < 0.999 ? `scale(${s.toFixed(4)})` : '';
    const scaleEdge = (el: Element | null, origin: string): void => {
      if (!el) return;
      (el as HTMLElement).style.transformOrigin = origin;
      (el as HTMLElement).style.transform = t;
    };
    scaleEdge(bar.querySelector('.ge-zone-left'), 'left bottom');
    scaleEdge(bar.querySelector('.ge-zone-right'), 'right bottom');
    scaleEdge(host.querySelector('.ge-winpill'), 'center bottom'); // inline (in bar) or lifted (in host)
  }

  /** Spacebar starts a spin — same path as the spin disc. Ignored when `features.spacebar` is
   *  false, while a spin is running, while autoplay is active, outside base mode, when an
   *  overlay/modal is open, or when an editable element is focused. `repeat` (held key) is
   *  ignored so it can't spam. */
  /** Pull window focus into the iframe on first pointer interaction so `document` keydown (the
   *  spacebar shortcut) fires. No-op / harmless when already focused or full-page. */
  private pullFocus = (): void => { try { window.focus(); } catch { /* cross-origin / non-browser */ } };

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (this.destroyed || e.code !== 'Space' || e.repeat) return;
    if (this.config.features.spacebar === false) return; // shortcut disabled (e.g. jurisdiction)
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    // Space is ours now — swallow the browser default before any no-op bail. Otherwise the
    // native "Space activates the focused button" still fires and re-clicks whichever shell
    // <button> (menu/buy/auto) opened the overlay, tearing down + rebuilding the modal: a
    // visible flicker. (Also stops the page from scrolling on Space.)
    e.preventDefault();
    if (this.modalHost.childElementCount > 0) return; // an overlay/modal is open
    if (this.state.mode !== 'base' || this.state.busy || this.state.autoplay.active) return;
    this.emit('spin');
  };

  setLayout(layout: 'wide' | 'mobile'): void {
    if (layout === this.layout) return;
    this.layout = layout;
    this.render();
  }

  /** Resolve a built-in shell string. English is the source; with `isSocial` it is run through
   *  the social-casino word-swap. Game-supplied strings should NOT be passed through this. */
  t(text: string): string { return this.config.isSocial ? socialize(text) : text; }

  /** Toggle the social vocabulary at runtime (re-renders the bar; reopen overlays to refresh them). */
  setSocial(isSocial: boolean): void { this.config.isSocial = isSocial; this.render(); }

  /** Recolour the shell at runtime (e.g. switch dark/light scheme). */
  setTheme(theme: ThemeConfig): void {
    this.config.theme = theme;
    this.root.setAttribute('style', buildThemeVars(theme));
  }

  private observeLayout(): void {
    const RO = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (typeof RO !== 'function') return; // jsdom: stays 'wide'
    this.ro = new RO((entries) => {
      const rect = entries[0]?.contentRect;
      const w = rect?.width ?? 0, h = rect?.height ?? 0;
      // portrait → stacked mobile; landscape (incl. popouts) → one row, scaled to fit if it overflows
      this.setLayout(w !== 0 && h > w ? 'mobile' : 'wide');
      this.applyFitScale();
      this.fitModals(); // re-scale open card modals when the popout resizes
    });
    this.ro.observe(this.root);
  }

  private animateMoney(): void {
    const fmt = (n: number) => formatCurrency(n, this.config.currency);
    const fmtWin = (n: number) => formatCurrency(n, this.config.currency, true); // win: variable decimals
    const bal = this.barHost.querySelector('[data-ge="balance"]') as HTMLElement | null;
    const win = this.barHost.querySelector('[data-ge="win"]') as HTMLElement | null;
    if (bal && this.state.balance !== this.prevBalance) this.moneyAnims.push(animateReadout(bal, this.prevBalance, this.state.balance, fmt));
    if (win && this.state.win !== this.prevWin) this.moneyAnims.push(animateReadout(win, this.prevWin, this.state.win, fmtWin));
    this.prevBalance = this.state.balance;
    this.prevWin = this.state.win;
  }

  setBalance(n: number): void { this.state.balance = n; this.render(); }
  setWin(n: number): void { this.state.win = n; this.render(); }
  setBet(n: number): void { this.state.bet = n; this.render(); }
  setMode(mode: ShellMode): void {
    if (mode === 'replay') this.state.replay = true; // sticky: a replay stays a replay across modes
    this.state.mode = mode;
    this.render();
  }
  setBusy(busy: boolean): void { this.state.busy = busy; this.render(); }
  setAutoplay(a: AutoplayOptions): void { this.state.autoplay = a; this.render(); }
  setTurbo(level: number): void { this.state.turbo = level; this.render(); }
  /** Currency-aware money formatter for WIN amounts (variable decimals: 0.0041 stays 0.0041, not
   *  0.00). The host hands this to a scene so games format money without knowing the currency. */
  formatWin(value: number): string { return formatCurrency(value, this.config.currency, true); }
  setBuyBonusEnabled(enabled: boolean): void { this.state.buyBonusEnabled = enabled; this.render(); }
  setFreeSpins(fs: FreeSpinsState): void { this.state.freeSpins = fs; this.render(); }

  private showModal(el: HTMLElement): void {
    // The control that opened this overlay (menu/buy/auto) keeps DOM focus. Drop it, or a
    // stray Space/Enter would natively re-activate that <button> and rebuild the modal — a
    // visible flicker. Only relinquish focus we own (a shell control), never the host page's.
    const active = document.activeElement as HTMLElement | null;
    if (active && this.root.contains(active)) active.blur();
    this.modalHost.innerHTML = '';
    this.modalHost.appendChild(el);
    this.fitModals();
  }

  /** Uniformly scale every open centred card modal (`.ge-sheet`) down so it fits a short/narrow
   *  popout — the same idea as the bar's fit-scale. Covers the pickers, generic + replay modals,
   *  AND the buy-bonus confirm (which is hosted inside the overlay, not directly in modalHost).
   *  Full-screen overlays handle their own responsiveness (scroll + vh-clamp). */
  fitModals(): void {
    if (this.destroyed) return;
    this.modalHost.querySelectorAll('.ge-sheet').forEach((el) => this.fitSheet(el as HTMLElement));
  }

  /** Fraction of the frame a card modal may occupy; the rest is breathing-room margin. Keeps
   *  modals from filling a small popout edge-to-edge (so even short pickers scale down there). */
  private static readonly MODAL_FIT = 0.86;

  /** The bar's design width (px). When the frame is narrower, the bar fit-scales DOWN with the
   *  screen — the SAME factor in every mode, so replay/free-spins shrink like base instead of
   *  staying full-size on a popout. */
  private static readonly BAR_REF_WIDTH = 840;
  /** Lower bound on the bar fit-scale (guards a degenerate near-zero frame). */
  private static readonly BAR_MIN_SCALE = 0.4;

  private fitSheet(root: HTMLElement): void {
    const card = root.querySelector('.ge-modal-card') as HTMLElement | null;
    if (!card) return;
    card.style.transform = ''; // reset before measuring the natural size
    const availW = root.clientWidth, availH = root.clientHeight;
    const w = card.offsetWidth, h = card.offsetHeight;
    if (w <= 0 || h <= 0 || availW <= 0 || availH <= 0) return;
    const fit = GameShell.MODAL_FIT;
    const s = Math.min(1, (availW * fit) / w, (availH * fit) / h);
    if (s < 0.999) card.style.transform = `scale(${s.toFixed(4)})`;
  }

  /** Activate a `feature` option (e.g. Ante): the bar shows the effective bet, tinted with
   *  the feature accent, and BUY BONUS becomes DISABLE. */
  activateFeature(bonus: BonusOption): void {
    this.state.activeFeature = bonus;
    this.emit('featureActivate', { id: bonus.id });
    this.render();
  }

  /** Clear the active feature — reverts the bet readout and the BUY BONUS button. */
  deactivateFeature(): void {
    const prev = this.state.activeFeature;
    if (!prev) return;
    this.state.activeFeature = null;
    this.emit('featureDeactivate', { id: prev.id });
    this.render();
  }

  openMenu(): void { this.emit('menuOpen'); this.openSettings(); }
  openSettings(): void { this.emit('settingsOpen'); this.showModal(openSettingsModal(this)); }
  openInfo(): void { this.emit('infoOpen'); this.showModal(openGameInfoModal(this)); }
  openBuyBonus(): void {
    if (this.config.onBonusBuy) { this.config.onBonusBuy(); return; } // game handles it (own UI)
    const overlay = openBuyBonusOverlay(this);
    if (overlay) this.showModal(overlay);
  }
  /** Open a generic, externally-driven modal (title + body + optional action buttons).
   *  Each action runs its `on` then closes; the ✕ shows when `availableClose` is true. */
  openModal(opts: ModalOptions): void { this.showModal(buildModal(opts)); }
  /** Programmatically dismiss whatever modal/overlay is currently shown (e.g. auto-close the
   *  reconnect overlay once the link is restored). No-op when nothing is open. */
  closeModal(): void { this.modalHost.innerHTML = ''; }
  /** Open the non-dismissable replay summary modal (START REPLAY → onReplay → reopen). */
  openReplay(opts: ReplayModalOptions): void {
    if (this.destroyed) return;
    this.showModal(buildReplayModal(this, opts));
  }

  /** Bet picker — list of available bets with an accent Confirm. */
  openBetPicker(): void { this.showModal(openBetModal(this)); }
  /** Autoplay picker — spin-count list; Confirm starts autoplay. */
  openAutoplayPicker(): void { this.showModal(openAutoplayModal(this)); }

  destroy(): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    this.destroyed = true;
    this.ro?.disconnect();
    this.ro = null;
    if (this.keysBound) {
      document.removeEventListener('keydown', this.handleKeyDown);
      document.removeEventListener('pointerdown', this.pullFocus, true);
      this.keysBound = false;
    }
    this.cancelMoneyAnims();
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

/** Count-up the trailing text node of a .ge-rd readout (keeps its label span).
 *  Returns the count-up canceler so the shell can stop it before the node is replaced. */
function animateReadout(el: HTMLElement, from: number, to: number, fmt: (n: number) => string): () => void {
  const textNode = el.lastChild;
  if (!textNode || textNode.nodeType !== Node.TEXT_NODE) { el.textContent = fmt(to); return () => {}; }
  const proxy = {
    set textContent(v: string) { (textNode as Text).data = v; },
    get textContent() { return (textNode as Text).data; },
  } as unknown as HTMLElement;
  return countUp(proxy, from, to, fmt);
}
