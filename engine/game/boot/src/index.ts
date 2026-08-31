/**
 * `boot`: startup order and the error screen (spec §5, §8).
 *
 * The rule that shapes this whole package: on an `error` diagnostic the
 * game does not start, and it **shows the text** — never a white
 * rectangle. That rule forces a structural choice: the screen that reports
 * "the renderer did not start" cannot itself depend on the renderer having
 * started. So `renderBootFailure` is plain DOM (`document.createElement`,
 * no pixi, no `Container`) — a broken renderer can still be reported,
 * because reporting it never asks the renderer for anything.
 *
 * `renderBootFailure` and the `boot` plugin are deliberately two separate
 * pieces. The function does one thing — turn a list of diagnostics into
 * readable DOM — and knows nothing about cordis, `start()` callbacks, or
 * what "the renderer" even is. The plugin is the decision on top of it:
 * given the diagnostics collected *before* the canvas-dependent part of
 * boot would run, call `start()` (bring up the renderer and whatever
 * mounts into it) when nothing has failed yet, or show the screen instead
 * of calling it when something already has. `boot` never imports
 * `renderer-pixi` or `stage` — "start" is just a callback its caller
 * supplies (`createGame`, in `@energy8engine/game-runtime`), which is what
 * keeps this package renderer-agnostic in the same way `session-dev` is
 * math-engine-agnostic behind the `session` seam.
 *
 * One consequence worth stating plainly (see the task report's Concerns
 * section for the full write-up): this plugin makes its call ONCE, from
 * the diagnostics that exist at the moment it runs. If `start()` itself
 * goes on to produce a NEW error (e.g. the renderer fails to initialise
 * once actually tried), that failure lands in the shared diagnostics array
 * for the caller to see, but this plugin does not re-evaluate and show the
 * screen for it — the decision already happened. That is a real gap, not
 * an oversight; closing it would mean re-running this same decision after
 * `start()` settles, which no test asked for and which risks a screen that
 * flashes in over a game that mostly works. Left for the next task that
 * needs it.
 */
import type { Context } from 'cordis';
import type { Diagnostic } from '@energy8engine/contracts';

/**
 * Renders `diagnostics` into `root` as plain readable text — replacing
 * whatever `root` held before. Never throws, whatever it is given
 * (including an empty list): the whole point of this function is that it
 * is the one thing in the game guaranteed to still work when everything
 * else has failed to start.
 */
export function renderBootFailure(root: HTMLElement, diagnostics: Diagnostic[]): void {
  root.textContent = '';

  const heading = document.createElement('h1');
  heading.textContent = 'This game could not start';
  root.appendChild(heading);

  if (diagnostics.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'No reasons were given.';
    root.appendChild(empty);
    return;
  }

  const list = document.createElement('ul');
  for (const d of diagnostics) {
    const item = document.createElement('li');

    const where = document.createElement('div');
    where.textContent = `${d.plugin} — ${d.where}`;
    item.appendChild(where);

    const message = document.createElement('div');
    message.textContent = d.message;
    item.appendChild(message);

    if (d.fix) {
      const fix = document.createElement('div');
      fix.textContent = `Fix: ${d.fix}`;
      item.appendChild(fix);
    }

    list.appendChild(item);
  }
  root.appendChild(list);
}

export interface BootConfig {
  /**
   * Diagnostics collected before this plugin runs (e.g. from `session`
   * starting, or from validating `reels`' config) — shared with the
   * `GameApp` this composes into, by reference, so this plugin sees
   * whatever the caller has pushed onto it so far.
   */
  diagnostics: Diagnostic[];
  /** Where to render the failure screen. Omitted in non-browser callers (e.g. tests) — the start/skip decision is still made, there is just nothing to draw it into. */
  mount?: HTMLElement;
  /**
   * Brings up the canvas-dependent rest of the game (renderer, stage, …).
   * Called, and awaited, only when `diagnostics` has no `error` in it —
   * never when it does.
   */
  start(): void | Promise<void>;
}

export const name = 'boot';

export async function apply(_ctx: Context, config: BootConfig): Promise<void> {
  const hasError = config.diagnostics.some((d) => d.severity === 'error');

  if (hasError) {
    if (config.mount) renderBootFailure(config.mount, config.diagnostics);
    return;
  }

  await config.start();
}
