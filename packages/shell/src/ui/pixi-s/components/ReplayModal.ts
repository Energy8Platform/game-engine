import type { PixiComponentContext, ShellLayer } from '../../pixi/context';
import type { ReplayModalOptions } from '@/core/types';
import { FlexBox } from '../../pixi/primitives/flex';
import { SCardModal } from '../primitives/card';
import { sLabel, sValue } from '../text';
import { S } from '../theme';

/** Non-dismissable replay summary in the S look — label / value rows (no hairlines), the total win in
 *  yellow. The only way out is START REPLAY, which closes the modal, runs `onReplay`, then reopens it
 *  whether it resolves or rejects (so a failed replay can't strand the user). */
export function buildSReplayModal(host: PixiComponentContext, opts: ReplayModalOptions, reopen: () => void): ShellLayer {
  const { bonusId, bet, payoutMultiplier } = opts;
  const bonus = Array.isArray(host.config.features.buyBonus)
    ? host.config.features.buyBonus.find((b) => b.id === bonusId)
    : undefined;
  const mode = bonus?.title ?? bonusId;
  const costMultiplier = bonus?.priceMultiplier ?? 1;

  const modal = new SCardModal(host, { tag: 'replay-modal', title: host.t('Replay'), closable: false });
  const em = modal.emSize;
  const innerW = modal.cardWidth - 2.4 * em;
  const rows = new FlexBox({ direction: 'column', align: 'stretch', gap: 0 });
  const addRow = (label: string, value: string, total = false): void => {
    const row = new FlexBox({
      direction: 'row',
      align: 'center',
      justify: 'space-between',
      width: innerW,
      padding: { top: 0.73 * em, bottom: 0.73 * em },
    });
    row.add(sLabel(host.t(label), (total ? 0.8 : 0.73) * em, total ? S.fg : S.muted));
    row.add(sValue(value, (total ? 1.27 : 1) * em, total ? S.yellow : S.fg));
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
        Promise.resolve(opts.onReplay()).then(reopen, reopen);
      },
    },
  ]);
  modal.build();
  return modal;
}
