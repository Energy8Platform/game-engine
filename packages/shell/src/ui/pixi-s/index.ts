import { createShell } from '@/core';
import { PixiHbRenderer, type HbOverlays } from '../pixi-hb/PixiHbRenderer';
import type { PixiShellConfig, PixiGameShell } from '../pixi-hb';
import { SideBar } from './SideBar';
import { installSFont } from './text';
import { openSMenu } from './components/Menu';
import { openSGameInfo } from './components/GameInfo';
import { openSBuyBonus } from './components/BuyBonus';
import { openSBetPicker, openSAutoplayPicker } from './components/pickers';
import { buildSModal } from './components/Modal';
import { buildSReplayModal } from './components/ReplayModal';

// The S shell: HB's renderer with the S bar and the S overlays (menu, game info, buy bonus, pickers,
// modals). Same config, events and surface as every shell — a game switches with
// `shellFactory: createPixiSShell`.

export type { PixiShellConfig, PixiGameShell, PixiShellSurface, BonusOption, GameInfoSection } from '../pixi-hb';

/** Every overlay in the S look (slice 2): the menu, game info, buy bonus and the small modals. */
const S_OVERLAYS: HbOverlays = {
  menu: openSMenu,
  gameInfo: openSGameInfo,
  buyBonus: openSBuyBonus,
  betPicker: openSBetPicker,
  autoplayPicker: openSAutoplayPicker,
  replay: buildSReplayModal,
  modal: buildSModal,
};

let active: PixiGameShell | null = null;

/** Create the S game shell. Like `createPixiHbShell`, only one is active at a time — returns the
 *  existing instance if one is. */
export function createPixiSShell(config: PixiShellConfig): PixiGameShell {
  if (active) return active;
  installSFont(); // before the renderer mounts: its first render waits on document.fonts.ready
  const renderer = new PixiHbRenderer({ app: config.app, parent: config.parent, bar: (ctx) => new SideBar(ctx), overlays: S_OVERLAYS });
  active = createShell({ ...config, renderer });
  return active;
}

/** Tear down the active S shell (fade out, detach listeners, remove its display objects). */
export function removePixiSShell(): Promise<void> {
  if (!active) return Promise.resolve();
  const shell = active;
  active = null;
  return shell.destroy();
}

export { S } from './theme';
export * from '@/core';
/** The layer contract renderers and custom layers share — public so emitted declarations can name it. */
export type { ShellLayer, LayerHandle, PixiComponentContext } from '../pixi/context';
