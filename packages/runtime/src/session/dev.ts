import { definePlugin, type PluginManifest, type Schema } from '@energy8engine/kernel';
import { POINT_SESSION_PROVIDER } from '../points';
import { provider, type DevBridgeCtor, type InstalledSession, type SessionContext, type SessionProvider } from './types';

/** The DevBridge knobs worth exposing in the IDE. */
const DEV_SCHEMA: Schema = {
  balance: {
    kind: 'number',
    label: 'Starting balance',
    doc: 'Mock balance in major units, handed to the game at handshake.',
    default: 100000,
    min: 0,
  },
  currency: { kind: 'text', label: 'Currency', doc: 'ISO code the mock host reports.', default: 'USD' },
  networkDelay: {
    kind: 'number',
    label: 'Simulated latency (ms)',
    doc: 'Delay added to every mock response, for testing slow links.',
    default: 0,
    min: 0,
    max: 5000,
  },
  debug: { kind: 'boolean', label: 'Debug logging', doc: 'Log every mock exchange to the console.', default: false },
};

async function defaultLoadDevBridge(): Promise<DevBridgeCtor> {
  // Dynamic on purpose: platform-core is an OPTIONAL peer. A static specifier would be resolved by
  // every bundler, so a game that never uses the dev provider would still have to install it.
  const mod = await import('@energy8platform/platform-core/dev-bridge');
  return (mod as unknown as { DevBridge: DevBridgeCtor }).DevBridge;
}

/**
 * Install a DevBridge on the in-process SDK channel. The runtime runs the handshake afterwards,
 * so nothing here builds or returns a session.
 */
const install: SessionProvider = async (ctx: SessionContext): Promise<InstalledSession> => {
  const load = ctx.loadDevBridge ?? defaultLoadDevBridge;
  const DevBridge = await load();
  const bridge = new DevBridge({
    balance: ctx.settings.balance,
    currency: ctx.settings.currency,
    networkDelay: ctx.settings.networkDelay,
    debug: ctx.settings.debug,
  });
  bridge.start();
  return { dispose: () => bridge.stop() };
};

export const sessionDevPlugin: PluginManifest = definePlugin({
  id: '@e8/session-dev',
  version: '0.1.0',
  engine: '^0.1.0',
  dependsOn: { '@e8/host': '^0.1.0' },
  contributes: {
    [POINT_SESSION_PROVIDER]: [
      {
        id: 'dev',
        schema: DEV_SCHEMA,
        defaults: { label: 'Local mock host' },
        activateWhen: { default: true },
        doc: 'An in-process mock casino host. The fallback when no other provider matches.',
        create: async () => provider(install),
      },
    ],
  },
});
