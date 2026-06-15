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

  let soundOn = true;
  const soundBtn = createButton({
    label: 'Sound: On',
    onClick: () => {
      soundOn = !soundOn;
      soundBtn.textContent = soundOn ? 'Sound: On' : 'Sound: Off';
      shell.emit('settingChange', { key: 'sound', value: soundOn });
    },
  });
  soundBtn.dataset.ge = 'menu-sound';

  const toggleFullscreen = () => {
    const el = shell.config.mount as HTMLElement & { requestFullscreen?: () => Promise<void> };
    const doc = document as Document & { exitFullscreen?: () => Promise<void>; fullscreenElement?: Element | null };
    try {
      if (doc.fullscreenElement) {
        if (typeof doc.exitFullscreen === 'function') void doc.exitFullscreen();
      } else if (typeof el.requestFullscreen === 'function') {
        void el.requestFullscreen();
      }
    } catch {
      /* Fullscreen API unavailable (e.g. jsdom) — ignore */
    }
  };

  body.append(
    entry('menu-settings', 'Settings', () => { root.remove(); shell.openSettings(); }),
    entry('menu-info', 'Game Info', () => { root.remove(); shell.openInfo(); }),
    soundBtn,
    entry('menu-fullscreen', 'Fullscreen', toggleFullscreen),
  );
  return root;
}
