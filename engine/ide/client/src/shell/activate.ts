import type { KeyboardEvent } from 'react';

/**
 * Makes Enter and Space do what a click does on a `role="button"` row that
 * is not a `<button>` — the Projects and Explorer lists. A real button
 * gets this from the browser; a `<li tabIndex={0}>` gets it from here.
 * `preventDefault` keeps Space from scrolling the list it is activating
 * in. Only the row ITSELF: a real button nested in it (delete, the inline
 * Yes/No) bubbles its keydown up here, and answering that would both
 * activate the row and cancel the button's own click.
 */
export function activateOnKey(handler: () => void) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handler();
    }
  };
}
