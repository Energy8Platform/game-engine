import type { ModalOptions } from '@/core/types';
import type { ShellHost } from '@/core/renderer';
import { contrastText } from '@/core/colors';
import { createCardModal } from '../primitives';

/** Build a generic, externally-triggered modal (title + body text + optional action buttons),
 *  on the shared card-modal chrome. Each action runs its `on` then closes; the ✕ (if
 *  `availableClose`) and the actions are the only ways to dismiss. See GameShell.openModal.
 *  Dismissals route through host.actions.closeOverlay() so the controller clears its overlay handle
 *  (a bare root.remove() leaves the handle stale → keydowns keep routing to a torn-down layer). */
export function buildModal(host: ShellHost, opts: ModalOptions): HTMLElement {
  const close = () => host.actions.closeOverlay();
  const ui = createCardModal({
    ge: 'modal',
    title: opts.title,
    closable: opts.availableClose,
    blur: opts.blurLevel,
    onClose: close,
  });

  const text = document.createElement('p');
  text.className = 'ge-modal-text'; text.dataset.ge = 'modal-body';
  text.textContent = opts.body;
  ui.body.appendChild(text);

  if (opts.actions?.length) {
    const actions = document.createElement('div'); actions.className = 'ge-modal-actions';
    for (const a of opts.actions) {
      const btn = document.createElement('button');
      btn.className = 'ge-modal-btn'; btn.dataset.ge = 'modal-action';
      btn.textContent = a.title;
      if (a.color) { btn.style.background = a.color; btn.style.color = contrastText(a.color); }
      else btn.classList.add('ge-modal-btn--ghost');
      btn.addEventListener('click', () => { a.on?.(); close(); });
      actions.appendChild(btn);
    }
    ui.card.appendChild(actions);
  }
  return ui.root;
}
