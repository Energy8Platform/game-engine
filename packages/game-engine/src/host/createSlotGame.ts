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

  // Declared up front so `fatal` can route errors through the shell's own modal once it exists.
  let shell: SlotGameHandle['shell'] = null;

  const fatal = (message: string) => {
    if (opts.onFatalError) return opts.onFatalError(message);
    // Once the shell is up, use ITS branded modal (consistent chrome, social vocabulary, fit
    // scaling) rather than the bare DOM fallback. Errors thrown before the shell boots (asset
    // load, SDK handshake) still get the standalone overlay.
    if (shell) {
      shell.openModal({
        availableClose: false,
        title: shell.t('Something went wrong'),
        body: shell.t(message),
        actions: [{ title: shell.t('Reload'), on: () => { try { location.reload(); } catch { /* non-browser */ } } }],
      });
      return;
    }
    showFatalError(opts.container ?? '#game', message);
  };

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

  // Pick the start scene from the ordered list + launch mode: a replay launch skips any leading
  // `skipOnReplay` scene (the intro) and starts directly on the game scene.
  const { resolveStartScene } = await import('./sceneStart');
  const startScene = resolveStartScene(opts.scenes, !!stakeBridge?.isReplay, opts.startScene);

  try {
    await game.start(startScene, { ...(opts.startData as object), goto });
  } catch (err) {
    fatal('Could not start the game.');
    throw err;
  }

  let currentBet = opts.model.spec.defaultBet ?? opts.model.spec.betLevels[0];

  // Build slotPlay FIRST — bindGameScene() needs it to be in scope.
  const { createSlotPlay } = await import('./slotPlay');

  /** The current scene IFF it implements the SlotSceneController contract (duck-typed on
   *  `present`). The host drives the play loop against whichever scene is current. */
  const gameScene = () => {
    const s = game.scenes.current?.scene as
      | Partial<import('./sceneController').SlotSceneController<T>>
      | undefined;
    return typeof s?.present === 'function'
      ? (s as import('./sceneController').SlotSceneController<T>)
      : undefined;
  };

  const { runRound } = await import('./runRound');
  const { createBalanceGate } = await import('./balanceGate');

  // slotPlay references shell via closure — define it after shell is assigned below.
  // We use a late-binding wrapper so the closure captures the variable, not null.
  const slotPlay = createSlotPlay<T>({
    play: (p) => game.platformSession!.play(p),
    normalize: opts.normalize,
    // ACK the result AFTER the scene animates it (the scene calls host.ack()). On Stake this
    // triggers /wallet/end-round so a winning round settles post-animation instead of staying
    // open and blocking the next spin.
    ack: (raw) => game.platformSession!.playAck(raw as import('@energy8platform/platform-core').PlayResultData),
  });

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
    // SINGLE source of truth for the symbol: the Stake bridge already puts a full CurrencyMetaData
    // (symbol + placement) on initData.config.currency. In the non-stake/devBridge path that meta
    // is absent and we only have the spec's currency CODE — resolve it through the SAME table
    // (stake-bridge's lookupCurrency) so e.g. 'EUR' renders as '€', not the literal text "EUR".
    // stake-bridge ships with every scaffold; if it's somehow absent we degrade to the code.
    let currencyMeta = config?.currency;
    if (!currencyMeta?.symbol && opts.model.spec.currency) {
      try {
        const { lookupCurrency } = await import('@energy8platform/stake-bridge');
        currencyMeta = lookupCurrency(opts.model.spec.currency);
      } catch { /* stake-bridge not installed — resolveCurrency falls back to the code */ }
    }
    const runtime = {
      balance,
      currency: resolveCurrency(currencyMeta, opts.model.spec.currency),
      language: initData?.lang,
      mode,
      social: config?.socialMode,
      disclaimerLines: config?.disclaimerLines,
    };
    if (opts.dev) {
      // Dev-only diagnostic. Logged as PLAIN STRINGS (not collapsed objects) so the values are
      // readable in the console without expanding. If the shown symbol is a bare code ("EUR")
      // instead of a glyph ("€"), paste this whole line.
      const cc = config?.currency as { code?: string; symbol?: string } | undefined;
      console.info(
        `[e8] currency → bridge.code=${cc?.code ?? '∅'} bridge.symbol=${cc?.symbol ?? '∅'} ` +
        `| spec=${opts.model.spec.currency ?? '∅'} ` +
        `| RESOLVED.symbol=${runtime.currency?.symbol ?? '∅'} pos=${runtime.currency?.position ?? '∅'}`,
      );
    }
    shell = createGameShell(buildShellConfig(opts.shell, opts.model, runtime));
    // The gate tracks the live wallet (for the affordability guard) but only PAINTS the balance per
    // the HUD-timing rule: the debit is buffered during play→present and shown at afterPresent; the
    // async win credit (/wallet/end-round, after the final ack) paints when it lands. `balanceGate`
    // is the single source for both the displayed balance and `ensureAffordable`.
    const balanceGate = createBalanceGate((b) => shell!.setBalance(b), balance);
    ps?.on('balanceUpdate', (d: { balance: number }) => { balanceGate.onBalance(d.balance); });

    // Live turbo level (0..3) — read fresh on each ctx.turbo access so a mid-round toggle is honoured.
    let currentTurbo = shell.state.turbo;
    shell.on('turboChange', (level: number) => { currentTurbo = level; });

    const roleOf = (action: string) => opts.model.spec.actions[action]?.role;
    const makeContext = (action: string): import('./sceneController').RenderContext => ({
      bet: currentBet,
      action,
      mode: opts.model.modeMap[action] ?? action.toUpperCase(),
      formatAmount: (v) => shell!.formatWin(v),
      get turbo() { return currentTurbo; },
    });
    /** Drive a full round (trigger + drain) against the current scene. HUD readouts (win + balance)
     *  update only AFTER each present(), per the HUD-timing requirement. */
    const playRound = (action: string) => {
      const scene = gameScene();
      if (!scene) return;
      void runRound<T>(
        {
          // Suppress the debit paint from play() until this segment's afterPresent (HUD timing).
          play: (a, b, rid) => { balanceGate.beginPlay(); return slotPlay.play(a, b, rid); },
          ack: slotPlay.ack,
          scene,
          context: makeContext,
          roleOf,
          afterPresent: (r) => { shell!.setWin(r.totalWin); balanceGate.afterPresent(); },
        },
        action,
      );
    };

    if (mode === 'base') {
      let activeFeature: string | null = null;
      shell.on('featureActivate', ({ id }: { id: string }) => { activeFeature = id; });
      shell.on('featureDeactivate', ({ id: _id }: { id: string }) => { activeFeature = null; });

      const { stakeForAction } = await import('./shellConfig');
      // Guard a play: if the stake exceeds the balance, show a shell modal and DON'T play.
      const ensureAffordable = (action: string): boolean => {
        if (stakeForAction(opts.model, action, currentBet) <= balanceGate.balance + 1e-9) return true;
        shell!.openModal({
          availableClose: true,
          title: shell!.t('Insufficient balance'),
          body: shell!.t('You don’t have enough balance for this bet. Lower your bet or top up.'),
          actions: [{ title: shell!.t('OK') }],
        });
        return false;
      };

      shell.on('spin', () => {
        const action = activeFeature ?? 'spin';
        if (!ensureAffordable(action)) return;
        playRound(action);
      });
      shell.on('betChange', (bet: number) => { currentBet = bet; });
      shell.on('buyBonusSelect', ({ id }: { id: string }) => {
        if (!ensureAffordable(id)) return;
        playRound(id);
      });

      // Resume offer: when the game scene is (or becomes) current on a reload, ask the host whether
      // a round is still open. If so, offer Continue (replay its animation, then settle) or Finish
      // (settle now). Settlement is the same playAck path a normal spin uses. Runs at most once.
      let resumeOffered = false;
      const offerResume = async () => {
        if (resumeOffered || !shell || !gameScene()) return;
        resumeOffered = true;
        let snap: import('@energy8platform/platform-core').PlayResultData | null = null;
        try { snap = await ps?.getState() ?? null; } catch { snap = null; }
        if (!snap) return;
        const result = opts.normalize(snap as unknown);
        shell.openModal({
          availableClose: false,
          title: shell.t('Unfinished round'),
          body: shell.t('You have an unfinished round. Continue it or finish it now?'),
          actions: [
            { title: shell.t('Continue'), on: () => { void (async () => {
              await gameScene()?.present?.(result, makeContext((snap as { action?: string }).action ?? 'spin'));
              ps?.playAck(snap!);
            })(); } },
            { title: shell.t('Finish'), on: () => { ps?.playAck(snap!); } },
          ],
        });
      };
      game.scenes.on('change', () => { void offerResume(); });
      void offerResume();
    } else {
      const stakeMode = stakeBridge?.replayMode ?? 'BASE';
      const bonusId = resolveReplayBonusId(opts.model, stakeMode);
      // The replayed round's OWN bet + payout (fetched up front per Stake rules), not the spec's
      // default bet — otherwise the replay modal always shows bet 1.
      const replayBet = stakeBridge?.replayBet || currentBet;
      currentBet = replayBet;
      // onReplay only spins — the shell reopens the modal after it resolves; never call openReplay inside onReplay (double-open).
      shell.openReplay({
        bonusId,
        bet: replayBet,
        payoutMultiplier: stakeBridge?.replayPayoutMultiplier ?? 0,
        onReplay: () => playRound(bonusId),
      });
    }
  }

  return { game, stakeBridge, shell };
}
