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
  // No `preload`: `Sound.from({ url, preload: true })` starts loading on its
  // own, and this node's own `play()` right after starts it AGAIN — loaded
  // and played twice. `play()` alone both loads (if needed) and plays.
  const from = deps.from ?? ((url: string) => Sound.from({ url }) as unknown as SoundLike);
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
        // A looping sound never fires `complete` — `wait` would hang the
        // node to the interpreter's own 30 s timeout for nothing useful.
        let wait = p.wait;
        if (wait && p.loop) {
          report('a looping sound never completes; wait ignored', 'warning');
          wait = false;
        }
        if (!wait) {
          // Fire-and-forget, but `play()` can still reject (a 404, a decode
          // failure) before anything has loaded — `void` alone would drop
          // that as an unhandled rejection. `report` still works after
          // `run` has already returned `next`.
          Promise.resolve(s.play({ loop: p.loop, volume: p.volume })).catch((e: unknown) => {
            report(`sound ${src}: ${e instanceof Error ? e.message : String(e)}`);
          });
          return { out: 'next' };
        }
        // `onAbort` lives outside the executor and is torn down in ONE place
        // (the `finally` below) regardless of which of the three ways the
        // await settles — `complete`, the abort itself, or the instance
        // promise's own rejection forwarded below. Left to each branch to
        // remove it individually, the rejection path had no removal at all:
        // `signal` is the interpreter's shared epoch signal, so every failed
        // `wait: true` play leaked one listener on it for the rest of the run.
        let onAbort: (() => void) | undefined;
        try {
          await new Promise<void>((resolve, reject) => {
            const instance = s.play({
              loop: p.loop,
              volume: p.volume,
              complete: () => resolve(),
            });
            onAbort = () => {
              void Promise.resolve(instance).then((i) =>
                (i as { stop?: () => void } | undefined)?.stop?.(),
              );
              reject(signal.reason);
            };
            // `play()` returns `IMediaInstance | Promise<IMediaInstance>` — a
            // rejecting instance promise (load failure) neither completes nor
            // aborts on its own, and the node would otherwise hang silently
            // to the interpreter's timeout; forward that rejection here.
            Promise.resolve(instance).then(undefined, reject);
            signal.addEventListener('abort', onAbort, { once: true });
          });
        } finally {
          if (onAbort) signal.removeEventListener('abort', onAbort);
        }
      } catch (e) {
        // An abort mid-wait is the interpreter's own contract (`stop()` /
        // `replace()`) — it already suppresses a rejection once `signal` is
        // aborted (`interpreter.ts`'s `step`), same as `tween`'s. Reporting
        // it here too would paint a red diagnostic on a node that was only
        // ever stopped on purpose; any OTHER failure (404, decode) still
        // needs to be said out loud.
        if (signal.aborted) throw e;
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
