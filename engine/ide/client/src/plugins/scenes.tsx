import type { Context } from 'cordis';
import { ScenesScreen } from '../screens/ScenesScreen';

/**
 * The Scenes screen as a contribution — the same two registrations under
 * one key that `engine/examples/first-slot/plugins/screen-demo` makes: a
 * button on the activity bar and the document it opens. Registered as
 * effects so disposing this fiber takes the tab back.
 */
export const name = 'scenes';
export const inject = ['slots', 'gameComposition'];

export function apply(ctx: Context) {
  ctx.effect(
    () =>
      ctx.slots.register({
        name: 'shell.activity',
        key: 'scenes',
        title: 'Scenes',
        icon: 'layers',
        order: 35,
        opens: 'document',
      }),
    'scenes:activity',
  );
  ctx.effect(
    () =>
      ctx.slots.register(
        { name: 'shell.document', key: 'scenes', title: 'Scenes', closable: true },
        function ScenesDocument() {
          return <ScenesScreen ctx={ctx} />;
        },
      ),
    'scenes:document',
  );
}
