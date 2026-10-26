import { Texture, type Application, type Container } from 'pixi.js';
import { createShell, DEFAULT_MENU, type Shell, type ShellConfig } from '@energy8platform/shell';
import { decodeArt } from '../art';
import { PixiHbRenderer } from './vendor/ui/pixi-hb/PixiHbRenderer';
import { SideBar } from './vendor/ui/pixi-s/SideBar';
import { installSFont } from './vendor/ui/pixi-s/text';
import { openSMenu } from './vendor/ui/pixi-s/components/Menu';
import { openSBuyBonus } from './vendor/ui/pixi-s/components/BuyBonus';
import { openSGameInfo } from './vendor/ui/pixi-s/components/GameInfo';
import { openSBetPicker, openSAutoplayPicker } from './vendor/ui/pixi-s/components/pickers';
import { buildSModal } from './vendor/ui/pixi-s/components/Modal';
import { buildSReplayModal } from './vendor/ui/pixi-s/components/ReplayModal';
import { configureDogmaticArtwork } from './vendor/ui/pixi-hb/dogmatic-brand';

// The DOGMATIC provider shell: the provider's fork of shell 0.15.0's Pixi UI (vendor/, see UPSTREAM.md)
// — the S side bar and every S overlay (menu, game info, buy bonus, pickers, modals) in the DOGMATIC
// palette and artwork — over the published shell controller (`createShell`), so it is the same `Shell` every host
// drives.

/** The shell config plus the Pixi mount target (`parent` defaults to `app.stage`). */
export interface DogmaticShellConfig extends ShellConfig {
  app: Application;
  parent?: Container;
}

let active: Shell | null = null;

/** Create the DOGMATIC game shell: `createSlotGame({ shellFactory: createDogmaticShell })`. One at a
 *  time: returns the active shell if there is one. */
export function createDogmaticShell(config: DogmaticShellConfig): Shell {
  if (active) return active;
  installSFont();
  // the provider's menu has no Spacebar-to-spin row
  const menu = (config.menu ?? DEFAULT_MENU).filter((item) => !('id' in item) || item.id !== 'spacebar');
  const renderer = new PixiHbRenderer({
    app: config.app,
    parent: config.parent,
    bar: (ctx) => new SideBar(ctx),
    overlays: {
      menu: openSMenu,
      gameInfo: openSGameInfo,
      buyBonus: openSBuyBonus,
      betPicker: openSBetPicker,
      autoplayPicker: openSAutoplayPicker,
      modal: buildSModal,
      replay: buildSReplayModal,
    },
  });
  active = createShell({ ...config, menu, renderer });
  // the collar artwork (BONUS button, buy-bonus cards) arrives decoded; redraw with it
  void decodeArt().then((bmp) => {
    if (!bmp) return;
    configureDogmaticArtwork(Texture.from(bmp));
    renderer.renderBar();
  });
  return active;
}

/** Tear down the active shell (fades out, removes its display objects). */
export function removeDogmaticShell(): Promise<void> {
  if (!active) return Promise.resolve();
  const s = active;
  active = null;
  return s.destroy();
}

export type { Shell };
