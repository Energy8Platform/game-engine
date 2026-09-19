/**
 * The node-type registry: what a scene document's `type` strings resolve
 * to. Last-wins, so a project plugin (or a hot re-apply) can replace a
 * built-in; subscribers hear every change and remount what used it.
 */
import type { Context } from 'cordis';
import { Color, type Container } from 'pixi.js';
import type Schema from 'schemastery';
import type { NodeTypeAccept } from '@energy8engine/contracts';
import { createRegistry } from '@energy8engine/registry';
import { COMMON } from './common-schema';

export { COMMON };
export type { NodeTypeAccept };

declare global {
  namespace Schemastery {
    interface Meta<T> {
      /** IDE hint: this string field holds a project-relative asset path with one of these extensions. */
      asset?: string[];
    }
  }
}

export interface NodeType<P = Record<string, unknown>> {
  type: string;
  /** Own props only; the common ones (`COMMON`) are the runtime's. */
  schema: Schema<P>;
  mount(props: P, ctx: Context): Container;
  /** Re-syncs the view from `ctx`/the loader (after a load or an unload); `props` may be unchanged. */
  update?(view: Container, props: P, ctx: Context): void;
  /** Plays the view's media once and resolves when it finishes; a view not yet filled in (asset still loading) resolves at once — the runtime never remounts to retry. */
  once?(view: Container, props: P, ctx: Context): Promise<void>;
  /** The runtime never destroys a view it did not build; `unmount` is the type's chance to detach its own. */
  unmount?(view: Container): void;
  /** Project-relative paths this node needs loaded before it shows. */
  assets?(props: P): string[];
  /** Which files this type takes, and which single prop holds the path — the IDE's drop/pick target. */
  accept?: NodeTypeAccept;
  /** Every prop (may be more than `accept.prop`) that holds a project-relative asset path. */
  assetProps?: string[];
}

export interface NodeTypesService {
  /** Last-wins; notifies. The disposer takes back only its own registration. */
  register(t: NodeType<any>): () => void;
  get(type: string): NodeType | undefined;
  list(): NodeType[];
  subscribe(listener: () => void): () => void;
}

export function createNodeTypes(): NodeTypesService {
  const registry = createRegistry<NodeType>({ policy: 'last-wins' });
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((fn) => fn());
  return {
    register(t) {
      const off = registry.add(t.type, t);
      notify();
      return () => {
        off();
        notify();
      };
    },
    get: (type) => registry.get(type),
    list: () => registry.keys().map((k) => registry.get(k)!),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/**
 * `props` minus the `width`/`height` the TYPE declares itself: one YAML
 * key must not both redraw the geometry and rescale the view, so where a
 * type owns the name (`shape`, where the pair IS the rectangle), the
 * common pass leaves that axis alone.
 */
function commonOf(props: Record<string, unknown>, type?: NodeType<any>): Record<string, unknown> {
  const dict = (type?.schema as unknown as { dict?: Record<string, unknown> } | undefined)?.dict;
  if (!dict || (!dict.width && !dict.height)) return props;
  const out = { ...props };
  if (dict.width) delete out.width;
  if (dict.height) delete out.height;
  return out;
}

/**
 * Applies `COMMON` (defaults filled in) to a view. The optional props are
 * applied only when actually set: `width`/`height` AFTER `scale`, because
 * each overrides that axis' scale from the view's own local bounds;
 * `tint` only where the view has one; `anchorX`/`anchorY` per axis over
 * `anchor`, only where the view has an anchor at all.
 *
 * `type` is the node's own type when the caller has one: its schema says
 * which of `width`/`height` are the TYPE's (`commonOf`), and those the
 * common pass skips.
 *
 * Returns the common dict it applied — `mask` is the runtime's to act on,
 * and reading it here is reading the values that actually validated,
 * stripping included.
 */
export function applyCommon(
  view: Container,
  props: Record<string, unknown>,
  type?: NodeType<any>,
): Record<string, number | string | boolean | undefined> {
  const c = COMMON(commonOf(props, type) as never) as Record<
    string,
    number | string | boolean | undefined
  >;
  view.position.set(c.x as number, c.y as number);
  view.scale.set(c.scale as number);
  if (typeof c.width === 'number') view.width = c.width;
  if (typeof c.height === 'number') view.height = c.height;
  view.rotation = c.rotation as number;
  view.alpha = c.alpha as number;
  view.visible = c.visible as boolean;
  // `Color`, not a hand-rolled `parseInt`: it takes `#rgb` and the named
  // colours too, and THROWS on a value that is neither — which `mountNode`
  // already turns into this node's own diagnostic, same as `x: 'abc'`.
  if (typeof c.tint === 'string' && 'tint' in view)
    (view as unknown as { tint: number }).tint = new Color(c.tint).toNumber();
  const anchored = view as unknown as { anchor?: { set(x: number, y: number): void } };
  if (anchored.anchor && typeof anchored.anchor.set === 'function')
    anchored.anchor.set((c.anchorX ?? c.anchor) as number, (c.anchorY ?? c.anchor) as number);
  return c;
}
