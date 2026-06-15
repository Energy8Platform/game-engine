import type { GameShell } from '../GameShell';
import { createOverlay } from './primitives';
import { icon } from './icons';

export function openSettingsModal(shell: GameShell): HTMLElement {
  const { root, body } = createOverlay({ title: 'Settings', onClose: () => root.remove() });
  root.dataset.ge = 'settings-modal';

  // Sound toggle (starts on)
  const sound = (() => {
    let on = true;
    const btn = document.createElement('button');
    btn.className = 'ge-toggle ge-on'; btn.dataset.ge = 'setting-sound'; btn.innerHTML = '<i></i>';
    btn.addEventListener('click', () => {
      on = !on; btn.classList.toggle('ge-on', on);
      shell.emit('settingChange', { key: 'sound', value: on });
    });
    const row = document.createElement('div'); row.className = 'ge-set-row';
    row.innerHTML = '<span class="ge-grow">Sound</span>'; row.appendChild(btn);
    return row;
  })();
  body.appendChild(sound);

  const slider = (key: string, label: string) => {
    const row = document.createElement('div'); row.className = 'ge-set-row';
    row.style.flexDirection = 'column'; row.style.alignItems = 'stretch'; row.style.gap = '8px';
    const head = document.createElement('div'); head.className = 'ge-grow';
    head.style.cssText = 'display:flex;justify-content:space-between'; head.innerHTML = `<span>${label}</span>`;
    const input = document.createElement('input');
    input.type = 'range'; input.min = '0'; input.max = '1'; input.step = '0.05'; input.value = '1';
    input.className = 'ge-slider'; input.dataset.ge = `setting-${key}`;
    input.addEventListener('input', () => shell.emit('settingChange', { key, value: Number(input.value) }));
    row.append(head, input);
    return row;
  };
  body.appendChild(slider('master', 'Master volume'));
  body.appendChild(slider('music', 'Music'));
  body.appendChild(slider('sfx', 'SFX'));

  const gameInfo = document.createElement('button');
  gameInfo.className = 'ge-navbtn'; gameInfo.dataset.ge = 'game-info-btn';
  gameInfo.innerHTML = `<span style="width:22px">${icon('info')}</span><span class="ge-grow">Game info</span><span style="width:20px">${icon('chevronRight')}</span>`;
  gameInfo.addEventListener('click', () => { root.remove(); shell.openInfo(); });
  body.appendChild(gameInfo);

  return root;
}
