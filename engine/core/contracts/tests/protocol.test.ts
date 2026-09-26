import { describe, expect, it } from 'vitest';
import type { ClientMessage, Diagnostic, ServerMessage } from '../src/index';

/**
 * `{type:'diagnostics'}` and `{type:'game-diagnostics'}` carry `Diagnostic`s
 * from two disjoint namespaces (see `Diagnostic.plugin`'s own doc): a
 * composition row id versus a seam/mechanic id. A human is free to name a
 * row `session` in `e8.yml`, so the two can carry byte-identical `plugin`
 * strings — the message `type` is the ONLY thing that tells a reader which
 * namespace it is looking at, and these tests are written against that
 * property directly rather than against any detail of one variant.
 *
 * **These used to run through `isServerMessage`, a loose exported guard
 * that no production reader ever called** — every real socket handler
 * hand-rolls its own check, because each cares about ONE type and has to
 * return early on the others rather than merely learning that the frame was
 * well-formed. The guard was deleted; what it was standing in for here is
 * asserted directly, which is what the tests were always about: the two
 * message types are distinguishable by tag alone, and `dropped`/`source`
 * are really on the variant in each direction. Most of that is a
 * compile-time claim, and it is made as one — a `const` annotated with the
 * union does not type-check unless the field is genuinely there.
 */
describe('protocol — game-diagnostics is its own message, not a reuse of diagnostics', () => {
  const same: Diagnostic = { severity: 'error', plugin: 'session', where: 'w', message: 'm' };

  it('a project diagnostic and a game diagnostic are different messages, even with the same plugin id', () => {
    const project: ServerMessage = { type: 'diagnostics', diagnostics: [same] };
    const game: ServerMessage = { type: 'game-diagnostics', diagnostics: [same], dropped: 0 };

    // Same payload, byte for byte. Nothing in the DATA distinguishes them.
    expect(project.diagnostics).toEqual(game.diagnostics);
    // Only the tag does — which is why every reader is required to switch
    // on it and never on `plugin`.
    expect(project.type).not.toBe(game.type);
  });

  it('carries dropped alongside the diagnostics, on the wire type, in both directions', () => {
    // Compile-time proof as much as a runtime one: these only type-check
    // against `ClientMessage`/`ServerMessage` if `dropped: number` is
    // actually part of the `game-diagnostics` variant of both.
    const gameToHost: ClientMessage = { type: 'game-diagnostics', diagnostics: [], dropped: 3 };
    const hostToEditor: ServerMessage = { type: 'game-diagnostics', diagnostics: [], dropped: 3 };
    expect(gameToHost.dropped).toBe(3);
    expect(hostToEditor.dropped).toBe(3);
  });

  it('carries the source on the server-to-client frame, and a game never names itself', () => {
    // The host stamps `source` from where the frame entered; a game's own
    // frame carries none, and a reader reads its absence as `game`. Both
    // halves are compile-time claims about the same optional field.
    const fromHost: ServerMessage = {
      type: 'game-diagnostics',
      diagnostics: [],
      dropped: 0,
      source: 'host',
    };
    const fromGame: ClientMessage = { type: 'game-diagnostics', diagnostics: [], dropped: 0 };
    expect(fromHost.source).toBe('host');
    expect(fromGame.source).toBeUndefined();
  });

  it('carries which game the list belongs to, and an absent one is a legal frame, not a broken one', () => {
    // Compile-time proof again: `game` only type-checks here if it is
    // genuinely part of the `game-diagnostics` variant of both directions.
    // A preview wall runs several games against one host at once, so a
    // whole-list frame needs to say WHICH game it is the whole list OF —
    // but a project opened the ordinary way still has exactly one, with
    // nothing to be told apart from, and must keep working unchanged.
    const tileThree: ClientMessage = {
      type: 'game-diagnostics',
      diagnostics: [],
      dropped: 0,
      game: 'tile-3',
    };
    const ordinary: ClientMessage = { type: 'game-diagnostics', diagnostics: [], dropped: 0 };
    expect(tileThree.game).toBe('tile-3');
    expect(ordinary.game).toBeUndefined();
  });
});

describe('protocol — game-composition tells the IDE and the game that a row was rewritten', () => {
  it('carries the rows, the reload verdict, and which ids changed', () => {
    // Compile-time claim: the variant exists on `ServerMessage` with all
    // three fields; the host decides `reload`, the readers only obey it.
    const frame: ServerMessage = {
      type: 'game-composition',
      rows: [
        {
          id: 'reels1',
          name: '@energy8engine/reels',
          config: {},
          from: 'patch',
          runtimeUrl: null,
          schema: null,
          hot: true,
        },
      ],
      reload: false,
      changed: ['reels1'],
    };
    expect(frame.type).toBe('game-composition');
    expect(frame.changed).toEqual(['reels1']);
  });
});

describe('protocol — scenes: a preview push down, a transitions mirror up', () => {
  it('scene-preview is a server frame; game-transitions goes both ways', () => {
    // Compile-time claims, like the block above: `scene-preview` only
    // type-checks as a server frame; `game-transitions` as either.
    const push: ServerMessage = { type: 'scene-preview', scene: 'base_game' };
    const mirror: ClientMessage = { type: 'game-transitions', ids: ['cut', 'fade'] };
    const relay: ServerMessage = mirror;
    expect(push.scene).toBe('base_game');
    expect(mirror.ids).toEqual(['cut', 'fade']);
    expect(relay).toBe(mirror);
  });
});

describe('protocol — game-status: the IDE status bar', () => {
  it('game-status goes both ways, and the host adds offline', () => {
    // Compile-time claims: `game-status` with `spinning` type-checks as
    // both `ClientMessage` and `ServerMessage`, and so does `offline` —
    // one `GameStatusMessage` type serves both directions. `offline` is
    // the host's word alone (it is the only one that can report a game
    // socket gone), but that is enforced at RUNTIME: `rpc.ts` drops a
    // game's own `offline` frame (`rpc.test.ts`'s "ignores a frame with
    // state "offline"…"), not the type.
    const gameToHost: ClientMessage = { type: 'game-status', state: 'spinning' };
    const hostMirror: ServerMessage = gameToHost;
    const hostAdds: ServerMessage = { type: 'game-status', state: 'offline' };
    expect(gameToHost.state).toBe('spinning');
    expect(hostMirror).toBe(gameToHost);
    expect(hostAdds.state).toBe('offline');
  });
});
