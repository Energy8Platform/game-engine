import type { ShellHost } from '@/core/renderer';
import { createCardModal } from '../primitives';

interface Choice { id: string; label: string }

interface SheetOpts {
  ge: string;
  title: string;
  choices: Choice[];
  selected: string;
  /** Chips per row. A single number is fixed across layouts; `{ wide, mobile }` reflows
   *  with the shell's mobile breakpoint (driven by CSS custom props, so an open modal
   *  re-columns live on resize/rotate without being rebuilt). */
  columns: number | { wide: number; mobile: number };
  confirmLabel: string;
  onConfirm: (id: string) => void;
  /** Called to dismiss the picker (should invoke host.actions.closeOverlay()). */
  onClose: () => void;
}

/** Result of buildSheet — the root DOM element plus a keyboard handler. */
interface Sheet {
  root: HTMLElement;
  /** Route keydown events here. Returns true if the event was consumed. */
  onKey: (e: KeyboardEvent) => boolean;
}

/** A centred picker (chips grid + accent Confirm) on the shared card modal. */
function buildSheet(opts: SheetOpts): Sheet {
  const ui = createCardModal({ ge: opts.ge, title: opts.title, onClose: () => opts.onClose() });

  const grid = document.createElement('div'); grid.className = 'ge-sheet-grid';
  const cols = typeof opts.columns === 'number' ? { wide: opts.columns, mobile: opts.columns } : opts.columns;
  grid.style.setProperty('--cols', String(cols.wide));
  grid.style.setProperty('--cols-m', String(cols.mobile));
  let selected = opts.selected;
  let focusIndex = opts.choices.findIndex((c) => c.id === selected);
  if (focusIndex < 0) focusIndex = 0;
  const chips: HTMLButtonElement[] = [];

  /** Update chip visuals to reflect the current selected/focused index. */
  function setHighlight(newIndex: number): void {
    focusIndex = newIndex;
    selected = opts.choices[focusIndex].id;
    for (let i = 0; i < chips.length; i++) {
      chips[i].classList.toggle('ge-on', i === focusIndex);
    }
  }

  for (let i = 0; i < opts.choices.length; i++) {
    const c = opts.choices[i];
    const chip = document.createElement('button');
    chip.className = 'ge-chip' + (i === focusIndex ? ' ge-on' : '');
    chip.dataset.id = c.id; chip.textContent = c.label;
    const idx = i; // capture for closure
    chip.addEventListener('click', () => {
      setHighlight(idx);
    });
    chips.push(chip); grid.appendChild(chip);
  }
  ui.body.appendChild(grid);

  function doConfirm(): void {
    opts.onConfirm(selected);
    opts.onClose();
  }

  // Single full-bleed Confirm; dismissal is the ✕ (top-right). No Cancel button.
  const confirm = document.createElement('button');
  confirm.className = 'ge-modal-btn ge-modal-btn--accent'; confirm.dataset.ge = 'sheet-confirm';
  confirm.textContent = opts.confirmLabel;
  confirm.addEventListener('click', doConfirm);
  ui.card.appendChild(confirm);

  function onKey(e: KeyboardEvent): boolean {
    const last = opts.choices.length - 1;
    switch (e.code) {
      case 'ArrowRight':
      case 'ArrowDown':
      case 'Equal':         // + on most keyboards
      case 'NumpadAdd':
        if (focusIndex < last) setHighlight(focusIndex + 1);
        return true;
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'Minus':
      case 'NumpadSubtract':
        if (focusIndex > 0) setHighlight(focusIndex - 1);
        return true;
      case 'Enter':
      case 'Space':
        doConfirm();
        return true;
      case 'Escape':
        opts.onClose();
        return true;
      default:
        return false;
    }
  }

  return { root: ui.root, onKey };
}

/** Bet picker — all available bets as chips (6 per row, 3 on mobile), accent Confirm applies it. */
export function openBetModal(host: ShellHost): { root: HTMLElement; onKey: (e: KeyboardEvent) => boolean } {
  return buildSheet({
    ge: 'bet-modal', title: host.t('Bet'), columns: { wide: 6, mobile: 3 }, confirmLabel: host.t('Confirm'),
    choices: host.state.availableBets.map((b) => ({ id: String(b), label: host.formatCurrency(b) })),
    selected: String(host.state.bet),
    onClose: () => host.actions.closeOverlay(),
    onConfirm: (id) => {
      const v = Number(id);
      host.actions.setBet(v);
    },
  });
}

const AUTOPLAY_COUNTS = [10, 25, 50, 100, 250, 500, 1000, 2000, Infinity];

/** The selectable spin counts, honouring an optional jurisdiction max. With a `maxCount`:
 *  drop ∞, keep presets ≤ max, and append the max itself when it isn't already a preset
 *  (so the cap is always offered). Without one: the default presets including ∞. */
function autoplayCounts(maxCount?: number): number[] {
  if (maxCount == null) return AUTOPLAY_COUNTS;
  const capped = AUTOPLAY_COUNTS.filter((n) => Number.isFinite(n) && n <= maxCount);
  if (!capped.includes(maxCount)) capped.push(maxCount);
  return capped;
}

/** Autoplay picker — spin counts (incl. ∞ unless a maxCount caps them); Confirm starts autoplay. */
export function openAutoplayModal(host: ShellHost): { root: HTMLElement; onKey: (e: KeyboardEvent) => boolean } {
  const maxCount = host.config.features.autoplay?.maxCount;
  const counts = autoplayCounts(maxCount);
  return buildSheet({
    ge: 'autoplay-modal', title: host.t('Autoplay'), columns: 3, confirmLabel: host.t('Start'),
    choices: counts.map((n) => ({ id: String(n), label: Number.isFinite(n) ? String(n) : '∞' })),
    selected: String(host.state.autoplay.remaining || counts[0]),
    onClose: () => host.actions.closeOverlay(),
    onConfirm: (id) => {
      let remaining = Number(id); // "Infinity" → Infinity
      if (maxCount != null) remaining = Math.min(remaining, maxCount); // defensive cap
      host.actions.startAutoplay(remaining);
    },
  });
}
