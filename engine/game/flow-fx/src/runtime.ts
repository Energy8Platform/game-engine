/**
 * Runtime half of `flow-fx` — the `fx1` row in `e8-base`, listed BEFORE
 * `flow1` on purpose (see that bundle's comment on the row): it stays
 * PENDING (`inject: ['flowNodes']`) until `flow1` provides the registry,
 * but going first means its own — heavier — module import finishes before
 * `flow1`'s boot GET can even start, so `tween`/`sound` are registered the
 * instant `flow1` applies, not racing it. Each registration is an effect:
 * dispose takes the kind back — `sound`'s also destroys whatever `Sound`s
 * it cached (see `./sound.ts`'s doc comment).
 */
import type { Context } from 'cordis';
// For the `flowNodes` augmentation of `Context` alone; the flow runtime
// itself is a separate row (`flow1`).
import type {} from '@energy8engine/flow/runtime';
import { createTween } from './tween';
import { createSound } from './sound';

export const name = 'flow-fx';
export const inject = ['flowNodes'];

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.flowNodes.register(createTween()), 'flow-fx:tween');
  const sound = createSound();
  ctx.effect(() => {
    const off = ctx.flowNodes.register(sound);
    return () => {
      off();
      sound.dispose();
    };
  }, 'flow-fx:sound');
}
