import type { PixiComponentContext, ShellLayer } from '../context';
import { CardModal } from '../primitives/card';
import { Chip } from '../primitives/controls';
import { FlexBox, type Sizable } from '../primitives/flex';
import { ScrollBox } from '../primitives/scroll';

interface Choice {
  id: string;
  label: string;
}

interface SheetOpts {
  tag: string;
  title: string;
  choices: Choice[];
  selected: string;
  /** Chips per row — a fixed number, or `{ wide, mobile }` that reflows with the layout.
   *  With `autoFit`, this is the *maximum* column count; the grid drops to fewer when the labels
   *  are too wide to fit that many. */
  columns: number | { wide: number; mobile: number };
  /** Size the columns to the widest chip label (instead of always packing `columns`), and cap the
   *  grid height with a scroll region. For variable-width labels (a wide currency's bet values)
   *  this reflows + scrolls rather than clipping — the Pixi analogue of the HTML shell's
   *  `auto-fill minmax` + `overflow-y:auto`. */
  autoFit?: boolean;
  /** Max card width in em (the 6-wide bet picker needs 44em vs the 28em default). */
  maxEm?: number;
  confirmLabel: string;
  onConfirm: (id: string) => void;
}

/** Extended CardModal that implements ShellLayer.onKey for keyboard navigation. */
class PickerModal extends CardModal {
  private _onKey: (e: KeyboardEvent) => boolean;

  constructor(host: PixiComponentContext, opts: ConstructorParameters<typeof CardModal>[1], onKey: (e: KeyboardEvent) => boolean) {
    super(host, opts);
    this._onKey = onKey;
  }

  onKey(e: KeyboardEvent): boolean {
    return this._onKey(e);
  }
}

/** A centred picker (chips grid + accent Confirm) on the shared card modal. */
/** A ScrollBox that reports a fixed box to the FlexBox layout — so a capped, scrolling grid slots
 *  into the card body like any other sized child (measured/positioned by its viewport, not its
 *  full content bounds). */
class SizedScrollBox extends ScrollBox implements Sizable {
  constructor(private readonly boxW: number, private readonly boxH: number, canvas?: HTMLCanvasElement) {
    super(canvas);
    this.setViewport(boxW, boxH);
  }
  measureSize(): { w: number; h: number } {
    return { w: this.boxW, h: this.boxH };
  }
  setLayoutSize(): void {
    /* fixed viewport — ignore layout-imposed sizing */
  }
}

function buildSheet(host: PixiComponentContext, opts: SheetOpts): ShellLayer {
  const maxColumns = typeof opts.columns === 'number'
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

  // Build the chips first (at natural width) so autoFit can measure the widest label.
  for (let i = 0; i < opts.choices.length; i++) {
    const c = opts.choices[i];
    const chipIndex = i;
    chips.push(new Chip(host, c.id, c.label, chipIndex === focusIndex, em, (id) => {
      const idx = opts.choices.findIndex((ch) => ch.id === id);
      if (idx >= 0) setHighlight(idx);
    }));
  }

  // Column count: with autoFit, drop below the max until the widest label fits. Short labels
  // (a normal currency) exceed the max and clamp back to it — so the compact 6-wide layout is
  // preserved and only wide currencies reflow to fewer columns.
  let columns = maxColumns;
  if (opts.autoFit) {
    const widest = chips.reduce((m, ch) => Math.max(m, ch.measureSize().w), 0);
    const fitCols = Math.floor((innerW + gap) / (widest + gap));
    columns = Math.max(1, Math.min(maxColumns, fitCols));
  }
  const colW = (innerW - gap * (columns - 1)) / columns;

  const grid = new FlexBox({ direction: 'column', align: 'start', gap });
  for (let i = 0; i < chips.length; i += columns) {
    const row = new FlexBox({ direction: 'row', align: 'center', gap });
    for (let j = 0; j < columns && i + j < chips.length; j++) {
      const chip = chips[i + j];
      chip.setLayoutSize(colW, undefined);
      row.add(chip);
    }
    grid.add(row);
  }

  // Cap the grid height and scroll when the ladder overflows — the Pixi analogue of the HTML
  // shell's `max-height:min(50vh,28em); overflow-y:auto`. (Mask hit-testing clips to the viewport
  // but still lets clicks through to chips inside it — verified against pixi.js 8.16's
  // EventBoundary.) When it fits, drop the scroll box entirely so nothing is masked needlessly.
  const gridH = grid.measureSize().h;
  const maxGridH = Math.min(host.screenH * 0.5, 28 * em);
  if (opts.autoFit && gridH > maxGridH) {
    const scroll = new SizedScrollBox(innerW, maxGridH, host.canvas);
    scroll.content.addChild(grid);
    scroll.refresh();
    modal.body.add(scroll);
  } else {
    modal.body.add(grid);
  }

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
export function openBetPicker(host: PixiComponentContext): ShellLayer {
  return buildSheet(host, {
    tag: 'bet-modal',
    title: host.t('Bet'),
    columns: { wide: 6, mobile: 3 },
    autoFit: true, // reflow columns + scroll when a wide currency makes the labels grow
    maxEm: 44, // wider card to fit 6 chips/row
    confirmLabel: host.t('Confirm'),
    choices: host.state.availableBets.map((b) => ({ id: String(b), label: host.fmt(b) })),
    selected: String(host.state.bet),
    onConfirm: (id) => {
      const v = Number(id);
      host.actions.setBet(v);
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
export function openAutoplayPicker(host: PixiComponentContext): ShellLayer {
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
      host.actions.startAutoplay(remaining);
    },
  });
}
