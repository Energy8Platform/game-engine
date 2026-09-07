import { scrollHint, scrollEdge } from '@/core/scrollHint';

/**
 * Make a scrollable region say so.
 *
 * The DOM half of the affordance. It writes two dataset marks the stylesheet reads —
 * `data-scroll="start|mid|end"` and `data-scroll-axis` — and owns the one part CSS alone cannot do:
 * a chevron that appears on an overflowing region and retires once the player has scrolled.
 *
 * The cue is a SIBLING of the scroller, not a child. A child would scroll away with the content on
 * the very first drag, which is precisely when it still has something to say.
 */

export type ScrollAxis = 'y' | 'x';

export interface ScrollAffordanceOpts {
  /** Which axis overflows. `x` is the buy-bonus card strip; everything else is `y`. */
  axis?: ScrollAxis;
  /** Where the chevron is appended. Defaults to the scroller's parent, which is what every shell
   *  surface wants — pass one explicitly when the parent is itself clipped. */
  cueHost?: HTMLElement | null;
  /** Draw the chevron at all (default true). The buy-bonus card strip opts out: it already carries
   *  its own ‹ › arrows, and a second, differently-shaped hint for the same gesture reads as two
   *  controls rather than one. The thumb and the edge fade still apply. */
  cue?: boolean;
}

export interface ScrollAffordance {
  /** Re-measure and repaint the marks. Call after content or size changes; `scroll` is automatic. */
  sync(): void;
  /** Detach listeners and restore the element. */
  destroy(): void;
}

/** Cue diameter, mirrored in the stylesheet. Kept here because the cue is positioned in JS. */
const CUE_SIZE = 22;
const CUE_GAP = 6;

/** The chevron glyph, inline so it needs no icon-set entry and no font. */
const CUE_SVG =
  '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" ' +
  'stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9l7 7 7-7"/></svg>';

export function attachScrollAffordance(el: HTMLElement, opts: ScrollAffordanceOpts = {}): ScrollAffordance {
  const axis: ScrollAxis = opts.axis ?? 'y';
  let cue: HTMLElement | null = null;
  // Once the player scrolls they have discovered the gesture; re-offering it every time they
  // return to the top would nag rather than inform.
  let cueRetired = false;
  let destroyed = false;

  if (axis === 'x') el.dataset.scrollAxis = 'x';

  const removeCue = (): void => {
    cue?.remove();
    cue = null;
  };

  const showCue = (): void => {
    if (cue || cueRetired || opts.cue === false) return;
    const host = opts.cueHost ?? el.parentElement;
    if (!host) return;
    cue = document.createElement('div');
    cue.className = 'ge-scroll-cue';
    cue.setAttribute('aria-hidden', 'true');
    cue.innerHTML = CUE_SVG;
    host.appendChild(cue);
    positionCue();
  };

  /** Pin the cue to the bottom of the SCROLLER, not of its host. The buy-bonus overlay hangs a bet
   *  bar below its scroll region, and a cue pinned to the host's bottom edge lands on top of it. */
  const positionCue = (): void => {
    if (!cue) return;
    const size = cue.offsetWidth || CUE_SIZE;
    if (axis === 'x') {
      cue.style.left = `${el.offsetLeft + el.offsetWidth - size - CUE_GAP}px`;
      cue.style.top = `${el.offsetTop + (el.offsetHeight - size) / 2}px`;
    } else {
      cue.style.left = `${el.offsetLeft + (el.offsetWidth - size) / 2}px`;
      cue.style.top = `${el.offsetTop + el.offsetHeight - size - CUE_GAP}px`;
    }
  };

  const sync = (): void => {
    if (destroyed) return;
    const h =
      axis === 'x'
        ? scrollHint({ scrollTop: el.scrollLeft, scrollHeight: el.scrollWidth, clientHeight: el.clientWidth })
        : scrollHint({ scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight });
    const edge = scrollEdge(h);
    if (edge === 'none') {
      delete el.dataset.scroll;
      removeCue();
      return;
    }
    el.dataset.scroll = edge;
    if (edge === 'start') {
      showCue();
      positionCue(); // the scroller can move/resize under a cue that is already up
    } else {
      removeCue();
    }
  };

  // Retirement is keyed off actual MOVEMENT, not off the event. A browser also fires `scroll` when
  // content reflows under a pinned offset, and a hint dismissed by a reflow the player never caused
  // is a hint they never saw.
  let lastPos = axis === 'x' ? el.scrollLeft : el.scrollTop;
  const onScroll = (): void => {
    const pos = axis === 'x' ? el.scrollLeft : el.scrollTop;
    if (pos !== lastPos) {
      lastPos = pos;
      cueRetired = true;
      removeCue();
    }
    sync();
  };
  el.addEventListener('scroll', onScroll, { passive: true });

  // Content in these regions is built asynchronously (fonts, images, a rebuilt body on resize), so
  // a single sync at mount would measure the wrong thing. ResizeObserver is absent in jsdom.
  const RO = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
  const ro = typeof RO === 'function' ? new RO(() => sync()) : null;
  if (ro) {
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
  }

  sync();

  return {
    sync,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      el.removeEventListener('scroll', onScroll);
      ro?.disconnect();
      delete el.dataset.scroll;
      delete el.dataset.scrollAxis;
      removeCue();
    },
  };
}
