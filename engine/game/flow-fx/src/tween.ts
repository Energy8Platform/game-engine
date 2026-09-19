/**
 * `tween`: moves a scene node's `x`/`y`/`alpha`/`rotation`/`scale` through
 * the legacy `Tween` (`@energy8platform/game-engine/animation`) — the same
 * promise-based, PixiJS-ticker-driven engine the rest of the engine
 * animates with, no GSAP.
 *
 * `target` is `<scene>/<node>` (a `SceneRef` packed into one string, the
 * way a flow prop has to be); `scenes.view()` answers the live pixi
 * `Container` for it (Task 1's nested-node lookup included). A target not
 * currently on stage is not thrown — it is a diagnostic on the node
 * (`report`), same as a flow that names a service nothing provides.
 */
import { Easing, Tween } from '@energy8platform/game-engine/animation';
import Schema from 'schemastery';
import type { ScenesService } from '@energy8engine/scenes';
import type { FlowNodeKind } from '@energy8engine/flow';

export interface TweenProps {
  /** `<scene>/<node>` — the node to animate. */
  target: string;
  ms: number;
  easing: string;
  /** `false`: fire the tween and leave by `next` at once, without waiting for it. */
  wait: boolean;
  x?: number;
  y?: number;
  alpha?: number;
  /** Radians — the scene's own rotation unit. */
  rotation?: number;
  scale?: number;
}

const EASINGS = Object.keys(Easing).filter(
  (k) => typeof Easing[k as keyof typeof Easing] === 'function',
);

/** Resolves once `signal` aborts, rejecting with its reason — never resolves otherwise. */
function aborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) return reject(signal.reason);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

export interface TweenDeps {
  to?: typeof Tween.to;
  kill?: typeof Tween.killTweensOf;
}

export function createTween(deps: TweenDeps = {}): FlowNodeKind<TweenProps> {
  const to = deps.to ?? Tween.to;
  const kill = deps.kill ?? Tween.killTweensOf;
  return {
    kind: 'tween',
    schema: Schema.object({
      target: Schema.string().required().description('<scene>/<node> to animate'),
      ms: Schema.number().required().description('duration, milliseconds'),
      easing: Schema.union(EASINGS).default('linear'),
      wait: Schema.boolean()
        .default(true)
        .description('wait for the tween to finish before leaving by `next`'),
      x: Schema.number(),
      y: Schema.number(),
      alpha: Schema.number(),
      rotation: Schema.number().description('radians'),
      scale: Schema.number(),
    }) as Schema<TweenProps>,
    outs: ['next'],
    async run(p, { ctx, signal, report }) {
      const [scene, ...rest] = p.target.split('/');
      const node = rest.join('/');
      const view = (ctx.reflect.get('scenes', false) as ScenesService | undefined)?.view({
        scene,
        node,
      });
      if (!view) {
        report(`node ${p.target} is not on stage`);
        return { out: 'next' };
      }
      const props: Record<string, number> = {};
      if (p.x !== undefined) props.x = p.x;
      if (p.y !== undefined) props.y = p.y;
      if (p.alpha !== undefined) props.alpha = p.alpha;
      if (p.rotation !== undefined) props.rotation = p.rotation;
      if (p.scale !== undefined) {
        props['scale.x'] = p.scale;
        props['scale.y'] = p.scale;
      }
      if (Object.keys(props).length === 0) {
        report('tween has nothing to animate');
        return { out: 'next' };
      }
      const done = to(view, props, p.ms, Easing[p.easing as keyof typeof Easing]);
      if (p.wait === false) return { out: 'next' };
      try {
        await Promise.race([done, aborted(signal)]);
      } catch (e) {
        kill(view);
        throw e;
      }
      return { out: 'next' };
    },
  };
}
