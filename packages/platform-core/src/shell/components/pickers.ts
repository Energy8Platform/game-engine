import type { GameShell } from '../GameShell';
import { formatCurrency } from '../format';
import { createCardModal } from './primitives';

interface Choice { id: string; label: string }

interface SheetOpts {
  ge: string;
  title: string;
  choices: Choice[];
  selected: string;
  columns: number;
  confirmLabel: string;
  onConfirm: (id: string) => void;
}

/** A centred picker (chips grid + accent Confirm) on the shared card modal. */
function buildSheet(opts: SheetOpts): HTMLElement {
  const ui = createCardModal({ ge: opts.ge, title: opts.title, onClose: () => ui.root.remove() });

  const grid = document.createElement('div'); grid.className = 'ge-sheet-grid';
  grid.style.gridTemplateColumns = `repeat(${opts.columns}, 1fr)`;
  let selected = opts.selected;
  const chips: HTMLButtonElement[] = [];
  for (const c of opts.choices) {
    const chip = document.createElement('button');
    chip.className = 'ge-chip' + (c.id === selected ? ' ge-on' : '');
    chip.dataset.id = c.id; chip.textContent = c.label;
    chip.addEventListener('click', () => {
      selected = c.id;
      for (const x of chips) x.classList.toggle('ge-on', x.dataset.id === selected);
    });
    chips.push(chip); grid.appendChild(chip);
  }
  ui.body.appendChild(grid);

  // Single full-bleed Confirm; dismissal is the ✕ (top-right). No Cancel button.
  const confirm = document.createElement('button');
  confirm.className = 'ge-modal-btn ge-modal-btn--accent'; confirm.dataset.ge = 'sheet-confirm';
  confirm.textContent = opts.confirmLabel;
  confirm.addEventListener('click', () => { opts.onConfirm(selected); ui.root.remove(); });
  ui.card.appendChild(confirm);

  return ui.root;
}

/** Bet picker — all available bets as chips (3 per row), accent Confirm applies it. */
export function openBetModal(shell: GameShell): HTMLElement {
  return buildSheet({
    ge: 'bet-modal', title: shell.t('Bet'), columns: 3, confirmLabel: shell.t('Confirm'),
    choices: shell.state.availableBets.map((b) => ({ id: String(b), label: formatCurrency(b, shell.config.currency) })),
    selected: String(shell.state.bet),
    onConfirm: (id) => {
      const v = Number(id);
      if (v !== shell.state.bet) { shell.state.bet = v; shell.emit('betChange', v); }
      shell.render();
    },
  });
}

const AUTOPLAY_COUNTS = [10, 25, 50, 100, 250, 500, 1000, 2000, Infinity];

/** Autoplay picker — spin counts incl. ∞; Confirm starts autoplay. */
export function openAutoplayModal(shell: GameShell): HTMLElement {
  return buildSheet({
    ge: 'autoplay-modal', title: shell.t('Autoplay'), columns: 3, confirmLabel: shell.t('Start'),
    choices: AUTOPLAY_COUNTS.map((n) => ({ id: String(n), label: Number.isFinite(n) ? String(n) : '∞' })),
    selected: String(shell.state.autoplay.remaining || 10),
    onConfirm: (id) => {
      const remaining = Number(id); // "Infinity" → Infinity
      shell.state.autoplay = { active: true, remaining };
      shell.emit('autoplayStart', { active: true, remaining });
      shell.render();
    },
  });
}
