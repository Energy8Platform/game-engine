/**
 * The browser half of a plugin nobody on the core team wrote — the proof
 * that the shell's slots are a surface a PROJECT plugin can actually use,
 * not only something the shipped composition and preview documents happen
 * to call internally. Written against nothing but `ctx.slots.register`,
 * one other service, and the React the shell publishes; see
 * `engine/examples/probe-plugin/src/client.js` for the same two rules
 * spelled out in full, which this file follows exactly:
 *
 *   - No JSX and no TypeScript syntax — the host serves this file
 *     byte-for-byte (`GET /plugin-client/:id`) and the browser runs it as a
 *     real ES module with no build step in front of it, so either is a
 *     `SyntaxError` at parse time.
 *   - No bare `import React from 'react'` — nothing here resolves that
 *     specifier, and bundling React per plugin would load several copies
 *     and break hooks. React comes off `globalThis.__E8_IDE__` instead,
 *     published once by the shell before any plugin's client half runs
 *     (see `engine/apps/web/src/main.tsx`), and so do the hooks a document
 *     needs to watch a service rather than read it once.
 *
 * A document is two registrations under ONE key: a button on the activity
 * bar (`shell.activity`, `opens: 'document'`, no body of its own) and the
 * document it opens (`shell.document`). The shell pairs them by `key`.
 */
const { React, useGameComposition } = globalThis.__E8_IDE__;

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
 * `engine/apps/web/tests/e2e/screen-demo.spec.ts` exercises this end to
 * end: a real thrown `Error`, caught by the shell's own document boundary,
 * with the rest of the IDE left working.
 */
function shouldCrash() {
  return new URLSearchParams(location.search).has('screen-demo-crash');
}

/**
 * `apply(ctx)` runs once this module has imported cleanly. The IDE shell
 * never had to know this plugin exists — it only knows its slots, and this
 * plugin is the one deciding what goes into them.
 *
 * **Registered as effects, not as bare calls.** `ctx` here is this
 * plugin's own cordis fiber, and disposing that fiber is how the editor
 * takes a plugin's contributions back when its row is switched off or
 * removed from `e8.yml` (see `modules.ts`). An effect's disposer is what
 * cordis runs then; a bare `ctx.slots.register(...)` would leave the tab on
 * screen, rendering code from a plugin the composition says is gone.
 *
 * **The document reads a service, and reads it through THIS `ctx`.** The
 * `ctx` a document component is handed as a prop is the shell's root
 * context, which can reach everything — so a document that used it would
 * prove nothing about what a plugin may reach. The one closed over here is
 * this plugin's own scope, restricted to what `e8.client.inject` in this
 * package's package.json declared: `slots` for the registrations, and
 * `gameComposition` for the row count below. Take `gameComposition` out of
 * that list and this document stops rendering, with a diagnostic naming it.
 */
export function apply(ctx) {
  ctx.effect(
    () =>
      ctx.slots.register({
        name: 'shell.activity',
        key: 'demo',
        title: 'Demo',
        icon: 'demo',
        order: 50,
        opens: 'document',
      }),
    'screen-demo:activity',
  );

  ctx.effect(
    () =>
      ctx.slots.register(
        { name: 'shell.document', key: 'demo', title: 'Demo', closable: true },
        function DemoDocument() {
          const { rows } = useGameComposition(ctx);
          if (shouldCrash()) {
            throw new Error('screen-demo: forced failure (the URL carried ?screen-demo-crash)');
          }
          return React.createElement(
            'div',
            { 'data-testid': 'demo-screen' },
            'a document from a project plugin',
            React.createElement(
              'span',
              { 'data-testid': 'demo-rows' },
              ` — the game composes ${rows ? rows.length : 0} rows`,
            ),
          );
        },
      ),
    'screen-demo:document',
  );
}
