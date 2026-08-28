// packages/game-engine/src/host/createSlotGame.ts
import { Container } from 'pixi.js';
import { GameApplication } from '../core';
import { buildAppConfig } from './buildConfig';
import { loadFonts, applyTextureDefaults, bootGuard } from './preboot';
import { showFatalError, installGlobalErrorHandlers } from './fatalError';
import type { CreateSlotGameOptions, SlotGameHandle } from './types';
import { releaseExternalOverlay } from '@energy8platform/platform-core/loading';
import type { SlotSpinResultBase } from '@energy8platform/platform-core/slot-result';
import type { ShellMode } from '@energy8platform/shell/pixi';
import type { SceneApi, SlotSceneController, RenderContext } from './sceneController';
import type { ConnectionState } from './connectionRecovery';
import type { FreeSpinsView } from './freeSpinsCounter';

/**
 * One-call slot bootstrap: preboot → (optional Stake / Artube bridge) → GameApplication
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
    // Take down a game-supplied loading overlay (`loading.externalOverlay`) first. Several fatal
    // paths below — a refused Artube launch, a bridge that cannot connect — happen BEFORE
    // `GameApplication.start()`, so its own error path never runs and nothing else would ever
    // dismiss the overlay. Artube's is already on screen from index.html at z-index 9999: leaving
    // it up means the player stares at a frozen loading screen, and a custom `onFatalError`
    // renderer would be hidden underneath it entirely.
    //
    // `releaseExternalOverlay` handles the case where the engine already adopted it (and keeps the
    // dismissal idempotent, which matters now that the normal hand-over also dismisses it). Its
    // `false` means the engine never got that far — those are exactly the pre-boot refusals, where
    // hiding the game's overlay directly is the only thing that can work.
    if (!releaseExternalOverlay()) {
      try {
        opts.loading?.externalOverlay?.hideLoader();
      } catch {
        /* the overlay is the game's; a throw here must not swallow the error we came to report */
      }
    }
    if (opts.onFatalError) return opts.onFatalError(message);
    // Once the shell is up, use ITS branded modal (consistent chrome, social vocabulary, fit
    // scaling) rather than the bare DOM fallback. Errors thrown before the shell boots (asset
    // load, SDK handshake) still get the standalone overlay.
    if (shell) {
      shell.openModal({
        availableClose: false,
        title: shell.t('Something went wrong'),
        body: shell.t(message),
        actions: [
          {
            title: shell.t('Reload'),
            on: () => {
              try {
                location.reload();
              } catch {
                /* non-browser */
              }
            },
          },
        ],
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
    const { classifyStakeLaunch } = await import('@energy8platform/stake-bridge/detect');
    // Security gate: a launch carrying Stake session markers (sessionID / replay) MUST also carry a
    // valid rgs_url. If the rgs_url was removed, blanked, or tampered to a non-Stake host, refuse to
    // run — WITHOUT this the launch would fail the Stake check and silently fall through to the
    // offline/dev bridge, letting the player spin for free. 'stake' = a valid launch (load the
    // bridge); 'offline' = a genuine non-Stake/dev launch (no session markers at all).
    const launch = classifyStakeLaunch(location.href);
    if (launch === 'blocked') {
      fatal('Invalid game server address. Please relaunch the game from the lobby.');
      throw new Error(
        'createSlotGame: refusing to run — Stake launch with a missing or invalid rgs_url',
      );
    }
    isStakeNow = launch === 'stake';
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

  let artubeBridge: SlotGameHandle['artubeBridge'] = null;
  let isArtubeNow = false;
  // `!isStakeNow`: both bridges install themselves in-process on the SAME SDK memory channel, so
  // whichever launch already claimed the game wins. (The two launch shapes are disjoint in practice
  // — Stake's marker is `sessionID`/`replay`, Artube's is `sessionId` — so this never fires; it just
  // makes the precedence explicit rather than leaving two bridges racing.)
  if (opts.artube && !isStakeNow) {
    // The GAME supplies the loader (see `ArtubeIntegration.load`): a bare
    // `import('@energy8platform/artube-bridge')` here would be resolved statically by every bundler
    // and would break — loudly or, under Vite, silently — every game that never installed the
    // package. Classifier and bridge come from the same module, so this is one load.
    let artube: import('./types').ArtubeModule;
    try {
      artube = await opts.artube.load();
    } catch (err) {
      fatal('Could not start the game.');
      throw err;
    }
    // Security gate, the Artube counterpart of the Stake one above. Artube's only launch marker is
    // `sessionId`, and unlike Stake there is no attacker-suppliable server address to validate
    // (`apiBase` is derived from the launch URL's own PATH, never from a query param — see
    // ArtubeUrlParams.apiBase). What IS reachable is stripping the session: a URL
    // that carries `sessionId` with an empty/blank value claims a session it doesn't have, fails the
    // "is this Artube?" check, and would silently fall through to the offline/dev bridge — the
    // free-play hole. 'artube' = a real launch (load the bridge); 'offline' = no marker at all, a
    // genuine dev launch.
    //
    // What URL classification cannot catch: a marker removed ENTIRELY is indistinguishable from a
    // dev launch. In a production BUILD there is nothing to fall through to anyway — the DevBridge
    // bootstrapper is injected by a Vite plugin with `apply: 'serve'`, so no build carries one,
    // whatever BUILD_TARGET says. Under a plain `npm run dev` the bootstrapper HAS already started a
    // DevBridge before this code runs (it wraps the entry module), so there the protection is this
    // gate refusing to start the game — not the absence of a bridge.
    const launch = artube.classifyArtubeLaunch(location.href);
    if (launch === 'blocked') {
      fatal('Invalid game session. Please relaunch the game from the lobby.');
      throw new Error(
        'createSlotGame: refusing to run — Artube launch with a missing or blank sessionId',
      );
    }
    isArtubeNow = launch === 'artube';
    if (isArtubeNow) {
      try {
        artubeBridge = new artube.ArtubeBridge({
          // In-process over the SDK's MemoryChannel (see buildAppConfig's devMode).
          devMode: true,
          gameId: opts.model.spec.id,
          url: location.href,
          // Derived from the launch path in production; both fields are escape hatches (see ArtubeIntegration).
          ...(opts.artube.apiBase ? { apiBase: opts.artube.apiBase } : {}),
          ...(opts.artube.demoBalance != null ? { demoBalance: opts.artube.demoBalance } : {}),
        });
        await artubeBridge.ready();
      } catch (err) {
        fatal('Could not connect to the game server. Please reload.');
        throw err;
      }
    }
  }

  const game = new GameApplication(buildAppConfig(opts, isStakeNow, isArtubeNow));

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
  const { attachSettingsStore } = await import('./settingsStore');
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
    ack: (raw) =>
      game.platformSession!.playAck(raw as import('@energy8platform/platform-core').PlayResultData),
  });

  if (opts.shell) {
    const { createPixiShell } = await import('@energy8platform/shell/pixi');
    const { buildShellConfig } = await import('./shellConfig');
    const { resolveReplayBonusId } = await import('./replay');

    const ps = game.platformSession;
    const balance = (game.initData?.balance as number | undefined) ?? 0;
    // Replay is a STAKE concept (a shared link that re-plays one recorded round). Artube has no
    // equivalent, so an Artube launch is always 'base' — nothing to mirror here.
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
        stake?: { defaultBetLevel?: number; minBet?: number; maxBet?: number };
        /** Set by the Stake bridge when `/wallet/authenticate` returned a still-open round. */
        activeRound?: { bet?: number; roundId?: string; mode?: string };
        /** Artube's platform block. The default bet arrives as an INDEX into `config.betLevels`
         *  (the platform's `allowed_bets`), where Stake states an amount. */
        artube?: { defaultBetIndex?: number };
      };
      /** Present only on a resume — the bridge synthesises it from the open round. Both the Stake
       *  and the Artube bridge fill it the same way, so the resumed-bet path below is shared. */
      session?: { betAmount?: number };
      /** Session currency CODE. The Artube bridge's only currency surface (the platform picks it
       *  per session; a demo session is labelled 'DEMO'); Stake sends full meta on
       *  `config.currency` instead. */
      currency?: string;
      lang?: string;
      /** The client the platform launched us on. Both bridges read it off the launch URL
       *  (Stake's `device=`, Artube's `device=`); absent on dev/devBridge launches. */
      device?: string;
    } | null;
    const config = initData?.config;
    // A reload mid-round is just another entry: authenticate answers with BOTH the currency's
    // default bet and the round still open from the previous page-load. That round was played at
    // its own stake, so the default is the wrong bet to come back on — the bar would show it while
    // the resume drain (and the ×bet win data the scene renders) ran against something else.
    // `config.activeRound.bet` is the bridge stating it outright; `session.betAmount` is the older
    // carrier for the same value (INIT only ever has a session on a resume). Both are ignored when
    // absent or 0 so an ordinary launch still starts on the default.
    const resumedBet = config?.activeRound?.bet || initData?.session?.betAmount || undefined;
    // Artube states its per-session default bet as an INDEX into the platform's ladder; resolve it
    // against that SAME ladder so `runtime.defaultBet` is an amount on both platforms.
    const artubeDefaultBet = isArtubeNow
      ? config?.betLevels?.[config?.artube?.defaultBetIndex ?? -1]
      : undefined;
    const { resolveCurrency } = await import('./shellConfig');
    // SINGLE source of truth for the symbol: the Stake bridge already puts a full CurrencyMetaData
    // (symbol + placement) on initData.config.currency. In the non-stake/devBridge path that meta
    // is absent and we only have the spec's currency CODE — resolve it through the SAME table
    // (stake-bridge's lookupCurrency) so e.g. 'EUR' renders as '€', not the literal text "EUR".
    // stake-bridge ships with every scaffold; if it's somehow absent we degrade to the code.
    // On Artube the session currency is the PLATFORM's (per player, and the word 'DEMO' for a demo
    // session — see artube-bridge's displayCurrency) and arrives as a bare code on initData — there
    // is no meta object. It outranks the spec's static code, which would otherwise show every
    // Artube player the spec's currency symbol.
    const currencyCode = (isArtubeNow ? initData?.currency : undefined) || opts.model.spec.currency;
    let currencyMeta = config?.currency;
    if (!currencyMeta?.symbol && currencyCode) {
      try {
        const { lookupCurrency } = await import('@energy8platform/stake-bridge');
        currencyMeta = lookupCurrency(currencyCode);
      } catch {
        /* stake-bridge not installed — resolveCurrency falls back to the code */
      }
    }
    const runtime = {
      balance,
      currency: resolveCurrency(currencyMeta, currencyCode),
      language: initData?.lang,
      mode,
      social: config?.socialMode,
      disclaimerLines: config?.disclaimerLines,
      jurisdiction: config?.jurisdiction,
      // Decides whether the shell offers a keyboard at all — see buildShellConfig.
      device: initData?.device,
      // Currency-specific ladder + per-currency default from /wallet/authenticate (Stake) or the
      // backend's `allowed_bets` (Artube); absent on dev/devBridge → buildShellConfig falls back to
      // the spec.
      betLevels: config?.betLevels,
      defaultBet:
        resumedBet ?? config?.stake?.defaultBetLevel ?? artubeDefaultBet ?? config?.defaultBet,
      // Hard stake window; the bridge rejects anything outside it before /bet/play.
      minBet: config?.stake?.minBet,
      maxBet: config?.stake?.maxBet,
    };
    // On a real Stake launch the ladder is CURRENCY-SPECIFIC and mandatory. Falling back to the
    // spec's (EUR-shaped) ladder here would put the game on bets the wallet can't honour — every
    // spin rejected on a high-denomination currency (ARS minBet 50), or silently mispriced. Fail
    // where the cause is visible instead of at the first spin.
    // Artube is the same requirement by a different route: the wire carries a bet INDEX, not an
    // amount, and the bridge maps the amount the game plays to the NEAREST rung of the platform's
    // ladder — so a spec-shaped ladder wouldn't be rejected, it would silently charge a different
    // price than the bar shows. Refuse there too.
    if ((isStakeNow || isArtubeNow) && !runtime.betLevels?.length) {
      fatal('Could not load the bet levels for your currency. Please relaunch the game.');
      throw new Error(
        `createSlotGame: ${isStakeNow ? 'Stake' : 'Artube'} launch returned no config.betLevels — refusing to fall back to the spec ladder`,
      );
    }
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
    const pixiShellCfg: import('@energy8platform/shell/pixi').PixiShellConfig = {
      ...buildShellConfig(opts.shell, opts.model, runtime),
      app: game.app,
      parent: game.uiLayer,
    };
    // Adopt the bet the shell is about to display. `currentBet` was seeded from the SPEC above,
    // which is only ever right by accident: the authoritative default is the per-currency one from
    // /wallet/authenticate. The shell re-syncs us on `betChange`, but that fires ONLY when the
    // player moves the bet — so without this the FIRST spin (and any bonus buy before it) plays at
    // the spec's bet while the bar shows the RGS one.
    currentBet = pixiShellCfg.currentBet ?? currentBet;
    // The game may swap in its own shell (a custom renderer over the same core) via shellFactory;
    // default is the built-in Pixi shell. The host drives whichever it gets through the Shell contract.
    shell = (opts.shellFactory ?? createPixiShell)(pixiShellCfg);
    // Opt-in, per game, and BEFORE `currentTurbo` is seeded from `shell.state.turbo` below — the
    // restored level has to be in place by the time the host reads it, or the first spin would run
    // at the default speed while the bar shows the remembered one. `features.turbo` is passed as the
    // ceiling so a jurisdiction that capped turbo still wins over whatever is in storage.
    if (opts.persistSettings) {
      const p = opts.persistSettings === true ? {} : opts.persistSettings;
      attachSettingsStore(shell, {
        key: p.key ?? opts.model.spec.id,
        storage: p.storage,
        maxTurbo: pixiShellCfg.features.turbo,
      });
    }
    // Scope the bar to the slot scene: show only when a SlotSceneController scene is current
    // (hidden over the intro / non-slot scenes). Applies in BOTH base and replay modes.
    shell.setVisible(!!gameScene());
    game.scenes.on('change', () => shell!.setVisible(!!gameScene()));
    // The gate tracks the live wallet (for the affordability guard) and PAINTS the balance per the
    // HUD-timing rule: the debit paints immediately (the stake leaves the balance on spin); a win
    // credit landing during play→present is held to afterPresent so it doesn't post before the
    // animation; the async credit (/wallet/end-round, after the final ack) paints when it lands.
    // `balanceGate` is the single source for both the displayed balance and `ensureAffordable`.
    const balanceGate = createBalanceGate((b) => shell!.setBalance(b), balance);
    ps?.on('balanceUpdate', (d: { balance: number }) => {
      balanceGate.onBalance(d.balance);
    });

    // Live turbo level (0..3) — read fresh on each ctx.turbo access so a mid-round toggle is honoured.
    let currentTurbo = shell.state.turbo;
    shell.on('turboChange', (level: number) => {
      currentTurbo = level;
      gameScene()?.onTurboChanged?.(level);
    });
    // Double-tap-to-skip is a game-level option (default on), set once via createSlotGame({ skipGesture }).
    const skipEnabled = opts.skipGesture ?? true;

    // Shell settings → engine state. Sound/volume map onto the AudioManager.
    shell.on('settingChange', ({ key, value }: { key: string; value: unknown }) => {
      switch (key) {
        case 'sound':
          value ? game.audio.unmuteAll() : game.audio.muteAll();
          break;
        case 'music':
          game.audio.setVolume('music', Number(value));
          break;
        case 'sfx':
          game.audio.setVolume('sfx', Number(value));
          break;
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

    // Progressive WIN readout for cascade/tumble scenes. The window is open from the moment a
    // segment starts (WIN cleared to 0) until the host has painted that segment's final win; outside
    // it the host owns the readout alone. See winReporter.ts.
    const { createWinReporter } = await import('./winReporter');
    const winReporter = createWinReporter((amount, opts) => shell!.setWin(amount, opts));

    // Capabilities injected once per controller scene via onCreate (see `gameScene`/`ensureCreated`).
    sceneApi = {
      audio: createSceneAudio(game.audio),
      overlay: overlayCtl.overlay,
      shell: {
        get safeArea() {
          return shell!.safeArea;
        },
        reportWin: winReporter.report,
      },
      formatAmount: (v) => shell!.formatWin(v),
      get bet() {
        return currentBet;
      },
      get mode() {
        return opts.model.modeMap['spin'] ?? 'BASE';
      },
      get turbo() {
        return currentTurbo;
      },
    };

    const roleOf = (action: string) => opts.model.spec.actions[action]?.role;
    const isBonusAction = (action: string) => roleOf(action) === 'free';
    // Per-SEGMENT mode string. modeMap intentionally excludes `free` actions (they'd pollute the
    // Game-Info modes table), so a free segment falls back to its spec `mode` (or the action key).
    // This is what distinguishes nested bonuses (FREESPINS vs ADVENTURE) at the transition boundary.
    const segmentModeOf = (action: string) =>
      opts.model.spec.actions[action]?.mode ?? opts.model.modeMap[action] ?? action.toUpperCase();
    // The signal-less context. runRound injects a per-segment `signal` (for skip); resumeDrain
    // attaches its own. So makeContext returns everything BUT `signal`.
    const makeContext = (
      action: string,
    ): Omit<import('./sceneController').RenderContext, 'signal'> => ({
      bet: currentBet,
      action,
      mode: segmentModeOf(action),
      formatAmount: (v) => shell!.formatWin(v),
      get turbo() {
        return currentTurbo;
      },
    });
    // Play-error + connection handling. A play rejection is classified (playError.ts): a failed
    // ROUND gets a player-facing modal (ACTIVE_SESSION_EXISTS → Reload, etc.), a failed LINK gets
    // none — the reconnect overlay owns that screen (connectionRecovery.ts). Either way the failure
    // halts an autoplay run WITHOUT clearing its counter. The overlay stays suppressed while a
    // play-error modal owns the screen.
    let playErrorOpen = false;
    let stopAutoplay: () => void = () => {}; // wired to the autoplay loop once it's created (below)
    let haltAutoplay: () => void = () => {}; // ditto — stops the run but KEEPS its counter
    const reload = () => {
      try {
        window.location.reload();
      } catch {
        /* non-browser */
      }
    };
    const showPlayError = (err: unknown): void => {
      const v = resolvePlayError(err);
      // Halt, don't stop: the spins the player still has coming outlive the failure, so the bar can
      // show them (and offer to resume). The .catch in playRound swallows the rejection, so the
      // autoplay loop can't see it — this is what ends the run.
      haltAutoplay();
      // A failed LINK is not a failed round. The bridge is already reconnecting and the connection
      // overlay owns the screen; a modal here is exactly the "reload the page" screen that showed
      // up on every network blip — and only in autoplay, since only autoplay always has a play in
      // flight when the socket dies.
      if (v.connection) return;
      playErrorOpen = true;
      shell!.openModal({
        availableClose: !v.reload,
        title: shell!.t(v.title),
        body: shell!.t(v.body),
        actions: v.reload
          ? [{ title: shell!.t('Reload'), on: reload }]
          : [
              {
                title: shell!.t('OK'),
                on: () => {
                  playErrorOpen = false;
                },
              },
            ],
      });
    };
    // Connection loss/return. Assigned below, once `resumeDrain` exists: a restored link finishes
    // the round the drop interrupted, and it must not reach the drain before it is defined.
    let recoverRound: (
      snapshot: import('@energy8platform/platform-core').PlayResultData,
    ) => Promise<void> = async () => {};
    const { createConnectionRecovery } = await import('./connectionRecovery');
    const connection = createConnectionRecovery({
      haltAutoplay: () => haltAutoplay(),
      showReconnecting: () =>
        shell!.openModal({
          availableClose: false,
          title: shell!.t('Reconnecting…'),
          body: shell!.t('Lost connection to the game server. Trying to reconnect…'),
        }),
      // The bridge stopped retrying: say so instead of leaving "Reconnecting…" up for good.
      showGone: () =>
        shell!.openModal({
          availableClose: false,
          title: shell!.t('Connection lost'),
          body: shell!.t('Could not reconnect to the game server. Please reload the game.'),
          actions: [{ title: shell!.t('Reload'), on: reload }],
        }),
      dismiss: () => shell!.closeModal(),
      getState: async () => (await ps?.getState()) ?? null,
      drain: (snapshot) => recoverRound(snapshot),
      onError: showPlayError,
      isBlocked: () => playErrorOpen,
    });
    ps?.on('connectionStateChanged', (s: ConnectionState) => void connection.onState(s));

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
      onSkip: () => {
        currentSegmentAbort?.abort();
        gameScene()?.onSkip?.();
      },
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
        game.app.ticker.stop(); // freezes tweens, onUpdate, in-flight onSpin animation
        game.audio.duckMusic(0); // silence music (ducked to 0; restored on resume)
        stopAutoplay(); // hold autoplay — don't start the next auto-round
        gameScene()?.onPause?.();
      },
      onVisible: () => {
        game.app.ticker.start();
        game.audio.unduckMusic();
        gameScene()?.onResume?.();
      },
    });

    /** Push a bonus segment's readout to the shell bar. Default (no `opts.bonus`) = the free-spins
     *  counter (label 'Free spins', value current/total). With `opts.bonus`, the game supplies the
     *  label + value string (adventure / hold-and-spin / respins) and we drive the generic 'bonus'
     *  hero instead — the shell stays free of any per-game bonus concept. */
    const applyBonusReadout = (result: T, view: FreeSpinsView, mode: string): void => {
      const b = opts.bonus;
      if (!b) {
        shell!.setFreeSpins(view);
        return;
      }
      const label = typeof b.label === 'function' ? b.label(mode) : (b.label ?? 'Free spins');
      const value = b.readout
        ? b.readout(result, { view, mode })
        : view.current == null
          ? String(view.total)
          : `${view.current} / ${view.total}`;
      shell!.setBonus({ label, value, totalWin: view.totalWin });
    };
    /** The mode entered via setMode for a bonus — 'bonus' when the game customises the readout,
     *  else 'freeSpins' (the back-compat default the shell already renders). */
    const bonusShellMode: ShellMode = opts.bonus ? 'bonus' : 'freeSpins';

    /** Apply an authoritative book override (freeSpins.total/remaining) onto an accumulated view —
     *  the host counts by default, but if the book resends the count (e.g. a resumed parent after a
     *  nested sub-bonus) that wins. */
    const overrideView = (
      view: FreeSpinsView,
      fs?: SlotSpinResultBase['freeSpins'],
    ): FreeSpinsView => {
      if (!fs) return view;
      const total = fs.total ?? view.total;
      const current = fs.remaining != null ? Math.max(0, total - fs.remaining) : view.current;
      return { current, total, totalWin: view.totalWin };
    };

    interface BonusLevel {
      mode: string;
      counter: ReturnType<typeof createFreeSpinsCounter>;
      view: FreeSpinsView;
    }
    /** A per-round stack of active bonus levels driving the shell bar as levels push/pop. Supports
     *  NESTED bonuses (e.g. free spins → adventure → free spins): each level keeps its own counter,
     *  so a resumed parent restores its remaining count. A single-bonus round pushes once and
     *  unwinds once — byte-identical to the pre-nesting behaviour. */
    const createBonusStack = (scene: SlotSceneController<T>) => {
      const stack: BonusLevel[] = [];
      return {
        inBonus: (): boolean => stack.length > 0,
        /** A bonus level becomes active — a fresh push, or a resumed parent (already on the stack). */
        async enter(mode: string, trigger: T, ctx: RenderContext, resumed: boolean): Promise<void> {
          if (resumed) {
            const lvl = stack[stack.length - 1]; // the parent stayed on the stack; the child popped
            lvl.view = overrideView(lvl.view, trigger.freeSpins);
            applyBonusReadout(trigger, lvl.view, lvl.mode);
          } else {
            const counter = createFreeSpinsCounter();
            const view = overrideView(
              counter.enter(trigger.freeSpins?.awarded ?? trigger.freeSpins?.total ?? 0),
              trigger.freeSpins,
            );
            stack.push({ mode, counter, view });
            if (stack.length === 1) shell!.setMode(bonusShellMode); // base → bonus
            applyBonusReadout(trigger, view, mode);
          }
          // ctx.mode is overridden to the mode being ENTERED so the scene reads the right level.
          await scene.onEnterMode?.(trigger, { ...ctx, mode, resumed });
        },
        /** A bonus level ends — a nested pop back to its parent, or the last level back to base. */
        async exit(mode: string, last: T, ctx: RenderContext): Promise<void> {
          stack.pop();
          await scene.onExitMode?.(last, { ...ctx, mode });
          if (stack.length === 0) {
            shell!.setMode('base');
            // Back in base the FS "Total win" block is gone, so WIN must carry the round's
            // CUMULATIVE total (what got credited) — not the last segment's per-spin delta.
            shell!.setWin(last.totalWin);
          }
          // else: an intermediate pop; the following resume-enter (or next exit) re-paints the bar.
        },
        /** Advance the active level's counter with a settled segment. */
        settle(r: T): void {
          if (stack.length === 0) return;
          const top = stack[stack.length - 1];
          top.view = overrideView(
            top.counter.spin(r.freeSpins?.awarded ?? 0, r.totalWin),
            r.freeSpins,
          );
          applyBonusReadout(r, top.view, top.mode);
        },
      };
    };

    /** Drive a full round (trigger + drain) against the current scene. HUD readouts (win + balance)
     *  update only AFTER each onSpin(), per the HUD-timing requirement. */
    const playRound = (action: string) => {
      const scene = gameScene();
      if (!scene) return;
      // Per-round bonus stack: the shell enters bonus mode on the first level's push and shows the
      // active level's counter + cumulative win. The stack handles NESTED bonuses (free spins →
      // adventure → free spins); a single-bonus round pushes/unwinds once (unchanged).
      const bonus = createBonusStack(scene);
      let prevWin = 0; // cumulative win up to the previous segment — the WIN readout shows the delta
      shell!.setBusy(true); // block re-spin / spacebar while the round plays out
      presenting = true; // open the skip window for the whole play→drain
      // RETURN the promise: the replay modal awaits onReplay() and only reopens once the round's
      // animation has finished — returning void would reopen it instantly, over a running animation.
      return runRound<T>(
        {
          // Open the play→present window: the debit still paints immediately, but a win credit that
          // lands mid-animation is held until afterPresent (HUD timing).
          play: (a, b, rid) => {
            balanceGate.beginPlay();
            return slotPlay.play(a, b, rid);
          },
          ack: slotPlay.ack,
          scene,
          context: makeContext,
          modeOf: segmentModeOf,
          isBonusAction,
          // Hand the host the per-segment AbortController so a double-tap can skip the live segment.
          beforeSegment: (ac) => {
            currentSegmentAbort = ac;
            // Clear the WIN readout the instant a spin starts (base spin AND each free spin), so the
            // previous win doesn't linger through the animation. Snap (no count-down) — afterPresent
            // then counts UP to this segment's delta. prevWin (the cumulative-delta tracker) is
            // untouched; this only resets the DISPLAY.
            shell!.setWin(0, { animate: false });
            winReporter.open(); // the scene may now grow WIN per cascade step
          },
          onSpinStart: () => scene.onSpinStart?.(),
          onSpinEnd: (last, ctx) => scene.onSpinEnd?.(last, ctx),
          afterPresent: (r) => {
            // WIN readout = THIS spin's win (cumulative delta); the cumulative total goes to the
            // bonus counter (totalWin) via settle(), not the WIN readout. A scene that reported
            // per-step wins already landed on this number, so the count-up is a no-op there.
            winReporter.close();
            shell!.setWin(r.totalWin - prevWin);
            prevWin = r.totalWin;
            balanceGate.afterPresent();
            bonus.settle(r);
          },
          onModeEnter: (mode, trigger, ctx, resumed) => bonus.enter(mode, trigger, ctx, resumed),
          onModeExit: (mode, last, ctx) => bonus.exit(mode, last, ctx),
        },
        action,
      )
        .catch(showPlayError)
        .finally(() => {
          presenting = false;
          winReporter.close(); // also closes the window when a segment threw mid-flight
          shell!.setBusy(false);
        });
    };

    // Drain a recovered open round (reload / dropped connection) to settlement — see resumeDrain.ts.
    // `scene` folds in the old `!ps` guard: with no session there is nothing to play or ack.
    const { createResumeDrain } = await import('./resumeDrain');
    const resumeDrain = createResumeDrain<T>({
      scene: () => (ps ? gameScene() : undefined),
      play: (req) => ps!.play(req),
      ack: (raw) => ps!.playAck(raw),
      normalize: opts.normalize,
      context: makeContext,
      setWin: (amount, o) => shell!.setWin(amount, o),
      setMode: (m) => shell!.setMode(m),
      setBusy: (b) => shell!.setBusy(b),
      winReporter,
      applyBonusReadout,
      bonusMode: bonusShellMode,
    });
    // A round interrupted by a dropped connection is finished the same way a round interrupted by a
    // reload is — animated, through to settlement — except nothing asks the player first: it is
    // their own round, and an extra confirmation screen is what the reconnect flow is meant to
    // avoid. (The reload path keeps its Continue/Finish offer: there, the player has been away.)
    recoverRound = (snapshot) => resumeDrain(snapshot, true);

    if (mode === 'base') {
      let activeFeature: string | null = null;
      shell.on('featureActivate', ({ id }: { id: string }) => {
        activeFeature = id;
      });
      shell.on('featureDeactivate', ({ id: _id }: { id: string }) => {
        activeFeature = null;
      });

      const { stakeForAction } = await import('./shellConfig');
      // Guard a play: if the stake exceeds the balance, show a shell modal and DON'T play.
      const ensureAffordable = (action: string): boolean => {
        if (stakeForAction(opts.model, action, currentBet) <= balanceGate.balance + 1e-9)
          return true;
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
        // Spinning by hand retires whatever a halted run left on the counter — the player moved on.
        // (No-op unless a run was halted: `stop()` returns early when there is nothing to clear.)
        stopAutoplay();
        void playRound(action);
      });
      shell.on('betChange', (bet: number) => {
        currentBet = bet;
        gameScene()?.onBetChanged?.(bet);
      });
      shell.on('buyBonusSelect', ({ id }: { id: string }) => {
        if (!ensureAffordable(id)) return;
        stopAutoplay(); // as with a manual spin: a bought bonus retires a halted run's counter
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
      haltAutoplay = () => autoplay.halt();
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
        try {
          snap = (await ps?.getState()) ?? null;
        } catch {
          snap = null;
        }
        if (!snap) return;
        shell.openModal({
          availableClose: false,
          title: shell.t('Unfinished round'),
          body: shell.t('You have an unfinished round. Continue it or finish it now?'),
          actions: [
            // Continue: replay the round from the start with animation, then settle.
            {
              title: shell.t('Continue'),
              on: () => {
                void resumeDrain(snap!, true);
              },
            },
            // Finish: fast-forward the remaining segments (no animation) to settle the win now.
            {
              title: shell.t('Finish'),
              on: () => {
                void resumeDrain(snap!, false);
              },
            },
          ],
        });
      };
      game.scenes.on('change', () => {
        void offerResume();
      });
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

  return { game, stakeBridge, artubeBridge, shell };
}
