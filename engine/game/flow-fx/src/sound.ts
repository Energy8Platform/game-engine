/**
 * `sound`: plays (or stops) a file through `@pixi/sound`. One `Sound` per
 * `src` is cached in the closure and reused across runs/nodes that share a
 * path — `createSound` is called once per `apply` (see `./runtime.ts`), so
 * the cache lives exactly as long as the row does; `dispose()` is that
 * row's `ctx.effect` teardown, destroying whatever got cached.
 *
 * Static `import { Sound } from '@pixi/sound'` on purpose, not a lazy
 * `await import`: this row is never composed on the host (Node, no
 * `document`) — only in the browser game, where `@pixi/sound` works fine.
 */
import { Sound } from '@pixi/sound';
import Schema from 'schemastery';
import type { FlowNodeKind } from '@energy8engine/flow';
// For the `asset` schema-meta augmentation (`Schema.Meta.asset`) — brought
// in by any import from `@energy8engine/scenes`; `tween.ts`'s own import
// of it already does this for the whole package, this one is belt braces.
import type {} from '@energy8engine/scenes';

export interface SoundLike {
  play(o: { loop: boolean; volume: number; complete?: () => void }): unknown | Promise<unknown>;
  stop(): void;
  destroy(): void;
}

export interface SoundProps {
  src?: string;
  action: 'play' | 'stop';
  loop: boolean;
  volume: number;
  /** Wait for the sound to finish before leaving by `next`. */
  wait: boolean;
}

export interface SoundDeps {
  from?: (url: string) => SoundLike;
}

/** A row's own `dispose()`, alongside the plain `FlowNodeKind` the registry wants. */
export interface SoundKind extends FlowNodeKind<SoundProps> {
  /** Destroys every cached `Sound`; the runtime's `ctx.effect` disposer calls this. */
  dispose(): void;
}

export function createSound(deps: SoundDeps = {}): SoundKind {
  const from =
    deps.from ?? ((url: string) => Sound.from({ url, preload: true }) as unknown as SoundLike);
  const cache = new Map<string, SoundLike>();
  return {
    kind: 'sound',
    schema: Schema.object({
      src: Schema.string()
        .extra('asset', ['mp3', 'ogg', 'wav', 'm4a'])
        .description('audio path, project-relative'),
      action: Schema.union(['play', 'stop']).default('play'),
      loop: Schema.boolean().default(false),
      volume: Schema.number().default(1),
      wait: Schema.boolean()
        .default(false)
        .description('wait for the sound to finish before leaving by `next`'),
    }) as Schema<SoundProps>,
    outs: ['next'],
    async run(p, { signal, report }) {
      const src = p.src;
      if (!src) {
        report('sound has no src');
        return { out: 'next' };
      }
      if (p.action === 'stop') {
        cache.get(src)?.stop();
        return { out: 'next' };
      }
      try {
        const s = cache.get(src) ?? from('/' + src);
        cache.set(src, s);
        if (!p.wait) {
          void s.play({ loop: p.loop, volume: p.volume });
          return { out: 'next' };
        }
        await new Promise<void>((resolve, reject) => {
          const instance = s.play({
            loop: p.loop,
            volume: p.volume,
            complete: () => {
              signal.removeEventListener('abort', onAbort);
              resolve();
            },
          });
          const onAbort = () => {
            void Promise.resolve(instance).then((i) =>
              (i as { stop?: () => void } | undefined)?.stop?.(),
            );
            reject(signal.reason);
          };
          signal.addEventListener('abort', onAbort, { once: true });
        });
      } catch (e) {
        report(`sound ${src}: ${e instanceof Error ? e.message : String(e)}`);
      }
      return { out: 'next' };
    },
    dispose() {
      for (const s of cache.values()) s.destroy();
      cache.clear();
    },
  };
}
