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

/** Just the basename's extension, lower-cased; `undefined` for no dot or a dotfile ("no real extension"). */
export function extOf(path: string): string | undefined {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return undefined; // no dot, or dot is the basename's first char (".hidden")
  return base.slice(dot + 1).toLowerCase();
}

/** A fresh wrapper per registration, so a disposer removes the SLOT it created — never a same-value stranger's. */
interface Slot {
  def: AssetNodeType;
}

export function apply(ctx: Context) {
  // `@energy8engine/registry`'s createRegistry disposer removes only what it
  // added — a same-id replace has nothing to fall back to when disposed. A
  // small per-id stack gets both last-wins *and* restore-on-dispose: push on
  // register, splice out on dispose, current = top of stack.
  const stacks = new Map<string, Slot[]>();
  const order: string[] = [];

  const current = (id: string): AssetNodeType | undefined => {
    const stack = stacks.get(id);
    return stack?.[stack.length - 1]?.def;
  };

  const service: AssetNodeTypesService = {
    register(id, def) {
      let stack = stacks.get(id);
      if (!stack) {
        stack = [];
        stacks.set(id, stack);
        order.push(id);
      }
      const slot: Slot = { def };
      stack.push(slot);
      return () => {
        // Identity, not value: two registrations can share the same `def`
        // (or an equal-by-value one), and indexOf(def) would find whichever
        // comes first — including an already-disposed slot's spot.
        const i = stack!.indexOf(slot);
        if (i !== -1) stack!.splice(i, 1);
      };
    },
    pick(path) {
      const ext = extOf(path);
      if (!ext) return undefined;
      for (const id of order) {
        const def = current(id);
        if (def?.extensions.some((e) => e.toLowerCase() === ext)) return def;
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
