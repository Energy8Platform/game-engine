import type { GameShell } from '../GameShell';
import { createOverlay } from './primitives';
import { icon } from './icons';

export function openSettingsModal(shell: GameShell): HTMLElement {
  const { root, body } = createOverlay({ title: 'Settings', onClose: () => root.remove() });
  root.dataset.ge = 'settings-modal';

  // Sound toggle (starts on) — full-width row
  const sound = (() => {
    let on = true;
    const btn = document.createElement('button');
    btn.className = 'ge-toggle ge-on'; btn.dataset.ge = 'setting-sound';
    btn.setAttribute('aria-label', 'Sound'); btn.innerHTML = '<i></i>';
    btn.addEventListener('click', () => {
      on = !on; btn.classList.toggle('ge-on', on);
      shell.emit('settingChange', { key: 'sound', value: on });
    });
    const row = document.createElement('div'); row.className = 'ge-ov-row';
    row.innerHTML = '<span class="ge-grow">Sound</span>'; row.appendChild(btn);
    return row;
  })();
  body.appendChild(sound);

  // Volume sliders — full-width column rows with a live value readout
  const slider = (key: string, label: string) => {
    const row = document.createElement('div'); row.className = 'ge-ov-row ge-col';
    const head = document.createElement('div'); head.className = 'ge-row-head';
    const val = document.createElement('span'); val.className = 'ge-val'; val.textContent = '100%';
    head.innerHTML = `<span>${label}</span>`; head.appendChild(val);
    const input = document.createElement('input');
    input.type = 'range'; input.min = '0'; input.max = '1'; input.step = '0.05'; input.value = '1';
    input.className = 'ge-slider'; input.dataset.ge = `setting-${key}`;
    input.addEventListener('input', () => {
      val.textContent = `${Math.round(Number(input.value) * 100)}%`;
      shell.emit('settingChange', { key, value: Number(input.value) });
    });
    row.append(head, input);
    return row;
  };
  body.appendChild(slider('master', 'Master volume'));
  body.appendChild(slider('music', 'Music'));
  body.appendChild(slider('sfx', 'SFX'));

  // Game info — full-width row button that opens its own overlay
  const gameInfo = document.createElement('button');
  gameInfo.className = 'ge-ov-row'; gameInfo.dataset.ge = 'game-info-btn';
  gameInfo.style.marginTop = '6px';
  gameInfo.innerHTML = `<span style="width:22px;font-size:22px">${icon('info')}</span><span class="ge-grow">Game info</span><span style="width:20px;font-size:20px;color:var(--shell-muted)">${icon('chevronRight')}</span>`;
  gameInfo.addEventListener('click', () => { root.remove(); shell.openInfo(); });
  body.appendChild(gameInfo);

  return root;
}
