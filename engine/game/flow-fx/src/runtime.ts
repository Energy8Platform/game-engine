/**
 * Runtime half of `flow-fx` — the `fx1` row in `e8-base`, right after
 * `flow1`, whose `flowNodes` registry it needs (hence `inject`). Each
 * registration is an effect: dispose takes the kind back — `sound`'s also
 * destroys whatever `Sound`s it cached (see `./sound.ts`'s doc comment).
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
