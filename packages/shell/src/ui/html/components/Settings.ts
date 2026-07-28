import type { ShellHost } from '@/core/renderer';
import type { VolumeKey } from '@/core/types';
import { createOverlay } from '../primitives';
import { icon } from '../icons';

export function openSettingsModal(host: ShellHost): HTMLElement {
  const { root, body } = createOverlay({ title: host.t('Settings'), onClose: () => host.actions.closeOverlay() });
  root.dataset.ge = 'settings-modal';

  // Volume-slider updaters. Declared before the sound block below so its single setMenuRefresh
  // registration (which handles BOTH the sound icon and any slider) can close over this map.
  const updaters: Partial<Record<VolumeKey, (v: number) => void>> = {};

  // Sound on/off — backed by the shell's shared `soundOn` state so this toggle and the Shift+M
  // hotkey stay in sync; `setSound` emits `settingChange({ key: 'sound' })` and refreshes the icon.
  const sound = (() => {
    const btn = document.createElement('button');
    btn.className = 'ge-snd'; btn.dataset.ge = 'setting-sound';
    btn.setAttribute('aria-label', host.t('Sound'));
    const paint = (on: boolean) => {
      btn.innerHTML = icon(on ? 'soundOn' : 'soundOff');
      btn.classList.toggle('ge-active', on);
      btn.setAttribute('aria-pressed', String(on));
    };
    paint(host.soundOn);
    btn.addEventListener('click', () => host.setSound(!host.soundOn));
    // Live-update the icon when sound changes from here OR via Shift+M, and forward any slider
    // update to its own updater — one registration serves both (shell clears it on close).
    host.setMenuRefresh((id, v) => {
      if (id === 'sound') paint(v === true);
      else updaters[id as VolumeKey]?.(Number(v));
    });
    const row = document.createElement('div'); row.className = 'ge-ov-row';
    row.innerHTML = `<span class="ge-grow">${host.t('Sound')}</span>`; row.appendChild(btn);
    return row;
  })();
  body.appendChild(sound);

  // Volume sliders — full-width column rows with a live value readout. Positions are read from the
  // shell's stored volumes (not hardcoded to 100%), so reopening the overlay reflects the last set
  // value, and `host.setVolume()` from game code updates them live via the registered refresher above.
  const slider = (key: VolumeKey, label: string) => {
    const row = document.createElement('div'); row.className = 'ge-ov-row ge-col';
    const head = document.createElement('div'); head.className = 'ge-row-head';
    const val = document.createElement('span'); val.className = 'ge-val';
    head.innerHTML = `<span>${label}</span>`; head.appendChild(val);
    const input = document.createElement('input');
    input.type = 'range'; input.min = '0'; input.max = '1'; input.step = '0.05';
    input.className = 'ge-slider'; input.dataset.ge = `setting-${key}`;
    const paint = (v: number) => { input.value = String(v); val.textContent = `${Math.round(v * 100)}%`; };
    paint(host.getVolume(key));
    input.addEventListener('input', () => {
      val.textContent = `${Math.round(Number(input.value) * 100)}%`;
      host.setVolume(key, Number(input.value));
    });
    updaters[key] = paint;
    row.append(head, input);
    return row;
  };
  body.appendChild(slider('music', host.t('Music')));
  body.appendChild(slider('sfx', host.t('SFX')));

  // Game info — full-width row button that opens its own overlay
  const gameInfo = document.createElement('button');
  gameInfo.className = 'ge-ov-row'; gameInfo.dataset.ge = 'game-info-btn';
  gameInfo.style.marginTop = '6px';
  gameInfo.innerHTML = `<span style="width:22px;font-size:22px">${icon('info')}</span><span class="ge-grow">${host.t('Game info')}</span><span style="width:20px;font-size:20px;color:var(--shell-muted)">${icon('chevronRight')}</span>`;
  gameInfo.addEventListener('click', () => { root.remove(); host.actions.openInfo(); });
  body.appendChild(gameInfo);

  return root;
}
