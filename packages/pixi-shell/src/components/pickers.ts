import type { ShellHost, ShellLayer } from '../context';
import { CardModal } from '../primitives/card';
import { Chip } from '../primitives/controls';
import { FlexBox } from '../primitives/flex';

interface Choice {
  id: string;
  label: string;
}

interface SheetOpts {
  tag: string;
  title: string;
  choices: Choice[];
  selected: string;
  /** Chips per row — a fixed number, or `{ wide, mobile }` that reflows with the layout. */
  columns: number | { wide: number; mobile: number };
  /** Max card width in em (the 6-wide bet picker needs 44em vs the 28em default). */
  maxEm?: number;
  confirmLabel: string;
  onConfirm: (id: string) => void;
}

/** Extended CardModal that implements ShellLayer.onKey for keyboard navigation. */
class PickerModal extends CardModal {
  private _onKey: (e: KeyboardEvent) => boolean;

  constructor(host: ShellHost, opts: ConstructorParameters<typeof CardModal>[1], onKey: (e: KeyboardEvent) => boolean) {
    super(host, opts);
    this._onKey = onKey;
  }

  onKey(e: KeyboardEvent): boolean {
    return this._onKey(e);
  }
}

/** A centred picker (chips grid + accent Confirm) on the shared card modal. */
function buildSheet(host: ShellHost, opts: SheetOpts): ShellLayer {
  const columns = typeof opts.columns === 'number'
    ? opts.columns
    : host.layout === 'mobile' ? opts.columns.mobile : opts.columns.wide;

  let selected = opts.selected;
  let focusIndex = opts.choices.findIndex((c) => c.id === selected);
  if (focusIndex < 0) focusIndex = 0;
  const chips: Chip[] = [];

  /** Update chip visuals to reflect the current focused index. */
  function setHighlight(newIndex: number): void {
    focusIndex = newIndex;
    selected = opts.choices[focusIndex].id;
    for (let i = 0; i < chips.length; i++) {
      chips[i].setSelected(i === focusIndex);
    }
  }

  function doConfirm(): void {
    opts.onConfirm(selected);
    host.closeLayer();
  }

  function onKey(e: KeyboardEvent): boolean {
    const last = opts.choices.length - 1;
    switch (e.code) {
      case 'ArrowRight':
      case 'ArrowDown':
      case 'Equal':
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
        host.closeLayer();
        return true;
      default:
        return false;
    }
  }

  const modal = new PickerModal(host, { tag: opts.tag, title: opts.title, maxEm: opts.maxEm, onClose: () => host.closeLayer() }, onKey);
  const em = modal.emSize;
  const gap = 0.65 * em;
  const innerW = modal.cardWidth - 2.4 * em;
  const colW = (innerW - gap * (columns - 1)) / columns;

  const grid = new FlexBox({ direction: 'column', align: 'start', gap });
  for (let i = 0; i < opts.choices.length; i += columns) {
    const rowChoices = opts.choices.slice(i, i + columns);
    const row = new FlexBox({ direction: 'row', align: 'center', gap });
    for (let j = 0; j < rowChoices.length; j++) {
      const c = rowChoices[j];
      const chipIndex = i + j;
      const chip = new Chip(host, c.id, c.label, chipIndex === focusIndex, em, (id) => {
        const idx = opts.choices.findIndex((ch) => ch.id === id);
        if (idx >= 0) setHighlight(idx);
      });
      chip.setLayoutSize(colW, undefined);
      chips.push(chip);
      row.add(chip);
    }
    row.layout();
    grid.add(row);
  }
  modal.body.add(grid);

  modal.setActions([
    {
      label: opts.confirmLabel,
      kind: 'accent',
      onTap: doConfirm,
    },
  ]);
  modal.build();
  return modal;
}

/** Bet picker — all available bets as chips (6 per row, 3 on mobile), accent Confirm applies it. */
export function openBetPicker(host: ShellHost): ShellLayer {
  return buildSheet(host, {
    tag: 'bet-modal',
    title: host.t('Bet'),
    columns: { wide: 6, mobile: 3 },
    maxEm: 44, // wider card to fit 6 chips/row
    confirmLabel: host.t('Confirm'),
    choices: host.state.availableBets.map((b) => ({ id: String(b), label: host.fmt(b) })),
    selected: String(host.state.bet),
    onConfirm: (id) => {
      const v = Number(id);
      if (v !== host.state.bet) {
        host.state.bet = v;
        host.emit('betChange', v);
      }
      host.render();
    },
  });
}

const AUTOPLAY_COUNTS = [10, 25, 50, 100, 250, 500, 1000, 2000, Infinity];

function autoplayCounts(maxCount?: number): number[] {
  if (maxCount == null) return AUTOPLAY_COUNTS;
  const capped = AUTOPLAY_COUNTS.filter((n) => Number.isFinite(n) && n <= maxCount);
  if (!capped.includes(maxCount)) capped.push(maxCount);
  return capped;
}

/** Autoplay picker — spin counts (incl. ∞ unless a maxCount caps them); Confirm starts autoplay. */
export function openAutoplayPicker(host: ShellHost): ShellLayer {
  const maxCount = host.config.features.autoplay?.maxCount;
  const counts = autoplayCounts(maxCount);
  return buildSheet(host, {
    tag: 'autoplay-modal',
    title: host.t('Autoplay'),
    columns: 3,
    confirmLabel: host.t('Start'),
    choices: counts.map((n) => ({ id: String(n), label: Number.isFinite(n) ? String(n) : '∞' })),
    selected: String(host.state.autoplay.remaining || counts[0]),
    onConfirm: (id) => {
      let remaining = Number(id);
      if (maxCount != null) remaining = Math.min(remaining, maxCount);
      host.state.autoplay = { active: true, remaining };
      host.emit('autoplayStart', { active: true, remaining });
      host.render();
    },
  });
}
