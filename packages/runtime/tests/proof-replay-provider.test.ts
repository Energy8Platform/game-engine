import { describe, expect, it, vi } from 'vitest';
import { definePlugin, resolvePlan, type ResolvedPlan } from '@energy8engine/kernel';
import { hostPlugin, POINT_SESSION_PROVIDER } from '@/points';
import { sessionDevPlugin } from '@/session/dev';
import { POINT_STAKE_ADAPTER, sessionStakePlugin } from '@/session/stake';
import { runGame } from '@/runGame';
import { provider, type InstalledSession, type SessionContext } from '@/session/types';

/**
 * A plugin as a game author would write it, in their own project's plugins/ folder. Nothing below
 * imports anything private, and nothing in packages/ changes to accommodate it.
 */
const installed = vi.fn();

const replayPlugin = definePlugin({
  id: 'acme-session-replay',
  version: '1.0.0',
  engine: '^0.1.0',
  dependsOn: { '@e8/host': '^0.1.0' },
  contributes: {
    [POINT_SESSION_PROVIDER]: [
      {
        id: 'replay',
        schema: {
          bookFile: {
            kind: 'asset',
            label: 'Recorded books',
            doc: 'A JSONL dump of recorded rounds to replay.',
            accept: 'any',
            default: 'books/recorded.jsonl',
          },
        },
        defaults: { label: 'Replay recorded books' },
        activateWhen: { urlParam: 'replay' },
        doc: 'Serves rounds from a recorded book dump instead of a live backend.',
        create: async () =>
          provider(async (ctx: SessionContext): Promise<InstalledSession> => {
            installed(ctx.settings);
            return { dispose: () => {} };
          }),
      },
    ],
  },
});

/**
 * `session-stake` opens `stake.adapter` (arity: 'one') because only the GAME knows its own book
 * adapter, mode map and game id (see session/stake.ts) — this is not something a generic plugin can
 * invent. `resolvePlan` resolves every declared point unconditionally, independent of the current
 * launch, so simply admitting `@e8/session-stake` (needed here so 'stake' exists as a labeled,
 * losing candidate for session.provider) requires a filler for `stake.adapter` too, or resolution
 * reports `resolve/no-activation` on every launch, not just a stake one. `session-stake.test.ts`'s
 * own `gamePlugin` already establishes this; this is the same stand-in a real game project would
 * already have, unrelated to the replay plugin under test.
 */
const gamePlugin = definePlugin({
  id: 'acme-slot',
  version: '1.0.0',
  engine: '^0.1.0',
  dependsOn: { '@e8/session-stake': '^0.1.0' },
  contributes: {
    [POINT_STAKE_ADAPTER]: [
      {
        id: 'book-adapter',
        doc: "This game's Stake book adapter.",
        activateWhen: { default: true },
        create: async () => () => ({ adapter: {}, modeMap: {}, gameId: 'acme-slot' }),
      },
    ],
  },
});

const project = {
  plugins: {
    '@e8/host': { version: '*' },
    '@e8/session-dev': { version: '*' },
    '@e8/session-stake': { version: '*' },
    'acme-slot': { version: '*' },
    'acme-session-replay': {
      version: '*',
      contributions: { 'session.provider:replay': { settings: { bookFile: 'books/session-42.jsonl' } } },
    },
  },
};

const manifests = [hostPlugin, sessionDevPlugin, sessionStakePlugin, gamePlugin, replayPlugin];

describe('a fourth session provider, contributed by the project itself', () => {
  it('wins when its matcher fires, and nothing in the engine changed to allow it', async () => {
    installed.mockClear();
    const result = await runGame({
      project,
      manifests,
      url: 'https://game.example/play?replay=session-42',
      createSession: async () => ({ kind: 'session' }),
    });

    expect(result.diagnostics).toEqual([]);
    const active = result.plan.contributions.filter(
      (c) => c.pointId === POINT_SESSION_PROVIDER && c.active,
    );
    expect(active.map((c) => c.id)).toEqual(['replay']);
    expect(result.session).toEqual({ kind: 'session' });
  });

  it('receives the settings the project set for it', async () => {
    installed.mockClear();
    await runGame({
      project,
      manifests,
      url: 'https://game.example/play?replay=session-42',
      createSession: async () => ({}),
    });
    expect(installed).toHaveBeenCalledWith(expect.objectContaining({ bookFile: 'books/session-42.jsonl' }));
  });

  it('yields to dev when the replay parameter is absent', async () => {
    const result = await runGame({
      project,
      manifests,
      url: 'https://game.example/play',
      loadDevBridge: async () => class { start() {} stop() {} },
      createSession: async () => ({}),
    });
    expect(result.diagnostics).toEqual([]);
    expect(
      result.plan.contributions.filter((c) => c.pointId === POINT_SESSION_PROVIDER && c.active).map((c) => c.id),
    ).toEqual(['dev']);
  });

  it('the IDE can say when each provider takes over, without running any of them', () => {
    const { plan } = resolvePlan({
      project,
      manifests,
      launch: { url: 'https://game.example/play' },
      kernelVersion: '0.1.0',
    }) as { plan: ResolvedPlan };

    const labels = Object.fromEntries(
      plan.contributions
        .filter((c) => c.pointId === POINT_SESSION_PROVIDER)
        .map((c) => [c.id, c.activationLabel]),
    );
    expect(labels.replay).toBe('when ?replay is present');
    expect(labels.stake).toBe('when the build target is "stake"');
    expect(labels.dev).toBe('when nothing else matches');
  });

  it('reports a collision when two providers claim the same launch', async () => {
    const rival = definePlugin({
      id: 'acme-rival',
      version: '1.0.0',
      engine: '^0.1.0',
      dependsOn: { '@e8/host': '^0.1.0' },
      contributes: {
        [POINT_SESSION_PROVIDER]: [
          {
            id: 'rival',
            activateWhen: { urlParam: 'replay' },
            doc: 'Also claims the replay launch.',
            create: async () => provider(async () => ({})),
          },
        ],
      },
    });
    const result = await runGame({
      project: { plugins: { ...project.plugins, 'acme-rival': { version: '*' } } },
      manifests: [...manifests, rival],
      url: 'https://game.example/play?replay=1',
      createSession: async () => ({}),
    });
    expect(result.session).toBeNull();
    const d = result.diagnostics.find((x) => x.code === 'resolve/ambiguous-activation');
    expect(d).toBeDefined();
    expect(d!.message).toContain('replay');
    expect(d!.message).toContain('rival');
  });
});
