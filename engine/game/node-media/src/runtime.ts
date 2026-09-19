/**
 * Runtime half of `node-media` — the `media1` row in `e8-base`, right
 * after `scenes1`, whose `nodeTypes` it needs (hence `inject`). Each
 * registration is an effect: dispose takes the four types back.
 */
import type { Context } from 'cordis';
// For the `nodeTypes` augmentation of `Context` alone; the scenes runtime itself is a separate row.
import type {} from '@energy8engine/scenes/runtime';
import { gif } from './gif';
import { spritesheet } from './spritesheet';
import { strip } from './strip';
import { video } from './video';

export const name = 'node-media';
export const inject = ['nodeTypes'];

export function apply(ctx: Context): void {
  for (const type of [spritesheet, strip, video, gif])
    ctx.effect(() => ctx.nodeTypes.register(type), `node-media:${type.type}`);
}
