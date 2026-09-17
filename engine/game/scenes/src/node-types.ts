/**
 * The node-type registry: what a scene document's `type` strings resolve
 * to. Last-wins, so a project plugin (or a hot re-apply) can replace a
 * built-in; subscribers hear every change and remount what used it.
 */
import type { Context } from 'cordis';
import type { Container } from 'pixi.js';
import type Schema from 'schemastery';
import { createRegistry } from '@energy8engine/registry';
import { COMMON } from './common-schema';

export { COMMON };

export interface NodeType<P = Record<string, unknown>> {
  type: string;
  /** Own props only; the common ones (`COMMON`) are the runtime's. */
  schema: Schema<P>;
  mount(props: P, ctx: Context): Container;
  /** Re-syncs the view from `ctx`/the loader (after a load or an unload); `props` may be unchanged. */
  update?(view: Container, props: P, ctx: Context): void;
  /** The runtime never destroys a view it did not build; `unmount` is the type's chance to detach its own. */
  unmount?(view: Container): void;
  /** Project-relative paths this node needs loaded before it shows. */
  assets?(props: P): string[];
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

/** Applies `COMMON` (defaults filled in) to a view; `anchor` only where the view has one. */
export function applyCommon(view: Container, props: Record<string, unknown>): void {
  const c = COMMON(props as never) as Record<string, number | boolean>;
  view.position.set(c.x as number, c.y as number);
  view.scale.set(c.scale as number);
  view.rotation = c.rotation as number;
  view.alpha = c.alpha as number;
  view.visible = c.visible as boolean;
  const anchored = view as unknown as { anchor?: { set(v: number): void } };
  if (anchored.anchor && typeof anchored.anchor.set === 'function')
    anchored.anchor.set(c.anchor as number);
}
