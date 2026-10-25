import type { Application, Container } from 'pixi.js';
import { createShell, type Shell, type ShellConfig } from '@energy8platform/shell';
import { BmRenderer } from './BmRenderer';
import { loadBmAssets } from './assets';

/** The shell config plus the Pixi mount target (`parent` defaults to `app.stage`). */
export interface BadMannersShellConfig extends ShellConfig {
  app: Application;
  parent?: Container;
}

let active: Shell | null = null;

export interface BadMannersShellOptions {
  /** The accent — the kit's acid lime by default (any CSS colour or 0xRRGGBB). Recolours every lime
   *  surface: pills, active bubbles, the SPIN / BUY discs, slider fills, outlines, the face's tongue.
   *  A game's `theme.accent` wins over it; `shell.setTheme({ accent })` changes it live. */
  accent?: string | number;
}

/** Create the Bad Manners game shell — the same controller, config and events as every Energy8 shell,
 *  drawn in the BAD MANNERS kit. Plug it into a slot with `createSlotGame({ shellFactory:
 *  createBadMannersShell })` (or `badMannersShell({ accent })` for another accent). One at a time:
 *  returns the active shell if there is one. */
export function createBadMannersShell(config: BadMannersShellConfig, opts: BadMannersShellOptions = {}): Shell {
  if (active) return active;
  const renderer = new BmRenderer({ app: config.app, parent: config.parent, accent: opts.accent });
  active = createShell({ ...config, renderer });
  return active;
}

/** A `shellFactory` with options: `createSlotGame({ shellFactory: badMannersShell({ accent: '#ff3b8b' }) })`. */
export function badMannersShell(opts: BadMannersShellOptions): (config: BadMannersShellConfig) => Shell {
  return (config) => createBadMannersShell(config, opts);
}

/** Tear down the active shell (fades out, removes its display objects). */
export function removeBadMannersShell(): Promise<void> {
  if (!active) return Promise.resolve();
  const s = active;
  active = null;
  return s.destroy();
}

/** Decode the kit (fonts + atlas, painted in an accent) ahead of time — e.g. during the loading
 *  screen. The shell also starts this itself and draws the HUD once it resolves. */
export { loadBmAssets };
export { BmRenderer };
export type { Shell };
