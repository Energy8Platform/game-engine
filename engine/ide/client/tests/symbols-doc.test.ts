import { describe, expect, it } from 'vitest';
import type { SymbolsDoc } from '@energy8engine/contracts';
import {
  EMPTY,
  addState,
  addSymbol,
  nodeForDrop,
  removeState,
  removeSymbol,
  setState,
  setStateType,
  setSymbol,
  statesOf,
} from '../src/shell/symbols-doc';

/** The Symbols document's pure reducers: none mutate, an unknown id is the doc back unchanged. */
const IMAGE = { type: 'image', props: { src: '' } };
const ONE: SymbolsDoc = {
  version: 1,
  symbols: [
    {
      id: '1',
      name: 'cherry',
      static: { type: 'image', props: { src: 'assets/1.png' } },
      win: { type: 'spritesheet', props: { sheet: 'assets/coin.json', loop: false, x: 4 } },
    },
  ],
};

describe('symbols-doc reducers', () => {
  it('EMPTY is the versioned empty document', () => {
    expect(EMPTY).toEqual({ version: 1, symbols: [] });
  });

  it('addSymbol appends an empty-image static (name only when given); an existing id is a no-op', () => {
    const next = addSymbol(EMPTY, '2', 'lemon');
    expect(next).toEqual({ version: 1, symbols: [{ id: '2', name: 'lemon', static: IMAGE }] });
    expect(EMPTY.symbols).toEqual([]);
    expect(addSymbol(EMPTY, '3')).toEqual({ version: 1, symbols: [{ id: '3', static: IMAGE }] });
    expect(addSymbol(ONE, '1', 'again')).toBe(ONE);
  });

  it('removeSymbol drops the one symbol; an unknown id is the doc back', () => {
    expect(removeSymbol(ONE, '1')).toEqual(EMPTY);
    expect(removeSymbol(ONE, '9')).toBe(ONE);
    expect(ONE.symbols).toHaveLength(1);
  });

  it('setSymbol patches name and fit; an emptied name is dropped, not written as ""', () => {
    expect(setSymbol(ONE, '1', { fit: 'none' }).symbols[0]).toEqual({
      ...ONE.symbols[0],
      fit: 'none',
    });
    expect(setSymbol(ONE, '1', { name: 'berry' }).symbols[0].name).toBe('berry');
    const { name: _, ...noName } = ONE.symbols[0];
    expect(setSymbol(ONE, '1', { name: '' }).symbols[0]).toEqual(noName);
    expect(setSymbol(ONE, '9', { name: 'x' })).toBe(ONE);
  });

  it('setState sets a state; null clears idle/win, and resets static to the empty image', () => {
    const idle = { type: 'gif', props: { src: 'assets/1.gif' } };
    expect(setState(ONE, '1', 'idle', idle).symbols[0].idle).toEqual(idle);
    expect(setState(ONE, '1', 'win', null).symbols[0]).toEqual({
      id: '1',
      name: 'cherry',
      static: ONE.symbols[0].static,
    });
    expect(setState(ONE, '1', 'static', null).symbols[0].static).toEqual(IMAGE);
    expect(setState(ONE, '1', 'idle', null)).toBe(ONE); // nothing to clear
    expect(setState(ONE, '9', 'idle', idle)).toBe(ONE);
  });

  it('setStateType changes the type keeping only the props named in `keep`', () => {
    const next = setStateType(ONE, '1', 'win', 'gif', ['src', 'loop', 'x']);
    expect(next.symbols[0].win).toEqual({ type: 'gif', props: { loop: false, x: 4 } });
    // A state the def has not got yet starts empty.
    expect(setStateType(ONE, '1', 'idle', 'image', ['src']).symbols[0].idle).toEqual({
      type: 'image',
      props: {},
    });
    expect(setStateType(ONE, '9', 'win', 'gif', [])).toBe(ONE);
  });

  it('nodeForDrop puts the path in the picked prop; `win` on a looping type adds loop: false', () => {
    const sheet = { type: 'spritesheet', prop: 'sheet', hasLoop: true };
    expect(nodeForDrop(sheet, 'assets/coin.json', 'win')).toEqual({
      type: 'spritesheet',
      props: { sheet: 'assets/coin.json', loop: false },
    });
    expect(nodeForDrop(sheet, 'assets/coin.json', 'idle')).toEqual({
      type: 'spritesheet',
      props: { sheet: 'assets/coin.json' },
    });
    expect(nodeForDrop({ type: 'image', prop: 'src', hasLoop: false }, 'a.png', 'win')).toEqual({
      type: 'image',
      props: { src: 'a.png' },
    });
  });

  it('addState creates states.<name> with an empty image', () => {
    const next = addState(ONE, '1', 'death');
    expect(next.symbols[0].states).toEqual({ death: IMAGE });
    expect(ONE.symbols[0].states).toBeUndefined();
  });

  // One refusal per case: a failure in the first must not hide the rest.
  it('addState refuses a name the symbol already has', () => {
    const next = addState(ONE, '1', 'death');
    expect(addState(next, '1', 'death')).toBe(next);
  });

  it('addState refuses a built-in name', () => {
    for (const state of ['static', 'idle', 'win']) expect(addState(ONE, '1', state)).toBe(ONE);
  });

  it('addState refuses a name that is not an identifier', () => {
    for (const state of ['1bad', 'has space', 'a.b', ''])
      expect(addState(ONE, '1', state)).toBe(ONE);
  });

  it('addState refuses an id no symbol has', () => {
    expect(addState(ONE, '9', 'death')).toBe(ONE);
  });

  it('removeState drops the key, and the whole `states` map when it empties; an unknown name is a no-op', () => {
    const oneState = addState(ONE, '1', 'death');
    const twoStates = addState(oneState, '1', 'party');
    expect(removeState(twoStates, '1', 'death').symbols[0].states).toEqual({ party: IMAGE });
    expect(removeState(oneState, '1', 'death').symbols[0]).toEqual(ONE.symbols[0]);
    expect(removeState(oneState, '1', 'death').symbols[0].states).toBeUndefined();
    expect(removeState(ONE, '1', 'nope')).toBe(ONE);
    expect(removeState(ONE, '9', 'death')).toBe(ONE);
  });

  it('setState on a named state writes into `states`; null removes it, dropping the map when it empties', () => {
    const node = { type: 'gif', props: { src: 'assets/death.gif' } };
    const withDeath = setState(ONE, '1', 'death', node);
    expect(withDeath.symbols[0].states).toEqual({ death: node });
    expect(setState(withDeath, '1', 'death', null).symbols[0]).toEqual(ONE.symbols[0]);
    expect(setState(ONE, '1', 'death', null)).toBe(ONE); // nothing to clear
  });

  it('setStateType on a named state keeps only the props named in `keep`', () => {
    const withDeath = setState(ONE, '1', 'death', {
      type: 'spritesheet',
      props: { sheet: 'assets/death.json', loop: false, x: 4 },
    });
    const next = setStateType(withDeath, '1', 'death', 'gif', ['nope']);
    expect(next.symbols[0].states).toEqual({ death: { type: 'gif', props: {} } });
    const kept = setStateType(withDeath, '1', 'death', 'gif', ['loop', 'x']);
    expect(kept.symbols[0].states).toEqual({
      death: { type: 'gif', props: { loop: false, x: 4 } },
    });
  });

  it('statesOf lists the built-ins present, then the named states in order', () => {
    expect(statesOf(ONE.symbols[0])).toEqual(['static', 'win']); // no idle
    const withNamed = addState(addState(ONE, '1', 'party'), '1', 'death');
    expect(statesOf(withNamed.symbols[0])).toEqual(['static', 'win', 'party', 'death']);
  });
});
