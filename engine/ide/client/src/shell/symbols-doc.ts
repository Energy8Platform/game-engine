import type { SymbolDef, SymbolNode, SymbolState, SymbolsDoc } from '@energy8engine/contracts';

/**
 * The Symbols document's pure reducers — what `SymbolsDocument` and
 * `SymbolsProperties` write through. None mutate; each returns a new
 * document, or the SAME one when there is nothing to do (an unknown id, a
 * clear of a state that is not there), which is how `commit` knows to
 * skip the PUT.
 */
export const EMPTY: SymbolsDoc = { version: 1, symbols: [] };

export const STATES: readonly SymbolState[] = ['static', 'idle', 'win'];

/** What a fresh `static` is: an image with no file yet — the inspector shows what is missing. */
const emptyImage = (): SymbolNode => ({ type: 'image', props: { src: '' } });

function patch(doc: SymbolsDoc, id: string, f: (def: SymbolDef) => SymbolDef): SymbolsDoc {
  const i = doc.symbols.findIndex((s) => s.id === id);
  if (i < 0) return doc;
  const next = f(doc.symbols[i]);
  if (next === doc.symbols[i]) return doc;
  return { ...doc, symbols: doc.symbols.map((s, k) => (k === i ? next : s)) };
}

/** Appends `{ id, name?, static: empty image }`; an id already there is a no-op. */
export function addSymbol(doc: SymbolsDoc, id: string, name?: string): SymbolsDoc {
  if (doc.symbols.some((s) => s.id === id)) return doc;
  return {
    ...doc,
    symbols: [...doc.symbols, { id, ...(name ? { name } : {}), static: emptyImage() }],
  };
}

export function removeSymbol(doc: SymbolsDoc, id: string): SymbolsDoc {
  if (!doc.symbols.some((s) => s.id === id)) return doc;
  return { ...doc, symbols: doc.symbols.filter((s) => s.id !== id) };
}

/** `name`/`fit` over the def; an empty name is the key dropped, not `''` in the file. */
export function setSymbol(
  doc: SymbolsDoc,
  id: string,
  fields: { name?: string; fit?: 'contain' | 'none' },
): SymbolsDoc {
  return patch(doc, id, (def) => {
    const next = { ...def, ...fields };
    if (!next.name) delete next.name;
    if (!next.fit) delete next.fit;
    return next;
  });
}

/** `null` clears `idle`/`win`; `static` is always there, so clearing it resets it to the empty image. */
export function setState(
  doc: SymbolsDoc,
  id: string,
  state: SymbolState,
  node: SymbolNode | null,
): SymbolsDoc {
  return patch(doc, id, (def) => {
    if (node) return { ...def, [state]: node };
    if (state === 'static') return { ...def, static: emptyImage() };
    if (!def[state]) return def;
    const { [state]: _gone, ...rest } = def;
    return rest;
  });
}

/** The state under a new type, keeping only the props named in `keep` (what the new schema also has). */
export function setStateType(
  doc: SymbolsDoc,
  id: string,
  state: SymbolState,
  type: string,
  keep: readonly string[],
): SymbolsDoc {
  return patch(doc, id, (def) => {
    const prev = def[state]?.props ?? {};
    const props = Object.fromEntries(keep.filter((k) => k in prev).map((k) => [k, prev[k]]));
    return { ...def, [state]: { type, props } };
  });
}

/** A dropped file as a state's node: the path in the picked prop, and `loop: false` for a `win` that would otherwise loop. */
export function nodeForDrop(
  pick: { type: string; prop: string; hasLoop: boolean },
  path: string,
  state: SymbolState,
): SymbolNode {
  return {
    type: pick.type,
    props: { [pick.prop]: path, ...(state === 'win' && pick.hasLoop ? { loop: false } : {}) },
  };
}
