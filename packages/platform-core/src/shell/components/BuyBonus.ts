import type { GameShell } from '../GameShell';
import type { BonusOption } from '../types';
import { formatCurrency } from '../format';
import { createOverlay } from './primitives';

export function openBuyBonusOverlay(shell: GameShell): HTMLElement | null {
  const bonuses = shell.config.features.buyBonus;
  if (bonuses === false || bonuses.length === 0) return null;

  const { root, body } = createOverlay({ title: 'Buy bonus', onClose: () => root.remove() });
  root.dataset.ge = 'buybonus-overlay';
  const grid = document.createElement('div'); grid.className = 'ge-bb-grid';
  for (const bonus of bonuses) grid.appendChild(buildCard(shell, bonus, root));
  body.appendChild(grid);
  return root;
}

function buildCard(shell: GameShell, bonus: BonusOption, root: HTMLElement): HTMLElement {
  const price = bonus.priceMultiplier * shell.state.bet;
  const accent = bonus.accentColor ?? 'var(--shell-accent)';
  const card = document.createElement('button');
  card.className = 'ge-shell-bonus-card'; card.dataset.ge = `bonus-card-${bonus.id}`;
  card.style.borderColor = accent;
  const stars = bonus.volatility ? '★'.repeat(bonus.volatility) : '';
  card.innerHTML = `
    <div class="ge-bonus-name">${bonus.name}</div>
    <div class="ge-bonus-vol" style="color:${accent}">${stars}</div>
    <div class="ge-bonus-desc">${bonus.description}</div>
    <div class="ge-bonus-price" style="color:${accent}">${formatCurrency(price, shell.config.currency)}</div>
  `;
  card.addEventListener('click', () => {
    if (shell.state.busy || !shell.state.buyBonusEnabled) return;
    shell.emit('buyBonusSelect', { id: bonus.id });
    root.remove();
  });
  return card;
}
