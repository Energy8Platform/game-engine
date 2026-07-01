import type { ShellRenderer, ShellHost, OverlayRequest, OverlayHandle } from '@/core/renderer';
import type { ShellTokens } from '@/core/theme';
import { SHELL_CSS, SHELL_ROOT_ID } from './shell.css';
import { buildThemeVars } from './theme-css';
import { countUp } from './motion-dom';
import { renderBottomBar } from './components/BottomBar';
import { openSettingsModal } from './components/Settings';
import { openGameInfoModal } from './components/GameInfo';
import { openBuyBonusOverlay } from './components/BuyBonus';
import { openBetModal, openAutoplayModal } from './components/pickers';
import { buildModal } from './components/Modal';
import { buildReplayModal } from './components/ReplayModal';

export interface HtmlRendererOptions {
  mount: HTMLElement;
}

const REMOVE_FADE_MS = 300;

/** Count-up the value span (.ge-rd-val) of a readout, leaving its label untouched.
 *  Returns the count-up canceler so the renderer can stop it before the node is replaced. */
function animateReadout(el: HTMLElement, from: number, to: number, fmt: (n: number) => string): () => void {
  const val = el.querySelector('.ge-rd-val') as HTMLElement | null;
  if (!val) { el.textContent = fmt(to); return () => {}; }
  return countUp(val, from, to, fmt);
}

export class HtmlRenderer implements ShellRenderer {
  private host!: ShellHost;
  private mountEl: HTMLElement;
  private root!: HTMLElement;
  private styleEl!: HTMLStyleElement;
  private barHost = document.createElement('div');
  private modalHost = document.createElement('div');
  private ro: ResizeObserver | null = null;
  private moneyAnims: Array<() => void> = [];
  private modalOnKey: ((e: KeyboardEvent) => boolean) | undefined;
  private destroyed = false;

  /** MutationObserver for buy-bonus confirm fit — fires fitModals() when nodes are added
   *  inside the modalHost (e.g. the confirm dialog appended after the grid is open). */
  private mutObs: MutationObserver | null = null;

  static readonly BAR_REF_WIDTH = 840;
  static readonly BAR_MIN_SCALE = 0.5;
  static readonly MODAL_FIT = 0.86;

  constructor(opts: HtmlRendererOptions) {
    this.mountEl = opts.mount;
  }

  mount(host: ShellHost): void {
    this.host = host;
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = SHELL_CSS;
    this.root = document.createElement('div');
    this.root.id = SHELL_ROOT_ID;
    this.mountEl.append(this.styleEl, this.root);
    this.barHost.className = 'ge-shell-barhost';
    this.modalHost.className = 'ge-shell-modalhost';
    this.root.append(this.barHost, this.modalHost);
    this.observeLayout();
    // Install a MutationObserver on modalHost (childList only, not attributes) so that when
    // a buy-bonus confirm dialog is appended inside an already-open overlay, fitModals() fires
    // and scales it correctly. Watching attributes would cause a transform→mutation loop.
    this.mutObs = new MutationObserver(() => { if (!this.destroyed) this.fitModals(); });
    this.mutObs.observe(this.modalHost, { childList: true, subtree: true });
    if (typeof document !== 'undefined' && document.fonts) {
      document.fonts.ready.then(() => { if (!this.destroyed) this.applyFitScale(); });
    }
  }

  applyTheme(tokens: ShellTokens): void {
    this.root.setAttribute('style', buildThemeVars(tokens));
  }

  renderBar(): void {
    if (this.destroyed) return;
    this.cancelMoneyAnims();
    this.root.classList.toggle('ge-mobile', this.host.layout === 'mobile');
    this.barHost.innerHTML = '';
    this.barHost.appendChild(renderBottomBar(this.host));
    this.applyFitScale();
  }

  setLayout(): void {
    this.renderBar();
  }

  animateMoney(field: 'balance' | 'win', from: number, to: number): void {
    const fmt = (n: number) => this.host.formatCurrency(n, field === 'win');
    const el = this.barHost.querySelector(`[data-ge="${field}"]`) as HTMLElement | null;
    if (el) this.moneyAnims.push(animateReadout(el, from, to, fmt));
  }

  openOverlay(req: OverlayRequest): OverlayHandle | void {
    const built = this.buildOverlay(req);
    if (!built) return;
    this.showModal(built.root, built.onKey);
    return { onKey: built.onKey, close: () => this.closeOverlay() };
  }

  closeOverlay(): void {
    this.modalOnKey = undefined;
    this.modalHost.innerHTML = '';
  }

  refreshSoundIcon?(_on: boolean): void {
    // Settings registers via host.setSoundRefresh; nothing extra here
  }

  destroy(): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    this.destroyed = true;
    this.ro?.disconnect();
    this.ro = null;
    this.mutObs?.disconnect();
    this.mutObs = null;
    this.cancelMoneyAnims();
    this.root.classList.add('ge-shell-hidden');
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        this.root.remove();
        this.styleEl.remove();
        resolve();
      }, REMOVE_FADE_MS);
    });
  }

  /** Trigger a bar fit-scale pass (used by tests that stub geometry after the initial render). */
  fitBar(): void { this.applyFitScale(); }

  // ── private ────────────────────────────────────────────────────────────────

  private cancelMoneyAnims(): void {
    for (const cancel of this.moneyAnims) cancel();
    this.moneyAnims = [];
  }

  private buildOverlay(req: OverlayRequest): { root: HTMLElement; onKey?: (e: KeyboardEvent) => boolean } | null {
    switch (req.kind) {
      case 'settings': {
        const root = openSettingsModal(this.host);
        return { root };
      }
      case 'gameInfo': {
        const { root, onKey } = openGameInfoModal(this.host);
        return { root, onKey };
      }
      case 'buyBonus': {
        const result = openBuyBonusOverlay(this.host);
        if (!result) return null;
        return { root: result.root, onKey: result.onKey };
      }
      case 'betPicker': {
        const { root, onKey } = openBetModal(this.host);
        return { root, onKey };
      }
      case 'autoplayPicker': {
        const { root, onKey } = openAutoplayModal(this.host);
        return { root, onKey };
      }
      case 'replay': {
        const opts = req.opts;
        const reopen = (): void => { this.openReplayInternal(opts); };
        const root = buildReplayModal(this.host, opts, reopen);
        return { root };
      }
      case 'modal': {
        const root = buildModal(this.host, req.opts);
        return { root, onKey: req.opts.onKey };
      }
    }
  }

  /** Opens a replay modal and shows it — used as the reopen callback after START REPLAY. */
  private openReplayInternal(opts: import('@/core/types').ReplayModalOptions): void {
    if (this.destroyed) return;
    const reopen = (): void => { this.openReplayInternal(opts); };
    const root = buildReplayModal(this.host, opts, reopen);
    this.showModal(root);
  }

  private showModal(el: HTMLElement, onKey?: (e: KeyboardEvent) => boolean): void {
    // Drop focus from any open shell control so a stray Space/Enter doesn't re-activate it
    const active = document.activeElement as HTMLElement | null;
    if (active && this.root.contains(active)) active.blur();
    this.modalHost.innerHTML = '';
    this.modalHost.appendChild(el);
    this.modalOnKey = onKey;
    this.fitModals();
  }

  /** Uniformly scale every open centred card modal (.ge-sheet) down so it fits a short/narrow
   *  popout. Covers pickers, generic + replay modals, AND the buy-bonus confirm (which is hosted
   *  inside the overlay, not directly in modalHost). */
  fitModals(): void {
    if (this.destroyed) return;
    this.modalHost.querySelectorAll('.ge-sheet').forEach((el) => this.fitSheet(el as HTMLElement));
  }

  private fitSheet(root: HTMLElement): void {
    const card = root.querySelector('.ge-modal-card') as HTMLElement | null;
    if (!card) return;
    card.style.transform = '';
    const availW = root.clientWidth, availH = root.clientHeight;
    const w = card.offsetWidth, h = card.offsetHeight;
    if (w <= 0 || h <= 0 || availW <= 0 || availH <= 0) return;
    const fit = HtmlRenderer.MODAL_FIT;
    const s = Math.min(1, (availW * fit) / w, (availH * fit) / h);
    if (s < 0.999) card.style.transform = `scale(${s.toFixed(4)})`;
  }

  private applyFitScale(): void {
    if (this.destroyed) return;
    const host = this.barHost;
    const bar = host.querySelector('.ge-shell-bottom') as HTMLElement | null;
    if (!bar) return;
    // reset to baseline (idempotent)
    host.classList.remove('ge-fit');
    host.style.transform = '';
    host.style.transformOrigin = '';
    // clear any zoom from a prior pass. We zoom the whole dark PANEL (so the bar surface shrinks with
    // its content on a narrow popout), plus BUY BONUS + a lifted WIN pill, which live outside it.
    for (const el of host.querySelectorAll('.ge-bar-panel, .ge-shell-buybonus')) {
      (el as HTMLElement).style.transform = '';
      (el as HTMLElement).style.transformOrigin = '';
      (el as HTMLElement).style.removeProperty('zoom');
    }
    if (this.host.layout === 'mobile') {
      // First shrink long numbers per-readout (info pill balance/win, the total-win slot) so the
      // buttons row stays full-size; then, only if a row STILL overflows (tiny phones), scale the
      // whole stack as a last resort.
      this.fitReadouts();
      let need = 0;
      for (const row of Array.from(bar.children) as HTMLElement[]) need = Math.max(need, row.scrollWidth);
      const avail = bar.clientWidth;
      if (need > avail + 1 && avail > 0) {
        host.style.transformOrigin = 'bottom left';
        host.style.transform = `scale(${Math.max(0.4, avail / need).toFixed(4)})`;
      }
      return;
    }
    const zoomBar = (z: number): void => {
      const v = z < 0.999 ? z.toFixed(4) : '';
      const set = (el: Element | null): void => {
        if (!el) return;
        if (v) (el as HTMLElement).style.setProperty('zoom', v);
        else (el as HTMLElement).style.removeProperty('zoom');
      };
      // zoom the whole panel (surface + content, incl. the inline WIN pill, shrink together);
      // BUY BONUS sits outside the panel, so zoom it too.
      set(host.querySelector('.ge-bar-panel'));
      set(bar.querySelector('.ge-shell-buybonus'));
    };
    const s = Math.max(HtmlRenderer.BAR_MIN_SCALE, Math.min(1, this.root.clientWidth / HtmlRenderer.BAR_REF_WIDTH));
    zoomBar(s);
    if (bar.scrollWidth > bar.clientWidth + 1 && bar.scrollWidth > 0) {
      zoomBar(s * (bar.clientWidth / bar.scrollWidth));
    }
    this.fitReadouts();
  }

  /** Unified number-fit: shrink EVERY readout's value span (`.ge-rd-val`) with a transform-scale so
   *  it fits its readout box — the single rule for all money displays (BET, balance, win, total win),
   *  so a large number never grows the layout. It only ever kicks in on a BOUNDED box (a fixed width,
   *  a flex slot, or a shrinkable `min-width:0` slot); a content-sized readout has box == value, so
   *  the pass is a no-op there. The value span is inline-block, so its true width is measurable even
   *  inside an `overflow:hidden` slot; the label is left untouched. */
  private fitReadouts(): void {
    for (const rd of Array.from(this.barHost.querySelectorAll('.ge-rd')) as HTMLElement[]) {
      const val = rd.querySelector(':scope > .ge-rd-val') as HTMLElement | null;
      if (!val) continue;
      val.style.transform = '';                          // measure at full size
      const avail = rd.clientWidth, need = val.scrollWidth;
      if (need > avail + 0.5 && need > 0) val.style.transform = `scale(${(avail / need).toFixed(3)})`;
    }
  }

  private observeLayout(): void {
    const RO = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (typeof RO !== 'function') return;
    this.ro = new RO((entries) => {
      const rect = entries[0]?.contentRect;
      const w = rect?.width ?? 0, h = rect?.height ?? 0;
      this.host.notifyResize(w, h);
      this.applyFitScale();
      this.fitModals();
    });
    this.ro.observe(this.root);
  }
}
