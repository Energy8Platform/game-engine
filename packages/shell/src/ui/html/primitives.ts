import { icon } from './icons';
import { placePopover, popoverWidth, POPOVER, type Rect } from '@/core/popover';

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

/** Full-screen overlay. Returns { root, body, scroll }; append content to body.
 *  The `scroll` element is the scrollable container (overflow-y: auto). */
export function createOverlay(opts: OverlayOpts): { root: HTMLDivElement; body: HTMLDivElement; scroll: HTMLDivElement } {
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
  return { root, body, scroll };
}

export interface PopoverOpts {
  ge: string;
  /** The shell root — the popover is placed in its coordinate space and clamped to it. */
  surface: HTMLElement;
  /** The control the card points at; `null` centres the card and hides the arrow. A function is
   *  re-resolved on EVERY `position()` call rather than captured once — a renderer that rebuilds
   *  its DOM on resize/re-render (e.g. HtmlRenderer's `renderBar()`) replaces the anchor element,
   *  so a captured reference would go stale and silently fall back to a centred card. Pass a
   *  resolver whenever the anchor can be rebuilt out from under the popover. */
  anchor: HTMLElement | null | (() => HTMLElement | null);
  onClose: () => void;
}

/** A light-dismiss popover: a transparent full-surface layer (closes on pointerdown) holding a
 *  card with an arrow that points at `anchor`. Append rows to `body`; call `position()` after the
 *  card is in the DOM and again on resize. */
export function createPopover(opts: PopoverOpts): {
  root: HTMLDivElement;
  card: HTMLDivElement;
  body: HTMLDivElement;
  position(): void;
} {
  const root = document.createElement('div');
  root.className = 'ge-pop-layer';
  root.dataset.ge = opts.ge;
  const card = document.createElement('div');
  card.className = 'ge-pop';
  card.dataset.ge = 'menu-card';
  const body = document.createElement('div');
  body.className = 'ge-pop-body';
  const arrow = document.createElement('span');
  arrow.className = 'ge-pop-arrow';
  card.append(body, arrow);
  root.appendChild(card);
  // Clicks inside the card must not reach the dismiss layer.
  card.addEventListener('pointerdown', (e) => e.stopPropagation());
  root.addEventListener('pointerdown', opts.onClose);

  const position = (): void => {
    const surfaceRect = opts.surface.getBoundingClientRect();
    const surface = { w: surfaceRect.width || opts.surface.clientWidth, h: surfaceRect.height || opts.surface.clientHeight };
    if (surface.w <= 0 || surface.h <= 0) return;
    // Clear a prior run's constrained width before measuring — otherwise scrollWidth reports the
    // already-clamped box (not the natural content width) on every call after the first, and the
    // card can shrink to fit a narrower surface but never grow back when the surface widens again.
    card.style.width = '';
    const w = popoverWidth(surface.w, card.scrollWidth || POPOVER.minW);
    card.style.width = `${w}px`;
    let anchor: Rect | null = null;
    // Resolve fresh every call — see the PopoverOpts.anchor doc comment.
    const anchorEl = typeof opts.anchor === 'function' ? opts.anchor() : opts.anchor;
    if (anchorEl) {
      const a = anchorEl.getBoundingClientRect();
      if (a.width > 0 || a.height > 0) {
        anchor = { x: a.left - surfaceRect.left, y: a.top - surfaceRect.top, w: a.width, h: a.height };
      }
    }
    const p = placePopover(anchor, surface, { w, h: card.offsetHeight || POPOVER.minH });
    card.style.left = `${p.x}px`;
    card.style.top = `${p.y}px`;
    card.style.maxHeight = `${p.maxH}px`;
    card.classList.toggle('ge-pop-below', p.below);
    if (p.arrowX < 0) arrow.style.display = 'none';
    else {
      arrow.style.display = '';
      arrow.style.left = `${p.arrowX}px`;
    }
  };
  return { root, card, body, position };
}
