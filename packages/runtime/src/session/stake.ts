import { activateOne, definePlugin, type PluginManifest, type PointDef } from '@energy8engine/kernel';
import { POINT_SESSION_PROVIDER } from '../points';
import {
  provider,
  type InstalledSession,
  type SessionContext,
  type SessionProvider,
  type StakeAdapterBundle,
  type StakeBridgeCtor,
} from './types';

/**
 * Where the GAME hands Stake its own book adapter.
 *
 * `StakeBridge` needs an adapter, a mode map and a game id — the game's own code and spec data,
 * which a generic plugin cannot invent. Rather than reaching into the game, this plugin opens a
 * door and lets the project's own plugin fill it.
 */
export const POINT_STAKE_ADAPTER = 'stake.adapter';

const STAKE_ADAPTER_POINT: PointDef = {
  phase: 'runtime',
  arity: 'one',
  schema: {},
  doc:
    "The game's Stake book adapter, mode map and game id. Contributed by the game's own plugin, " +
    'because only the game knows them.',
};

async function defaultLoadStakeBridge(): Promise<StakeBridgeCtor> {
  // Dynamic on purpose — stake-bridge is an OPTIONAL peer, and a game that never ships to Stake
  // must still build without it installed.
  const mod = await import('@energy8platform/stake-bridge');
  return (mod as unknown as { StakeBridge: StakeBridgeCtor }).StakeBridge;
}

const install: SessionProvider = async (ctx: SessionContext): Promise<InstalledSession> => {
  if (!ctx.plan) {
    throw new Error('session-stake needs the resolved plan to reach stake.adapter');
  }
  const { instance } = await activateOne<StakeAdapterBundle>(ctx.plan, POINT_STAKE_ADAPTER);
  if (!instance) {
    throw new Error(
      'session-stake: no plugin contributes to stake.adapter — the game must provide its book adapter',
    );
  }
  const bundle = instance.value;

  const load = ctx.loadStakeBridge ?? defaultLoadStakeBridge;
  const StakeBridge = await load();
  const bridge = new StakeBridge({
    devMode: true,
    protocol: ctx.url.startsWith('http://') ? 'http' : 'https',
    adapter: bundle.adapter,
    modeMap: bundle.modeMap,
    gameId: bundle.gameId,
    url: ctx.url,
  });
  await bridge.ready();
  return { dispose: () => bridge.destroy?.() };
};

export const sessionStakePlugin: PluginManifest = definePlugin({
  id: '@e8/session-stake',
  version: '0.1.0',
  engine: '^0.1.0',
  dependsOn: { '@e8/host': '^0.1.0' },
  points: { [POINT_STAKE_ADAPTER]: STAKE_ADAPTER_POINT },
  contributes: {
    [POINT_SESSION_PROVIDER]: [
      {
        id: 'stake',
        defaults: { label: 'Stake RGS' },
        activateWhen: { buildTarget: 'stake' },
        doc: "Stake's RGS, reached through the game's book adapter. Active on a stake build.",
        create: async () => provider(install),
      },
    ],
  },
});
