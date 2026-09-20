/**
 * Runtime half of `flow-fx` — the `fx1` row in `e8-base`, listed BEFORE
 * `flow1` on purpose (see that bundle's comment on the row): it stays
 * PENDING (`inject: ['flowNodes']`) until `flow1` provides the registry,
 * but going first means its own — heavier — module import finishes before
 * `flow1`'s boot GET can even start, so `tween`/`sound`/`audio` are
 * registered the instant `flow1` applies, not racing it. Each registration
 * is an effect: dispose takes the kind back — `sound`'s also destroys
 * whatever `Sound`s it cached (see `./sound.ts`'s doc comment).
 *
 * `sound` and `audio` share ONE `AudioState` (`./audio-state.ts`) per row —
 * categories/live instances/ramps — created here and handed to both
 * factories, so a `sound` node's plays and an `audio` node's category
 * change see each other. The `flow-fx:sound` disposer stops its ramps too
 * (`state.dispose()`), alongside destroying the cache.
 */
import type { Context } from 'cordis';
// For the `flowNodes` augmentation of `Context` alone; the flow runtime
// itself is a separate row (`flow1`).
import type {} from '@energy8engine/flow/runtime';
import { createTween } from './tween';
import { createSound } from './sound';
import { createAudio } from './audio';
import { createAudioState } from './audio-state';

export const name = 'flow-fx';
export const inject = ['flowNodes'];

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.flowNodes.register(createTween()), 'flow-fx:tween');
  const state = createAudioState();
  const sound = createSound(state);
  ctx.effect(() => {
    const off = ctx.flowNodes.register(sound);
    return () => {
      off();
      sound.dispose();
      state.dispose();
    };
  }, 'flow-fx:sound');
  ctx.effect(() => ctx.flowNodes.register(createAudio(state)), 'flow-fx:audio');
}
