// packages/game-engine/src/host/createSlotGame.ts
import { Container } from 'pixi.js';
import { GameApplication } from '../core';
import { buildAppConfig } from './buildConfig';
import { loadFonts, applyTextureDefaults, bootGuard } from './preboot';
import { showFatalError, installGlobalErrorHandlers } from './fatalError';
import type { CreateSlotGameOptions, SlotGameHandle } from './types';
import type { SlotSpinResultBase } from '@energy8platform/platform-core/slot-result';
import type { ShellMode } from '@energy8platform/shell/pixi';
import type { SceneApi, SlotSceneController } from './sceneController';

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
  const { createSlotPlay, enrichRoundMeta } = await import('./slotPlay');

  // Injected once per controller scene the first time it becomes current (see `ensureCreated`).
  // `sceneApi` is assembled inside the shell block; until then injection is a no-op (a shell-less
  // launch never builds the api, so a controller scene simply never receives onCreate).
  let sceneApi: SceneApi | null = null;
  const createdScenes = new WeakSet<object>();
  const ensureCreated = (s: SlotSceneController<T>) => {
    if (!sceneApi || createdScenes.has(s)) return;
    createdScenes.add(s);
    s.onCreate?.(sceneApi);
  };

  /** The current scene IFF it implements the SlotSceneController contract (duck-typed on
   *  `onSpin`). The host drives the play loop against whichever scene is current. Injects the
   *  SceneApi via onCreate the first time a controller scene is seen. */
  const gameScene = () => {
    const s = game.scenes.current?.scene as Partial<SlotSceneController<T>> | undefined;
    if (typeof s?.onSpin !== 'function') return undefined;
    const scene = s as SlotSceneController<T>;
    ensureCreated(scene);
    return scene;
  };

  const { runRound } = await import('./runRound');
  const { createBalanceGate } = await import('./balanceGate');
  const { createFreeSpinsCounter } = await import('./freeSpinsCounter');
  const { resolvePlayError } = await import('./playError');

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
    const { createPixiShell } = await import('@energy8platform/shell/pixi');
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
        jurisdiction?: import('./shellConfig').JurisdictionRestrictions;
        betLevels?: number[];
        defaultBet?: number;
        stake?: { defaultBetLevel?: number };
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
      jurisdiction: config?.jurisdiction,
      // Currency-specific ladder + per-currency default from /wallet/authenticate (Stake);
      // absent on dev/devBridge → buildShellConfig falls back to the spec.
      betLevels: config?.betLevels,
      defaultBet: config?.stake?.defaultBetLevel ?? config?.defaultBet,
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
    // pixi-shell mounts its root onto the engine's unscaled, screen-space UI layer (above the
    // scaled world/scene root) so the control bar fills the real screen, not the letterboxed game.
    // The host adds the mount target (`app`) + parent; buildShellConfig produces everything else.
    const pixiShellCfg: import('@energy8platform/shell/pixi').PixiShellConfig = { ...buildShellConfig(opts.shell, opts.model, runtime), app: game.app, parent: game.uiLayer };
    // The game may swap in its own shell (a custom renderer over the same core) via shellFactory;
    // default is the built-in Pixi shell. The host drives whichever it gets through the Shell contract.
    shell = (opts.shellFactory ?? createPixiShell)(pixiShellCfg);
    // Scope the bar to the slot scene: show only when a SlotSceneController scene is current
    // (hidden over the intro / non-slot scenes). Applies in BOTH base and replay modes.
    shell.setVisible(!!gameScene());
    game.scenes.on('change', () => shell!.setVisible(!!gameScene()));
    // The gate tracks the live wallet (for the affordability guard) but only PAINTS the balance per
    // the HUD-timing rule: the debit is buffered during play→present and shown at afterPresent; the
    // async win credit (/wallet/end-round, after the final ack) paints when it lands. `balanceGate`
    // is the single source for both the displayed balance and `ensureAffordable`.
    const balanceGate = createBalanceGate((b) => shell!.setBalance(b), balance);
    ps?.on('balanceUpdate', (d: { balance: number }) => { balanceGate.onBalance(d.balance); });

    // Live turbo level (0..3) — read fresh on each ctx.turbo access so a mid-round toggle is honoured.
    let currentTurbo = shell.state.turbo;
    shell.on('turboChange', (level: number) => { currentTurbo = level; gameScene()?.onTurboChanged?.(level); });
    // Double-tap-to-skip is a game-level option (default on), set once via createSlotGame({ skipGesture }).
    const skipEnabled = opts.skipGesture ?? true;

    // Shell settings → engine state. Sound/volume map onto the AudioManager.
    shell.on('settingChange', ({ key, value }: { key: string; value: unknown }) => {
      switch (key) {
        case 'sound': value ? game.audio.unmuteAll() : game.audio.muteAll(); break;
        case 'master': game.audio.setMasterVolume(Number(value)); break;
        case 'music': game.audio.setVolume('music', Number(value)); break;
        case 'sfx': game.audio.setVolume('sfx', Number(value)); break;
      }
    });

    // Overlay layer sits ABOVE the shell (the shell already mounted its root onto the uiLayer;
    // adding ours afterwards keeps it on top). It eats pointer events while open so shell controls
    // are unreachable. Mounted on the same unscaled UI layer; tracks viewport via game's 'resize'.
    const { createSceneAudio } = await import('./sceneAudio');
    const { createOverlayController } = await import('./overlayController');
    const overlayLayer = new Container();
    overlayLayer.label = 'overlay';
    game.uiLayer.addChild(overlayLayer);
    const overlayCtl = createOverlayController({
      parent: overlayLayer,
      size: () => ({ width: game.app.screen.width, height: game.app.screen.height }),
    });
    game.on('resize', ({ width, height }: { width: number; height: number }) =>
      overlayCtl.resize(width, height),
    );

    // Capabilities injected once per controller scene via onCreate (see `gameScene`/`ensureCreated`).
    sceneApi = {
      audio: createSceneAudio(game.audio),
      overlay: overlayCtl.overlay,
      shell: { get safeArea() { return shell!.safeArea; } },
      formatAmount: (v) => shell!.formatWin(v),
      get bet() { return currentBet; },
      get mode() { return opts.model.modeMap['spin'] ?? 'BASE'; },
      get turbo() { return currentTurbo; },
    };

    const roleOf = (action: string) => opts.model.spec.actions[action]?.role;
    // The signal-less context. runRound injects a per-segment `signal` (for skip); resumeDrain
    // attaches its own. So makeContext returns everything BUT `signal`.
    const makeContext = (
      action: string,
    ): Omit<import('./sceneController').RenderContext, 'signal'> => ({
      bet: currentBet,
      action,
      mode: opts.model.modeMap[action] ?? action.toUpperCase(),
      formatAmount: (v) => shell!.formatWin(v),
      get turbo() { return currentTurbo; },
    });
    // Play-error + connection handling. A play rejection is classified into a player-facing modal
    // (ACTIVE_SESSION_EXISTS → Reload, etc.) instead of a misleading reconnect overlay; the reconnect
    // overlay is suppressed while a play-error modal owns the screen.
    let playErrorOpen = false;
    let stopAutoplay: () => void = () => {}; // wired to the autoplay loop once it's created (below)
    const showPlayError = (err: unknown): void => {
      stopAutoplay(); // a play error halts an autoplay run (the .catch swallows, so stop explicitly)
      const v = resolvePlayError(err);
      playErrorOpen = true;
      shell!.openModal({
        availableClose: !v.reload,
        title: shell!.t(v.title),
        body: shell!.t(v.body),
        actions: v.reload
          ? [{ title: shell!.t('Reload'), on: () => { try { window.location.reload(); } catch { /* non-browser */ } } }]
          : [{ title: shell!.t('OK'), on: () => { playErrorOpen = false; } }],
      });
    };
    ps?.on('connectionStateChanged', (s: { status: string }) => {
      if (s.status === 'restored') { if (!playErrorOpen) shell!.closeModal(); return; }
      if (playErrorOpen) return; // a play-error modal owns the screen — don't mask it with "reconnecting"
      shell!.openModal({
        availableClose: false,
        title: shell!.t('Reconnecting…'),
        body: shell!.t('Lost connection to the game server. Trying to reconnect…'),
      });
    });

    // Skip state: `currentSegmentAbort` is the controller for the segment presently animating;
    // `presenting` is true for the whole play→drain window (gates the double-tap detector so taps
    // only skip while a round is animating).
    let currentSegmentAbort: AbortController | null = null;
    let presenting = false;

    // Double-tap skip: a double-tap on the play area aborts the current segment (the scene collapses
    // to its final visual via ctx.signal) and notifies the scene's onSkip. Gated by the shell's
    // skip-gesture setting (`skipEnabled`) and only active while a round is presenting.
    const { createDoubleTapSkip } = await import('./skipGesture');
    const skip = createDoubleTapSkip({
      enabled: () => skipEnabled,
      active: () => presenting,
      onSkip: () => { currentSegmentAbort?.abort(); gameScene()?.onSkip?.(); },
    });
    // Listen for taps on the scene root (game.worldRoot — the scaled scene container). The shell
    // lives on the sibling uiLayer, so its bar taps never reach worldRoot — taps here are the play area.
    game.scenes.root.eventMode = 'static';
    game.scenes.root.on('pointertap', () => skip.tap(performance.now()));

    // Full auto-pause: on tab blur, freeze the ticker (stops tweens/onUpdate/in-flight onSpin),
    // duck music to silence, hold autoplay, and notify the scene. On focus, reverse it all.
    // `stopAutoplay` is reassigned in the base-mode block below — the closure reads it live.
    const { createPauseController } = await import('./pauseController');
    createPauseController({
      isHidden: () => typeof document !== 'undefined' && document.hidden,
      subscribe: (cb) => {
        if (typeof document === 'undefined') return () => {};
        document.addEventListener('visibilitychange', cb);
        return () => document.removeEventListener('visibilitychange', cb);
      },
      onHidden: () => {
        game.app.ticker.stop();    // freezes tweens, onUpdate, in-flight onSpin animation
        game.audio.duckMusic(0);   // silence music (ducked to 0; restored on resume)
        stopAutoplay();            // hold autoplay — don't start the next auto-round
        gameScene()?.onPause?.();
      },
      onVisible: () => {
        game.app.ticker.start();
        game.audio.unduckMusic();
        gameScene()?.onResume?.();
      },
    });

    /** Drive a full round (trigger + drain) against the current scene. HUD readouts (win + balance)
     *  update only AFTER each onSpin(), per the HUD-timing requirement. */
    const playRound = (action: string) => {
      const scene = gameScene();
      if (!scene) return;
      // Per-round free-spins state: the shell enters FS mode on bonus-enter and shows current/total
      // (growing on retriggers) + cumulative win per spin. `inBonus` gates the per-spin counter so
      // the trigger segment (rendered by onSpin before onEnterMode) doesn't count as a free spin.
      let inBonus = false;
      let prevWin = 0; // cumulative win up to the previous segment — the WIN readout shows the delta
      const fsCounter = createFreeSpinsCounter();
      shell!.setBusy(true); // block re-spin / spacebar while the round plays out
      presenting = true; // open the skip window for the whole play→drain
      // RETURN the promise: the replay modal awaits onReplay() and only reopens once the round's
      // animation has finished — returning void would reopen it instantly, over a running animation.
      return runRound<T>(
        {
          // Suppress the debit paint from play() until this segment's afterPresent (HUD timing).
          play: (a, b, rid) => { balanceGate.beginPlay(); return slotPlay.play(a, b, rid); },
          ack: slotPlay.ack,
          scene,
          context: makeContext,
          roleOf,
          // Hand the host the per-segment AbortController so a double-tap can skip the live segment.
          beforeSegment: (ac) => { currentSegmentAbort = ac; },
          onSpinStart: () => scene.onSpinStart?.(),
          onSpinEnd: (last, ctx) => scene.onSpinEnd?.(last, ctx),
          afterPresent: (r) => {
            // WIN readout = THIS spin's win (cumulative delta); the cumulative total goes to the
            // free-spins counter (totalWin) below, not the WIN readout.
            shell!.setWin(r.totalWin - prevWin);
            prevWin = r.totalWin;
            balanceGate.afterPresent();
            if (inBonus) shell!.setFreeSpins(fsCounter.spin(r.freeSpins?.awarded ?? 0, r.totalWin));
          },
          onEnterMode: async (trigger, ctx) => {
            inBonus = true;
            shell!.setMode('freeSpins');
            shell!.setFreeSpins(fsCounter.enter(trigger.freeSpins?.awarded ?? trigger.freeSpins?.total ?? 0));
            await scene.onEnterMode?.(trigger, ctx);
          },
          onExitMode: async (last, ctx) => {
            inBonus = false;
            await scene.onExitMode?.(last, ctx);
            shell!.setMode('base');
          },
        },
        action,
      ).catch(showPlayError).finally(() => { presenting = false; shell!.setBusy(false); });
    };

    /**
     * Drain a recovered open round to completion and settle it. Plays EVERY remaining segment from
     * the bonus start (Continue animates each; Finish fast-forwards without animation), reaching the
     * final ack so /wallet/end-round credits the win — fixing the old resume that presented one
     * snapshot and never settled. The original trigger is gone on reload, so the FS counter here uses
     * the bridge's session counts; FS mode is entered/exited around the drain.
     */
    const resumeDrain = async (
      firstRaw: import('@energy8platform/platform-core').PlayResultData,
      animate: boolean,
    ): Promise<void> => {
      const scene = gameScene();
      if (!scene || !ps) return;
      // A recovered drain isn't skippable (no live skip gesture wired to it), so it gets a stable,
      // never-aborted signal to satisfy onSpin's RenderContext.
      const ctx: import('./sceneController').RenderContext = {
        ...makeContext((firstRaw as { action?: string }).action ?? 'spin'),
        signal: new AbortController().signal,
      };
      const fsView = (raw: unknown, totalWin: number) => {
        const s = (raw as { session?: { spinsPlayed?: number; spinsRemaining?: number } }).session;
        if (!s) return null;
        // The bridge session counts ALL segments incl. the trigger (segment 0); the free-spins
        // counter is over FREE spins only, so drop the one trigger segment → 1/10, not 2/11.
        const played = s.spinsPlayed ?? 0;
        const current = Math.max(0, played - 1);
        const total = Math.max(0, played + (s.spinsRemaining ?? 0) - 1);
        return { current, total, totalWin };
      };
      let raw = firstRaw;
      let r = enrichRoundMeta(opts.normalize(raw), raw);
      let inBonus = false;
      let prevWin = 0; // cumulative win up to the previous segment — WIN readout shows the delta
      const applySegment = async (): Promise<void> => {
        // A recovered open round with remaining segments is a bonus → show FS mode + counter.
        if (!inBonus && !r.complete) { inBonus = true; shell!.setMode('freeSpins'); }
        if (animate) await scene.onSpin(r, ctx);
        if (inBonus) { const v = fsView(raw, r.totalWin); if (v) shell!.setFreeSpins(v); }
        shell!.setWin(r.totalWin - prevWin); // THIS spin's win, not the cumulative bonus total
        prevWin = r.totalWin;
        ps!.playAck(raw); // settles via /wallet/end-round on the FINAL segment
      };
      shell!.setBusy(true); // block input while the recovered round drains
      try {
        await applySegment();
        while (!r.complete && r.nextActions && r.nextActions.length > 0) {
          raw = (await ps.play({ action: r.nextActions[0], bet: ctx.bet, roundId: r.roundId })) as
            import('@energy8platform/platform-core').PlayResultData;
          r = enrichRoundMeta(opts.normalize(raw), raw);
          await applySegment();
        }
        if (inBonus) shell!.setMode('base');
      } finally {
        shell!.setBusy(false);
      }
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
        void playRound(action);
      });
      shell.on('betChange', (bet: number) => { currentBet = bet; gameScene()?.onBetChanged?.(bet); });
      shell.on('buyBonusSelect', ({ id }: { id: string }) => {
        if (!ensureAffordable(id)) return;
        void playRound(id);
      });

      // Autoplay: the shell owns the picker/confirm/STOP/counter/lockout (all driven by state.autoplay);
      // the host just runs the loop and pushes the per-spin remaining back via setAutoplay.
      const { createAutoplayLoop } = await import('./autoplay');
      const autoplay = createAutoplayLoop({
        resolveAction: () => activeFeature ?? 'spin',
        canAfford: (a) => ensureAffordable(a),
        playRound: (a) => Promise.resolve(playRound(a)),
        onState: (s) => {
          shell!.setAutoplay(s);
          gameScene()?.onAutoplayChanged?.({ running: s.active, remaining: s.remaining });
        },
      });
      stopAutoplay = () => autoplay.stop();
      shell.on('autoplayStart', (o: { remaining?: number }) => autoplay.start(o?.remaining ?? 0));
      shell.on('autoplayStop', () => autoplay.stop());

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
        shell.openModal({
          availableClose: false,
          title: shell.t('Unfinished round'),
          body: shell.t('You have an unfinished round. Continue it or finish it now?'),
          actions: [
            // Continue: replay the round from the start with animation, then settle.
            { title: shell.t('Continue'), on: () => { void resumeDrain(snap!, true); } },
            // Finish: fast-forward the remaining segments (no animation) to settle the win now.
            { title: shell.t('Finish'), on: () => { void resumeDrain(snap!, false); } },
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
