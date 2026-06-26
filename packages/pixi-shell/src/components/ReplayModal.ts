import { Graphics } from 'pixi.js';
import type { ShellHost, ShellLayer } from '../context';
import type { ReplayModalOptions } from '../types';
import { makeText } from '../text';
import { CardModal } from '../primitives/card';
import { FlexBox } from '../primitives/flex';

/** Non-dismissable replay summary — label/value rows, accented total-win row. The only way out is
 *  START REPLAY, which closes the modal, runs `onReplay`, then reopens it (whether it resolves or
 *  rejects, so a failed replay can't strand the user). */
export function buildReplayModal(host: ShellHost, opts: ReplayModalOptions): ShellLayer {
  const { bonusId, bet, payoutMultiplier } = opts;
  const bonus = Array.isArray(host.config.features.buyBonus)
    ? host.config.features.buyBonus.find((b) => b.id === bonusId)
    : undefined;
  const mode = bonus?.title ?? bonusId;
  const costMultiplier = bonus?.priceMultiplier ?? 1;

  const modal = new CardModal(host, { tag: 'replay-modal', title: host.t('Replay'), closable: false });
  const em = modal.emSize;
  const innerW = modal.cardWidth - 2.4 * em;

  const rows = new FlexBox({ direction: 'column', align: 'stretch', gap: 0 });
  const addRow = (label: string, value: string, total = false): void => {
    if (rows.measureSize().h > 0) rows.add(hairline(host, innerW)); // border-top between rows
    const row = new FlexBox({
      direction: 'row',
      align: 'center',
      justify: 'space-between',
      padding: { top: 0.73 * em, bottom: 0.73 * em },
    });
    row.add(
      makeText(host.t(label), {
        size: (total ? 0.8 : 0.73) * em,
        weight: '700',
        color: total ? '#ffffff' : host.tokens.plaqueLabel,
        letterSpacing: 0.73 * em * 0.07,
        upper: true,
      }),
    );
    row.add(
      makeText(value, {
        size: (total ? 1.27 : 1) * em,
        weight: '800',
        color: total ? host.tokens.accent : '#ffffff',
      }),
    );
    rows.add(row);
  };

  addRow('Mode', mode);
  addRow('Base bet', host.fmt(bet));
  addRow('Cost multiplier', `${costMultiplier}×`);
  addRow('Total cost', host.fmt(bet * costMultiplier));
  addRow('Win multiplier', `${payoutMultiplier}×`);
  addRow('Total win', host.fmtWin(payoutMultiplier * bet), true);
  modal.body.add(rows);

  modal.setActions([
    {
      label: host.t('Start replay'),
      kind: 'accent',
      onTap: () => {
        host.closeLayer();
        const reopen = (): void => host.openReplay(opts);
        Promise.resolve(opts.onReplay()).then(reopen, reopen);
      },
    },
  ]);
  modal.build();
  return modal;
}

function hairline(host: ShellHost, width: number): Graphics {
  const g = new Graphics();
  g.rect(0, 0, width, 1).fill(host.tokens.plaqueLine);
  return g;
}
