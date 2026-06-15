import type { GameShell } from '../GameShell';
import type { BonusOption } from '../types';
import { formatCurrency } from '../format';
import { createModal } from './primitives';

export function openBuyBonusOverlay(shell: GameShell): HTMLElement | null {
  const bonuses = shell.config.features.buyBonus;
  if (bonuses === false || bonuses.length === 0) return null;

  const { root, body } = createModal({ onClose: () => root.remove() });
  root.dataset.ge = 'buybonus-overlay';

  for (const bonus of bonuses) {
    body.appendChild(buildCard(shell, bonus, root));
  }
  return root;
}

function buildCard(shell: GameShell, bonus: BonusOption, root: HTMLElement): HTMLElement {
  const price = bonus.priceMultiplier * shell.state.bet;
  const card = document.createElement('button');
  card.className = 'ge-shell-btn ge-shell-bonus-card';
  card.dataset.ge = `bonus-card-${bonus.id}`;
  if (bonus.accentColor) card.style.borderColor = bonus.accentColor;

  const stars = bonus.volatility ? '★'.repeat(bonus.volatility) : '';
  card.innerHTML = `
    <div class="ge-bonus-name">${bonus.name}</div>
    <div class="ge-bonus-desc">${bonus.description}</div>
    <div class="ge-bonus-vol">${stars}</div>
    <div class="ge-bonus-price">${formatCurrency(price, shell.config.currency)}</div>
  `;
  card.addEventListener('click', () => {
    if (shell.state.busy || !shell.state.buyBonusEnabled) return;
    shell.emit('buyBonusSelect', { id: bonus.id });
    root.remove();
  });
  return card;
}
