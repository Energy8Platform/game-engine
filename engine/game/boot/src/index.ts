/**
 * `boot`: the error screen (spec §5, §8).
 *
 * The rule that shapes this package: on an `error` diagnostic the game
 * does not start, and it **shows the text** — never a white rectangle.
 * That rule forces a structural choice: the screen that reports "the
 * renderer did not start" cannot itself depend on the renderer having
 * started. So `renderBootFailure` is plain DOM (`document.createElement`,
 * no pixi, no `Container`) — a broken renderer can still be reported,
 * because reporting it never asks the renderer for anything.
 *
 * **What this package no longer does.** It used to also own the startup
 * ORDER: a cordis plugin taking a `start()` callback and a shared
 * `diagnostics` array, which called `start()` when nothing had failed yet
 * and drew the screen instead when something had. That plugin's last
 * caller was the hand-wired `createGame`, and the project-composed one
 * that replaced it has no use for it: rows are ordered by the composition
 * itself, and `boot` no longer decides anything about the renderer. It
 * renders. `@energy8engine/game-runtime`'s `createGame` holds the mount
 * and the full diagnostics list, and calls the function below — through
 * the `boot` SERVICE this package's `./runtime` half provides (see
 * `src/runtime.ts`), falling back to importing it directly when the
 * composition never got as far as that row.
 */
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
