import { describe, expect, it } from 'vitest';
import type {
  ClientMessage,
  NodeTypeAccept,
  NodeTypeInfo,
  SceneDoc,
  SceneSelectMessage,
  ScenesMessage,
  ScenesResponse,
  ServerMessage,
  SymbolDef,
  SymbolsDoc,
  SymbolsMessage,
  SymbolsResponse,
} from '../src';

/** Compile-time shapes: a value of each type assigns; the unions carry the new members. */
describe('scene contracts', () => {
  it('shapes assign and the unions carry the three new frames', () => {
    const doc: SceneDoc = {
      id: 'base_game',
      nodes: [
        { id: 'bg', type: 'image', props: { src: 'assets/bg.png', x: 1 } },
        { id: 'grp', type: 'container', props: {}, children: [{ id: 'k', type: 'reels', props: {} }] },
      ],
    };
    const accept: NodeTypeAccept = { extensions: ['png', 'jpg', 'jpeg', 'webp'], prop: 'src' };
    const types: NodeTypeInfo[] = [
      { type: 'image', schema: { type: 'object' }, accept, assetProps: ['src'] },
    ];
    const response: ScenesResponse = { scenes: [doc], diagnostics: [], nodeTypes: types };
    const frames: ServerMessage[] = [
      { type: 'scenes', scenes: [doc], diagnostics: [] } satisfies ScenesMessage,
      { type: 'node-types', types },
      { type: 'scene-select', scene: 'base_game', node: null } satisfies SceneSelectMessage,
    ];
    const up: ClientMessage = { type: 'node-types', types };
    expect(response.scenes[0].nodes[1].children?.[0].type).toBe('reels');
    expect(frames.map((f) => f.type)).toEqual(['scenes', 'node-types', 'scene-select']);
    expect(up.type).toBe('node-types');
    expect(response.nodeTypes[0].accept).toEqual(accept);
    expect(response.nodeTypes[0].assetProps).toEqual(['src']);
  });
});

describe('symbols contracts', () => {
  it('SymbolDef/SymbolsDoc shapes assign, and SymbolsMessage is a ServerMessage', () => {
    const def: SymbolDef = {
      id: 'wild',
      name: 'Wild',
      fit: 'contain',
      static: { type: 'image', props: { src: 'assets/wild.png' } },
      idle: { type: 'spritesheet', props: { sheet: 'assets/wild.json' } },
      win: { type: 'spine', props: { skeleton: 'assets/wild-win.json' } },
    };
    const doc: SymbolsDoc = { version: 1, symbols: [def] };
    const response: SymbolsResponse = {
      doc,
      known: [{ id: 'wild', name: 'Wild' }],
      diagnostics: [],
    };
    const frames: ServerMessage[] = [
      { type: 'symbols', doc, diagnostics: [] } satisfies SymbolsMessage,
    ];
    expect(frames.map((f) => f.type)).toEqual(['symbols']);
    expect(response.doc?.symbols[0].id).toBe('wild');
    // a symbol with only the required `static` view is a legal SymbolDef
    const minimal: SymbolDef = { id: 'ten', static: { type: 'image', props: {} } };
    expect(minimal.idle).toBeUndefined();
    // doc: null (nothing curated yet, or a curation error) is legal on both the message and the response
    const empty: SymbolsMessage = { type: 'symbols', doc: null, diagnostics: [] };
    expect(empty.doc).toBeNull();
  });
});
