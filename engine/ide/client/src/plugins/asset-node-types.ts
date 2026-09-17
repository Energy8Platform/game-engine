import type { Context } from 'cordis';

/** One way to turn a dropped asset file into a scene node. */
export interface AssetNodeType {
  extensions: string[];
  node(path: string, at: { x: number; y: number }): { type: string; props: Record<string, unknown> };
}

export interface AssetNodeTypesService {
  /** Same id again replaces (last-wins); the returned disposer restores whatever it replaced. */
  register(id: string, def: AssetNodeType): () => void;
  /** The current registration (by id) whose extensions include `path`'s, case-insensitively. */
  pick(path: string): AssetNodeType | undefined;
  /** In registration order (by id, not affected by a same-id replace). */
  list(): readonly { id: string; def: AssetNodeType }[];
}

declare module 'cordis' {
  interface Context {
    assetNodeTypes: AssetNodeTypesService;
  }
}

export const name = 'assetNodeTypes';

export function apply(ctx: Context) {
  // `@energy8engine/registry`'s createRegistry disposer removes only what it
  // added — a same-id replace has nothing to fall back to when disposed. A
  // small per-id stack gets both last-wins *and* restore-on-dispose: push on
  // register, splice out on dispose, current = top of stack.
  const stacks = new Map<string, AssetNodeType[]>();
  const order: string[] = [];

  const current = (id: string): AssetNodeType | undefined => {
    const stack = stacks.get(id);
    return stack?.[stack.length - 1];
  };

  const service: AssetNodeTypesService = {
    register(id, def) {
      let stack = stacks.get(id);
      if (!stack) {
        stack = [];
        stacks.set(id, stack);
        order.push(id);
      }
      stack.push(def);
      return () => {
        const i = stack!.indexOf(def);
        if (i !== -1) stack!.splice(i, 1);
      };
    },
    pick(path) {
      const ext = path.split('.').pop()?.toLowerCase();
      if (!ext) return undefined;
      for (const id of order) {
        const def = current(id);
        if (def?.extensions.includes(ext)) return def;
      }
      return undefined;
    },
    list() {
      const result: { id: string; def: AssetNodeType }[] = [];
      for (const id of order) {
        const def = current(id);
        if (def) result.push({ id, def });
      }
      return result;
    },
  };

  ctx.provide('assetNodeTypes', service);

  service.register('image', {
    extensions: ['png', 'jpg', 'jpeg', 'webp'],
    node: (src, { x, y }) => ({ type: 'image', props: { src, x, y, anchor: 0.5 } }),
  });
}
