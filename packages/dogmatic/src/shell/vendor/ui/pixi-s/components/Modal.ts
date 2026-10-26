import type { PixiComponentContext, ShellLayer } from '../../pixi/context';
import type { ModalOptions } from '../../../core/types';
import type { CardAction } from '../../pixi-hb/primitives/card';
import { SCardModal } from '../primitives/card';
import { sBody } from '../text';
import { S } from '../theme';

/** The generic externally-triggered modal in the S look — title plate, centred body copy, S action
 *  buttons. Each action runs its `on`, then closes; the ✕ shows when `availableClose`. */
export function buildSModal(host: PixiComponentContext, opts: ModalOptions): ShellLayer {
  const modal = new SCardModal(host, {
    tag: 'modal',
    title: opts.title,
    closable: opts.availableClose,
    blur: opts.blurLevel,
    onClose: () => host.closeLayer(),
  });
  const em = modal.emSize;
  modal.body.add(sBody(opts.body, 0.93 * em, S.fg, modal.cardWidth - 2.4 * em, 'center'));
  if (opts.actions?.length) {
    const actions: CardAction[] = opts.actions.map((a) => ({
      label: a.title,
      kind: a.color === 'red' ? 'red' : a.color ? 'accent' : 'ghost',
      onTap: () => {
        a.on?.();
        host.closeLayer();
      },
    }));
    modal.setActions(actions);
  }
  modal.build();
  return modal;
}
