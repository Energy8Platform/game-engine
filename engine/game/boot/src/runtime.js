/**
 * Runtime half of `boot` — the browser-loadable twin of `./index.ts`'s
 * `renderBootFailure`.
 *
 * **Read this file's doc comment before writing another package's runtime
 * half** — it states the one constraint every `./runtime` entry in this
 * bundle shares, so the other five files only cross-reference it instead
 * of repeating it.
 *
 * `GET /plugin-runtime/:id` (`engine/ide/host/src/plugins/runtime-assets.ts`)
 * serves this file's bytes RAW — `res.text(source)` over the package's own
 * `e8.runtime.entry`, no transform in between — and the browser loader
 * (`engine/game/loader/src/index.ts`) imports it with a native `import()`.
 * That is the identical arrangement the CLIENT half already has
 * (`engine/ide/host/src/plugins/client-assets.ts`, mirrored by
 * `engine/examples/probe-plugin/src/client.js`'s module doc), so the same
 * two rules apply: no TypeScript syntax (a browser with nothing
 * transpiling it treats `interface`/type annotations as a `SyntaxError`),
 * and no bare specifiers (`import { Application } from 'pixi.js'` has no
 * import map to resolve against and throws at parse time).
 *
 * The client half had ONE cross-cutting bare import to solve (React) and
 * solved it with a single shell-published global
 * (`globalThis.__E8_IDE__ = { React }`, see `engine/apps/web/src/main.tsx`).
 * The runtime half has no such bridge yet, and needs a bigger one: every
 * other row in `e8-base` genuinely needs a bare import to do its real job
 * — `renderer-pixi` and `stage` need `pixi.js`, `reels` needs `pixi.js`
 * plus `@energy8platform/game-engine/slot`, `game-runtime` needs
 * `@energy8engine/mechanic-classic`/`mechanic-cascade`, and every one of
 * them (this file included, structurally) would want
 * `@energy8engine/contracts` for `diagnostic`/`checkShape`. None of that
 * has a working resolution path today: this file, and its five siblings,
 * are written to be substantively correct — they are what the row does
 * once something CAN load them — but literally `curl`ing
 * `/plugin-runtime/reels1` and feeding the response to a real browser's
 * `import()` will fail on the first bare specifier it reaches. Task 9,
 * the moment it swaps `createGame`'s hardcoded composition for
 * `composeFromProject` and actually runs `e8-base` in a browser, will
 * hit this. See task-8-report.md for the full finding; this comment only
 * flags where the wall is.
 *
 * Given that, this row's `apply(ctx, config)` only exposes the one piece
 * of `boot`'s current job that is genuinely a reusable, config-free
 * service: turning a diagnostics list into readable DOM. The other half —
 * deciding WHEN to show it, which needs a live `start()` callback and a
 * shared, mutable `diagnostics` array — does not fit a row's static YAML
 * `config` at all (a function and a mutable reference are not data); see
 * the report for why that split is not this task's to resolve.
 */
export const name = 'boot';

export function apply(ctx, config) {
  ctx.provide('boot', {
    /**
     * Renders `diagnostics` into `root` as plain readable text — replacing
     * whatever `root` held before. Byte-for-byte the same behaviour as
     * `./index.ts`'s `renderBootFailure`, kept in sync by hand since this
     * file cannot `import` that one (see the module doc above).
     */
    renderFailure(root, diagnostics) {
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
    },
  });
}
