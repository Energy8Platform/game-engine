/**
 * Runtime half of `node-spine` — the `spine1` row in `e8-base`, right
 * after `media1`, whose `nodeTypes` it needs (hence `inject`). The one
 * registration is an effect: dispose takes the type back.
 */
import type { Context } from 'cordis';
// For the `nodeTypes` augmentation of `Context` alone; the scenes runtime itself is a separate row.
import type {} from '@energy8engine/scenes/runtime';
import { spine } from './spine';

export const name = 'node-spine';
export const inject = ['nodeTypes'];

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.nodeTypes.register(spine), 'node-spine:spine');
}
