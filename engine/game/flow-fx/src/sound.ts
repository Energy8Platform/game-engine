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
 *
 * `category` (`sfx`/`music`) and `fade` (ms) hook this node into the row's
 * shared `AudioState` (`./audio-state.ts`, one per row, also handed to
 * `audio` — see `./runtime.ts`): a play starts at `volume × categoryVolume`
 * (ramped up from 0 over `fade` ms when `fade > 0`) and registers its
 * instance so a later `audio` node's category change ramps it too; a stop
 * with `fade` ramps the instance down to 0 first, THEN calls the real
 * `stop()` — same as before when `fade` is 0.
 */
import { Sound } from '@pixi/sound';
import Schema from 'schemastery';
import type { FlowNodeKind } from '@energy8engine/flow';
// For the `asset` schema-meta augmentation (`Schema.Meta.asset`) — brought
// in by any import from `@energy8engine/scenes`; `tween.ts`'s own import
// of it already does this for the whole package, this one is belt braces.
import type {} from '@energy8engine/scenes';
import type { AudioState } from './audio-state';

/** What `SoundLike.play()` hands back — enough for a fade to ramp it and for `dispose`/`stop` bookkeeping to hear it end. */
export interface SoundInstance {
  volume: number;
  stop(): void;
  on?(event: 'end' | 'stop', fn: () => void): void;
}

export interface SoundLike {
  play(o: {
    loop: boolean;
    volume: number;
    complete?: () => void;
  }): SoundInstance | Promise<SoundInstance>;
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
  category: 'sfx' | 'music';
  /** Ramp duration, milliseconds — fades in on play, out (then stops) on stop. */
  fade: number;
}

export interface SoundDeps {
  from?: (url: string) => SoundLike;
}

/** A row's own `dispose()`, alongside the plain `FlowNodeKind` the registry wants. */
export interface SoundKind extends FlowNodeKind<SoundProps> {
  /** Destroys every cached `Sound`; the runtime's `ctx.effect` disposer calls this. */
  dispose(): void;
}

/** One currently-playing instance for a `src`, and how to untrack it from `state` early (a manual stop, ahead of its own 'end'/'stop' event). */
interface Playing {
  instance: SoundInstance;
  untrack: () => void;
  /** Set only while a `wait: true` play for this `src` is pending — a later faded stop resolves it once silent, same as a natural `complete` would. */
  resolveWait?: () => void;
}

export function createSound(state: AudioState, deps: SoundDeps = {}): SoundKind {
  // No `preload`: `Sound.from({ url, preload: true })` starts loading on its
  // own, and this node's own `play()` right after starts it AGAIN — loaded
  // and played twice. `play()` alone both loads (if needed) and plays.
  const from = deps.from ?? ((url: string) => Sound.from({ url }) as unknown as SoundLike);
  const cache = new Map<string, SoundLike>();
  const playing = new Map<string, Playing>();
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
      category: Schema.union(['sfx', 'music'])
        .default('sfx')
        .description('mix bus this sound ducks with (see `audio`)'),
      fade: Schema.number()
        .default(0)
        .description('ramp duration, milliseconds — fades in on play, out (then stops) on stop'),
    }) as Schema<SoundProps>,
    outs: ['next'],
    async run(p, { signal, report }) {
      const src = p.src;
      if (!src) {
        report('sound has no src');
        return { out: 'next' };
      }
      if (p.action === 'stop') {
        const s = cache.get(src);
        if (!s) return { out: 'next' };
        const entry = playing.get(src);
        playing.delete(src);
        entry?.untrack();
        const finish = () => {
          s.stop();
          entry?.resolveWait?.();
        };
        if (p.fade > 0 && entry) state.ramp(entry.instance, entry.instance.volume, 0, p.fade, finish);
        else finish();
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
        const target = p.volume * state.categoryVolume(p.category);
        const startVolume = p.fade > 0 ? 0 : target;
        // Registers the settled instance (`playing`/`state.track`), and —
        // for a fade — starts the 0→target ramp. Shared by both the
        // fire-and-forget and `wait: true` branches below.
        const track = (instance: SoundInstance): Playing => {
          const untrack = state.track(p.category, p.volume, instance);
          const entry: Playing = { instance, untrack };
          playing.set(src, entry);
          if (p.fade > 0) state.ramp(instance, 0, target, p.fade);
          return entry;
        };
        if (!wait) {
          // Fire-and-forget, but `play()` can still reject (a 404, a decode
          // failure) before anything has loaded — `void` alone would drop
          // that as an unhandled rejection. `report` still works after
          // `run` has already returned `next`.
          Promise.resolve(s.play({ loop: p.loop, volume: startVolume }))
            .then((instance) => track(instance))
            .catch((e: unknown) => {
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
            // Already stopped before this node's turn (as `tween` checks): nothing to play.
            if (signal.aborted) return reject(signal.reason);
            const instance = s.play({
              loop: p.loop,
              volume: startVolume,
              complete: () => resolve(),
            });
            onAbort = () => {
              void Promise.resolve(instance).then((i) => i.stop());
              reject(signal.reason);
            };
            // `play()` returns `IMediaInstance | Promise<IMediaInstance>` — a
            // rejecting instance promise (load failure) neither completes nor
            // aborts on its own, and the node would otherwise hang silently
            // to the interpreter's timeout; forward that rejection here, and
            // track the settled instance for fades/a later faded stop.
            Promise.resolve(instance).then((i) => {
              track(i).resolveWait = resolve;
            }, reject);
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
      playing.clear();
    },
  };
}
