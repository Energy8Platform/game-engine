// packages/game-engine/src/host/createSlotGame.ts
import { GameApplication } from '../core';
import { buildAppConfig } from './buildConfig';
import { loadFonts, applyTextureDefaults, bootGuard } from './preboot';
import { showFatalError } from './fatalError';
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
  game.scenes.register(opts.scene.key, opts.scene.scene);
  let firstScene = opts.scene.key;
  const { resolveIntro } = await import('./introOption');
  const intro = resolveIntro(opts.intro);
  if (intro) {
    game.scenes.register('__intro__', intro.ctor);
    firstScene = '__intro__';
  }
  try {
    await game.start(
      firstScene,
      intro ? { ...(intro.data as object), onStart: () => { void game.scenes.goto(opts.scene.key); } } : undefined,
    );
  } catch (err) {
    fatal('Could not start the game.');
    throw err;
  }

  let currentBet = opts.model.spec.defaultBet ?? opts.model.spec.betLevels[0];

  // Build slotPlay FIRST — bindGameScene() needs it to be in scope.
  const { createSlotPlay } = await import('./slotPlay');

  let shell: SlotGameHandle['shell'] = null;

  /** Always points to the live game scene (only present when it is the current scene). */
  const gameScene = () =>
    game.scenes.currentKey === opts.scene.key
      ? (game.scenes.current?.scene as Partial<import('./sceneController').SlotSceneController<T>> | undefined)
      : undefined;

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
    const runtime = {
      balance,
      currency: game.platformSession?.currency,        // code from the SDK handshake
      language: (game.initData as { language?: string } | null)?.language,
      mode,
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
