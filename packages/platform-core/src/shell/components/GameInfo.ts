import type { GameShell } from '../GameShell';
import { createOverlay } from './primitives';

export function openGameInfoModal(shell: GameShell): HTMLElement {
  const info = shell.config.gameInfo;
  const { root, body } = createOverlay({
    title: 'Game info',
    onClose: () => root.remove(),
    onBack: () => { root.remove(); shell.openSettings(); },
  });
  root.dataset.ge = 'info-modal';

  const section = (ge: string, title: string): HTMLElement => {
    const sec = document.createElement('section');
    sec.dataset.ge = ge; sec.className = 'ge-gi-sec';
    const h = document.createElement('h3'); h.textContent = title; sec.appendChild(h);
    return sec;
  };

  if (typeof info.rtp === 'number') {
    const s = section('info-rtp', 'RTP'); const p = document.createElement('p'); p.textContent = `${info.rtp}%`; s.appendChild(p); body.appendChild(s);
  }
  if (info.rules) {
    const s = section('info-rules', 'Rules'); const p = document.createElement('p'); p.textContent = info.rules; s.appendChild(p); body.appendChild(s);
  }
  if (info.symbols?.length) {
    const s = section('info-symbols', 'Paytable');
    for (const sym of info.symbols) { const r = document.createElement('div'); r.className = 'ge-shell-sym-row'; r.textContent = sym.payouts ? `${sym.name} — ${sym.payouts}` : sym.name; s.appendChild(r); }
    body.appendChild(s);
  }
  if (info.features?.length) {
    const s = section('info-features', 'Features');
    for (const f of info.features) { const r = document.createElement('div'); r.className = 'ge-shell-feat-row'; r.textContent = `${f.name}: ${f.description}`; s.appendChild(r); }
    body.appendChild(s);
  }
  return root;
}
