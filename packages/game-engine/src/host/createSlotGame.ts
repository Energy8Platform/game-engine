// packages/game-engine/src/host/createSlotGame.ts
import { GameApplication } from '../core';
import { buildAppConfig } from './buildConfig';
import { loadFonts, applyTextureDefaults, bootGuard } from './preboot';
import { showFatalError, installGlobalErrorHandlers } from './fatalError';
import type { CreateSlotGameOptions, SlotGameHandle } from './types';
import type { SlotSpinResultBase } from '@energy8platform/platform-core/slot-result';
import type { ShellMode } from '@energy8platform/platform-core/shell';

/**
 * One-call slot bootstrap: preboot → (optional Stake bridge) → GameApplication
 * → register scene → start. Collapses the per-game main.ts boilerplate.
 *
 * Not unit-tested: GameApplication.init() drives Pixi, which hangs in headless
 * environments. The pure helpers it sequences are unit-tested individually.
 */
export async function createSlotGame<T extends SlotSpinResultBase = SlotSpinResultBase>(
  opts: CreateSlotGameOptions<T>,
): Promise<SlotGameHandle> {
  if (!bootGuard()) throw new Error('createSlotGame() called more than once');

  if (opts.textureDefaults) applyTextureDefaults();
  await loadFonts(opts.fonts);

  const fatal = (message: string) =>
    opts.onFatalError ? opts.onFatalError(message) : showFatalError(opts.container ?? '#game', message);

  // Global safety net: surface ANY uncaught error / unhandled rejection (e.g. an
  // `Uncaught (in promise) SDKError` on spin) through the same fatal modal so games
  // don't have to handle errors themselves. Honours the onFatalError override.
  installGlobalErrorHandlers(opts.container ?? '#game', fatal);

  let stakeBridge: SlotGameHandle['stakeBridge'] = null;
  let isStakeNow = false;
  if (opts.stake) {
    const { isStakeLaunch } = await import('@energy8platform/stake-bridge/detect');
    isStakeNow = isStakeLaunch(location.href);
    if (isStakeNow) {
      try {
        const { StakeBridge } = await import('@energy8platform/stake-bridge');
        stakeBridge = new StakeBridge({
          devMode: true,
          // In the dev harness the iframe is served over http and the dev-RGS
          // lives at the same (http) origin; force the matching scheme so
          // RGSClient can reach it. Prod (https) is unaffected.
          protocol: location.protocol === 'http:' ? 'http' : 'https',
          adapter: opts.stake.adapter,
          modeMap: opts.model.modeMap,
          gameId: opts.model.spec.id,
          url: location.href,
        });
        await stakeBridge.ready();
      } catch (err) {
        fatal('Could not connect to the game server. Please reload.');
        throw err;
      }
    }
  }

  const game = new GameApplication(buildAppConfig(opts, isStakeNow));

  // Register EVERY scene up front so any of them can navigate to any other.
  for (const { key, scene } of opts.scenes) game.scenes.register(key, scene);

  // Navigation injected into the start data of every scene: a scene reads `goto`
  // from its `onEnter(data)` and calls it to switch scenes (intro → game, etc.).
  const goto = (key: string, data?: unknown) => {
    void game.scenes.goto(key, { ...(data as object), goto });
  };

  try {
    await game.start(opts.startScene, { ...(opts.startData as object), goto });
  } catch (err) {
    fatal('Could not start the game.');
    throw err;
  }

  let currentBet = opts.model.spec.defaultBet ?? opts.model.spec.betLevels[0];

  // Build slotPlay FIRST — bindGameScene() needs it to be in scope.
  const { createSlotPlay } = await import('./slotPlay');

  let shell: SlotGameHandle['shell'] = null;

  /** The current scene IFF it implements the SlotSceneController contract (duck-typed
   *  on `bindHost`). Host play/bet bind to whichever scene is current and controllable. */
  const gameScene = () => {
    const s = game.scenes.current?.scene as
      | Partial<import('./sceneController').SlotSceneController<T>>
      | undefined;
    return typeof s?.bindHost === 'function' ? s : undefined;
  };

  // slotPlay references shell via closure — define it after shell is assigned below.
  // We use a late-binding wrapper so the closure captures the variable, not null.
  const slotPlay = createSlotPlay<T>({
    play: (p) => game.platformSession!.play(p),
    normalize: opts.normalize,
    onWin: (w) => shell?.setWin(w),
  });

  /** Inject host + current bet into the game scene whenever it becomes current. */
  const bindGameScene = () => {
    const s = gameScene();
    s?.bindHost?.({ play: slotPlay });
    s?.setBet?.(currentBet);
  };

  // Fire once immediately (covers no-intro path where game scene is already current)
  // and again on each scene change (covers intro→game transition).
  game.scenes.on('change', bindGameScene);
  bindGameScene();

  if (opts.shell) {
    const { createGameShell } = await import('@energy8platform/platform-core/shell');
    const { buildShellConfig } = await import('./shellConfig');
    const { resolveReplayBonusId } = await import('./replay');

    const ps = game.platformSession;
    const balance = (game.initData?.balance as number | undefined) ?? 0;
    const isReplay = !!stakeBridge?.isReplay;
    const mode: ShellMode = isReplay ? 'replay' : 'base';
    // initData.config carries the Stake bridge's currency/social/disclaimer surface (GameConfigData);
    // all are absent in non-stake/dev launches → graceful fallbacks downstream.
    const initData = game.initData as {
      config?: {
        socialMode?: boolean;
        disclaimerLines?: string[];
        currency?: { code: string; symbol: string; decimals: number; symbolAfter?: boolean };
      };
      lang?: string;
    } | null;
    const config = initData?.config;
    const { resolveCurrency } = await import('./shellConfig');
    const runtime = {
      balance,
      // SINGLE source of truth: derive the shell CurrencyConfig from the CurrencyMetaData the
      // Stake bridge builds on initData.config.currency (the SAME table). Fall back to the spec
      // currency code, then a neutral euro.
      currency: resolveCurrency(config?.currency, opts.model.spec.currency),
      language: initData?.lang,
      mode,
      social: config?.socialMode,
      disclaimerLines: config?.disclaimerLines,
    };
    shell = createGameShell(buildShellConfig(opts.shell, opts.model, runtime));
    ps?.on('balanceUpdate', (d: { balance: number }) => shell!.setBalance(d.balance));

    if (mode === 'base') {
      let activeFeature: string | null = null;
      shell.on('featureActivate', ({ id }: { id: string }) => { activeFeature = id; });
      shell.on('featureDeactivate', ({ id: _id }: { id: string }) => { activeFeature = null; });
      shell.on('spin', () => {
        const s = gameScene();
        if (activeFeature) void s?.buyBonus?.(activeFeature, currentBet);
        else void s?.spin?.(currentBet);
      });
      shell.on('betChange', (bet: number) => {
        currentBet = bet;
        gameScene()?.setBet?.(bet);
      });
      shell.on('buyBonusSelect', ({ id }: { id: string }) => { void gameScene()?.buyBonus?.(id, currentBet); });
    } else {
      const stakeMode = stakeBridge?.replayMode ?? 'BASE';
      const bonusId = resolveReplayBonusId(opts.model, stakeMode);
      // onReplay only spins — the shell reopens the modal after it resolves; never call openReplay inside onReplay (double-open).
      shell.openReplay({
        bonusId, bet: currentBet, payoutMultiplier: 0,
        onReplay: () => gameScene()?.spin?.(currentBet),
      });
    }
  }

  return { game, stakeBridge, shell };
}
