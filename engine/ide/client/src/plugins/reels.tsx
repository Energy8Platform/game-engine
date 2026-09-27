import type { Context } from 'cordis';
import { ReelsDocument } from '../shell/ReelsDocument';

/**
 * The Reels document: one activity + document key (`reels`), registered
 * ONLY while the game's composition has a `reels1` row — a project with no
 * reel grid placed has nothing this document could show (its sections are
 * `reels1`'s own config, split up; see `ReelsDocument`'s own comment), so
 * the activity button stays off rather than opening on a blank pane.
 *
 * `ctx.gameComposition.subscribe` is the only way to know: the boot GET
 * can still be in flight when this plugin composes (`rows` is `null`
 * until then — `hasReels1` reads that as absent), and a later patch or
 * bundle edit can add or drop the row at any point after. `dispose` is
 * both "currently registered" and the pair's own cleanup, so `sync` never
 * registers twice or unregisters what wasn't there.
 */
export const name = 'reels';
export const inject = ['gameComposition', 'slots'];

const hasReels1 = (ctx: Context) =>
  (ctx.gameComposition.rows ?? []).some((row) => row.id === 'reels1');

export function apply(ctx: Context) {
  let dispose: (() => void) | null = null;

  const sync = () => {
    const present = hasReels1(ctx);
    if (present === (dispose !== null)) return;
    if (present) {
      const offActivity = ctx.slots.register({
        name: 'shell.activity',
        key: 'reels',
        title: 'Reels',
        // `puzzle` — the icon set the shell ships (`Shell.tsx`'s
        // `ICON_PATHS`) has no grid glyph; this is the closest shape in
        // it to the sectioned board this document draws, and it isn't
        // spoken for by another activity yet.
        icon: 'puzzle',
        order: 38, // right after Symbols (37)
        opens: 'document',
      });
      const offDocument = ctx.slots.register(
        { name: 'shell.document', key: 'reels', title: 'Reels', closable: false },
        ReelsDocument,
      );
      dispose = () => {
        offActivity();
        offDocument();
      };
    } else {
      dispose?.();
      dispose = null;
    }
  };

  ctx.effect(() => {
    sync();
    const off = ctx.gameComposition.subscribe(sync);
    return () => {
      off();
      dispose?.();
      dispose = null;
    };
  }, 'reels:presence');
}
