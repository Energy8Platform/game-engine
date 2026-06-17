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
  columns: number;
  confirmLabel: string;
  onConfirm: (id: string) => void;
}

/** A centred picker (chips grid + accent Confirm) on the shared card modal. */
function buildSheet(host: ShellHost, opts: SheetOpts): CardModal {
  const modal = new CardModal(host, { tag: opts.tag, title: opts.title, onClose: () => host.closeLayer() });
  const em = modal.emSize;
  const gap = 0.65 * em;
  const innerW = modal.cardWidth - 2.4 * em;
  const colW = (innerW - gap * (opts.columns - 1)) / opts.columns;

  let selected = opts.selected;
  const chips: Chip[] = [];
  const grid = new FlexBox({ direction: 'column', align: 'start', gap });
  for (let i = 0; i < opts.choices.length; i += opts.columns) {
    const rowChoices = opts.choices.slice(i, i + opts.columns);
    const row = new FlexBox({ direction: 'row', align: 'center', gap });
    for (const c of rowChoices) {
      const chip = new Chip(host, c.id, c.label, c.id === selected, em, (id) => {
        selected = id;
        for (const x of chips) x.setSelected(x.id === selected);
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
      onTap: () => {
        opts.onConfirm(selected);
        host.closeLayer();
      },
    },
  ]);
  modal.build();
  return modal;
}

/** Bet picker — all available bets as chips (3 per row), accent Confirm applies it. */
export function openBetPicker(host: ShellHost): ShellLayer {
  return buildSheet(host, {
    tag: 'bet-modal',
    title: host.t('Bet'),
    columns: 3,
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
