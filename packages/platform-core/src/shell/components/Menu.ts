import type { GameShell } from '../GameShell';
import { createModal, createButton } from './primitives';

export function openMenuModal(shell: GameShell): HTMLElement {
  const { root, body } = createModal({ onClose: () => root.remove() });
  root.dataset.ge = 'menu-modal';

  const entry = (ge: string, label: string, onClick: () => void) => {
    const btn = createButton({ label, onClick });
    btn.dataset.ge = ge;
    return btn;
  };

  body.append(
    entry('menu-settings', 'Settings', () => { root.remove(); shell.openSettings(); }),
    entry('menu-info', 'Game Info', () => { root.remove(); shell.openInfo(); }),
  );
  return root;
}
