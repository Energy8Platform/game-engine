import { icon } from './icons';
import { placePopover, popoverWidth, POPOVER, type Rect } from '@/core/popover';
import { attachScrollAffordance, type ScrollAffordance } from './scroll-affordance';

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

/** Full-screen overlay. Returns { root, body, scroll, affordance }; append content to body.
 *  The `scroll` element is the scrollable container (overflow-y: auto); `affordance` marks it as
 *  scrollable once it overflows — call `affordance.sync()` after filling or resizing the body. */
export function createOverlay(opts: OverlayOpts): {
  root: HTMLDivElement; body: HTMLDivElement; scroll: HTMLDivElement; affordance: ScrollAffordance;
} {
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
  // The cue is hosted on `root`, not on `scroll`: `scroll` is the element that moves.
  const affordance = attachScrollAffordance(scroll, { cueHost: root });
  return { root, body, scroll, affordance };
}

export interface PopoverOpts {
  ge: string;
  /** The shell root — the popover is placed in its coordinate space and clamped to it. */
  surface: HTMLElement;
  /** The plate: the bar's own plaque (`.ge-bar-panel` wide / `.ge-m-controls` mobile). Drives the
   *  card's x, y, maxH and above/below flip, so the card sits flush with the WHOLE bar rather than
   *  with whichever control opened it. Falls back to `pointer` when it can't be resolved (no plaque
   *  found), and to a centred, arrow-less card when neither resolves. A function is re-resolved on
   *  EVERY `position()` call rather than captured once — a renderer that rebuilds its DOM on
   *  resize/re-render (e.g. HtmlRenderer's `renderBar()`) replaces the element, so a captured
   *  reference would go stale and silently fall back to a centred card. Pass a resolver whenever the
   *  element can be rebuilt out from under the popover. */
  plate: HTMLElement | null | (() => HTMLElement | null);
  /** The control the arrow points at (the burger button). Defaults to `plate` when omitted — the
   *  historical single-rect behaviour, kept so every caller that only ever had one rect (i.e. every
   *  caller before `plate`/`pointer` were split) keeps behaving exactly as it did before. Same
   *  re-resolve-per-call rule as `plate`. */
  pointer?: HTMLElement | null | (() => HTMLElement | null);
  /** An element that visually pops out ABOVE the plate's own box — e.g. the mobile SPIN/FS hero,
   *  taller than the `.ge-m-controls` row and vertically centred, so it overflows the row's own top
   *  edge. When present (and its measured top is above the plate's), the plate rect's TOP edge is
   *  extended upward to match it — bottom edge untouched — so `placePopover` sees the row's true
   *  visual extent on the side that matters, instead of a card whose bottom (only `gap` above the
   *  plate's own top) can clip the popped-out control's arc. Omit/return null when nothing pops out
   *  (e.g. the wide layout, whose plate already contains its content) — a no-op. Same
   *  re-resolve-per-call rule as `plate`/`pointer`. */
  plateOverflowTop?: HTMLElement | null | (() => HTMLElement | null);
  /** The scale factor the bar currently applies to itself (HtmlRenderer.applyFitScale's `s`). The
   *  card matches it so its typography/padding/row-heights scale in lockstep with the bar chrome.
   *  Defaults to 1 (no scaling) when omitted. */
  scale?: () => number;
  onClose: () => void;
}

/** A light-dismiss popover: a transparent full-surface layer (closes on pointerdown) holding a
 *  card with an arrow that points at `pointer`. Append rows to `body`; call `position()` after the
 *  card is in the DOM and again on resize. */
export function createPopover(opts: PopoverOpts): {
  root: HTMLDivElement;
  card: HTMLDivElement;
  body: HTMLDivElement;
  affordance: ScrollAffordance;
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
  // The card clamps itself to `maxHeight` in position(), so the body's overflow is only knowable
  // after that runs — hence the sync at the end of position().
  const affordance = attachScrollAffordance(body, { cueHost: card });

  const resolveEl = (v: HTMLElement | null | (() => HTMLElement | null) | undefined): HTMLElement | null =>
    typeof v === 'function' ? v() : (v ?? null);

  /** A rect in surface coordinates, or null when unresolved/fully zero-sized (a zero-HEIGHT rect —
   *  e.g. a not-yet-laid-out anchor — is still considered valid, matching placePopover's own rule). */
  const rectOf = (el: HTMLElement | null, surfaceRect: DOMRect): Rect | null => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 && r.height <= 0) return null;
    return { x: r.left - surfaceRect.left, y: r.top - surfaceRect.top, w: r.width, h: r.height };
  };

  const position = (): void => {
    const surfaceRect = opts.surface.getBoundingClientRect();
    const surface = { w: surfaceRect.width || opts.surface.clientWidth, h: surfaceRect.height || opts.surface.clientHeight };
    if (surface.w <= 0 || surface.h <= 0) return;
    const s = opts.scale?.() ?? 1;

    // 1. Clear a prior run's constraints (transform + width + max-height + left) before measuring —
    // otherwise scrollWidth/offsetHeight report the already-scaled/clamped box (not the natural
    // content size) on every call after the first, and the card can shrink to fit a
    // narrower/shorter surface but never grow back when the surface widens/grows again. An uncleared
    // max-height is the worse of the two: placePopover positions a card sized for the STALE clamped
    // height, then the un-clamped natural height (restored below) springs back afterward — so the
    // rendered card can overlap the plate or run off the surface edge until reopened. The transform
    // doesn't affect layout either way, but clearing it keeps every pass measuring the same way.
    // `left` matters too: `.ge-pop` is absolutely positioned inside an `inset:0` layer, so with the
    // previous pass's `left` still applied, its shrink-to-fit width is bounded by (layerWidth − left)
    // instead of the card's true natural width. Invisible at scale 1; a scale below 1 lays the card
    // out at up to 1/s its on-screen width, so a stale left — only ever a few hundred px — can clip it.
    card.style.transform = '';
    card.style.width = '';
    card.style.maxHeight = '';
    card.style.left = '0px';
    const naturalW = card.scrollWidth || POPOVER.minW;

    // 2. Resolve the ON-SCREEN width from the natural (unscaled) width scaled up to screen units,
    // then set the LOCAL style.width so the card renders at that resolved width once scaled — and
    // re-measure the height at that width (wrapping may have changed it).
    const resolvedW = popoverWidth(surface.w, naturalW * s);
    card.style.width = `${resolvedW / s}px`;
    const naturalH = card.offsetHeight || POPOVER.minH;

    // 3. Resolve plate/pointer in surface coordinates and place using SCREEN-space size —
    // placePopover works in surface pixels throughout, so both the anchor rects and `size` here are
    // screen units even though the card's own layout (width/height above) is still LOCAL/unscaled.
    const plateEl = resolveEl(opts.plate);
    const pointerEl = resolveEl(opts.pointer);
    let plate = rectOf(plateEl, surfaceRect) ?? rectOf(pointerEl, surfaceRect);
    // Extend the plate's TOP edge upward to a popped-out hero's true top (e.g. the mobile SPIN/FS
    // control, taller than its row) — bottom edge untouched. Both rects are already in the SAME
    // surface-coordinate space (post any bar-scale transform), so this is a plain coordinate compare,
    // no separate unit conversion needed.
    const overflowEl = resolveEl(opts.plateOverflowTop);
    if (plate) {
      const overflowRect = rectOf(overflowEl, surfaceRect);
      if (overflowRect && overflowRect.y < plate.y) {
        plate = { ...plate, h: plate.h + (plate.y - overflowRect.y), y: overflowRect.y };
      }
    }
    const pointer = rectOf(pointerEl, surfaceRect);
    const p = placePopover(plate, surface, { w: resolvedW, h: naturalH * s }, pointer);

    // 4. Apply. maxHeight and the arrow's offset are LOCAL (unscaled) too, since both live inside the
    // scaled card; transform-origin:top left keeps left/top (screen units) as the card's visual
    // top-left regardless of `s`, and — since a transform doesn't affect layout — the next
    // measurement pass stays clean without needing any extra bookkeeping.
    card.style.left = `${p.x}px`;
    card.style.top = `${p.y}px`;
    card.style.maxHeight = `${p.maxH / s}px`;
    card.style.transformOrigin = 'top left';
    card.style.transform = Math.abs(s - 1) > 0.001 ? `scale(${s})` : '';
    card.classList.toggle('ge-pop-below', p.below);
    if (p.arrowX < 0) arrow.style.display = 'none';
    else {
      arrow.style.display = '';
      arrow.style.left = `${p.arrowX / s}px`;
    }
    affordance.sync();
  };
  return { root, card, body, affordance, position };
}
