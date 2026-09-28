import type { Context } from 'cordis';
import Schema from 'schemastery';
import {
  diagnostic,
  type NodeTypeInfo,
  type SymbolState,
  type SymbolsDoc,
} from '@energy8engine/contracts';
import { extOf } from '../plugins/asset-node-types';
import { addSymbol, EMPTY, nodeForDrop, setState } from './symbols-doc';

/** What an Explorer row puts on a drag: the file's project path. */
export const DROP_TYPE = 'text/x-e8-path';

/** Whether the type's props schema has a `loop` field — what a `win` turns off. */
function hasLoop(info: NodeTypeInfo | undefined): boolean {
  if (!info) return false;
  try {
    const schema = new Schema(info.schema as never) as unknown as {
      dict?: Record<string, unknown>;
    };
    return 'loop' in (schema.dict ?? {});
  } catch {
    return false;
  }
}

const stemOf = (path: string) => {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
};

/**
 * The symbols writes both the symbol list and the Symbols canvas make —
 * `say` is their status line: a refusal, a write's first diagnostic, or
 * `null` once a write went through clean.
 *
 * Every write is a REDUCER over the doc, queued through `ctx.symbols.update`
 * (shared with `SymbolsProperties`): each reduces `ctx.symbols.doc()` as it
 * stands when its turn comes — `EMPTY` when there is no symbols.yml yet, so
 * the first add creates the file — and PUTs unless nothing changed.
 *
 * A dropped file (`DROP_TYPE`) becomes a state's node, or a new symbol
 * named by the file's stem — any non-empty stem is a legal new id (a math
 * emits names as symbol ids too, so a name is first-class here); an empty
 * stem, or a stem already in the doc, is refused. The node comes from
 * `ctx.assetNodeTypes.pick` (the tree read so a sibling rule can see what
 * sits beside the file): its type, the prop it put the path in, and — for
 * `win` on a type whose schema has `loop` — `loop: false`.
 */
export function symbolWrites(ctx: Context, say: (line: string | null) => void) {
  const commit = (reduce: (doc: SymbolsDoc) => SymbolsDoc) =>
    ctx.symbols.update(reduce).then((answer) => {
      say(answer[0] ? `${answer[0].where} — ${answer[0].message}` : null);
    });

  const has = (id: string) => (ctx.symbols.doc() ?? EMPTY).symbols.some((s) => s.id === id);

  /** The dropped file as a node, or `undefined` (refused through `say` and reported). */
  const pickNode = async (path: string, state: SymbolState) => {
    const tree = await ctx.files.tree();
    for (const diag of tree.diagnostics) ctx.connection.report(diag);
    // A tree that could not be read whole says nothing about what is beside the file.
    const def = ctx.assetNodeTypes.pick(path, tree.diagnostics.length ? undefined : tree.entries);
    if (!def) {
      const ext = extOf(path);
      const warn = diagnostic(
        'warning',
        'symbols',
        path,
        ext ? `no node type for .${ext}` : `no node type for "${path}"`,
        'the game has not reported its node types yet (is the preview running?)',
      );
      ctx.connection.report(warn);
      say(warn.message);
      return undefined;
    }
    const { type, props } = def.node(path, { x: 0, y: 0 });
    const prop = Object.keys(props).find((k) => props[k] === path) ?? 'src';
    const info = ctx.scenes.nodeTypes().find((t) => t.type === type);
    return nodeForDrop({ type, prop, hasLoop: hasLoop(info) }, path, state);
  };

  return {
    commit,
    has,
    /** `path` as symbol `id`'s `state`. */
    async dropState(id: string, state: SymbolState, path: string) {
      const node = await pickNode(path, state);
      if (node) void commit((d) => setState(d, id, state, node));
    },
    /** A new symbol named by `path`'s stem, `path` its static. */
    async dropNew(path: string) {
      const stem = stemOf(path);
      if (!stem) return say('drop onto a symbol');
      if (has(stem)) return say(`"${stem}" is already a symbol`);
      const node = await pickNode(path, 'static');
      if (!node) return;
      const k = ctx.symbols.known().find((k) => k.id === stem);
      void commit((d) => setState(addSymbol(d, stem, k?.name), stem, 'static', node));
    },
  };
}
