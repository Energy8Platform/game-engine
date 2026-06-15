import type { GameShell } from '../GameShell';
import { createModal } from './primitives';

export function openGameInfoModal(shell: GameShell): HTMLElement {
  const info = shell.config.gameInfo;
  const { root, body } = createModal({ onClose: () => root.remove() });
  root.dataset.ge = 'info-modal';

  const section = (ge: string, title: string): HTMLElement => {
    const sec = document.createElement('section');
    sec.dataset.ge = ge;
    const h = document.createElement('h3');
    h.textContent = title;
    sec.appendChild(h);
    return sec;
  };

  if (typeof info.rtp === 'number') {
    const rtp = section('info-rtp', 'RTP');
    const p = document.createElement('p');
    p.textContent = `${info.rtp}%`;
    rtp.appendChild(p);
    body.appendChild(rtp);
  }

  if (info.rules) {
    const rules = section('info-rules', 'Rules');
    const p = document.createElement('p');
    p.textContent = info.rules;
    rules.appendChild(p);
    body.appendChild(rules);
  }

  if (info.symbols?.length) {
    const sym = section('info-symbols', 'Paytable');
    for (const s of info.symbols) {
      const row = document.createElement('div');
      row.className = 'ge-shell-sym-row';
      row.textContent = s.payouts ? `${s.name} — ${s.payouts}` : s.name;
      sym.appendChild(row);
    }
    body.appendChild(sym);
  }

  if (info.features?.length) {
    const feat = section('info-features', 'Features');
    for (const f of info.features) {
      const row = document.createElement('div');
      row.className = 'ge-shell-feat-row';
      row.textContent = `${f.name}: ${f.description}`;
      feat.appendChild(row);
    }
    body.appendChild(feat);
  }

  return root;
}
