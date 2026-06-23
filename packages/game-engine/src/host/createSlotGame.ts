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
  try {
    await game.start(opts.scene.key);
  } catch (err) {
    fatal('Could not start the game.');
    throw err;
  }

  // Resolve the scene controller (duck-typed) up front; it gets a normalized play() regardless of shell.
  const sceneInst = game.scenes.current?.scene as
    | Partial<import('./sceneController').SlotSceneController<T>>
    | undefined;
  let currentBet = opts.model.spec.defaultBet ?? opts.model.spec.betLevels[0];

  let shell: SlotGameHandle['shell'] = null;
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
    sceneInst?.setBet?.(currentBet);

    if (mode === 'base') {
      shell.on('spin', () => { void sceneInst?.spin?.(currentBet); });
      shell.on('betChange', (bet: number) => { currentBet = bet; sceneInst?.setBet?.(bet); });
      shell.on('buyBonusSelect', ({ id }: { id: string }) => { void sceneInst?.buyBonus?.(id, currentBet); });
    } else {
      const stakeMode = stakeBridge?.replayMode ?? 'BASE';
      const bonusId = resolveReplayBonusId(opts.model, stakeMode);
      // onReplay only spins — the shell reopens the modal after it resolves; never call openReplay inside onReplay (double-open).
      shell.openReplay({
        bonusId, bet: currentBet, payoutMultiplier: 0,
        onReplay: () => sceneInst?.spin?.(currentBet),
      });
    }
  } else {
    sceneInst?.setBet?.(currentBet);
  }

  // Always give the scene a normalized play() (host owns play → normalize → shell-win sync).
  const { createSlotPlay } = await import('./slotPlay');
  const slotPlay = createSlotPlay<T>({
    play: (p) => game.platformSession!.play(p),
    normalize: opts.normalize,
    onWin: shell ? (w) => shell!.setWin(w) : undefined,
  });
  sceneInst?.bindHost?.({ play: slotPlay });

  return { game, stakeBridge, shell };
}
