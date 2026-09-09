/**
 * The browser half of a plugin nobody on the core team wrote — the proof
 * that `ctx.layout.screen` is a surface a PROJECT plugin can actually use,
 * not only something the shipped composition and preview screens happen to
 * call internally. Written against nothing but that one call and the React
 * the shell publishes; see `engine/examples/probe-plugin/src/client.js` for
 * the same two rules spelled out in full, which this file follows exactly:
 *
 *   - No JSX and no TypeScript syntax — the host serves this file
 *     byte-for-byte (`GET /plugin-client/:id`) and the browser runs it as a
 *     real ES module with no build step in front of it, so either is a
 *     `SyntaxError` at parse time.
 *   - No bare `import React from 'react'` — nothing here resolves that
 *     specifier, and bundling React per plugin would load several copies
 *     and break hooks. React comes off `globalThis.__E8_IDE__` instead,
 *     published once by the shell before any plugin's client half runs
 *     (see `engine/apps/web/src/main.tsx`).
 */
const { React } = globalThis.__E8_IDE__;

export const name = 'screen-demo';

/**
 * Whether THIS render should throw — decided fresh on every render off a
 * URL query flag, not baked into the plugin as an always-on failure. A
 * project plugin has no server half here (this package declares no
 * `e8.runtime`, only `e8.client`), so there is no config object for a row
 * to hand this function; a query flag is the one piece of "configuration"
 * a browser module with no build step can read without a package.json
 * field to carry it — the same device `@energy8engine/game-runtime` and
 * `@energy8engine/ide-bridge` already read their own flags off
 * (`new URLSearchParams(location.search)`).
 *
 * Left reachable on purpose, not exercised by this file: a screen that
 * throws is supposed to be caught by the layout that drew it, not
 * something this plugin can safely rehearse without knowing what catches
 * it — see the task-7 brief for why that proof belongs to a later task,
 * against this same plugin, rather than being hand-rolled here.
 */
function shouldCrash() {
  return new URLSearchParams(location.search).has('screen-demo-crash');
}

/**
 * `apply(ctx)` runs once this module has imported cleanly. The IDE shell
 * never had to know this plugin exists — it only knows the `layout.screen`
 * registry, and this plugin is the one deciding what goes into it.
 */
export function apply(ctx) {
  ctx.layout.screen({ id: 'demo', title: 'Демо', order: 50 }, () => {
    if (shouldCrash()) {
      throw new Error('screen-demo: forced failure (the URL carried ?screen-demo-crash)');
    }
    return React.createElement(
      'div',
      { 'data-testid': 'demo-screen' },
      'a screen from a project plugin',
    );
  });
}
