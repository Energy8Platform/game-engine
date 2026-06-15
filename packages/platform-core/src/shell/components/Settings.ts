import type { GameShell } from '../GameShell';
import { createModal, createSlider, createToggle } from './primitives';

export function openSettingsModal(shell: GameShell): HTMLElement {
  const { root, body } = createModal({ onClose: () => root.remove() });
  root.dataset.ge = 'settings-modal';

  const slider = (key: string, label: string) => {
    const row = document.createElement('label');
    row.className = 'ge-shell-setting-row';
    row.textContent = label;
    const input = createSlider({
      min: 0, max: 1, step: 0.05, value: 1,
      onInput: (value) => shell.emit('settingChange', { key, value }),
    });
    input.dataset.ge = `setting-${key.toLowerCase()}`;
    row.appendChild(input);
    return row;
  };

  body.appendChild(slider('master', 'Master volume'));
  body.appendChild(slider('music', 'Music'));
  body.appendChild(slider('sfx', 'SFX'));

  const quick = createToggle({ checked: false, onChange: (value) => shell.emit('settingChange', { key: 'quickSpin', value }) });
  quick.dataset.ge = 'setting-quickspin';
  const quickRow = document.createElement('label');
  quickRow.className = 'ge-shell-setting-row';
  quickRow.textContent = 'Quick spin';
  quickRow.appendChild(quick);
  body.appendChild(quickRow);

  return root;
}
