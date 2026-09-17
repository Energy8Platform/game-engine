import type { Context } from 'cordis';
import { ScenesSidebar } from '../shell/ScenesSidebar';

/**
 * The Scenes sidebar as a contribution — the same two registrations under
 * one key that `App` makes for the Explorer: a button on the activity bar
 * and the sidebar view it shows. Registered as effects so disposing this
 * fiber takes the view back. `inject` names every service the view reads
 * through this ctx — cordis refuses the rest.
 */
export const name = 'scenes';
export const inject = ['slots', 'gameComposition', 'gameDiagnostics'];

export function apply(ctx: Context) {
  ctx.effect(
    () =>
      ctx.slots.register({
        name: 'shell.activity',
        key: 'scenes',
        title: 'Scenes',
        icon: 'layers',
        order: 35,
        opens: 'sidebar',
      }),
    'scenes:activity',
  );
  ctx.effect(
    () =>
      ctx.slots.register(
        { name: 'shell.sidebar', key: 'scenes', title: 'Scenes' },
        function ScenesView() {
          return <ScenesSidebar ctx={ctx} />;
        },
      ),
    'scenes:sidebar',
  );
}
