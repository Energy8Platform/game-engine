import { icon } from './icons';

/** Render a (possibly socialised) two-word label across two lines — the BUY BONUS badge.
 *  Shared so the bottom-bar button and the Game-info control legend break identically. */
export function twoLine(label: string): string {
  return label.split(/\s+/).join('<br>');
}

export interface CardModalOpts {
  ge: string;
  title: string;
  /** Accent for the title heading + accent footer button (defaults to the shell accent). */
  accent?: string;
  onClose: () => void;
  /** Render the ✕ in the overlay's top-right corner (default true). */
  closable?: boolean;
  /** Backdrop blur in px; omit to use the stylesheet's default blur. */
  blur?: number;
}

/** A centred CARD modal — frosted backdrop + opaque card with an accent title heading and an
 *  overlay ✕ in the top-right. The shared chrome for every centred modal (buy-bonus confirm,
 *  bet, autoplay, generic openModal). Append content to `body`; append full-bleed footer
 *  button(s) directly to `card`. Closes only via the ✕ / footer buttons — the backdrop does NOT. */
export function createCardModal(
  opts: CardModalOpts,
): { root: HTMLDivElement; card: HTMLDivElement; body: HTMLDivElement } {
  const root = document.createElement('div');
  root.className = 'ge-sheet'; root.dataset.ge = opts.ge;
  if (opts.blur != null) root.style.setProperty('--ge-sheet-blur', `${opts.blur}px`);
  const card = document.createElement('div'); card.className = 'ge-modal-card';
  if (opts.accent) card.style.setProperty('--card-acc', opts.accent);
  const body = document.createElement('div'); body.className = 'ge-modal-body';
  const h = document.createElement('h4'); h.className = 'ge-modal-title'; h.textContent = opts.title;
  body.appendChild(h);
  card.appendChild(body);
  root.appendChild(card);
  // ✕ lives on the overlay itself (top-right of the screen), not on the card
  if (opts.closable !== false) {
    const close = document.createElement('button');
    close.className = 'ge-modal-close'; close.dataset.ge = 'modal-close';
    close.setAttribute('aria-label', 'Close'); close.innerHTML = icon('close');
    close.addEventListener('click', opts.onClose);
    root.appendChild(close);
  }
  return { root, card, body };
}

export interface OverlayOpts {
  title: string;
  onClose: () => void;
  onBack?: () => void;
}

/** Full-screen overlay. Returns { root, body }; append content to body. */
export function createOverlay(opts: OverlayOpts): { root: HTMLDivElement; body: HTMLDivElement } {
  const root = document.createElement('div');
  root.className = 'ge-shell-overlay';
  const head = document.createElement('div');
  head.className = 'ge-ov-head';
  if (opts.onBack) {
    const back = document.createElement('button');
    back.className = 'ge-ov-nav'; back.dataset.ge = 'info-back'; back.innerHTML = icon('back');
    back.addEventListener('click', opts.onBack);
    head.appendChild(back);
  } else {
    // reserve a slot equal to the close button so the title stays centred
    const spacer = document.createElement('div');
    spacer.className = 'ge-ov-spacer';
    head.appendChild(spacer);
  }
  const h = document.createElement('h4'); h.className = 'ge-ov-title'; h.textContent = opts.title; head.appendChild(h);
  const close = document.createElement('button');
  close.className = 'ge-ov-nav'; close.setAttribute('aria-label', 'Close'); close.innerHTML = icon('close');
  close.addEventListener('click', opts.onClose);
  head.appendChild(close);
  // Header stays fixed; only this wrapper scrolls — the X never scrolls away,
  // and vh-clamped padding keeps it usable on small popouts (e.g. 400×225).
  const scroll = document.createElement('div'); scroll.className = 'ge-ov-scroll';
  const body = document.createElement('div'); body.className = 'ge-ov-body';
  scroll.appendChild(body);
  root.append(head, scroll);
  return { root, body };
}
