import {
  BUILTIN_STATES,
  stateNode,
  type SymbolDef,
  type SymbolNode,
  type SymbolState,
  type SymbolsDoc,
} from '@energy8engine/contracts';

/**
 * The Symbols document's pure reducers — what `SymbolsDocument` and
 * `SymbolsProperties` write through. None mutate; each returns a new
 * document, or the SAME one when there is nothing to do (an unknown id, a
 * clear of a state that is not there, a refused name), which is how
 * `commit` knows to skip the PUT.
 */
export const EMPTY: SymbolsDoc = { version: 1, symbols: [] };

export const STATES: readonly SymbolState[] = BUILTIN_STATES;

const isBuiltin = (state: string) => (BUILTIN_STATES as readonly string[]).includes(state);

/** A named state's key: an identifier, and not one of the three built-ins. */
const NAME_RE = /^[A-Za-z_][\w-]*$/;
const validName = (name: string) => NAME_RE.test(name) && !isBuiltin(name);

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

/** A built-in state written in place; a named one written into (a fresh) `states`. */
function writeState(def: SymbolDef, state: string, node: SymbolNode): SymbolDef {
  if (isBuiltin(state)) return { ...def, [state]: node };
  return { ...def, states: { ...def.states, [state]: node } };
}

/** Drops a named state's key; drops `states` itself once it is empty. Unknown name is a no-op. */
function dropNamed(def: SymbolDef, name: string): SymbolDef {
  if (!def.states || !Object.hasOwn(def.states, name)) return def;
  const { [name]: _gone, ...rest } = def.states;
  if (Object.keys(rest).length > 0) return { ...def, states: rest };
  const { states: _states, ...next } = def;
  return next;
}

/** `null` clears `idle`/`win`/a named state; `static` is always there, so clearing it resets it to the empty image. */
export function setState(
  doc: SymbolsDoc,
  id: string,
  state: SymbolState,
  node: SymbolNode | null,
): SymbolsDoc {
  return patch(doc, id, (def) => {
    if (node) return writeState(def, state, node);
    if (state === 'static') return { ...def, static: emptyImage() };
    if (!isBuiltin(state)) return dropNamed(def, state);
    const key = state as 'idle' | 'win';
    if (!def[key]) return def;
    const { [key]: _gone, ...rest } = def;
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
    const prev = stateNode(def, state)?.props ?? {};
    const props = Object.fromEntries(keep.filter((k) => k in prev).map((k) => [k, prev[k]]));
    return writeState(def, state, { type, props });
  });
}

/** Adds `states.<name>` with an empty image; refused (doc unchanged) for a duplicate, built-in or invalid name. */
export function addState(doc: SymbolsDoc, id: string, name: string): SymbolsDoc {
  return patch(doc, id, (def) => {
    if (!validName(name)) return def;
    if (def.states && Object.hasOwn(def.states, name)) return def;
    return { ...def, states: { ...def.states, [name]: emptyImage() } };
  });
}

/** Drops a named state entirely — the key and, once it was the last one, the `states` map. */
export function removeState(doc: SymbolsDoc, id: string, name: string): SymbolsDoc {
  return patch(doc, id, (def) => dropNamed(def, name));
}

/** The built-in states this def actually has, then its named states, in declaration order. */
export function statesOf(def: SymbolDef): SymbolState[] {
  return [
    ...STATES.filter((s) => def[s as 'static' | 'idle' | 'win']),
    ...Object.keys(def.states ?? {}),
  ];
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
