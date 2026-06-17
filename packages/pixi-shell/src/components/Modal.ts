import type { ShellHost, ShellLayer } from '../context';
import type { ModalOptions } from '../types';
import { makeText } from '../text';
import { CardModal, type CardAction } from '../primitives/card';

/** Generic externally-triggered modal — title + body text + optional action buttons. Each action
 *  runs its `on` then closes; the ✕ shows when `availableClose`. */
export function buildModal(host: ShellHost, opts: ModalOptions): ShellLayer {
  const modal = new CardModal(host, {
    tag: 'modal',
    title: opts.title,
    closable: opts.availableClose,
    blur: opts.blurLevel,
    onClose: () => host.closeLayer(),
  });
  const em = modal.emSize;
  const text = makeText(opts.body, {
    size: 0.93 * em,
    weight: '400',
    color: 'rgba(255,255,255,.85)',
    align: 'center',
    wrapWidth: modal.cardWidth - 2.4 * em,
    lineHeight: 0.93 * em * 1.5,
  });
  modal.body.add(text);

  if (opts.actions?.length) {
    const actions: CardAction[] = opts.actions.map((a) => ({
      label: a.title,
      kind: a.color ? a.color : 'ghost',
      onTap: () => {
        a.on?.();
        host.closeLayer();
      },
    }));
    modal.setActions(actions);
  }
  modal.build();
  // approximate per-action ink for explicit colours (accent/ghost handled by CardModal)
  void contrastText;
  return modal;
}
